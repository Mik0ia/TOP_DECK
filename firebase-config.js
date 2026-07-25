// =====================================================================
// CHESS LORD — Configuration Firebase
// =====================================================================
// 1. Va sur https://console.firebase.google.com et crée un projet.
// 2. Dans "Paramètres du projet" > "Général", ajoute une application Web
//    (icône </>) et copie l'objet de config qu'on te donne ici :
// =====================================================================

export const firebaseConfig = {
  apiKey: "AIzaSyD9Hbh7qzKkgk4uO0fAbBPguKhoa_wJAB8",
  authDomain: "chess-lord.firebaseapp.com",
  projectId: "chess-lord",
  storageBucket: "chess-lord.firebasestorage.app",
  messagingSenderId: "591188729138",
  appId: "1:591188729138:web:7296a2c3f1c5d2c7320b2b",
  measurementId: "G-S2HM47J4CN"
};

// =====================================================================
// Initialisation des SDK Firebase (modules v10, chargés via CDN)
// =====================================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  initializeFirestore,
  CACHE_SIZE_UNLIMITED
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export const db = initializeFirestore(app, {
  cacheSizeBytes: CACHE_SIZE_UNLIMITED
});
