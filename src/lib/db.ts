import * as SQLite from 'expo-sqlite';
import { Platform } from 'react-native';

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
    key       TEXT PRIMARY KEY NOT NULL,
    value     TEXT NOT NULL,
    cached_at INTEGER NOT NULL DEFAULT 0
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

/** Ce qu'une transaction doit savoir faire — et ce qu'un test doit fournir HONNÊTEMENT. */
export interface Transactable {
  getFirstAsync<T>(sql: string, ...params: unknown[]): Promise<T | null>;
  runAsync(sql: string, ...params: unknown[]): Promise<{ changes: number }>;
  withExclusiveTransactionAsync(run: (tx: Transactable) => Promise<void>): Promise<void>;
  withTransactionAsync(run: () => Promise<void>): Promise<void>;
}

/**
 * expo-sqlite **ne sait pas** ouvrir de transaction EXCLUSIVE sur le web : l'appel jette
 * (« withExclusiveTransactionAsync is not supported on web »). L'écriture échouait donc en
 * silence — aucun statut n'était jamais persisté, ni « synchronisé » ni « rejeté ». Un scan
 * accepté par le serveur restait affiché « En attente » et repartait indéfiniment.
 *
 * Aucun test ne pouvait le voir : ils fournissaient eux-mêmes un `withExclusiveTransactionAsync`
 * que la plateforme, elle, ne fournit pas. Il a fallu regarder l'écran.
 *
 * Sur le web on retombe donc sur la transaction ordinaire — la seule qui existe. Elle isole moins
 * bien (cf. `saveOperationUpdates`), mais le web est notre plateforme de démonstration, pas le
 * terminal de terrain : mieux vaut une isolation imparfaite qu'une file qui ne mémorise rien.
 */
export async function withTransaction(
  database: Transactable,
  run: (tx: Transactable) => Promise<void>
): Promise<void> {
  if (Platform.OS === 'web') {
    await database.withTransactionAsync(() => run(database));
    return;
  }

  await database.withExclusiveTransactionAsync(run);
}

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

  // Cache déjà installé sans horodatage (avant le TTL) : on ajoute `cached_at`. Les entrées
  // existantes héritent de 0 — donc « très vieilles » : la première lecture avec TTL les ignore et
  // force un rechargement réseau, plutôt que de servir un catalogue d'âge inconnu.
  // `table_info` d'une table absente renvoie [] (jamais une table réelle, qui a toujours des
  // colonnes) : on n'ALTER que si la table existe déjà — `migrate` reste sûr appelé seul, sans SCHEMA.
  const cacheColumns = await database.getAllAsync<{ name: string }>('PRAGMA table_info(cache)');
  if (cacheColumns.length > 0 && !cacheColumns.some((column) => column.name === 'cached_at')) {
    await database.execAsync('ALTER TABLE cache ADD COLUMN cached_at INTEGER NOT NULL DEFAULT 0');
  }
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
