# NutriChain Mobile

Application terrain des opérateurs NutriChain (Expo / React Native).

Un opérateur scanne et saisit une réception **dans une chambre froide, un entrepôt métallique,
une zone sans réseau**. L'application est donc conçue pour fonctionner **hors ligne d'abord** :
rien de ce qu'elle enregistre ne dépend du réseau au moment de la saisie.

## Démarrage

```bash
npm install
cp .env.example .env   # puis renseigner les deux variables
npm start
```

L'API doit tourner en parallèle (`npm run dev` dans `nutrichain-api`).

### Configuration (`.env`)

| Variable              | Rôle                                                                            |
| --------------------- | ------------------------------------------------------------------------------- |
| `EXPO_PUBLIC_API_URL` | URL de l'API. Émulateur Android : `http://10.0.2.2:3000`. iOS/web : `localhost`. |
| `EXPO_PUBLIC_API_KEY` | Doit valoir exactement `API_KEY` du `.env` de l'API : `/api/auth/*` l'exige.     |

`EXPO_PUBLIC_API_KEY` est embarquée en clair dans le binaire (contrainte Expo) : c'est un
portail d'accès à l'API, **jamais un secret** — aucun droit n'est accordé sans session
utilisateur. N'y placez aucune autre valeur sensible.

⚠️ **La clé n'est envoyée que sur `/api/auth/*`.** L'envoyer sur une route métier ferait
basculer l'API en mode machine-à-machine : elle ignorerait la session et servirait les données
de l'organisation liée à la clé, pas celle de l'utilisateur connecté.

## Le modèle hors ligne

C'est le cœur du produit. Une réception suit toujours ce chemin :

```
saisie → SQLite (PENDING) → [réseau] → POST /api/sync/scans → verdict serveur → SYNCED
                                                                              ↘ CONFLICT / REJECTED
```

1. **La saisie n'appelle jamais l'API.** La réception est écrite en SQLite, avec un
   `clientOpId` (UUID v4) généré une fois pour toutes.
2. Ce `clientOpId` est la **clé d'idempotence** du serveur : il est réémis **tel quel** à
   chaque tentative. C'est ce qui garantit qu'un renvoi après coupure réseau ne crée pas de
   réception en double.
3. La file part **automatiquement au retour du réseau** (`expo-network`), par lots de 100 max,
   en boucle jusqu'à épuisement.
4. L'API répond **207 Multi-Status** : un verdict par opération.

| Verdict serveur           | Traitement local                                                     |
| ------------------------- | -------------------------------------------------------------------- |
| `ok`                      | `SYNCED`, identifiant serveur conservé                               |
| `conflict`                | `CONFLICT`, **jamais rejoué** (payload divergent = client corrompu)   |
| `error`, champ `internal` | transitoire → réessai, backoff 30 s → 1 min → 5 min → 15 min → 30 min |
| `error`, autre champ      | `REJECTED` (un fournisseur inexistant ne le deviendra pas)            |
| verdict absent            | réessai — perdre un scan est pire que le rejouer, l'idempotence protège |

**Cas particuliers traités :**

- **Lot refusé en bloc (400).** La validation serveur est *fail-fast* : un seul item malformé
  fait rejeter les 100. Le lot est alors **scindé par dichotomie** jusqu'à isoler le fautif —
  les scans valides passent.
- **Opération en attente depuis plus de 7 jours.** Sa clé d'idempotence a **expiré côté
  serveur** : la rejouer pourrait créer un doublon si la réception avait en fait été commitée
  et que seule la réponse s'était perdue. Elle est donc **signalée**, pas rejouée.
- **Catalogue en cache.** Fournisseurs et produits sont mis en cache localement : sans eux, une
  réception serait impossible à saisir hors réseau — c'est-à-dire là où l'app doit servir.

### Remédiation

Une opération `CONFLICT` ou `REJECTED` ne repartira jamais seule. L'écran Sync affiche son
motif et permet de la **renvoyer** ou de la **supprimer**.

Le renvoi crée une opération **neuve** (nouvel identifiant). C'est la seule exception à la règle
« un scan = un identifiant immuable », et elle est sûre : côté serveur, un `conflict` comme un
`error` tournent dans une transaction qui *rollback* — rien n'a été enregistré sous cette clé.
La rejouer telle quelle reconflicterait indéfiniment.

## Endpoints consommés

| Endpoint                        | Usage                                             |
| ------------------------------- | ------------------------------------------------- |
| `POST /api/auth/sign-in/email`  | Connexion (+ `x-api-key`)                         |
| `POST /api/auth/sign-out`       | Déconnexion (+ `x-api-key`)                       |
| `GET /api/me`                   | Identité et organisation active                   |
| `GET /api/organization/members` | Rôle de l'utilisateur (échec toléré)              |
| `GET /api/organization/suppliers` | Catalogue fournisseurs (mis en cache)           |
| `GET /api/traceability/products`  | Catalogue produits (mis en cache)               |
| `GET /api/organization/alerts`  | Alertes chaîne du froid (filtrées côté client)    |
| `POST /api/sync/scans`          | **Le seul point d'écriture de l'application**     |

## Architecture

```
src/
  app/            écrans et navigation (expo-router, routage par fichiers)
    (tabs)/       Accueil · Scan · Sync · Profil (groupe protégé par une garde de session)
    login.tsx     connexion
    reception.tsx formulaire de réception (alimente la file locale)
  lib/
    api.ts        client HTTP (intercepteurs : Bearer, purge sur 401, clé API sur /auth/*)
    session.ts    jeton dans le coffre chiffré du système (variante web : localStorage)
    errors.ts     normalisation des deux formats d'erreur de l'API, messages opérateur
    db.ts         connexion SQLite et schéma
    cache.ts      cache clé/valeur (catalogue)
    catalog.ts    fournisseurs et produits — réseau d'abord, cache en secours
    alerts.ts     alertes chaîne du froid
    me.ts         identité et rôle
    sync/
      queue.ts    la file : enfilement, sélection, verdicts, remédiation, rétention
      sync.ts     l'orchestration : lots, boucle, dichotomie, verrou
      outcome.ts  la décision : quel verdict serveur produit quel état local (pur)
      backoff.ts  les délais de réessai (pur)
      auto-sync.ts déclencheur au retour du réseau + rétention au démarrage
  hooks/          état de session, utilisateur courant, état réseau
```

La logique de décision (`outcome.ts`, `backoff.ts`) est **pure** : c'est là que se joue la perte
ou la duplication d'un scan, et c'est donc là que les tests sont les plus denses.

## Qualité

```bash
npm test          # tests unitaires (jest-expo)
npm run typecheck
npm run lint
```

Les trois commandes tournent en CI sur chaque PR (`.github/workflows/mobile-ci.yml`).

Un e2e vérifie le parcours complet **contre l'API réelle**, jusqu'à la vérification en base
Postgres — à lancer depuis `nutrichain-api` :

```bash
npm run e2e:mobile
```

**À rejouer après tout changement du contrat de synchronisation.**

## Limites connues

- Le code scanné pré-remplit le n° d'expédition : il n'est **ni parsé (GS1) ni résolu** contre
  l'API — aucun endpoint de recherche d'un lot par code n'existe côté serveur.
- L'application est **write-only** : aucune consultation de traçabilité, d'historique ou de
  généalogie.
- Seule la **réception** est synchronisable (`type: 'receipt'`). Transformation et expédition
  sont différées côté API (P3).
- Le cache du catalogue n'a **pas de durée de validité**.
- `queue.ts` est testé au niveau du SQL émis, pas d'un moteur SQLite réel (expo-sqlite est
  natif ; les alternatives exigent WASM ou une compilation native).
- Pas de notifications push, pas de 2FA, pas de réinitialisation de mot de passe.
