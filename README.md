# MétéoKouran — carte Home Assistant (déplacée)

> **Ce dépôt n'est plus mis à jour.** La carte est maintenant fournie avec l'**intégration MétéoKouran**, qui ajoute aussi les entités (signal de l'heure, de demain, heures de pointe, cyclone signalé par EDF) : **[jpgiry/meteokouran-ha](https://github.com/jpgiry/meteokouran-ha)**.

[![Ouvrir votre Home Assistant et ajouter l'intégration MétéoKouran dans HACS.](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=jpgiry&repository=meteokouran-ha&category=integration)

## Passer à l'intégration
1. Installer l'intégration avec le bouton ci-dessus (HACS → Télécharger), redémarrer Home Assistant, puis Paramètres → Appareils et services → Ajouter une intégration → « MétéoKouran ».
2. Dans HACS, **supprimer** cette carte (« MétéoKouran », type Dashboard) ; vérifier qu'il ne reste pas sa ressource (Paramètres → Tableaux de bord → ⋮ → Ressources, adresse contenant `meteokouran-card.js`).
3. Vos cartes `type: custom:meteokouran-card` restent telles quelles : sans `url`, elles prennent l'adresse configurée dans l'intégration. Toutes les options (`url`, `url_entity`, `hours`, `days`, `show_legend`, `title`, `scale`) sont gardées.

Vous utilisiez aussi le paquet YAML ? La procédure complète (mêmes identifiants d'entités, sans suffixe `_2`) est dans le README de [meteokouran-ha](https://github.com/jpgiry/meteokouran-ha).

La dernière version publiée ici (1.2.0) reste téléchargeable, mais ne recevra plus de correctif.

## Source des données et licences
- **Données** : EDF Réunion, jeu « Météo de l’électricité - Réunion » du portail https://opendata-reunion.edf.fr, sous **Licence Ouverte Etalab 2.0** (« Source : EDF » et date de mise à jour affichées par la carte).
- MétéoKouran est un projet indépendant, **sans lien avec EDF**. La carte n'utilise ni le logo ni les visuels de l'application EDF.
- **Code de la carte** : licence MIT (fichier `LICENSE`).
