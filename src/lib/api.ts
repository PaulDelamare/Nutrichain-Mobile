import axios, { AxiosError } from 'axios';
import { router } from 'expo-router';

import { clearCache } from './cache';
import { ApiError, toApiError } from './errors';
import { clearToken, clearUserId, getToken, getUserId, saveToken, saveUserId } from './session';

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';
const API_KEY = process.env.EXPO_PUBLIC_API_KEY ?? '';

// `create` sur l'export par défaut d'axios, et non l'export nommé du même nom : c'est l'usage
// documenté, et le seul qui construise une instance isolée. La règle ne sait pas les distinguer.
// eslint-disable-next-line import/no-named-as-default-member
export const apiClient = axios.create({
  baseURL: API_URL,
  headers: { 'Content-Type': 'application/json' },
  // Une transformation à six lots enchaîne, dans UNE transaction, autant de contrôles de stock,
  // de mouvements, de maillons d'audit et un événement EPCIS. Abandonner à 10 s ferait croire à
  // un échec une opération que le serveur a commitée — et l'opérateur la resaisirait.
  timeout: 30000,
});

apiClient.interceptors.request.use(async (config) => {
  // Un appelant peut poser lui-même le jeton — c'est le cas de la synchronisation, qui épingle
  // l'identité ET la crédential de l'opérateur pour toute la durée de l'envoi. L'écraser ici
  // rouvrirait la course : les scans lus au nom de A repartiraient avec le jeton de B.
  if (!config.headers.Authorization) {
    const token = await getToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }

  // La clé API n'est exigée que par /api/auth/* (checkApiKey). L'envoyer partout serait
  // pire qu'inutile : `mixedAuth` bascule en mode machine-à-machine dès qu'il voit ce
  // header, ignore le Bearer, réclame un actorUserId qu'on n'envoie pas (400 sur tout
  // le lot de sync) et borne l'organisation à celle de la clé — les écrans afficheraient
  // les données d'une autre organisation que celle de l'utilisateur connecté.
  if (config.url?.startsWith('/api/auth/')) {
    config.headers['x-api-key'] = API_KEY;
  }

  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const apiError = toApiError(error);

    // Un 401 « api_key » accuse la configuration de l'app, pas la session : purger le jeton
    // ici détruirait une session parfaitement valide, sans espoir de retour.
    if (apiError.status === 401 && apiError.field !== 'api_key') {
      const currentToken = await getToken();
      const rejectedToken = error.config?.headers?.Authorization;

      // Le refus ne concerne que le porteur du jeton refusé. Une requête partie AVANT une
      // déconnexion peut revenir en 401 longtemps après : sans cette comparaison, elle éjecterait
      // vers l'écran de connexion l'opérateur SUIVANT, en pleine saisie — pour une session qui
      // n'était même pas la sienne.
      const concernsCurrentSession =
        currentToken !== null && rejectedToken === `Bearer ${currentToken}`;

      if (!concernsCurrentSession) {
        throw apiError;
      }

      // Une session expirée efface TOUTE l'identité, pas seulement le jeton : le laisser derrière
      // ferait repartir l'opérateur suivant avec l'identité du précédent — la falsification qu'on
      // corrige, persistée en coffre.
      //
      // Le catalogue, lui, RESTE. Le purger ici détruirait, en pleine saisie, les fournisseurs et
      // produits dont l'écran de réception a besoin — sur un simple rafraîchissement de fond qui
      // prend un 401. Il est purgé à la connexion, quand on sait enfin QUI arrive.
      await clearToken();
      await clearUserId();

      // Sans cette redirection, la session expirée laisse l'utilisateur sur des écrans
      // vides : la garde de navigation ne se réévalue qu'au montage.
      router.replace('/login');
    }

    throw apiError;
  }
);

/**
 * Efface la session LOCALE, sans toucher au réseau. Le jeton et l'identité partent ensemble : un
 * jeton sans identité, ou une identité sans jeton, sont des états à demi connectés — et c'est
 * exactement dans ces états que les scans d'un opérateur repartent sous l'identité d'un autre.
 *
 * La FILE reste : la vider détruirait des réceptions saisies hors réseau, que personne ne peut
 * ressaisir. Elles attendent leur auteur.
 */
async function clearSession(): Promise<void> {
  await clearToken();
  await clearUserId();
}

export async function signIn(email: string, password: string): Promise<void> {
  const { data } = await apiClient.post<{ token?: string; user?: { id: string } }>(
    '/api/auth/sign-in/email',
    { email, password }
  );

  // Better-Auth omet le jeton quand un second facteur est requis : sans ce garde-fou,
  // l'app se croirait connectée et enchaînerait des 401 sur chaque écran.
  if (!data.token || !data.user?.id) {
    throw new ApiError(
      'Double authentification non prise en charge par l’application.',
      401,
      'two_factor'
    );
  }

  // Le catalogue en cache est celui de l'organisation du PRÉCÉDENT connecté. On le purge ici,
  // au moment où l'on sait enfin qui arrive — et non dès qu'une requête est refusée, ce qui
  // détruirait les fournisseurs et produits sous les doigts d'un opérateur en pleine saisie.
  await clearCache();

  // L'identité s'écrit AVANT le jeton, et le jeton est retiré si elle échoue : c'est le jeton qui
  // autorise l'envoi, l'identité qui désigne le propriétaire des scans. Dans l'autre ordre, un
  // coffre défaillant laisserait un jeton neuf cohabiter avec l'identité de l'opérateur précédent.
  await saveUserId(data.user.id);

  try {
    await saveToken(data.token);
  } catch (error) {
    await clearUserId();
    throw error;
  }
}

export async function signOut(): Promise<void> {
  try {
    await apiClient.post('/api/auth/sign-out');
  } catch {
    // Déconnexion locale garantie même hors réseau : la session est effacée dans tous les cas.
  } finally {
    await clearSession();
    // Le catalogue appartient à une organisation : le laisser le montrerait, hors réseau, à
    // l'opérateur suivant. Aucune perte, il se recharge à la connexion.
    await clearCache();
  }
}

/**
 * Un jeton sans identité, c'est une session ouverte avant que la file ait un propriétaire (mise à
 * jour de l'app sur un téléphone déjà connecté). L'app s'ouvrirait normalement, mais l'opérateur
 * ne pourrait plus enregistrer un seul scan et ne verrait plus sa propre file — sans rien
 * comprendre. On le renvoie à la connexion : c'est le seul geste qui rétablit son identité.
 *
 * La réparation est PUREMENT LOCALE : appeler `signOut` ferait un aller-retour réseau au montage
 * de l'app et clouerait dix secondes sur le spinner un téléphone hors réseau — c'est-à-dire le
 * cas nominal de cette application. La session serveur, elle, expirera d'elle-même.
 */
export async function isAuthenticated(): Promise<boolean> {
  if (!(await getToken())) {
    return false;
  }

  if (!(await getUserId())) {
    await clearSession();
    return false;
  }

  return true;
}
