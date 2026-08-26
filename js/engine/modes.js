// =====================================================================
// TOP DECK! — Modes de jeu & règles de fin de match (fonctions PURES)
// =====================================================================
// Brief §4.2 :
//
// | Mode   | Fin                                  | Vainqueur                        |
// | SURVIE | un joueur ne peut plus piocher       | le plus de POINTS                |
// | PV_x   | 0 PV OU plus de pioche               | 0 PV perd ; sinon le plus de PV  |
//
// En modes PV, chaque kill retire exactement 1 PV à l'adversaire (les
// points restent comptés pour les stats). Toute égalité de fin de
// match renvoie winner: "TIE" — le match ne se termine JAMAIS sur un
// nul : l'appelant doit lancer un chi-fou-mi (js/engine/rps.js).
// =====================================================================
import { resolveClash } from "./clash.js";

export const GAME_MODES = ["SURVIE", "PV_5", "PV_7", "PV_10"];

export function isValidGameMode(mode) {
  return GAME_MODES.includes(mode);
}

/** PV de départ du mode, ou null en SURVIE (pas de PV). */
export function startingHp(mode) {
  if (mode === "PV_5") return 5;
  if (mode === "PV_7") return 7;
  if (mode === "PV_10") return 10;
  return null; // SURVIE
}

/**
 * État initial d'un match. `deckSizeA/B` = nombre de cartes piochables.
 * L'état est un objet JSON simple : sérialisable tel quel dans Firestore.
 */
export function createMatchState(mode, deckSizeA = 10, deckSizeB = 10) {
  if (!isValidGameMode(mode)) throw new Error(`Mode de jeu invalide : "${mode}"`);
  const hp = startingHp(mode);
  return {
    mode,
    turn: 0, // index du prochain tour à jouer (= nb de tours résolus)
    points: { a: 0, b: 0 },
    hp: hp === null ? null : { a: hp, b: hp },
    cardsLeft: { a: deckSizeA, b: deckSizeB },
    discard: { a: 0, b: 0 }
  };
}

/**
 * Applique le résultat d'un clash à l'état (nouvel état, l'entrée est
 * intacte). En mode PV, un double kill fait perdre 1 PV à CHACUN
 * (jamais 2 au même joueur — critère §9.2).
 * Les deux cartes jouées vont à la défausse quel que soit le résultat.
 */
export function applyModeRules(state, clash) {
  const next = structuredClone(state);
  next.points.a += clash.pointsA;
  next.points.b += clash.pointsB;
  if (next.hp) {
    next.hp.a = Math.max(0, next.hp.a - clash.pointsB); // B a tué => A perd 1 PV
    next.hp.b = Math.max(0, next.hp.b - clash.pointsA);
  }
  next.cardsLeft.a -= 1;
  next.cardsLeft.b -= 1;
  next.discard.a += 1;
  next.discard.b += 1;
  next.turn += 1;
  return next;
}

/**
 * Le match est-il terminé, et qui gagne ?
 * @returns {{ended:false} | {ended:true, reason:"HP_ZERO"|"DECK_EMPTY", winner:"A"|"B"|"TIE"}}
 *
 * Ordre des tests :
 *  1. 0 PV = défaite IMMÉDIATE, même s'il reste des cartes (§9.2) ;
 *     les deux à 0 le même tour => TIE (chi-fou-mi, §7).
 *  2. plus de pioche (l'un OU l'autre — les deux en même temps est une
 *     fin normale, pas une erreur, piège §8.4) :
 *     SURVIE => le plus de points ; PV => le plus de PV ; égalité => TIE.
 */
export function checkEndOfMatch(state) {
  if (state.hp) {
    const aDead = state.hp.a <= 0;
    const bDead = state.hp.b <= 0;
    if (aDead || bDead) {
      return {
        ended: true,
        reason: "HP_ZERO",
        winner: aDead && bDead ? "TIE" : aDead ? "B" : "A"
      };
    }
  }
  if (state.cardsLeft.a <= 0 || state.cardsLeft.b <= 0) {
    let winner;
    if (state.hp) {
      winner = state.hp.a === state.hp.b ? "TIE" : state.hp.a > state.hp.b ? "A" : "B";
    } else {
      winner = state.points.a === state.points.b ? "TIE" : state.points.a > state.points.b ? "A" : "B";
    }
    return { ended: true, reason: "DECK_EMPTY", winner };
  }
  return { ended: false };
}

/**
 * Joue un tour complet : clash + application + test de fin.
 * @returns {{ state, clash, end }}
 */
export function playTurn(state, cardA, cardB) {
  const clash = resolveClash(cardA, cardB);
  const next = applyModeRules(state, clash);
  return { state: next, clash, end: checkEndOfMatch(next) };
}
