import * as SQLite from 'expo-sqlite';

const DATABASE_NAME = 'nutrichain.db';

/**
 * On mémorise la PROMESSE, pas la connexion : mémoriser la valeur résolue laisserait
 * deux appels concurrents (l'écran de réception charge fournisseurs et produits en
 * parallèle) ouvrir deux connexions, ce qui ruine la sérialisation des transactions.
 */
let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;

/**
 * `operations` : la file de scans à synchroniser.
 * `cache` : le catalogue (fournisseurs, produits), sans lequel une réception serait
 * impossible à saisir hors réseau — c'est-à-dire précisément là où l'app doit servir.
 *
 * Exporté pour que les tests exécutent le SQL de la file sur ce schéma-ci, et non sur une
 * copie qui divergerait en silence.
 */
export const SCHEMA = `
  CREATE TABLE IF NOT EXISTS operations (
    client_op_id    TEXT PRIMARY KEY NOT NULL,
    type            TEXT NOT NULL,
    payload         TEXT NOT NULL,
    status          TEXT NOT NULL,
    attempts        INTEGER NOT NULL DEFAULT 0,
    next_attempt_at INTEGER NOT NULL DEFAULT 0,
    error           TEXT,
    server_id       TEXT,
    created_at      INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS cache (
    key   TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
  );
`;

async function open(): Promise<SQLite.SQLiteDatabase> {
  const database = await SQLite.openDatabaseAsync(DATABASE_NAME);

  await database.execAsync(`PRAGMA journal_mode = WAL; ${SCHEMA}`);

  return database;
}

export function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (!databasePromise) {
    databasePromise = open();
  }

  return databasePromise;
}
