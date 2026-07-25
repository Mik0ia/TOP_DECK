// =====================================================================
// CHESS LORD — Gestion des salles (rooms) en temps réel via Firestore
// =====================================================================
import { db } from "./firebase-config.js";
import {
  collection,
  doc,
  setDoc,
  getDoc,
  deleteDoc,
  runTransaction,
  onSnapshot,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const ROOMS = "rooms";
const PLAYERS = "players";

// Alphabet sans caractères ambigus (0/O, 1/I) pour des codes lisibles.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function generateCode(length = 6) {
  let code = "";
  for (let i = 0; i < length; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

/**
 * Crée une nouvelle salle. Le code de la salle sert directement
 * d'identifiant de document, ce qui permet une jointure par code en
 * une seule lecture.
 */
export async function createRoom({ name, maxPlayers }, user, profile) {
  let code, ref, attempt = 0;

  do {
    code = generateCode();
    ref = doc(db, ROOMS, code);
    const existing = await getDoc(ref);
    if (!existing.exists()) break;
    attempt++;
  } while (attempt < 6);

  if (attempt >= 6) throw new Error("Impossible de générer un code de salle unique, réessaie.");

  const roomData = {
    code,
    name: (name || "").trim() || `Salle de ${profile.displayName}`,
    hostUid: user.uid,
    hostName: profile.displayName,
    hostPhoto: profile.photoURL || "",
    maxPlayers: Number(maxPlayers) || 8,
    playerCount: 1,
    status: "waiting",
    createdAt: serverTimestamp()
  };

  await setDoc(ref, roomData);

  const playerRef = doc(db, ROOMS, code, PLAYERS, user.uid);
  await setDoc(playerRef, {
    uid: user.uid,
    displayName: profile.displayName,
    photoURL: profile.photoURL || "",
    level: profile.level || 1,
    isHost: true,
    joinedAt: serverTimestamp()
  });

  return code;
}

/**
 * Rejoint une salle existante par son code. Utilise une transaction
 * pour éviter qu'une salle ne dépasse son nombre maximum de joueurs
 * en cas de jointures simultanées.
 */
export async function joinRoomByCode(rawCode, user, profile) {
  const code = (rawCode || "").trim().toUpperCase();
  if (!code) throw new Error("Entre un code de salle.");

  const roomRef = doc(db, ROOMS, code);
  const playerRef = doc(db, ROOMS, code, PLAYERS, user.uid);

  await runTransaction(db, async (tx) => {
    const roomSnap = await tx.get(roomRef);
    if (!roomSnap.exists()) {
      throw new Error("Cette salle n'existe pas ou a été fermée.");
    }
    const room = roomSnap.data();
    if (room.status !== "waiting") {
      throw new Error("Cette salle n'est plus disponible.");
    }

    const playerSnap = await tx.get(playerRef);
    if (playerSnap.exists()) {
      // Déjà dans la salle : simple retour, pas d'incrément.
      return;
    }

    if (room.playerCount >= room.maxPlayers) {
      throw new Error("Cette salle est déjà complète.");
    }

    tx.set(playerRef, {
      uid: user.uid,
      displayName: profile.displayName,
      photoURL: profile.photoURL || "",
      level: profile.level || 1,
      isHost: false,
      joinedAt: serverTimestamp()
    });
    tx.update(roomRef, { playerCount: room.playerCount + 1 });
  });

  return code;
}

/**
 * Quitte une salle. Si le joueur est l'hôte, la salle est fermée
 * pour tout le monde (elle disparaît de la liste).
 */
export async function leaveRoom(code, uid, isHost) {
  const roomRef = doc(db, ROOMS, code);

  if (isHost) {
    await closeRoom(code);
    return;
  }

  const playerRef = doc(db, ROOMS, code, PLAYERS, uid);
  await runTransaction(db, async (tx) => {
    const roomSnap = await tx.get(roomRef);
    if (!roomSnap.exists()) return;
    const room = roomSnap.data();
    tx.delete(playerRef);
    tx.update(roomRef, { playerCount: Math.max(0, room.playerCount - 1) });
  });
}

/**
 * Ferme définitivement une salle (réservé à l'hôte).
 * NB : sans Cloud Functions, on supprime uniquement le document du
 * joueur courant + le document de la salle ; les sous-documents des
 * autres joueurs restants sont nettoyés côté client au moment où
 * chacun d'eux détecte la fermeture (voir subscribeRoom → null).
 */
export async function closeRoom(code) {
  const roomRef = doc(db, ROOMS, code);
  await deleteDoc(roomRef);
}

export async function removePlayerDoc(code, uid) {
  try {
    await deleteDoc(doc(db, ROOMS, code, PLAYERS, uid));
  } catch (e) {
    // La salle est peut-être déjà fermée, on ignore.
  }
}

/**
 * Ecoute en temps réel la liste des salles ouvertes (status == waiting).
 */
export function subscribeOpenRooms(callback) {
  const q = query(
    collection(db, ROOMS),
    where("status", "==", "waiting"),
    orderBy("createdAt", "desc"),
    limit(50)
  );
  return onSnapshot(q, (snap) => {
    const rooms = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    callback(rooms);
  });
}

/**
 * Ecoute en temps réel une salle précise. callback(null) si la salle
 * a été fermée / supprimée.
 */
export function subscribeRoom(code, callback) {
  const roomRef = doc(db, ROOMS, code);
  return onSnapshot(roomRef, (snap) => {
    callback(snap.exists() ? { id: snap.id, ...snap.data() } : null);
  });
}

/**
 * Ecoute en temps réel la liste des joueurs d'une salle.
 */
export function subscribePlayers(code, callback) {
  const playersRef = collection(db, ROOMS, code, PLAYERS);
  return onSnapshot(playersRef, (snap) => {
    const players = snap.docs.map((d) => d.data());
    players.sort((a, b) => (a.isHost ? -1 : 1) - (b.isHost ? -1 : 1));
    callback(players);
  });
}
