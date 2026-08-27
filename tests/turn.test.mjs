// Tests de la résolution complète d'un tour (effets + clash + rangement).
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveFullTurn, stepKey } from "../js/engine/turn.js";

const CAT = {
  fleur: { id: "fleur", name: "Fleur", rarity: "commun", attack: 0, defense: 1 },
  caillou: { id: "caillou", name: "Caillou", rarity: "commun", attack: 1, defense: 1 },
  rocher: { id: "rocher", name: "Rocher", rarity: "rare", attack: 2, defense: 3 },
  golem: { id: "golem", name: "Golem", rarity: "legendaire", attack: 3, defense: 4 },
  // Effets de test
  boost: { id: "boost", name: "Boost", rarity: "rare", attack: 1, defense: 1,
    effect: { on_play: "gain(3/0)" } },
  increvable: { id: "increvable", name: "Increvable", rarity: "rare", attack: 0, defense: 1,
    effect: { on_death: "go_bottom" } },
  broyeur: { id: "broyeur", name: "Broyeur", rarity: "rare", attack: 1, defense: 1,
    effect: { on_play: "mill_opp(2)" } },
  trieur: { id: "trieur", name: "Trieur", rarity: "rare", attack: 1, defense: 1,
    effect: { on_play: "organize_own(2)" } },
  guetteur: { id: "guetteur", name: "Guetteur", rarity: "rare", attack: 1, defense: 1,
    effect: { on_play: 'look_top if card.name == "golem" : gain(2/2)' } }
};

function match(over = {}) {
  return {
    mode: "SURVIE",
    turn: 0,
    points: { a: 0, b: 0 },
    hp: null,
    aDeck: ["caillou", "fleur", "fleur"],
    bDeck: ["fleur", "fleur", "fleur"],
    aDiscard: [],
    bDiscard: [],
    ...over
  };
}

test("tour de base : clash, points, et les deux cartes vont à la défausse", () => {
  const r = resolveFullTurn(CAT, match({ aDeck: ["rocher", "fleur"], bDeck: ["fleur", "fleur"] }));
  assert.equal(r.status, "done");
  const res = r.result;
  assert.equal(res.clash.aKillsB, true, "Rocher 2 ATK >= Fleur 1 DEF");
  assert.equal(res.clash.bKillsA, false);
  assert.deepEqual(res.points, { a: 1, b: 0 });
  assert.deepEqual(res.discards.a, ["rocher"], "la carte jouée est défaussée même vivante");
  assert.deepEqual(res.discards.b, ["fleur"]);
  assert.deepEqual(res.decks.a, ["fleur"]);
  assert.equal(res.turn, 1);
});

test("on_play gain(3/0) change le résultat du clash", () => {
  // Boost 1/1 + gain(3/0) = 4 ATK -> tue Golem (4 DEF).
  const r = resolveFullTurn(CAT, match({ aDeck: ["boost", "fleur"], bDeck: ["golem", "fleur"] }));
  const res = r.result;
  assert.deepEqual(res.clash.aStats, { attack: 4, defense: 1 }, "stats réellement utilisées");
  assert.equal(res.clash.aKillsB, true, "4 ATK >= 4 DEF du Golem");
  assert.equal(res.clash.bKillsA, true, "Golem 3 ATK >= 1 DEF");
  assert.deepEqual(res.points, { a: 1, b: 1 }, "double kill");
});

test("go_bottom : la carte tuée passe sous le deck au lieu de la défausse", () => {
  const r = resolveFullTurn(CAT, match({
    aDeck: ["increvable", "caillou", "fleur"], bDeck: ["golem", "fleur"]
  }));
  const res = r.result;
  assert.equal(res.clash.bKillsA, true, "l'Increvable meurt");
  assert.deepEqual(res.discards.a, [], "…mais ne va PAS à la défausse");
  assert.deepEqual(res.decks.a, ["caillou", "fleur", "increvable"], "il repart sous le deck");
  assert.equal(res.clash.aPlacement, "deck_bottom");
});

test("mill_opp retire bien des cartes du deck adverse et alimente sa défausse", () => {
  const r = resolveFullTurn(CAT, match({
    aDeck: ["broyeur", "fleur"], bDeck: ["fleur", "caillou", "rocher", "golem"]
  }));
  const res = r.result;
  // b joue "fleur" (retirée du deck), puis mill_opp(2) retire caillou et rocher.
  assert.deepEqual(res.decks.b, ["golem"]);
  assert.deepEqual(res.discards.b, ["fleur", "rocher", "caillou"], "la carte jouée est au-dessus");
  assert.equal(res.cardsLeft.b, 1);
});

test("condition sur la carte regardée : look_top + if", () => {
  const avecGolem = resolveFullTurn(CAT, match({
    aDeck: ["guetteur", "golem", "fleur"], bDeck: ["rocher", "fleur"]
  }));
  assert.deepEqual(avecGolem.result.clash.aStats, { attack: 3, defense: 3 }, "1/1 + 2/2");
  assert.equal(avecGolem.result.clash.aKillsB, true, "3 ATK >= 3 DEF du Rocher");

  const sansGolem = resolveFullTurn(CAT, match({
    aDeck: ["guetteur", "fleur", "fleur"], bDeck: ["rocher", "fleur"]
  }));
  assert.deepEqual(sansGolem.result.clash.aStats, { attack: 1, defense: 1 }, "pas de bonus");
});

test("effet interactif : le tour s'interrompt et demande un choix au bon joueur", () => {
  const m = match({ aDeck: ["trieur", "caillou", "golem", "fleur"], bDeck: ["fleur", "fleur"] });
  const ask = resolveFullTurn(CAT, m);
  assert.equal(ask.status, "waiting");
  assert.equal(ask.side, "a", "c'est au joueur A de choisir");
  assert.equal(ask.stepKey, stepKey(0, "on_play", "a"));
  assert.equal(ask.request.kind, "organize_own");
  assert.deepEqual(ask.request.cards, ["caillou", "golem"]);

  // Réponse : remettre golem en premier, caillou ensuite.
  const done = resolveFullTurn(CAT, m, { [ask.stepKey]: [[1, 0]] });
  assert.equal(done.status, "done");
  assert.deepEqual(done.result.decks.a, ["golem", "caillou", "fleur"]);
});

test("rejeu déterministe : deux clients calculent le même tour", () => {
  const m = match({ aDeck: ["trieur", "caillou", "golem", "fleur"], bDeck: ["broyeur", "rocher", "fleur"] });
  const answers = { [stepKey(0, "on_play", "a")]: [[1, 0]] };
  const r1 = resolveFullTurn(CAT, m, answers, 123);
  const r2 = resolveFullTurn(CAT, m, answers, 123);
  assert.deepEqual(r1, r2);
});

test("fin de match détectée quand un deck se vide (mill compris)", () => {
  const r = resolveFullTurn(CAT, match({
    aDeck: ["broyeur", "fleur"], bDeck: ["fleur", "caillou", "rocher"]
  }));
  // b joue fleur, mill_opp(2) vide le reste de son deck.
  assert.equal(r.result.cardsLeft.b, 0);
  assert.equal(r.result.end.ended, true);
  assert.equal(r.result.end.reason, "DECK_EMPTY");
});

test("mode PV : les kills retirent des PV via le moteur de modes", () => {
  const r = resolveFullTurn(CAT, match({
    mode: "PV_5", hp: { a: 5, b: 5 },
    aDeck: ["golem", "fleur"], bDeck: ["fleur", "fleur"]
  }));
  assert.deepEqual(r.result.hp, { a: 5, b: 4 }, "b perd 1 PV");
  assert.deepEqual(r.result.points, { a: 1, b: 0 });
});

test("un deck vide ne fait pas planter la résolution", () => {
  const r = resolveFullTurn(CAT, match({ aDeck: [], bDeck: ["fleur"] }));
  assert.equal(r.status, "done");
  assert.equal(r.result.end.ended, true);
});
