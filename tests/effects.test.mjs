// Tests du système d'effets de cartes (parseur + interpréteur).
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEffect, EffectParseError, validateCardEffects } from "../js/engine/effect-parser.js";
import { createEffectState, runEffect, triggerCardEffect } from "../js/engine/effects.js";

// Mini-catalogue de test, indépendant du vrai jeu.
const CAT = {
  caillou: { id: "caillou", name: "Caillou", rarity: "commun", attack: 1, defense: 1 },
  rocher: { id: "rocher", name: "Rocher", rarity: "rare", attack: 2, defense: 4 },
  golem: { id: "golem", name: "Golem", rarity: "legendaire", attack: 4, defense: 4 },
  fleur: { id: "fleur", name: "Fleur", rarity: "commun", attack: 0, defense: 1 },
  // Carte avec effet on_seen : elle gagne +0/+1 quand on la regarde.
  espion: {
    id: "espion", name: "Espion", rarity: "rare", attack: 2, defense: 2,
    effect: { on_seen: "gain(0/1)" }
  }
};

const deck = (ids) => createEffectState({ a: ids, b: ["fleur", "fleur", "fleur"] }, { a: [], b: [] }, { a: null, b: null });

// =============================================================
// PARSEUR
// =============================================================
test("parseur : appels simples et arguments", () => {
  assert.deepEqual(parseEffect("look_top"), [{ type: "call", name: "look_top", args: [] }]);
  assert.deepEqual(parseEffect("mill_opp(2)"), [{ type: "call", name: "mill_opp", args: [2] }]);
  assert.deepEqual(parseEffect("gain(1/1)"), [{ type: "call", name: "gain", args: [1, 1] }]);
});

test("parseur : la syntaxe demandée « look_top if card.name == \"caillou\" : gain(1/1) »", () => {
  const ast = parseEffect('look_top if card.name == "caillou" : gain(1/1)');
  assert.equal(ast.length, 1);
  assert.equal(ast[0].type, "seq");
  assert.equal(ast[0].body[0].name, "look_top");
  assert.equal(ast[0].body[1].type, "if");
  assert.equal(ast[0].body[1].then[0].name, "gain");
});

test("parseur : instructions multiples, blocs, else, and/or", () => {
  const ast = parseEffect(`
    look_top;
    if card.attack >= 2 and card.rarity == "rare" : { gain(1/0); mill_opp(1) }
    else : gain(0/1)
  `);
  assert.equal(ast.length, 2);
  assert.equal(ast[1].then.length, 2);
  assert.equal(ast[1].else[0].name, "gain");
});

test("parseur : refuse un effet inconnu ou une arité fausse", () => {
  assert.throws(() => parseEffect("dominer(2)"), EffectParseError);
  assert.throws(() => parseEffect("gain(1)"), EffectParseError, "gain attend deux nombres");
  assert.throws(() => parseEffect("mill_own"), EffectParseError, "mill_own attend un nombre");
  assert.throws(() => parseEffect("go_bottom(2)"), EffectParseError, "go_bottom n'a pas d'argument");
  assert.throws(() => parseEffect('if card.name == "x" gain(1/1)'), EffectParseError, "« : » manquant");
});

test("parseur : validateCardEffects signale les cartes mal écrites", () => {
  assert.deepEqual(validateCardEffects({ id: "ok", effect: { on_play: "gain(1/1)" } }), []);
  const errs = validateCardEffects({ id: "ko", effect: { on_play: "gaine(1/1)", on_click: "gain(1/1)" } });
  assert.equal(errs.length, 2);
  assert.match(errs.join(" "), /gaine/);
  assert.match(errs.join(" "), /on_click/);
});

// =============================================================
// EFFETS DÉTERMINISTES
// =============================================================
test("gain(x/y) modifie l'attaque et la défense de la carte jouée", () => {
  const st = deck(["caillou", "rocher"]);
  const r = runEffect("gain(2/3)", { catalog: CAT, state: st, side: "a", selfId: "caillou" });
  assert.equal(r.status, "done");
  assert.deepEqual(r.state.buffs.a, { attack: 2, defense: 3 });
  assert.deepEqual(st.buffs.a, { attack: 0, defense: 0 }, "l'état d'entrée n'est pas muté");
});

test("look_top expose la carte du dessus dans card.* et la condition s'applique", () => {
  const st = deck(["caillou", "rocher"]);
  const prog = 'look_top if card.name == "caillou" : gain(1/1)';
  const r = runEffect(prog, { catalog: CAT, state: st, side: "a", selfId: "golem" });
  assert.deepEqual(r.state.buffs.a, { attack: 1, defense: 1 }, "Caillou vu -> +1/+1");

  const st2 = deck(["rocher", "caillou"]);
  const r2 = runEffect(prog, { catalog: CAT, state: st2, side: "a", selfId: "golem" });
  assert.deepEqual(r2.state.buffs.a, { attack: 0, defense: 0 }, "Rocher vu -> pas de bonus");
});

test("comparaison de texte tolérante à la casse et aux accents", () => {
  const st = deck(["caillou"]);
  for (const written of ['"caillou"', '"Caillou"', '"CAILLOU"']) {
    const r = runEffect(`look_top if card.name == ${written} : gain(1/0)`, { catalog: CAT, state: st, side: "a" });
    assert.equal(r.state.buffs.a.attack, 1, `${written} doit matcher`);
  }
});

test("look_bot regarde la carte du dessous", () => {
  const st = deck(["fleur", "fleur", "golem"]);
  const r = runEffect('look_bot if card.name == "golem" : gain(0/2)', { catalog: CAT, state: st, side: "a" });
  assert.equal(r.state.buffs.a.defense, 2);
});

test("mill_own / mill_opp défaussent depuis le dessus du bon deck", () => {
  const st = deck(["caillou", "rocher", "golem"]);
  const r = runEffect("mill_own(2)", { catalog: CAT, state: st, side: "a" });
  assert.deepEqual(r.state.decks.a, ["golem"]);
  assert.deepEqual(r.state.discards.a, ["rocher", "caillou"], "la dernière défaussée est au-dessus");

  const r2 = runEffect("mill_opp(1)", { catalog: CAT, state: st, side: "a" });
  assert.equal(r2.state.decks.b.length, 2);
  assert.deepEqual(r2.state.decks.a, ["caillou", "rocher", "golem"], "mon deck est intact");
});

test("mill sur un deck plus court que x ne plante pas", () => {
  const st = deck(["caillou"]);
  const r = runEffect("mill_own(5)", { catalog: CAT, state: st, side: "a" });
  assert.deepEqual(r.state.decks.a, []);
  assert.equal(r.state.discards.a.length, 1);
});

test("go_bottom lève le drapeau utilisé à la mort de la carte", () => {
  const st = deck(["caillou"]);
  const r = runEffect("go_bottom", { catalog: CAT, state: st, side: "a" });
  assert.equal(r.state.goBottom.a, true);
  assert.equal(r.state.goBottom.b, false);
});

test("self.* et opp.* sont lisibles dans les conditions", () => {
  const st = createEffectState({ a: ["fleur"], b: ["fleur"] }, { a: [], b: [] }, { a: "caillou", b: "golem" });
  const r = runEffect("if opp.attack > self.attack : gain(3/0)", {
    catalog: CAT, state: st, side: "a", selfId: "caillou"
  });
  assert.equal(r.state.buffs.a.attack, 3, "Golem (4 ATK) > Caillou (1 ATK)");
});

test("my.deck_size / their.deck_size sont lisibles", () => {
  const st = createEffectState({ a: ["fleur", "fleur", "fleur", "fleur"], b: ["fleur"] }, { a: [], b: [] }, {});
  const r = runEffect("if my.deck_size > their.deck_size : gain(1/1)", { catalog: CAT, state: st, side: "a" });
  assert.deepEqual(r.state.buffs.a, { attack: 1, defense: 1 });
});

// =============================================================
// on_seen (déclenchement en cascade)
// =============================================================
test("on_seen se déclenche quand une carte est regardée", () => {
  const st = deck(["espion", "fleur"]);
  const r = runEffect("look_top", { catalog: CAT, state: st, side: "a", selfId: "golem" });
  assert.equal(r.state.buffs.a.defense, 1, "l'Espion regardé applique son gain(0/1)");
  assert.ok(r.log.some((l) => l.type === "seen" && l.card === "espion"));
});

test("les cascades on_seen sont limitées en profondeur (pas de boucle infinie)", () => {
  const LOOP = {
    miroir: { id: "miroir", name: "Miroir", rarity: "rare", attack: 1, defense: 1,
      effect: { on_seen: "look_top" } }
  };
  const st = createEffectState({ a: ["miroir", "miroir", "miroir", "miroir", "miroir"], b: [] }, { a: [], b: [] }, {});
  const r = runEffect("look_top", { catalog: LOOP, state: st, side: "a" });
  assert.equal(r.status, "done", "l'exécution se termine malgré la récursion");
});

// =============================================================
// EFFETS INTERACTIFS (modèle « rejeu déterministe »)
// =============================================================
test("scry(2) demande un choix puis renvoie les cartes choisies sous le deck", () => {
  const st = deck(["caillou", "rocher", "golem", "fleur"]);
  // 1er passage : aucune réponse -> demande de choix
  const ask = runEffect("scry(2)", { catalog: CAT, state: st, side: "a" });
  assert.equal(ask.status, "waiting");
  assert.equal(ask.request.kind, "scry");
  assert.deepEqual(ask.request.cards, ["caillou", "rocher"]);
  assert.deepEqual(ask.state.decks.a, ["caillou", "rocher", "golem", "fleur"], "état inchangé tant qu'on attend");

  // 2e passage avec la réponse : envoyer "caillou" (index 0) sous le deck
  const done = runEffect("scry(2)", { catalog: CAT, state: st, side: "a", answers: [[0]] });
  assert.equal(done.status, "done");
  assert.deepEqual(done.state.decks.a, ["rocher", "golem", "fleur", "caillou"]);
});

test("scry : ne rien renvoyer dessous laisse le deck intact", () => {
  const st = deck(["caillou", "rocher", "golem"]);
  const done = runEffect("scry(2)", { catalog: CAT, state: st, side: "a", answers: [[]] });
  assert.deepEqual(done.state.decks.a, ["caillou", "rocher", "golem"]);
});

test("organize_own(3) repose les cartes dans l'ordre choisi", () => {
  const st = deck(["caillou", "rocher", "golem", "fleur"]);
  const ask = runEffect("organize_own(3)", { catalog: CAT, state: st, side: "a" });
  assert.equal(ask.status, "waiting");
  assert.equal(ask.request.kind, "organize_own");
  // Ordre demandé : golem (2), caillou (0), rocher (1)
  const done = runEffect("organize_own(3)", { catalog: CAT, state: st, side: "a", answers: [[2, 0, 1]] });
  assert.deepEqual(done.state.decks.a, ["golem", "caillou", "rocher", "fleur"]);
});

test("organize_opp(2) agit sur le deck ADVERSE", () => {
  const st = createEffectState({ a: ["caillou"], b: ["rocher", "golem", "fleur"] }, { a: [], b: [] }, {});
  const done = runEffect("organize_opp(2)", { catalog: CAT, state: st, side: "a", answers: [[1, 0]] });
  assert.deepEqual(done.state.decks.b, ["golem", "rocher", "fleur"]);
  assert.deepEqual(done.state.decks.a, ["caillou"], "mon deck est intact");
});

test("search(2) met les cartes choisies sur le dessus et mélange le reste", () => {
  const st = deck(["caillou", "rocher", "golem", "fleur", "espion"]);
  const ask = runEffect("search(2)", { catalog: CAT, state: st, side: "a", seed: 7 });
  assert.equal(ask.request.kind, "search");
  assert.equal(ask.request.cards.length, 5, "on voit TOUT le deck");

  const done = runEffect("search(2)", { catalog: CAT, state: st, side: "a", answers: [[2, 0]], seed: 7 });
  assert.deepEqual(done.state.decks.a.slice(0, 2), ["golem", "caillou"], "choisies, dans l'ordre voulu");
  assert.equal(done.state.decks.a.length, 5);
  assert.deepEqual([...done.state.decks.a].sort(), ["caillou", "espion", "fleur", "golem", "rocher"]);
});

test("search : le mélange est déterministe pour une même graine (rejeu identique)", () => {
  const st = deck(["caillou", "rocher", "golem", "fleur", "espion"]);
  const a = runEffect("search(1)", { catalog: CAT, state: st, side: "a", answers: [[0]], seed: 42 });
  const b = runEffect("search(1)", { catalog: CAT, state: st, side: "a", answers: [[0]], seed: 42 });
  assert.deepEqual(a.state.decks.a, b.state.decks.a, "les deux clients calculent le même deck");
});

test("réponse invalide (index hors deck, doublons) : l'effet ne corrompt pas le deck", () => {
  const st = deck(["caillou", "rocher", "golem"]);
  const done = runEffect("organize_own(3)", {
    catalog: CAT, state: st, side: "a", answers: [[99, 1, 1, -3]]
  });
  assert.equal(done.state.decks.a.length, 3);
  assert.deepEqual([...done.state.decks.a].sort(), ["caillou", "golem", "rocher"]);
});

test("plusieurs effets interactifs s'enchaînent avec la liste de réponses", () => {
  const st = deck(["caillou", "rocher", "golem", "fleur"]);
  const prog = "organize_own(2); scry(2)";
  const first = runEffect(prog, { catalog: CAT, state: st, side: "a" });
  assert.equal(first.request.kind, "organize_own");
  const second = runEffect(prog, { catalog: CAT, state: st, side: "a", answers: [[1, 0]] });
  assert.equal(second.status, "waiting");
  assert.equal(second.request.kind, "scry", "le 2e choix est demandé après le 1er");
  const done = runEffect(prog, { catalog: CAT, state: st, side: "a", answers: [[1, 0], [0]] });
  assert.equal(done.status, "done");
});

// =============================================================
// DÉCLENCHEURS
// =============================================================
test("triggerCardEffect n'exécute que le déclencheur demandé", () => {
  const CAT2 = {
    ...CAT,
    veilleur: {
      id: "veilleur", name: "Veilleur", rarity: "rare", attack: 1, defense: 1,
      effect: { on_play: "gain(2/0)", on_death: "go_bottom" }
    }
  };
  const st = deck(["caillou"]);
  const play = triggerCardEffect(CAT2, st, "a", "veilleur", "on_play");
  assert.equal(play.state.buffs.a.attack, 2);
  assert.equal(play.state.goBottom.a, false);

  const death = triggerCardEffect(CAT2, st, "a", "veilleur", "on_death");
  assert.equal(death.state.goBottom.a, true);
  assert.equal(death.state.buffs.a.attack, 0);

  const none = triggerCardEffect(CAT2, st, "a", "caillou", "on_play");
  assert.equal(none.status, "done");
  assert.deepEqual(none.state, st, "une carte sans effet ne change rien");
});

test("régression : un on_seen en cascade ne fait pas perdre les effets suivants", () => {
  // L'Espion (on_seen) est vu par look_top, PUIS mill_own doit encore
  // s'appliquer sur le bon état. Avant correctif, la cascade remplaçait
  // l'objet d'état et les écritures suivantes partaient dans le vide.
  const st = deck(["espion", "caillou", "rocher"]);
  const r = runEffect("look_top; mill_own(1); gain(1/0)", { catalog: CAT, state: st, side: "a" });
  assert.equal(r.status, "done");
  assert.equal(r.state.buffs.a.defense, 1, "le on_seen de l'Espion a bien été appliqué");
  assert.equal(r.state.buffs.a.attack, 1, "le gain APRÈS la cascade est conservé");
  assert.deepEqual(r.state.decks.a, ["caillou", "rocher"], "le mill APRÈS la cascade est conservé");
  assert.deepEqual(r.state.discards.a, ["espion"]);
});
