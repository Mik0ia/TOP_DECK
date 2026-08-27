// Tests des récompenses de fin de tournoi (pièces + XP).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeRewards, finalStandings, applyXp, rewardRuleForRank, xpForLevel
} from "../js/engine/rewards.js";
import { createTournament, reportMatchResult } from "../js/engine/tournament.js";

function tournamentWithCrowns(spec, championUid = null) {
  const t = createTournament(Object.keys(spec));
  for (const [uid, data] of Object.entries(spec)) {
    t.players[uid].crowns = data.crowns ?? 0;
    t.players[uid].killPoints = data.kills ?? 0;
    if (data.beaten) t.players[uid].beaten = data.beaten;
  }
  t.championUid = championUid;
  return t;
}

test("barème : le tableau correspond exactement à la spécification", () => {
  assert.deepEqual(rewardRuleForRank(1), { rank: 1, coins: 6, xpPerLevel: 10 });
  assert.deepEqual(rewardRuleForRank(2), { rank: 2, coins: 4, xpPerLevel: 5 });
  assert.deepEqual(rewardRuleForRank(3), { rank: 3, coins: 3, xpPerLevel: 4 });
  assert.deepEqual(rewardRuleForRank(4), { rank: 4, coins: 2, xpPerLevel: 3 });
  assert.deepEqual(rewardRuleForRank(5), { coins: 2, xpPerLevel: 1 }, "5e et au-delà");
  assert.deepEqual(rewardRuleForRank(12), { coins: 2, xpPerLevel: 1 });
});

test("le champion est 1er même si un autre a autant de couronnes", () => {
  const t = tournamentWithCrowns({ a: { crowns: 3 }, b: { crowns: 3 }, c: { crowns: 1 } }, "b");
  assert.deepEqual(finalStandings(t), ["b", "a", "c"]);
});

test("classement : couronnes, puis confrontation directe, puis kills", () => {
  const t = tournamentWithCrowns({
    a: { crowns: 2, kills: 5 },
    b: { crowns: 2, kills: 9, beaten: ["a"] }, // b a battu a
    c: { crowns: 1, kills: 20 }
  });
  assert.deepEqual(finalStandings(t), ["b", "a", "c"], "b devant a grâce à la confrontation directe");
});

test("gains : 1er avec 3 adversaires niveaux 2+3+5 = 10 -> 6 pièces et 100 XP", () => {
  const t = tournamentWithCrowns({ moi: { crowns: 3 }, x: {}, y: {}, z: {} }, "moi");
  const r = computeRewards(t, { moi: 7, x: 2, y: 3, z: 5 });
  assert.equal(r.moi.rank, 1);
  assert.equal(r.moi.coins, 6);
  assert.equal(r.moi.opponentLevels, 10, "somme des niveaux des AUTRES joueurs");
  assert.equal(r.moi.xp, 100, "10 × 10");
});

test("gains : chaque rang applique son multiplicateur", () => {
  const t = tournamentWithCrowns({
    p1: { crowns: 4 }, p2: { crowns: 3 }, p3: { crowns: 2 }, p4: { crowns: 1 }, p5: { crowns: 0 }
  }, "p1");
  // Tous niveau 1 : chaque joueur a 4 adversaires => 4 niveaux cumulés.
  const levels = { p1: 1, p2: 1, p3: 1, p4: 1, p5: 1 };
  const r = computeRewards(t, levels);
  assert.deepEqual([r.p1.coins, r.p2.coins, r.p3.coins, r.p4.coins, r.p5.coins], [6, 4, 3, 2, 2]);
  assert.deepEqual([r.p1.xp, r.p2.xp, r.p3.xp, r.p4.xp, r.p5.xp], [40, 20, 16, 12, 4]);
});

test("gains : un niveau manquant ou aberrant compte comme niveau 1", () => {
  const t = tournamentWithCrowns({ a: { crowns: 1 }, b: {} }, "a");
  const r = computeRewards(t, { a: 5 }); // b sans niveau
  assert.equal(r.a.opponentLevels, 1);
  assert.equal(r.a.xp, 10);
  const r2 = computeRewards(t, { a: 5, b: -3 });
  assert.equal(r2.a.opponentLevels, 1, "un niveau négatif est ramené à 1");
});

test("gains : duel à 2 joueurs", () => {
  const t = tournamentWithCrowns({ gagnant: { crowns: 3 }, perdant: { crowns: 0 } }, "gagnant");
  const r = computeRewards(t, { gagnant: 4, perdant: 6 });
  assert.deepEqual(r.gagnant, { rank: 1, coins: 6, xp: 60, opponentLevels: 6 });
  assert.deepEqual(r.perdant, { rank: 2, coins: 4, xp: 20, opponentLevels: 4 });
});

test("tous les joueurs reçoivent une récompense, rangs uniques et consécutifs", () => {
  let t = createTournament(["a", "b", "c", "d", "e", "f", "g"]);
  t = reportMatchResult(t, "a", "b", 3, 1);
  t = reportMatchResult(t, "c", "d", 2, 2);
  t.championUid = "a";
  const r = computeRewards(t, {});
  const ranks = Object.values(r).map((x) => x.rank).sort((m, n) => m - n);
  assert.deepEqual(ranks, [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(Object.keys(r).length, 7);
});

test("le classement est identique quel que soit l'ordre des joueurs (déterminisme)", () => {
  const spec = { z: { crowns: 1, kills: 2 }, a: { crowns: 1, kills: 2 }, m: { crowns: 1, kills: 2 } };
  const t1 = tournamentWithCrowns(spec);
  const t2 = createTournament(["m", "a", "z"]);
  for (const [uid, d] of Object.entries(spec)) {
    t2.players[uid].crowns = d.crowns; t2.players[uid].killPoints = d.kills;
  }
  assert.deepEqual(finalStandings(t1), finalStandings(t2), "même ordre pour tous les clients");
});

// ---------------------------------------------------------------
// Montée de niveau
// ---------------------------------------------------------------
test("applyXp : montée de niveau simple", () => {
  // Niveau 1 -> 10 XP requis.
  assert.deepEqual(applyXp(1, 0, 5, xpForLevel), { level: 1, exp: 5, levelsGained: 0 });
  assert.deepEqual(applyXp(1, 0, 10, xpForLevel), { level: 2, exp: 0, levelsGained: 1 });
  assert.deepEqual(applyXp(1, 6, 6, xpForLevel), { level: 2, exp: 2, levelsGained: 1 });
});

test("applyXp : un gros gain fait monter plusieurs niveaux d'un coup", () => {
  // 10 (niv1) + 20 (niv2) + 30 (niv3) = 60 XP pour atteindre le niveau 4.
  const r = applyXp(1, 0, 60, xpForLevel);
  assert.equal(r.level, 4);
  assert.equal(r.exp, 0);
  assert.equal(r.levelsGained, 3);
});

test("applyXp : entrées invalides ne cassent rien", () => {
  assert.deepEqual(applyXp(undefined, undefined, undefined, xpForLevel), { level: 1, exp: 0, levelsGained: 0 });
  assert.deepEqual(applyXp(0, -5, -20, xpForLevel), { level: 1, exp: 0, levelsGained: 0 });
});
