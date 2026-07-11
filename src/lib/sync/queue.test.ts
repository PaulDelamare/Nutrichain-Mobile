import { getDatabase } from '../db';
import {
  deleteOperation,
  enqueueReceipt,
  flagStalePending,
  getPendingOperations,
  purgeSyncedBefore,
  requeueOperation,
  saveOperationUpdates,
} from './queue';
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
  getFirstAsync: jest.fn(async (sql: string, ...params: unknown[]) => {
    queries.push({ sql, params });
    return null as unknown;
  }),
  withExclusiveTransactionAsync: jest.fn(async (run: (tx: unknown) => Promise<void>) => {
    await run(fakeDatabase);
  }),
};

/** Remplace la réponse du SELECT sans perdre l'enregistrement de la requête émise. */
function firstRowIs(row: unknown): void {
  fakeDatabase.getFirstAsync.mockImplementation(async (sql: string, ...params: unknown[]) => {
    queries.push({ sql, params });
    return row;
  });
}

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

describe('remédiation d’une opération bloquée', () => {
  it('renvoie l’opération sous un NOUVEL identifiant', async () => {
    // Rejouer une opération en conflit sous son identifiant d'origine la ferait
    // reconflicter indéfiniment : le serveur a déjà enregistré autre chose sous cette clé.
    // Un renvoi est donc, pour lui, une opération neuve — au même contenu.
    firstRowIs({ payload: JSON.stringify(PAYLOAD), type: 'receipt' });

    const clientOpId = await requeueOperation('op-en-conflit');

    expect(clientOpId).not.toBe('op-en-conflit');
    expect(clientOpId).toMatch(/^[0-9a-f-]{36}$/i);

    const insert = queries.find((query) => query.sql.includes('INSERT'));
    expect(JSON.parse(String(insert?.params[1]))).toEqual(PAYLOAD);

    // L'ancienne ligne disparaît : la laisser afficherait deux fois le même scan.
    const remove = queries.find((query) => query.sql.includes('DELETE'));
    expect(remove?.params).toContain('op-en-conflit');
  });

  it('insère et supprime dans une seule transaction', async () => {
    // Une app tuée entre les deux laisserait la copie ET l'originale : l'opérateur,
    // voyant son scan toujours bloqué, le renverrait — deux réceptions pour une palette.
    firstRowIs({ payload: JSON.stringify(PAYLOAD), type: 'receipt' });

    await requeueOperation('op-en-conflit');

    expect(fakeDatabase.withExclusiveTransactionAsync).toHaveBeenCalledTimes(1);
  });

  it('ne renvoie que depuis un état bloqué', async () => {
    // Renvoyer une opération déjà synchronisée créerait un doublon ; en renvoyer une
    // encore en vol ferait perdre son verdict.
    firstRowIs(null);

    await expect(requeueOperation('op-synchronisee')).rejects.toThrow();

    const select = queries.find((query) => query.sql.includes('SELECT'));
    expect(select?.sql).toContain("status IN ('CONFLICT', 'REJECTED')");
  });

  it('refuse de renvoyer un type d’opération qu’il ne sait pas reconstruire', async () => {
    // Le jour où une expédition existera, la réinsérer en 'receipt' enverrait un payload
    // étranger au mauvais handler serveur.
    firstRowIs({ payload: '{}', type: 'shipment' });

    await expect(requeueOperation('op-expedition')).rejects.toThrow(/shipment/);
  });

  it('ne supprime une opération que si elle est bloquée', async () => {
    await deleteOperation('op-1');

    const [remove] = queries;
    expect(remove.sql).toContain('DELETE');
    expect(remove.sql).toContain("status IN ('CONFLICT', 'REJECTED')");
    expect(remove.params).toEqual(['op-1']);
  });
});

describe('rétention locale', () => {
  it('ne purge QUE l’historique synchronisé, et seulement passé le délai', async () => {
    // Le mutant qui retire ce filtre supprime les scans en attente au démarrage de l'app :
    // perte définitive et silencieuse de scans terrain.
    await purgeSyncedBefore(1_700_000_000_000);

    const [remove] = queries;
    expect(remove.sql).toContain('DELETE');
    expect(remove.sql).toContain("status = 'SYNCED'");
    expect(remove.sql).toContain('created_at < ?');
    expect(remove.params).toEqual([1_700_000_000_000]);
  });

  it('signale les opérations en attente au-delà du TTL au lieu de les rejouer', async () => {
    // Leur clé d'idempotence a expiré côté serveur : si la réception avait été commitée et
    // que seule la réponse s'était perdue, les rejouer créerait un doublon en base.
    await flagStalePending(1_700_000_000_000, 'À vérifier');

    const [update] = queries;
    expect(update.sql).toContain("SET status = 'CONFLICT'");
    expect(update.sql).toContain("status = 'PENDING'");
    expect(update.sql).toContain('created_at < ?');
    expect(update.params).toEqual(['À vérifier', 1_700_000_000_000]);
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
