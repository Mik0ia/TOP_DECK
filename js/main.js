// =====================================================================
// CHESS LORD — Contrôleur principal de l'interface du lobby
// =====================================================================
import {
  subscribeAuth,
  signInWithGoogle,
  signOutUser,
  uploadProfilePhoto,
  updateDisplayName,
  xpForLevel,
  xpProgressPercent
} from "./auth.js";
import {
  createRoom,
  joinRoomByCode,
  leaveRoom,
  closeRoom,
  removePlayerDoc,
  subscribeOpenRooms,
  subscribeRoom,
  subscribePlayers
} from "./rooms.js";

// ---------------------------------------------------------------
// Références DOM
// ---------------------------------------------------------------
const authArea = document.getElementById("authArea");
const btnGoogleLogin = document.getElementById("btnGoogleLogin");
const hintGuest = document.getElementById("hintGuest");

const btnOpenCreate = document.getElementById("btnOpenCreate");
const btnOpenJoin = document.getElementById("btnOpenJoin");
const btnShop = document.getElementById("btnShop");
const btnSupport = document.getElementById("btnSupport");

const modalCreate = document.getElementById("modalCreate");
const createRoomName = document.getElementById("createRoomName");
const createRoomMax = document.getElementById("createRoomMax");
const createError = document.getElementById("createError");
const btnConfirmCreate = document.getElementById("btnConfirmCreate");

const modalJoin = document.getElementById("modalJoin");
const joinCodeInput = document.getElementById("joinCodeInput");
const btnJoinByCode = document.getElementById("btnJoinByCode");
const joinError = document.getElementById("joinError");
const roomList = document.getElementById("roomList");
const roomListEmpty = document.getElementById("roomListEmpty");

const modalRoom = document.getElementById("modalRoom");
const roomViewName = document.getElementById("roomViewName");
const roomViewCode = document.getElementById("roomViewCode");
const roomViewCount = document.getElementById("roomViewCount");
const roomViewMax = document.getElementById("roomViewMax");
const playerList = document.getElementById("playerList");
const btnLeaveRoom = document.getElementById("btnLeaveRoom");
const btnCloseRoom = document.getElementById("btnCloseRoom");

const toastEl = document.getElementById("toast");
const avatarFileInput = document.getElementById("avatarFileInput");

// ---------------------------------------------------------------
// Etat local
// ---------------------------------------------------------------
let currentUser = null;
let currentProfile = null;

let unsubOpenRooms = null;
let unsubCurrentRoom = null;
let unsubCurrentPlayers = null;
let currentRoomCode = null;
let currentRoomIsHost = false;

const DEFAULT_AVATAR =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="#33261a"/><circle cx="20" cy="15" r="7" fill="#D58929"/><path d="M6 36c1-9 8-13 14-13s13 4 14 13" fill="#D58929"/></svg>'
  );

// ---------------------------------------------------------------
// Toast
// ---------------------------------------------------------------
let toastTimer = null;
function showToast(message, type = "") {
  toastEl.textContent = message;
  toastEl.className = "toast show" + (type ? " " + type : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.classList.remove("show");
  }, 3200);
}

// ---------------------------------------------------------------
// Modales génériques
// ---------------------------------------------------------------
function openModal(el) {
  el.classList.add("open");
}
function closeModal(el) {
  el.classList.remove("open");
}
document.querySelectorAll("[data-close]").forEach((btn) => {
  btn.addEventListener("click", () => closeModal(document.getElementById(btn.dataset.close)));
});
[modalCreate, modalJoin].forEach((overlay) => {
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeModal(overlay);
  });
});

// ---------------------------------------------------------------
// Auth UI
// ---------------------------------------------------------------
btnGoogleLogin.addEventListener("click", async () => {
  btnGoogleLogin.disabled = true;
  try {
    await signInWithGoogle();
  } catch (err) {
    console.error(err);
    showToast("Connexion impossible : " + friendlyAuthError(err), "error");
  } finally {
    btnGoogleLogin.disabled = false;
  }
});

function friendlyAuthError(err) {
  const code = err && err.code;
  if (code === "auth/popup-closed-by-user") return "fenêtre fermée avant la fin.";
  if (code === "auth/network-request-failed") return "problème réseau.";
  if (code === "auth/configuration-not-found" || code === "auth/invalid-api-key") {
    return "Firebase n'est pas encore configuré (voir js/firebase-config.js).";
  }
  return "réessaie dans un instant.";
}

// ---------------------------------------------------------------
// Zone compte (haut à droite) : barre d'XP, avatar, pseudo éditable
// ---------------------------------------------------------------
function renderAuthArea() {
  if (!currentUser) {
    authArea.innerHTML = "";
    authArea.appendChild(btnGoogleLogin);
    hintGuest.style.display = "block";
    return;
  }

  const photo = currentProfile?.photoURL || DEFAULT_AVATAR;
  const name = currentProfile?.displayName || "Aventurier";
  const level = currentProfile?.level ?? 1;
  const exp = currentProfile?.exp ?? 0;
  const needed = xpForLevel(level);
  const pct = xpProgressPercent(level, exp);

  authArea.innerHTML = `
    <div class="player-hud" id="playerHud">
      <div class="player-hud-col">
        <div class="xp-block">
          <div class="xp-track"><div class="xp-fill" style="width:${pct}%"></div></div>
          <span class="xp-caption"><b>Niveau ${level}</b> · ${exp}/${needed} xp</span>
        </div>
        <div class="user-name-row">
          <span class="user-name-display" id="userNameDisplay">${escapeHtml(name)}</span>
          <button type="button" class="user-name-edit-btn" id="btnEditName" title="Changer de pseudo">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/>
            </svg>
          </button>
        </div>
      </div>
      <div class="avatar-badge-wrap" id="avatarBadgeWrap">
        <img class="avatar-badge-img" src="${escapeAttr(photo)}" alt="${escapeAttr(name)}">
        <span class="avatar-level-badge">${level}</span>
      </div>
      <div class="user-dropdown" id="userDropdown">
        <button type="button" id="btnChangeAvatar">Changer l'avatar</button>
        <button type="button" id="btnLogout">Se déconnecter</button>
      </div>
    </div>
  `;
  hintGuest.style.display = "none";

  const avatarWrap = document.getElementById("avatarBadgeWrap");
  const dropdown = document.getElementById("userDropdown");
  avatarWrap.addEventListener("click", (e) => {
    e.stopPropagation();
    dropdown.classList.toggle("open");
  });
  document.getElementById("btnChangeAvatar").addEventListener("click", (e) => {
    e.stopPropagation();
    dropdown.classList.remove("open");
    avatarFileInput.click();
  });
  document.getElementById("btnLogout").addEventListener("click", async () => {
    dropdown.classList.remove("open");
    await leaveCurrentRoomIfAny();
    await signOutUser();
    closeModal(modalCreate);
    closeModal(modalJoin);
    closeModal(modalRoom);
  });
  document.addEventListener("click", () => dropdown.classList.remove("open"), { once: true });

  // ---- Edition du pseudo, directement dans le lobby ----
  const btnEditName = document.getElementById("btnEditName");
  btnEditName.addEventListener("click", (e) => {
    e.stopPropagation();
    startEditName(name);
  });
}

function startEditName(currentName) {
  const row = document.getElementById("userNameDisplay")?.parentElement;
  if (!row) return;
  row.innerHTML = "";

  const input = document.createElement("input");
  input.type = "text";
  input.className = "user-name-input";
  input.maxLength = 24;
  input.value = currentName;
  row.appendChild(input);
  input.focus();
  input.select();

  let settled = false;
  const commit = async () => {
    if (settled) return;
    settled = true;
    const newName = input.value;
    if (newName.trim() === currentName.trim()) {
      renderAuthArea();
      return;
    }
    try {
      await updateDisplayName(newName);
      showToast("Pseudo mis à jour !");
    } catch (err) {
      console.error(err);
      showToast(err.message || "Impossible de changer le pseudo.", "error");
      renderAuthArea();
    }
  };
  const cancel = () => {
    if (settled) return;
    settled = true;
    renderAuthArea();
  };

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); input.blur(); }
    if (e.key === "Escape") { e.preventDefault(); cancel(); }
  });
  input.addEventListener("blur", commit, { once: true });
}

avatarFileInput.addEventListener("change", async () => {
  const file = avatarFileInput.files && avatarFileInput.files[0];
  avatarFileInput.value = ""; // permet de re-sélectionner le même fichier plus tard
  if (!file) return;
  try {
    showToast("Envoi de l'avatar…");
    await uploadProfilePhoto(file);
    showToast("Avatar mis à jour !");
  } catch (err) {
    console.error(err);
    showToast(err.message || "Impossible de changer l'avatar.", "error");
  }
});

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}
function escapeAttr(str) {
  return escapeHtml(str);
}

// ---------------------------------------------------------------
// Garde d'accès : il faut être connecté pour créer / rejoindre
// ---------------------------------------------------------------
function requireAuth() {
  if (!currentUser) {
    showToast("Connecte-toi avec Google pour continuer.", "error");
    return false;
  }
  return true;
}

btnOpenCreate.addEventListener("click", () => {
  if (!requireAuth()) return;
  createError.textContent = "";
  createRoomName.value = "";
  createRoomMax.value = "8";
  openModal(modalCreate);
});

btnOpenJoin.addEventListener("click", () => {
  if (!requireAuth()) return;
  joinError.textContent = "";
  joinCodeInput.value = "";
  openModal(modalJoin);
  startOpenRoomsListener();
});

btnShop.addEventListener("click", () => {
  showToast("La boutique arrive bientôt \u2014 reviens plus tard, seigneur.");
});
btnSupport.addEventListener("click", () => {
  showToast("Le support n'est pas encore disponible.");
});

// ---------------------------------------------------------------
// Créer une salle
// ---------------------------------------------------------------
btnConfirmCreate.addEventListener("click", async () => {
  if (!requireAuth()) return;
  createError.textContent = "";
  btnConfirmCreate.disabled = true;
  try {
    const code = await createRoom(
      { name: createRoomName.value, maxPlayers: createRoomMax.value },
      currentUser,
      currentProfile
    );
    closeModal(modalCreate);
    enterRoomView(code, true);
  } catch (err) {
    console.error(err);
    createError.textContent = err.message || "Impossible de créer la salle.";
  } finally {
    btnConfirmCreate.disabled = false;
  }
});

// ---------------------------------------------------------------
// Rejoindre par code
// ---------------------------------------------------------------
btnJoinByCode.addEventListener("click", () => doJoinByCode());
joinCodeInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") doJoinByCode();
});
joinCodeInput.addEventListener("input", () => {
  joinCodeInput.value = joinCodeInput.value.toUpperCase();
});

async function doJoinByCode() {
  if (!requireAuth()) return;
  joinError.textContent = "";
  btnJoinByCode.disabled = true;
  try {
    const code = await joinRoomByCode(joinCodeInput.value, currentUser, currentProfile);
    closeModal(modalJoin);
    enterRoomView(code, false);
  } catch (err) {
    console.error(err);
    joinError.textContent = err.message || "Impossible de rejoindre cette salle.";
  } finally {
    btnJoinByCode.disabled = false;
  }
}

// ---------------------------------------------------------------
// Liste des salles ouvertes (temps réel)
// ---------------------------------------------------------------
function startOpenRoomsListener() {
  if (unsubOpenRooms) return; // déjà actif
  unsubOpenRooms = subscribeOpenRooms(renderRoomList);
}
function stopOpenRoomsListener() {
  if (unsubOpenRooms) {
    unsubOpenRooms();
    unsubOpenRooms = null;
  }
}

function renderRoomList(rooms) {
  roomList.innerHTML = "";
  if (!rooms.length) {
    roomListEmpty.style.display = "block";
    roomList.appendChild(roomListEmpty);
    return;
  }
  roomListEmpty.style.display = "none";

  rooms.forEach((room) => {
    const row = document.createElement("div");
    row.className = "room-row";
    const full = room.playerCount >= room.maxPlayers;
    row.innerHTML = `
      <img class="room-host-avatar" src="${escapeAttr(room.hostPhoto || DEFAULT_AVATAR)}" alt="">
      <div class="room-row-info">
        <div class="room-row-name">${escapeHtml(room.name)}</div>
        <div class="room-row-meta">Hôte : ${escapeHtml(room.hostName)} · ${room.playerCount}/${room.maxPlayers} joueurs</div>
        <div class="room-row-code">CODE ${escapeHtml(room.id)}</div>
      </div>
      <button class="btn btn-green btn-sm" ${full ? "disabled" : ""}>${full ? "Complet" : "Rejoindre"}</button>
    `;
    row.querySelector("button").addEventListener("click", async () => {
      try {
        await joinRoomByCode(room.id, currentUser, currentProfile);
        closeModal(modalJoin);
        enterRoomView(room.id, false);
      } catch (err) {
        showToast(err.message || "Impossible de rejoindre cette salle.", "error");
      }
    });
    roomList.appendChild(row);
  });
}

// ---------------------------------------------------------------
// Vue "salle d'attente"
// ---------------------------------------------------------------
function enterRoomView(code, isHost) {
  currentRoomCode = code;
  currentRoomIsHost = isHost;
  btnCloseRoom.style.display = isHost ? "inline-flex" : "none";
  btnLeaveRoom.textContent = isHost ? "Quitter (ferme la salle)" : "Quitter la salle";

  stopOpenRoomsListener();
  openModal(modalRoom);

  unsubCurrentRoom = subscribeRoom(code, (room) => {
    if (!room) {
      // La salle a été fermée par l'hôte, ou supprimée.
      showToast("Cette salle a été fermée.");
      exitRoomView({ alreadyGone: true });
      return;
    }
    roomViewName.textContent = room.name;
    roomViewCode.textContent = room.id;
    roomViewCount.textContent = room.playerCount;
    roomViewMax.textContent = room.maxPlayers;

    // L'hôte peut changer en cours de route (transfert automatique si
    // l'hôte précédent a quitté la salle) : on garde l'UI synchronisée.
    const isNowHost = !!currentUser && room.hostUid === currentUser.uid;
    if (isNowHost !== currentRoomIsHost) {
      currentRoomIsHost = isNowHost;
      btnCloseRoom.style.display = isNowHost ? "inline-flex" : "none";
      btnLeaveRoom.textContent = isNowHost ? "Quitter (ferme la salle)" : "Quitter la salle";
      if (isNowHost) showToast("Tu es désormais l'hôte de cette salle.");
    }
  });

  unsubCurrentPlayers = subscribePlayers(code, (players) => {
    playerList.innerHTML = "";
    players.forEach((p) => {
      const li = document.createElement("li");
      li.innerHTML = `
        <img src="${escapeAttr(p.photoURL || DEFAULT_AVATAR)}" alt="">
        <span class="p-name">${escapeHtml(p.displayName)}</span>
        <span class="p-level">Niv. ${p.level ?? 1} · ${p.pieces ?? 0} pièces</span>
        ${p.isHost ? '<span class="p-host-tag">Hôte</span>' : ""}
      `;
      playerList.appendChild(li);
    });
  });
}

function exitRoomView({ alreadyGone } = {}) {
  if (unsubCurrentRoom) { unsubCurrentRoom(); unsubCurrentRoom = null; }
  if (unsubCurrentPlayers) { unsubCurrentPlayers(); unsubCurrentPlayers = null; }
  currentRoomCode = null;
  currentRoomIsHost = false;
  closeModal(modalRoom);
}

btnLeaveRoom.addEventListener("click", async () => {
  if (!currentRoomCode) return;
  const code = currentRoomCode;
  exitRoomView();
  try {
    await leaveRoom(code, currentUser.uid);
  } catch (err) {
    console.error(err);
  }
});

btnCloseRoom.addEventListener("click", async () => {
  if (!currentRoomCode) return;
  const code = currentRoomCode;
  exitRoomView();
  try {
    await closeRoom(code);
  } catch (err) {
    console.error(err);
  }
});

async function leaveCurrentRoomIfAny() {
  if (!currentRoomCode) return;
  const code = currentRoomCode;
  exitRoomView();
  try {
    await leaveRoom(code, currentUser.uid);
  } catch (e) {
    /* silencieux */
  }
}

// Nettoyage best-effort si l'onglet se ferme pendant qu'on est dans une salle.
window.addEventListener("beforeunload", () => {
  if (currentRoomCode && currentUser) {
    // Best effort — pas garanti, une solution robuste nécessiterait
    // Realtime Database + onDisconnect() ou des Cloud Functions.
    removePlayerDoc(currentRoomCode, currentUser.uid);
  }
});

// ---------------------------------------------------------------
// Fermer la modale "rejoindre" -> couper l'écoute de la liste
// ---------------------------------------------------------------
document.querySelector('[data-close="modalJoin"]').addEventListener("click", stopOpenRoomsListener);
modalJoin.addEventListener("click", (e) => {
  if (e.target === modalJoin) stopOpenRoomsListener();
});

// ---------------------------------------------------------------
// Abonnement à l'état d'authentification
// ---------------------------------------------------------------
subscribeAuth((user, profile) => {
  const wasLoggedIn = !!currentUser;
  currentUser = user;
  currentProfile = profile;
  renderAuthArea();

  if (!user && wasLoggedIn) {
    // Déconnexion : on ferme tout ce qui nécessitait un compte.
    stopOpenRoomsListener();
    exitRoomView();
  }
});
