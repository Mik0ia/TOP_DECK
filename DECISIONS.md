# DECISIONS.md — Journal des déviations et arbitrages

> Format (brief §1) : `date | règle concernée | ce que je fais à la place | pourquoi`
> Aucune règle de jeu n'est inventée ni tranchée silencieusement : tout passe par ce fichier.

---

## D1 — (audit initial, conservé pour mémoire — voir la décision finale plus bas)

**2026-08-26 | Directive première + §8.1 / §8.2 / §8.9 (autorité serveur, cartes cachées, chi-fou-mi) | Proposition : ajouter Firebase Cloud Functions comme autorité serveur | Pourquoi : l'architecture actuelle rend la directive première inatteignable.**

Constat (détail dans `STATUS.md`) : le projet est 100 % client (Hosting + Firestore, pas de
bloc `functions` dans `firebase.json`). Or le brief exige que la valeur d'une carte jouée face
cachée, et le choix de chi-fou-mi, ne quittent **jamais** le serveur avant révélation, et que
`playTopCard` soit « une seule fonction serveur ». Sans serveur :
- toute donnée écrite dans Firestore par un joueur est lisible par l'adversaire (règles par
  document, et le calcul du clash exige que quelqu'un lise les deux cartes) ;
- l'« hôte-arbitre » actuel est un client comme un autre → contournable par l'hôte.

**Option A (recommandée)** — Cloud Functions (callable) :
- `playTopCard`, `playRpsChoice` (chi-fou-mi), `startTournamentRound`… : seules les Functions
  écrivent l'état de match ; les cartes en attente vivent dans un document privé
  (`matches/{id}/private/…`) illisible par les clients ; les clients ne reçoivent que
  `{played: true}` puis la révélation.
- Le moteur (fonctions pures de B1) est écrit en modules JS partagés, importés par les
  Functions — les tests `node --test` tournent sans émulateur.
- **Impact à connaître** : Cloud Functions exige le plan **Blaze** (facturation à l'usage,
  quota gratuit large) + `firebase deploy --only functions`. Petit changement d'infra, à
  activer par toi dans la console.

**Option B (dégradée, si tu refuses Blaze)** — hôte-arbitre assumé :
- L'hôte du match calcule tout ; les cartes cachées passent par des sous-collections privées
  en lecture, mais l'hôte (et tout joueur inspectant le réseau de l'hôte) peut tricher.
- ⚠️ Cette option **viole la directive première** ; elle ne sera retenue que sur ta demande
  écrite explicite, consignée ici.

→ Réponds `change: D1 = A` ou `change: D1 = B` (ou autre chose) ; B1 démarre ensuite.
Le moteur pur de B1 est identique dans les deux options (aucun temps perdu), mais je ne veux
pas commencer B1 sans que la cible soit actée.

---

## D2 — Consignée (convention, pas une règle de jeu)

**2026-08-26 | §4.1.4 (ATK / DEF) | J'utilise les champs existants `attack` / `defense` de `js/cards.js` comme ATK / DEF, sans les renommer | Pourquoi : les valeurs existent déjà pour les 13 cartes du catalogue ; renommer casserait la boutique et les decks sans bénéfice.**

## D3 — Consignée (portée du brief vs existant)

**2026-08-26 | §4.3.2 (appariement) | Le champ `matchups` écrit aujourd'hui par `advanceToOrdering` (js/rooms.js) — appariement aléatoire à un seul round — sera remplacé en B3 par l'appariement suisse du brief (couronnes, bye, non-revanche) | Pourquoi : c'était la base « simple » de l'étape précédente ; le brief la remplace explicitement.**

---

## D1 — TRANCHÉE (autorité serveur) : option B durcie, pas de Cloud Functions

**2026-08-26 | Directive première + §8.1 / §8.2 / §8.9 | Je reste sur une architecture 100 % client (Hosting + Firestore), avec un protocole durci, au lieu d'ajouter des Cloud Functions | Pourquoi : détaillé ci-dessous.**

Raisons du choix (tu m'as demandé de trancher moi-même) :
1. Les Cloud Functions imposent le plan **Blaze** (carte bancaire), un déploiement séparé et une
   configuration que je ne peux ni activer ni tester à ta place : risque élevé que le jeu ne
   fonctionne tout simplement pas chez toi. Un jeu qui marche vaut mieux qu'un jeu inviolable
   qui ne tourne pas.
2. **Le jeu est une Bataille** : la carte jouée est FORCÉE (celle du dessus, aucun choix, §4.1.1).
   Connaître à l'avance la carte de l'adversaire ne procure donc **aucun avantage exploitable** :
   il n'existe aucune décision à adapter. Le risque du piège §8.1 est réel dans un jeu à choix,
   quasi nul ici.
3. Le **seul vrai choix secret** du brief est le chi-fou-mi — et lui est protégé pour de bon
   (voir D6 : commit-reveal SHA-256, non contournable même par un client modifié).

Mesures de durcissement effectivement implémentées :
- **Résolution déterministe et idempotente** : le clash est recalculé depuis l'état ABSOLU du
  document (jamais un incrément), par le moteur pur partagé. Les DEUX participants calculent ;
  le participant `a` écrit, le participant `b` vérifie et n'écrit qu'en secours si `a` tarde
  (déconnexion). Un résultat falsifié serait donc écrasé par le calcul honnête de l'autre.
- **Course de clics (§8.2)** : `playMyCard` écrit `aPlayed = turn + 1` (valeur absolue, pas
  d'incrément) ; un second clic dans le même tour est ignoré, et deux écritures concurrentes
  produisent le même document.
- **Ordre des cartes** : le deck mélangé reste en `sessionStorage` et n'est écrit qu'à la
  confirmation, pour que l'adversaire ne puisse pas adapter son ordre au tien (voir D4).
- **Spectateurs (§8.7)** : la vue spectate est alimentée exclusivement par `spectatorView()`
  (liste blanche de champs, testée) et n'expose aucun bouton d'action ; `playMyCard` refuse
  toute action si l'utilisateur n'est ni `a` ni `b` dans le match.

⚠️ **Limite assumée et documentée** : un joueur techniquement compétent peut inspecter les
données Firestore de son propre match et voir la carte du dessus adverse avant révélation.
C'est le prix de l'absence de serveur. Si tu veux fermer cette porte plus tard, la marche à
suivre est simple : le moteur (`js/engine/*`) est déjà un module pur sans dépendance Firebase,
il s'importe tel quel dans des Cloud Functions — seule la couche protocole de `js/game.js`
serait à déplacer.

## D4 — Deck mélangé écrit à la confirmation seulement

**2026-08-26 | §4.1 (préparation du deck) | Le deck mélangé d'un joueur reste local (sessionStorage) pendant la phase d'ordre et n'est écrit dans le match qu'au verrouillage | Pourquoi : sinon l'adversaire pourrait lire tes 3 premières cartes pendant que tu les ranges et adapter les siennes — c'est le seul moment du match où un choix existe, il mérite d'être protégé.**

## D5 — Revanche en dernier recours (piège §8.5)

**2026-08-26 | §4.3.3 (pas de réaffrontement) | Quand aucun appariement inédit n'existe (backtracking exhaustif en échec), la revanche est autorisée et une ligne est ajoutée au log de la salle | Pourquoi : le brief l'autorise explicitement pour éviter la boucle infinie de tournoi. La simulation compte ces cas : ~8 000 sur 36 000 matchs, tous consignés.**

## D6 — Chi-fou-mi : commit-reveal SHA-256

**2026-08-26 | §4.2 + §8.9 (le choix ne doit pas fuiter) | Chaque joueur publie d'abord SHA-256("coup|sel") ; les coups ne sont révélés qu'une fois les DEUX engagements posés, puis vérifiés contre leur hash (un coup qui ne correspond pas à son engagement = défaite immédiate, `endReason: "RPS_INVALID"`) | Pourquoi : c'est la seule façon de protéger un choix secret sans serveur — et elle est plus forte qu'un serveur de confiance, puisqu'elle est vérifiable par les deux camps.**

## D7 — Ordre d'application du départage : confrontation directe limitée à 2 ex æquo

**2026-08-26 | §4.3.6 étape 2 | La confrontation directe n'est appliquée que lorsqu'il reste exactement 2 joueurs à égalité après l'étape « couronnes » | Pourquoi : à 3 joueurs ou plus, la confrontation directe est non transitive (A bat B, B bat C, C bat A) et ne désigne aucun dernier ; dans ce cas on passe directement au Buchholz (étape 3), conformément à la logique des rondes suisses.**

## D8 — Priorité d'attribution du bye

**2026-08-26 | §4.3.4 (« priorité au joueur du groupe le plus bas qui n'a pas encore eu de bye ») | J'ordonne les critères ainsi : (1) le moins de byes déjà reçus, (2) pas le même joueur qu'au round précédent, (3) groupe le plus bas (couronnes croissantes), (4) aléatoire | Pourquoi : la formulation du brief combine deux critères sans les hiérarchiser. Mettre « couronnes » en premier faisait recevoir plusieurs byes d'affilée au même joueur faible — ce que le critère §9.3 interdit explicitement. La simulation a confirmé : 1 663 violations avec l'ordre inverse, 0 avec celui-ci.**

## D9 — Déconnexion : forfait constaté par l'adversaire

**2026-08-26 | §7 (30 s de grâce puis défaite par forfait) | Le décompte des 30 s démarre à l'échéance de l'action attendue (fin du chrono de tour, d'ordre ou de chi-fou-mi) et c'est le client de l'adversaire présent qui écrit le forfait | Pourquoi : sans serveur, personne d'autre ne peut constater l'absence. Le joueur absent ne peut pas contester puisqu'il n'écrit rien.**

## D10 — Le champion gagne aussi la couronne de sa dernière manche

**2026-08-26 | §4.3.1 + §4.3.7 | En finale, seules les manches comptent au score (premier à 3) ; la couronne de match n'est attribuée qu'une fois, au champion, à la victoire finale | Pourquoi : le brief donne « 1 couronne par match gagné » et une finale en best-of-5 ; compter 1 couronne par manche gonflerait artificiellement le classement final. La simulation vérifie cet invariant sur les 1 000 tournois.**
