// Tests de la vue spectateur — critères §9.4 du brief.
// La vue spectate de js/game.js est alimentée EXCLUSIVEMENT par
// spectatorView() : ce test inspecte tout ce qu'un spectateur reçoit
// pendant un tour et vérifie qu'aucune valeur ATK/DEF d'une carte face
// cachée n'y apparaît (les decks complets, présents dans le document
// du match pour le calcul du clash, sont filtrés).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spectatorView } from "../js/engine/spectate.js";

// Un document de match tel qu'il existe dans Firestore : il CONTIENT
// les decks (nécessaires au calcul) — c'est la projection qui protège.
const matchDoc = {
  id: "r1-m0",
  round: 1,
  mode: "PV_5",
  status: "playing",
  a: "alice", b: "bob",
  turn: 2,
  aPlayed: 3, // alice a joué son 3e tour : carte FACE CACHÉE (bob n'a pas joué)
  bPlayed: 2,
  points: { a: 1, b: 0 },
  hp: { a: 5, b: 4 },
  cardsLeft: { a: 8, b: 8 },
  discard: { a: 2, b: 2 },
  aDeck: ["golem", "tour", "slime", "bourrin", "fleur", "pot", "rocher", "caillou", "vengeur", "chevalier"],
  bDeck: ["slime", "slime", "tour", "tour", "tour", "vengeur", "vengeur", "bourrin", "protecteur", "slime"],
  lastClash: { aCard: "tour", bCard: "slime", aKillsB: false, bKillsA: true },
  rps: { aHash: "abc123", bHash: null, aChoice: "pierre", aSalt: "s" },
  winner: null,
  endReason: null
};

test("§9.4 aucun deck ni carte en attente dans les données spectateur", () => {
  const view = spectatorView(matchDoc);
  const raw = JSON.stringify(view);
  // Les decks complets ne doivent pas fuiter…
  assert.ok(!("aDeck" in view) && !("bDeck" in view), "les decks sont filtrés");
  // …ni la carte du tour en cours (turn 2 : aDeck[2] = "slime" est face
  // cachée — mais "slime" apparaît légitimement dans lastClash du tour
  // précédent, donc on vérifie par STRUCTURE, pas par chaîne :
  assert.equal(view.aPlayedThisTurn, true, "on sait QUE alice a joué…");
  assert.equal(view.bPlayedThisTurn, false);
  assert.ok(!("aPendingCard" in view) && !("pending" in view), "…mais jamais QUOI");
  // Le choix de chi-fou-mi en attente ne fuit pas non plus (piège §8.9).
  assert.ok(!raw.includes("aChoice") && !raw.includes("aHash"), "le chi-fou-mi en cours est filtré");
});

test("§9.4 la projection expose bien l'état PUBLIC (ce qu'un joueur verrait de l'extérieur)", () => {
  const view = spectatorView(matchDoc);
  assert.equal(view.mode, "PV_5");
  assert.deepEqual(view.points, { a: 1, b: 0 });
  assert.deepEqual(view.hp, { a: 5, b: 4 });
  assert.deepEqual(view.lastClash, matchDoc.lastClash, "le dernier clash révélé est public");
  assert.equal(view.winner, null);
});

test("§9.4 exhaustivité : toute clé de la projection appartient à une liste blanche", () => {
  const ALLOWED = new Set([
    "id", "round", "isFinal", "mode", "status", "a", "b", "turn", "points",
    "hp", "cardsLeft", "discard", "aPlayedThisTurn", "bPlayedThisTurn",
    "lastClash", "rpsLastResult", "winner", "endReason"
  ]);
  const view = spectatorView(matchDoc);
  for (const key of Object.keys(view)) {
    assert.ok(ALLOWED.has(key), `clé inattendue dans la vue spectateur : "${key}"`);
  }
});
