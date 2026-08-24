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
// `cards` : les 10 cartes qui composent le deck, affichées quand on
// clique sur le deck dans la boutique. Pour l'instant elles pointent
// toutes vers le même PNG générique (assets/cards/placeholder-card.png)
// en attendant les vraies illustrations — remplace `image` par carte
// une fois le design final prêt (chaque entrée peut avoir son propre
// fichier).
//
// Pour ajouter un futur deck en boutique : ajoute simplement une
// entrée ici avec un nouvel `id` unique.
const PLACEHOLDER_CARD = "assets/cards/placeholder-card.png";

function placeholderDeckCards(prefix) {
  return Array.from({ length: 10 }, (_, i) => ({
    id: `${prefix}-carte-${i + 1}`,
    name: `Carte ${i + 1}`,
    image: PLACEHOLDER_CARD
  }));
}

export const DECK_CATALOG = [
  {
    id: "deck-fleur",
    name: "Deck Fleur",
    cost: 10,
    image: "assets/decks/deck-fleur.png",
    tagline: "Un deck vif et fragile, misant sur la croissance rapide.",
    cards: placeholderDeckCards("fleur")
  },
  {
    id: "deck-golem",
    name: "Deck Golem",
    cost: 10,
    image: "assets/decks/deck-golem.png",
    tagline: "Des cartes lentes et robustes, taillées pour encaisser.",
    cards: placeholderDeckCards("golem")
  },
  {
    id: "deck-ferme",
    name: "Deck Ferme",
    cost: 10,
    image: "assets/decks/deck-ferme.png",
    tagline: "Un deck d'accumulation, patient et régulier.",
    cards: placeholderDeckCards("ferme")
  }
];

// -----------------------------------------------------------------
// "Cartes du moment" : mise en avant de cartes individuelles dans la
// boutique. Purement visuel pour l'instant (pas de vente à l'unité
// tant que le système de cartes/jeu n'existe pas) — de simples
// placeholders en attendant la vraie logique et les vraies
// illustrations.
// -----------------------------------------------------------------
export const FEATURED_CARDS = Array.from({ length: 4 }, (_, i) => ({
  id: `featured-${i + 1}`,
  name: `Carte à venir ${i + 1}`,
  image: PLACEHOLDER_CARD
}));

