// =====================================================================
// TOP DECK! — Récompenses de fin de tournoi (fonctions PURES)
// =====================================================================
// Barème demandé :
//
//   1er   : 6 pièces + (somme des niveaux des adversaires) × 10 en XP
//   2e    : 4 pièces + (somme des niveaux des adversaires) ×  5 en XP
//   3e    : 3 pièces + (somme des niveaux des adversaires) ×  4 en XP
//   4e    : 2 pièces + (somme des niveaux des adversaires) ×  3 en XP
//   autres: 2 pièces + (somme des niveaux des adversaires) ×  1 en XP
//
// « Adversaires » = tous les autres joueurs du tournoi (pas seulement
// ceux affrontés) : le gain dépend donc du niveau de la table.
//
// Le CLASSEMENT FINAL réutilise exactement l'ordre de départage du
// tournoi (§4.3.6) : couronnes, puis confrontation directe, puis
// Buchholz, puis points de kills. Le champion est 1er par définition.
// =====================================================================
import { buchholz } from "./tournament.js";

/**
 * XP nécessaire pour passer du niveau `level` au niveau `level + 1`.
 * Défini ici (moteur pur, testable hors navigateur) et réexporté par
 * js/auth.js pour ne pas casser le code existant.
 */
export function xpForLevel(level) {
  const lvl = Number.isFinite(level) && level > 0 ? Math.trunc(level) : 1;
  return lvl * 10;
}

/** Pourcentage de remplissage (0-100) de la barre d'XP courante. */
export function xpProgressPercent(level, exp) {
  const needed = xpForLevel(level);
  const current = Number.isFinite(exp) ? Math.max(0, exp) : 0;
  if (needed <= 0) return 0;
  return Math.max(0, Math.min(100, (current / needed) * 100));
}

export const REWARD_TABLE = [
  { rank: 1, coins: 6, xpPerLevel: 10 },
  { rank: 2, coins: 4, xpPerLevel: 5 },
  { rank: 3, coins: 3, xpPerLevel: 4 },
  { rank: 4, coins: 2, xpPerLevel: 3 }
];
export const DEFAULT_REWARD = { coins: 2, xpPerLevel: 1 };

/** Barème d'un rang (1-indexé). */
export function rewardRuleForRank(rank) {
  return REWARD_TABLE.find((r) => r.rank === rank) || DEFAULT_REWARD;
}

/**
 * Classement final du tournoi, du 1er au dernier.
 * @param {object} t état de tournoi (js/engine/tournament.js)
 * @returns {string[]} uids ordonnés
 */
export function finalStandings(t) {
  const uids = Object.keys(t.players);
  return uids.slice().sort((u1, u2) => {
    // Le champion passe devant tout le monde.
    if (t.championUid === u1) return -1;
    if (t.championUid === u2) return 1;
    const p1 = t.players[u1], p2 = t.players[u2];
    if (p1.crowns !== p2.crowns) return p2.crowns - p1.crowns;
    // Confrontation directe (uniquement entre ces deux joueurs).
    const u1BeatU2 = p1.beaten.includes(u2);
    const u2BeatU1 = p2.beaten.includes(u1);
    if (u1BeatU2 !== u2BeatU1) return u1BeatU2 ? -1 : 1;
    const b1 = buchholz(t, u1), b2 = buchholz(t, u2);
    if (b1 !== b2) return b2 - b1;
    if (p1.killPoints !== p2.killPoints) return p2.killPoints - p1.killPoints;
    return u1.localeCompare(u2); // départage stable (même ordre pour tous les clients)
  });
}

/**
 * Récompenses de tous les joueurs d'un tournoi terminé.
 * @param {object} t       état de tournoi
 * @param {object} levels  { [uid]: niveau } — niveau au moment de la partie
 * @returns {object} { [uid]: { rank, coins, xp, opponentLevels } }
 */
export function computeRewards(t, levels = {}) {
  const standings = finalStandings(t);
  const levelOf = (uid) => {
    const lvl = Number(levels[uid]);
    return Number.isFinite(lvl) && lvl > 0 ? Math.trunc(lvl) : 1;
  };
  const totalLevels = standings.reduce((sum, uid) => sum + levelOf(uid), 0);

  const out = {};
  standings.forEach((uid, index) => {
    const rank = index + 1;
    const rule = rewardRuleForRank(rank);
    // Somme des niveaux des AUTRES joueurs.
    const opponentLevels = totalLevels - levelOf(uid);
    out[uid] = {
      rank,
      coins: rule.coins,
      xp: opponentLevels * rule.xpPerLevel,
      opponentLevels
    };
  });
  return out;
}

/**
 * Applique un gain d'XP à un profil et gère les montées de niveau.
 * `xpForLevel(n)` = XP nécessaire pour passer du niveau n au n+1
 * (règle existante du jeu : n × 10).
 *
 * @returns {{ level, exp, levelsGained }}
 */
export function applyXp(level, exp, gainedXp, xpForLevel) {
  let lvl = Number.isFinite(level) && level > 0 ? Math.trunc(level) : 1;
  let cur = (Number.isFinite(exp) ? Math.max(0, exp) : 0) + Math.max(0, Math.trunc(gainedXp || 0));
  let gained = 0;
  // Boucle bornée : un très gros gain peut faire monter plusieurs
  // niveaux d'un coup, mais on ne boucle jamais indéfiniment.
  for (let guard = 0; guard < 1000; guard++) {
    const needed = xpForLevel(lvl);
    if (needed <= 0 || cur < needed) break;
    cur -= needed;
    lvl += 1;
    gained += 1;
  }
  return { level: lvl, exp: cur, levelsGained: gained };
}
