// =====================================================================
// CHESS LORD — Authentification & profil joueur
// =====================================================================
import { auth, googleProvider, db, storage } from "./firebase-config.js";
import {
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  ref as storageRef,
  uploadBytes,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

/**
 * Etat courant, mis à jour à chaque changement d'auth.
 * profile = { displayName, photoURL, level, pieces, createdAt }
 *
 * displayName et photoURL sont désormais des données PROPRES à Chess Lord :
 * générées / initialisées une seule fois à la toute première connexion,
 * puis conservées telles quelles d'une session à l'autre (elles ne sont
 * plus jamais écrasées par le profil Google au re-login).
 */
export const authState = {
  user: null,
  profile: null
};

const listeners = new Set();

function notify() {
  listeners.forEach((cb) => cb(authState.user, authState.profile));
}

/**
 * S'abonner aux changements d'authentification.
 * Le callback est appelé immédiatement avec l'état courant, puis à
 * chaque changement (connexion / déconnexion / profil mis à jour).
 */
export function subscribeAuth(callback) {
  listeners.add(callback);
  callback(authState.user, authState.profile);
  return () => listeners.delete(callback);
}

// -----------------------------------------------------------------
// Génération d'un nom de joueur aléatoire (thème médiéval-fantastique,
// cohérent avec l'univers de Chess Lord). Utilisé UNIQUEMENT lors de
// la toute première connexion d'un compte Google.
// -----------------------------------------------------------------
const NAME_TITLES = [
  "Chevalier", "Baron", "Duc", "Seigneur", "Comte", "Écuyer",
  "Gardien", "Champion", "Maître", "Capitaine"
];
const NAME_SUFFIXES = [
  "duFeu", "desOmbres", "dOr", "duNord", "desAbysses", "duCorbeau",
  "duGivre", "desBrumes", "duChêne", "desÉtoiles", "duGouffre", "deFer"
];

function generateRandomPlayerName() {
  const title = NAME_TITLES[Math.floor(Math.random() * NAME_TITLES.length)];
  const suffix = NAME_SUFFIXES[Math.floor(Math.random() * NAME_SUFFIXES.length)];
  const number = Math.floor(100 + Math.random() * 900); // 100-999
  return `${title}${suffix}${number}`;
}

/**
 * Récupère (ou crée si elle n'existe pas encore) la fiche du joueur
 * dans la collection Firestore "users". Les 4 informations persistées :
 *  - level (int)
 *  - pieces (int)
 *  - displayName (texte, généré aléatoirement à la 1ère connexion)
 *  - photoURL (fichier stocké dans Firebase Storage, uploadable)
 */
async function ensureUserProfile(user) {
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);

  if (snap.exists()) {
    const data = snap.data();
    // Connexions suivantes : on NE touche PAS au nom / à la photo / aux
    // stats, on met juste à jour la date de dernière connexion. Les
    // données du compte restent celles choisies/uploadées par le joueur.
    await setDoc(ref, { lastLogin: serverTimestamp() }, { merge: true });
    return {
      displayName: data.displayName || generateRandomPlayerName(),
      photoURL: data.photoURL || "",
      level: Number.isFinite(data.level) ? data.level : 1,
      pieces: Number.isFinite(data.pieces) ? data.pieces : 0,
      createdAt: data.createdAt
    };
  }

  // Toute première connexion : on initialise le profil.
  const newProfile = {
    displayName: generateRandomPlayerName(),
    photoURL: user.photoURL || "", // valeur de départ = photo Google, modifiable ensuite
    level: 1,
    pieces: 0,
    createdAt: serverTimestamp(),
    lastLogin: serverTimestamp()
  };
  await setDoc(ref, newProfile);
  return newProfile;
}

export async function signInWithGoogle() {
  const result = await signInWithPopup(auth, googleProvider);
  return result.user;
}

export async function signOutUser() {
  await signOut(auth);
}

// -----------------------------------------------------------------
// Upload d'une nouvelle image de profil (Firebase Storage) et mise à
// jour du champ photoURL dans Firestore + de l'état local.
// -----------------------------------------------------------------
const MAX_AVATAR_BYTES = 5 * 1024 * 1024; // 5 Mo
const ALLOWED_AVATAR_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

export async function uploadProfilePhoto(file) {
  if (!authState.user) throw new Error("Il faut être connecté pour changer d'avatar.");
  if (!file) throw new Error("Aucun fichier sélectionné.");
  if (!ALLOWED_AVATAR_TYPES.includes(file.type)) {
    throw new Error("Format d'image non supporté (PNG, JPG, WEBP ou GIF).");
  }
  if (file.size > MAX_AVATAR_BYTES) {
    throw new Error("Image trop lourde (5 Mo maximum).");
  }

  const uid = authState.user.uid;
  const ext = (file.name.split(".").pop() || "png").toLowerCase();
  const path = `avatars/${uid}/avatar.${ext}`;
  const fileRef = storageRef(storage, path);

  await uploadBytes(fileRef, file, { contentType: file.type });
  const url = await getDownloadURL(fileRef);

  await setDoc(doc(db, "users", uid), { photoURL: url }, { merge: true });

  authState.profile = { ...authState.profile, photoURL: url };
  notify();
  return url;
}

// -----------------------------------------------------------------
// Mise à jour des stats persistées (niveau / pièces). Prêt à être
// appelé plus tard depuis la logique de jeu / la boutique.
// -----------------------------------------------------------------
export async function updatePlayerStats(patch = {}) {
  if (!authState.user) return;
  const allowed = {};
  if (Number.isFinite(patch.level)) allowed.level = Math.trunc(patch.level);
  if (Number.isFinite(patch.pieces)) allowed.pieces = Math.trunc(patch.pieces);
  if (!Object.keys(allowed).length) return;

  await setDoc(doc(db, "users", authState.user.uid), allowed, { merge: true });
  authState.profile = { ...authState.profile, ...allowed };
  notify();
}

// -----------------------------------------------------------------
// Ecoute globale de l'état d'authentification Firebase
// -----------------------------------------------------------------
onAuthStateChanged(auth, async (user) => {
  authState.user = user;

  if (!user) {
    authState.profile = null;
    notify();
    return;
  }

  try {
    authState.profile = await ensureUserProfile(user);
  } catch (err) {
    console.error("Erreur lors du chargement du profil :", err);
    authState.profile = {
      displayName: user.displayName || "Aventurier",
      photoURL: user.photoURL || "",
      level: 1,
      pieces: 0
    };
  }
  notify();
});
