// =====================================================================
// CHESS LORD — Authentification & profil joueur
// =====================================================================
import { auth, googleProvider, db } from "./firebase-config.js";
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

/**
 * Etat courant, mis à jour à chaque changement d'auth.
 * profile = { displayName, photoURL, level, createdAt }
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

/**
 * Récupère (ou crée si elle n'existe pas encore) la fiche du joueur
 * dans la collection Firestore "users".
 */
async function ensureUserProfile(user) {
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);

  if (snap.exists()) {
    const data = snap.data();
    // On garde le nom/avatar Google à jour, sans toucher au niveau.
    await setDoc(
      ref,
      {
        displayName: user.displayName || data.displayName || "Sans nom",
        photoURL: user.photoURL || data.photoURL || "",
        lastLogin: serverTimestamp()
      },
      { merge: true }
    );
    return { ...data, displayName: user.displayName || data.displayName, photoURL: user.photoURL || data.photoURL };
  }

  const newProfile = {
    displayName: user.displayName || "Sans nom",
    photoURL: user.photoURL || "",
    level: 1,
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
      displayName: user.displayName || "Sans nom",
      photoURL: user.photoURL || "",
      level: 1
    };
  }
  notify();
});
