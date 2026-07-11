import * as SecureStore from 'expo-secure-store';

const AUTH_TOKEN_KEY = 'auth_token';

/** Coffre chiffré du système (Keychain iOS / Keystore Android) : le jeton ne touche jamais le disque en clair. */
export async function saveToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(AUTH_TOKEN_KEY, token);
}

/**
 * Un coffre indisponible (clé invalidée, Keystore corrompu) doit dégrader vers « déconnecté »,
 * jamais rejeter : une promesse rompue ici fige l'app sur son écran de chargement.
 */
export async function getToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(AUTH_TOKEN_KEY);
  } catch {
    return null;
  }
}

export async function clearToken(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(AUTH_TOKEN_KEY);
  } catch {
    // Rien à effacer si le coffre est inaccessible : l'utilisateur est déjà de facto déconnecté.
  }
}
