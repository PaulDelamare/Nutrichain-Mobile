import { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios';

import { apiClient } from '../api';
import { getToken, getUserId } from '../session';
import { getPendingOperations, saveOperationUpdates } from './queue';
import { MAX_BATCH_SIZE, syncPendingOperations } from './sync';
import type { QueuedOperation } from './types';

jest.mock('./queue');
jest.mock('../cache');
jest.mock('../session', () => ({
  getToken: jest.fn().mockResolvedValue('jwt-123'),
  clearToken: jest.fn(),
  saveToken: jest.fn(),
  getUserId: jest.fn().mockResolvedValue('operateur-A'),
  clearUserId: jest.fn(),
  saveUserId: jest.fn(),
}));
jest.mock('expo-router', () => ({ router: { replace: jest.fn() } }));

const queue = jest.mocked({ getPendingOperations, saveOperationUpdates });
const mockedGetUserId = jest.mocked(getUserId);
const mockedGetToken = jest.mocked(getToken);

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
    error: null,
  };
}

function respondWith(
  status: number,
  data: unknown
): { body: () => { items: unknown[] }; headers: () => Record<string, unknown> } {
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

  return {
    body: () => JSON.parse(String(seen?.data)),
    headers: () => (seen?.headers ?? {}) as Record<string, unknown>,
  };
}

function multiStatus(results: unknown[]): unknown {
  return { status: 207, message: 'Sync traité', data: { results } };
}

describe('syncPendingOperations', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    queue.saveOperationUpdates.mockResolvedValue(undefined);
    mockedGetUserId.mockResolvedValue('operateur-A');
    mockedGetToken.mockResolvedValue('jwt-123');
  });

  it('ne lit même pas la file quand aucun opérateur n’est identifié', async () => {
    // Sans propriétaire, il n'y a personne dont les scans partent — et personne pour en répondre.
    mockedGetUserId.mockResolvedValue(null);
    queue.getPendingOperations.mockResolvedValue([operation('op-1')]);
    respondWith(207, multiStatus([{ clientOpId: 'op-1', status: 'ok' }]));

    const summary = await syncPendingOperations();

    expect(summary.sent).toBe(0);
    expect(queue.getPendingOperations).not.toHaveBeenCalled();
  });

  it('envoie les scans avec le jeton ÉPINGLÉ de leur propriétaire, pas avec le jeton courant', async () => {
    // L'identité est vérifiée, mais c'est le JETON qui autorise l'écriture côté serveur. Les lire
    // séparément (l'un à la lecture de la file, l'autre à l'émission) laisse une fenêtre où les
    // scans de A partent avec le jeton de B.
    //
    // Le jeton CHANGE ici entre l'épinglage et l'émission : c'est la seule façon de prouver que
    // celui qui part est bien l'épinglé. Avec un jeton constant, le test passerait aussi bien sans
    // aucun épinglage — il ne prouverait rien.
    mockedGetToken.mockResolvedValueOnce('jeton-de-A').mockResolvedValue('jeton-de-B');
    queue.getPendingOperations.mockResolvedValueOnce([operation('op-1')]).mockResolvedValue([]);
    const request = respondWith(207, multiStatus([{ clientOpId: 'op-1', status: 'ok' }]));

    await syncPendingOperations();

    expect(request.headers().Authorization).toBe('Bearer jeton-de-A');
  });

  it('abandonne un envoi en vol si l’opérateur change', async () => {
    // La file est lue avec l'identité de A ; le jeton, lui, est attaché au moment de l'émission.
    // Entre les deux, A peut se déconnecter et B se connecter — les scans de A partiraient alors
    // avec le jeton de B, et l'API les graverait au nom de B dans la chaîne d'audit.
    queue.getPendingOperations.mockResolvedValue([operation('op-1')]);
    mockedGetUserId
      .mockResolvedValueOnce('operateur-A') // lecture de la file
      .mockResolvedValue('operateur-B'); // juste avant l'émission : ce n'est plus lui
    respondWith(207, multiStatus([{ clientOpId: 'op-1', status: 'ok' }]));

    const summary = await syncPendingOperations();

    expect(summary.sent).toBe(0);
    // Surtout : le scan de A n'est pas marqué synchronisé alors qu'il n'est jamais parti.
    expect(queue.saveOperationUpdates).not.toHaveBeenCalled();
  });

  it('n’appelle pas l’API quand la file est vide', async () => {
    queue.getPendingOperations.mockResolvedValue([]);
    respondWith(500, {});

    const summary = await syncPendingOperations();

    expect(summary).toEqual({ sent: 0, synced: 0, conflicts: 0, rejected: 0, retried: 0 });
    expect(queue.saveOperationUpdates).not.toHaveBeenCalled();
  });

  it('vide la file lot par lot, sans exiger un nouvel appui', async () => {
    // Une file de 250 scans ne doit pas demander trois fois « Synchroniser ».
    queue.getPendingOperations
      .mockResolvedValueOnce([operation('op-1')])
      .mockResolvedValueOnce([operation('op-2')])
      .mockResolvedValue([]);

    // Le serveur accepte tout : la boucle ne s'arrête donc que file vide.
    apiClient.defaults.adapter = (async (config: InternalAxiosRequestConfig) => {
      const { items } = JSON.parse(String(config.data)) as { items: { clientOpId: string }[] };
      return {
        data: multiStatus(items.map(({ clientOpId }) => ({ clientOpId, status: 'ok' }))),
        status: 207,
        statusText: '',
        headers: {},
        config,
      };
    }) as AxiosAdapter;

    const summary = await syncPendingOperations();

    expect(summary).toMatchObject({ sent: 2, synced: 2 });
    expect(queue.getPendingOperations).toHaveBeenCalledTimes(3);
  });

  it('ignore un second envoi lancé pendant le premier', async () => {
    // Sync automatique au retour du réseau + appui manuel : sans verrou, le même lot
    // partirait deux fois et le verdict du plus lent écraserait celui du plus rapide.
    queue.getPendingOperations.mockResolvedValueOnce([operation('op-1')]).mockResolvedValue([]);
    respondWith(207, multiStatus([{ clientOpId: 'op-1', status: 'ok' }]));

    const [first, second] = await Promise.all([syncPendingOperations(), syncPendingOperations()]);

    expect(first.sent + second.sent).toBe(1);
  });

  it('envoie les opérations en attente et applique chaque verdict du serveur', async () => {
    queue.getPendingOperations
      .mockResolvedValueOnce([operation('op-1'), operation('op-2'), operation('op-3')])
      .mockResolvedValue([]);
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
    queue.getPendingOperations.mockResolvedValueOnce([operation('op-stable')]).mockResolvedValue([]);
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
    queue.getPendingOperations
      .mockResolvedValueOnce([operation('op-1'), operation('op-2')])
      .mockResolvedValue([]);
    apiClient.defaults.adapter = (async () => {
      throw new AxiosError('Network Error');
    }) as AxiosAdapter;

    const summary = await syncPendingOperations();

    expect(summary).toEqual({ sent: 2, synced: 0, conflicts: 0, rejected: 0, retried: 2 });

    const updates = queue.saveOperationUpdates.mock.calls[0][0];
    expect(updates.every((u) => u.status === 'PENDING' && u.attempts === 1)).toBe(true);
    expect(updates.every((u) => u.nextAttemptAt > Date.now())).toBe(true);
  });

  it('isole l’opération fautive quand le serveur refuse le lot entier (400)', async () => {
    // La validation serveur est fail-fast : un seul item malformé fait rejeter les 100.
    // Sans dichotomie, la file resterait gelée pour toujours — ou tous les scans valides
    // seraient sacrifiés avec le coupable.
    queue.getPendingOperations
      .mockResolvedValueOnce([operation('bon'), operation('mauvais')])
      .mockResolvedValue([]);

    let call = 0;
    apiClient.defaults.adapter = (async (config: InternalAxiosRequestConfig) => {
      call += 1;
      const { items } = JSON.parse(String(config.data)) as { items: { clientOpId: string }[] };
      const contientLeMauvais = items.some((item) => item.clientOpId === 'mauvais');

      if (contientLeMauvais) {
        const response = {
          data: { status: 400, error: [{ field: 'shipment_id', message: 'Trop long' }] },
          status: 400,
          statusText: '',
          headers: {},
          config,
        };
        const error = new AxiosError('Bad Request', undefined, config, null, response);
        error.response = response;
        throw error;
      }

      return {
        data: multiStatus(items.map((item) => ({ clientOpId: item.clientOpId, status: 'ok' }))),
        status: 207,
        statusText: '',
        headers: {},
        config,
      };
    }) as AxiosAdapter;

    const summary = await syncPendingOperations();

    expect(call).toBeGreaterThan(1);
    expect(summary).toMatchObject({ synced: 1, rejected: 1 });

    const updates = queue.saveOperationUpdates.mock.calls.flatMap((c) => c[0]);
    expect(updates.find((u) => u.clientOpId === 'bon')?.status).toBe('SYNCED');
    expect(updates.find((u) => u.clientOpId === 'mauvais')?.status).toBe('REJECTED');
  });

  it('ne détruit PAS la file quand la session n’a pas d’organisation active (400 « auth »)', async () => {
    // L'API répond 400 `field: auth` quand la session n'a pas d'organisation active — une panne de
    // SESSION, que la reconnexion répare. Traité comme un 400 de payload, le lot est redécoupé
    // jusqu'au scan isolé, et CHAQUE scan est rejeté définitivement : une journée de réceptions
    // terrain, irremplaçables, condamnée par un état transitoire.
    queue.getPendingOperations
      .mockResolvedValueOnce([operation('op-1'), operation('op-2')])
      .mockResolvedValue([]);

    let call = 0;
    apiClient.defaults.adapter = (async (config: InternalAxiosRequestConfig) => {
      call += 1;
      const response = {
        data: {
          status: 400,
          error: [{ field: 'auth', message: "Vous n'avez pas sélectionné d'Organisation active." }],
        },
        status: 400,
        statusText: '',
        headers: {},
        config,
      };
      const error = new AxiosError('Bad Request', undefined, config, null, response);
      error.response = response;
      throw error;
    }) as AxiosAdapter;

    const summary = await syncPendingOperations();

    expect(summary).toMatchObject({ rejected: 0, retried: 2 });

    const updates = queue.saveOperationUpdates.mock.calls.flatMap((c) => c[0]);
    expect(updates.every((u) => u.status === 'PENDING')).toBe(true);

    // Le refus vise l'appelant : le découper en deux ne changera pas le verdict.
    expect(call).toBe(1);
  });

  it('rejette les scans qu’un rôle n’a pas le droit d’écrire, en gardant le motif du serveur', async () => {
    // Un `quality` ou un `viewer` n'a pas le droit d'écrire une réception : le serveur répond 403,
    // et il répondra 403 à la millionième tentative. Le laisser « En attente » est un mensonge —
    // l'opération n'est ni supprimable, ni remédiable, et retape l'API toutes les 30 minutes.
    queue.getPendingOperations
      .mockResolvedValueOnce([operation('op-1'), operation('op-2')])
      .mockResolvedValue([]);

    let call = 0;
    apiClient.defaults.adapter = (async (config: InternalAxiosRequestConfig) => {
      call += 1;
      const response = {
        data: {
          status: 403,
          error: [{ field: 'auth', message: 'Action refusée. Rôle quality insuffisant.' }],
        },
        status: 403,
        statusText: '',
        headers: {},
        config,
      };
      const error = new AxiosError('Forbidden', undefined, config, null, response);
      error.response = response;
      throw error;
    }) as AxiosAdapter;

    const summary = await syncPendingOperations();

    expect(summary).toMatchObject({ rejected: 2, retried: 0 });

    const updates = queue.saveOperationUpdates.mock.calls.flatMap((c) => c[0]);
    expect(updates.every((u) => u.status === 'REJECTED')).toBe(true);

    // Le motif du SERVEUR, pas une phrase générique : sans lui, l'opérateur ignore que c'est son
    // rôle qui bloque — et l'admin ne sait pas quoi corriger.
    expect(updates[0].error).toBe('Action refusée. Rôle quality insuffisant.');

    // Le verdict porte sur l'appelant : insister avec les lots suivants ne ferait que marteler l'API.
    expect(call).toBe(1);
  });

  it('réessaie les erreurs serveur transitoires uniquement', async () => {
    queue.getPendingOperations
      .mockResolvedValueOnce([operation('op-1'), operation('op-2')])
      .mockResolvedValue([]);
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
