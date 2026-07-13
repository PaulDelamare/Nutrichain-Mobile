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

/** Chaque URL répond indépendamment : /api/me et /api/organization/members ont des sorts distincts. */
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

const ME = {
  status: 200,
  data: {
    data: {
      user: { id: 'u1', name: 'Paul Delamare', email: 'paul@nutrichain.local' },
      activeOrgId: 'org-1',
    },
  },
};

describe('fetchCurrentUser', () => {
  it('renvoie l’utilisateur et son organisation active', async () => {
    routes({ '/api/me': ME, '/api/organization/members': { status: 200, data: { data: [] } } });

    const user = await fetchCurrentUser();

    expect(user.name).toBe('Paul Delamare');
    expect(user.email).toBe('paul@nutrichain.local');
    expect(user.organizationId).toBe('org-1');
  });

  it('résout le rôle depuis les membres de l’organisation', async () => {
    // /api/me ne porte pas le rôle : il faut le retrouver parmi les membres de l'org.
    routes({
      '/api/me': ME,
      '/api/organization/members': {
        status: 200,
        data: {
          data: [
            { userId: 'autre', role: 'admin' },
            { userId: 'u1', role: 'logistics_operator' },
          ],
        },
      },
    });

    const user = await fetchCurrentUser();

    expect(user.role).toBe('logistics_operator');
  });

  it('reste utilisable quand le rôle est inaccessible', async () => {
    // Un opérateur peut ne pas avoir le droit de lister les membres : l'écran doit
    // quand même afficher son identité plutôt que d'échouer entièrement.
    routes({
      '/api/me': ME,
      '/api/organization/members': { status: 403, data: { status: 403, error: [] } },
    });

    const user = await fetchCurrentUser();

    expect(user.name).toBe('Paul Delamare');
    expect(user.role).toBeNull();
  });

  it('propage l’échec quand l’identité elle-même est refusée', async () => {
    routes({ '/api/me': { status: 401, data: { message: 'Unauthorized' } } });

    await expect(fetchCurrentUser()).rejects.toMatchObject({ status: 401 });
  });
});
