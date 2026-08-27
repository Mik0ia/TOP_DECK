// Test d'intégration du PROTOCOLE de match (hors navigateur).
// Rejoue la mécanique implémentée dans js/game.js — révélation
// simultanée, idempotence de la résolution, chi-fou-mi commit-reveal —
// sur un document de match simulé, pour vérifier que le protocole
// converge et qu'aucune valeur de carte cachée n'est exposée.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { playTurn, createMatchState, startingHp } from "../js/engine/modes.js";
import { resolveRps } from "../js/engine/rps.js";
import { spectatorView } from "../js/engine/spectate.js";
import { CARD_CATALOG } from "../js/cards.js";

const sha256 = (s) => createHash("sha256").update(s).digest("hex");
const TYPES = Object.keys(CARD_CATALOG);

function newMatch(mode, aDeck, bDeck) {
  const hp = startingHp(mode);
  return {
    id: "m1", a: "alice", b: "bob", mode, status: "playing",
    aDeck, bDeck, turn: 0, aPlayed: 0, bPlayed: 0,
    points: { a: 0, b: 0 },
    hp: hp === null ? null : { a: hp, b: hp },
    cardsLeft: { a: aDeck.length, b: bDeck.length },
    discard: { a: 0, b: 0 },
    lastClash: null, rps: null, rpsLastResult: null, winner: null, endReason: null
  };
}

// Résolution telle que codée dans game.js (maybeResolveTurn) : calculée
// depuis l'état ABSOLU du document, donc idempotente.
function resolveTurn(m) {
  const { state, clash, end } = playTurn(
    { mode: m.mode, turn: m.turn, points: m.points, hp: m.hp, cardsLeft: m.cardsLeft, discard: m.discard },
    CARD_CATALOG[m.aDeck[m.turn]], CARD_CATALOG[m.bDeck[m.turn]]
  );
  const next = {
    ...m, turn: state.turn, points: state.points, hp: state.hp,
    cardsLeft: state.cardsLeft, discard: state.discard,
    lastClash: { aCard: m.aDeck[m.turn], bCard: m.bDeck[m.turn], aKillsB: clash.aKillsB, bKillsA: clash.bKillsA }
  };
  if (end.ended) {
    if (end.winner === "TIE") { next.status = "rps"; next.rps = { round: 1 }; }
    else { next.status = "finished"; next.winner = end.winner === "A" ? m.a : m.b; next.endReason = end.reason; }
  }
  return next;
}

test("protocole : un tour ne se résout QUE lorsque les deux ont joué", () => {
  const m = newMatch("SURVIE", ["tour", "slime"], ["slime", "tour"]);
  const bothPlayed = (x) => x.aPlayed > x.turn && x.bPlayed > x.turn;
  assert.equal(bothPlayed(m), false, "personne n'a joué");
  m.aPlayed = 1;
  assert.equal(bothPlayed(m), false, "alice seule a joué : pas de révélation");
  m.bPlayed = 1;
  assert.equal(bothPlayed(m), true, "les deux ont joué : révélation");
});

test("protocole : la résolution est idempotente (course de clics, piège §8.2)", () => {
  const m = newMatch("PV_5", TYPES.slice(0, 6), TYPES.slice(0, 6).reverse());
  m.aPlayed = 1; m.bPlayed = 1;
  const r1 = resolveTurn(m);
  const r2 = resolveTurn(m); // second appel concurrent sur le MÊME état
  assert.deepEqual(r1.points, r2.points);
  assert.deepEqual(r1.hp, r2.hp);
  assert.equal(r1.turn, r2.turn, "deux résolutions du même tour donnent le même état");
});

test("protocole : un match complet se termine toujours, decks de 10 cartes, les 4 modes", () => {
  for (const mode of ["SURVIE", "PV_5", "PV_7", "PV_10"]) {
    for (let seed = 0; seed < 200; seed++) {
      const aDeck = Array.from({ length: 10 }, (_, i) => TYPES[(seed + i * 3) % TYPES.length]);
      const bDeck = Array.from({ length: 10 }, (_, i) => TYPES[(seed * 2 + i * 5) % TYPES.length]);
      let m = newMatch(mode, aDeck, bDeck);
      let guard = 0;
      while (m.status === "playing") {
        if (++guard > 20) assert.fail("match qui ne se termine pas");
        m.aPlayed = m.turn + 1; m.bPlayed = m.turn + 1;
        m = resolveTurn(m);
      }
      assert.ok(["finished", "rps"].includes(m.status));
      if (m.status === "finished") assert.ok(["alice", "bob"].includes(m.winner));
    }
  }
});

test("protocole : chi-fou-mi commit-reveal — le choix ne peut pas être changé après coup", () => {
  const salt = "sel-aleatoire";
  const engagement = sha256(`pierre|${salt}`);
  // Révélation honnête : le hash correspond.
  assert.equal(sha256(`pierre|${salt}`), engagement);
  // Tricherie : révéler un autre coup ne correspond plus à l'engagement.
  assert.notEqual(sha256(`feuille|${salt}`), engagement, "impossible de changer de coup après engagement");
});

test("protocole : une égalité au chi-fou-mi relance un tour et finit par désigner un vainqueur", () => {
  let round = 1, result = "TIE", guard = 0;
  const moves = ["pierre", "pierre", "pierre", "feuille"];
  while (result === "TIE") {
    if (++guard > 50) assert.fail("chi-fou-mi sans fin");
    result = resolveRps(moves[Math.min(round - 1, 3)], "pierre");
    if (result === "TIE") round++;
  }
  assert.ok(["A", "B"].includes(result));
  assert.ok(round > 1, "les égalités ont bien relancé des tours");
});

test("protocole : pendant un tour incomplet, la vue spectateur ne contient aucune carte en attente", () => {
  const m = newMatch("PV_7", TYPES.slice(0, 5), TYPES.slice(2, 7));
  m.aPlayed = 1; // alice a joué, bob non : carte d'alice FACE CACHÉE
  const v = spectatorView(m);
  const raw = JSON.stringify(v);
  assert.equal(v.aPlayedThisTurn, true);
  assert.equal(v.bPlayedThisTurn, false);
  assert.ok(!raw.includes(m.aDeck[0]) || v.lastClash !== null, "la carte en attente ne doit pas apparaître");
  assert.equal(v.lastClash, null);
  assert.ok(!("aDeck" in v) && !("bDeck" in v));
});

// ---------------------------------------------------------------
// Régression : chi-fou-mi bloqué sur égalité
// ---------------------------------------------------------------
// Cause du bug : Firestore FUSIONNE les maps imbriquées quand on écrit
// avec { merge: true }. Écrire `rps: { round: 2 }` laissait les
// engagements et les coups du tour 1 en place → le joueur restait
// "déjà engagé" (aucun bouton) et la résolution rejouait les mêmes
// coups en boucle. Le correctif remet TOUS les champs à null.

/** Reproduit la sémantique de merge de Firestore sur les maps. */
function firestoreMerge(doc, patch) {
  const out = { ...doc };
  for (const [k, v] of Object.entries(patch)) {
    if (v && typeof v === "object" && !Array.isArray(v) && out[k] && typeof out[k] === "object" && !Array.isArray(out[k])) {
      out[k] = firestoreMerge(out[k], v); // map imbriquée => fusion
    } else {
      out[k] = v;
    }
  }
  return out;
}

function freshRpsRound(round) {
  return { round, startedAt: Date.now(), aHash: null, bHash: null, aChoice: null, bChoice: null, aSalt: null, bSalt: null };
}

test("régression : un nouveau tour de chi-fou-mi efface bien les coups du tour précédent", () => {
  const round1 = {
    rps: { round: 1, startedAt: 1, aHash: "h1", bHash: "h2", aChoice: "pierre", bChoice: "pierre", aSalt: "s1", bSalt: "s2" }
  };
  // ❌ L'ancien code écrivait seulement { round, startedAt } :
  const buggy = firestoreMerge(round1, { rps: { round: 2, startedAt: 2 } });
  assert.equal(buggy.rps.aChoice, "pierre", "démontre le bug : les coups survivaient à la fusion");
  assert.equal(buggy.rps.aHash, "h1");

  // ✅ Le correctif remet tout à null :
  const fixed = firestoreMerge(round1, { rps: freshRpsRound(2) });
  assert.equal(fixed.rps.round, 2);
  for (const f of ["aHash", "bHash", "aChoice", "bChoice", "aSalt", "bSalt"]) {
    assert.equal(fixed.rps[f], null, `${f} doit être effacé au nouveau tour`);
  }
});

test("régression : plusieurs égalités d'affilée finissent par désigner un vainqueur", () => {
  let doc = { rps: freshRpsRound(1) };
  const scripted = [["pierre", "pierre"], ["feuille", "feuille"], ["ciseaux", "pierre"]];
  let result = "TIE", guard = 0;
  for (const [ma, mb] of scripted) {
    if (++guard > 10) assert.fail("boucle");
    doc = firestoreMerge(doc, { rps: { aChoice: ma, bChoice: mb } });
    result = resolveRps(doc.rps.aChoice, doc.rps.bChoice);
    if (result === "TIE") {
      doc = firestoreMerge(doc, { rps: freshRpsRound(doc.rps.round + 1) });
      // Au nouveau tour, les DEUX joueurs peuvent rejouer :
      assert.equal(doc.rps.aChoice, null);
      assert.equal(doc.rps.bChoice, null);
    }
  }
  assert.equal(result, "B", "ciseaux perd contre pierre");
  assert.equal(doc.rps.round, 3, "deux égalités ont bien relancé deux tours");
});
