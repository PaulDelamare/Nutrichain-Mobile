import { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios';
import { router } from 'expo-router';

import { apiClient, isAuthenticated, signIn, signOut, verifyTwoFactorTotp } from './api';
import { clearCache } from './cache';
import { ApiError, getErrorMessage } from './errors';
import { clearToken, clearUserId, getToken, getUserId, saveToken, saveUserId } from './session';

jest.mock('./session');
jest.mock('./cache');
jest.mock('expo-router', () => ({ router: { replace: jest.fn() } }));

const session = jest.mocked({
  clearToken,
  clearUserId,
  getToken,
  getUserId,
  saveToken,
  saveUserId,
});
const mockedClearCache = jest.mocked(clearCache);
const mockedRouter = jest.mocked(router);

/** Réponse Better-Auth d'une connexion réussie : un jeton, et QUI est connecté. */
const SIGN_IN_OK = { token: 'jwt-123', user: { id: 'user-1' } };

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
    // Mais trop court est pire : une transformation à six lots (contrôles de stock, mouvements,
    // maillons d'audit, événement EPCIS, le tout dans UNE transaction) peut dépasser 10 s, et
    // abandonner ferait croire à un échec une opération commitée — l'opérateur la ressaisirait.
    expect(apiClient.defaults.baseURL).toBe(
      process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000'
    );
    expect(apiClient.defaults.timeout).toBe(30000);
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
    const request = respondWith(200, SIGN_IN_OK);

    await signIn('a@b.fr', 'password');

    expect(request.lastConfig().url).toBe('/api/auth/sign-in/email');
    expect(request.lastConfig().method).toBe('post');
    expect(session.saveToken).toHaveBeenCalledWith('jwt-123');
  });

  it('écrit l’identité AVANT le jeton', async () => {
    // C'est le jeton qui autorise l'envoi, l'identité qui désigne le propriétaire des scans. Dans
    // l'autre ordre, un coffre défaillant laisserait un jeton NEUF cohabiter avec l'identité de
    // l'opérateur PRÉCÉDENT : ses scans repartiraient sous le nom du nouveau venu.
    respondWith(200, SIGN_IN_OK);

    await signIn('a@b.fr', 'password');

    const ordreIdentite = session.saveUserId.mock.invocationCallOrder[0];
    const ordreJeton = session.saveToken.mock.invocationCallOrder[0];
    expect(ordreIdentite).toBeLessThan(ordreJeton);
  });

  it('retire l’identité si le jeton ne peut pas être écrit', async () => {
    // Sans ce retour en arrière, on garderait une identité sans jeton : à la connexion suivante,
    // un autre opérateur hériterait de celle-ci.
    respondWith(200, SIGN_IN_OK);
    session.saveToken.mockRejectedValueOnce(new Error('coffre indisponible'));

    await expect(signIn('a@b.fr', 'password')).rejects.toThrow();
    expect(session.clearUserId).toHaveBeenCalled();
  });

  it('purge le catalogue de l’organisation précédente à la connexion', async () => {
    // Purgé ICI, quand on sait qui arrive — et surtout pas sur un 401, ce qui détruirait le
    // catalogue sous les doigts d'un opérateur en pleine saisie.
    respondWith(200, SIGN_IN_OK);

    await signIn('a@b.fr', 'password');

    expect(mockedClearCache).toHaveBeenCalled();
  });

  it('mémorise QUI est l’opérateur, dès la connexion', async () => {
    // Un scan se saisit hors réseau, là où l'on ne peut plus demander au serveur qui il est.
    // Sans cette identité gardée localement, la file appartiendrait au téléphone — et les scans
    // du premier opérateur repartiraient sous le jeton du suivant.
    respondWith(200, SIGN_IN_OK);

    await signIn('a@b.fr', 'password');

    expect(session.saveUserId).toHaveBeenCalledWith('user-1');
  });

  it('refuse une connexion dont l’API ne dit pas qui elle identifie', async () => {
    respondWith(200, { token: 'jwt-123' });

    await expect(signIn('a@b.fr', 'password')).rejects.toThrow();
    expect(session.saveToken).not.toHaveBeenCalled();
  });

  it('signale la 2FA requise sans la confondre avec un mot de passe erroné', async () => {
    respondWith(200, { twoFactorRedirect: true });

    const error = await signIn('a@b.fr', 'password').catch((e: unknown) => e);

    expect(error).toMatchObject({ field: 'two_factor_required' });
    expect(session.saveToken).not.toHaveBeenCalled();
    expect(getErrorMessage(error)).not.toContain('mot de passe');
  });

  it('remonte une ApiError typée sur identifiants invalides', async () => {
    respondWith(401, { message: 'Invalid email or password' });

    await expect(signIn('a@b.fr', 'wrong')).rejects.toMatchObject({ status: 401 });
  });
});

describe('verifyTwoFactorTotp', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    session.getToken.mockResolvedValue(null);
  });

  it('appelle le même point de terminaison que la connexion initiale (deux usages, un seul endpoint)', async () => {
    const request = respondWith(200, SIGN_IN_OK);

    await verifyTwoFactorTotp('123456');

    expect(request.lastConfig().url).toBe('/api/auth/two-factor/verify-totp');
    expect(request.lastConfig().data).toBe(JSON.stringify({ code: '123456' }));
  });

  it('complète la session comme un signIn réussi (identité puis jeton)', async () => {
    respondWith(200, SIGN_IN_OK);

    await verifyTwoFactorTotp('123456');

    expect(mockedClearCache).toHaveBeenCalled();
    expect(session.saveUserId).toHaveBeenCalledWith('user-1');
    expect(session.saveToken).toHaveBeenCalledWith('jwt-123');
    const ordreIdentite = session.saveUserId.mock.invocationCallOrder[0];
    const ordreJeton = session.saveToken.mock.invocationCallOrder[0];
    expect(ordreIdentite).toBeLessThan(ordreJeton);
  });

  it('remonte une ApiError typée sur un code invalide', async () => {
    respondWith(401, { message: 'Invalid code' });

    await expect(verifyTwoFactorTotp('000000')).rejects.toMatchObject({ status: 401 });
    expect(session.saveToken).not.toHaveBeenCalled();
  });

  it('envoie la clé API, comme toute route /api/auth/*', async () => {
    const request = respondWith(200, SIGN_IN_OK);

    await verifyTwoFactorTotp('123456');

    expect(request.lastConfig().headers['x-api-key']).toBe(process.env.EXPO_PUBLIC_API_KEY ?? '');
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

  it('n’écrase pas un jeton posé explicitement par l’appelant', async () => {
    // La synchronisation épingle l'identité ET le jeton de l'opérateur pour toute la durée de
    // l'envoi. Si l'intercepteur relisait le coffre à l'émission, une déconnexion suivie d'une
    // connexion entre les deux ferait partir les scans de A avec le jeton de B.
    session.getToken.mockResolvedValue('jeton-du-suivant');
    const request = respondWith(200, {});

    await apiClient.post('/api/sync/scans', {}, { headers: { Authorization: 'Bearer jeton-de-A' } });

    expect(request.lastConfig().headers.Authorization).toBe('Bearer jeton-de-A');
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

  it('purge AUSSI l’identité de l’opérateur sur un 401', async () => {
    // Ne purger que le jeton laisserait l'identité du précédent en coffre : l'opérateur suivant
    // se connecterait, obtiendrait son propre jeton, et repartirait avec l'identité de l'autre.
    respondWith(401, { message: 'Unauthorized' });

    await expect(apiClient.get('/api/whatever')).rejects.toThrow(ApiError);

    expect(session.clearUserId).toHaveBeenCalled();
  });

  it('n’éjecte pas l’opérateur suivant à cause d’un 401 tardif du précédent', async () => {
    // Une requête partie avant une déconnexion peut revenir en 401 longtemps après. Sans garde,
    // elle détruit la session de celui qui vient de se connecter — en pleine saisie, pour une
    // session qui n'était même pas la sienne.
    session.getToken.mockResolvedValue('jeton-du-suivant');
    respondWith(401, { message: 'Unauthorized' });

    await expect(
      apiClient.get('/api/whatever', { headers: { Authorization: 'Bearer jeton-du-precedent' } })
    ).rejects.toThrow(ApiError);

    expect(session.clearToken).not.toHaveBeenCalled();
    expect(mockedRouter.replace).not.toHaveBeenCalled();
  });

  it('ne détruit PAS le catalogue sur un 401', async () => {
    // Un rafraîchissement de fond qui prend un 401 effacerait, sinon, les fournisseurs et produits
    // dont l'écran de réception a besoin — en pleine saisie, et sans réseau pour les recharger.
    respondWith(401, { message: 'Unauthorized' });

    await expect(apiClient.get('/api/whatever')).rejects.toThrow(ApiError);

    expect(mockedClearCache).not.toHaveBeenCalled();
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

  it('efface aussi l’identité de l’opérateur et le catalogue de son organisation', async () => {
    // Le catalogue mis en cache est celui d'une organisation : le laisser en place le montrerait,
    // hors réseau, à l'opérateur suivant. Aucune perte — il se recharge à la connexion.
    respondWith(200, {});

    await signOut();

    expect(session.clearUserId).toHaveBeenCalled();
    expect(mockedClearCache).toHaveBeenCalled();
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
  beforeEach(() => {
    jest.clearAllMocks();
    session.getUserId.mockResolvedValue('user-1');
  });

  it('est vrai quand un jeton et une identité sont stockés', async () => {
    session.getToken.mockResolvedValue('jwt-123');

    await expect(isAuthenticated()).resolves.toBe(true);
  });

  it('est faux sans jeton', async () => {
    session.getToken.mockResolvedValue(null);

    await expect(isAuthenticated()).resolves.toBe(false);
  });

  it('renvoie à la connexion un jeton sans identité', async () => {
    // C'est l'état d'un téléphone DÉJÀ connecté au moment de la mise à jour : il a un jeton, mais
    // pas d'identité. L'app s'ouvrait normalement — puis refusait tous ses scans et lui cachait sa
    // propre file, en affirmant « tout est synchronisé ». Un mensonge, sans aucune issue.
    session.getToken.mockResolvedValue('jwt-123');
    session.getUserId.mockResolvedValue(null);

    await expect(isAuthenticated()).resolves.toBe(false);
    expect(session.clearToken).toHaveBeenCalled();
    expect(session.clearUserId).toHaveBeenCalled();
  });

  it('répare cet état SANS appeler le réseau', async () => {
    // `signOut` ferait un aller-retour HTTP au montage de l'app : dix secondes de spinner sur un
    // téléphone hors réseau — c'est-à-dire le cas nominal de cette application.
    session.getToken.mockResolvedValue('jwt-123');
    session.getUserId.mockResolvedValue(null);
    const request = respondWith(200, {});

    await isAuthenticated();

    expect(() => request.lastConfig()).toThrow(/Aucune requête/);
  });
});
