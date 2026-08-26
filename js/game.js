// =====================================================================
// TOP DECK! — Contrôleur de l'environnement de combat (game.html)
// =====================================================================
// Déroulé d'une partie (statut écrit sur le document de la salle,
// voir js/rooms.js) :
//
//   1. "deck_select" : 2 decks (parmi ceux que le joueur possède et
//      qui sont jouables, cf. isDeckPlayable) lui sont proposés.
//      Chrono de 15 s ; sans choix, un deck est pris au hasard.
//   2. Quand tout le monde a verrouillé (ou timeout), l'HÔTE tire les
//      duels 1v1 au sort et fait passer la salle en "ordering".
//   3. "ordering" : le deck (10 cartes) est mélangé, le joueur voit
//      les 3 premières cartes et choisit leur ordre en cliquant
//      (1 / 2 / 3, désassignation en cascade). Chrono de 15 s ;
//      sans confirmation, l'ordre est complété au hasard.
//   4. "battle" : l'arène — pour l'instant un écran de mise en place
//      simple, la logique de combat arrive dans la prochaine passe.
//
// Rôle de l'hôte : c'est SON client qui constate que tout le monde est
// prêt (ou que le chrono est écoulé, avec une marge de grâce) et qui
// écrit le passage à la phase suivante. Si un joueur n'a rien écrit à
// temps (déconnexion…), l'hôte complète sa fiche avec des valeurs par
// défaut pour ne pas bloquer la partie.
// =====================================================================
import { subscribeAuth } from "./auth.js";
import {
  subscribeRoom,
  subscribePlayers,
  setPlayerGameData,
  advanceToOrdering,
  advanceToBattle,
  leaveRoom
} from "./rooms.js";
import { DECK_CATALOG, STARTER_DECK_ID, getDeckById, isDeckPlayable } from "./decks.js";
import { CARD_CATALOG } from "./cards.js";

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

// Marge de grâce après la fin du chrono avant que l'hôte ne force le
// passage à la phase suivante (laisse le temps aux écritures "timeout"
// des autres clients d'arriver dans Firestore).
const HOST_GRACE_MS = 2500;

// ---------------------------------------------------------------
// Etat local
// ---------------------------------------------------------------
const roomCode = new URLSearchParams(window.location.search).get("room");

let currentUser = null;
let currentProfile = null;
let room = null;
let players = [];

let renderedPhase = null;      // phase actuellement affichée (évite les re-rendus destructeurs)
let deckLockedLocally = false; // j'ai verrouillé mon deck (évite les doubles écritures)
let orderConfirmedLocally = false;
let shuffleWrittenLocally = false;
let autoOrderNotified = false; // toast "temps écoulé" (phase ordre) déjà montré
let hostAdvancing = false;     // l'hôte est en train d'écrire le changement de phase
const hostAdvancedFrom = new Set(); // phases déjà avancées par l'hôte (anti double écriture)

// Phase "ordering" : position (1..3 ou null) de chacune des 3 cartes
let orderPositions = [null, null, null];

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

function goToLobby() {
  window.location.href = "index.html";
}

/** Mélange de Fisher-Yates (nouveau tableau, l'original est intact). */
function shuffled(arr, rng = Math.random) {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// PRNG déterministe (mulberry32) seedé par une chaîne : sert à proposer
// les MÊMES 2 decks à un joueur donné même s'il rafraîchit la page
// pendant la phase de choix.
function hashString(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Aperçu agrandi d'une carte (comme dans la boutique). */
function showCardZoom(src, alt) {
  cardZoomImg.src = src;
  cardZoomImg.alt = alt || "";
  cardZoomOverlay.classList.add("show");
}
function hideCardZoom() {
  cardZoomOverlay.classList.remove("show");
}
// Un clic n'importe où sur l'aperçu agrandi le referme.
cardZoomOverlay.addEventListener("click", hideCardZoom);

function myPlayerDoc() {
  return players.find((p) => p.uid === currentUser?.uid) || null;
}
function isHost() {
  return !!room && !!currentUser && room.hostUid === currentUser.uid;
}

/** Les 10 typeIds d'un deck du catalogue (ex : ["tour","tour",...]). */
function deckTypeIds(deckId) {
  const deck = getDeckById(deckId) || getDeckById(STARTER_DECK_ID);
  return deck.cards.map((c) => c.typeId);
}

// ---------------------------------------------------------------
// Decks proposés au joueur (phase deck_select)
// ---------------------------------------------------------------
// Parmi les decks POSSÉDÉS et JOUABLES (pas de placeholders), on en
// tire 2 au sort — de façon déterministe (seed = salle + échéance de
// phase + uid) pour que la proposition survive à un rafraîchissement.
// S'il n'y en a qu'un seul, on le propose seul avec un message.
function getProposedDecks() {
  const owned = (currentProfile?.decks || [])
    .map(getDeckById)
    .filter((d) => isDeckPlayable(d));
  if (owned.length <= 1) return owned;

  const seed = hashString(`${roomCode}:${room?.phaseEndsAt || 0}:${currentUser.uid}`);
  return shuffled(owned, mulberry32(seed)).slice(0, 2);
}

// ---------------------------------------------------------------
// Chrono de phase
// ---------------------------------------------------------------
// `phaseEndsAt` (epoch ms, horloge de l'hôte) est écrit sur la salle à
// chaque changement de phase. Chaque client affiche le décompte et
// déclenche ses actions "timeout" locales quand il atteint zéro.
let tickInterval = null;

function startTicking() {
  if (tickInterval) return;
  tickInterval = setInterval(onTick, 250);
}

function onTick() {
  if (!room || !room.phaseEndsAt) {
    chronoEl.style.display = "none";
    return;
  }
  const remainingMs = room.phaseEndsAt - Date.now();
  const remaining = Math.max(0, Math.ceil(remainingMs / 1000));
  chronoEl.style.display = "grid";
  chronoNum.textContent = remaining;
  chronoEl.classList.toggle("urgent", remainingMs <= 5000 && remainingMs > 0);

  if (remainingMs <= 0) {
    // Actions locales de fin de chrono (une seule fois chacune).
    if (room.status === "deck_select") autoLockRandomDeck();
    if (room.status === "ordering") autoConfirmRandomOrder();
    // L'hôte force le passage de phase après la marge de grâce.
    if (isHost() && -remainingMs >= HOST_GRACE_MS) hostTryAdvance(true);
  }
}

// ---------------------------------------------------------------
// Démarrage : auth -> abonnements salle + joueurs
// ---------------------------------------------------------------
if (!roomCode) goToLobby();

let authResolved = false;
subscribeAuth((user, profile) => {
  currentUser = user;
  currentProfile = profile;

  // Le tout premier appel est synchrone, AVANT que Firebase n'ait
  // restauré la session : on l'ignore et on attend la vraie réponse.
  if (!authResolved) {
    authResolved = true;
    if (user) bootGame();
    return;
  }
  if (!user) {
    // Déconnecté (ou jamais connecté) : retour au lobby.
    goToLobby();
    return;
  }
  if (!room) bootGame();
  renderMe();
});

let booted = false;
function bootGame() {
  if (booted || !currentUser) return;
  booted = true;

  renderMe();
  startTicking();

  subscribeRoom(roomCode, (r) => {
    if (!r) {
      showToast("La partie a été fermée.");
      setTimeout(goToLobby, 1500);
      return;
    }
    room = r;
    gameRoomName.textContent = r.name || r.id;

    if (r.status === "waiting") {
      // La partie n'est pas (ou plus) lancée : retour au lobby.
      goToLobby();
      return;
    }
    if (r.status !== renderedPhase) renderPhase();
  });

  subscribePlayers(roomCode, (list) => {
    players = list;

    // Si je ne fais pas partie de la salle, je n'ai rien à faire ici.
    if (players.length && !myPlayerDoc()) {
      showToast("Tu ne fais pas partie de cette partie.");
      setTimeout(goToLobby, 1500);
      return;
    }

    updateWaitingList();
    onPlayersMaybeReady();

    // En phase "ordering", mon deck mélangé vient peut-être d'arriver
    // (écrit par moi juste avant, ou complété par l'hôte).
    if (room?.status === "ordering" && renderedPhase === "ordering") {
      maybeRenderOrderCards();
    }
  });
}

function renderMe() {
  if (!currentProfile) return;
  gameMe.innerHTML = `
    <span class="game-me-name">${escapeHtml(currentProfile.displayName || "Joueur")}</span>
    <img src="${escapeAttr(currentProfile.photoURL || DEFAULT_AVATAR)}" alt="">
  `;
}

btnForfeit.addEventListener("click", async () => {
  if (!currentUser) return goToLobby();
  btnForfeit.disabled = true;
  try {
    await leaveRoom(roomCode, currentUser.uid);
  } catch (e) {
    /* la salle est peut-être déjà fermée */
  }
  goToLobby();
});

// ---------------------------------------------------------------
// Rendu des phases
// ---------------------------------------------------------------
function renderPhase() {
  if (!room) return;
  renderedPhase = room.status;
  hideCardZoom();

  if (room.status === "deck_select") {
    gamePhaseLabel.textContent = "Choix du deck";
    renderDeckSelect();
  } else if (room.status === "ordering") {
    gamePhaseLabel.textContent = "Ordre des cartes";
    renderOrdering();
  } else if (room.status === "battle") {
    gamePhaseLabel.textContent = "Combat";
    chronoEl.style.display = "none";
    renderBattle();
  }
}

// ===============================================================
// PHASE 1 — CHOIX DU DECK
// ===============================================================
function renderDeckSelect() {
  const me = myPlayerDoc();
  // Rafraîchissement en cours de phase : si mon choix est déjà
  // verrouillé côté Firestore, on va directement à l'attente.
  if (me?.deckLocked) {
    deckLockedLocally = true;
    renderWaitingPanel("En attente des autres joueurs…", "deck");
    return;
  }

  const proposed = getProposedDecks();

  if (proposed.length === 0) {
    // Ne devrait pas arriver (le deck de départ est offert à tous et
    // jouable), mais on gère proprement : deck de départ d'office.
    lockDeck(STARTER_DECK_ID);
    return;
  }

  const single = proposed.length === 1;
  gameStage.innerHTML = `
    <h2 class="stage-title">Choisis ton deck !</h2>
    <p class="stage-sub">
      ${single
        ? "Tu n'as pas encore d'autres decks disponibles — passe à la boutique après le combat !"
        : "Clique sur un deck pour voir ses 10 cartes, puis verrouille ton choix avant la fin du chrono."}
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

    // Clic sur le visuel / nom du deck : montre ou cache ses 10 cartes
    // (comme le détail d'un deck dans la boutique).
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
          img.addEventListener("click", (e) => {
            e.stopPropagation();
            showCardZoom(card.image, card.name);
          });
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

/** Verrouille le deck choisi (ou tiré au sort) dans Firestore. */
async function lockDeck(deckId) {
  if (deckLockedLocally || !currentUser) return;
  deckLockedLocally = true;

  // Feedback immédiat : le deck choisi est marqué, les autres grisés.
  document.querySelectorAll(".deck-choice").forEach((el) => {
    const isChosen = el.dataset.deckId === deckId;
    el.classList.toggle("locked", isChosen);
    el.classList.toggle("dimmed", !isChosen);
    const btn = el.querySelector('[data-role="choose"]');
    if (btn) {
      if (isChosen) {
        btn.outerHTML = `<span class="deck-locked-tag">Choix verrouillé !</span>`;
      } else {
        btn.disabled = true;
      }
    }
  });

  try {
    await setPlayerGameData(roomCode, currentUser.uid, { deckId, deckLocked: true });
  } catch (err) {
    console.error(err);
    deckLockedLocally = false;
    showToast("Impossible d'enregistrer ton choix, réessaie.", "error");
    return;
  }

  // Petit délai pour laisser voir le verrouillage, puis panneau d'attente.
  setTimeout(() => {
    if (room?.status === "deck_select") {
      renderWaitingPanel("En attente des autres joueurs…", "deck");
    }
  }, 700);
}

/** Fin du chrono sans choix : un deck proposé est pris au hasard. */
function autoLockRandomDeck() {
  if (deckLockedLocally) return;
  const proposed = getProposedDecks();
  const pick = proposed.length
    ? proposed[Math.floor(Math.random() * proposed.length)]
    : getDeckById(STARTER_DECK_ID);
  showToast(`Temps écoulé ! ${pick.name} choisi au hasard.`);
  lockDeck(pick.id);
}

// ===============================================================
// PANNEAU D'ATTENTE (partagé entre les deux phases)
// ===============================================================
// `mode` : "deck" (prêt = deckLocked) ou "order" (prêt = orderConfirmed)
let waitingMode = null;

function renderWaitingPanel(title, mode) {
  waitingMode = mode;
  gameStage.innerHTML = `
    <h2 class="stage-title">${escapeHtml(title)}</h2>
    <div class="waiting-panel">
      <h3>Joueurs</h3>
      <ul class="waiting-list" id="waitingList"></ul>
    </div>
  `;
  updateWaitingList();
}

function updateWaitingList() {
  const list = document.getElementById("waitingList");
  if (!list || !waitingMode) return;
  list.innerHTML = "";
  players.forEach((p) => {
    const ready = waitingMode === "deck" ? !!p.deckLocked : !!p.orderConfirmed;
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
// PHASE 2 — MÉLANGE DU DECK + ORDRE DES 3 PREMIÈRES CARTES
// ===============================================================
function opponentOf(uid) {
  const pair = (room?.matchups || []).find((m) => m.a === uid || m.b === uid);
  if (!pair) return null;
  const otherUid = pair.a === uid ? pair.b : pair.a;
  return players.find((p) => p.uid === otherUid) || null;
}

function renderOrdering() {
  waitingMode = null;
  orderPositions = [null, null, null];
  orderCardsRendered = false;

  const me = myPlayerDoc();
  if (me?.orderConfirmed) {
    orderConfirmedLocally = true;
    renderWaitingPanel("En attente des autres joueurs…", "order");
    return;
  }

  // Joueur sans adversaire (nombre impair) : il ne joue pas ce round.
  if (room.byeUid === currentUser.uid) {
    orderConfirmedLocally = true;
    setPlayerGameData(roomCode, currentUser.uid, { orderConfirmed: true }).catch(console.error);
    gameStage.innerHTML = `
      <h2 class="stage-title">Pas d'adversaire ce round</h2>
      <p class="stage-sub">Vous êtes en nombre impair : tu observes ce round et tu reviendras au suivant.</p>
    `;
    return;
  }

  // Mon deck mélangé : s'il n'existe pas encore dans ma fiche, je le
  // génère (mélange des 10 cartes du deck choisi) et je l'écris.
  if (!me?.shuffledDeck && !shuffleWrittenLocally) {
    shuffleWrittenLocally = true;
    const deck = shuffled(deckTypeIds(me?.deckId));
    setPlayerGameData(roomCode, currentUser.uid, { shuffledDeck: deck, orderConfirmed: false })
      .catch((err) => {
        console.error(err);
        shuffleWrittenLocally = false;
      });
  }

  const opp = opponentOf(currentUser.uid);
  gameStage.innerHTML = `
    ${opp ? `
      <div class="vs-banner">
        <img src="${escapeAttr(opp.photoURL || DEFAULT_AVATAR)}" alt="">
        <span class="vs-word">VS</span>
        <span class="vs-name">${escapeHtml(opp.displayName)}</span>
      </div>` : ""}
    <h2 class="stage-title">Range tes 3 premières cartes</h2>
    <p class="stage-sub">
      Ton deck a été mélangé. Clique sur les cartes dans l'ordre où tu veux les piocher :
      la 1<sup>re</sup> cliquée sera au-dessus du deck. Re-clique sur une carte pour la désassigner.
    </p>
    <div class="order-row" id="orderRow">
      <p class="game-loading">Mélange du deck…</p>
    </div>
    <div class="order-actions">
      <button type="button" class="btn btn-gold" id="btnConfirmOrder" disabled>Confirmer l'ordre</button>
    </div>
  `;
  document.getElementById("btnConfirmOrder").addEventListener("click", () => confirmOrder(false));

  maybeRenderOrderCards();
}

let orderCardsRendered = false;
function maybeRenderOrderCards() {
  if (orderCardsRendered || orderConfirmedLocally) return;
  const me = myPlayerDoc();
  const row = document.getElementById("orderRow");
  if (!row || !me?.shuffledDeck) return;

  orderCardsRendered = true;
  row.innerHTML = "";

  me.shuffledDeck.slice(0, 3).forEach((typeId, index) => {
    const card = CARD_CATALOG[typeId];
    const el = document.createElement("div");
    el.className = "order-card";
    el.dataset.index = index;
    el.innerHTML = `
      <span class="order-badge"></span>
      <img src="${escapeAttr(card.image)}" alt="${escapeAttr(card.name)}">
      <div class="order-card-stats">
        <span class="atk">ATK ${card.attack}</span>
        <span class="def">DEF ${card.defense}</span>
      </div>
    `;
    el.addEventListener("click", () => toggleOrderPosition(index));
    row.appendChild(el);
  });
}

/**
 * Logique d'assignation demandée :
 *  - clic sur une carte SANS position -> elle prend la position
 *    suivante (nombre de cartes déjà assignées + 1) ;
 *  - clic sur une carte DÉJÀ assignée -> elle est désassignée et
 *    toutes les positions supérieures reculent d'un cran.
 * Exemple : A1 B2 C3, clic sur B -> A1, B(–), C2 ; clic sur A ->
 * A(–), B(–), C1 ; puis clic B puis A -> A3, B2, C1.
 */
function toggleOrderPosition(index) {
  if (orderConfirmedLocally) return;

  if (orderPositions[index] === null) {
    const assignedCount = orderPositions.filter((p) => p !== null).length;
    if (assignedCount >= 3) return;
    orderPositions[index] = assignedCount + 1;
  } else {
    const removed = orderPositions[index];
    orderPositions[index] = null;
    orderPositions = orderPositions.map((p) => (p !== null && p > removed ? p - 1 : p));
  }
  refreshOrderBadges();
}

function refreshOrderBadges() {
  document.querySelectorAll(".order-card").forEach((el) => {
    const pos = orderPositions[Number(el.dataset.index)];
    el.classList.toggle("assigned", pos !== null);
    el.querySelector(".order-badge").textContent = pos ?? "";
  });
  const btn = document.getElementById("btnConfirmOrder");
  if (btn) btn.disabled = orderPositions.some((p) => p === null);
}

/**
 * Confirme l'ordre : les 3 premières cartes du deck sont remplacées
 * dans l'ordre décidé (position 1 = dessus du deck), le reste du deck
 * est inchangé. `fromTimeout` = complétion aléatoire des positions
 * manquantes quand le chrono est écoulé.
 */
async function confirmOrder(fromTimeout) {
  if (orderConfirmedLocally || !currentUser) return;
  const me = myPlayerDoc();
  if (!me?.shuffledDeck) {
    // Deck pas encore écrit (latence) : l'hôte complétera au besoin.
    return;
  }
  orderConfirmedLocally = true;

  if (fromTimeout) {
    // Les positions manquantes sont distribuées au hasard.
    const used = orderPositions.filter((p) => p !== null);
    const free = shuffled([1, 2, 3].filter((p) => !used.includes(p)));
    orderPositions = orderPositions.map((p) => (p !== null ? p : free.pop()));
  }

  const top3 = me.shuffledDeck.slice(0, 3);
  const reorderedTop = [null, null, null];
  orderPositions.forEach((pos, index) => {
    reorderedTop[pos - 1] = top3[index];
  });
  const newDeck = [...reorderedTop, ...me.shuffledDeck.slice(3)];

  try {
    await setPlayerGameData(roomCode, currentUser.uid, {
      shuffledDeck: newDeck,
      orderConfirmed: true
    });
  } catch (err) {
    console.error(err);
    orderConfirmedLocally = false;
    showToast("Impossible d'enregistrer ton ordre, réessaie.", "error");
    return;
  }
  renderWaitingPanel("En attente des autres joueurs…", "order");
}

/** Fin du chrono sans confirmation : ordre complété au hasard. */
function autoConfirmRandomOrder() {
  if (orderConfirmedLocally) return;
  if (!autoOrderNotified) {
    autoOrderNotified = true;
    showToast("Temps écoulé ! L'ordre restant a été tiré au hasard.");
  }
  // Peut être rappelé au tick suivant si mon deck mélangé n'était pas
  // encore arrivé (confirmOrder ne fait alors rien).
  confirmOrder(true);
}

// ===============================================================
// COORDINATION CÔTÉ HÔTE
// ===============================================================
// Appelé à chaque mise à jour des joueurs : si TOUT LE MONDE est prêt,
// l'hôte fait avancer la phase sans attendre la fin du chrono.
function onPlayersMaybeReady() {
  if (!isHost() || !room || !players.length) return;

  if (room.status === "deck_select" && players.every((p) => p.deckLocked)) {
    hostTryAdvance(false);
  } else if (room.status === "ordering" && players.every((p) => p.orderConfirmed)) {
    hostTryAdvance(false);
  }
}

/**
 * Passage à la phase suivante, écrit par l'hôte.
 * `force` = la marge de grâce est écoulée : les joueurs qui n'ont
 * rien écrit (déconnectés…) sont complétés avec des valeurs par défaut
 * pour ne pas bloquer les autres.
 */
async function hostTryAdvance(force) {
  if (!isHost() || hostAdvancing || !room) return;
  // Une phase donnée ne doit être avancée qu'UNE fois, même si des
  // ticks arrivent entre l'écriture et le retour du snapshot.
  if (hostAdvancedFrom.has(room.status)) return;

  if (room.status === "deck_select") {
    const missing = players.filter((p) => !p.deckLocked);
    if (missing.length && !force) return;
    hostAdvancing = true;
    hostAdvancedFrom.add("deck_select");
    try {
      // Complète les joueurs muets : deck de départ (possédé par tous).
      // L'hôte ne connaît pas leur collection, le deck de départ est
      // donc le seul choix toujours valide.
      for (const p of missing) {
        await setPlayerGameData(roomCode, p.uid, { deckId: STARTER_DECK_ID, deckLocked: true });
      }
      // Tirage des duels 1v1 : à 2 joueurs le duel est évident, sinon
      // les joueurs sont appariés au hasard. Nombre impair -> le
      // joueur restant est "bye" pour ce round.
      const uids = shuffled(players.map((p) => p.uid));
      const matchups = [];
      let byeUid = null;
      while (uids.length >= 2) matchups.push({ a: uids.shift(), b: uids.shift() });
      if (uids.length === 1) byeUid = uids[0];

      await advanceToOrdering(roomCode, matchups, byeUid);
    } catch (err) {
      console.error("Passage en phase d'ordre impossible :", err);
      hostAdvancedFrom.delete("deck_select"); // autorise une nouvelle tentative
    } finally {
      hostAdvancing = false;
    }
  } else if (room.status === "ordering") {
    const missing = players.filter((p) => !p.orderConfirmed);
    if (missing.length && !force) return;
    hostAdvancing = true;
    hostAdvancedFrom.add("ordering");
    try {
      // Complète les joueurs muets : deck mélangé (généré ici si
      // besoin) et ordre laissé tel quel (déjà aléatoire).
      for (const p of missing) {
        const data = { orderConfirmed: true };
        if (!p.shuffledDeck) data.shuffledDeck = shuffled(deckTypeIds(p.deckId));
        await setPlayerGameData(roomCode, p.uid, data);
      }
      await advanceToBattle(roomCode);
    } catch (err) {
      console.error("Passage au combat impossible :", err);
      hostAdvancedFrom.delete("ordering"); // autorise une nouvelle tentative
    } finally {
      hostAdvancing = false;
    }
  }
}

// ===============================================================
// PHASE 3 — ARÈNE (mise en place, combat à venir)
// ===============================================================
function renderBattle() {
  waitingMode = null;
  const me = myPlayerDoc();

  if (room.byeUid === currentUser.uid) {
    gameStage.innerHTML = `
      <h2 class="stage-title">Round en cours…</h2>
      <p class="stage-sub">Tu es en attente ce round (nombre impair de joueurs). Le prochain round sera pour toi !</p>
    `;
    return;
  }

  const opp = opponentOf(currentUser.uid);

  const sideHtml = (p, label) => `
    <div class="arena-side">
      <img class="arena-avatar" src="${escapeAttr(p?.photoURL || DEFAULT_AVATAR)}" alt="">
      <span class="arena-name">${escapeHtml(p?.displayName || label)}</span>
      <div class="arena-deck" aria-hidden="true">
        <div class="deck-back"></div>
        <div class="deck-back"></div>
        <div class="deck-back"><img src="assets/logo.png" alt=""></div>
      </div>
      <span class="arena-deck-count">${(p?.shuffledDeck || []).length || 10} cartes</span>
    </div>
  `;

  gameStage.innerHTML = `
    <h2 class="stage-title">L'arène est prête !</h2>
    <p class="stage-sub">Les decks sont mélangés et rangés. Le déroulé du combat arrive dans la prochaine étape.</p>
    <div class="arena">
      ${sideHtml(me, "Toi")}
      <span class="arena-vs">VS</span>
      ${sideHtml(opp, "Adversaire")}
    </div>
  `;
}
