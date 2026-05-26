import axios, { AxiosError } from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';
const API_KEY = process.env.EXPO_PUBLIC_API_KEY ?? '';
const AUTH_TOKEN_KEY = 'auth_token';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

interface ApiErrorResponse {
  message?: string;
  error?: string;
}

export const apiClient = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': API_KEY,
  },
  timeout: 10000,
});

apiClient.interceptors.request.use(async (config) => {
  const token = await AsyncStorage.getItem(AUTH_TOKEN_KEY);
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError<ApiErrorResponse>) => {
    if (!error.response) {
      return Promise.reject(new ApiError('Erreur réseau', 0));
    }
    const status = error.response.status;
    const message =
      error.response.data?.message ??
      error.response.data?.error ??
      error.message ??
      'Une erreur est survenue';
    return Promise.reject(new ApiError(message, status));
  }
);

export async function signIn(email: string, password: string) {
  const { data } = await apiClient.post('/api/auth/sign-in/email', { email, password });
  if (data.token) {
    await AsyncStorage.setItem(AUTH_TOKEN_KEY, data.token);
  }
  return data;
}

export async function signOut() {
  try {
    await apiClient.post('/api/auth/sign-out');
  } finally {
    await AsyncStorage.removeItem(AUTH_TOKEN_KEY);
  }
}

export async function getToken(): Promise<string | null> {
  return AsyncStorage.getItem(AUTH_TOKEN_KEY);
}

export async function isAuthenticated(): Promise<boolean> {
  const token = await getToken();
  return token !== null;
}
