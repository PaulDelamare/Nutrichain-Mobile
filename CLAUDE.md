@AGENTS.md

# NutriChain Mobile — guide projet

App **terrain** des opérateurs NutriChain (Expo SDK 56 / React Native 0.85 / expo-router). Un opérateur scanne et saisit des **réceptions de lots** — souvent en chambre froide ou zone sans réseau. L'app est **offline-first sur la RÉCEPTION uniquement** (le geste du quai) : elle la met en file locale SQLite, puis la synchronise vers l'API NutriChain (`Nutrichain-Api`, port 3000). Transformation et expédition sont des écritures **en ligne** — périmètre assumé, cf. README « Le périmètre du hors-ligne ». Elle la **consulte** aussi, en lecture et en ligne — fiche de lot, lots en quarantaine, alertes froid — avec un état « non vérifiable » explicite quand la question n'a pas pu être posée. Elle remonte aussi la **généalogie** d'un lot et sait **déclencher un rappel** — réservé aux rôles qualité (`QUALITY_ROLES`), l'`operator` en est exclu par séparation HACCP (cf. README « Décision : qui peut déclencher un rappel ? »). Les tableaux de bord restent au web.

> ⚠️ **Expo a changé** (voir `AGENTS.md`, importé ci-dessus) : lire les docs versionnées <https://docs.expo.dev/versions/v56.0.0/> avant d'écrire du code Expo. Ne pas présumer d'API antérieures.

## Commandes

```bash
# Lancer (2 modes, aucun imposé — cf. README « Deux façons de lancer »)
npm start                 # serveur de dev (Expo Go / dev client)
npm run android|ios|web   # Expo Go / émulateur / navigateur (léger)
npm run android:native    # = expo run:android : build natif + dev client (appareil physique)
npm run ios:native        # = expo run:ios

# Qualité — À LANCER APRÈS TOUTE MODIF (reproduit la CI .github/workflows/ci.yml)
npm run lint              # eslint src/  (warnings non bloquants)
npm run typecheck         # tsc --noEmit
npm test                  # jest-expo   (CI : npm test -- --ci --coverage)
```

**Node 22 requis** (`.nvmrc`). Sous Node < 22 la suite `queue.test.ts` (SQL sur `node:sqlite`) est **silencieusement skippée** → « tout vert » local ≠ vert CI. La CI a 4 jobs : `lint`, `typecheck`, `unit-tests`, `build` (`expo export web` — ne jamais mettre de fichier de test dans `src/app/`, il deviendrait une route).

E2E réel contre l'API (à lancer côté `Nutrichain-Api`) : `npm run e2e:mobile`. Compte de test seedé : `first.admin@nutrichain.local` / `NutriChain!2026`.

## Où vit quoi

- `src/app/**` — écrans expo-router (routage par fichiers). JSX/styles/UI, **logique minimale**. `_layout.tsx` monte `startAutoSync()` ; `(tabs)/_layout.tsx` garde la session (Redirect `/login`) ; `login.tsx`, `reception.tsx` hors tabs.
- `src/lib/**` — **logique métier PURE et testée** (le cœur). Surtout `src/lib/sync/`. Aussi `api.ts`, `session.ts`(+`.web.ts`), `errors.ts`, `db.ts`, `catalog.ts`, `equipment.ts`, `alerts.ts`, `me.ts`, `theme.ts`.
- `src/hooks/**` — adaptateurs React sur la lib (`use-auth-status`, `use-current-user`, `use-online-status`).
- Imports **toujours via l'alias `@/`** (→ `./src/`), jamais de chemins relatifs profonds.

## Le modèle offline-first (cœur du produit — bugs très coûteux ici)

Flux : `reception.tsx` → `buildReceipt()` (validation locale, `null` si invalide) → `enqueueReceipt()` insère en SQLite `PENDING` avec un **`clientOpId` = UUID v4** → sync fire-and-forget. Au retour du réseau, `startAutoSync` envoie par lots (`MAX_BATCH_SIZE = 100`). L'API répond **207 Multi-Status**, un verdict par item.

**Table de vérité — `src/lib/sync/outcome.ts` (`resolveOutcome`, pure) :**

| Verdict serveur | État local | Effet |
|---|---|---|
| `ok` | `SYNCED` | stocke `serverId`, `nextAttemptAt=0` |
| `conflict` | `CONFLICT` | bloqué, **jamais rejoué** (payload divergent = client corrompu) |
| `error` + `field === 'internal'` | `PENDING` (retry) | transitoire → `attempts+1`, backoff |
| `error` + `field !== 'internal'` | `REJECTED` | erreur métier permanente, **ne pas retenter** |
| verdict **absent** (207 tronqué) | `PENDING` (retry) | perdre un scan est pire que le rejouer |
| statut inconnu | **`throw`** | `never` exhaustif — refuse de classer par défaut |

- **Backoff** (`src/lib/sync/backoff.ts`) : `[30s, 1min, 5min, 15min, 30min]`, plafonne à 30 min, **jamais d'abandon**.
- **Dichotomie sur 400** (`sync.ts`, `syncBatch` récursif) : la validation serveur est fail-fast (un item malformé rejette tout le lot en 400). Lot de 1 → `REJECTED` ; lot > 1 → split en deux → seuls les valides passent.
- **Idempotence** : `clientOpId` est **la clé d'idempotence serveur** (TTL 7 jours). Il est **immuable** : réémis tel quel à chaque retry — le régénérer créerait un doublon. Seule exception : `requeueOperation()` (opération `CONFLICT`/`REJECTED`, dont le serveur n'a rien enregistré) régénère un UUID, dans une **transaction atomique** INSERT+DELETE.
- **Rétention** : `flagStalePending()` passe les `PENDING` de plus de 7 j en `CONFLICT` **avant** toute sync (clé d'idempotence expirée → rejouer pourrait dupliquer).
- Statuts = source unique `BLOCKED_STATUSES = ['CONFLICT','REJECTED']` (dérive même le SQL). Verrou global `running` dans `sync.ts` (anti double-envoi).
- SQLite (`src/lib/db.ts`) : `SCHEMA` **exporté** exprès pour que les tests exécutent le vrai SQL ; `getDatabase()` mémorise la *promesse* (pas la connexion) ; `journal_mode = WAL`.

## Contrat API (voir `Nutrichain-Api`)

Auth **Better-Auth** : `POST /api/auth/sign-in/email` (avec `x-api-key`) renvoie un `token` → réémis en `Authorization: Bearer` sur toutes les routes métier. La session résout **une organisation active** ; sans elle, les routes métier renvoient 400.

🚨 **Règle impérative — `x-api-key` UNIQUEMENT sur `/api/auth/*`** (`src/lib/api.ts`). Sur une route métier, envoyer **seulement le Bearer**. Sinon le middleware serveur `mixedAuth` bascule en machine-à-machine : il **ignore la session**, exige un `actorUserId` absent (**400 sur tout le lot**), et **borne l'org à celle de la clé** (fuite cross-tenant). Testé explicitement.

- `EXPO_PUBLIC_API_KEY` = `API_KEY` de l'API. **Non-secret** (embarqué en clair dans le binaire) : simple portail, aucun droit sans session. `EXPO_PUBLIC_API_URL` selon la cible (cf. `.env.example`).
- Rôles serveur (mono-valué/membre) : `owner`, `admin`, `quality`, `operator`, `viewer`. Écritures terrain (dont sync) = `owner|admin|operator`.
- **Endpoints consommés** : liste complète dans la table « Endpoints consommés » du README (lecture / écriture). Le rôle vient de **`GET /api/me`**, pas de `/organization/members`. **`POST /api/sync/scans`** est le seul point d'écriture **passant par la file offline** ; transformation, expédition, levée de quarantaine et résolution d'alerte écrivent **en ligne**.
- **`/api/sync/scans`** : `{ items: [{ clientOpId, type:'receipt', payload:{ id_fournisseur, shipment_id, id_produit, quantite_actuelle, unite_code, statut_controle, id_materiel? } }] }`. `type:'receipt'` est le **seul** type synchronisable en v1 (transformation/expédition = P3). `received_by` est **forcé serveur-side** (utilisateur de session) — ne pas tenter de l'usurper.

## Conventions

- **TypeScript strict**, `@typescript-eslint/no-explicit-any: 'error'` (`any` interdit hors tests). Résolution `@/` (`tsconfig.json`).
- **Tous les messages utilisateur en français** ; `getErrorMessage()` (`errors.ts`) + `toastError()` (`toast.ts`) sont les points uniques. Commentaires de code en français, denses, expliquent le **pourquoi métier** — à préserver.
- Couleurs de marque dans `src/lib/theme.ts` (`BRAND`, teal `#0D9488`).
- Variantes plateforme par extension `.web.ts` (ex. `session.ts` SecureStore vs `session.web.ts` localStorage).
- **Edge-to-edge** (défaut SDK 56) : la barre système recouvre l'UI si on ignore les insets. Tout header/tabbar doit consommer `useSafeAreaInsets()` et ajouter `insets.bottom`/`insets.top` (cf. `(tabs)/_layout.tsx`).

## Conventions de test (jest-expo)

La couverture est la plus dense dans `src/lib/sync/` et `src/lib/api.test.ts` ; chaque test documente le **mutant** qu'il tue. Patterns de mock récurrents :

- `jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top:0, bottom:0, left:0, right:0 }) }))` — **systématique** dès qu'un composant lit les insets.
- `jest.mock('expo-router', …)` (`router`, `useLocalSearchParams`, `useFocusEffect`).
- `jest.mock('expo-network')` + capture du listener via `addNetworkStateListener.mock.calls` pour simuler offline→online.
- Axios : on remplace l'**adaptateur** (`apiClient.defaults.adapter`), pas le réseau — les intercepteurs restent réels. Réponse sync forgée via `{ status:207, data:{ results } }`.
- **SQLite** (`queue.test.ts`, `@jest-environment node`) : vrai moteur `node:sqlite` (Node 22), `getDatabase` porté sur `DatabaseSync`, base `:memory:` + `exec(SCHEMA)` par test. `describe.skip` si `node:sqlite` absent.

## Invariants à ne PAS casser

1. `x-api-key` seulement sur `/api/auth/*` (voir plus haut).
2. `clientOpId` immuable sur retry ; `requeueOperation` atomique et réservé aux opérations bloquées.
3. `401` + `field==='api_key'` ≠ session expirée → **ne pas** purger le token (`api.ts`).
4. Unités depuis les produits (`unite_reference`), jamais codées en dur (FK serveur, `kg` ≠ `KG`).
5. `buildReceipt` renvoie `null` si invalide — ne jamais enfiler une saisie invalide (fail-fast serveur rejette le lot entier).
6. Filtres SQL de statut (`queue.ts`) = garde-fous : `deleteOperation`/`requeueOperation` throwent hors `BLOCKED_STATUSES`.
7. Verrous anti-double-action (`running` sync, rafale caméra, double-appui « Renvoyer »).

## Contexte NutriChain (docs détaillées dans `Nutrichain-Api/docs/`)

Traçabilité agroalimentaire « de la ferme au rayon », standards **GS1/EPCIS** (GTIN produit, SSCC palette, lot `AAMMJJ-XXXXXX`), **chaîne du froid IoT** (excursion température → alerte + quarantaine auto des lots), **rappel produit** (blocage en cascade de la descendance < 15 min), **multi-tenancy strict** (tout porte `organization_id` ; un rôle dans une org n'accède pas à une autre), **audit WORM** (journal chaîné par hash). Le mobile ne fait pas l'ingest IoT (M2M capteurs) — il **produit les réceptions**, consomme catalogue + alertes, **consulte les lots** (fiche, généalogie, quarantaine, résolution d'un code scanné) et **déclenche les rappels** pour les rôles qualité uniquement.

## Limites connues (README)

Seule la **réception** passe par la file de synchronisation offline (`type: 'receipt'`) : transformation, expédition, levée de quarantaine et résolution d'alerte sont des écritures **en ligne**, refusées hors réseau. Pas de push, ni reset mot de passe. La 2FA (TOTP) est prise en charge (`/verify-2fa`) : la connexion redirige vers cet écran quand l'API renvoie `twoFactorRedirect`.
