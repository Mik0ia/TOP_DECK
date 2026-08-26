// Tests des modes de jeu et du chi-fou-mi — critères §9.2 du brief.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GAME_MODES, isValidGameMode, createMatchState, applyModeRules,
  checkEndOfMatch, playTurn
} from "../js/engine/modes.js";
import { resolveClash } from "../js/engine/clash.js";
import { resolveRps, RPS_MOVES } from "../js/engine/rps.js";

const KILLER = { attack: 9, defense: 99 };  // tue tout (ATK 9 >= DEF adverses ci-dessous), intuable
const VICTIM = { attack: 0, defense: 1 };   // ne tue rien, meurt à tout
const HARMLESS = { attack: 0, defense: 1 }; // ne tue rien
const WALL = { attack: 0, defense: 99 };    // intuable, ne tue rien
const GLASS = { attack: 9, defense: 0 };    // tue tout, meurt à tout

test("§9.2 la création refuse toute valeur hors des 4 modes", () => {
  assert.deepEqual(GAME_MODES, ["SURVIE", "PV_5", "PV_7", "PV_10"]);
  for (const m of GAME_MODES) assert.equal(isValidGameMode(m), true);
  for (const bad of ["MORT_SUBITE", "pv_5", "", null, undefined, "PV_6"]) {
    assert.equal(isValidGameMode(bad), false, `"${bad}" doit être refusé`);
    assert.throws(() => createMatchState(bad));
  }
});

test("§9.2 SURVIE : deck vide -> fin, vainqueur = plus de points", () => {
  let s = createMatchState("SURVIE", 2, 2);
  // Tour 1 : A tue, B non.
  ({ state: s } = playTurn(s, KILLER, VICTIM));
  assert.equal(checkEndOfMatch(s).ended, false, "il reste des cartes");
  // Tour 2 : personne ne tue -> decks vides.
  const { end } = { end: checkEndOfMatch(applyModeRules(s, resolveClash(HARMLESS, WALL))) };
  assert.equal(end.ended, true);
  assert.equal(end.reason, "DECK_EMPTY");
  assert.equal(end.winner, "A", "A a 1 point contre 0");
});

test("§9.2 PV_5 : 5 kills subis -> 0 PV -> défaite immédiate, même avec des cartes restantes", () => {
  let s = createMatchState("PV_5", 10, 10);
  for (let i = 0; i < 5; i++) {
    ({ state: s } = playTurn(s, KILLER, VICTIM)); // A tue B à chaque tour
  }
  const end = checkEndOfMatch(s);
  assert.equal(s.hp.b, 0);
  assert.ok(s.cardsLeft.a > 0 && s.cardsLeft.b > 0, "il reste des cartes aux deux");
  assert.equal(end.ended, true);
  assert.equal(end.reason, "HP_ZERO");
  assert.equal(end.winner, "A");
});

test("§9.2 PV_7 : deck vide à 4 PV contre 6 PV -> le joueur à 6 PV gagne", () => {
  let s = createMatchState("PV_7", 4, 4);
  // A subit 3 kills (7 -> 4), B en subit 1 (7 -> 6).
  ({ state: s } = playTurn(s, VICTIM, KILLER));   // B tue : A 6 PV
  ({ state: s } = playTurn(s, VICTIM, KILLER));   // B tue : A 5 PV
  ({ state: s } = playTurn(s, VICTIM, KILLER));   // B tue : A 4 PV
  ({ state: s } = playTurn(s, KILLER, VICTIM));   // A tue : B 6 PV — decks vides
  assert.equal(s.hp.a, 4);
  assert.equal(s.hp.b, 6);
  const end = checkEndOfMatch(s);
  assert.equal(end.ended, true);
  assert.equal(end.reason, "DECK_EMPTY");
  assert.equal(end.winner, "B", "6 PV bat 4 PV");
});

test("§9.2 un kill en mode PV retire exactement 1 PV — double kill : chacun perd 1, jamais 2", () => {
  let s = createMatchState("PV_5", 10, 10);
  ({ state: s } = playTurn(s, GLASS, GLASS)); // double kill
  assert.equal(s.hp.a, 4);
  assert.equal(s.hp.b, 4);
  assert.equal(s.points.a, 1);
  assert.equal(s.points.b, 1);
});

test("§9.2 égalité de points en SURVIE à deck vide -> TIE (chi-fou-mi requis), pas de fin sans vainqueur", () => {
  let s = createMatchState("SURVIE", 1, 1);
  const { end } = playTurn(s, HARMLESS, WALL); // 0 point partout, decks vides
  assert.equal(end.ended, true);
  assert.equal(end.winner, "TIE", "le moteur signale TIE : l'appelant DOIT lancer un chi-fou-mi");
});

test("§9.2 double kill qui met les deux à 0 PV -> TIE (chi-fou-mi), un seul vainqueur ensuite", () => {
  let s = createMatchState("PV_5", 10, 10);
  for (let i = 0; i < 4; i++) ({ state: s } = playTurn(s, GLASS, GLASS));
  const { state: s2, end } = playTurn(s, GLASS, GLASS); // 5e double kill : 0 - 0
  assert.equal(s2.hp.a, 0);
  assert.equal(s2.hp.b, 0);
  assert.equal(end.ended, true);
  assert.equal(end.reason, "HP_ZERO");
  assert.equal(end.winner, "TIE");
  // Le chi-fou-mi désigne toujours UN vainqueur (jamais de nul persistant)
  assert.notEqual(resolveRps("pierre", "ciseaux"), "TIE");
});

test("§9.2 chi-fou-mi pierre/pierre -> nouveau tour, jamais une fin de match", () => {
  for (const m of RPS_MOVES) {
    assert.equal(resolveRps(m, m), "TIE", "égalité => on rejoue");
  }
  assert.equal(resolveRps("pierre", "ciseaux"), "A");
  assert.equal(resolveRps("feuille", "pierre"), "A");
  assert.equal(resolveRps("ciseaux", "feuille"), "A");
  assert.equal(resolveRps("ciseaux", "pierre"), "B");
  assert.throws(() => resolveRps("puits", "pierre"));
});

test("§9.2 deck vide pour les DEUX au même tour : fin normale, pas une erreur (piège §8.4)", () => {
  const s = createMatchState("SURVIE", 1, 1);
  const { end } = playTurn(s, KILLER, VICTIM);
  assert.equal(end.ended, true);
  assert.equal(end.winner, "A");
});
