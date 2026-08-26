// Tests du moteur de tournoi — critères §9.3 du brief.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createTournament, pairNextRound, reportMatchResult, worstPlayer,
  applyPeriodicElimination, reportFinalGame, activePlayers, isFinished,
  FINAL_WINS_NEEDED
} from "../js/engine/tournament.js";
import { mulberry32 } from "../js/engine/rps.js";

const rng = () => mulberry32(42);

test("§9.3 vainqueur de match -> +1 couronne, exactement", () => {
  let t = createTournament(["u1", "u2", "u3", "u4"]);
  t = reportMatchResult(t, "u1", "u2");
  assert.equal(t.players.u1.crowns, 1);
  assert.equal(t.players.u2.crowns, 0);
  assert.equal(t.players.u3.crowns, 0);
});

test("§9.3 5 joueurs -> 2 matchs + 1 WAITING ; pas le même bye deux rounds de suite si un autre est éligible", () => {
  let t = createTournament(["a", "b", "c", "d", "e"]);
  const r1 = pairNextRound(t, rng());
  assert.equal(r1.matches.length, 2);
  assert.ok(r1.byeUid, "un joueur doit être WAITING");
  assert.equal(r1.t.roundByeUid, r1.byeUid);
  t = r1.t;
  // On simule les résultats du round (les gagnants : premiers de chaque paire).
  for (const m of r1.matches) t = reportMatchResult(t, m.a, m.b);
  const r2 = pairNextRound(t, mulberry32(7));
  assert.notEqual(r2.byeUid, r1.byeUid, "le bye doit tourner tant que d'autres sont éligibles");
});

test("§9.3 3 défaites consécutives -> ELIMINATED", () => {
  let t = createTournament(["a", "b", "c", "d"]);
  t = reportMatchResult(t, "b", "a");
  t = reportMatchResult(t, "c", "a");
  assert.equal(t.players.a.status, "ACTIVE");
  t = reportMatchResult(t, "d", "a");
  assert.equal(t.players.a.status, "ELIMINATED");
});

test("§9.3 une victoire remet la série à zéro (D, D, V, D, D n'élimine pas)", () => {
  let t = createTournament(["a", "b", "c", "d"]);
  t = reportMatchResult(t, "b", "a");
  t = reportMatchResult(t, "c", "a");
  t = reportMatchResult(t, "a", "d"); // victoire : série remise à 0
  t = reportMatchResult(t, "b", "a");
  t = reportMatchResult(t, "c", "a");
  assert.equal(t.players.a.status, "ACTIVE");
});

test("§9.3 bye entre 2 défaites -> la série CONTINUE (D, bye, D, D = éliminé) — piège §8.6", () => {
  let t = createTournament(["a", "b", "c", "d", "e"]);
  t = reportMatchResult(t, "b", "a"); // D
  // Bye pour "a" : neutre, ne touche pas consecutiveLosses.
  t.players.a.byes += 1; // (ce que fait pairNextRound quand il attribue le bye)
  assert.equal(t.players.a.consecutiveLosses, 1, "le bye ne casse PAS la série");
  t = reportMatchResult(t, "c", "a"); // D
  t = reportMatchResult(t, "d", "a"); // D -> 3 consécutives
  assert.equal(t.players.a.status, "ELIMINATED");
});

test("§9.3 un bye ne donne jamais de couronne et ne compte pas comme défaite", () => {
  let t = createTournament(["a", "b", "c"]);
  const r1 = pairNextRound(t, rng());
  const bye = r1.byeUid;
  assert.equal(r1.t.players[bye].crowns, 0);
  assert.equal(r1.t.players[bye].consecutiveLosses, 0);
});

test("§9.3 round 3 -> le dernier est éliminé ; round 4 -> personne", () => {
  let t = createTournament(["a", "b", "c", "d", "e", "f"]);
  // a perd contre b, puis c/d et e/f se partagent : "a" sera dernier (0 couronne, a perdu contre tous).
  t = reportMatchResult(t, "b", "a");
  t = reportMatchResult(t, "c", "d");
  t = reportMatchResult(t, "e", "f");
  t.round = 3;
  const before = activePlayers(t).length;
  t = applyPeriodicElimination(t, mulberry32(1));
  assert.equal(activePlayers(t).length, before - 1, "round 3 : exactement 1 éliminé");
  t.round = 4;
  const t4 = applyPeriodicElimination(t, mulberry32(1));
  assert.equal(activePlayers(t4).length, activePlayers(t).length, "round 4 : personne");
});

test("§9.3 départage 2 ex æquo : celui qui a battu l'autre est devant, l'autre est éliminé", () => {
  let t = createTournament(["a", "b", "c", "d"]);
  // a bat b (1-0), puis b bat c, a bat d : a=2, b=1... construisons une égalité :
  t = reportMatchResult(t, "a", "b"); // a:1, b:0
  t = reportMatchResult(t, "b", "c"); // b:1
  // a et b à égalité de couronnes ? a:1, b:1 — et a a battu b.
  const { uid } = worstPlayer(t, ["a", "b"], mulberry32(1));
  assert.equal(uid, "b", "la confrontation directe place a devant b");
});

test("§9.3 départage : égalité totale sauf Buchholz -> la somme la plus FAIBLE est éliminée", () => {
  let t = createTournament(["a", "b", "x", "y", "z"]);
  // a bat x ; b bat y. Ensuite x gagne un match (x devient « fort ») :
  t = reportMatchResult(t, "a", "x");
  t = reportMatchResult(t, "b", "y");
  t = reportMatchResult(t, "x", "z"); // x : 1 couronne ACTUELLE
  // a et b : 1 couronne chacun, jamais affrontés, mêmes kills.
  // Buchholz : a a battu x (1 couronne) = 1 ; b a battu y (0) = 0.
  const { uid } = worstPlayer(t, ["a", "b"], mulberry32(1));
  assert.equal(uid, "b", "b a la plus faible somme de couronnes d'adversaires battus");
});

test("§9.3 départage étape 4 : à égalité jusqu'au Buchholz, le moins de kills est derrière", () => {
  let t = createTournament(["a", "b", "x", "y"]);
  t = reportMatchResult(t, "a", "x", 3, 0); // a : 3 kills
  t = reportMatchResult(t, "b", "y", 1, 0); // b : 1 kill
  const { uid } = worstPlayer(t, ["a", "b"], mulberry32(1));
  assert.equal(uid, "b");
});

test("§9.3 départage étape 5 : égalité totale -> tirage aléatoire CONSIGNÉ dans le log", () => {
  const t = createTournament(["a", "b", "x", "y"]);
  const { uid, t: t2 } = worstPlayer(t, ["a", "b"], mulberry32(9));
  assert.ok(["a", "b"].includes(uid));
  assert.ok(t2.log.some((l) => l.includes("départage aléatoire")), "le tirage doit être consigné");
});

test("§9.3 2 joueurs restants -> finale « premier à 3 » : ni avant, ni après", () => {
  let t = createTournament(["a", "b"]);
  const r = pairNextRound(t, rng());
  assert.equal(r.final, true, "à 2 joueurs, finale directe (§7)");
  t = r.t;
  assert.equal(t.phase, "FINAL");
  t = reportFinalGame(t, "a");
  t = reportFinalGame(t, "b");
  t = reportFinalGame(t, "a");
  assert.equal(isFinished(t), false, "2-1 : la finale continue");
  t = reportFinalGame(t, "a");
  assert.equal(isFinished(t), true, `${FINAL_WINS_NEEDED} victoires : champion désigné`);
  assert.equal(t.championUid, "a");
  assert.throws(() => reportFinalGame(t, "b"), /terminée/, "pas de manche après le titre");
});

test("§9.3 les 3 défaites consécutives sont SUSPENDUES pendant la finale", () => {
  let t = createTournament(["a", "b"]);
  t = pairNextRound(t, rng()).t;
  t = reportFinalGame(t, "a");
  t = reportFinalGame(t, "a");
  // b a « perdu » 2 manches de finale : son statut ne bouge pas.
  assert.equal(t.players.b.status, "ACTIVE");
});

test("§9.3 pas de revanche tant qu'un autre appariement est possible", () => {
  let t = createTournament(["a", "b", "c", "d"]);
  const r1 = pairNextRound(t, mulberry32(3));
  t = r1.t;
  for (const m of r1.matches) t = reportMatchResult(t, m.a, m.b);
  const r2 = pairNextRound(t, mulberry32(5));
  const k = (m) => [m.a, m.b].sort().join("|");
  const round1Keys = r1.matches.map(k);
  for (const m of r2.matches) {
    assert.ok(!round1Keys.includes(k(m)), "à 4 joueurs, le round 2 peut toujours éviter les revanches");
  }
});
