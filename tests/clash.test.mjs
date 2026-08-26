// Tests du moteur de clash — critères d'acceptation §9.1 du brief.
// Lancer : npm test   (ou : node --test tests/)
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveClash } from "../js/engine/clash.js";
import { createMatchState, applyModeRules } from "../js/engine/modes.js";

test("§9.1 resolveClash({5,3},{2,5}) : A tue B, B ne tue pas A, A +1 point", () => {
  const r = resolveClash({ attack: 5, defense: 3 }, { attack: 2, defense: 5 });
  assert.equal(r.aKillsB, true);
  assert.equal(r.bKillsA, false);
  assert.equal(r.pointsA, 1);
  assert.equal(r.pointsB, 0);
});

test("§9.1 resolveClash({5,2},{3,5}) : double kill, +1 chacun", () => {
  const r = resolveClash({ attack: 5, defense: 2 }, { attack: 3, defense: 5 });
  assert.equal(r.aKillsB, true);
  assert.equal(r.bKillsA, true);
  assert.equal(r.pointsA, 1);
  assert.equal(r.pointsB, 1);
});

test("§9.1 resolveClash({1,9},{1,9}) : aucun kill, 0 point", () => {
  const r = resolveClash({ attack: 1, defense: 9 }, { attack: 1, defense: 9 });
  assert.equal(r.aKillsB, false);
  assert.equal(r.bKillsA, false);
  assert.equal(r.pointsA, 0);
  assert.equal(r.pointsB, 0);
});

test("§9.1 ATK == DEF => kill (le « ou égal » testé explicitement)", () => {
  const r = resolveClash({ attack: 4, defense: 9 }, { attack: 1, defense: 4 });
  assert.equal(r.aKillsB, true, "ATK 4 vs DEF 4 doit tuer");
  const r2 = resolveClash({ attack: 3, defense: 3 }, { attack: 3, defense: 3 });
  assert.equal(r2.aKillsB, true);
  assert.equal(r2.bKillsA, true);
});

test("§9.1 après un tour, les 2 cartes sont dans la défausse, quel que soit le résultat", () => {
  for (const [cA, cB] of [
    [{ attack: 5, defense: 3 }, { attack: 2, defense: 5 }], // kill simple
    [{ attack: 5, defense: 2 }, { attack: 3, defense: 5 }], // double kill
    [{ attack: 1, defense: 9 }, { attack: 1, defense: 9 }]  // aucun kill
  ]) {
    const s0 = createMatchState("SURVIE");
    const s1 = applyModeRules(s0, resolveClash(cA, cB));
    assert.equal(s1.discard.a, 1);
    assert.equal(s1.discard.b, 1);
    assert.equal(s1.cardsLeft.a, 9);
    assert.equal(s1.cardsLeft.b, 9);
  }
});
