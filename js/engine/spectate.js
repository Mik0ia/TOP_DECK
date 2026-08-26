// =====================================================================
// TOP DECK! — Projection spectateur (fonction PURE, brief §4.3.8 / §9.4)
// =====================================================================
// Un spectateur voit exactement ce qu'un joueur verrait de l'EXTÉRIEUR :
// jamais une carte face cachée. Cette fonction est LA seule source de
// données de la vue spectate (js/game.js) : tout ce qu'elle ne renvoie
// pas n'est pas affiché.
//
// Elle reçoit le document Firestore d'un match (qui contient les decks
// complets, nécessaires au calcul du clash côté clients — voir
// DECISIONS.md D1/D4) et n'en laisse passer que :
//  - l'état public (mode, tour, points, PV, tailles de decks/défausse),
//  - le DERNIER clash révélé (les deux cartes étaient face visible),
//  - les drapeaux "a joué / n'a pas joué" du tour en cours — jamais la
//    valeur des cartes en attente,
//  - le chi-fou-mi : uniquement les coups d'un tour DÉJÀ résolu.
// =====================================================================

export function spectatorView(match) {
  if (!match) return null;
  return {
    id: match.id ?? null,
    round: match.round ?? null,
    isFinal: !!match.isFinal,
    mode: match.mode ?? null,
    status: match.status ?? null,
    a: match.a ?? null,
    b: match.b ?? null,
    turn: match.turn ?? 0,
    points: match.points ?? { a: 0, b: 0 },
    hp: match.hp ?? null,
    cardsLeft: match.cardsLeft ?? null,
    discard: match.discard ?? null,
    // Cartes en attente : seulement le FAIT d'avoir joué ({played:true},
    // piège §8.1) — jamais la carte elle-même.
    aPlayedThisTurn: (match.aPlayed ?? 0) > (match.turn ?? 0),
    bPlayedThisTurn: (match.bPlayed ?? 0) > (match.turn ?? 0),
    // Dernier clash : révélé simultanément aux deux joueurs, donc public.
    lastClash: match.lastClash ?? null,
    // Chi-fou-mi : uniquement le résultat d'un tour terminé.
    rpsLastResult: match.rpsLastResult ?? null,
    winner: match.winner ?? null,
    endReason: match.endReason ?? null
  };
}
