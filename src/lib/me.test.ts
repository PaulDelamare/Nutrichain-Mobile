import { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios';

import { apiClient } from './api';
import { readCache, writeCache } from './cache';
import { fetchCurrentUser } from './me';

jest.mock('./cache');
jest.mock('./session', () => ({
  getToken: jest.fn().mockResolvedValue('jwt-123'),
  clearToken: jest.fn(),
  saveToken: jest.fn(),
  getUserId: jest.fn().mockResolvedValue('user-1'),
  clearUserId: jest.fn(),
  saveUserId: jest.fn(),
}));
jest.mock('expo-router', () => ({ router: { replace: jest.fn() } }));

type Route = { status: number; data: unknown };

/** Chaque URL répond indépendamment. */
function routes(byUrl: Record<string, Route>): void {
  const adapter: AxiosAdapter = async (config: InternalAxiosRequestConfig) => {
    const route = byUrl[config.url ?? ''];
    if (!route) throw new Error(`Route non stubée : ${config.url}`);

    const response = { data: route.data, status: route.status, statusText: '', headers: {}, config };
    if (route.status >= 400) {
      const error = new AxiosError('Request failed', undefined, config, null, response);
      error.response = response;
      throw error;
    }
    return response;
  };
  apiClient.defaults.adapter = adapter;
}

const me = (role?: string | null) => ({
  status: 200,
  data: {
    data: {
      user: { id: 'u1', name: 'Paul Delamare', email: 'paul@nutrichain.local' },
      activeOrgId: 'org-1',
      ...(role === undefined ? {} : { role }),
    },
  },
});
const ME = me('operator');

describe('fetchCurrentUser', () => {
  it('renvoie l’utilisateur et son organisation active', async () => {
    routes({ '/api/me': ME, '/api/organization/members': { status: 200, data: { data: [] } } });

    const user = await fetchCurrentUser();

    expect(user.name).toBe('Paul Delamare');
    expect(user.email).toBe('paul@nutrichain.local');
    expect(user.organizationId).toBe('org-1');
  });

  // ⚠️ Le rôle vient de `/api/me`, et de nulle part ailleurs. Il était résolu via
  // `GET /organization/members`, route réservée aux `owner`/`admin` : pour un `operator`, un
  // `quality` ou un `viewer` — les utilisateurs mêmes de cette app — c'était un 403 avalé, donc un
  // rôle toujours `null`. Les tests précédents encodaient ce contrat périmé (« /api/me ne porte pas
  // le rôle ») : ils validaient le bug.
  it('lit le rôle sur /api/me — et n’interroge AUCUNE route d’administration', async () => {
    routes({ '/api/me': me('operator') });

    const user = await fetchCurrentUser();

    expect(user.role).toBe('operator');
    // `routes` jette sur toute URL non stubée : si `/organization/members` était encore appelée,
    // ce test échouerait. C'est la garde.
  });

  it('n’invente pas de rôle quand l’API n’en renvoie pas', async () => {
    routes({ '/api/me': me(undefined) });

    expect((await fetchCurrentUser()).role).toBeNull();
  });

  it('propage l’échec quand l’identité elle-même est refusée', async () => {
    routes({ '/api/me': { status: 401, data: { message: 'Unauthorized' } } });

    await expect(fetchCurrentUser()).rejects.toMatchObject({ status: 401 });
  });
});

/**
 * (issue #71) Le rôle pilote désormais l'affichage des écrans d'écriture. Or `/api/me` exige le
 * réseau : sans mémoire locale, le rôle redevient inconnu à chaque chambre froide, et la garde
 * s'évapore exactement là où l'application est utilisée.
 */
describe('fetchCurrentUser — mémoire du rôle', () => {
  const mockedReadCache = jest.mocked(readCache);
  const mockedWriteCache = jest.mocked(writeCache);

  beforeEach(() => {
    jest.clearAllMocks();
    mockedReadCache.mockResolvedValue(null);
    mockedWriteCache.mockResolvedValue(undefined);
  });

  /** Le réseau absent se présente comme une `ApiError` de statut 0 (`isNetworkError`). */
  function offline(): void {
    apiClient.defaults.adapter = (async (config: InternalAxiosRequestConfig) => {
      throw new AxiosError('Network Error', 'ERR_NETWORK', config, {}, undefined);
    }) as AxiosAdapter;
  }

  it('retient le rôle de chaque réponse fraîche', async () => {
    routes({ '/api/me': me('viewer') });

    await fetchCurrentUser();

    expect(mockedWriteCache).toHaveBeenCalledWith('me', expect.objectContaining({ role: 'viewer' }));
  });

  it('rend le rôle mémorisé quand le réseau manque', async () => {
    // Sans ça, un `viewer` hors ligne retrouvait les cartes d'écriture : le bouton trompeur
    // revenait précisément dans le mode où l'app doit servir.
    mockedReadCache.mockResolvedValue({
      id: 'u1',
      name: 'Paul Delamare',
      email: 'paul@nutrichain.local',
      role: 'viewer',
      organizationId: 'org-1',
    });
    offline();

    expect((await fetchCurrentUser()).role).toBe('viewer');
  });

  it('ne masque JAMAIS un 401 derrière le cache', async () => {
    // ⚠️ Le mutant : un repli aveugle ferait passer une session MORTE pour vivante, et l'app
    // resterait sur un écran qu'elle n'a plus le droit d'afficher.
    mockedReadCache.mockResolvedValue({
      id: 'u1',
      name: 'Paul Delamare',
      email: 'paul@nutrichain.local',
      role: 'owner',
      organizationId: 'org-1',
    });
    routes({ '/api/me': { status: 401, data: { message: 'Unauthorized' } } });

    await expect(fetchCurrentUser()).rejects.toMatchObject({ status: 401 });
  });

  it('propage l’échec réseau quand rien n’a jamais été mémorisé', async () => {
    // On ne fabrique pas un utilisateur vide : « je ne sais pas » doit remonter tel quel.
    offline();

    await expect(fetchCurrentUser()).rejects.toBeDefined();
  });
});
