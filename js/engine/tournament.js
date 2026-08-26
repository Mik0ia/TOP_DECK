// =====================================================================
// TOP DECK! — Moteur de tournoi (fonctions PURES, brief §4.3)
// =====================================================================
// L'état du tournoi est un objet JSON simple (sérialisable Firestore) :
// {
//   round: 0,                     // dernier round apparié
//   phase: "ROUNDS" | "FINAL",
//   players: { [uid]: { crowns, killPoints, consecutiveLosses, status,
//                       byes, beaten: [uid], faced: [uid] } },
//   pastPairs: ["u1|u2", ...],    // paires déjà jouées (hors finale)
//   finalists: [u1, u2] | null,
//   finalScore: { [uid]: n } | null,   // premier à 3 (best-of-5)
//   championUid: null | uid,
//   roundByeUid: null | uid,      // joueur WAITING du round courant
//   log: ["..."]                  // tirages aléatoires & revanches consignés
// }
// status joueur : "ACTIVE" | "ELIMINATED" ("WAITING" est un état de
// round, porté par roundByeUid, pas un status persistant).
// =====================================================================
import { shuffled } from "./rps.js";

export const FINAL_WINS_NEEDED = 3; // finale : premier à 3 victoires

function pairKey(u1, u2) {
  return [u1, u2].sort().join("|");
}

export function createTournament(uids) {
  if (!Array.isArray(uids) || uids.length < 2) {
    throw new Error("Un tournoi demande au moins 2 joueurs.");
  }
  const players = {};
  uids.forEach((uid) => {
    players[uid] = {
      crowns: 0,
      killPoints: 0,
      consecutiveLosses: 0,
      status: "ACTIVE",
      byes: 0,
      beaten: [],
      faced: []
    };
  });
  return {
    round: 0,
    phase: "ROUNDS",
    players,
    pastPairs: [],
    finalists: null,
    finalScore: null,
    championUid: null,
    roundByeUid: null,
    log: []
  };
}

export function activePlayers(t) {
  return Object.keys(t.players).filter((u) => t.players[u].status === "ACTIVE");
}

// ---------------------------------------------------------------
// Appariement d'un round (rondes suisses)
// ---------------------------------------------------------------
// - groupes par couronnes ; aléatoire à l'intérieur d'un groupe ;
//   un joueur seul dans son groupe descend dans le groupe du dessous
//   (obtenu naturellement : liste triée par couronnes décroissantes,
//   appariement par backtracking qui préfère les voisins) ;
// - pas de revanche tant qu'un autre appariement existe ; en dernier
//   recours, la revanche est autorisée et CONSIGNÉE (piège §8.5) ;
// - nombre impair : bye au joueur du groupe le plus bas qui a eu le
//   moins de byes (jamais de couronne, neutre pour tout, §4.3.4).
//
// Retourne le nouvel état + { matches: [{a,b}], byeUid, final }.
export function pairNextRound(t, rng = Math.random) {
  const next = structuredClone(t);
  next.round += 1;
  next.roundByeUid = null;

  let actives = activePlayers(next);

  // Passage en finale quand il ne reste que 2 joueurs (y compris un
  // tournoi qui COMMENCE à 2 joueurs : finale directe, §7).
  if (next.phase === "ROUNDS" && actives.length === 2) {
    next.phase = "FINAL";
    next.finalists = [...actives];
    next.finalScore = { [actives[0]]: 0, [actives[1]]: 0 };
    next.log.push(`round ${next.round}: FINALE entre ${actives[0]} et ${actives[1]} (premier à ${FINAL_WINS_NEEDED})`);
  }

  if (next.phase === "FINAL") {
    const [f1, f2] = next.finalists;
    return { t: next, matches: [{ a: f1, b: f2 }], byeUid: null, final: true };
  }

  // ---- Bye éventuel (nombre impair) ----
  let byeUid = null;
  const prevByeUid = t.roundByeUid; // bye du round PRÉCÉDENT (anti-répétition)
  if (actives.length % 2 === 1) {
    // Priorité (brief §4.3.4 + §9.3) :
    //  1. le moins de byes déjà reçus (« qui n'a pas encore eu de bye ») ;
    //  2. pas le même joueur que le round précédent si un autre est
    //     éligible à égalité ;
    //  3. le groupe le plus bas (couronnes croissantes) ;
    //  4. tirage aléatoire (via le mélange préalable, sort stable).
    const candidates = shuffled(actives, rng).sort((u1, u2) => {
      const p1 = next.players[u1], p2 = next.players[u2];
      if (p1.byes !== p2.byes) return p1.byes - p2.byes;
      const r1 = u1 === prevByeUid ? 1 : 0, r2 = u2 === prevByeUid ? 1 : 0;
      if (r1 !== r2) return r1 - r2;
      return p1.crowns - p2.crowns;
    });
    byeUid = candidates[0];
    next.players[byeUid].byes += 1;
    next.roundByeUid = byeUid;
    next.log.push(`round ${next.round}: bye pour ${byeUid} (WAITING)`);
    actives = actives.filter((u) => u !== byeUid);
  }

  // ---- Liste triée : groupes de couronnes décroissantes, mélangés
  //      à l'intérieur de chaque groupe ----
  const byCrowns = new Map();
  actives.forEach((u) => {
    const c = next.players[u].crowns;
    if (!byCrowns.has(c)) byCrowns.set(c, []);
    byCrowns.get(c).push(u);
  });
  const ordered = [...byCrowns.keys()]
    .sort((a, b) => b - a)
    .flatMap((c) => shuffled(byCrowns.get(c), rng));

  // ---- Backtracking : chaque joueur prend le premier partenaire
  //      disponible dans l'ordre (donc du même groupe si possible),
  //      en évitant les revanches ----
  const past = new Set(next.pastPairs);
  const tryPair = (list, allowRematch) => {
    const used = new Array(list.length).fill(false);
    const result = [];
    const bt = () => {
      const i = used.indexOf(false);
      if (i === -1) return true;
      used[i] = true;
      for (let j = i + 1; j < list.length; j++) {
        if (used[j]) continue;
        if (!allowRematch && past.has(pairKey(list[i], list[j]))) continue;
        used[j] = true;
        result.push({ a: list[i], b: list[j] });
        if (bt()) return true;
        result.pop();
        used[j] = false;
      }
      used[i] = false;
      return false;
    };
    return bt() ? result : null;
  };

  let matches = tryPair(ordered, false);
  if (!matches) {
    // Plus aucun appariement inédit possible : revanche autorisée en
    // dernier recours, consignée (piège §8.5 + DECISIONS.md D5).
    matches = tryPair(ordered, true);
    next.log.push(`round ${next.round}: aucun appariement inédit possible, revanche(s) autorisée(s)`);
  }

  return { t: next, matches, byeUid, final: false };
}

// ---------------------------------------------------------------
// Résultat d'un match de round (hors finale)
// ---------------------------------------------------------------
// +1 couronne au vainqueur, série de défaites du perdant (3 défaites
// CONSÉCUTIVES = élimination ; un bye ne touche pas la série).
export function reportMatchResult(t, winnerUid, loserUid, killPointsWinner = 0, killPointsLoser = 0) {
  const next = structuredClone(t);
  const w = next.players[winnerUid];
  const l = next.players[loserUid];
  if (!w || !l) throw new Error("Résultat de match : joueur inconnu.");

  w.crowns += 1;
  w.consecutiveLosses = 0;
  w.killPoints += killPointsWinner;
  w.beaten.push(loserUid);
  w.faced.push(loserUid);

  l.consecutiveLosses += 1;
  l.killPoints += killPointsLoser;
  l.faced.push(winnerUid);

  next.pastPairs.push(pairKey(winnerUid, loserUid));

  if (next.phase === "ROUNDS" && l.consecutiveLosses >= 3) {
    l.status = "ELIMINATED";
    next.log.push(`élimination de ${loserUid} : 3 défaites consécutives`);
  }
  return next;
}

// ---------------------------------------------------------------
// Départage (ordre STRICT du brief §4.3.6, piège §8.8)
// ---------------------------------------------------------------
// Somme des couronnes ACTUELLES des adversaires battus (Buchholz).
export function buchholz(t, uid) {
  return t.players[uid].beaten.reduce((sum, opp) => sum + (t.players[opp]?.crowns || 0), 0);
}

/**
 * Désigne le DERNIER du classement parmi `uids` (pour l'élimination
 * périodique). Chaque étape est appliquée seule, on s'arrête à la
 * première différence :
 *  1. couronnes (moins = derrière)
 *  2. confrontation directe (uniquement s'il reste exactement 2 ex æquo)
 *  3. Buchholz (moins = derrière)
 *  4. points de kills (moins = derrière)
 *  5. tirage aléatoire CONSIGNÉ dans t.log
 * Retourne { uid, tLog } où tLog est l'état avec le log éventuel.
 */
export function worstPlayer(t, uids, rng = Math.random) {
  const next = structuredClone(t);
  let pool = [...uids];

  // 1. Couronnes
  const minCrowns = Math.min(...pool.map((u) => next.players[u].crowns));
  pool = pool.filter((u) => next.players[u].crowns === minCrowns);
  if (pool.length === 1) return { uid: pool[0], t: next };

  // 2. Confrontation directe (seulement à 2 ex æquo : sinon non transitif)
  if (pool.length === 2) {
    const [u1, u2] = pool;
    const u1BeatU2 = next.players[u1].beaten.includes(u2);
    const u2BeatU1 = next.players[u2].beaten.includes(u1);
    if (u1BeatU2 && !u2BeatU1) return { uid: u2, t: next };
    if (u2BeatU1 && !u1BeatU2) return { uid: u1, t: next };
  }

  // 3. Buchholz
  const minB = Math.min(...pool.map((u) => buchholz(next, u)));
  pool = pool.filter((u) => buchholz(next, u) === minB);
  if (pool.length === 1) return { uid: pool[0], t: next };

  // 4. Points de kills
  const minK = Math.min(...pool.map((u) => next.players[u].killPoints));
  pool = pool.filter((u) => next.players[u].killPoints === minK);
  if (pool.length === 1) return { uid: pool[0], t: next };

  // 5. Tirage aléatoire consigné
  const picked = pool[Math.floor(rng() * pool.length)];
  next.log.push(`départage aléatoire entre [${pool.join(", ")}] -> ${picked} derrière`);
  return { uid: picked, t: next };
}

/**
 * Élimination périodique : TOUS les 3 rounds (3, 6, 9…), le dernier du
 * classement est éliminé — même s'il ne reste que 3 joueurs (§7).
 * Suspendue pendant la finale. À appeler APRÈS l'application des
 * résultats du round.
 */
export function applyPeriodicElimination(t, rng = Math.random) {
  if (t.phase === "FINAL") return t;
  if (t.round % 3 !== 0) return t;
  const actives = activePlayers(t);
  if (actives.length <= 2) return t; // déjà (ou bientôt) la finale
  const { uid, t: next } = worstPlayer(t, actives, rng);
  next.players[uid].status = "ELIMINATED";
  next.log.push(`round ${next.round}: élimination périodique de ${uid} (dernier du classement)`);
  return next;
}

// ---------------------------------------------------------------
// Finale (premier à 3 victoires, éliminations suspendues)
// ---------------------------------------------------------------
export function reportFinalGame(t, winnerUid, killPointsWinner = 0, killPointsLoser = 0) {
  const next = structuredClone(t);
  if (next.phase !== "FINAL") throw new Error("reportFinalGame hors finale.");
  if (next.championUid) throw new Error("La finale est terminée (premier à 3, pas après).");
  if (!next.finalists.includes(winnerUid)) throw new Error("Vainqueur inconnu en finale.");
  const loserUid = next.finalists.find((u) => u !== winnerUid);

  next.finalScore[winnerUid] += 1;
  next.players[winnerUid].killPoints += killPointsWinner;
  next.players[loserUid].killPoints += killPointsLoser;

  if (next.finalScore[winnerUid] >= FINAL_WINS_NEEDED) {
    next.championUid = winnerUid;
    // La couronne finale : le champion gagne aussi sa couronne de match.
    next.players[winnerUid].crowns += 1;
    next.log.push(`CHAMPION : ${winnerUid} (${next.finalScore[winnerUid]}-${next.finalScore[loserUid]})`);
  }
  return next;
}

export function isFinished(t) {
  return t.championUid !== null;
}
