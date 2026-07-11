# NutriChain Mobile

Application terrain (Expo / React Native) des opérateurs NutriChain : scan de lots, réception,
et synchronisation différée des scans effectués hors réseau.

## Démarrage

```bash
npm install
cp .env.example .env   # puis renseigner les deux variables
npm start
```

### Configuration (`.env`)

| Variable               | Rôle                                                                              |
| ---------------------- | --------------------------------------------------------------------------------- |
| `EXPO_PUBLIC_API_URL`  | URL de l'API. Émulateur Android : `http://10.0.2.2:3000`. iOS/web : `localhost`.  |
| `EXPO_PUBLIC_API_KEY`  | Doit valoir exactement `API_KEY` du `.env` de l'API : `/api/auth/*` l'exige.       |

`EXPO_PUBLIC_API_KEY` est embarquée en clair dans le binaire (contrainte Expo) : elle sert de
portail d'accès à l'API, jamais de secret — aucun droit n'est accordé sans session utilisateur.

## Qualité

```bash
npm test        # tests unitaires (jest-expo)
npm run typecheck
npm run lint
```

Ces trois commandes tournent en CI sur chaque PR (`.github/workflows/mobile-ci.yml`).

## Architecture

- `src/app/` — écrans et navigation (expo-router, routage par fichiers).
- `src/lib/` — accès API : `api.ts` (client HTTP), `session.ts` (jeton, coffre chiffré système),
  `errors.ts` (normalisation et traduction des erreurs).
- `src/hooks/` — hooks partagés.

Le jeton de session est stocké via `expo-secure-store` (Keychain / Keystore) et injecté en
`Authorization: Bearer` par le client HTTP. Un 401 le purge automatiquement.
