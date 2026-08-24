// =====================================================================
// TOP DECK! — Catalogue des decks de départ (boutique)
// =====================================================================
// Chaque deck est identifié par un `id` STABLE : c'est cette chaîne
// qui est stockée dans le tableau `decks` du document Firestore
// `users/{uid}` une fois le deck acheté. Ne change jamais un `id`
// existant une fois des joueurs en possession, sinon leur achat
// "disparaît" (il faudrait migrer les documents Firestore).
//
// `image` : PNG placeholder pour l'instant (assets/decks/*.png),
// à remplacer plus tard par la vraie illustration du deck — il
// suffit de remplacer le fichier PNG, aucun code à changer.
//
// Pour ajouter un futur deck en boutique : ajoute simplement une
// entrée ici avec un nouvel `id` unique.
export const DECK_CATALOG = [
  {
    id: "deck-fleur",
    name: "Deck Fleur",
    cost: 10,
    image: "assets/decks/deck-fleur.png",
    tagline: "Un deck vif et fragile, misant sur la croissance rapide."
  },
  {
    id: "deck-golem",
    name: "Deck Golem",
    cost: 10,
    image: "assets/decks/deck-golem.png",
    tagline: "Des cartes lentes et robustes, taillées pour encaisser."
  },
  {
    id: "deck-ferme",
    name: "Deck Ferme",
    cost: 10,
    image: "assets/decks/deck-ferme.png",
    tagline: "Un deck d'accumulation, patient et régulier."
  }
];
