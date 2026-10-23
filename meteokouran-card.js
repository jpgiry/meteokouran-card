/*
 * MétéoKouran card for Home Assistant: `type: custom:meteokouran-card`
 *
 * Shows EDF Réunion's "météo de l'électricité" read from the MétéoKouran API:
 * current state, a sentence, a timeline starting now, and the coming days.
 * Plain JavaScript module: no build step, no dependency. Load it as a
 * "JavaScript module" resource (/local/meteokouran-card.js?v=3: change ?v= on
 * every update, or the mobile app keeps the old file).
 *
 * Data: EDF (Licence Ouverte Etalab 2.0). The footer always shows
 * "Source : EDF" and the EDF update date; no EDF logo or wording is used.
 *
 * All the logic lives in pure exported functions (tested with `node --test`,
 * see homeassistant/tests/); the element only fetches and renders.
 */

export const VERSION = '1.2.0';

const HOUR = 3600000;
// Réunion is UTC+4 all year round (no daylight saving time). Every hour is
// computed from this offset, never from the browser's or phone's time zone.
const REUNION_OFFSET = 4 * HOUR;
const REFRESH_MS = 15 * 60000;
const RETRY_MS = 2 * 60000;
const TIMEOUT_MS = 20000;
const DEFAULT_ENTITY = 'input_text.meteokouran_url';

// Own palette (not EDF's). Text and icons drawn on a signal colour use INK:
// contrast ≥ 4.5:1 (WCAG AA) on each colour, checked by the tests. The same
// fills are used in light and dark themes.
export const PALETTE = {
  vert: '#46bf7e',
  orange: '#f2a33a',
  rouge: '#ef6b6b',
  bleu: '#6f9cf0',
  ink: '#15191f',
};

export const SIGNALS = {
  vert: {
    label: 'Optimal', title: 'Réseau optimal', icon: 'mdi:transmission-tower',
    legend: 'aucune contrainte sur le réseau',
  },
  orange: {
    label: 'Contraint', title: 'Réseau contraint', icon: 'mdi:transmission-tower-export',
    one: 'h contrainte', many: 'h contraintes',
    legend: 'décalez les gros appareils si possible',
  },
  rouge: {
    label: 'Très contraint', title: 'Réseau très contraint', icon: 'mdi:transmission-tower-off',
    one: 'h très contrainte', many: 'h très contraintes',
    legend: 'réduisez votre consommation au maximum',
  },
  bleu: {
    label: 'Heures de pointe', title: 'Heures de pointe', icon: 'mdi:clock-alert-outline',
    one: 'h de pointe', many: 'h de pointe',
    legend: 'pic de demande du soir, différez les gros appareils',
  },
};
const UNKNOWN = { label: 'Non publié', title: 'Signal non publié', icon: 'mdi:help-circle-outline' };
const WEEKDAYS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];

const pad = (n) => String(n).padStart(2, '0');

const esc = (value) => String(value).replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

// ---------------------------------------------------------------- time ----

/** Calendar date and time in Réunion for an epoch in ms, whatever the browser's zone. */
export function reunionParts(ms) {
  const d = new Date(ms + REUNION_OFFSET);
  return {
    date: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    day: d.getUTCDate(),
    month: d.getUTCMonth() + 1,
  };
}

/** Start of the hour containing `ms` (Réunion's offset is whole hours, so UTC boundaries match). */
export function hourStart(ms) {
  return Math.floor(ms / HOUR) * HOUR;
}

export function formatTime(ms) {
  const p = reunionParts(ms);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function daysBetween(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / (24 * HOUR));
}

function shortDay(date) {
  const d = new Date(`${date}T00:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()}`;
}

/** "Aujourd'hui", "Demain", then "jeu. 15" (dates as YYYY-MM-DD, Réunion calendar). */
export function dayLabel(date, today) {
  if (date === today) return "Aujourd'hui";
  if (date === addDays(today, 1)) return 'Demain';
  return shortDay(date);
}

/** A moment relative to now: "18:00", "minuit", "demain 06:00", "jeu. 15 à 18:00". */
export function whenLabel(ms, nowMs) {
  const p = reunionParts(ms);
  const today = reunionParts(nowMs).date;
  const time = `${pad(p.hour)}:${pad(p.minute)}`;
  if (p.date === today) return time;
  if (p.date === addDays(today, 1)) return p.hour === 0 && p.minute === 0 ? 'minuit' : `demain ${time}`;
  return `${shortDay(p.date)} à ${time}`;
}

// ---------------------------------------------------------------- data ----

export function signalKey(signal) {
  return signal && Object.hasOwn(SIGNALS, signal.key) ? signal.key : null;
}

/** Map hour start (epoch ms) → signal key, from a /forecast response. */
export function hourIndex(payload) {
  const index = new Map();
  for (const day of payload?.data?.days ?? []) {
    for (const hour of day?.hours ?? []) {
      const ms = Date.parse(hour?.start);
      if (!Number.isNaN(ms)) index.set(ms, signalKey(hour.signal));
    }
  }
  return index;
}

/**
 * EDF's "cyclone en cours" flag of the hour in progress (API 2026-10-23 and later; absent before).
 * null unless that hour is flagged true: no flag, false, or an older API all mean "nothing to show",
 * never "no cyclone". `sinceMs`: start of the run of flagged hours leading to now, null when the run
 * starts at the first hour of the response (it may have started earlier).
 */
export function cycloneState(payload, nowMs) {
  const flags = cycloneFlags(payload);
  const start = hourStart(nowMs);
  if (flags.get(start) !== true) return null;
  let since = start;
  while (flags.get(since - HOUR) === true) since -= HOUR;
  return { sinceMs: since === Math.min(...flags.keys()) ? null : since };
}

/**
 * EDF announces a cyclone: an hour after the one in progress is flagged, the hour in progress is not
 * (the "in progress" banner says more then). The response stops at J+4, the window EDF's app reads.
 * null otherwise, never "no cyclone". `firstMs`: first flagged hour.
 */
export function cycloneAnnounced(payload, nowMs) {
  const flags = cycloneFlags(payload);
  const start = hourStart(nowMs);
  if (flags.get(start) === true) return null;
  const ahead = [...flags].filter(([ms, flagged]) => flagged && ms > start).map(([ms]) => ms);
  return ahead.length ? { firstMs: Math.min(...ahead) } : null;
}

/** Map hour start (epoch ms) → EDF flag cyclone_en_cours (false when absent: older API). */
function cycloneFlags(payload) {
  const flags = new Map();
  for (const day of payload?.data?.days ?? []) {
    for (const hour of day?.hours ?? []) {
      const ms = Date.parse(hour?.start);
      if (!Number.isNaN(ms)) flags.set(ms, hour.cyclone_en_cours === true);
    }
  }
  return flags;
}

/** `count` hourly slots from the current hour; `key` is null when the hour is not published. */
export function timelineSlots(index, nowMs, count) {
  const start = hourStart(nowMs);
  return Array.from({ length: count }, (_, i) => {
    const ms = start + i * HOUR;
    return { ms, key: index.get(ms) ?? null };
  });
}

/** Consecutive slots with the same signal merged into blocks. */
export function mergeBlocks(slots) {
  const blocks = [];
  slots.forEach((slot, i) => {
    const last = blocks[blocks.length - 1];
    if (last && last.key === slot.key) {
      last.length += 1;
      last.endMs = slot.ms + HOUR;
    } else {
      blocks.push({ key: slot.key, index: i, length: 1, startMs: slot.ms, endMs: slot.ms + HOUR });
    }
  });
  return blocks;
}

/**
 * Tick every 3 h ("15 h"); midnight ticks also carry the day's name.
 * `every`: the coarsest step (3, 6, 12 or 24 h) the tick belongs to, used to
 * thin the labels out evenly when they do not fit (see fitLabels).
 */
export function timelineTicks(slots, nowMs) {
  const today = reunionParts(nowMs).date;
  const ticks = [];
  slots.forEach((slot, i) => {
    const p = reunionParts(slot.ms);
    if (p.hour % 3 !== 0) return;
    const every = [24, 12, 6].find((step) => p.hour % step === 0) ?? 3;
    const tick = { index: i, label: `${p.hour} h`, every };
    if (p.hour === 0 && i > 0) tick.day = dayLabel(p.date, today);
    ticks.push(tick);
  });
  return ticks;
}

function runEnd(index, from, key) {
  let ms = from;
  while (index.get(ms) === key) ms += HOUR;
  return ms;
}

/** Title of the card: the current hour's signal. */
export function stateTitle(index, nowMs) {
  const key = index.get(hourStart(nowMs)) ?? null;
  return key ? SIGNALS[key].title : UNKNOWN.title;
}

/** "Optimal jusqu'à 18:00, puis heures de pointe jusqu'à 22:00". */
export function summary(index, nowMs) {
  const start = hourStart(nowMs);
  const first = index.get(start) ?? null;
  if (!first) return "Signal de l'heure en cours non publié";
  const label = SIGNALS[first].label;
  const end1 = runEnd(index, start, first);
  const next = index.get(end1) ?? null;
  if (!next) {
    // No change until the end of the published data.
    const today = reunionParts(nowMs).date;
    const days = daysBetween(today, reunionParts(end1 - HOUR).date) + 1;
    if (days >= 2 && reunionParts(end1).hour === 0) return `${label} sur les ${days} prochains jours`;
    return `${label} jusqu'à ${whenLabel(end1, nowMs)} (suite non publiée)`;
  }
  const end2 = runEnd(index, end1, next);
  const tail = index.get(end2) ? ` jusqu'à ${whenLabel(end2, nowMs)}` : '';
  return `${label} jusqu'à ${whenLabel(end1, nowMs)}, puis ${SIGNALS[next].label.toLowerCase()}${tail}`;
}

/** Text alternative of the timeline (it is drawn as role="img"). */
export function timelineAria(blocks, nowMs) {
  const hours = blocks.reduce((n, b) => n + b.length, 0);
  const parts = blocks.map((b, i) => {
    const what = (b.key ? SIGNALS[b.key].label : UNKNOWN.label).toLowerCase();
    const from = i === 0 ? 'maintenant' : whenLabel(b.startMs, nowMs);
    return `${what} de ${from} à ${whenLabel(b.endMs, nowMs)}`;
  });
  return `Frise des ${hours} prochaines heures : ${parts.join(', ')}.`;
}

/**
 * Which labels of a row to show, from their measured boxes (px, relative to
 * the row; sorted by position). Labels are never moved: a label that would
 * leave the row (by more than `slack`) or come closer than OBSTACLE_GAP to an
 * obstacle ("Maintenant") is hidden; when labels overlap, only every 6 h, then
 * 12 h, then 24 h are kept, so the visible ones stay evenly spaced.
 * labels: [{ left, right, every }] → one boolean per label.
 */
export const OBSTACLE_GAP = 8;

export function fitLabels(labels, width, gap = 4, obstacles = [], slack = 0) {
  const fits = (l) => l.left >= -slack && l.right <= width + slack
    && obstacles.every((o) => l.right + OBSTACLE_GAP <= o.left || l.left >= o.right + OBSTACLE_GAP);
  const apart = (kept) => kept.every((l, i) => i === 0 || kept[i - 1].right + gap <= l.left);
  for (const step of [3, 6, 12, 24]) {
    const kept = labels.filter((l) => l.every >= step && fits(l));
    if (apart(kept)) return labels.map((l) => kept.includes(l));
  }
  let last = null;
  return labels.map((l) => {
    const show = fits(l) && (!last || last.right + gap <= l.left);
    if (show) last = l;
    return show;
  });
}

/** Non-green hours of a day: ["3 h très contraintes", "4 h de pointe"]. */
export function dayDetail(day) {
  const counts = { rouge: 0, orange: 0, bleu: 0 };
  for (const hour of day?.hours ?? []) {
    const key = signalKey(hour?.signal);
    if (key && key !== 'vert') counts[key] += 1;
  }
  return Object.keys(counts)
    .filter((k) => counts[k] > 0)
    .map((k) => `${counts[k]} ${counts[k] > 1 ? SIGNALS[k].many : SIGNALS[k].one}`);
}

/** Day tiles from today (Réunion calendar), at most `count`. */
export function dayTiles(payload, nowMs, count) {
  const today = reunionParts(nowMs).date;
  return (payload?.data?.days ?? [])
    .filter((d) => typeof d?.date === 'string' && d.date >= today)
    .slice(0, count)
    .map((d) => ({
      date: d.date,
      label: dayLabel(d.date, today),
      today: d.date === today,
      key: signalKey(d.signal),
      detail: dayDetail(d),
    }));
}

/** "Source : EDF · données du 13/10 à 21:00" (licence: source + EDF update date). */
export function sourceLine(payload) {
  const name = payload?.source?.name || 'EDF';
  const ms = Date.parse(payload?.source?.updated_at);
  if (Number.isNaN(ms)) return `Source : ${name}`;
  const p = reunionParts(ms);
  return `Source : ${name} · données du ${pad(p.day)}/${pad(p.month)} à ${formatTime(ms)}`;
}

export function normalizeConfig(config) {
  if (!config || typeof config !== 'object') throw new Error('Configuration invalide');
  const hours = config.hours ?? 24;
  const days = config.days ?? 5;
  if (!Number.isInteger(hours) || hours < 6 || hours > 48) throw new Error('hours : entier de 6 à 48 (24 par défaut)');
  if (!Number.isInteger(days) || days < 1 || days > 5) throw new Error('days : entier de 1 à 5 (5 par défaut)');
  if (config.url != null && typeof config.url !== 'string') throw new Error('url : adresse de MétéoKouran');
  const scale = config.scale ?? 1;
  if (typeof scale !== 'number' || !(scale >= 0.8 && scale <= 1.5)) throw new Error('scale : nombre de 0.8 à 1.5 (1 par défaut)');
  return {
    url: config.url || null,
    url_entity: config.url_entity || DEFAULT_ENTITY,
    hours,
    days,
    show_legend: config.show_legend === true,
    title: config.title ? String(config.title) : null,
    scale,
  };
}

/** Base URL from `url`, or from the state of `url_entity`; trailing "/" and "/api/v1" removed. */
export function resolveUrl(config, hass) {
  let url = config.url;
  if (!url) {
    const state = hass?.states?.[config.url_entity]?.state;
    if (state && state !== 'unknown' && state !== 'unavailable') url = state;
  }
  return url ? url.trim().replace(/\/+$/, '').replace(/\/api\/v1$/, '') : null;
}

/** WCAG contrast ratio between two #rrggbb colours. */
export function contrastRatio(a, b) {
  const lum = (hex) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// -------------------------------------------------------------- render ----

const icon = (key) => `<ha-icon icon="${(key ? SIGNALS[key] : UNKNOWN).icon}"></ha-icon>`;
const pct = (i, n) => `${((i / n) * 100).toFixed(3)}%`;

function renderTimeline(index, nowMs, hours) {
  const slots = timelineSlots(index, nowMs, hours);
  const blocks = mergeBlocks(slots);
  const minIcon = hours > 12 ? 2 : 1;
  const bar = blocks.map((b) => {
    const meta = b.key ? SIGNALS[b.key] : UNKNOWN;
    const tip = `${formatTime(b.startMs)}–${formatTime(b.endMs)} · ${meta.label}`;
    const inner = b.key !== 'vert' && b.length >= minIcon ? icon(b.key) : '';
    return `<div class="block" style="flex:${b.length} 1 0" data-k="${b.key ?? 'none'}" title="${esc(tip)}">`
      + `<div class="fill">${inner}</div></div>`;
  }).join('');
  const ticks = timelineTicks(slots, nowMs);
  // Every label is centred on its exact time; the element hides the ones that
  // do not fit (fitLabels) instead of moving them.
  const midnights = ticks.filter((t) => t.day);
  const dayNames = midnights
    .map((t) => `<span class="dayname" data-every="24" style="left:${pct(t.index, hours)}">${esc(t.day)}</span>`).join('');
  const lines = midnights.map((t) => `<span class="midnight" style="left:${pct(t.index, hours)}"></span>`).join('');
  const tickHtml = ticks
    .map((t) => `<span class="tick" data-every="${t.every}" style="left:${pct(t.index, hours)}">${t.label}</span>`).join('');
  return `<div class="timeline" role="img" aria-label="${esc(timelineAria(blocks, nowMs))}">`
    + `<div class="above"><span class="now">Maintenant</span>${dayNames}</div>`
    + `<div class="bar">${bar}${lines}</div>`
    + `<div class="ticks">${tickHtml}</div></div>`;
}

function renderDays(payload, nowMs, count) {
  const tiles = dayTiles(payload, nowMs, count);
  if (!tiles.length) return '';
  return `<ul class="days">${tiles.map((t) => {
    const meta = t.key ? SIGNALS[t.key] : UNKNOWN;
    let detail = t.detail;
    if (!t.key) detail = ['Prévision à venir'];
    else if (t.key === 'vert' && !detail.length) detail = ['Aucune contrainte'];
    return `<li class="day${t.today ? ' today' : ''}"${t.today ? ' aria-current="date"' : ''}>`
      + `<span class="dname">${esc(t.label)}</span>`
      + `<span class="dsignal"><span class="pill" data-k="${t.key ?? 'none'}">${icon(t.key)}</span>`
      + `<span class="dlabel">${esc(meta.label)}</span></span>`
      + detail.map((d) => `<span class="ddetail">${esc(d)}</span>`).join('') + '</li>';
  }).join('')}</ul>`;
}

function renderLegend() {
  return `<ul class="legend">${Object.entries(SIGNALS).map(([key, s]) => `<li>`
    + `<span class="pill" data-k="${key}">${icon(key)}</span>`
    + `<span><strong>${s.label}</strong>&nbsp;: ${esc(s.legend)}</span></li>`).join('')}</ul>`;
}

function renderCyclone(payload, nowMs) {
  const cyclone = cycloneState(payload, nowMs);
  if (!cyclone) {
    const announced = cycloneAnnounced(payload, nowMs);
    if (!announced) return '';
    return '<div class="cyclone" role="status"><ha-icon icon="mdi:weather-hurricane-outline"></ha-icon>'
      + `<span><strong>Cyclone annoncé par EDF</strong> à partir de ${esc(whenLabel(announced.firstMs, nowMs))}</span></div>`;
  }
  const since = cyclone.sinceMs === null ? '' : ` · depuis ${esc(whenLabel(cyclone.sinceMs, nowMs))}`;
  return '<div class="cyclone" role="status"><ha-icon icon="mdi:weather-hurricane"></ha-icon>'
    + `<span><strong>EDF signale un cyclone en cours</strong>${since}</span></div>`;
}

const scaleStyle = (config) => (config.scale === 1 ? '' : ` style="--mk-s:${config.scale}"`);

/**
 * Whole card as an HTML string (pure).
 * state: { config, payload, nowMs, url, lastOk, error, loading }
 */
export function renderCard(state) {
  const { config, payload, nowMs } = state;
  const heading = config.title ? `<div class="heading">${esc(config.title)}</div>` : '';
  if (!payload) {
    let message;
    if (!state.url) {
      message = `Adresse de MétéoKouran inconnue : renseigner <code>url</code> dans la carte ou l'entité <code>${esc(config.url_entity)}</code>.`;
    } else if (state.error) {
      message = `Impossible de joindre MétéoKouran (${esc(state.url)}). Nouvel essai automatique dans quelques minutes.`;
    } else {
      message = 'Chargement de la météo de l\'électricité…';
    }
    return `<ha-card><div class="mk"${scaleStyle(config)}>${heading || '<div class="heading">MétéoKouran</div>'}`
      + `<p class="message" role="status">${message}</p></div></ha-card>`;
  }
  const index = hourIndex(payload);
  const key = index.get(hourStart(nowMs)) ?? null;
  const warnings = [];
  if (payload.meta?.stale) warnings.push('⚠️ Données anciennes');
  if (state.error && state.lastOk) warnings.push(`⚠️ Données non actualisées depuis ${formatTime(state.lastOk)}`);
  return `<ha-card><div class="mk"${scaleStyle(config)}>${heading}`
    + renderCyclone(payload, nowMs)
    + `<div class="state"><span class="pill big" data-k="${key ?? 'none'}">${icon(key)}</span>`
    + `<span class="title">${esc(stateTitle(index, nowMs))}</span></div>`
    + `<p class="phrase">${esc(summary(index, nowMs))}</p>`
    + renderTimeline(index, nowMs, config.hours)
    + renderDays(payload, nowMs, config.days)
    + (config.show_legend ? renderLegend() : '')
    + `<div class="foot"><span>${esc(sourceLine(payload))}</span>`
    + warnings.map((w) => `<span class="warn">${esc(w)}</span>`).join('')
    + '</div></div></ha-card>';
}

// Every size is multiplied by --mk-s (option `scale`, 1 by default).
const STYLE = `
:host { display: block; }
.mk {
  --s: var(--mk-s, 1);
  padding: 16px;
  color: var(--primary-text-color, #212121);
  font-family: var(--ha-font-family-body, inherit);
  --mdc-icon-size: calc(21px * var(--s));
}
[data-k="vert"] { --mk-c: var(--mk-vert, ${PALETTE.vert}); }
[data-k="orange"] { --mk-c: var(--mk-orange, ${PALETTE.orange}); }
[data-k="rouge"] { --mk-c: var(--mk-rouge, ${PALETTE.rouge}); }
[data-k="bleu"] { --mk-c: var(--mk-bleu, ${PALETTE.bleu}); }
.fill, .pill { background: var(--mk-c); color: var(--mk-ink, ${PALETTE.ink}); }
[data-k="none"] .fill, .pill[data-k="none"] {
  background: repeating-linear-gradient(135deg, var(--divider-color, rgba(0,0,0,.12)) 0 4px, transparent 4px 8px);
  color: var(--secondary-text-color, #727272);
  box-shadow: inset 0 0 0 1px var(--divider-color, rgba(0,0,0,.12));
}
.heading { font-size: calc(.98rem * var(--s)); color: var(--secondary-text-color, #727272); margin-bottom: 6px; }
.state { display: flex; align-items: center; gap: 10px; }
.title { font-size: calc(1.55rem * var(--s)); font-weight: 600; line-height: 1.2; }
.pill { display: inline-flex; align-items: center; justify-content: center; flex: none;
  width: calc(28px * var(--s)); height: calc(28px * var(--s)); border-radius: 50%; }
.pill.big { width: calc(37px * var(--s)); height: calc(37px * var(--s)); --mdc-icon-size: calc(23px * var(--s)); }
.phrase { margin: 6px 0 14px; color: var(--secondary-text-color, #727272); font-size: calc(1.09rem * var(--s)); line-height: 1.35; }
.timeline { position: relative; margin-bottom: 16px; }
.above, .ticks { position: relative; height: 1.5em; font-size: calc(.86rem * var(--s));
  color: var(--secondary-text-color, #727272); white-space: nowrap; }
.ticks { margin-top: 4px; }
.now { position: absolute; left: 0; font-weight: 600; color: var(--primary-text-color, #212121); }
.now::before { content: "▾ "; }
/* Labels centred on their exact time, never shifted: hidden when they do not fit. */
.dayname, .tick { position: absolute; transform: translateX(-50%); }
.dayname { font-weight: 600; }
.hidden { visibility: hidden; }
.bar { position: relative; display: flex; height: calc(41px * var(--s)); }
/* Block widths exactly proportional to their hours; the 2 px gap is inside. */
.block { min-width: 0; }
.fill { height: 100%; margin: 0 1px; border-radius: 8px; display: flex; align-items: center; justify-content: center; overflow: hidden; }
.block:first-child .fill { margin-left: 0; }
.block:last-child .fill { margin-right: 0; }
.midnight { position: absolute; top: -5px; bottom: -5px; width: 2px; margin-left: -1px;
  background: var(--primary-text-color, #212121); opacity: .55; border-radius: 1px; }
.days { list-style: none; margin: 0 0 12px; padding: 0; display: grid; gap: 6px;
  grid-template-columns: repeat(auto-fit, minmax(calc(92px * var(--s)), 1fr)); }
.day { display: flex; flex-direction: column; gap: 3px; padding: 6px; border-radius: 10px;
  border: 1px solid var(--divider-color, rgba(0,0,0,.12)); min-width: 0; }
.day.today { border: 2px solid var(--primary-color, #03a9f4); padding: 5px; }
.dname { font-weight: 600; font-size: calc(.86rem * var(--s)); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dsignal { display: flex; align-items: center; gap: 4px; font-size: calc(.92rem * var(--s)); line-height: 1.2;
  --mdc-icon-size: calc(16px * var(--s)); }
.dsignal .pill { width: calc(23px * var(--s)); height: calc(23px * var(--s)); }
.dlabel { min-width: 0; }
.ddetail { font-size: calc(.8rem * var(--s)); line-height: 1.25; color: var(--secondary-text-color, #727272); }
.legend { list-style: none; margin: 0 0 12px; padding: 0; display: grid; gap: 6px; font-size: calc(.92rem * var(--s)); }
.legend li { display: flex; align-items: center; gap: 8px; }
.foot { display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: calc(.86rem * var(--s)); color: var(--secondary-text-color, #727272); }
.warn { color: var(--warning-color, #b45309); font-weight: 600; }
/* Text and icon, never colour alone; theme's warning colour as an accent only. */
.cyclone { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; padding: 8px 10px;
  border-radius: 10px; border: 2px solid var(--warning-color, #b45309);
  font-size: calc(1.02rem * var(--s)); line-height: 1.3; --mdc-icon-size: calc(24px * var(--s)); }
.cyclone ha-icon { flex: none; color: var(--warning-color, #b45309); }
.message { margin: 8px 0 0; line-height: 1.4; font-size: calc(1.05rem * var(--s)); }
code { font-size: .85em; }
@media (prefers-reduced-motion: no-preference) {
  .fill, .pill { transition: background-color .3s ease; }
}
`;

// ------------------------------------------------------------- element ----

const Base = globalThis.HTMLElement ?? class {};

export class MeteoKouranCard extends Base {
  constructor() {
    super();
    this._config = null;
    this._hass = null;
    this._payload = null;
    this._lastOk = null;
    this._error = null;
    this._request = null;
    this._fetchedUrl = undefined;
    this._renderedHour = null;
    this._timers = {};
    this._frame = null;
    this._onFonts = () => this._scheduleFit();
    this._onVisibility = () => {
      if (globalThis.document?.visibilityState === 'visible') this._shown();
    };
  }

  static getStubConfig() {
    return { url_entity: DEFAULT_ENTITY, hours: 24, days: 5, show_legend: false };
  }

  setConfig(config) {
    this._config = normalizeConfig(config);
    this._fetchedUrl = undefined;
    if (this.isConnected) {
      this._render();
      this._load();
    }
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._config || !this.isConnected) return;
    // HA sets `hass` on every state change: cheap checks only.
    if (resolveUrl(this._config, hass) !== this._fetchedUrl) {
      this._load();
    } else if (hourStart(Date.now()) !== this._renderedHour) {
      // Timers can be late (sleeping phone): catch up on the hour here too.
      this._render();
      this._load();
    }
  }

  /** Back on screen (tab or app in the foreground again): catch up on the hour, or refit the labels. */
  _shown() {
    if (!this._config || !this.isConnected) return;
    if (hourStart(Date.now()) !== this._renderedHour) {
      this._render();
      this._load();
    } else {
      this._scheduleFit();
    }
  }

  getCardSize() {
    const c = this._config ?? normalizeConfig({});
    return Math.ceil((4 + (c.days > 0 ? 2 : 0) + (c.show_legend ? 2 : 0)) * c.scale);
  }

  connectedCallback() {
    if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
    // Which labels fit depends on the card's width, on the font, and needs a
    // laid-out card: refit on resize, once fonts are loaded, and when the card
    // becomes visible again (none of these is a resize).
    if (globalThis.ResizeObserver) {
      this._resize = new ResizeObserver(() => this._scheduleFit());
      this._resize.observe(this);
    }
    if (globalThis.IntersectionObserver) {
      this._visible = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) this._scheduleFit();
      });
      this._visible.observe(this);
    }
    const doc = globalThis.document;
    doc?.fonts?.addEventListener?.('loadingdone', this._onFonts);
    doc?.fonts?.ready?.then(this._onFonts);
    doc?.addEventListener?.('visibilitychange', this._onVisibility);
    this._timers.refresh = setInterval(() => this._load(), REFRESH_MS);
    this._scheduleHour();
    this._render();
    this._load();
  }

  disconnectedCallback() {
    this._resize?.disconnect();
    this._resize = null;
    this._visible?.disconnect();
    this._visible = null;
    globalThis.document?.fonts?.removeEventListener?.('loadingdone', this._onFonts);
    globalThis.document?.removeEventListener?.('visibilitychange', this._onVisibility);
    if (this._frame !== null) cancelAnimationFrame(this._frame);
    this._frame = null;
    clearInterval(this._timers.refresh);
    clearTimeout(this._timers.hour);
    clearTimeout(this._timers.retry);
    this._timers = {};
    if (this._request) this._request.abort();
    this._request = null;
  }

  _scheduleHour() {
    const now = Date.now();
    this._timers.hour = setTimeout(() => {
      this._render();
      this._load();
      this._scheduleHour();
    }, hourStart(now) + HOUR - now + 2000);
  }

  async _load() {
    if (!this._config || !this.isConnected || this._request) return;
    const url = resolveUrl(this._config, this._hass);
    this._fetchedUrl = url;
    if (!url) {
      this._render();
      return;
    }
    clearTimeout(this._timers.retry);
    const request = new AbortController();
    this._request = request;
    const timeout = setTimeout(() => request.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(`${url}/api/v1/forecast`, {
        signal: request.signal,
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (!Array.isArray(payload?.data?.days)) throw new Error('Réponse inattendue');
      this._payload = payload;
      this._lastOk = Date.now();
      this._error = null;
    } catch (error) {
      if (!this.isConnected) return; // unmounted: request cancelled on purpose
      this._error = error;
      this._timers.retry = setTimeout(() => this._load(), RETRY_MS);
    } finally {
      clearTimeout(timeout);
      if (this._request === request) this._request = null;
    }
    this._render();
  }

  _render() {
    if (!this.shadowRoot || !this._config) return;
    const nowMs = Date.now();
    this._renderedHour = hourStart(nowMs);
    this.shadowRoot.innerHTML = `<style>${STYLE}</style>${renderCard({
      config: this._config,
      payload: this._payload,
      nowMs,
      url: resolveUrl(this._config, this._hass),
      lastOk: this._lastOk,
      error: this._error,
    })}`;
    this._scheduleFit();
  }

  /**
   * Fits the labels now, and again at the next frame: HA's ha-card (a Lit
   * element) renders its <slot> a microtask after the card's innerHTML, so the
   * new labels may not be laid out yet, and the card keeping its size, no
   * ResizeObserver call would follow.
   */
  _scheduleFit() {
    this._fitLabels();
    if (!globalThis.requestAnimationFrame || this._frame !== null) return;
    this._frame = requestAnimationFrame(() => {
      this._frame = null;
      this._fitLabels();
    });
  }

  /** Hides the timeline labels that do not fit at the current width (they are never moved). */
  _fitLabels() {
    const root = this.shadowRoot;
    if (!root?.querySelector) return;
    const box = (el, origin) => {
      const r = el.getBoundingClientRect();
      return { left: r.left - origin, right: r.right - origin, every: Number(el.dataset.every) };
    };
    for (const row of root.querySelectorAll('.above, .ticks')) {
      const frame = row.getBoundingClientRect();
      if (!frame.width) continue; // not laid out yet (hidden, ha-card not rendered): refit later
      const items = [...row.querySelectorAll('.tick, .dayname')];
      const now = row.querySelector('.now');
      // Slack: a label may run 8 px into the card's 16 px padding.
      const shown = fitLabels(items.map((el) => box(el, frame.left)), frame.width, 4, now ? [box(now, frame.left)] : [], 8);
      items.forEach((el, i) => el.classList.toggle('hidden', !shown[i]));
    }
  }
}

if (globalThis.customElements && !customElements.get('meteokouran-card')) {
  customElements.define('meteokouran-card', MeteoKouranCard);
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: 'meteokouran-card',
    name: 'MétéoKouran',
    description: "Météo de l'électricité à La Réunion : frise depuis maintenant et jours à venir (source : EDF).",
    preview: false,
  });
  console.info(`%c MÉTÉOKOURAN-CARD %c ${VERSION} `, 'background:#46bf7e;color:#15191f', '');
}
