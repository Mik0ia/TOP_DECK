// =====================================================================
// TOP DECK! — Moteur de clash (fonctions PURES, zéro dépendance)
// =====================================================================
// Règles (brief §4.1) :
//  - chaque tour, chaque joueur joue la carte du dessus de son deck ;
//  - clash : si ATK(A) >= DEF(B), A tue B ; si ATK(B) >= DEF(A), B tue A.
//    Les deux tests sont INDÉPENDANTS (deux `if`, jamais de `else`) :
//    double kill possible, aucun kill possible (piège §8.3) ;
//  - "ou égal" : ATK == DEF => kill ;
//  - chaque kill rapporte +1 point au tueur ;
//  - toutes les cartes jouées vont à la défausse, tuées ou non.
//
// Une carte = { attack: number, defense: number } (les champs existants
// de js/cards.js — décision D2 dans DECISIONS.md).
// =====================================================================

/**
 * Résout un clash entre la carte de A et la carte de B.
 * @returns {{ aKillsB: boolean, bKillsA: boolean, pointsA: number, pointsB: number }}
 */
export function resolveClash(cardA, cardB) {
  // Deux tests INDÉPENDANTS — surtout pas de else (piège §8.3).
  const aKillsB = cardA.attack >= cardB.defense;
  const bKillsA = cardB.attack >= cardA.defense;
  return {
    aKillsB,
    bKillsA,
    pointsA: aKillsB ? 1 : 0,
    pointsB: bKillsA ? 1 : 0
  };
}
