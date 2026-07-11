/**
 * @jest-environment node
 *
 * Le SQL de la file s'exécute ici sur un VRAI moteur SQLite (`node:sqlite`, intégré à Node
 * depuis la 22 — la version de la CI). Zéro dépendance, zéro compilation native.
 *
 * Les tests précédents assertaient sur des fragments de requête. Ils étaient à la fois trop
 * stricts (un `IN ('PENDING')` équivalent les cassait) et trop laxistes : une inversion des
 * paramètres `status` et `attempts` — qui ferait qu'AUCUN scan n'est jamais marqué
 * synchronisé, et que tous repartiraient indéfiniment — passait au vert.
 */
import { SCHEMA } from '../db';
import {
  countByStatus,
  deleteOperation,
  enqueueReceipt,
  flagStalePending,
  getPendingOperations,
  listOperations,
  purgeSyncedBefore,
  requeueOperation,
  saveOperationUpdates,
} from './queue';
import type { OperationStatus, ReceiptPayload } from './types';

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

jest.mock('../db', () => ({
  ...jest.requireActual<typeof import('../db')>('../db'),
  getDatabase: async () => mockDatabase,
}));

jest.mock('expo-crypto', () => ({
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  randomUUID: () => require('crypto').randomUUID(),
}));

/** L'API d'expo-sqlite utilisée par la file, portée sur node:sqlite. */
const mockDatabase = {
  runAsync: async (sql: string, ...params: unknown[]) => engine.prepare(sql).run(...params),
  getAllAsync: async (sql: string, ...params: unknown[]) => engine.prepare(sql).all(...params),
  getFirstAsync: async (sql: string, ...params: unknown[]) =>
    engine.prepare(sql).get(...params) ?? null,
  withExclusiveTransactionAsync: async (run: (tx: unknown) => Promise<void>) => {
    engine.exec('BEGIN IMMEDIATE');
    try {
      await run(mockDatabase);
      engine.exec('COMMIT');
    } catch (error) {
      engine.exec('ROLLBACK');
      throw error;
    }
  },
};

const PAYLOAD: ReceiptPayload = {
  id_fournisseur: 'f-1',
  shipment_id: 'SHIP-001',
  id_produit: 'p-1',
  quantite_actuelle: 12,
  unite_code: 'kg',
  statut_controle: 'OK',
};

const NOW = 1_800_000_000_000;

function markAs(clientOpId: string, status: OperationStatus, createdAt = NOW) {
  engine
    .prepare('UPDATE operations SET status = ?, created_at = ? WHERE client_op_id = ?')
    .run(status, createdAt, clientOpId);
}

describeWithSqlite('file d’opérations (moteur SQLite réel)', () => {
  beforeEach(() => {
    engine = new DatabaseSync(':memory:');
    engine.exec(SCHEMA);
  });

  it('attribue un identifiant unique à chaque réception', async () => {
    // Clé d'idempotence : deux scans partageant un identifiant se marcheraient dessus.
    const first = await enqueueReceipt(PAYLOAD);
    const second = await enqueueReceipt(PAYLOAD);

    expect(first).not.toBe(second);
    await expect(countByStatus()).resolves.toMatchObject({ PENDING: 2 });
  });

  it('restitue le payload intact', async () => {
    await enqueueReceipt(PAYLOAD);

    const [operation] = await getPendingOperations(NOW, 100);

    expect(operation.payload).toEqual(PAYLOAD);
    expect(operation.status).toBe('PENDING');
    expect(operation.type).toBe('receipt');
  });

  it('borne le lot à la taille acceptée par l’API', async () => {
    for (let i = 0; i < 12; i++) await enqueueReceipt(PAYLOAD);

    await expect(getPendingOperations(NOW, 5)).resolves.toHaveLength(5);
  });

  it('respecte le délai de nouvelle tentative', async () => {
    // Le backoff est calculé ET stocké ; sans ce filtre SQL, il serait ignoré et l'API
    // martelée à chaque synchronisation.
    const clientOpId = await enqueueReceipt(PAYLOAD);
    await saveOperationUpdates([
      { clientOpId, status: 'PENDING', attempts: 1, nextAttemptAt: NOW + 30_000, error: 'Erreur serveur', serverId: null },
    ]);

    await expect(getPendingOperations(NOW, 100)).resolves.toHaveLength(0);
    await expect(getPendingOperations(NOW + 30_000, 100)).resolves.toHaveLength(1);
  });

  it('enregistre réellement le verdict du serveur', async () => {
    // Une inversion des paramètres écrirait le statut dans `attempts` : plus aucun scan ne
    // serait jamais marqué synchronisé, et tous repartiraient indéfiniment.
    const clientOpId = await enqueueReceipt(PAYLOAD);
    await saveOperationUpdates([
      { clientOpId, status: 'SYNCED', attempts: 1, nextAttemptAt: 0, error: null, serverId: '{"receiptId":"r-1"}' },
    ]);

    await expect(countByStatus()).resolves.toMatchObject({ SYNCED: 1, PENDING: 0 });
    await expect(getPendingOperations(NOW, 100)).resolves.toHaveLength(0);
  });

  it('renvoie une opération bloquée sous un nouvel identifiant, et supprime l’ancienne', async () => {
    const clientOpId = await enqueueReceipt(PAYLOAD);
    markAs(clientOpId, 'CONFLICT');

    const newClientOpId = await requeueOperation(clientOpId);

    expect(newClientOpId).not.toBe(clientOpId);
    const pending = await getPendingOperations(NOW, 100);
    expect(pending).toHaveLength(1);
    expect(pending[0].clientOpId).toBe(newClientOpId);
    expect(pending[0].payload).toEqual(PAYLOAD);
    await expect(countByStatus()).resolves.toMatchObject({ CONFLICT: 0 });
  });

  it('refuse de renvoyer ou de supprimer une opération qui n’est pas bloquée', async () => {
    // Renvoyer une opération synchronisée créerait un doublon ; en supprimer une en vol
    // ferait perdre son verdict. L'échec est bruyant, jamais silencieux.
    const clientOpId = await enqueueReceipt(PAYLOAD);

    await expect(requeueOperation(clientOpId)).rejects.toThrow();
    await expect(deleteOperation(clientOpId)).rejects.toThrow();
    await expect(countByStatus()).resolves.toMatchObject({ PENDING: 1 });
  });

  it('supprime une opération bloquée', async () => {
    const clientOpId = await enqueueReceipt(PAYLOAD);
    markAs(clientOpId, 'REJECTED');

    await deleteOperation(clientOpId);

    await expect(countByStatus()).resolves.toMatchObject({ REJECTED: 0 });
  });

  it('ne purge que l’historique synchronisé, jamais les scans en attente', async () => {
    // Le mutant qui retire ce filtre supprime les scans terrain au démarrage de l'app.
    const vieuxEnAttente = await enqueueReceipt(PAYLOAD);
    const vieuxSynchronise = await enqueueReceipt(PAYLOAD);
    markAs(vieuxEnAttente, 'PENDING', NOW - 100);
    markAs(vieuxSynchronise, 'SYNCED', NOW - 100);

    await purgeSyncedBefore(NOW);

    await expect(countByStatus()).resolves.toMatchObject({ SYNCED: 0, PENDING: 1 });
  });

  it('signale les opérations en attente au-delà du TTL au lieu de les rejouer', async () => {
    // Leur clé d'idempotence a expiré côté serveur : les rejouer pourrait créer un doublon.
    const perimee = await enqueueReceipt(PAYLOAD);
    const recente = await enqueueReceipt(PAYLOAD);
    markAs(perimee, 'PENDING', NOW - 100);
    markAs(recente, 'PENDING', NOW + 100);

    await flagStalePending(NOW, 'À vérifier');

    const counts = await countByStatus();
    expect(counts).toMatchObject({ CONFLICT: 1, PENDING: 1 });

    const [bloquee] = (await listOperations()).filter((operation) => operation.status === 'CONFLICT');
    expect(bloquee.error).toBe('À vérifier');
  });

  it('affiche les opérations bloquées même noyées sous l’historique', async () => {
    // Elles sont par nature les plus anciennes : sans tri dédié, elles sortaient des
    // 50 dernières lignes et devenaient invisibles — donc irrécupérables.
    const bloquee = await enqueueReceipt(PAYLOAD);
    markAs(bloquee, 'REJECTED', NOW - 10_000);

    for (let i = 0; i < 60; i++) {
      const recente = await enqueueReceipt(PAYLOAD);
      markAs(recente, 'SYNCED', NOW + i);
    }

    const listed = await listOperations();

    expect(listed[0].clientOpId).toBe(bloquee);
    expect(listed.filter((operation) => operation.status === 'REJECTED')).toHaveLength(1);
  });
});
