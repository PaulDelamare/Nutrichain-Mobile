import * as SQLite from 'expo-sqlite';

const DATABASE_NAME = 'nutrichain.db';

let database: SQLite.SQLiteDatabase | null = null;

/**
 * `operations` : la file de scans à synchroniser.
 * `cache` : le catalogue (fournisseurs, produits), sans lequel une réception serait
 * impossible à saisir hors réseau — c'est-à-dire précisément là où l'app doit servir.
 */
export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (!database) {
    database = await SQLite.openDatabaseAsync(DATABASE_NAME);
    await database.execAsync(`
      PRAGMA journal_mode = WAL;
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
    `);
  }

  return database;
}
