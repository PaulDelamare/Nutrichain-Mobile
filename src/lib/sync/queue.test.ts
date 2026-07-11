import { getDatabase } from '../db';
import { enqueueReceipt, getPendingOperations, saveOperationUpdates } from './queue';
import type { ReceiptPayload } from './types';

/**
 * Un vrai moteur SQLite n'est pas disponible sous Jest (expo-sqlite est natif, et les
 * alternatives exigent WASM ou une compilation native). On vérifie donc ce que la file
 * envoie à la base : les deux invariants qui, cassés, feraient perdre des scans —
 * l'unicité de la clé d'idempotence, et les filtres qui font respecter le backoff et la
 * taille de lot. Le comportement du moteur lui-même reste à couvrir en test manuel.
 */
jest.mock('../db');
// jest-expo neutralise les modules natifs : sans ça, randomUUID renverrait `undefined`
// et l'unicité de la clé d'idempotence ne serait pas observable.
jest.mock('expo-crypto', () => ({
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  randomUUID: () => require('crypto').randomUUID(),
}));

interface Query {
  sql: string;
  params: unknown[];
}

const queries: Query[] = [];

const fakeDatabase = {
  runAsync: jest.fn(async (sql: string, ...params: unknown[]) => {
    queries.push({ sql, params });
  }),
  getAllAsync: jest.fn(async (sql: string, ...params: unknown[]) => {
    queries.push({ sql, params });
    return [];
  }),
  withExclusiveTransactionAsync: jest.fn(async (run: (tx: unknown) => Promise<void>) => {
    await run(fakeDatabase);
  }),
};

const PAYLOAD: ReceiptPayload = {
  id_fournisseur: 'f-1',
  shipment_id: 'SHIP-001',
  id_produit: 'p-1',
  quantite_actuelle: 12,
  unite_code: 'kg',
  statut_controle: 'OK',
};

beforeEach(() => {
  queries.length = 0;
  jest.clearAllMocks();
  jest.mocked(getDatabase).mockResolvedValue(fakeDatabase as never);
});

describe('enqueueReceipt', () => {
  it('attribue un identifiant unique à chaque réception', async () => {
    // Clé d'idempotence : deux scans partageant un identifiant se marcheraient dessus,
    // le second partirait en conflit côté serveur et serait perdu.
    const first = await enqueueReceipt(PAYLOAD);
    const second = await enqueueReceipt(PAYLOAD);

    expect(first).not.toBe(second);
    expect(first).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it('enregistre l’opération en attente, avec son payload sérialisé', async () => {
    const clientOpId = await enqueueReceipt(PAYLOAD);

    const [insert] = queries;
    expect(insert.sql).toContain("'PENDING'");
    expect(insert.params[0]).toBe(clientOpId);
    expect(JSON.parse(String(insert.params[1]))).toEqual(PAYLOAD);
  });
});

describe('getPendingOperations', () => {
  it('n’expose que les opérations en attente dont le délai est écoulé', async () => {
    // Sans ces deux filtres, le backoff serait calculé puis ignoré (l'API serait
    // martelée) et les opérations déjà synchronisées repartiraient en double.
    await getPendingOperations(1_800_000_000_000, 100);

    const [select] = queries;
    expect(select.sql).toContain("status = 'PENDING'");
    expect(select.sql).toContain('next_attempt_at <= ?');
    expect(select.params).toEqual([1_800_000_000_000, 100]);
  });

  it('borne le nombre d’opérations remontées', async () => {
    // Au-delà de 100 items, l'API refuse le lot entier.
    await getPendingOperations(0, 100);

    const [select] = queries;
    expect(select.sql).toContain('LIMIT ?');
  });
});

describe('saveOperationUpdates', () => {
  it('applique tous les verdicts dans une transaction exclusive', async () => {
    // Un verdict partiellement appliqué renverrait des opérations déjà enregistrées
    // côté serveur, ou en perdrait d'autres.
    await saveOperationUpdates([
      { clientOpId: 'op-1', status: 'SYNCED', attempts: 1, nextAttemptAt: 0, error: null, serverId: null },
      { clientOpId: 'op-2', status: 'REJECTED', attempts: 1, nextAttemptAt: 0, error: 'Invalide', serverId: null },
    ]);

    expect(fakeDatabase.withExclusiveTransactionAsync).toHaveBeenCalledTimes(1);
    expect(queries).toHaveLength(2);
    expect(queries[0].params).toContain('SYNCED');
    expect(queries[1].params).toContain('REJECTED');
  });
});
