// =====================================================================
// TOP DECK! — Interpréteur des effets de cartes (fonctions PURES)
// =====================================================================
// Exécute l'AST produit par effect-parser.js sur un état de jeu.
//
// MODÈLE D'EXÉCUTION : « rejeu déterministe »
// -------------------------------------------
// Certains effets demandent un CHOIX au joueur (scry, organize_own,
// organize_opp, search). Comme l'état vit dans Firestore et que la
// résolution doit être recalculable à l'identique par les deux clients,
// on n'interrompt pas vraiment l'exécution : on la REJOUE.
//
//   - `runEffect(program, env)` déroule le programme du début ;
//   - chaque effet interactif consomme la réponse suivante de
//     `env.answers` (un tableau) ;
//   - s'il n'y a plus de réponse disponible, l'exécution s'arrête et
//     renvoie `{ status: "waiting", request }` décrivant le choix à
//     poser au joueur ;
//   - le client affiche la demande, le joueur répond, la réponse est
//     ajoutée au tableau, et on relance `runEffect` depuis le début.
//
// Comme tout est pur et déterministe (le mélange utilise un RNG seedé),
// rejouer donne exactement le même déroulé jusqu'au choix suivant.
// Avantage : aucun état d'exécution à sérialiser, juste une liste de
// réponses — et les deux joueurs peuvent vérifier le résultat.
// =====================================================================
import { parseEffect } from "./effect-parser.js";
import { mulberry32, shuffled } from "./rps.js";

/** Profondeur maximale de déclenchements en cascade (on_seen). */
const MAX_DEPTH = 3;

/** Normalise une chaîne pour les comparaisons (casse et accents). */
function norm(str) {
  return String(str)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function otherSide(side) {
  return side === "a" ? "b" : "a";
}

/**
 * Etat de jeu manipulé par les effets. Volontairement plat et
 * sérialisable (il vit dans le document de match Firestore).
 *
 * {
 *   decks:    { a: [typeId…], b: [...] },   // index 0 = dessus du deck
 *   discards: { a: [typeId…], b: [...] },   // index 0 = dessus de la défausse
 *   played:   { a: typeId|null, b: … },     // carte jouée ce tour
 *   buffs:    { a: {attack,defense}, b: … },// gains de la carte jouée
 *   goBottom: { a: bool, b: bool }          // meurt -> sous le deck
 * }
 */
export function createEffectState(decks, discards, played) {
  return {
    decks: { a: [...(decks.a || [])], b: [...(decks.b || [])] },
    discards: { a: [...(discards?.a || [])], b: [...(discards?.b || [])] },
    played: { a: played?.a ?? null, b: played?.b ?? null },
    buffs: { a: { attack: 0, defense: 0 }, b: { attack: 0, defense: 0 } },
    goBottom: { a: false, b: false }
  };
}

// ---------------------------------------------------------------
// Résolution des chemins de variables (card.name, self.attack…)
// ---------------------------------------------------------------
function cardView(catalog, typeId, buff) {
  const c = typeId ? catalog[typeId] : null;
  if (!c) return null;
  return {
    id: c.id,
    name: c.name,
    rarity: c.rarity,
    attack: c.attack + (buff?.attack || 0),
    defense: c.defense + (buff?.defense || 0),
    effect: c.effect ? JSON.stringify(c.effect) : ""
  };
}

function resolvePath(path, env) {
  const [root, attr] = path;
  const { catalog, state, side } = env;
  const foe = otherSide(side);

  // Raccourcis numériques
  if (root === "my") {
    if (attr === "deck_size") return state.decks[side].length;
    if (attr === "discard_size") return state.discards[side].length;
  }
  if (root === "their") {
    if (attr === "deck_size") return state.decks[foe].length;
    if (attr === "discard_size") return state.discards[foe].length;
  }

  let card = null;
  if (root === "card") card = env.seen;                                    // dernière carte regardée
  else if (root === "self") card = cardView(catalog, env.selfId, state.buffs[side]);
  else if (root === "opp") {
    if (attr === "deck_size") return state.decks[foe].length;
    if (attr === "discard_size") return state.discards[foe].length;
    card = cardView(catalog, state.played[foe], state.buffs[foe]);
  } else {
    return undefined;
  }

  if (!card) return null;
  if (attr === undefined) return card.name;
  return card[attr];
}

function evaluate(node, env) {
  switch (node.type) {
    case "literal":
      return node.value;
    case "path":
      return resolvePath(node.path, env);
    case "truthy": {
      const v = evaluate(node.value, env);
      return !(v === null || v === undefined || v === false || v === 0 || v === "");
    }
    case "not":
      return !evaluate(node.value, env);
    case "logic": {
      const l = evaluate(node.left, env);
      return node.op === "and" ? l && evaluate(node.right, env) : l || evaluate(node.right, env);
    }
    case "compare": {
      let l = evaluate(node.left, env);
      let r = evaluate(node.right, env);
      // Comparaison de textes tolérante (casse et accents) : la carte
      // s'appelle "Caillou" mais on écrit souvent card.name == "caillou".
      if (typeof l === "string" || typeof r === "string") {
        if (node.op === "==" || node.op === "!=") {
          const eq = norm(l ?? "") === norm(r ?? "");
          return node.op === "==" ? eq : !eq;
        }
      }
      switch (node.op) {
        case "==": return l === r;
        case "!=": return l !== r;
        case ">": return l > r;
        case "<": return l < r;
        case ">=": return l >= r;
        case "<=": return l <= r;
        default: return false;
      }
    }
    default:
      return false;
  }
}

// ---------------------------------------------------------------
// Signal interne d'attente d'un choix joueur
// ---------------------------------------------------------------
class NeedChoice {
  constructor(request) { this.request = request; }
}

// ---------------------------------------------------------------
// Exécution
// ---------------------------------------------------------------
/**
 * @param {string|Array} program  source du mini-langage, ou AST
 * @param {object} opts
 *   catalog  : CARD_CATALOG
 *   state    : état créé par createEffectState (non muté)
 *   side     : "a" | "b" — le camp qui déclenche l'effet
 *   selfId   : typeId de la carte qui porte l'effet
 *   answers  : réponses déjà fournies aux effets interactifs
 *   seed     : entier, pour les mélanges (search)
 * @returns {{ status:"done"|"waiting", state, log, request?, answersUsed }}
 */
export function runEffect(program, opts) {
  const ast = typeof program === "string" ? parseEffect(program) : program || [];
  const env = {
    catalog: opts.catalog,
    state: structuredClone(opts.state),
    side: opts.side,
    selfId: opts.selfId ?? null,
    seen: null,
    answers: opts.answers || [],
    answerIndex: 0,
    log: [],
    depth: opts.depth || 0,
    rng: mulberry32((opts.seed ?? 1) >>> 0)
  };

  try {
    execBlock(ast, env);
  } catch (err) {
    if (err instanceof NeedChoice) {
      return {
        status: "waiting",
        state: opts.state,           // état INCHANGÉ tant que le choix n'est pas fait
        log: env.log,
        request: err.request,
        answersUsed: env.answerIndex
      };
    }
    throw err;
  }
  return { status: "done", state: env.state, log: env.log, answersUsed: env.answerIndex };
}

function execBlock(nodes, env) {
  for (const node of nodes) execNode(node, env);
}

function execNode(node, env) {
  if (node.type === "seq") return execBlock(node.body, env);
  if (node.type === "if") {
    if (evaluate(node.test, env)) execBlock(node.then, env);
    else if (node.else) execBlock(node.else, env);
    return;
  }
  if (node.type === "call") return execCall(node, env);
}

/** Consomme la réponse suivante, ou demande le choix au joueur. */
function nextAnswer(env, request) {
  if (env.answerIndex < env.answers.length) {
    return env.answers[env.answerIndex++];
  }
  throw new NeedChoice({ ...request, index: env.answerIndex });
}

/**
 * Marque une carte comme « regardée » : déclenche son on_seen et la
 * rend disponible dans les conditions via `card.*`.
 */
function see(typeId, env) {
  const card = cardView(env.catalog, typeId, null);
  env.seen = card;
  if (!card) return;
  env.log.push({ type: "seen", card: typeId, side: env.side });

  const def = env.catalog[typeId];
  if (def?.effect?.on_seen && env.depth < MAX_DEPTH) {
    // L'effet on_seen s'exécute pour le camp qui REGARDE, mais la carte
    // vue est le `self` de cet effet.
    const sub = runEffect(def.effect.on_seen, {
      catalog: env.catalog,
      state: env.state,
      side: env.side,
      selfId: typeId,
      answers: env.answers.slice(env.answerIndex),
      seed: Math.floor(env.rng() * 2 ** 31),
      depth: env.depth + 1
    });
    if (sub.status === "waiting") {
      throw new NeedChoice({ ...sub.request, index: env.answerIndex + (sub.request.index || 0) });
    }
    env.answerIndex += sub.answersUsed;
    // ⚠️ On recopie le contenu au lieu de remplacer l'objet : du code
    // appelant garde des références vers env.state (et vers ses
    // tableaux). Remplacer la référence ferait écrire dans un objet
    // orphelin — les effets suivants seraient perdus silencieusement.
    Object.assign(env.state, sub.state);
    env.log.push(...sub.log);
  }
}

function execCall(node, env) {
  const { side } = env;
  const foe = otherSide(side);
  const x = node.args[0];
  // `state` est relu à CHAQUE usage : un on_seen déclenché par see()
  // peut avoir remplacé le contenu de l'état entre-temps.
  const state = () => env.state;

  switch (node.name) {
    // ---- Effets déterministes ----
    case "gain": {
      state().buffs[side].attack += node.args[0];
      state().buffs[side].defense += node.args[1];
      env.log.push({ type: "gain", side, attack: node.args[0], defense: node.args[1] });
      return;
    }
    case "go_bottom": {
      state().goBottom[side] = true;
      env.log.push({ type: "go_bottom", side });
      return;
    }
    case "mill_own":
      return mill(env, side, x);
    case "mill_opp":
      return mill(env, foe, x);
    case "look_top": {
      see(state().decks[side][0] ?? null, env);
      return;
    }
    case "look_bot": {
      const d = state().decks[side];
      see(d[d.length - 1] ?? null, env);
      return;
    }

    // ---- Effets interactifs ----
    case "scry": {
      const peek = state().decks[side].slice(0, x);
      if (!peek.length) return;
      peek.forEach((id) => see(id, env));
      // Le deck est RELU après les on_seen éventuels.
      const cards = state().decks[side].slice(0, x);
      // Réponse attendue : tableau des INDEX (dans `cards`) à envoyer
      // sous le deck, dans l'ordre où ils y seront placés.
      const answer = nextAnswer(env, { kind: "scry", side, cards, count: x });
      const toBottom = sanitizeIndexList(answer, cards.length);
      const kept = cards.filter((_, i) => !toBottom.includes(i));
      const bottom = toBottom.map((i) => cards[i]);
      state().decks[side] = [...kept, ...state().decks[side].slice(cards.length), ...bottom];
      env.log.push({ type: "scry", side, bottom });
      return;
    }
    case "organize_own":
      return organize(env, side, x, "organize_own");
    case "organize_opp":
      return organize(env, foe, x, "organize_opp");
    case "search": {
      if (!state().decks[side].length) return;
      state().decks[side].forEach((id) => see(id, env));
      const deck = state().decks[side];
      // Réponse : index (dans le deck) des cartes choisies, dans
      // l'ordre voulu sur le dessus.
      const answer = nextAnswer(env, { kind: "search", side, cards: [...deck], count: Math.min(x, deck.length) });
      const picked = sanitizeIndexList(answer, deck.length).slice(0, x);
      const chosen = picked.map((i) => deck[i]);
      const rest = deck.filter((_, i) => !picked.includes(i));
      state().decks[side] = [...chosen, ...shuffled(rest, env.rng)];
      env.log.push({ type: "search", side, chosen });
      return;
    }
    default:
      return;
  }
}

function mill(env, target, count) {
  const moved = env.state.decks[target].splice(0, count);
  // La défausse est empilée : la dernière défaussée est au-dessus.
  env.state.discards[target] = [...moved.slice().reverse(), ...env.state.discards[target]];
  env.log.push({ type: "mill", side: target, cards: moved });
}

function organize(env, target, count, kind) {
  const peek = env.state.decks[target].slice(0, count);
  if (!peek.length) return;
  peek.forEach((id) => see(id, env));
  const cards = env.state.decks[target].slice(0, count);
  // Réponse : permutation — ordre dans lequel les cartes sont reposées
  // sur le dessus (tableau d'index dans `cards`).
  const answer = nextAnswer(env, { kind, side: env.side, target, cards, count: cards.length });
  const order = sanitizeIndexList(answer, cards.length);
  const missing = cards.map((_, i) => i).filter((i) => !order.includes(i));
  const finalOrder = [...order, ...missing];
  env.state.decks[target] = [...finalOrder.map((i) => cards[i]), ...env.state.decks[target].slice(cards.length)];
  env.log.push({ type: kind, side: env.side, target, order: finalOrder });
}

/**
 * Nettoie une réponse joueur : garde des index valides et uniques.
 * Une réponse absurde (client modifié, bug d'UI) ne doit jamais
 * corrompre le deck — au pire l'effet ne fait rien.
 */
function sanitizeIndexList(answer, length) {
  const list = Array.isArray(answer) ? answer : [];
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    const i = Number(raw);
    if (!Number.isInteger(i) || i < 0 || i >= length || seen.has(i)) continue;
    seen.add(i);
    out.push(i);
  }
  return out;
}

// ---------------------------------------------------------------
// Déclenchement depuis le moteur de match
// ---------------------------------------------------------------
/** Le programme d'un déclencheur pour une carte, ou null. */
export function effectProgram(catalog, typeId, trigger) {
  const def = typeId ? catalog[typeId] : null;
  const src = def?.effect?.[trigger];
  return src && String(src).trim() ? src : null;
}

/**
 * Exécute le déclencheur `trigger` de la carte jouée par `side`.
 * Renvoie le même contrat que runEffect (done / waiting).
 */
export function triggerCardEffect(catalog, state, side, typeId, trigger, answers = [], seed = 1) {
  const program = effectProgram(catalog, typeId, trigger);
  if (!program) return { status: "done", state, log: [], answersUsed: 0 };
  return runEffect(program, { catalog, state, side, selfId: typeId, answers, seed });
}
