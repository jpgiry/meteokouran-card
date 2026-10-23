# Journal des versions

Chaque version publiée a sa section `## X.Y.Z` : c'est elle qui sert de notes à la release GitHub.

## 1.2.0

- Bandeau en tête de carte quand EDF signale un cyclone en cours pour l'heure actuelle (champ `cyclone_en_cours` des données EDF) : « EDF signale un cyclone en cours », avec l'heure de début quand elle est connue. Rien ne s'affiche sinon, ni avec une instance MétéoKouran plus ancienne qui ne fournit pas ce champ.
- Bandeau « Cyclone annoncé par EDF à partir de … » quand EDF signale déjà une heure à venir (jusqu'à J+4) sans que l'heure actuelle le soit, par exemple la veille au soir. Le bandeau « en cours » le remplace dès la première heure signalée ; les signaux restent affichés tels qu'EDF les publie.

## 1.1.1

- Frise : le nom du jour posé à minuit (« Demain ») ne chevauche plus « ▾ Maintenant » le soir. Il est masqué s'il en est à moins de 8 px ; le trait de minuit reste toujours affiché.
- Graduations recalculées après chaque actualisation des données, au chargement de la police, au retour de la carte à l'écran et au changement d'heure (avant : seulement au premier affichage et quand la largeur changeait).

## 1.1.0

Première version publiée sur HACS.

- État du réseau maintenant, phrase qui résume la suite (« Optimal jusqu'à 17:00, puis contraint jusqu'à 18:00 »), frise des prochaines heures à partir de maintenant et jours J à J+4.
- Calculs à l'heure de La Réunion, quel que soit le fuseau du navigateur.
- Texte plus grand, option `scale` pour agrandir ou réduire la carte.
- Graduations de la frise placées à leur heure exacte, masquées (jamais décalées) quand elles ne tiennent pas.
- Chaque signal porte son libellé et son pictogramme : jamais la couleur seule.
- Source EDF et date de mise à jour des données affichées sous la carte.
