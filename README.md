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
│  ├─ firebase-config.js   ← à compléter avec TES clés Firebase (Auth + Firestore + Storage)
│  ├─ auth.js               connexion Google, profil persistant (nom/niveau/pièces/avatar)
│  ├─ rooms.js               créer / rejoindre / lister / quitter / fermer une salle
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
      // Mise à jour autorisée pour gérer playerCount / transfert d'hôte
      // lors des jointures / départs, et pour que l'hôte pilote le
      // tournoi (état, round, matchs du round).
      allow update: if request.auth != null;
      allow delete: if request.auth != null
                    && (resource.data.hostUid == request.auth.uid
                        || resource.data.playerCount <= 1);

      match /players/{playerId} {
        allow read: if request.auth != null;
        allow write: if request.auth != null &&
          (request.auth.uid == playerId ||
           get(/databases/$(database)/documents/rooms/$(roomId)).data.hostUid == request.auth.uid);
      }

      // ---- Matchs (combat & tournoi) ----
      // Lecture : tous les joueurs authentifiés de la salle — c'est ce
      // qui permet aux joueurs ÉLIMINÉS de regarder les matchs en cours
      // (spectate, §4.3.8). La confidentialité des cartes non révélées
      // est assurée côté application par la projection spectatorView()
      // et, pour le chi-fou-mi, par le commit-reveal SHA-256
      // (voir DECISIONS.md, D1 et D6).
      //
      // Écriture : réservée aux DEUX participants du match et à l'hôte
      // (qui crée les documents du round). Un spectateur ne peut donc
      // strictement rien écrire — c'est la garantie serveur du piège
      // §8.7 : même un client modifié ne peut pas jouer à la place d'un
      // participant ni interférer dans un match qui n'est pas le sien.
      match /matches/{matchId} {
        allow read: if request.auth != null;

        allow create: if request.auth != null
                      && get(/databases/$(database)/documents/rooms/$(roomId)).data.hostUid == request.auth.uid;

        allow update: if request.auth != null
                      && (request.auth.uid == resource.data.a
                          || request.auth.uid == resource.data.b
                          || get(/databases/$(database)/documents/rooms/$(roomId)).data.hostUid == request.auth.uid);

        // Suppression : l'hôte, ou n'importe quel joueur quand la salle
        // se ferme (dernier joueur qui part) — même logique que la
        // suppression de la salle, pour ne pas laisser de documents
        // de match orphelins dans la base.
        allow delete: if request.auth != null
                      && (get(/databases/$(database)/documents/rooms/$(roomId)).data.hostUid == request.auth.uid
                          || get(/databases/$(database)/documents/rooms/$(roomId)).data.playerCount <= 1);
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

## 4. Activer Firebase Storage (avatars uploadés)

1. **Build → Storage → Get started**, garde l'emplacement par défaut.
2. Onglet **Règles**, colle :

```js
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /avatars/{uid}/{fileName} {
      // Les avatars sont publics en lecture (affichés dans les salles),
      // mais chaque joueur ne peut écrire QUE dans son propre dossier.
      allow read: if true;
      allow write: if request.auth != null
                   && request.auth.uid == uid
                   && request.resource.size < 5 * 1024 * 1024
                   && request.resource.contentType.matches('image/.*');
      allow delete: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

## 5. Autoriser ton domaine pour la connexion Google

Dans **Authentication → Settings → Authorized domains**, ajoute le
domaine sur lequel tu vas héberger le site (Firebase y ajoute déjà
`localhost` par défaut).

## 6. Lancer le site en local

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
  apparaît dès sa création et disparaît dès qu'elle est fermée.
- Rejoindre par code fait une lecture directe du document
  `rooms/{code}` — pas besoin d'attendre qu'elle apparaisse dans la
  liste.
- Chaque salle a une sous-collection `players` ; rejoindre/quitter
  passe par une transaction Firestore pour garder `playerCount` exact
  même en cas d'actions simultanées.
- **Quitter une salle (`leaveRoom`)** retire toujours le joueur de la
  sous-collection `players` et décrémente `playerCount`. Si le joueur
  qui part était le **dernier** de la salle, le document `rooms/{code}`
  est supprimé — la salle est fermée, que ce joueur soit l'hôte
  d'origine ou non. Si l'hôte quitte et qu'il reste d'autres joueurs,
  le rôle d'hôte est automatiquement transféré au joueur restant
  arrivé en premier (`reassignHost`), pour que la salle reste gérable
  (bouton "Fermer la salle" affiché au bon endroit, etc.).
- **Se déconnecter (bouton "Se déconnecter")** appelle
  `leaveCurrentRoomIfAny()` avant `signOutUser()` : le joueur quitte
  proprement sa salle courante (avec fermeture/transfert d'hôte comme
  ci-dessus) avant que sa session Firebase ne se termine.
- Se connecter/rechercher/rejoindre est bloqué tant qu'aucun compte
  Google n'est actif (bouton désactivé côté logique + règles
  Firestore qui exigent `request.auth != null`).

### Limite connue (v1)

La fermeture d'une salle quand quelqu'un ferme l'onglet ou perd sa
connexion sans passer par "Quitter" / "Se déconnecter" repose sur
l'évènement `beforeunload`, qui n'est pas garanti à 100 % (perte
réseau, crash, etc.). Pour une robustesse totale, l'étape suivante
serait d'ajouter une présence via **Firebase Realtime Database +
`onDisconnect()`** (ou une Cloud Function planifiée qui nettoie les
salles inactives). Je peux l'ajouter quand tu veux passer à cette
itération.

## Profil joueur persistant

Chaque compte Google est lié à un document `users/{uid}` dans
Firestore qui stocke 4 informations, conservées d'une connexion à
l'autre (elles ne sont **jamais** écrasées par les données du compte
Google au re-login) :

| Champ         | Type       | Origine                                                            |
| ------------- | ---------- | ------------------------------------------------------------------- |
| `displayName` | `string`   | Généré aléatoirement (thème médiéval) à la **toute première** connexion |
| `photoURL`    | `string`   | URL Firebase Storage ; uploadable via "Changer l'avatar"            |
| `level`       | `int`      | `1` par défaut ; à faire évoluer plus tard via `updatePlayerStats()` |
| `pieces`      | `int`      | `0` par défaut ; à faire évoluer plus tard via `updatePlayerStats()` |

- La génération du nom (`generateRandomPlayerName()` dans `auth.js`)
  et l'initialisation du profil se font une seule fois, au premier
  `setDoc`. Les connexions suivantes ne mettent à jour que
  `lastLogin`.
- L'avatar est uploadé via `uploadProfilePhoto(file)` (bouton
  "Changer l'avatar" dans le menu du joueur) : le fichier est stocké
  dans Firebase Storage sous `avatars/{uid}/avatar.<ext>`, et l'URL de
  téléchargement est enregistrée dans `photoURL`. Formats acceptés :
  PNG / JPG / WEBP / GIF, 5 Mo max.
- `updatePlayerStats({ level, pieces })` (dans `auth.js`) est prêt à
  être appelé depuis la future logique de jeu / boutique pour faire
  évoluer le niveau et les pièces.

## Prochaines étapes possibles

- Écran de la boutique (dépenser/gagner des pièces)
- Écran de support (formulaire / lien contact)
- Lancement de partie depuis la salle d'attente (bouton "Démarrer"
  réservé à l'hôte, une fois le gameplay prêt)
- Présence réseau robuste via Realtime Database + `onDisconnect()`
