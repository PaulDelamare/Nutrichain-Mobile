import * as SQLite from 'expo-sqlite';

const DATABASE_NAME = 'nutrichain.db';

/**
 * On mémorise la PROMESSE, pas la connexion : mémoriser la valeur résolue laisserait
 * deux appels concurrents (l'écran de réception charge fournisseurs et produits en
 * parallèle) ouvrir deux connexions, ce qui ruine la sérialisation des transactions.
 */
let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;

/**
 * `operations` : la file de scans à synchroniser. `user_id` en est le propriétaire — un scan
 * appartient à l'opérateur qui l'a saisi, jamais au téléphone (cf. `queue.ts`).
 * `cache` : le catalogue (fournisseurs, produits), sans lequel une réception serait
 * impossible à saisir hors réseau — c'est-à-dire précisément là où l'app doit servir.
 *
 * Exporté pour que les tests exécutent le SQL de la file sur ce schéma-ci, et non sur une
 * copie qui divergerait en silence.
 */
export const SCHEMA = `
  CREATE TABLE IF NOT EXISTS operations (
    client_op_id    TEXT PRIMARY KEY NOT NULL,
    user_id         TEXT NOT NULL DEFAULT '',
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

/**
 * Les scans saisis avant que la file ait un propriétaire n'ont pas d'auteur connu. On ne peut ni
 * les attribuer à qui se connecte ensuite — ce serait exactement la falsification qu'on corrige —
 * ni les supprimer : ce sont des données terrain. On les bloque, avec le motif : l'écran de
 * synchronisation les remonte en tête et l'opérateur décide.
 */
export const ORPHAN_OPERATION_MESSAGE =
  "Scan enregistré avant l'identification de l'opérateur : son auteur ne peut pas être établi. Il ne peut pas être renvoyé sous votre nom — ressaisissez la réception, puis supprimez-le.";

/** L'API d'expo-sqlite dont la migration a besoin — le test la rejoue sur un vrai moteur SQLite. */
interface Migratable {
  getAllAsync<T>(sql: string): Promise<T[]>;
  execAsync(sql: string): Promise<unknown>;
  runAsync(sql: string, ...params: unknown[]): Promise<unknown>;
}

export async function migrate(database: Migratable): Promise<void> {
  const columns = await database.getAllAsync<{ name: string }>('PRAGMA table_info(operations)');

  if (!columns.some((column) => column.name === 'user_id')) {
    await database.execAsync("ALTER TABLE operations ADD COLUMN user_id TEXT NOT NULL DEFAULT ''");
  }

  await database.runAsync(
    "UPDATE operations SET status = 'CONFLICT', error = ? WHERE user_id = '' AND status = 'PENDING'",
    ORPHAN_OPERATION_MESSAGE
  );
}

async function open(): Promise<SQLite.SQLiteDatabase> {
  const database = await SQLite.openDatabaseAsync(DATABASE_NAME);

  await database.execAsync(`PRAGMA journal_mode = WAL; ${SCHEMA}`);
  await migrate(database);

  return database;
}

export function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (!databasePromise) {
    // Une promesse REJETÉE resterait mémorisée : un échec passager (base verrouillée pendant la
    // migration) condamnerait alors chaque accès ultérieur, et l'app resterait morte jusqu'au
    // redémarrage. On oublie l'échec pour que la tentative suivante rouvre.
    databasePromise = open().catch((error: unknown) => {
      databasePromise = null;
      throw error;
    });
  }

  return databasePromise;
}
