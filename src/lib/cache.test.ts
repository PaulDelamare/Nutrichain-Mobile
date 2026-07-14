/**
 * @jest-environment node
 *
 * Le SQL du cache s'exécute ici sur un VRAI moteur SQLite (`node:sqlite`, Node 22 — la CI), comme
 * `queue.test.ts` : on prouve la colonne `cached_at`, la requête de TTL et la migration, pas des
 * fragments de chaîne.
 */
import { CACHE_TTL_MS, readCache, writeCache } from './cache';
import { migrate, SCHEMA } from './db';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let DatabaseSync: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  ({ DatabaseSync } = require('node:sqlite'));
} catch {
  DatabaseSync = null;
}

/** Node 20 en local, Node 22 en CI : le module n'existe qu'à partir de 22. */
const describeWithSqlite = DatabaseSync ? describe : describe.skip;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let engine: any;

jest.mock('./db', () => ({
  ...jest.requireActual<typeof import('./db')>('./db'),
  getDatabase: async () => mockDatabase,
}));

/** L'API d'expo-sqlite utilisée par le cache, portée sur node:sqlite. */
const mockDatabase = {
  runAsync: async (sql: string, ...params: unknown[]) => engine.prepare(sql).run(...params),
  getFirstAsync: async (sql: string, ...params: unknown[]) =>
    engine.prepare(sql).get(...params) ?? null,
};

const DAY = 24 * 60 * 60 * 1000;

// Horloge pilotée : le TTL est une DURÉE (now − cached_at). En figeant `Date.now`, on vieillit une
// entrée sans attendre, et on garantit que l'écriture et la lecture partagent la même base de temps.
let clock = 1_700_000_000_000;

describeWithSqlite('cache avec TTL', () => {
  beforeEach(() => {
    engine = new DatabaseSync(':memory:');
    engine.exec(SCHEMA);
    clock = 1_700_000_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => clock);
  });

  afterEach(() => jest.restoreAllMocks());

  it('sert une entrée encore fraîche', async () => {
    await writeCache('products', [{ id: 'p-1' }]);
    clock += 60 * 60 * 1000; // 1 h plus tard

    await expect(readCache('products', CACHE_TTL_MS)).resolves.toEqual([{ id: 'p-1' }]);
  });

  // BUG REPRODUIT : sans TTL, un catalogue périmé est servi indéfiniment — l'opérateur peut
  // réceptionner contre un produit qui n'existe plus. Échoue sur le code actuel (l'entrée est rendue).
  it('n’exhume PAS une entrée plus vieille que le TTL', async () => {
    await writeCache('products', [{ id: 'p-1' }]);
    clock += CACHE_TTL_MS + DAY; // au-delà de la fenêtre de fraîcheur

    await expect(readCache('products', CACHE_TTL_MS)).resolves.toBeNull();
  });

  // Une réécriture (réception réseau réussie) RAFRAÎCHIT l'horodatage : l'entrée redevient fraîche.
  it('rafraîchit la fraîcheur à chaque réécriture', async () => {
    await writeCache('products', [{ id: 'ancien' }]);
    clock += CACHE_TTL_MS + DAY;
    await writeCache('products', [{ id: 'neuf' }]); // réécrit « maintenant »

    await expect(readCache('products', CACHE_TTL_MS)).resolves.toEqual([{ id: 'neuf' }]);
  });

  // ⚠️ Sans `maxAge`, AUCUNE expiration : l'offset serveur (server-time.ts) doit survivre
  // indéfiniment — l'expirer ferait perdre la garde de péremption hors ligne.
  it('sans TTL explicite, une entrée ancienne reste disponible', async () => {
    await writeCache('server_time_offset', 4200);
    clock += 3650 * DAY; // 10 ans

    await expect(readCache('server_time_offset')).resolves.toBe(4200);
  });

  it('rend null pour une clé absente', async () => {
    await expect(readCache('products', CACHE_TTL_MS)).resolves.toBeNull();
  });
});

describeWithSqlite('migration du cache déjà installé', () => {
  /** Enrobe un moteur node:sqlite dans l'interface `Migratable` attendue par `migrate`. */
  function migratable(db: typeof engine) {
    return {
      getAllAsync: async (sql: string) => db.prepare(sql).all(),
      execAsync: async (sql: string) => db.exec(sql),
      runAsync: async (sql: string, ...p: unknown[]) => db.prepare(sql).run(...p),
    };
  }

  // BUG REPRODUIT : `migrate` n'ajoutait pas `cached_at` à une table `cache` déjà installée →
  // sur le code actuel, la colonne reste absente. Échoue avant le correctif.
  it('ajoute la colonne cached_at à un ancien cache (key, value)', async () => {
    const db = new DatabaseSync(':memory:');
    // Ancien téléphone : operations à jour (user_id présent), cache SANS cached_at.
    db.exec(`
      CREATE TABLE operations (
        client_op_id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL DEFAULT '',
        type TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at INTEGER NOT NULL DEFAULT 0,
        error TEXT, server_id TEXT, created_at INTEGER NOT NULL
      );
      CREATE TABLE cache (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
    `);
    db.prepare('INSERT INTO cache (key, value) VALUES (?, ?)').run('products', '[{"id":"p-1"}]');

    await migrate(migratable(db));

    const columns = db
      .prepare('PRAGMA table_info(cache)')
      .all()
      .map((c: { name: string }) => c.name);
    expect(columns).toContain('cached_at');

    // L'entrée existante survit, avec un cached_at par défaut 0 (ancien → forcera un rechargement).
    const row = db.prepare('SELECT cached_at FROM cache WHERE key = ?').get('products') as {
      cached_at: number;
    };
    expect(row.cached_at).toBe(0);
  });
});
