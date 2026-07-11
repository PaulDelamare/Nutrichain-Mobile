const AUTH_TOKEN_KEY = 'auth_token';

/**
 * expo-secure-store n'a pas d'implémentation web (le module y est vide) : sans cette variante,
 * chaque lecture du jeton rejette et fige l'app sur son écran de chargement.
 * Le build web sert aux démonstrations, pas au terrain — localStorage y est acceptable.
 */
export async function saveToken(token: string): Promise<void> {
  localStorage.setItem(AUTH_TOKEN_KEY, token);
}

export async function getToken(): Promise<string | null> {
  return localStorage.getItem(AUTH_TOKEN_KEY);
}

export async function clearToken(): Promise<void> {
  localStorage.removeItem(AUTH_TOKEN_KEY);
}
