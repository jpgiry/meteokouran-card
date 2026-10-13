# MétéoKouran — carte Home Assistant

Une carte de tableau de bord pour Home Assistant qui affiche la **« météo de l'électricité » de La Réunion** publiée par EDF : l'état du réseau maintenant, une phrase qui résume la suite (« Optimal jusqu'à 17:00, puis contraint jusqu'à 18:00 »), une frise des prochaines heures qui part de maintenant et les jours J à J+4.

[![Ouvrir votre Home Assistant et ajouter ce dépôt dans HACS.](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=jpgiry&repository=meteokouran-card&category=plugin)

| Thème clair, légende affichée | Thème sombre |
|---|---|
| ![Carte MétéoKouran en thème clair : réseau optimal, contraint à 17 h, heures de pointe le soir, légende des quatre signaux](https://raw.githubusercontent.com/jpgiry/meteokouran-card/main/images/carte-claire-legende.png) | ![Carte MétéoKouran en thème sombre : réseau optimal sur les cinq prochains jours](https://raw.githubusercontent.com/jpgiry/meteokouran-card/main/images/carte-sombre.png) |

Quatre signaux, chacun avec son libellé et son pictogramme (jamais la couleur seule) :

| Signal | Signification |
|---|---|
| **Optimal** (vert) | aucune contrainte sur le réseau |
| **Contraint** (orange) | décalez les gros appareils si possible |
| **Très contraint** (rouge) | réduisez votre consommation au maximum |
| **Heures de pointe** (bleu) | pic de demande du soir, différez les gros appareils |

## Ce qu'il faut avant d'installer
La carte ne lit pas EDF directement : elle interroge une **instance MétéoKouran** (`GET /api/v1/forecast`), le service qui collecte et archive ces données. L'instance publique `https://meteokouran.cabesterre.fr` ouvrira avec la mise en production de MétéoKouran ; d'ici là, la carte affiche « Impossible de joindre MétéoKouran ».

## Installation avec HACS (recommandé)
1. Cliquer sur le bouton **« Open your Home Assistant instance »** ci-dessus : il ouvre HACS dans votre Home Assistant avec ce dépôt prérempli.
   Sans le bouton : HACS → ⋮ (en haut à droite) → **Dépôts personnalisés** → dépôt `https://github.com/jpgiry/meteokouran-card`, type **Dashboard** → Ajouter.
2. Ouvrir « MétéoKouran » dans HACS → **Télécharger**.
3. Recharger la page du navigateur (et fermer puis rouvrir l'application mobile).

HACS déclare lui-même la ressource du tableau de bord et propose les mises à jour : rien à copier à la main.

**Vous aviez installé la carte à la main ?** Après l'installation par HACS, supprimer l'ancienne ressource (Paramètres → Tableaux de bord → ⋮ → Ressources, l'adresse qui commence par `/local/`) et l'ancien fichier `meteokouran-card.js` du dossier `www`, sinon la carte est chargée deux fois.

## Configuration
Modifier le tableau de bord → Ajouter une carte → « MétéoKouran », ou carte « Manuel » :

```yaml
type: custom:meteokouran-card
url: https://meteokouran.cabesterre.fr   # exemple : adresse de votre instance MétéoKouran
```

| Option | Valeurs | Défaut | Rôle |
|---|---|---|---|
| `url` | adresse, sans `/api/v1` | — | adresse de l'instance MétéoKouran ; l'emporte sur `url_entity` |
| `url_entity` | identifiant d'entité | `input_text.meteokouran_url` | entité dont l'état contient l'adresse de l'instance (utile pour la partager entre plusieurs cartes) |
| `hours` | entier de 6 à 48 | `24` | longueur de la frise, en heures |
| `days` | entier de 1 à 5 | `5` | nombre de vignettes de jours |
| `show_legend` | `true` / `false` | `false` | légende des quatre signaux sous la carte |
| `title` | texte | aucun | titre au-dessus de la carte |
| `scale` | nombre de 0.8 à 1.5 | `1` | taille des textes, pictogrammes et de la frise |

Exemple complet :

```yaml
type: custom:meteokouran-card
url: https://meteokouran.cabesterre.fr   # exemple
hours: 12
days: 5
show_legend: true
title: Météo de l'électricité
scale: 1.2
```

- Les heures sont toujours celles de **La Réunion**, quel que soit le fuseau du téléphone ou du navigateur.
- La carte se met à jour toutes les 15 minutes et à chaque changement d'heure.
- Couleurs modifiables par un thème : `--mk-vert`, `--mk-orange`, `--mk-rouge`, `--mk-bleu`, et `--mk-ink` pour le texte posé sur ces couleurs (garder un contraste d'au moins 4,5:1).

## Messages
| Affichage | Signification |
|---|---|
| « ⚠️ Données non actualisées depuis HH:MM » | l'instance n'a pas répondu au dernier essai ; la carte garde la dernière réponse et réessaie dans 2 minutes |
| « ⚠️ Données anciennes » | l'instance n'a pas pu lire les données d'EDF depuis plus de 26 heures |
| « Impossible de joindre MétéoKouran » | aucune réponse depuis l'ouverture de la page |
| « Adresse de MétéoKouran inconnue » | ni `url` ni `url_entity` ne donnent d'adresse |
| Heures hachurées, « Prévision à venir » | EDF n'a pas encore publié ces heures ou ces jours |

## Source des données et licences
- **Données** : EDF Réunion, jeu « Météo de l’électricité - Réunion » du portail https://opendata-reunion.edf.fr, sous **Licence Ouverte Etalab 2.0**. Le pied de la carte affiche toujours « Source : EDF » et la date de mise à jour des données par EDF, comme l'exige cette licence : ne pas le masquer.
- MétéoKouran est un projet indépendant, **sans lien avec EDF**. La carte n'utilise ni le logo ni les visuels de l'application EDF : palette, pictogrammes (Material Design Icons) et textes lui sont propres.
- **Code de la carte** : licence MIT (fichier `LICENSE`).
