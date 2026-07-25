// =====================================================================
// CHESS LORD — Gestion des salles (rooms) en temps réel via Firestore
// =====================================================================
import { db } from "./firebase-config.js";
import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  deleteDoc,
  writeBatch,
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
    pieces: profile.pieces || 0,
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
      pieces: profile.pieces || 0,
      isHost: false,
      joinedAt: serverTimestamp()
    });
    tx.update(roomRef, { playerCount: room.playerCount + 1 });
  });

  return code;
}

/**
 * Quitte une salle.
 * - Le joueur est toujours retiré de la sous-collection "players".
 * - Si c'était le DERNIER joueur restant dans la salle, la salle est
 *   fermée (document supprimé) — peu importe qu'il s'agisse de l'hôte
 *   ou non.
 * - Si l'hôte quitte et qu'il reste d'autres joueurs, l'hôte est
 *   automatiquement transféré à un joueur restant (le plus ancien
 *   arrivé) pour que la salle reste gérable.
 *
 * Retourne { roomClosed: boolean } pour que l'UI sache si la salle a
 * disparu.
 */
export async function leaveRoom(code, uid) {
  const roomRef = doc(db, ROOMS, code);
  const playerRef = doc(db, ROOMS, code, PLAYERS, uid);

  let roomClosed = false;
  let hostLeftWithRemainingPlayers = false;

  await runTransaction(db, async (tx) => {
    const roomSnap = await tx.get(roomRef);
    if (!roomSnap.exists()) return; // déjà fermée
    const room = roomSnap.data();

    const playerSnap = await tx.get(playerRef);
    if (!playerSnap.exists()) return; // déjà parti

    tx.delete(playerRef);
    const newCount = Math.max(0, (room.playerCount || 1) - 1);

    if (newCount <= 0) {
      // Dernier joueur : on ferme la salle.
      tx.delete(roomRef);
      roomClosed = true;
    } else {
      tx.update(roomRef, { playerCount: newCount });
      hostLeftWithRemainingPlayers = room.hostUid === uid;
    }
  });

  if (roomClosed) {
    // Filet de sécurité : s'assure qu'aucun document "players" ne reste
    // orphelin dans Firestore après la fermeture de la salle (le
    // playerCount devrait déjà être à 0, mais on nettoie quand même
    // pour éviter toute fuite de mémoire côté base si jamais il restait
    // un document désynchronisé).
    await deletePlayersSubcollection(code).catch((e) =>
      console.error("Nettoyage des joueurs de la salle impossible :", e)
    );
  } else if (hostLeftWithRemainingPlayers) {
    await reassignHost(code, uid).catch((e) => console.error("Transfert d'hôte impossible :", e));
  }

  return { roomClosed };
}

/**
 * Supprime tous les documents de la sous-collection "players" d'une
 * salle. Firestore ne supprime PAS automatiquement les sous-collections
 * quand on supprime le document parent : sans ce nettoyage, ces
 * documents resteraient orphelins indéfiniment et finiraient par
 * saturer la base au fil des parties.
 */
async function deletePlayersSubcollection(code) {
  const playersRef = collection(db, ROOMS, code, PLAYERS);
  const snap = await getDocs(playersRef);
  if (snap.empty) return;

  const batch = writeBatch(db);
  snap.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();
}

/**
 * Transfère le rôle d'hôte au joueur restant arrivé en premier dans
 * la salle. Appelé automatiquement quand l'hôte quitte sans être le
 * dernier joueur.
 */
async function reassignHost(code, previousHostUid) {
  const playersRef = collection(db, ROOMS, code, PLAYERS);
  const q = query(playersRef, orderBy("joinedAt", "asc"), limit(1));
  const snap = await getDocs(q);
  if (snap.empty) return;

  const newHostDoc = snap.docs[0];
  const newHost = newHostDoc.data();
  if (!newHost || newHost.uid === previousHostUid) return;

  const roomRef = doc(db, ROOMS, code);
  const newHostPlayerRef = doc(db, ROOMS, code, PLAYERS, newHost.uid);

  await runTransaction(db, async (tx) => {
    const roomSnap = await tx.get(roomRef);
    if (!roomSnap.exists()) return;
    tx.update(roomRef, {
      hostUid: newHost.uid,
      hostName: newHost.displayName,
      hostPhoto: newHost.photoURL || ""
    });
    tx.update(newHostPlayerRef, { isHost: true });
  });
}

/**
 * Ferme définitivement une salle (bouton "Fermer la salle", réservé
 * à l'hôte dans l'UI). Supprime aussi TOUS les documents de la
 * sous-collection "players" restants avant de supprimer la salle
 * elle-même : Firestore ne fait pas ce nettoyage automatiquement, donc
 * sans cette étape les fiches des joueurs qui étaient encore dans la
 * salle resteraient orphelines dans la base et finiraient par
 * l'alourdir inutilement partie après partie.
 */
export async function closeRoom(code) {
  await deletePlayersSubcollection(code);
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
