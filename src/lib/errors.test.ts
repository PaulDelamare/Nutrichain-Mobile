import { AxiosError } from 'axios';

import { ApiError, getErrorMessage, toApiError } from './errors';

function axiosErrorWith(status: number, data: unknown): AxiosError {
  const error = new AxiosError('Request failed');
  error.response = { status, data } as AxiosError['response'];
  return error;
}

describe('toApiError', () => {
  it("extrait le champ et le message du format Express { error: [{ field, message }] }", () => {
    const error = toApiError(
      axiosErrorWith(401, {
        status: 401,
        error: [{ field: 'api_key', message: 'Non authentifié. Clé API invalide ou manquante.' }],
      })
    );

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(401);
    expect(error.field).toBe('api_key');
    expect(error.message).toBe('Non authentifié. Clé API invalide ou manquante.');
  });

  it('extrait le message du format Better-Auth { message }', () => {
    const error = toApiError(axiosErrorWith(401, { message: 'Invalid email or password' }));

    expect(error.status).toBe(401);
    expect(error.field).toBeUndefined();
    expect(error.message).toBe('Invalid email or password');
  });

  it('signale une absence de réponse serveur par le statut 0', () => {
    const error = toApiError(new AxiosError('Network Error'));

    expect(error.status).toBe(0);
  });
});

describe('getErrorMessage', () => {
  it('distingue la clé API invalide des identifiants incorrects', () => {
    const apiKeyError = new ApiError('Clé API invalide', 401, 'api_key');

    expect(getErrorMessage(apiKeyError)).toContain('clé API');
    expect(getErrorMessage(apiKeyError)).not.toContain('mot de passe');
  });

  it('traduit un 401 sans champ en erreur d’identifiants', () => {
    expect(getErrorMessage(new ApiError('Invalid credentials', 401))).toBe(
      'Email ou mot de passe incorrect.'
    );
  });

  it('traduit une absence de réseau', () => {
    expect(getErrorMessage(new ApiError('Erreur réseau', 0))).toContain('connexion');
  });

  it('traduit un 429 en invitation à patienter', () => {
    expect(getErrorMessage(new ApiError('Too many requests', 429))).toContain('tentatives');
  });

  it('masque les détails techniques des erreurs serveur', () => {
    expect(getErrorMessage(new ApiError('connect ECONNREFUSED', 500))).toBe(
      'Erreur serveur. Réessayez dans quelques instants.'
    );
  });

  it('retombe sur un message générique pour une erreur inconnue', () => {
    expect(getErrorMessage(new Error('boom'))).toBe('Une erreur est survenue.');
  });
});
