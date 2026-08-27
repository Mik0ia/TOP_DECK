// =====================================================================
// TOP DECK! — Résolution complète d'un tour (fonctions PURES)
// =====================================================================
// Enchaîne, dans l'ordre :
//   1. révélation des deux cartes du dessus ;
//   2. effets `on_play` (camp A puis camp B) ;
//   3. clash, avec les statistiques MODIFIÉES par les gains ;
//   4. effets `on_death` des cartes tuées ;
//   5. rangement : chaque carte jouée va à la défausse, sauf si son
//      camp a déclenché `go_bottom` (elle passe sous le deck) ;
//   6. test de fin de match (moteur de modes existant).
//
// Certains effets demandent un choix au joueur. Comme dans
// js/engine/effects.js, on utilise le REJEU DÉTERMINISTE : la fonction
// est relancée depuis le début avec les réponses déjà données. Tant
// qu'il manque une réponse, elle renvoie `status: "waiting"` avec la
// demande et la clé de l'étape concernée.
//
// Les réponses sont rangées par clé d'étape (`answers[stepKey]`), donc
// stables : les deux clients rejouent le même tour et obtiennent
// exactement le même résultat.
// =====================================================================
import { resolveClash } from "./clash.js";
import { checkEndOfMatch } from "./modes.js";
import { createEffectState, triggerCardEffect } from "./effects.js";
import { hashString } from "./rps.js";

/** Clé d'étape : identifie un point de décision dans le tour. */
export function stepKey(turn, trigger, side) {
  return `t${turn}_${trigger}_${side}`;
}

function buffedCard(catalog, typeId, buff) {
  const c = catalog[typeId];
  if (!c) return { attack: 0, defense: 0 };
  return {
    attack: Math.max(0, c.attack + (buff?.attack || 0)),
    defense: Math.max(0, c.defense + (buff?.defense || 0))
  };
}

/**
 * @param {object} catalog CARD_CATALOG
 * @param {object} match   { mode, turn, points, hp, aDeck, bDeck, aDiscard, bDiscard }
 * @param {object} answers { [stepKey]: [réponse, …] }
 * @param {number} seed    graine pour les mélanges (search)
 * @returns {{status:"waiting", request, stepKey, side} | {status:"done", result}}
 */
export function resolveFullTurn(catalog, match, answers = {}, seed = 0) {
  const aTop = match.aDeck?.[0] ?? null;
  const bTop = match.bDeck?.[0] ?? null;
  const turn = match.turn ?? 0;

  // Les cartes jouées quittent le deck ; les effets travaillent sur le
  // RESTE du deck (une carte ne peut pas se piocher elle-même).
  let fx = createEffectState(
    { a: (match.aDeck || []).slice(1), b: (match.bDeck || []).slice(1) },
    { a: match.aDiscard || [], b: match.bDiscard || [] },
    { a: aTop, b: bTop }
  );

  const seedFor = (label) => (seed ^ hashString(label)) >>> 0;

  // ---- 2. Effets on_play : A puis B (ordre fixe = déterminisme) ----
  for (const side of ["a", "b"]) {
    const typeId = side === "a" ? aTop : bTop;
    if (!typeId) continue;
    const key = stepKey(turn, "on_play", side);
    const res = triggerCardEffect(catalog, fx, side, typeId, "on_play", answers[key] || [], seedFor(key));
    if (res.status === "waiting") {
      return { status: "waiting", request: res.request, stepKey: key, side };
    }
    fx = res.state;
  }

  // ---- 3. Clash, avec les gains appliqués ----
  const cardA = buffedCard(catalog, aTop, fx.buffs.a);
  const cardB = buffedCard(catalog, bTop, fx.buffs.b);
  const clash = aTop && bTop
    ? resolveClash(cardA, cardB)
    : { aKillsB: false, bKillsA: false, pointsA: 0, pointsB: 0 };

  const dead = { a: clash.bKillsA, b: clash.aKillsB };

  // ---- 4. Effets on_death des cartes tuées (A puis B) ----
  for (const side of ["a", "b"]) {
    if (!dead[side]) continue;
    const typeId = side === "a" ? aTop : bTop;
    const key = stepKey(turn, "on_death", side);
    const res = triggerCardEffect(catalog, fx, side, typeId, "on_death", answers[key] || [], seedFor(key));
    if (res.status === "waiting") {
      return { status: "waiting", request: res.request, stepKey: key, side };
    }
    fx = res.state;
  }

  // ---- 5. Rangement des cartes jouées ----
  // Règle de base : toute carte jouée va à la défausse, tuée ou non.
  // Exception : `go_bottom` la renvoie sous le deck.
  const decks = { a: [...fx.decks.a], b: [...fx.decks.b] };
  const discards = { a: [...fx.discards.a], b: [...fx.discards.b] };
  const placement = { a: null, b: null };

  for (const side of ["a", "b"]) {
    const typeId = side === "a" ? aTop : bTop;
    if (!typeId) continue;
    if (fx.goBottom[side]) {
      decks[side] = [...decks[side], typeId];
      placement[side] = "deck_bottom";
    } else {
      discards[side] = [typeId, ...discards[side]]; // index 0 = dessus de la défausse
      placement[side] = "discard";
    }
  }

  // ---- 6. Points, PV, fin de match ----
  const points = {
    a: (match.points?.a || 0) + clash.pointsA,
    b: (match.points?.b || 0) + clash.pointsB
  };
  const hp = match.hp
    ? {
        a: Math.max(0, match.hp.a - clash.pointsB),
        b: Math.max(0, match.hp.b - clash.pointsA)
      }
    : null;

  const nextState = {
    mode: match.mode,
    turn: turn + 1,
    points,
    hp,
    cardsLeft: { a: decks.a.length, b: decks.b.length },
    discard: { a: discards.a.length, b: discards.b.length }
  };
  const end = checkEndOfMatch(nextState);

  return {
    status: "done",
    result: {
      decks,
      discards,
      points,
      hp,
      turn: turn + 1,
      cardsLeft: nextState.cardsLeft,
      discardCounts: nextState.discard,
      clash: {
        aCard: aTop,
        bCard: bTop,
        aKillsB: clash.aKillsB,
        bKillsA: clash.bKillsA,
        // Statistiques réellement utilisées (effets compris) : c'est ce
        // que l'interface doit afficher, pas les valeurs du catalogue.
        aStats: cardA,
        bStats: cardB,
        aBuff: fx.buffs.a,
        bBuff: fx.buffs.b,
        aPlacement: placement.a,
        bPlacement: placement.b
      },
      effectLog: [],
      end
    }
  };
}
