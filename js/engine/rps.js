// =====================================================================
// TOP DECK! — Chi-fou-mi (départage, brief §4.2) + RNG seedé partagé
// =====================================================================

export const RPS_MOVES = ["pierre", "feuille", "ciseaux"];

const BEATS = { pierre: "ciseaux", feuille: "pierre", ciseaux: "feuille" };

export function isValidRpsMove(move) {
  return RPS_MOVES.includes(move);
}

/**
 * @returns {"A"|"B"|"TIE"} — TIE relance un tour de chi-fou-mi, ne
 * termine JAMAIS le match (piège §8.9).
 */
export function resolveRps(moveA, moveB) {
  if (!isValidRpsMove(moveA) || !isValidRpsMove(moveB)) {
    throw new Error("Coup de chi-fou-mi invalide.");
  }
  if (moveA === moveB) return "TIE";
  return BEATS[moveA] === moveB ? "A" : "B";
}

// ---------------------------------------------------------------
// RNG déterministe (mulberry32) — utilisé par le tournoi, la
// simulation et le mélange des decks côté client.
// ---------------------------------------------------------------
export function hashString(str) {
  let h = 1779033703 ^ String(str).length;
  for (let i = 0; i < String(str).length; i++) {
    h = Math.imul(h ^ String(str).charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Mélange de Fisher-Yates (nouveau tableau). */
export function shuffled(arr, rng = Math.random) {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
