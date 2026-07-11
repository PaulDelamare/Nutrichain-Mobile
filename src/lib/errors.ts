import { AxiosError } from 'axios';

/** Statut 0 = aucune réponse du serveur (réseau coupé, DNS, timeout). */
export const NETWORK_ERROR_STATUS = 0;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly field?: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Erreurs Express de l'API : { status, error: [{ field, message }] }. */
interface ExpressErrorBody {
  error?: { field: string; message: string }[];
}

/** Erreurs Better-Auth : { message, code }. */
interface BetterAuthErrorBody {
  message?: string;
}

type ApiErrorBody = ExpressErrorBody & BetterAuthErrorBody;

export function toApiError(error: AxiosError): ApiError {
  if (!error.response) {
    return new ApiError('Erreur réseau', NETWORK_ERROR_STATUS);
  }

  const { status } = error.response;
  const data = error.response.data as ApiErrorBody | undefined;
  const [firstError] = data?.error ?? [];

  if (firstError) {
    return new ApiError(firstError.message, status, firstError.field);
  }

  return new ApiError(data?.message ?? error.message, status);
}

/** Traduit une erreur technique en message affichable par un opérateur terrain. */
export function getErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) {
    return 'Une erreur est survenue.';
  }

  // La clé API est une erreur de configuration de l'app, pas une faute de l'utilisateur :
  // l'annoncer comme « mot de passe incorrect » enverrait l'opérateur sur une fausse piste.
  if (error.field === 'api_key') {
    return "Configuration invalide : clé API refusée par le serveur. Contactez l'administrateur.";
  }

  if (error.status === NETWORK_ERROR_STATUS) {
    return 'Serveur injoignable. Vérifiez votre connexion.';
  }

  if (error.status === 401) {
    return 'Email ou mot de passe incorrect.';
  }

  if (error.status === 403) {
    return "Accès refusé. Votre compte n'a pas les droits nécessaires.";
  }

  if (error.status === 429) {
    return 'Trop de tentatives. Réessayez dans quelques minutes.';
  }

  if (error.status >= 500) {
    return 'Erreur serveur. Réessayez dans quelques instants.';
  }

  return error.message;
}
