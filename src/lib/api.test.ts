import { AxiosError, type AxiosAdapter } from 'axios';

import { apiClient, isAuthenticated, signIn, signOut } from './api';
import { ApiError } from './errors';
import { clearToken, getToken, saveToken } from './session';

jest.mock('./session');

const session = jest.mocked({ clearToken, getToken, saveToken });

/** Court-circuite la couche réseau : l'adaptateur est le seul point d'entrée d'axios. */
function respondWith(status: number, data: unknown): void {
  const adapter: AxiosAdapter = async (config) => {
    const response = { data, status, statusText: '', headers: {}, config };
    if (status >= 400) {
      const error = new AxiosError('Request failed', undefined, config, null, response);
      error.response = response;
      throw error;
    }
    return response;
  };
  apiClient.defaults.adapter = adapter;
}

describe('signIn', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    session.getToken.mockResolvedValue(null);
  });

  it('stocke le jeton renvoyé par l’API', async () => {
    respondWith(200, { token: 'jwt-123', user: { id: 'u1', email: 'a@b.fr', name: 'Marie' } });

    const result = await signIn('a@b.fr', 'password');

    expect(session.saveToken).toHaveBeenCalledWith('jwt-123');
    expect(result.user.email).toBe('a@b.fr');
  });

  it('échoue explicitement quand la réponse ne contient pas de jeton (2FA)', async () => {
    respondWith(200, { twoFactorRedirect: true });

    await expect(signIn('a@b.fr', 'password')).rejects.toThrow(ApiError);
    expect(session.saveToken).not.toHaveBeenCalled();
  });

  it('remonte une ApiError typée sur identifiants invalides', async () => {
    respondWith(401, { message: 'Invalid email or password' });

    await expect(signIn('a@b.fr', 'wrong')).rejects.toMatchObject({ status: 401 });
  });
});

describe('intercepteur de réponse', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    session.getToken.mockResolvedValue('jwt-expire');
  });

  it('purge le jeton quand la session est refusée (401)', async () => {
    respondWith(401, { message: 'Unauthorized' });

    await expect(apiClient.get('/api/whatever')).rejects.toThrow(ApiError);
    expect(session.clearToken).toHaveBeenCalled();
  });

  it('conserve le jeton sur une erreur métier (400)', async () => {
    respondWith(400, { status: 400, error: [{ field: 'quantite', message: 'Invalide' }] });

    await expect(apiClient.get('/api/whatever')).rejects.toThrow(ApiError);
    expect(session.clearToken).not.toHaveBeenCalled();
  });

  it('joint le jeton en Bearer sur chaque requête authentifiée', async () => {
    respondWith(200, {});

    const response = await apiClient.get('/api/whatever');

    expect(response.config.headers.Authorization).toBe('Bearer jwt-expire');
  });
});

describe('signOut', () => {
  beforeEach(() => jest.clearAllMocks());

  it('efface le jeton même si l’API est injoignable', async () => {
    session.getToken.mockResolvedValue('jwt-123');
    apiClient.defaults.adapter = async () => {
      throw new AxiosError('Network Error');
    };

    await expect(signOut()).resolves.toBeUndefined();
    expect(session.clearToken).toHaveBeenCalled();
  });
});

describe('isAuthenticated', () => {
  beforeEach(() => jest.clearAllMocks());

  it('est vrai quand un jeton est stocké', async () => {
    session.getToken.mockResolvedValue('jwt-123');

    await expect(isAuthenticated()).resolves.toBe(true);
  });

  it('est faux sans jeton', async () => {
    session.getToken.mockResolvedValue(null);

    await expect(isAuthenticated()).resolves.toBe(false);
  });
});
