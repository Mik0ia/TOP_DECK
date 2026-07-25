# Chess Lord — Lobby & Rooms

Premier bloc du jeu : écran de lobby, connexion via un compte Google
(Firebase Auth), et système de salons (rooms) en temps réel avec
Firestore. Pas encore de gameplay ni de lancement de partie — c'est la
prochaine étape.

## Arborescence

```
chess-lord/
├─ index.html
├─ css/style.css
├─ js/
│  ├─ firebase-config.js   ← à compléter avec TES clés Firebase
│  ├─ auth.js               connexion Google + profil joueur
│  ├─ rooms.js               créer / rejoindre / lister / fermer une salle
│  └─ main.js                 branchement de l'UI
└─ assets/logo.png
```

## 1. Créer le projet Firebase

1. Va sur https://console.firebase.google.com → **Ajouter un projet**.
2. Une fois le projet créé, va dans **Paramètres du projet ⚙ → Général**,
   descends jusqu'à "Vos applications" et clique sur l'icône Web `</>`
   pour enregistrer une application. Donne-lui un nom (ex : `chess-lord-web`).
3. Firebase t'affiche un objet `firebaseConfig`. Copie-le dans
   `js/firebase-config.js` à la place des valeurs `"REMPLACE_MOI"`.

## 2. Activer l'authentification Google

1. Dans la console Firebase → **Build → Authentication → Get started**.
2. Onglet **Sign-in method** → active le fournisseur **Google**.
3. Renseigne un nom public + email de support, puis enregistre.

## 3. Activer Firestore

1. **Build → Firestore Database → Créer une base de données**.
2. Choisis le mode **production** (les règles ci-dessous protègent les données).
3. Une fois la base créée, va dans l'onglet **Règles** et colle :

```js
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    match /users/{userId} {
      allow read: if request.auth != null;
      allow write: if request.auth != null && request.auth.uid == userId;
    }

    match /rooms/{roomId} {
      allow read: if request.auth != null;
      allow create: if request.auth != null
                    && request.resource.data.hostUid == request.auth.uid;
      // Mise à jour autorisée pour gérer playerCount lors des jointures/départs
      allow update: if request.auth != null;
      allow delete: if request.auth != null
                    && resource.data.hostUid == request.auth.uid;

      match /players/{playerId} {
        allow read: if request.auth != null;
        allow write: if request.auth != null &&
          (request.auth.uid == playerId ||
           get(/databases/$(database)/documents/rooms/$(roomId)).data.hostUid == request.auth.uid);
      }
    }
  }
}
```

4. **Build → Firestore Database → Index** : la liste des salles ouvertes
   utilise une requête `where("status","==","waiting") + orderBy("createdAt","desc")`.
   Firestore te proposera automatiquement un lien pour créer l'index
   composite nécessaire la première fois que tu ouvres la modale
   "Rejoindre" (ou crée-le manuellement : champ `status` Ascending +
   `createdAt` Descending).

## 4. Autoriser ton domaine pour la connexion Google

Dans **Authentication → Settings → Authorized domains**, ajoute le
domaine sur lequel tu vas héberger le site (Firebase y ajoute déjà
`localhost` par défaut).

## 5. Lancer le site en local

Les modules Firebase (`type="module"`) et la popup Google **ne
fonctionnent pas** en ouvrant simplement `index.html` avec `file://`.
Il faut un petit serveur local, par exemple :

```bash
cd chess-lord
python3 -m http.server 8080
# puis ouvre http://localhost:8080
```

Ou avec l'outil Firebase (recommandé, pratique pour déployer ensuite) :

```bash
npm install -g firebase-tools
firebase login
firebase init hosting   # choisis ce dossier comme "public"
firebase serve
```

## Comment fonctionne le système de salles

- Chaque salle est un document `rooms/{code}` où `code` est un
  identifiant lisible à 6 caractères (ex : `K3F9QZ`), généré côté
  client et utilisé directement comme ID de document.
- La liste "Rejoindre une partie" écoute en temps réel
  (`onSnapshot`) toutes les salles `status == "waiting"` : une salle
  apparaît dès sa création et disparaît dès que l'hôte la ferme
  (le document est supprimé de Firestore).
- Rejoindre par code fait une lecture directe du document
  `rooms/{code}` — pas besoin d'attendre qu'elle apparaisse dans la
  liste.
- Chaque salle a une sous-collection `players` ; rejoindre/quitter
  passe par une transaction Firestore pour garder `playerCount` exact
  même en cas d'actions simultanées.
- Se connecter/rechercher/rejoindre est bloqué tant qu'aucun compte
  Google n'est actif (bouton désactivé côté logique + règles
  Firestore qui exigent `request.auth != null`).

### Limite connue (v1)

La fermeture "propre" d'une salle quand quelqu'un ferme l'onglet sans
cliquer sur "Quitter" repose sur l'évènement `beforeunload`, qui
n'est pas garanti à 100 % (perte réseau, crash, etc.). Pour une
robustesse totale, l'étape suivante serait d'ajouter une présence via
**Firebase Realtime Database + `onDisconnect()`** (ou une Cloud
Function planifiée qui nettoie les salles inactives). Je peux
l'ajouter quand tu veux passer à cette itération.

## Prochaines étapes possibles

- Écran de la boutique
- Écran de support (formulaire / lien contact)
- Lancement de partie depuis la salle d'attente (bouton "Démarrer"
  réservé à l'hôte, une fois le gameplay prêt)
- Avatar personnalisable au moment de la première connexion
