// =====================================================================
// TOP DECK! — Catalogue des cartes
// =====================================================================
// Un seul endroit où définir chaque TYPE de carte du jeu. C'est ici
// qu'on modifie le nom, la rareté, l'attaque et la défense d'une
// carte — les decks (js/decks.js) piochent dans ce catalogue pour
// construire leurs 10 cartes, ils n'ont pas à connaître ces valeurs.
//
// `id`      : identifiant STABLE de la carte (utilisé dans les decks
//              et plus tard dans les parties/Firestore). Ne pas
//              changer un id existant une fois en prod.
// `name`    : nom affiché de la carte.
// `rarity`  : une des valeurs de CARD_RARITY ci-dessous.
// `attack`  : valeur d'attaque (nombre).
// `defense` : valeur de défense (nombre).
// `image`   : chemin vers le JPG de la carte, dans assets/cards/.
//
// Les effets de carte ne sont pas encore gérés — ils viendront dans
// une prochaine passe (probablement un champ `effect` par carte).
//
// Pour ajouter une nouvelle carte : ajoute une entrée dans
// CARD_CATALOG avec un nouvel id, dépose son JPG dans assets/cards/,
// puis utilise son id dans la composition d'un deck (js/decks.js).
// =====================================================================

export const CARD_RARITY = {
  COMMON: "commun",
  RARE: "rare",
  LEGENDARY: "legendaire"
};

export const CARD_CATALOG = {
  fleur: {
    id: "fleur",
    name: "Fleur",
    rarity: CARD_RARITY.COMMON,
    attack: 0,
    defense: 1,
    image: "assets/cards/fleur.jpg"
  },
  arrosoir: {
    id: "arrosoir",
    name: "Arrosoir",
    rarity: CARD_RARITY.RARE,
    attack: 0,
    defense: 3,
    image: "assets/cards/arrosoir.jpg"
  },
  pot: {
    id: "pot",
    name: "Pot",
    rarity: CARD_RARITY.RARE,
    attack: 0,
    defense: 2,
    image: "assets/cards/pot.jpg"
  },
  bouquet: {
    id: "bouquet",
    name: "Bouquet",
    rarity: CARD_RARITY.RARE,
    attack: 0,
    defense: 2,
    image: "assets/cards/bouquet.jpg"
  },
  caillou: {
    id: "caillou",
    name: "Caillou",
    rarity: CARD_RARITY.COMMON,
    attack: 1,
    defense: 1,
    image: "assets/cards/caillou.jpg"
  },
  rocher: {
    id: "rocher",
    name: "Rocher",
    rarity: CARD_RARITY.RARE,
    attack: 2,
    defense: 3,
    image: "assets/cards/rocher.jpg"
  },
  golem: {
    id: "golem",
    name: "Golem",
    rarity: CARD_RARITY.LEGENDARY,
    attack: 3,
    defense: 4,
    image: "assets/cards/golem.jpg"
  },
  tour: {
    id: "tour",
    name: "Tour",
    rarity: CARD_RARITY.COMMON,
    attack: 0,
    defense: 2,
    image: "assets/cards/tour.jpg"
  },
  vengeur: {
    id: "vengeur",
    name: "Vengeur",
    rarity: CARD_RARITY.RARE,
    attack: 1,
    defense: 1,
    image: "assets/cards/vengeur.jpg"
  },
  bourrin: {
    id: "bourrin",
    name: "Bourrin",
    rarity: CARD_RARITY.RARE,
    attack: 3,
    defense: 1,
    image: "assets/cards/bourrin.jpg"
  },
  protecteur: {
    id: "protecteur",
    name: "Protecteur",
    rarity: CARD_RARITY.RARE,
    attack: 1,
    defense: 3,
    image: "assets/cards/protecteur.jpg"
  },
  slime: {
    id: "slime",
    name: "Slime",
    rarity: CARD_RARITY.RARE,
    attack: 2,
    defense: 2,
    image: "assets/cards/slime.jpg"
  },
  chevalier: {
    id: "chevalier",
    name: "Chevalier",
    rarity: CARD_RARITY.LEGENDARY,
    attack: 4,
    defense: 4,
    image: "assets/cards/chevalier.jpg"
  }
};
