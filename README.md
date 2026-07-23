# NutriChain Mobile

Application terrain des opérateurs NutriChain (Expo / React Native).

Un opérateur scanne et saisit une réception **dans une chambre froide, un entrepôt métallique,
une zone sans réseau**. L'application est donc **hors ligne d'abord là où ça compte** : la
**réception** — le geste du quai — ne dépend jamais du réseau au moment de la saisie. La
transformation et l'expédition, elles, se font au bureau, connecté : c'est un choix de périmètre,
pas un manque (voir [Le périmètre du hors-ligne](#le-périmètre-du-hors-ligne--ce-qui-est-couvert-et-ce-qui-ne-lest-pas)).

**Le mobile PRODUIT la traçabilité** (scans, réceptions, emplacements) et en **consulte** ce dont
l'opérateur a besoin devant le camion : fiche d'un lot, **généalogie** du lot, lots en quarantaine,
alertes froid. Il sait aussi **déclencher un rappel produit** — mais seulement pour les rôles
qualité (voir la décision ci-dessous). Les tableaux de bord restent au front web. Ce que le mobile
ne capture pas n'existera jamais dans le suivi.

## Démarrage

```bash
npm install
cp .env.example .env   # choisir la ligne EXPO_PUBLIC_API_URL de son mode + renseigner la clé
```

L'API doit tourner en parallèle (dans `nutrichain-api` : `docker compose up` ou `npm run dev`).

### Deux façons de lancer (au choix — aucune n'est imposée)

**1. Expo Go / émulateur** — léger, sans build natif. Nécessite un Expo Go compatible avec le SDK du projet.

```bash
npm start           # serveur de dev, puis choisir la plateforme (a / i / w)
npm run android     # ouvre sur émulateur/appareil Android (Expo Go)
npm run ios         # ouvre sur simulateur iOS
npm run web         # ouvre dans le navigateur
```

**2. Build natif (dev client)** — compile l'app native et l'installe. Pour un **appareil physique**, ou quand Expo Go ne supporte pas le SDK du projet. Nécessite l'Android SDK (Android) ou Xcode (iOS).

```bash
npm run android:native   # = expo run:android : build + installe le dev client sur Android
npm run ios:native       # = expo run:ios     : idem iOS (signature Apple requise pour un iPhone physique)
```

> Appareil physique en USB : après le build, l'app joint l'API via `adb reverse tcp:3000 tcp:3000`
> (voir `.env.example`, ligne « Téléphone physique via USB »). Les dossiers natifs `android/` et `ios/`
> sont régénérés à la volée et gitignorés — chacun build en local.

**3. APK installable (démo terrain)** — un vrai `.apk` à _sideloader_ sur un téléphone Android. C'est
le seul moyen de prouver ce qu'un navigateur ne peut pas : la caméra d'un vrai appareil, et le
**vrai** mode hors-ligne (sur le web, `navigator.onLine` ment — il vaut `true` sur un Wi-Fi sans
Internet). Deux voies, au choix — elles déplacent la contrainte sans la supprimer.

**3a. Cloud — EAS Build** — aucun toolchain Android en local, mais **compte Expo** requis (gratuit) :

```bash
npx eas-cli login                                     # compte Expo (une seule fois)
npx eas-cli build --platform android --profile preview
```

Au premier lancement, EAS lie le projet (`eas init`) et écrit un `projectId` dans `app.json` ; à la
fin, il fournit une URL de téléchargement de l'`.apk`. Le profil `preview` (`eas.json`) force
`buildType: apk` + `distribution: internal` : installable directement, sans passer par le Store.

**3b. Local — Gradle** — aucun compte, mais **Android SDK + JDK 17** requis (le même toolchain que
l'option 2 ci-dessus) :

```bash
npm run apk:local        # = expo prebuild --clean, puis gradlew assembleRelease
# → android/app/build/outputs/apk/release/app-release.apk
```

Le build est **`release`** exprès (jamais `debug`) : le JS y est empaqueté, donc l'APK tourne **sans
serveur Metro** — indispensable pour prouver le hors-ligne. Il est signé avec le keystore **debug**
par défaut du template : installable pour un POC, **jamais** pour le Store. Le dossier natif
`android/` est régénéré à chaque fois, puis gitignoré.

> ⚠️ Dans les deux cas, sur un vrai téléphone `EXPO_PUBLIC_API_URL` doit pointer vers une API
> **joignable depuis le réseau du téléphone** (IP LAN de la machine, ou API déployée) — jamais
> `localhost`.

**Node 22 requis** (`.nvmrc`) : les tests du SQL de la file s'appuient sur `node:sqlite`, absent
en Node 20 — ils y sont silencieusement **sautés**. La CI est en Node 22.

### Configuration (`.env`)

| Variable              | Rôle                                                                            |
| --------------------- | ------------------------------------------------------------------------------- |
| `EXPO_PUBLIC_API_URL` | URL de l'API. Émulateur Android : `http://10.0.2.2:3000`. iOS/web : `localhost`. |
| `EXPO_PUBLIC_API_KEY` | Doit valoir exactement `API_KEY` du `.env` de l'API : `/api/auth/*` l'exige.     |

`EXPO_PUBLIC_API_KEY` est embarquée en clair dans le binaire (contrainte Expo) : c'est un
portail d'accès à l'API, **jamais un secret** — aucun droit n'est accordé sans session
utilisateur. N'y placez aucune autre valeur sensible.

⚠️ **La clé n'est envoyée que sur `/api/auth/*`.** L'envoyer sur une route métier ferait basculer
l'API en mode machine-à-machine : elle ignorerait la session et servirait les données de
l'organisation liée à la clé, pas celle de l'utilisateur connecté.

## Le modèle hors ligne

C'est le cœur du produit. Une réception suit toujours ce chemin :

```
saisie → SQLite (PENDING) → [réseau] → POST /api/sync/scans → verdict serveur → SYNCED
                                                                              ↘ CONFLICT / REJECTED
```

1. **La saisie n'appelle jamais l'API.** La réception est écrite en SQLite, avec un `clientOpId`
   (UUID v4) généré une fois pour toutes.
2. Ce `clientOpId` est la **clé d'idempotence** du serveur : il est réémis **tel quel** à chaque
   tentative. C'est ce qui garantit qu'un renvoi après coupure réseau ne crée pas de réception
   en double.
3. La file part **automatiquement au retour du réseau** (`expo-network`), par lots de 100 max,
   en boucle jusqu'à épuisement.
4. L'API répond **207 Multi-Status** : un verdict par opération.

| Verdict serveur           | Traitement local                                                        |
| ------------------------- | ----------------------------------------------------------------------- |
| `ok`                      | `SYNCED`, identifiant serveur conservé                                  |
| `conflict`                | `CONFLICT`, **jamais rejoué** (payload divergent = client corrompu)      |
| `error`, champ `internal` | transitoire → réessai, backoff 30 s → 1 min → 5 min → 15 min → 30 min    |
| `error`, autre champ      | `REJECTED` (un fournisseur inexistant ne le deviendra pas)               |
| verdict absent            | réessai — perdre un scan est pire que le rejouer, l'idempotence protège  |

**Cas particuliers traités :**

- **Lot refusé en bloc (400).** La validation serveur est *fail-fast* : un seul item malformé
  fait rejeter les 100. Le lot est alors **scindé par dichotomie** jusqu'à isoler le fautif —
  les scans valides passent.
- **Opération en attente depuis plus de 7 jours.** Sa clé d'idempotence a **expiré côté
  serveur** : la rejouer pourrait créer un doublon si la réception avait en fait été commitée et
  que seule la réponse s'était perdue. Elle est donc **signalée**, pas rejouée.
- **Catalogue en cache.** Fournisseurs, produits et équipements sont mis en cache localement :
  sans eux, une réception serait impossible à saisir hors réseau — c'est-à-dire là où l'app doit
  servir.

### Remédiation

Une opération `CONFLICT` ou `REJECTED` ne repartira jamais seule. L'écran Sync affiche son motif
et permet de la **renvoyer** ou de la **supprimer**.

Le renvoi crée une opération **neuve** (nouvel identifiant). C'est la seule exception à la règle
« un scan = un identifiant immuable », et elle est sûre : côté serveur, un `conflict` comme un
`error` tournent dans une transaction qui *rollback* — rien n'a été enregistré sous cette clé.
La rejouer telle quelle reconflicterait indéfiniment.

### Le périmètre du hors-ligne : ce qui est couvert, et ce qui ne l'est pas

**Le hors-ligne couvre la réception. Pas la transformation, pas l'expédition.** C'est délibéré, et
ça se dit mieux que ça ne se cache.

| Écriture | Hors ligne ? | Pourquoi |
| -------- | ------------ | -------- |
| **Réception** | ✅ file SQLite | Le geste du **quai** : chambre froide, entrepôt métallique, zone sans réseau. C'est là que le hors-ligne est vital — et c'est le seul flux que le endpoint de sync accepte. |
| Transformation | ❌ en ligne | Limite **technique**, pas métier : voir « Pourquoi ne pas étendre la file ? » ci-dessous. |
| Expédition | ❌ en ligne | Idem — et sans idempotence serveur, un rejeu y serait dangereux. |
| Levée de quarantaine, résolution d'alerte, rappel | ❌ en ligne | Décisions qualité : elles supposent de toute façon des données fraîches (statut du lot, alerte en cours). |

Ce n'est pas caché à l'opérateur : hors réseau, ces écrans affichent un bandeau explicite
(« Hors réseau : une expédition ne peut pas être enregistrée pour plus tard ») et **désactivent**
le bouton d'envoi. Aucune saisie n'est acceptée pour être perdue plus tard.

⚠️ **Ce projet ne revendique donc PAS « tout fonctionne hors ligne »** — ce serait faux. Il
revendique que *le geste qui se fait sans réseau se fait sans réseau*.

**Pourquoi ne pas étendre la file ?** La file **rejoue** les opérations : sans clé d'idempotence
côté serveur, un rejeu après une réponse perdue créerait un **second prélèvement** sur les lots
parents — du stock détruit dans la traçabilité. L'état des deux candidats diffère :

- **Transformation** — l'API accepte désormais un `client_op_id` (idempotence livrée côté serveur).
  Le verrou n'est plus là : il est que `/api/sync/scans` ne connaît que `type: 'receipt'`, et que le
  moteur de sync mobile est bâti sur **son** protocole (lots de 100, 207 Multi-Status, dichotomie
  sur 400). Faire porter la transformation par la file demande soit d'étendre ce endpoint, soit un
  chemin unitaire parallèle dans `sync.ts` — le fichier le plus critique du mobile.
- **Expédition** — aucune idempotence côté serveur à ce jour. Le rejeu y reste franchement dangereux.

Dans les deux cas, le gain est nul en démonstration (c'est le même mécanisme qu'une réception) et le
risque porte sur le stock. **Une limite honnête vaut mieux qu'une extension bâclée.**

## L'emplacement du lot — le « où »

À la réception, l'opérateur **scanne le lot, puis scanne le frigo**. Les deux scans sont physiques
et sur place : il ne peut pas déclarer un emplacement où il n'est pas (ce qu'un menu déroulant,
remplissable depuis le bureau, permettrait).

**Ce n'est pas un confort.** La mise en quarantaine automatique sur excursion de température ne
bloque **que** les lots dont `id_materiel_actuel` pointe sur l'équipement en cause. **Un lot reçu
sans emplacement ne sera jamais isolé si son frigo dérive.**

- Le code scanné est résolu **localement** contre la liste des équipements en cache — donc **sans
  réseau**, dans la chambre froide.
- Un code étranger ne résout rien (un code produit scanné par mégarde ne doit jamais passer pour
  un emplacement).
- **Une cuve est refusée** : elle transforme, elle ne stocke pas.
- L'étiquette scannable est générée côté API (`POST /api/organization/equipment` la crée,
  `GET /api/organization/equipment/:id/label` produit le QR à imprimer et coller sur le matériel).

## Endpoints consommés

**Lecture**

| Endpoint                                  | Usage                                          |
| ----------------------------------------- | ---------------------------------------------- |
| `POST /api/auth/sign-in/email`            | Connexion (+ `x-api-key`)                      |
| `POST /api/auth/sign-out`                 | Déconnexion (+ `x-api-key`)                    |
| `GET /api/health`                         | Sonde de connectivité (`use-online-status`)    |
| `GET /api/me`                             | Identité, organisation active **et rôle**      |
| `GET /api/organization/suppliers`         | Catalogue fournisseurs (cache, TTL 7 j)        |
| `GET /api/organization/customers`         | Catalogue clients (cache, TTL 7 j)             |
| `GET /api/traceability/products`          | Catalogue produits (cache, TTL 7 j)            |
| `GET /api/organization/equipment`         | Matériels et leurs étiquettes (cache, TTL 7 j) |
| `GET /api/organization/alerts`            | Alertes chaîne du froid (filtrées côté client) |
| `GET /api/organization/quarantine-batches`| Lots en quarantaine                            |
| `GET /api/traceability/batches`           | Catalogue des lots (cache, sans TTL)           |
| `GET /api/logistics/batches/:id`          | Fiche d'un lot                                 |
| `GET /api/logistics/batches/resolve`      | Résolution d'un lot depuis le code scanné      |
| `GET /api/alerts/:id/batches`             | Lots touchés par une alerte                    |
| `GET /api/traceability/batches/:id/genealogy` | Chaîne d'un lot (amont, aval, origines) |

**Écriture** — `POST /api/sync/scans` est le seul point d'écriture **passant par la file offline** ;
les autres exigent le réseau au moment de l'action.

| Endpoint                                  | Usage                                          |
| ----------------------------------------- | ---------------------------------------------- |
| `POST /api/sync/scans`                    | Réceptions, **via la file offline**            |
| `POST /api/traceability/transformations`  | Transformation (en ligne)                      |
| `POST /api/logistics/shipments`           | Expédition (en ligne)                          |
| `POST /api/logistics/batches/:id/release` | Levée de quarantaine (en ligne)                |
| `PATCH /api/alerts/:id/resolve`           | Résolution d'une alerte (en ligne)             |
| `POST /api/traceability/batches/:id/recall` | Rappel produit (en ligne, rôles qualité) |

## Architecture

```
src/
  app/            écrans et navigation (expo-router, routage par fichiers)
    (tabs)/       Accueil · Scan · Sync · Profil (groupe protégé par une garde de session)
    login.tsx     connexion
    reception.tsx formulaire de réception (alimente la file locale)
  components/     composants partagés (scanner d'emplacement, sélecteur)
  lib/
    api.ts        client HTTP (intercepteurs : Bearer, purge sur 401, clé API sur /auth/*)
    session.ts    jeton dans le coffre chiffré du système (variante web : localStorage)
    errors.ts     normalisation des deux formats d'erreur de l'API, messages opérateur
    toast.ts      annonce d'erreur unifiée
    theme.ts      couleurs de marque (uniquement — les gris restent locaux aux écrans)
    db.ts         connexion SQLite et schéma
    cache.ts      cache clé/valeur
    catalog.ts    fournisseurs et produits — réseau d'abord, cache en secours
    equipment.ts  matériels, et résolution locale d'un code scanné
    alerts.ts     alertes chaîne du froid
    me.ts         identité et rôle
    sync/
      queue.ts    la file : enfilement, sélection, verdicts, remédiation, rétention
      sync.ts     l'orchestration : lots, boucle, dichotomie, verrou
      outcome.ts  la décision : quel verdict serveur produit quel état local (pur)
      receipt.ts  la validation d'une réception (pure)
      backoff.ts  les délais de réessai (purs)
      auto-sync.ts déclencheur au retour du réseau + rétention au démarrage
  hooks/          session, utilisateur courant, état réseau
  __tests__/      tests des écrans — VOIR L'AVERTISSEMENT CI-DESSOUS
```

La logique de décision (`outcome.ts`, `backoff.ts`, `receipt.ts`) est **pure** : c'est là que se
joue la perte ou la duplication d'un scan, et c'est donc là que les tests sont les plus denses.

### ⚠️ Ne jamais mettre de fichier de test dans `src/app/`

**expo-router transforme en route tout fichier placé dans `src/app/`** — y compris un `.test.tsx`
(sa regex d'exclusion ne couvre que `+api`, `+html` et `+native-intent`). Un `_layout.test.tsx` y
entre en collision avec le vrai layout, et **l'application ne démarre plus** — pendant que les
tests, le typecheck et le lint restent tous au vert. Effet de bord : `@testing-library` et les
globals `jest` partent dans le **bundle de production**.

**Les tests d'écrans vivent dans `src/__tests__/`.** Le job de build de la CI garde cette porte.

## Qualité

```bash
npm test          # tests unitaires (jest-expo)
npm run typecheck
npm run lint
```

Ces trois commandes, **plus un build**, tournent en CI sur chaque PR
(`.github/workflows/ci.yml`, 4 jobs, Node 22).

**La couverture n'est pas décorative** : sans `collectCoverageFrom`, Jest n'instrumente que les
fichiers qu'un test importe — les fichiers sans test sont alors *absents* du rapport au lieu d'y
compter 0 %, et le pourcentage flatte. La configuration instrumente donc **tout le dossier `src/`**, et un
`coverageThreshold` global à **70 %** (livrable 3) fait **échouer le job** en dessous : le rapport
n'est plus produit puis oublié. Le seuil ne s'applique qu'avec `--coverage`, jamais au `npm test`
local. À ce jour : ~88 % de statements sur les 51 fichiers source.

**Le build n'est pas décoratif** : les tests unitaires prouvent que le code fait ce qu'on croit,
ils ne prouvent pas que l'application *démarre*. C'est le build qui a trouvé le bug ci-dessus.

### Vérifier contre l'API réelle

```bash
# depuis nutrichain-api
npm run e2e:mobile
```

Rejoue le parcours mobile complet (connexion, catalogue, scan, synchronisation) contre l'API et
**vérifie le résultat en base Postgres**. **À rejouer après tout changement du contrat de sync.**

### Voir l'application tourner

```bash
npm run web
```

L'application se lance dans un navigateur (`react-native-web`) et peut être pilotée par Playwright
pour des captures d'écran. `metro.config.js` est nécessaire : `expo-sqlite` s'appuie sur
WebAssembly côté web, et Metro ne résout pas `.wasm` par défaut.

⚠️ La **connexion échoue en web** (403) : l'API n'a pas `localhost:8081` dans ses `trustedOrigins`.
Sans effet en natif — une application native n'envoie pas d'en-tête `Origin`.

## Branches

| Branche       | Rôle                                    |
| ------------- | --------------------------------------- |
| `develop`     | **Préprod — base de toutes les PR**     |
| `main`        | Production                              |
| `feat/…` `fix/…` `chore/…` | Travail, éphémères         |

Les deux branches durables sont protégées : PR obligatoire, les 4 vérifications de CI doivent
passer, force push et suppression bloqués.

## Décision : qui peut déclencher un rappel ? (issue #89)

Le rappel produit est gardé côté API par `QUALITY_ROLES` = `owner | admin | quality`
(`roles.constants.ts`). **L'`operator` en est exclu** — or c'est la persona principale de cette
application. Ce n'est pas un oubli d'implémentation : c'est une **séparation des tâches HACCP**.
Celui qui réceptionne un lot ne signe pas le rappel qui le bloque.

**Décision retenue : le rappel existe dans le mobile, mais n'apparaît que pour les rôles qualité.**

- Un `operator` ne voit **pas** le bouton : il lit le motif (« un rappel engage la sécurité
  sanitaire : il est réservé au contrôle qualité »). Il n'obtient jamais un 403 après coup.
- Un rôle non vérifié (hors ligne, `/api/me` injoignable) affiche un message **différent** —
  « rôle non vérifié » n'est pas « vous n'avez pas le droit ».
- Le rappel exige le réseau : il ne passe **pas** par la file offline, et le bouton disparaît hors
  ligne plutôt que de promettre une mise en attente qui n'existe pas.

L'alternative — laisser le rappel au seul front web — a été écartée : le produit promet un
« blocage en cascade de la descendance en moins de 15 minutes ». Obliger un responsable qualité à
regagner un bureau pour déclencher contredit cette promesse. La **généalogie**, elle, est ouverte à
tous les rôles (`ALL_ROLES` côté API) : remonter la chaîne d'un lot suspect est un besoin terrain.

## Limites connues

- Seule la **réception** passe par la file de synchronisation offline (`type: 'receipt'`).
  Transformation, expédition, levée de quarantaine et résolution d'alerte sont des écritures
  **en ligne**, refusées hors réseau — périmètre assumé, et bloqué par une dépendance API
  (idempotence). Voir « Le périmètre du hors-ligne ».
- Le **rappel produit** n'est pas accessible à l'`operator` — décision assumée, voir ci-dessous.
- Pas de notifications push, pas de 2FA, pas de réinitialisation de mot de passe.
