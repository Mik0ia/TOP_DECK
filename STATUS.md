# STATUS.md — Système de combat & tournoi

> Fichier de continuité de session (brief §2). Mis à jour à la fin de chaque bloc.

## Blocs terminés : **B0 → B4**, puis passe **B5 — effets, récompenses, plateau**

Toutes les décisions prises sans arbitrage humain sont consignées dans `DECISIONS.md`
(D1 à D10) — dont **D1**, la décision d'architecture : pas de Cloud Functions, architecture
client durcie (raisons et limite assumée détaillées dans le fichier).

---

## Comment vérifier (commandes relançables)

```bash
npm test          # 87 tests unitaires (moteur, tournoi, effets, récompenses, protocole)
npm run simulate  # juge externe §10 : 1 000 tournois, 2 à 16 joueurs, les 4 modes
npm run cards     # vérifie la syntaxe des effets du catalogue de cartes
```

Dernière exécution :

```
# tests 87   # pass 87   # fail 0

================ RAPPORT ================
Tournois joués            : 1000
Tournois sans fin         : 0
Exceptions                : 0
Matchs simulés            : 36212
Rounds joués (total)      : 14223 (moyenne 14.2/tournoi)
Byes attribués            : 5547
Départages chi-fou-mi     : 9084
Revanches en dernier recours (consignées) : 8046
Violations de règles      : 0
```

---

## B0 — Audit (rappel)

1. **Room et son état** : `js/rooms.js` (document `rooms/{code}`, champ `status`), UI dans
   `js/main.js` (lobby) et `js/game.js` (partie).
2. **Carte** : `js/cards.js`, `CARD_CATALOG` — ATK/DEF existaient déjà sous les noms
   `attack`/`defense` (décision **D2** : je les garde tels quels).
3. **Serveur vs client** : aucun serveur applicatif (Hosting statique + Firestore).
   Conséquences et parade dans **D1**.

## B1 — Moteur de clash

- `js/engine/clash.js` — `resolveClash()` : deux `if` **indépendants** (piège §8.3), `>=` pour
  le « ou égal », +1 point par kill.
- Tests : `tests/clash.test.mjs` (5 tests, tous les cas de §9.1 y compris la défausse).

## B2 — Modes de jeu

- `js/engine/modes.js` — `GAME_MODES`, `isValidGameMode`, `createMatchState`, `applyModeRules`,
  `checkEndOfMatch`, `playTurn`. Toute égalité de fin renvoie `winner: "TIE"` : le match ne se
  termine jamais sur un nul, l'appelant enchaîne sur le chi-fou-mi.
- `js/engine/rps.js` — `resolveRps` (égalité = on rejoue) + RNG seedé partagé.
- Option de room : `index.html` (`<select id="createRoomMode">`, 4 valeurs), validée dans
  `createRoom()` (`js/rooms.js`) — toute autre valeur est refusée.
  *Capture de l'écran de création de room fournie dans la réponse (modale « Créer une table »
  avec le champ MODE DE JEU).*
- Tests : `tests/modes.test.mjs` (9 tests, chaque case du tableau §4.2 + chi-fou-mi).

## B3 — Tournoi

- `js/engine/tournament.js` — `createTournament`, `pairNextRound` (rondes suisses : groupes de
  couronnes, aléatoire intra-groupe, non-revanche par backtracking, bye), `reportMatchResult`
  (3 défaites consécutives), `worstPlayer` (départage strict §4.3.6), `applyPeriodicElimination`
  (rounds 3, 6, 9…), `reportFinalGame` (premier à 3, éliminations suspendues).
- Tests : `tests/tournament.test.mjs` (14 tests) + **juge externe** `simulate-tournament.mjs`.
- Décisions liées : **D5** (revanche en dernier recours), **D7** (confrontation directe limitée
  à 2 ex æquo), **D8** (priorité du bye — corrigée grâce à la simulation : 1 663 violations
  avant, 0 après), **D10** (couronne du champion).

## B4 — Spectate

- `js/engine/spectate.js` — `spectatorView()` : liste blanche de champs, filtre les decks et les
  cartes en attente ; la vue spectate de `js/game.js` n'a **aucune** autre source de données et
  n'affiche aucun bouton d'action (`playMyCard` refuse tout non-participant, piège §8.7).
- Tests : `tests/spectate.test.mjs` (3 tests, dont l'inspection exhaustive des clés) et
  `tests/protocol.test.mjs` (aucune carte en attente pendant un tour incomplet).

## Couche temps réel (protocole, hors budget moteur)

- `js/game.js` (réécrit) — ordre des 3 cartes, révélation simultanée, clash idempotent,
  chi-fou-mi commit-reveal (**D6**), forfait 30 s (**D9**), spectate, orchestration du tournoi
  par l'hôte.
- `js/rooms.js` — `gameMode` validé, sous-collection `matches`, nettoyage à la fermeture.
- `css/game.css` — plateau de combat, chi-fou-mi, classement.

## Fichiers touchés (livraison complète)

```
package.json                  (nouveau)  scripts test / simulate
simulate-tournament.mjs       (nouveau)  juge externe §10
STATUS.md, DECISIONS.md       (nouveaux)
js/engine/clash.js            (nouveau)
js/engine/modes.js            (nouveau)
js/engine/rps.js              (nouveau)
js/engine/tournament.js       (nouveau)
js/engine/spectate.js         (nouveau)
tests/*.test.mjs              (nouveaux) 37 tests
js/game.js                    (réécrit)
js/rooms.js                   (modifié)  gameMode + matches
js/main.js                    (modifié)  sélecteur de mode
index.html                    (modifié)  <select> mode de jeu
css/game.css                  (complété) plateau, chi-fou-mi, classement
firestore.rules               (nouveau)  règles à copier dans la console Firebase
```

## B5 — Effets de cartes, récompenses, refonte du plateau

- **Bug chi-fou-mi corrigé** (voir `DECISIONS.md`, D13) : les égalités relançaient un tour
  vide et bloquaient le match. Test de non-régression dans `tests/protocol.test.mjs`.
- **Mini-langage d'effets** : `js/engine/effect-parser.js` (grammaire, validation) et
  `js/engine/effects.js` (exécution). Déclencheurs `on_play` / `on_death` / `on_seen` ;
  effets `scry` `mill_own` `mill_opp` `organize_own` `organize_opp` `search` `go_bottom`
  `gain` `look_top` `look_bot` ; conditions `if … : …` / `else` / `and` / `or` sur
  `card.*`, `self.*`, `opp.*`, `my.deck_size`… Tests : `tests/effects.test.mjs` (26).
- **Résolution de tour avec effets** : `js/engine/turn.js` (pur, 10 tests).
  Les decks mutent désormais (D14) et les choix interactifs utilisent le rejeu
  déterministe (D15).
- **Catalogue** : 9 cartes ont un effet d'exemple, une par mécanique. `npm run cards`
  valide la syntaxe et affiche le résumé.
- **Récompenses** : `js/engine/rewards.js` (barème 6/4/3/2/2 pièces, XP ×10/×5/×4/×3/×1
  des niveaux cumulés des adversaires) + versement transactionnel dans `js/auth.js`
  (`grantRewards`, anti double-versement). Tests : `tests/rewards.test.mjs` (12).
- **Plateau refondu** : cartes jouées en grand au centre (face cachée dès la pose),
  animation de mort (impact, balafres, tête de mort, secousse, éclair), défausse en pile
  face visible et cliquable, modale de choix d'effet.

## Prochaine étape

- **Déployer les règles Firestore** (`firestore.rules`) : indispensable pour que la
  sous-collection `matches` soit lisible et inscriptible.
- Test à deux navigateurs réels (ton étape).
