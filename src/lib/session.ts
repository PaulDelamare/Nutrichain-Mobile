import * as SecureStore from 'expo-secure-store';

const AUTH_TOKEN_KEY = 'auth_token';

/** Coffre chiffré du système (Keychain iOS / Keystore Android) : le jeton ne transite jamais en clair sur disque. */
export async function saveToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(AUTH_TOKEN_KEY, token);
}

export async function getToken(): Promise<string | null> {
  return SecureStore.getItemAsync(AUTH_TOKEN_KEY);
}

export async function clearToken(): Promise<void> {
  await SecureStore.deleteItemAsync(AUTH_TOKEN_KEY);
}
