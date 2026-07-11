import axios, { AxiosError } from 'axios';
import { router } from 'expo-router';

import { ApiError, toApiError } from './errors';
import { clearToken, getToken, saveToken } from './session';

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';
const API_KEY = process.env.EXPO_PUBLIC_API_KEY ?? '';

export const apiClient = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
    // Exigé par l'API sur /api/auth/* (checkApiKey) : simple portail, jamais un secret.
    'x-api-key': API_KEY,
  },
  timeout: 10000,
});

apiClient.interceptors.request.use(async (config) => {
  const token = await getToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
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
      const hadSession = (await getToken()) !== null;
      await clearToken();

      // Sans cette redirection, la session expirée laisse l'utilisateur sur des écrans
      // vides : la garde de navigation ne se réévalue qu'au montage.
      if (hadSession) {
        router.replace('/login');
      }
    }

    throw apiError;
  }
);

export async function signIn(email: string, password: string): Promise<void> {
  const { data } = await apiClient.post<{ token?: string }>('/api/auth/sign-in/email', {
    email,
    password,
  });

  // Better-Auth omet le jeton quand un second facteur est requis : sans ce garde-fou,
  // l'app se croirait connectée et enchaînerait des 401 sur chaque écran.
  if (!data.token) {
    throw new ApiError(
      'Double authentification non prise en charge par l’application.',
      401,
      'two_factor'
    );
  }

  await saveToken(data.token);
}

export async function signOut(): Promise<void> {
  try {
    await apiClient.post('/api/auth/sign-out');
  } catch {
    // Déconnexion locale garantie même hors réseau : le jeton est effacé dans tous les cas.
  } finally {
    await clearToken();
  }
}

export async function isAuthenticated(): Promise<boolean> {
  return (await getToken()) !== null;
}
