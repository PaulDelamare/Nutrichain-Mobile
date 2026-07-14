import { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios';

import { apiClient } from './api';
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
