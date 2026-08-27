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
// `effect`  : (optionnel) effets de la carte, écrits dans le mini-langage
//              documenté dans js/engine/effect-parser.js. Déclencheurs :
//                on_play  -> quand la carte est jouée
//                on_death -> quand elle meurt
//                on_seen  -> quand elle est regardée par un effet
//
//              Effets : scry(x) mill_own(x) mill_opp(x) organize_own(x)
//                       organize_opp(x) search(x) go_bottom gain(x/y)
//                       look_top look_bot
//
//              Conditions : `if <test> : <effet>` (avec `else :`),
//              combinables par `and`/`or`, et `{ … }` pour plusieurs
//              effets. Variables lisibles :
//                card.*  la dernière carte regardée
//                self.*  la carte qui porte l'effet
//                opp.*   la carte jouée par l'adversaire
//                attributs : id, name, rarity, attack, defense, effect
//                my.deck_size, their.deck_size, my.discard_size…
//
//              Exemple :
//                effect: {
//                  on_play: 'look_top if card.name == "caillou" : gain(1/1)'
//                }
//
//              ⚠️ Après modification, lance `npm run cards` : les fautes
//              de syntaxe sont signalées tout de suite, pas en pleine partie.
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
    // Le Bouquet fane vite et accélère la pioche.
    effect: {
      on_play: "mill_own(1)"
    },
    image: "assets/cards/bouquet.jpg"
  },
  caillou: {
    id: "caillou",
    name: "Caillou",
    rarity: CARD_RARITY.COMMON,
    attack: 1,
    defense: 1,
    // Les cailloux s'encouragent : s'il voit un autre Caillou sur son
    // deck, il gagne +1/+1. (C'est l'exemple du cahier des charges.)
    effect: {
      on_play: 'look_top if card.name == "caillou" : gain(1/1)'
    },
    image: "assets/cards/caillou.jpg"
  },
  rocher: {
    id: "rocher",
    name: "Rocher",
    rarity: CARD_RARITY.RARE,
    attack: 2,
    defense: 3,
    // Un rocher ne se jette pas : en mourant il roule sous le deck.
    effect: {
      on_death: "go_bottom"
    },
    image: "assets/cards/rocher.jpg"
  },
  golem: {
    id: "golem",
    name: "Golem",
    rarity: CARD_RARITY.LEGENDARY,
    attack: 3,
    defense: 4,
    // Le Golem écrase le deck adverse, davantage face à plus faible.
    effect: {
      on_play: "mill_opp(2); if opp.attack < self.attack : mill_opp(1)"
    },
    image: "assets/cards/golem.jpg"
  },
  tour: {
    id: "tour",
    name: "Tour",
    rarity: CARD_RARITY.COMMON,
    attack: 0,
    defense: 2,
    // La Tour surveille : elle réorganise les 2 cartes du dessus.
    effect: {
      on_play: "organize_own(2)"
    },
    image: "assets/cards/tour.jpg"
  },
  vengeur: {
    id: "vengeur",
    name: "Vengeur",
    rarity: CARD_RARITY.RARE,
    attack: 1,
    defense: 1,
    // Le Vengeur emporte une carte adverse dans sa chute.
    effect: {
      on_death: "mill_opp(1)"
    },
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
    // Le Protecteur trie le dessus de son deck.
    effect: {
      on_play: "scry(2)"
    },
    image: "assets/cards/protecteur.jpg"
  },
  slime: {
    id: "slime",
    name: "Slime",
    rarity: CARD_RARITY.RARE,
    attack: 2,
    defense: 2,
    // Le Slime grossit quand on l'observe.
    effect: {
      on_seen: "gain(0/1)"
    },
    image: "assets/cards/slime.jpg"
  },
  chevalier: {
    id: "chevalier",
    name: "Chevalier",
    rarity: CARD_RARITY.LEGENDARY,
    attack: 4,
    defense: 4,
    // Le Chevalier cherche son arme dans tout son deck.
    effect: {
      on_play: "search(1)"
    },
    image: "assets/cards/chevalier.jpg"
  }
};
