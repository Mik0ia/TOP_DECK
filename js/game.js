// =====================================================================
// TOP DECK! — Contrôleur de l'environnement de combat (game.html)
// =====================================================================
// Déroulé complet d'une partie (brief combat & tournoi) :
//
//  room.status :
//   "deck_select" -> chaque joueur choisit son deck (15 s, choix
//                    aléatoire au timeout, decks placeholder exclus)
//   "tournament"  -> rondes suisses : appariement par couronnes, bye,
//                    éliminations (3 défaites consécutives + le dernier
//                    tous les 3 rounds), finale au premier à 3
//   "finished"    -> champion couronné
//
//  match.status (rooms/{code}/matches/{id}) :
//   "ordering" -> deck mélangé localement, ordre des 3 premières cartes
//   "playing"  -> chaque tour, chacun joue la carte du DESSUS (aucun
//                 choix) ; carte adverse face cachée tant que les deux
//                 n'ont pas joué ; révélation simultanée puis clash
//   "rps"      -> égalité de fin de match : chi-fou-mi (commit-reveal
//                 SHA-256 : le choix ne circule qu'après les 2 engagements)
//   "finished" -> vainqueur (+1 couronne, appliquée par l'hôte)
//
// TOUTES les règles viennent du moteur pur js/engine/* (testé par
// `npm test` et `npm run simulate`) : ce fichier ne fait que du
// protocole (Firestore) et de l'affichage.
//
// Modèle d'autorité (DECISIONS.md D1) : pas de serveur applicatif.
// Le jeu étant une Bataille (jeu FORCÉ, aucun choix en cours de match),
// les résultats sont recalculables par les deux clients à l'identique ;
// le participant "a" (arbitre) écrit l'état, l'autre vérifie, et le
// seul choix secret (chi-fou-mi) est protégé par commit-reveal.
// =====================================================================
import { subscribeAuth } from "./auth.js";
import {
  subscribeRoom,
  subscribePlayers,
  subscribeMatches,
  setPlayerGameData,
  updateRoomData,
  createMatchDoc,
  updateMatchDoc,
  leaveRoom
} from "./rooms.js";
import { STARTER_DECK_ID, getDeckById, isDeckPlayable } from "./decks.js";
import { CARD_CATALOG } from "./cards.js";
import { playTurn, startingHp } from "./engine/modes.js";
import {
  resolveRps, isValidRpsMove, RPS_MOVES, hashString, mulberry32, shuffled
} from "./engine/rps.js";
import {
  createTournament, pairNextRound, reportMatchResult, applyPeriodicElimination,
  reportFinalGame, isFinished, FINAL_WINS_NEEDED
} from "./engine/tournament.js";
import { spectatorView } from "./engine/spectate.js";

// ---------------------------------------------------------------
// Constantes de protocole
// ---------------------------------------------------------------
const ORDERING_SECONDS = 15;   // ordre des 3 premières cartes
const TURN_SECONDS = 20;       // auto-jeu de la carte du dessus
const RPS_SECONDS = 25;        // temps pour choisir au chi-fou-mi
const FORFEIT_GRACE_MS = 30000; // §7 : 30 s de grâce puis forfait
const HOST_GRACE_MS = 2500;    // marge de l'hôte après une échéance
const RESOLVE_FALLBACK_MS = 1600; // le non-arbitre résout si l'arbitre tarde

const GAME_MODE_LABELS = { SURVIE: "Survie", PV_5: "5 PV", PV_7: "7 PV", PV_10: "10 PV" };
const RPS_EMOJI = { pierre: "✊", feuille: "✋", ciseaux: "✌️" };

// ---------------------------------------------------------------
// Références DOM
// ---------------------------------------------------------------
const gameRoomName = document.getElementById("gameRoomName");
const gamePhaseLabel = document.getElementById("gamePhaseLabel");
const chronoEl = document.getElementById("chrono");
const chronoNum = document.getElementById("chronoNum");
const gameMe = document.getElementById("gameMe");
const gameStage = document.getElementById("gameStage");
const btnForfeit = document.getElementById("btnForfeit");
const cardZoomOverlay = document.getElementById("cardZoomOverlay");
const cardZoomImg = document.getElementById("cardZoomImg");
const toastEl = document.getElementById("toast");

const DEFAULT_AVATAR =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="#33261a"/><circle cx="20" cy="15" r="7" fill="#D58929"/><path d="M6 36c1-9 8-13 14-13s13 4 14 13" fill="#D58929"/></svg>'
  );

// ---------------------------------------------------------------
// Etat local
// ---------------------------------------------------------------
const roomCode = new URLSearchParams(window.location.search).get("room");

let currentUser = null;
let currentProfile = null;
let room = null;
let players = [];
let matches = [];

let renderedKey = null;         // clé de la vue affichée (anti re-rendus destructeurs)
let spectatingMatchId = null;   // match regardé en spectateur (ou null)

// Gardes anti-doubles écritures
let deckLockedLocally = false;
const orderConfirmed = new Set();   // matchIds dont j'ai confirmé l'ordre
const autoOrderNotified = new Set();
const playedTurns = new Set();      // `${matchId}:${turn}` que j'ai joués
const resolvedTurns = new Set();    // `${matchId}:${turn}` résolus (écrits)
const resolveFallbacks = new Map(); // timers de résolution de secours
const rpsResolved = new Set();      // `${matchId}:${round}` résolus
const forfeitsWritten = new Set();  // matchIds où un forfait a été déclaré
const hostDone = new Set();         // étapes hôte déjà écrites ("init", "round-N")

// Phase d'ordre : position (1..3 ou null) de chacune des 3 cartes
let orderPositions = [null, null, null];
let orderMatchId = null;

// ---------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}
const escapeAttr = escapeHtml;

let toastTimer = null;
function showToast(message, type = "") {
  toastEl.textContent = message;
  toastEl.className = "toast show" + (type ? " " + type : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 3200);
}

function goToLobby() { window.location.href = "index.html"; }

function showCardZoom(src, alt) {
  cardZoomImg.src = src;
  cardZoomImg.alt = alt || "";
  cardZoomOverlay.classList.add("show");
}
function hideCardZoom() { cardZoomOverlay.classList.remove("show"); }
cardZoomOverlay.addEventListener("click", hideCardZoom);

/** SHA-256 hexadécimal (WebCrypto) — commit-reveal du chi-fou-mi. */
async function sha256Hex(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function isHost() { return !!room && !!currentUser && room.hostUid === currentUser.uid; }
function myUid() { return currentUser?.uid; }
function myPlayerDoc() { return players.find((p) => p.uid === myUid()) || null; }

function playerName(uid) {
  const p = players.find((x) => x.uid === uid);
  return p?.displayName || room?.tournamentNames?.[uid] || "Joueur parti";
}
function playerPhoto(uid) {
  const p = players.find((x) => x.uid === uid);
  return p?.photoURL || room?.tournamentPhotos?.[uid] || DEFAULT_AVATAR;
}

/** Les 10 typeIds du deck choisi par un joueur (secours : deck de départ). */
function deckTypeIds(deckId) {
  const deck = getDeckById(deckId) || getDeckById(STARTER_DECK_ID);
  return deck.cards.map((c) => c.typeId);
}

function tournament() { return room?.tournament || null; }
function currentMatchIds() { return room?.currentMatchIds || []; }
function currentMatches() {
  const ids = new Set(currentMatchIds());
  return matches.filter((m) => ids.has(m.id));
}
/** Mon match du round courant (fini ou non), ou null. */
function myCurrentMatch() {
  return currentMatches().find((m) => m.a === myUid() || m.b === myUid()) || null;
}
function myRoleIn(match) {
  if (!match || !currentUser) return null;
  if (match.a === myUid()) return "a";
  if (match.b === myUid()) return "b";
  return null;
}
function otherRole(role) { return role === "a" ? "b" : "a"; }

/** Etat moteur extrait d'un document de match. */
function engineState(match) {
  return {
    mode: match.mode,
    turn: match.turn,
    points: match.points,
    hp: match.hp,
    cardsLeft: match.cardsLeft,
    discard: match.discard
  };
}

// ---------------------------------------------------------------
// Démarrage : auth -> abonnements salle + joueurs + matchs
// ---------------------------------------------------------------
if (!roomCode) goToLobby();

let authResolved = false;
let booted = false;
subscribeAuth((user, profile) => {
  currentUser = user;
  currentProfile = profile;
  if (!authResolved) {
    authResolved = true;
    if (user) bootGame();
    return;
  }
  if (!user) { goToLobby(); return; }
  if (!booted) bootGame();
  renderMe();
});

function bootGame() {
  if (booted || !currentUser) return;
  booted = true;
  renderMe();
  setInterval(onTick, 250);

  subscribeRoom(roomCode, (r) => {
    if (!r) {
      showToast("La partie a été fermée.");
      setTimeout(goToLobby, 1500);
      return;
    }
    room = r;
    gameRoomName.textContent = r.name || r.id;
    if (r.status === "waiting") { goToLobby(); return; }
    render();
    hostMaybeAct();
  });

  subscribePlayers(roomCode, (list) => {
    players = list;
    render();
    hostMaybeAct();
  });

  subscribeMatches(roomCode, (list) => {
    matches = list;
    onMatchesUpdated();
    render();
    hostMaybeAct();
  });
}

function renderMe() {
  if (!currentProfile) return;
  gameMe.innerHTML = `
    <span class="game-me-name">${escapeHtml(currentProfile.displayName || "Joueur")}</span>
    <img src="${escapeAttr(currentProfile.photoURL || DEFAULT_AVATAR)}" alt="">
  `;
}

// ---------------------------------------------------------------
// Abandon (forfait) — brief §7 : défaite par forfait, puis élimination
// ---------------------------------------------------------------
btnForfeit.addEventListener("click", async () => {
  if (!currentUser) return goToLobby();
  const sure = window.confirm("Abandonner la partie ? Tu seras éliminé du tournoi.");
  if (!sure) return;
  btnForfeit.disabled = true;
  try {
    const m = myCurrentMatch();
    if (m && m.status !== "finished") {
      const role = myRoleIn(m);
      await updateMatchDoc(roomCode, m.id, {
        status: "finished",
        winner: role === "a" ? m.b : m.a,
        endReason: "FORFEIT",
        forfeitedUid: myUid()
      });
    }
    // Signale le forfait à l'hôte (élimination au prochain passage).
    await updateRoomData(roomCode, { forfeits: { [myUid()]: true } });
    await leaveRoom(roomCode, myUid());
  } catch (e) { /* la salle est peut-être déjà fermée */ }
  goToLobby();
});

// ===============================================================
// CHRONO & ACTIONS AUTOMATIQUES (tick 250 ms)
// ===============================================================
function currentDeadline() {
  if (!room) return null;
  if (room.status === "deck_select") return room.phaseEndsAt || null;
  if (room.status === "tournament" && !spectatingMatchId) {
    const m = myCurrentMatch();
    if (!m || m.status === "finished") return null;
    if (m.status === "ordering") return m.orderingEndsAt || null;
    if (m.status === "playing") return (m.turnStartedAt || 0) + TURN_SECONDS * 1000;
    if (m.status === "rps") return (m.rps?.startedAt || 0) + RPS_SECONDS * 1000;
  }
  return null;
}

function onTick() {
  const deadline = currentDeadline();
  if (!deadline) {
    chronoEl.style.display = "none";
  } else {
    const remainingMs = deadline - Date.now();
    chronoEl.style.display = "grid";
    chronoNum.textContent = Math.max(0, Math.ceil(remainingMs / 1000));
    chronoEl.classList.toggle("urgent", remainingMs <= 5000 && remainingMs > 0);
  }

  if (!room) return;

  // --- Fin de chrono : actions locales ---
  if (room.status === "deck_select" && room.phaseEndsAt && Date.now() >= room.phaseEndsAt) {
    autoLockRandomDeck();
  }
  if (room.status === "tournament") {
    const m = myCurrentMatch();
    if (m && m.status === "ordering" && m.orderingEndsAt && Date.now() >= m.orderingEndsAt) {
      autoConfirmRandomOrder(m);
    }
    if (m && m.status === "playing") {
      const turnDeadline = (m.turnStartedAt || 0) + TURN_SECONDS * 1000;
      if (Date.now() >= turnDeadline) autoPlayMyCard(m);
    }
    maybeDeclareForfeit(m);
  }

  hostMaybeAct();
}

/** Forfait de l'adversaire absent : 30 s de grâce après l'échéance (§7). */
function maybeDeclareForfeit(m) {
  if (!m || m.status === "finished" || forfeitsWritten.has(m.id)) return;
  const role = myRoleIn(m);
  if (!role) return;
  const opp = otherRole(role);

  let oppLateSince = null;
  if (m.status === "ordering" && !m[`${opp}Ready`] && m.orderingEndsAt) {
    oppLateSince = m.orderingEndsAt;
  } else if (m.status === "playing" && (m[`${opp}Played`] || 0) <= m.turn && m.turnStartedAt) {
    oppLateSince = m.turnStartedAt + TURN_SECONDS * 1000;
  } else if (m.status === "rps" && m.rps) {
    const oppEngaged = m.rps[`${opp}Hash`];
    if (!oppEngaged && m.rps.startedAt) oppLateSince = m.rps.startedAt + RPS_SECONDS * 1000;
  }
  if (oppLateSince && Date.now() >= oppLateSince + FORFEIT_GRACE_MS) {
    forfeitsWritten.add(m.id);
    updateMatchDoc(roomCode, m.id, {
      status: "finished",
      winner: myUid(),
      endReason: "FORFEIT",
      forfeitedUid: m[opp]
    }).catch((e) => { forfeitsWritten.delete(m.id); console.error(e); });
  }
}

// ===============================================================
// RENDU — routeur de vues
// ===============================================================
function render() {
  if (!room || !currentUser) return;

  // Clé de vue : on ne reconstruit le DOM que si la SITUATION change ;
  // les mises à jour "à chaud" (scores, listes) sont faites par des
  // fonctions update* ciblées.
  let key = room.status;
  if (room.status === "tournament") {
    if (spectatingMatchId) {
      key += `:spectate:${spectatingMatchId}`;
    } else {
      const m = myCurrentMatch();
      const t = tournament();
      const me = t?.players?.[myUid()];
      if (me?.status === "ELIMINATED") key += `:eliminated:${room.round}`;
      else if (m) key += `:match:${m.id}:${m.status}:${m.winner || ""}`;
      else if (room.roundByeUid === myUid()) key += `:bye:${room.round}`;
      else key += `:standby:${room.round}`;
    }
  }

  if (key !== renderedKey) {
    renderedKey = key;
    hideCardZoom();
    renderView();
  } else {
    updateView();
  }
}

function renderView() {
  if (room.status === "deck_select") {
    gamePhaseLabel.textContent = "Choix du deck";
    renderDeckSelect();
    return;
  }
  if (room.status === "finished") {
    gamePhaseLabel.textContent = "Tournoi terminé";
    renderChampion();
    return;
  }
  if (room.status === "tournament") {
    if (spectatingMatchId) {
      gamePhaseLabel.textContent = "Spectateur";
      renderSpectate();
      return;
    }
    const m = myCurrentMatch();
    const t = tournament();
    const me = t?.players?.[myUid()];
    if (me?.status === "ELIMINATED") { gamePhaseLabel.textContent = "Éliminé"; renderEliminated(); return; }
    if (m) {
      if (m.status === "ordering") { gamePhaseLabel.textContent = `Round ${room.round} — Préparation`; renderOrdering(m); return; }
      if (m.status === "playing" || m.status === "rps") {
        gamePhaseLabel.textContent = m.isFinal ? "FINALE" : `Round ${room.round}`;
        renderMatchBoard(m);
        return;
      }
      if (m.status === "finished") { gamePhaseLabel.textContent = `Round ${room.round}`; renderMatchResult(m); return; }
    }
    if (room.roundByeUid === myUid()) { gamePhaseLabel.textContent = `Round ${room.round} — En attente`; renderBye(); return; }
    gamePhaseLabel.textContent = `Round ${room.round}`;
    renderStandby();
  }
}

/** Mises à jour à chaud (sans reconstruire le DOM). */
function updateView() {
  updateWaitingList();
  updateStandingsPanel();
  updateLiveMatchesPanel();
  if (room.status === "tournament") {
    if (spectatingMatchId) {
      const m = matches.find((x) => x.id === spectatingMatchId);
      if (m) updateBoard(spectatorBoardData(m));
      return;
    }
    const m = myCurrentMatch();
    if (m && (m.status === "playing" || m.status === "rps")) updateBoard(participantBoardData(m));
  }
}

// ===============================================================
// PHASE 1 — CHOIX DU DECK (une fois, avant le tournoi)
// ===============================================================
function getProposedDecks() {
  const owned = (currentProfile?.decks || []).map(getDeckById).filter((d) => isDeckPlayable(d));
  if (owned.length <= 1) return owned;
  const seed = hashString(`${roomCode}:${room?.phaseEndsAt || 0}:${myUid()}`);
  return shuffled(owned, mulberry32(seed)).slice(0, 2);
}

function renderDeckSelect() {
  const me = myPlayerDoc();
  if (me?.deckLocked || deckLockedLocally) {
    renderWaitingPanel("En attente des autres joueurs…", "deck");
    return;
  }
  const proposed = getProposedDecks();
  if (proposed.length === 0) { lockDeck(STARTER_DECK_ID); return; }

  const single = proposed.length === 1;
  gameStage.innerHTML = `
    <h2 class="stage-title">Choisis ton deck !</h2>
    <p class="stage-sub">
      Mode <b>${escapeHtml(GAME_MODE_LABELS[room.gameMode] || room.gameMode)}</b> —
      ${single
        ? "tu n'as pas encore d'autres decks disponibles, passe à la boutique après le tournoi !"
        : "clique sur un deck pour voir ses 10 cartes, puis verrouille ton choix avant la fin du chrono."}
    </p>
    <div class="deck-choice-row" id="deckChoiceRow"></div>
  `;
  const row = document.getElementById("deckChoiceRow");
  proposed.forEach((deck) => {
    const el = document.createElement("div");
    el.className = "deck-choice";
    el.dataset.deckId = deck.id;
    el.innerHTML = `
      <img class="deck-choice-img" src="${escapeAttr(deck.image)}" alt="${escapeAttr(deck.name)}">
      <p class="deck-choice-name">${escapeHtml(deck.name)}</p>
      <p class="deck-choice-desc">${escapeHtml(deck.description || "")}</p>
      <p class="deck-choice-hint">Clique sur le deck pour voir ses cartes</p>
      <div class="deck-choice-cards"></div>
      <button type="button" class="btn btn-gold btn-block" data-role="choose">Choisir</button>
    `;
    const cardsGrid = el.querySelector(".deck-choice-cards");
    let cardsRendered = false;
    const toggleCards = () => {
      if (!cardsRendered) {
        cardsRendered = true;
        deck.cards.forEach((card) => {
          const img = document.createElement("img");
          img.src = card.image;
          img.alt = card.name;
          img.addEventListener("mouseenter", () => showCardZoom(card.image, card.name));
          img.addEventListener("mouseleave", hideCardZoom);
          img.addEventListener("click", (e) => { e.stopPropagation(); showCardZoom(card.image, card.name); });
          cardsGrid.appendChild(img);
        });
      }
      el.classList.toggle("open");
    };
    el.querySelector(".deck-choice-img").addEventListener("click", toggleCards);
    el.querySelector(".deck-choice-name").addEventListener("click", toggleCards);
    el.querySelector('[data-role="choose"]').addEventListener("click", () => lockDeck(deck.id));
    row.appendChild(el);
  });
}

async function lockDeck(deckId) {
  if (deckLockedLocally || !currentUser) return;
  deckLockedLocally = true;
  document.querySelectorAll(".deck-choice").forEach((el) => {
    const isChosen = el.dataset.deckId === deckId;
    el.classList.toggle("locked", isChosen);
    el.classList.toggle("dimmed", !isChosen);
    const btn = el.querySelector('[data-role="choose"]');
    if (btn) {
      if (isChosen) btn.outerHTML = `<span class="deck-locked-tag">Choix verrouillé !</span>`;
      else btn.disabled = true;
    }
  });
  try {
    await setPlayerGameData(roomCode, myUid(), { deckId, deckLocked: true });
  } catch (err) {
    console.error(err);
    deckLockedLocally = false;
    showToast("Impossible d'enregistrer ton choix, réessaie.", "error");
    return;
  }
  setTimeout(() => {
    if (room?.status === "deck_select") { renderedKey = null; render(); }
  }, 700);
}

function autoLockRandomDeck() {
  if (deckLockedLocally || myPlayerDoc()?.deckLocked) return;
  const proposed = getProposedDecks();
  const pick = proposed.length ? proposed[Math.floor(Math.random() * proposed.length)] : getDeckById(STARTER_DECK_ID);
  showToast(`Temps écoulé ! ${pick.name} choisi au hasard.`);
  lockDeck(pick.id);
}

// ---- Panneau d'attente (choix de deck) ----
let waitingMode = null;
function renderWaitingPanel(title, mode) {
  waitingMode = mode;
  gameStage.innerHTML = `
    <h2 class="stage-title">${escapeHtml(title)}</h2>
    <div class="waiting-panel"><h3>Joueurs</h3><ul class="waiting-list" id="waitingList"></ul></div>
  `;
  updateWaitingList();
}
function updateWaitingList() {
  const list = document.getElementById("waitingList");
  if (!list || waitingMode !== "deck") return;
  list.innerHTML = "";
  players.forEach((p) => {
    const ready = !!p.deckLocked;
    const li = document.createElement("li");
    li.className = ready ? "ready" : "";
    li.innerHTML = `
      <img src="${escapeAttr(p.photoURL || DEFAULT_AVATAR)}" alt="">
      <span class="w-name">${escapeHtml(p.displayName)}</span>
      <span class="w-state">${ready ? "Prêt !" : "Réfléchit…"}</span>
    `;
    list.appendChild(li);
  });
}

// ===============================================================
// PHASE MATCH — ORDRE DES 3 PREMIÈRES CARTES
// ===============================================================
// Le deck mélangé reste LOCAL (sessionStorage) jusqu'à la confirmation :
// il n'est écrit dans le document du match qu'au moment du verrouillage,
// pour que l'adversaire ne puisse pas adapter son ordre au tien
// (DECISIONS.md D4).
function localDeckKey(matchId) { return `topdeck:deck:${roomCode}:${matchId}:${myUid()}`; }

function getOrCreateLocalDeck(match) {
  const key = localDeckKey(match.id);
  try {
    const saved = sessionStorage.getItem(key);
    if (saved) return JSON.parse(saved);
  } catch (e) { /* sessionStorage indisponible : on régénère */ }
  const deck = shuffled(deckTypeIds(myPlayerDoc()?.deckId));
  try { sessionStorage.setItem(key, JSON.stringify(deck)); } catch (e) { /* tant pis */ }
  return deck;
}

function renderOrdering(match) {
  const role = myRoleIn(match);
  if (match[`${role}Ready`] || orderConfirmed.has(match.id)) {
    renderOrderingWait(match);
    return;
  }
  orderPositions = [null, null, null];
  orderMatchId = match.id;
  const deck = getOrCreateLocalDeck(match);
  const oppUid = role === "a" ? match.b : match.a;

  gameStage.innerHTML = `
    <div class="vs-banner">
      <img src="${escapeAttr(playerPhoto(oppUid))}" alt="">
      <span class="vs-word">VS</span>
      <span class="vs-name">${escapeHtml(playerName(oppUid))}</span>
      ${match.isFinal ? `<span class="vs-name">· FINALE (premier à ${FINAL_WINS_NEEDED})</span>` : ""}
    </div>
    <h2 class="stage-title">Range tes 3 premières cartes</h2>
    <p class="stage-sub">
      Ton deck a été mélangé. Clique sur les cartes dans l'ordre où tu veux les piocher :
      la 1<sup>re</sup> cliquée sera au-dessus du deck. Re-clique sur une carte pour la désassigner.
    </p>
    <div class="order-row" id="orderRow"></div>
    <div class="order-actions">
      <button type="button" class="btn btn-gold" id="btnConfirmOrder" disabled>Confirmer l'ordre</button>
    </div>
  `;
  const row = document.getElementById("orderRow");
  deck.slice(0, 3).forEach((typeId, index) => {
    const card = CARD_CATALOG[typeId];
    const el = document.createElement("div");
    el.className = "order-card";
    el.dataset.index = index;
    el.innerHTML = `
      <span class="order-badge"></span>
      <img src="${escapeAttr(card.image)}" alt="${escapeAttr(card.name)}">
      <div class="order-card-stats"><span class="atk">ATK ${card.attack}</span><span class="def">DEF ${card.defense}</span></div>
    `;
    el.addEventListener("click", () => toggleOrderPosition(index));
    row.appendChild(el);
  });
  document.getElementById("btnConfirmOrder").addEventListener("click", () => confirmOrder(match, false));
}

function renderOrderingWait(match) {
  gameStage.innerHTML = `
    <h2 class="stage-title">Ordre verrouillé !</h2>
    <p class="stage-sub">En attente de ton adversaire…</p>
  `;
}

/**
 * Logique d'assignation (spécifiée par l'exemple A/B/C) :
 * clic sur une carte sans position -> position suivante ; clic sur une
 * carte assignée -> désassignée, les positions supérieures reculent.
 */
function toggleOrderPosition(index) {
  if (orderPositions[index] === null) {
    const assignedCount = orderPositions.filter((p) => p !== null).length;
    if (assignedCount >= 3) return;
    orderPositions[index] = assignedCount + 1;
  } else {
    const removed = orderPositions[index];
    orderPositions[index] = null;
    orderPositions = orderPositions.map((p) => (p !== null && p > removed ? p - 1 : p));
  }
  document.querySelectorAll(".order-card").forEach((el) => {
    const pos = orderPositions[Number(el.dataset.index)];
    el.classList.toggle("assigned", pos !== null);
    el.querySelector(".order-badge").textContent = pos ?? "";
  });
  const btn = document.getElementById("btnConfirmOrder");
  if (btn) btn.disabled = orderPositions.some((p) => p === null);
}

async function confirmOrder(match, fromTimeout) {
  if (orderConfirmed.has(match.id) || !currentUser) return;
  orderConfirmed.add(match.id);
  const role = myRoleIn(match);
  const deck = getOrCreateLocalDeck(match);

  if (fromTimeout) {
    const used = orderPositions.filter((p) => p !== null);
    const free = shuffled([1, 2, 3].filter((p) => !used.includes(p)));
    orderPositions = orderPositions.map((p) => (p !== null ? p : free.pop()));
  }
  const top3 = deck.slice(0, 3);
  const reorderedTop = [null, null, null];
  orderPositions.forEach((pos, index) => { reorderedTop[pos - 1] = top3[index]; });
  const newDeck = [...reorderedTop, ...deck.slice(3)];

  try {
    await updateMatchDoc(roomCode, match.id, {
      [`${role}Deck`]: newDeck,
      [`${role}Ready`]: true
    });
  } catch (err) {
    console.error(err);
    orderConfirmed.delete(match.id);
    showToast("Impossible d'enregistrer ton ordre, réessaie.", "error");
    return;
  }
  renderedKey = null;
  render();
}

function autoConfirmRandomOrder(match) {
  const role = myRoleIn(match);
  if (!role || match[`${role}Ready`] || orderConfirmed.has(match.id)) return;
  if (orderMatchId !== match.id) { orderPositions = [null, null, null]; orderMatchId = match.id; }
  if (!autoOrderNotified.has(match.id)) {
    autoOrderNotified.add(match.id);
    showToast("Temps écoulé ! L'ordre restant a été tiré au hasard.");
  }
  confirmOrder(match, true);
}

// ===============================================================
// PHASE MATCH — LE COMBAT (tour par tour)
// ===============================================================
function onMatchesUpdated() {
  for (const m of matches) {
    if (m.status === "ordering") maybeStartPlaying(m);
    if (m.status === "playing") maybeResolveTurn(m);
    if (m.status === "rps") maybeResolveRps(m);
  }
}

/** L'arbitre (participant "a") démarre le combat quand les 2 decks sont posés. */
function maybeStartPlaying(m) {
  if (myRoleIn(m) !== "a") return;
  if (!m.aReady || !m.bReady || !m.aDeck || !m.bDeck) return;
  if (resolvedTurns.has(`${m.id}:start`)) return;
  resolvedTurns.add(`${m.id}:start`);
  updateMatchDoc(roomCode, m.id, { status: "playing", turnStartedAt: Date.now() })
    .catch((e) => { resolvedTurns.delete(`${m.id}:start`); console.error(e); });
}

/** Je joue la carte du dessus de mon deck (clic ou auto). */
async function playMyCard(m) {
  const role = myRoleIn(m);
  if (!role) return; // un spectateur ne peut PAS jouer (piège §8.7)
  if (m.status !== "playing") return;
  const key = `${m.id}:${m.turn}`;
  if (playedTurns.has(key)) return;
  if ((m[`${role}Played`] || 0) > m.turn) return; // déjà joué ce tour
  playedTurns.add(key);
  try {
    await updateMatchDoc(roomCode, m.id, { [`${role}Played`]: m.turn + 1 });
  } catch (e) {
    playedTurns.delete(key);
    console.error(e);
  }
}

function autoPlayMyCard(m) {
  const role = myRoleIn(m);
  if (!role || m.status !== "playing") return;
  if ((m[`${role}Played`] || 0) > m.turn) return;
  playMyCard(m);
}

/**
 * Révélation + clash quand les DEUX ont joué (piège §8.2 : le "second
 * clic" du même tour est ignoré par playMyCard ; la résolution est
 * calculée depuis l'état ABSOLU du document, donc idempotente : deux
 * écritures concurrentes produisent le même résultat).
 * L'arbitre écrit ; l'autre participant vérifie, et écrit lui-même en
 * secours si l'arbitre tarde (déconnexion).
 */
function maybeResolveTurn(m) {
  const role = myRoleIn(m);
  if (!role) return;
  if ((m.aPlayed || 0) <= m.turn || (m.bPlayed || 0) <= m.turn) return;
  const key = `${m.id}:${m.turn}`;
  if (resolvedTurns.has(key)) return;

  const doResolve = () => {
    if (resolvedTurns.has(key)) return;
    resolvedTurns.add(key);
    const cardA = CARD_CATALOG[m.aDeck[m.turn]];
    const cardB = CARD_CATALOG[m.bDeck[m.turn]];
    const { state, clash, end } = playTurn(engineState(m), cardA, cardB);
    const payload = {
      turn: state.turn,
      points: state.points,
      hp: state.hp,
      cardsLeft: state.cardsLeft,
      discard: state.discard,
      lastClash: {
        aCard: m.aDeck[m.turn], bCard: m.bDeck[m.turn],
        aKillsB: clash.aKillsB, bKillsA: clash.bKillsA
      },
      turnStartedAt: Date.now()
    };
    if (end.ended) {
      if (end.winner === "TIE") {
        // Jamais de match nul : chi-fou-mi (brief §4.2).
        payload.status = "rps";
        payload.rps = { round: 1, startedAt: Date.now() };
      } else {
        payload.status = "finished";
        payload.winner = end.winner === "A" ? m.a : m.b;
        payload.endReason = end.reason;
      }
    }
    updateMatchDoc(roomCode, m.id, payload).catch((e) => { resolvedTurns.delete(key); console.error(e); });
  };

  if (role === "a") {
    doResolve();
  } else {
    // Vérification croisée : je recalcule ; si l'arbitre n'a rien écrit
    // au bout d'un court délai, j'écris le même résultat (déterministe).
    if (!resolveFallbacks.has(key)) {
      resolveFallbacks.set(key, setTimeout(() => {
        resolveFallbacks.delete(key);
        const fresh = matches.find((x) => x.id === m.id);
        if (fresh && fresh.status === "playing" && fresh.turn === m.turn) doResolve();
      }, RESOLVE_FALLBACK_MS));
    }
  }
}

// ===============================================================
// CHI-FOU-MI (commit-reveal SHA-256 — pièges §8.1/§8.9)
// ===============================================================
// 1. Chaque joueur écrit d'abord HASH(choix|sel) — le choix ne circule
//    pas. 2. Quand les DEUX hashs sont posés, chacun révèle choix + sel.
// 3. Résolution : hashs vérifiés, égalité => nouveau tour, jamais de nul.
function rpsLocalKey(matchId, round) { return `topdeck:rps:${roomCode}:${matchId}:${round}:${myUid()}`; }

async function chooseRps(m, move) {
  const role = myRoleIn(m);
  if (!role || m.status !== "rps" || !isValidRpsMove(move)) return;
  const round = m.rps?.round || 1;
  if (m.rps?.[`${role}Hash`]) return; // déjà engagé ce tour
  const salt = crypto.getRandomValues(new Uint32Array(4)).join("-");
  const hash = await sha256Hex(`${move}|${salt}`);
  try { sessionStorage.setItem(rpsLocalKey(m.id, round), JSON.stringify({ move, salt })); } catch (e) {}
  await updateMatchDoc(roomCode, m.id, { rps: { ...(m.rps || {}), [`${role}Hash`]: hash } });
}

/** Révélation (automatique) quand les deux engagements sont posés. */
async function maybeRevealRps(m) {
  const role = myRoleIn(m);
  if (!role || m.status !== "rps" || !m.rps) return;
  const round = m.rps.round || 1;
  if (!m.rps.aHash || !m.rps.bHash) return;       // pas encore les 2 engagements
  if (m.rps[`${role}Choice`]) return;              // déjà révélé
  let saved = null;
  try { saved = JSON.parse(sessionStorage.getItem(rpsLocalKey(m.id, round)) || "null"); } catch (e) {}
  if (!saved) return; // (perte de session : le forfait 30 s tranchera)
  await updateMatchDoc(roomCode, m.id, {
    rps: { ...m.rps, [`${role}Choice`]: saved.move, [`${role}Salt`]: saved.salt }
  });
}

async function maybeResolveRps(m) {
  const role = myRoleIn(m);
  if (!role || !m.rps) return;
  maybeRevealRps(m).catch(console.error);
  const { aChoice, aSalt, bChoice, bSalt, aHash, bHash, round = 1 } = m.rps;
  if (!aChoice || !bChoice) return;
  const key = `${m.id}:rps:${round}`;
  if (rpsResolved.has(key)) return;

  const doResolve = async () => {
    if (rpsResolved.has(key)) return;
    rpsResolved.add(key);
    // Vérification des engagements : un choix qui ne correspond pas à
    // son hash est une tricherie => défaite immédiate.
    const aOk = (await sha256Hex(`${aChoice}|${aSalt}`)) === aHash && isValidRpsMove(aChoice);
    const bOk = (await sha256Hex(`${bChoice}|${bSalt}`)) === bHash && isValidRpsMove(bChoice);
    let payload;
    if (!aOk || !bOk) {
      if (aOk !== bOk) {
        payload = { status: "finished", winner: aOk ? m.a : m.b, endReason: "RPS_INVALID" };
      } else {
        payload = { rps: { round: round + 1, startedAt: Date.now() }, rpsLastResult: { round, result: "INVALID" } };
      }
    } else {
      const result = resolveRps(aChoice, bChoice);
      const last = { round, aChoice, bChoice, result };
      if (result === "TIE") {
        // Égalité => on REJOUE, ça ne termine jamais le match (§8.9).
        payload = { rps: { round: round + 1, startedAt: Date.now() }, rpsLastResult: last };
      } else {
        payload = { status: "finished", winner: result === "A" ? m.a : m.b, endReason: "RPS", rpsLastResult: last };
      }
    }
    updateMatchDoc(roomCode, m.id, payload).catch((e) => { rpsResolved.delete(key); console.error(e); });
  };

  if (role === "a") doResolve();
  else setTimeout(() => {
    const fresh = matches.find((x) => x.id === m.id);
    if (fresh && fresh.status === "rps" && (fresh.rps?.round || 1) === round && fresh.rps?.aChoice && fresh.rps?.bChoice) doResolve();
  }, RESOLVE_FALLBACK_MS);
}

// ===============================================================
// PLATEAU DE MATCH (partagé joueur / spectateur)
// ===============================================================
function participantBoardData(m) {
  const role = myRoleIn(m);
  const opp = otherRole(role);
  const myPlayed = (m[`${role}Played`] || 0) > m.turn;
  const oppPlayed = (m[`${opp}Played`] || 0) > m.turn;
  return {
    match: m,
    topUid: m[opp], bottomUid: m[role],
    topRole: opp, bottomRole: role,
    myRole: role,
    // Ma carte est visible POUR MOI dès que je l'ai jouée ; celle de
    // l'adversaire reste face cachée tant que la révélation n'a pas eu
    // lieu (le clash n'apparaît que lorsque les deux ont joué).
    bottomPending: myPlayed ? m[`${role}Deck`]?.[m.turn] || null : null,
    topPending: null,
    topPendingBack: oppPlayed,
    bottomPendingBack: false,
    canPlay: m.status === "playing" && !myPlayed,
    spect: false
  };
}

function spectatorBoardData(m) {
  // Le spectateur ne voit QUE la projection publique (js/engine/spectate.js).
  const v = spectatorView(m);
  return {
    match: { ...v, aDeck: null, bDeck: null },
    topUid: v.a, bottomUid: v.b,
    topRole: "a", bottomRole: "b",
    myRole: null,
    bottomPending: null,
    topPending: null,
    topPendingBack: v.aPlayedThisTurn,
    bottomPendingBack: v.bPlayedThisTurn,
    canPlay: false,
    spect: true
  };
}

function hpOrPoints(match, role) {
  if (match.hp) return `❤️ ${match.hp[role]}`;
  return `⚔️ ${match.points?.[role] ?? 0} pts`;
}

function renderMatchBoard(m) {
  const data = participantBoardData(m);
  gameStage.innerHTML = boardHtml(data);
  bindBoard(data);
  updateBoard(data);
}

function boardHtml(d) {
  const M = d.match;
  const finalScore = M.isFinal && tournament()?.finalScore
    ? ` · Finale ${Object.entries(tournament().finalScore).map(([u, s]) => `${escapeHtml(playerName(u))} ${s}`).join(" — ")}`
    : "";
  return `
    <div class="board" id="board">
      <div class="board-side board-top">
        <img class="board-avatar" src="${escapeAttr(playerPhoto(d.topUid))}" alt="">
        <div class="board-info">
          <span class="board-name">${escapeHtml(playerName(d.topUid))}</span>
          <span class="board-stats" id="statsTop"></span>
        </div>
        <div class="board-piles">
          <div class="pile"><div class="pile-back"><img src="assets/logo.png" alt=""></div><span class="pile-count" id="deckTop"></span></div>
          <div class="pile pile-discard"><span class="pile-count" id="discardTop"></span></div>
        </div>
        <div class="played-slot" id="slotTop"></div>
      </div>

      <div class="clash-zone" id="clashZone">
        <span class="clash-mode">${escapeHtml(GAME_MODE_LABELS[M.mode] || M.mode)}${finalScore} · Tour <span id="turnNum">1</span></span>
        <div class="clash-cards" id="clashCards"></div>
      </div>

      <div class="board-side board-bottom">
        <div class="played-slot" id="slotBottom"></div>
        <div class="board-piles">
          <div class="pile"><div class="pile-back"><img src="assets/logo.png" alt=""></div><span class="pile-count" id="deckBottom"></span></div>
          <div class="pile pile-discard"><span class="pile-count" id="discardBottom"></span></div>
        </div>
        <div class="board-info">
          <span class="board-name">${d.spect ? escapeHtml(playerName(d.bottomUid)) : "Toi"}</span>
          <span class="board-stats" id="statsBottom"></span>
        </div>
        <img class="board-avatar" src="${escapeAttr(playerPhoto(d.bottomUid))}" alt="">
      </div>

      ${d.spect ? `<button type="button" class="btn btn-outline-gold" id="btnBackSpect">Retour aux matchs</button>`
                : `<button type="button" class="btn btn-gold btn-play" id="btnPlay">Jouer ma carte</button>`}
      <div class="rps-overlay" id="rpsOverlay" style="display:none;"></div>
    </div>
  `;
}

function bindBoard(d) {
  if (d.spect) {
    document.getElementById("btnBackSpect")?.addEventListener("click", () => {
      spectatingMatchId = null;
      renderedKey = null;
      render();
    });
  } else {
    document.getElementById("btnPlay")?.addEventListener("click", () => {
      const fresh = matches.find((x) => x.id === d.match.id);
      if (fresh) playMyCard(fresh);
    });
  }
}

function cardSlotHtml(typeId, back) {
  if (back) return `<div class="mini-card mini-card-back"><img src="assets/logo.png" alt="Carte face cachée"></div>`;
  if (!typeId) return `<div class="mini-card mini-card-empty"></div>`;
  const c = CARD_CATALOG[typeId];
  return `<div class="mini-card"><img src="${escapeAttr(c.image)}" alt="${escapeAttr(c.name)}"><span class="mini-card-stats">${c.attack}/${c.defense}</span></div>`;
}

/** Met à jour le plateau (scores, piles, slots, clash, chi-fou-mi). */
function updateBoard(d) {
  const M = d.match.id ? (matches.find((x) => x.id === d.match.id) || d.match) : d.match;
  const data = d.spect ? spectatorBoardData(M) : participantBoardData(M);
  const m = data.match;
  const board = document.getElementById("board");
  if (!board) return;

  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set("statsTop", hpOrPoints(m, data.topRole) + (m.hp ? ` · ⚔️ ${m.points?.[data.topRole] ?? 0}` : ""));
  set("statsBottom", hpOrPoints(m, data.bottomRole) + (m.hp ? ` · ⚔️ ${m.points?.[data.bottomRole] ?? 0}` : ""));
  set("deckTop", `${m.cardsLeft?.[data.topRole] ?? "?"}`);
  set("deckBottom", `${m.cardsLeft?.[data.bottomRole] ?? "?"}`);
  set("discardTop", `${m.discard?.[data.topRole] ?? 0}`);
  set("discardBottom", `${m.discard?.[data.bottomRole] ?? 0}`);
  set("turnNum", `${(m.turn ?? 0) + 1}`);

  const slotTop = document.getElementById("slotTop");
  const slotBottom = document.getElementById("slotBottom");
  if (slotTop) slotTop.innerHTML = cardSlotHtml(data.topPending, data.topPendingBack);
  if (slotBottom) slotBottom.innerHTML = cardSlotHtml(data.bottomPending, data.bottomPendingBack);

  // Dernier clash révélé
  const clashCards = document.getElementById("clashCards");
  if (clashCards) {
    const lc = m.lastClash;
    if (!lc) {
      clashCards.innerHTML = `<span class="clash-hint">Les cartes révélées s'affichent ici</span>`;
    } else {
      const topCard = data.topRole === "a" ? lc.aCard : lc.bCard;
      const botCard = data.bottomRole === "a" ? lc.aCard : lc.bCard;
      const topDead = data.topRole === "a" ? lc.bKillsA : lc.aKillsB;
      const botDead = data.bottomRole === "a" ? lc.bKillsA : lc.aKillsB;
      clashCards.innerHTML = `
        <div class="clash-card ${topDead ? "dead" : ""}">${cardSlotHtml(topCard, false)}${topDead ? '<span class="skull">💀</span>' : ""}</div>
        <span class="clash-vs">VS</span>
        <div class="clash-card ${botDead ? "dead" : ""}">${cardSlotHtml(botCard, false)}${botDead ? '<span class="skull">💀</span>' : ""}</div>
      `;
    }
  }

  // Bouton jouer
  const btnPlay = document.getElementById("btnPlay");
  if (btnPlay) {
    btnPlay.disabled = !data.canPlay;
    btnPlay.textContent = m.status !== "playing" ? "…"
      : data.canPlay ? "Jouer ma carte" : "En attente de l'adversaire…";
  }

  // Chi-fou-mi
  updateRpsOverlay(m, data);
}

function updateRpsOverlay(m, data) {
  const overlay = document.getElementById("rpsOverlay");
  if (!overlay) return;
  if (m.status !== "rps") { overlay.style.display = "none"; return; }
  overlay.style.display = "flex";

  if (data.spect) {
    overlay.innerHTML = `<div class="rps-box"><h3>Égalité ! Chi-fou-mi en cours…</h3>
      <p class="stage-sub">Les choix sont secrets jusqu'à la révélation.</p></div>`;
    return;
  }
  const role = data.myRole;
  const committed = !!m.rps?.[`${role}Hash`];
  const oppCommitted = !!m.rps?.[`${otherRole(role)}Hash`];
  const last = m.rpsLastResult && m.rpsLastResult.round === (m.rps?.round || 1) - 1 ? m.rpsLastResult : null;
  overlay.innerHTML = `
    <div class="rps-box">
      <h3>Égalité ! Chi-fou-mi pour départager</h3>
      ${last && last.result === "TIE" ? `<p class="stage-sub">${RPS_EMOJI[last.aChoice]} contre ${RPS_EMOJI[last.bChoice]} : encore égalité, on rejoue !</p>` : ""}
      ${committed
        ? `<p class="stage-sub">${oppCommitted ? "Révélation…" : "Choix verrouillé — l'adversaire réfléchit…"}</p>`
        : `<div class="rps-buttons">${RPS_MOVES.map((mv) =>
            `<button type="button" class="rps-btn" data-move="${mv}">${RPS_EMOJI[mv]}<span>${mv}</span></button>`).join("")}</div>`}
    </div>
  `;
  overlay.querySelectorAll(".rps-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const fresh = matches.find((x) => x.id === m.id);
      if (fresh) chooseRps(fresh, btn.dataset.move).catch(console.error);
    });
  });
}

// ===============================================================
// FIN DE MATCH / ATTENTE / BYE / ÉLIMINÉ / SPECTATE / CHAMPION
// ===============================================================
function renderMatchResult(m) {
  const won = m.winner === myUid();
  const reasons = {
    HP_ZERO: "aux points de vie", DECK_EMPTY: "à la pioche",
    RPS: "au chi-fou-mi", FORFEIT: "par forfait", RPS_INVALID: "sur tricherie au chi-fou-mi"
  };
  gameStage.innerHTML = `
    <h2 class="stage-title">${won ? "Victoire ! 👑" : "Défaite…"}</h2>
    <p class="stage-sub">${won ? "Tu gagnes une couronne" : escapeHtml(playerName(m.winner)) + " l'emporte"} ${reasons[m.endReason] || ""}.
      En attente de la fin du round…</p>
    <div id="standingsPanel"></div>
    <div id="liveMatchesPanel"></div>
  `;
  updateStandingsPanel();
  updateLiveMatchesPanel();
}

function renderBye() {
  gameStage.innerHTML = `
    <h2 class="stage-title">Round ${room.round} — tu es en attente</h2>
    <p class="stage-sub">Nombre impair de joueurs : pas d'adversaire ce round (statut WAITING).
      Un bye ne donne pas de couronne et ne compte pas comme une défaite.</p>
    <div id="standingsPanel"></div>
    <div id="liveMatchesPanel"></div>
  `;
  updateStandingsPanel();
  updateLiveMatchesPanel();
}

function renderStandby() {
  gameStage.innerHTML = `
    <h2 class="stage-title">Round ${room.round} en préparation…</h2>
    <div id="standingsPanel"></div>
    <div id="liveMatchesPanel"></div>
  `;
  updateStandingsPanel();
  updateLiveMatchesPanel();
}

function renderEliminated() {
  gameStage.innerHTML = `
    <h2 class="stage-title">Tu es éliminé du tournoi</h2>
    <p class="stage-sub">Tu peux regarder n'importe quel match en cours en attendant la couronne finale.</p>
    <div id="standingsPanel"></div>
    <div id="liveMatchesPanel"></div>
  `;
  updateStandingsPanel();
  updateLiveMatchesPanel();
}

function renderSpectate() {
  const m = matches.find((x) => x.id === spectatingMatchId);
  if (!m || m.status === "finished") {
    spectatingMatchId = null;
    renderedKey = null;
    render();
    return;
  }
  const data = spectatorBoardData(m);
  gameStage.innerHTML = boardHtml(data);
  bindBoard(data);
  updateBoard(data);
}

function renderChampion() {
  const t = tournament();
  const champ = room.championUid || t?.championUid;
  gameStage.innerHTML = `
    <h2 class="stage-title">🏆 ${escapeHtml(playerName(champ))} est couronné champion !</h2>
    ${t?.finalScore ? `<p class="stage-sub">Finale : ${Object.entries(t.finalScore).map(([u, s]) => `${escapeHtml(playerName(u))} ${s}`).join(" — ")}</p>` : ""}
    <div id="standingsPanel"></div>
    <div class="order-actions"><button type="button" class="btn btn-gold" id="btnBackLobby">Retour au lobby</button></div>
  `;
  updateStandingsPanel();
  document.getElementById("btnBackLobby").addEventListener("click", async () => {
    try { await leaveRoom(roomCode, myUid()); } catch (e) {}
    goToLobby();
  });
}

// ---- Classement (couronnes, kills, statuts) ----
function updateStandingsPanel() {
  const panel = document.getElementById("standingsPanel");
  const t = tournament();
  if (!panel || !t) return;
  const uids = Object.keys(t.players).sort((u1, u2) => {
    const p1 = t.players[u1], p2 = t.players[u2];
    if (p1.crowns !== p2.crowns) return p2.crowns - p1.crowns;
    return p2.killPoints - p1.killPoints;
  });
  panel.innerHTML = `
    <div class="waiting-panel standings">
      <h3>Classement — Round ${room.round || 1}</h3>
      <ul class="waiting-list">
        ${uids.map((u) => {
          const p = t.players[u];
          const status = t.championUid === u ? "🏆 CHAMPION"
            : p.status === "ELIMINATED" ? "ÉLIMINÉ"
            : room.roundByeUid === u ? "WAITING" : "";
          return `<li class="${p.status === "ELIMINATED" ? "out" : ""}">
            <img src="${escapeAttr(playerPhoto(u))}" alt="">
            <span class="w-name">${escapeHtml(playerName(u))}${u === myUid() ? " (toi)" : ""}</span>
            <span class="w-state">👑 ${p.crowns} · ⚔️ ${p.killPoints}${status ? " · " + status : ""}</span>
          </li>`;
        }).join("")}
      </ul>
    </div>
  `;
}

// ---- Matchs en cours (spectate) ----
function updateLiveMatchesPanel() {
  const panel = document.getElementById("liveMatchesPanel");
  if (!panel) return;
  const live = currentMatches().filter((m) => m.status !== "finished");
  if (!live.length) { panel.innerHTML = ""; return; }
  panel.innerHTML = `
    <div class="waiting-panel">
      <h3>Matchs en cours</h3>
      <ul class="waiting-list">
        ${live.map((m) => `
          <li>
            <span class="w-name">${escapeHtml(playerName(m.a))} vs ${escapeHtml(playerName(m.b))}${m.isFinal ? " · FINALE" : ""}</span>
            <button type="button" class="btn btn-outline-gold btn-sm" data-spect="${escapeAttr(m.id)}">Regarder</button>
          </li>`).join("")}
      </ul>
    </div>
  `;
  panel.querySelectorAll("[data-spect]").forEach((btn) => {
    btn.addEventListener("click", () => {
      spectatingMatchId = btn.dataset.spect;
      renderedKey = null;
      render();
    });
  });
}

// ===============================================================
// ORCHESTRATION CÔTÉ HÔTE (le client de l'hôte pilote le tournoi ;
// s'il part, l'hôte est transféré et le nouvel hôte prend le relais)
// ===============================================================
function hostMaybeAct() {
  if (!isHost() || !room) return;
  if (room.status === "deck_select") hostMaybeInitTournament();
  else if (room.status === "tournament") hostMaybeAdvanceRound();
}

function seededRng(tag) {
  return mulberry32(hashString(`${roomCode}:${tag}`));
}

async function hostMaybeInitTournament() {
  if (hostDone.has("init")) return;
  if (!players.length) return;
  const allLocked = players.every((p) => p.deckLocked);
  const pastDeadline = room.phaseEndsAt && Date.now() >= room.phaseEndsAt + HOST_GRACE_MS;
  if (!allLocked && !pastDeadline) return;
  hostDone.add("init");
  try {
    // Complète les joueurs muets : deck de départ (possédé par tous).
    for (const p of players.filter((x) => !x.deckLocked)) {
      await setPlayerGameData(roomCode, p.uid, { deckId: STARTER_DECK_ID, deckLocked: true });
    }
    const uids = players.map((p) => p.uid);
    const names = Object.fromEntries(players.map((p) => [p.uid, p.displayName || "Joueur"]));
    const photos = Object.fromEntries(players.map((p) => [p.uid, p.photoURL || ""]));
    let t = createTournament(uids);
    const pairing = pairNextRound(t, seededRng(`r1`));
    const matchIds = await hostCreateRoundMatches(pairing);
    await updateRoomData(roomCode, {
      status: "tournament",
      tournament: pairing.t,
      round: pairing.t.round,
      currentMatchIds: matchIds,
      roundByeUid: pairing.t.roundByeUid ?? null,
      tournamentNames: names,
      tournamentPhotos: photos,
      phaseEndsAt: null
    });
  } catch (err) {
    console.error("Initialisation du tournoi impossible :", err);
    hostDone.delete("init");
  }
}

async function hostCreateRoundMatches(pairing) {
  const t = pairing.t;
  const mode = room.gameMode;
  const hp = startingHp(mode);
  const ids = [];
  for (let i = 0; i < pairing.matches.length; i++) {
    const pair = pairing.matches[i];
    const id = pairing.final ? `r${t.round}-final` : `r${t.round}-m${i}`;
    ids.push(id);
    await createMatchDoc(roomCode, id, {
      id,
      round: t.round,
      a: pair.a,
      b: pair.b,
      mode,
      isFinal: !!pairing.final,
      status: "ordering",
      orderingEndsAt: Date.now() + ORDERING_SECONDS * 1000,
      aReady: false, bReady: false,
      aDeck: null, bDeck: null,
      turn: 0, aPlayed: 0, bPlayed: 0, turnStartedAt: null,
      points: { a: 0, b: 0 },
      hp: hp === null ? null : { a: hp, b: hp },
      cardsLeft: { a: 10, b: 10 },
      discard: { a: 0, b: 0 },
      lastClash: null, rps: null, rpsLastResult: null,
      winner: null, endReason: null, forfeitedUid: null
    });
  }
  return ids;
}

async function hostMaybeAdvanceRound() {
  const roundKey = `round-${room.round}`;
  if (hostDone.has(roundKey)) return;
  const ids = currentMatchIds();
  if (!ids.length) return;
  const roundMatches = ids.map((id) => matches.find((m) => m.id === id)).filter(Boolean);
  if (roundMatches.length !== ids.length) return;              // docs pas tous reçus
  if (!roundMatches.every((m) => m.status === "finished")) return;
  hostDone.add(roundKey);

  try {
    let t = structuredClone(room.tournament);

    // 1. Résultats des matchs du round (ordre déterministe par id).
    for (const m of [...roundMatches].sort((x, y) => x.id.localeCompare(y.id))) {
      const winnerUid = m.winner;
      const loserUid = winnerUid === m.a ? m.b : m.a;
      const kw = winnerUid === m.a ? (m.points?.a ?? 0) : (m.points?.b ?? 0);
      const kl = winnerUid === m.a ? (m.points?.b ?? 0) : (m.points?.a ?? 0);
      if (m.isFinal) t = reportFinalGame(t, winnerUid, kw, kl);
      else t = reportMatchResult(t, winnerUid, loserUid, kw, kl);
    }

    // 2. Forfaits (abandons) : élimination immédiate, consignée.
    for (const uid of Object.keys(room.forfeits || {})) {
      if (t.players[uid] && t.players[uid].status === "ACTIVE" && !t.finalists?.includes(uid)) {
        t.players[uid].status = "ELIMINATED";
        t.log.push(`élimination de ${uid} : forfait`);
      }
    }

    // 3. Élimination périodique (rounds 3, 6, 9…), hors finale.
    t = applyPeriodicElimination(t, seededRng(`elim${t.round}`));

    // 4. Champion ? Sinon, round suivant (ou manche suivante de finale).
    if (isFinished(t)) {
      await updateRoomData(roomCode, {
        status: "finished", tournament: t, championUid: t.championUid, currentMatchIds: []
      });
      return;
    }
    const pairing = pairNextRound(t, seededRng(`r${t.round + 1}`));
    const matchIds = await hostCreateRoundMatches(pairing);
    await updateRoomData(roomCode, {
      tournament: pairing.t,
      round: pairing.t.round,
      currentMatchIds: matchIds,
      roundByeUid: pairing.t.roundByeUid ?? null
    });
  } catch (err) {
    console.error("Passage au round suivant impossible :", err);
    hostDone.delete(roundKey);
  }
}
