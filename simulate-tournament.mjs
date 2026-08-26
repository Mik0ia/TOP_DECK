// =====================================================================
// TOP DECK! — Juge externe (brief §10) : simulate-tournament
// =====================================================================
// Lance 1 000 tournois complets (2 à 16 joueurs, decks aléatoires,
// les 4 modes) en n'utilisant QUE le moteur pur (js/engine/*), et
// vérifie les invariants du brief. Chaque violation = une ligne
// d'erreur. Sortie : rapport lisible.
//
//   npm run simulate      (ou : node simulate-tournament.mjs)
// =====================================================================
import {
  createTournament, pairNextRound, reportMatchResult, applyPeriodicElimination,
  reportFinalGame, activePlayers, isFinished
} from "./js/engine/tournament.js";
import { createMatchState, playTurn, GAME_MODES } from "./js/engine/modes.js";
import { resolveRps, RPS_MOVES, mulberry32, shuffled } from "./js/engine/rps.js";
import { CARD_CATALOG } from "./js/cards.js";

const N_TOURNAMENTS = 1000;
const MAX_ROUNDS = 500; // filet anti-boucle infinie (piège §8.5)
const CARD_TYPES = Object.values(CARD_CATALOG);

const errors = [];
let totalRounds = 0, totalMatches = 0, totalRps = 0, totalByes = 0, forcedRematches = 0;
const roundsDistribution = new Map();

function err(tournamentIdx, msg) {
  errors.push(`tournoi #${tournamentIdx}: ${msg}`);
}

/** Deck aléatoire de 10 cartes du vrai catalogue du jeu. */
function randomDeck(rng) {
  return Array.from({ length: 10 }, () => CARD_TYPES[Math.floor(rng() * CARD_TYPES.length)]);
}

/** Simule un match complet ; renvoie { winner:"A"|"B", killsA, killsB, rpsRounds }. */
function simulateMatch(mode, rng) {
  const deckA = shuffled(randomDeck(rng), rng);
  const deckB = shuffled(randomDeck(rng), rng);
  let state = createMatchState(mode, 10, 10);
  let end = { ended: false };
  while (!end.ended) {
    ({ state, end } = playTurn(state, deckA[state.turn], deckB[state.turn]));
  }
  let rpsRounds = 0;
  let winner = end.winner;
  while (winner === "TIE") {
    // Chi-fou-mi : une égalité relance un tour, ne termine jamais le match.
    rpsRounds++;
    if (rpsRounds > 1000) throw new Error("chi-fou-mi sans fin (impossible)");
    const mA = RPS_MOVES[Math.floor(rng() * 3)];
    const mB = RPS_MOVES[Math.floor(rng() * 3)];
    winner = resolveRps(mA, mB);
  }
  totalRps += rpsRounds;
  return { winner, killsA: state.points.a, killsB: state.points.b, rpsRounds };
}

function simulateTournament(idx, nPlayers, mode, seed) {
  const rng = mulberry32(seed);
  const uids = Array.from({ length: nPlayers }, (_, i) => `J${i + 1}`);
  let t = createTournament(uids);

  const byesSeen = new Map(uids.map((u) => [u, 0]));
  const winsSeen = new Map(uids.map((u) => [u, 0]));
  let lastByeUid = null;
  let rounds = 0;

  while (!isFinished(t)) {
    rounds++;
    if (rounds > MAX_ROUNDS) { err(idx, "tournoi sans fin (> 500 rounds)"); return t; }

    const before = new Set(t.pastPairs);
    const pairing = pairNextRound(t, rng);
    t = pairing.t;

    // --- Invariants d'appariement ---
    if (pairing.byeUid) {
      totalByes++;
      byesSeen.set(pairing.byeUid, byesSeen.get(pairing.byeUid) + 1);
      // §9.3 : pas le même bye deux rounds de suite si un autre est éligible.
      if (pairing.byeUid === lastByeUid) {
        const others = activePlayers(t).filter(
          (u) => u !== pairing.byeUid && byesSeen.get(u) <= byesSeen.get(pairing.byeUid) - 1
        );
        if (others.length > 0) err(idx, `round ${t.round}: bye répété pour ${pairing.byeUid} alors qu'un autre était éligible`);
      }
      lastByeUid = pairing.byeUid;
      if (t.players[pairing.byeUid].status !== "ACTIVE") err(idx, "bye attribué à un joueur non actif");
    } else {
      lastByeUid = null;
    }
    const inMatches = pairing.matches.flatMap((m) => [m.a, m.b]);
    if (new Set(inMatches).size !== inMatches.length) err(idx, "un joueur apparié deux fois le même round");
    for (const u of inMatches) {
      if (t.players[u].status !== "ACTIVE") err(idx, `joueur non actif apparié : ${u}`);
    }
    if (!pairing.final) {
      const expected = activePlayers(t).length - (pairing.byeUid ? 1 : 0);
      if (inMatches.length !== expected) err(idx, `round ${t.round}: ${inMatches.length} joueurs appariés au lieu de ${expected}`);
      // Revanche seulement si consignée (dernier recours autorisé, §8.5)
      for (const m of pairing.matches) {
        const k = [m.a, m.b].sort().join("|");
        if (before.has(k) && !t.log.some((l) => l.includes(`round ${t.round}: aucun appariement inédit`))) {
          err(idx, `round ${t.round}: revanche ${k} non consignée`);
        }
        if (before.has(k)) forcedRematches++;
      }
    }

    // --- Joue les matchs du round ---
    for (const m of pairing.matches) {
      totalMatches++;
      const res = simulateMatch(mode, rng);
      const winnerUid = res.winner === "A" ? m.a : m.b;
      const loserUid = res.winner === "A" ? m.b : m.a;
      const kw = res.winner === "A" ? res.killsA : res.killsB;
      const kl = res.winner === "A" ? res.killsB : res.killsA;
      if (pairing.final) {
        t = reportFinalGame(t, winnerUid, kw, kl);
      } else {
        const crownsBefore = t.players[winnerUid].crowns;
        t = reportMatchResult(t, winnerUid, loserUid, kw, kl);
        if (t.players[winnerUid].crowns !== crownsBefore + 1) err(idx, "le vainqueur n'a pas gagné exactement 1 couronne");
        winsSeen.set(winnerUid, winsSeen.get(winnerUid) + 1);
      }
    }

    // --- Élimination périodique (rounds 3, 6, 9…) ---
    if (!pairing.final) {
      const activesBefore = activePlayers(t).length;
      t = applyPeriodicElimination(t, rng);
      const eliminated = activesBefore - activePlayers(t).length;
      if (t.round % 3 === 0 && activesBefore > 2 && eliminated !== 1) {
        err(idx, `round ${t.round}: élimination périodique attendue (1), obtenue (${eliminated})`);
      }
      if (t.round % 3 !== 0 && eliminated !== 0) {
        err(idx, `round ${t.round}: élimination périodique hors round multiple de 3`);
      }
    }
  }

  // --- Invariants de fin ---
  const champs = Object.keys(t.players).filter((u) => u === t.championUid);
  if (champs.length !== 1 || !t.championUid) err(idx, "pas exactement un champion");
  if (t.players[t.championUid].status !== "ACTIVE") err(idx, "champion non actif");
  // Couronnes = victoires de rounds (+1 pour le titre, ajoutée par reportFinalGame)
  for (const u of uids) {
    const expected = winsSeen.get(u) + (u === t.championUid ? 1 : 0);
    if (t.players[u].crowns !== expected) {
      err(idx, `couronnes de ${u} : ${t.players[u].crowns} au lieu de ${expected}`);
    }
  }
  const score = Object.values(t.finalScore);
  if (Math.max(...score) !== 3) err(idx, "la finale ne s'est pas arrêtée à exactement 3 victoires");

  totalRounds += rounds;
  roundsDistribution.set(nPlayers, (roundsDistribution.get(nPlayers) || 0) + rounds);
  return t;
}

// =====================================================================
console.log(`Simulation de ${N_TOURNAMENTS} tournois (2 à 16 joueurs, modes ${GAME_MODES.join("/")})…\n`);
let exceptions = 0;
const perSize = new Map();
for (let i = 0; i < N_TOURNAMENTS; i++) {
  const nPlayers = 2 + (i % 15); // 2..16
  const mode = GAME_MODES[i % GAME_MODES.length];
  perSize.set(nPlayers, (perSize.get(nPlayers) || 0) + 1);
  try {
    simulateTournament(i, nPlayers, mode, 1000 + i);
  } catch (e) {
    exceptions++;
    errors.push(`tournoi #${i} (${nPlayers} joueurs, ${mode}): EXCEPTION ${e.message}`);
  }
}

console.log("================ RAPPORT ================");
console.log(`Tournois joués            : ${N_TOURNAMENTS}`);
console.log(`Tournois sans fin         : ${errors.filter((e) => e.includes("sans fin")).length}`);
console.log(`Exceptions                : ${exceptions}`);
console.log(`Matchs simulés            : ${totalMatches}`);
console.log(`Rounds joués (total)      : ${totalRounds} (moyenne ${(totalRounds / N_TOURNAMENTS).toFixed(1)}/tournoi)`);
console.log(`Byes attribués            : ${totalByes}`);
console.log(`Départages chi-fou-mi     : ${totalRps}`);
console.log(`Revanches en dernier recours (consignées) : ${forcedRematches}`);
console.log(`Violations de règles      : ${errors.length}`);
if (errors.length) {
  console.log("\n--- ERREURS ---");
  errors.slice(0, 50).forEach((e) => console.log("  ✗ " + e));
  if (errors.length > 50) console.log(`  … et ${errors.length - 50} autres`);
  process.exit(1);
} else {
  console.log("\n✔ 0 tournoi sans fin, 0 exception, un seul champion à chaque fois,");
  console.log("✔ aucune violation des règles de §4.3 détectée.");
}
