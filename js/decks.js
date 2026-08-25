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

// -----------------------------------------------------------------
// Construit la liste des cartes d'un deck à partir d'une composition
// { idCarte: quantité }. Chaque type de carte pointe vers son propre
// JPG placeholder (assets/cards/<id>.jpg) — pas encore d'attributs de
// jeu (attaque/défense/effet/etc.), juste l'illustration et le nom
// pour l'instant. Les attributs viendront dans une prochaine passe.
// -----------------------------------------------------------------
function buildDeckCards(prefix, composition) {
  const cards = [];
  Object.entries(composition).forEach(([cardId, count]) => {
    for (let i = 0; i < count; i++) {
      cards.push({
        id: `${prefix}-${cardId}-${i + 1}`,
        name: CARD_NAMES[cardId] || cardId,
        image: `assets/cards/${cardId}.jpg`
      });
    }
  });
  return cards;
}

// Noms d'affichage des types de cartes existants (sans attributs pour
// l'instant — juste de quoi afficher un nom lisible sur la carte).
const CARD_NAMES = {
  fleur: "Fleur",
  arrosoir: "Arrosoir",
  pot: "Pot",
  bouquet: "Bouquet"
};

// Identifiant STABLE du deck offert automatiquement à chaque joueur
// dès la création de son compte (voir js/auth.js -> ensureUserProfile).
// Ne pas changer cet id une fois en prod : il est écrit dans le
// tableau `decks` de tous les documents Firestore existants.
export const STARTER_DECK_ID = "deck-starter";

export const DECK_CATALOG = [
  {
    id: STARTER_DECK_ID,
    name: "Deck de Départ",
    cost: 0,
    starter: true, // offert d'office, jamais en vente dans la boutique
    image: "assets/decks/deck-starter.png",
    tagline: "Offert automatiquement à chaque nouveau compte.",
    cards: buildDeckCards("starter", { tour: 3, vengeur: 2, slime: 3, bourrin: 1, protecteur: 1 })
  },
  {
    id: "deck-fleur",
    name: "Deck Fleur",
    cost: 10,
    image: "assets/decks/deck-fleur.png",
    tagline: "Un deck vif et fragile, misant sur la croissance rapide.",
    cards: buildDeckCards("fleur", { fleur: 5, arrosoir: 1, pot: 2, bouquet: 2 })
  },
  {
    id: "deck-golem",
    name: "Deck Golem",
    cost: 10,
    image: "assets/decks/deck-golem.png",
    tagline: "Des cartes lentes et robustes, taillées pour encaisser.",
    cards: buildDeckCards("golem", { caillou: 6, rocher: 3, golem: 1 })
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

