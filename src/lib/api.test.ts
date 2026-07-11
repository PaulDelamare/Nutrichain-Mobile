import { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios';
import { router } from 'expo-router';

import { apiClient, isAuthenticated, signIn, signOut } from './api';
import { ApiError, getErrorMessage } from './errors';
import { clearToken, getToken, saveToken } from './session';

jest.mock('./session');
jest.mock('expo-router', () => ({ router: { replace: jest.fn() } }));

const session = jest.mocked({ clearToken, getToken, saveToken });
const mockedRouter = jest.mocked(router);

/** Court-circuite la couche réseau : l'adaptateur est le seul point d'entrée d'axios, les intercepteurs restent réels. */
function respondWith(status: number, data: unknown): { lastConfig: () => InternalAxiosRequestConfig } {
  let seen: InternalAxiosRequestConfig | undefined;

  const adapter: AxiosAdapter = async (config) => {
    seen = config;
    const response = { data, status, statusText: '', headers: {}, config };
    if (status >= 400) {
      const error = new AxiosError('Request failed', undefined, config, null, response);
      error.response = response;
      throw error;
    }
    return response;
  };
  apiClient.defaults.adapter = adapter;

  return {
    lastConfig: () => {
      if (!seen) throw new Error('Aucune requête émise');
      return seen;
    },
  };
}

describe('configuration du client', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    session.getToken.mockResolvedValue(null);
  });

  it('cible l’API configurée avec un délai d’attente borné', () => {
    // Un appel sans timeout reste pendant indéfiniment sur le réseau dégradé d'un entrepôt.
    expect(apiClient.defaults.baseURL).toBe(
      process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000'
    );
    expect(apiClient.defaults.timeout).toBe(10000);
  });

  it('envoie la clé API sur les routes d’authentification, qui l’exigent', async () => {
    const request = respondWith(200, {});

    await apiClient.post('/api/auth/sign-out');

    expect(request.lastConfig().headers['x-api-key']).toBe(process.env.EXPO_PUBLIC_API_KEY ?? '');
  });

  it('n’envoie JAMAIS la clé API sur les routes métier', async () => {
    // `mixedAuth` bascule en mode machine-à-machine à la simple vue de ce header : il
    // ignorerait le Bearer, refuserait la sync (400, actorUserId manquant) et servirait
    // les données de l'organisation de la clé, pas celle de l'utilisateur connecté.
    const request = respondWith(200, {});

    await apiClient.post('/api/sync/scans', { items: [] });

    expect(request.lastConfig().headers['x-api-key']).toBeUndefined();
  });
});

describe('signIn', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    session.getToken.mockResolvedValue(null);
  });

  it('appelle l’endpoint de connexion de l’API et stocke le jeton', async () => {
    const request = respondWith(200, { token: 'jwt-123' });

    await signIn('a@b.fr', 'password');

    expect(request.lastConfig().url).toBe('/api/auth/sign-in/email');
    expect(request.lastConfig().method).toBe('post');
    expect(session.saveToken).toHaveBeenCalledWith('jwt-123');
  });

  it('échoue explicitement quand la réponse ne contient pas de jeton (2FA)', async () => {
    respondWith(200, { twoFactorRedirect: true });

    await expect(signIn('a@b.fr', 'password')).rejects.toMatchObject({ field: 'two_factor' });
    expect(session.saveToken).not.toHaveBeenCalled();
  });

  it('annonce la 2FA sans la confondre avec un mot de passe erroné', async () => {
    respondWith(200, { twoFactorRedirect: true });

    const error = await signIn('a@b.fr', 'password').catch((e: unknown) => e);

    expect(getErrorMessage(error)).toContain('Double authentification');
    expect(getErrorMessage(error)).not.toContain('mot de passe');
  });

  it('remonte une ApiError typée sur identifiants invalides', async () => {
    respondWith(401, { message: 'Invalid email or password' });

    await expect(signIn('a@b.fr', 'wrong')).rejects.toMatchObject({ status: 401 });
  });
});

describe('intercepteur de requête', () => {
  beforeEach(() => jest.clearAllMocks());

  it('joint le jeton en Bearer quand une session existe', async () => {
    session.getToken.mockResolvedValue('jwt-123');
    const request = respondWith(200, {});

    await apiClient.get('/api/whatever');

    expect(request.lastConfig().headers.Authorization).toBe('Bearer jwt-123');
  });

  it('n’envoie aucun en-tête Authorization sans session', async () => {
    session.getToken.mockResolvedValue(null);
    const request = respondWith(200, {});

    await apiClient.get('/api/whatever');

    expect(request.lastConfig().headers.Authorization).toBeUndefined();
  });
});

describe('intercepteur de réponse', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    session.getToken.mockResolvedValue('jwt-expire');
  });

  it('purge le jeton et renvoie à la connexion quand la session est refusée (401)', async () => {
    respondWith(401, { message: 'Unauthorized' });

    await expect(apiClient.get('/api/whatever')).rejects.toThrow(ApiError);
    expect(session.clearToken).toHaveBeenCalled();
    expect(mockedRouter.replace).toHaveBeenCalledWith('/login');
  });

  it('conserve la session quand c’est la clé API qui est refusée', async () => {
    // Sinon une clé absente ou tournée détruirait un jeton valide, sans retour possible.
    respondWith(401, {
      status: 401,
      error: [{ field: 'api_key', message: 'Clé API invalide ou manquante.' }],
    });

    await expect(apiClient.get('/api/whatever')).rejects.toThrow(ApiError);
    expect(session.clearToken).not.toHaveBeenCalled();
    expect(mockedRouter.replace).not.toHaveBeenCalled();
  });

  it('conserve la session sur un refus de droits (403)', async () => {
    respondWith(403, { status: 403, error: [{ field: 'role', message: 'Rôle insuffisant.' }] });

    await expect(apiClient.get('/api/whatever')).rejects.toThrow(ApiError);
    expect(session.clearToken).not.toHaveBeenCalled();
  });

  it('conserve la session sur une erreur métier (400)', async () => {
    respondWith(400, { status: 400, error: [{ field: 'quantite', message: 'Invalide' }] });

    await expect(apiClient.get('/api/whatever')).rejects.toThrow(ApiError);
    expect(session.clearToken).not.toHaveBeenCalled();
  });

  it('ne renvoie pas à la connexion sur un 401 de login (aucune session à perdre)', async () => {
    session.getToken.mockResolvedValue(null);
    respondWith(401, { message: 'Invalid email or password' });

    await expect(apiClient.get('/api/whatever')).rejects.toThrow(ApiError);
    expect(mockedRouter.replace).not.toHaveBeenCalled();
  });
});

describe('signOut', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    session.getToken.mockResolvedValue('jwt-123');
  });

  it('révoque la session côté serveur puis efface le jeton', async () => {
    const request = respondWith(200, {});

    await signOut();

    expect(request.lastConfig().url).toBe('/api/auth/sign-out');
    expect(session.clearToken).toHaveBeenCalled();
  });

  it('efface le jeton même si l’API est injoignable', async () => {
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
