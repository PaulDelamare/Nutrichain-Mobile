import { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios';

import { apiClient } from '../api';
import { getPendingOperations, saveOperationUpdates } from './queue';
import { MAX_BATCH_SIZE, syncPendingOperations } from './sync';
import type { QueuedOperation } from './types';

jest.mock('./queue');
jest.mock('../session', () => ({
  getToken: jest.fn().mockResolvedValue('jwt-123'),
  clearToken: jest.fn(),
  saveToken: jest.fn(),
}));
jest.mock('expo-router', () => ({ router: { replace: jest.fn() } }));

const queue = jest.mocked({ getPendingOperations, saveOperationUpdates });

function operation(clientOpId: string, attempts = 0): QueuedOperation {
  return {
    clientOpId,
    type: 'receipt',
    payload: {
      id_fournisseur: 'f-1',
      shipment_id: 'SHIP-001',
      id_produit: 'p-1',
      quantite_actuelle: 12,
      unite_code: 'KG',
      statut_controle: 'OK',
    },
    status: 'PENDING',
    attempts,
  };
}

function respondWith(status: number, data: unknown): { body: () => { items: unknown[] } } {
  let seen: InternalAxiosRequestConfig | undefined;

  apiClient.defaults.adapter = (async (config: InternalAxiosRequestConfig) => {
    seen = config;
    const response = { data, status, statusText: '', headers: {}, config };
    if (status >= 400) {
      const error = new AxiosError('Request failed', undefined, config, null, response);
      error.response = response;
      throw error;
    }
    return response;
  }) as AxiosAdapter;

  return { body: () => JSON.parse(String(seen?.data)) };
}

function multiStatus(results: unknown[]): unknown {
  return { status: 207, message: 'Sync traité', data: { results } };
}

describe('syncPendingOperations', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    queue.saveOperationUpdates.mockResolvedValue(undefined);
  });

  it('n’appelle pas l’API quand la file est vide', async () => {
    queue.getPendingOperations.mockResolvedValue([]);
    respondWith(500, {});

    const summary = await syncPendingOperations();

    expect(summary).toEqual({ sent: 0, synced: 0, conflicts: 0, rejected: 0, retried: 0 });
    expect(queue.saveOperationUpdates).not.toHaveBeenCalled();
  });

  it('envoie les opérations en attente et applique chaque verdict du serveur', async () => {
    queue.getPendingOperations.mockResolvedValue([
      operation('op-1'),
      operation('op-2'),
      operation('op-3'),
    ]);
    const request = respondWith(
      207,
      multiStatus([
        { clientOpId: 'op-1', status: 'ok', serverId: { receiptId: 'r-1', batchId: 'b-1' } },
        { clientOpId: 'op-2', status: 'conflict', error: { field: 'clientOpId', message: 'Diverged' } },
        { clientOpId: 'op-3', status: 'error', error: { field: 'id_produit', message: 'Introuvable' } },
      ])
    );

    const summary = await syncPendingOperations();

    expect(request.body().items).toHaveLength(3);
    expect(summary).toEqual({ sent: 3, synced: 1, conflicts: 1, rejected: 1, retried: 0 });

    const updates = queue.saveOperationUpdates.mock.calls[0][0];
    expect(updates.map((u) => u.status)).toEqual(['SYNCED', 'CONFLICT', 'REJECTED']);
  });

  it('renvoie exactement le clientOpId d’origine, jamais un nouveau', async () => {
    // Régénérer l'identifiant ferait perdre l'idempotence : le serveur créerait un doublon.
    queue.getPendingOperations.mockResolvedValue([operation('op-stable')]);
    const request = respondWith(207, multiStatus([{ clientOpId: 'op-stable', status: 'ok' }]));

    await syncPendingOperations();

    expect(request.body().items).toEqual([
      expect.objectContaining({ clientOpId: 'op-stable', type: 'receipt' }),
    ]);
  });

  it('ne dépasse jamais la taille de lot acceptée par l’API', async () => {
    const many = Array.from({ length: 150 }, (_, i) => operation(`op-${i}`));
    queue.getPendingOperations.mockResolvedValue(many.slice(0, MAX_BATCH_SIZE));
    respondWith(207, multiStatus([]));

    await syncPendingOperations();

    expect(queue.getPendingOperations).toHaveBeenCalledWith(expect.any(Number), MAX_BATCH_SIZE);
    expect(MAX_BATCH_SIZE).toBeLessThanOrEqual(100);
  });

  it('replanifie tout le lot quand la requête échoue, sans rien perdre', async () => {
    // Réseau coupé en plein envoi : les opérations restent PENDING, avec un délai
    // avant nouvelle tentative pour ne pas marteler le serveur au retour du réseau.
    queue.getPendingOperations.mockResolvedValue([operation('op-1'), operation('op-2')]);
    apiClient.defaults.adapter = (async () => {
      throw new AxiosError('Network Error');
    }) as AxiosAdapter;

    const summary = await syncPendingOperations();

    expect(summary).toEqual({ sent: 2, synced: 0, conflicts: 0, rejected: 0, retried: 2 });

    const updates = queue.saveOperationUpdates.mock.calls[0][0];
    expect(updates.every((u) => u.status === 'PENDING' && u.attempts === 1)).toBe(true);
    expect(updates.every((u) => u.nextAttemptAt > Date.now())).toBe(true);
  });

  it('réessaie les erreurs serveur transitoires uniquement', async () => {
    queue.getPendingOperations.mockResolvedValue([operation('op-1'), operation('op-2')]);
    respondWith(
      207,
      multiStatus([
        { clientOpId: 'op-1', status: 'error', error: { field: 'internal', message: 'Erreur serveur' } },
        { clientOpId: 'op-2', status: 'error', error: { field: 'unite_code', message: 'Invalide' } },
      ])
    );

    const summary = await syncPendingOperations();

    expect(summary).toMatchObject({ retried: 1, rejected: 1 });
  });
});
