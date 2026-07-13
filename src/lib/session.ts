import * as SecureStore from 'expo-secure-store';

const AUTH_TOKEN_KEY = 'auth_token';
const USER_ID_KEY = 'auth_user_id';

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

/**
 * L'identité de l'opérateur, mémorisée dès la connexion — car un scan se saisit hors réseau, où
 * `/api/me` est injoignable. C'est elle qui rattache chaque opération de la file à son auteur :
 * sans elle, la file appartiendrait au téléphone, et les scans du premier opérateur partiraient
 * sous le jeton du suivant.
 */
export async function saveUserId(userId: string): Promise<void> {
  await SecureStore.setItemAsync(USER_ID_KEY, userId);
}

export async function getUserId(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(USER_ID_KEY);
  } catch {
    return null;
  }
}

export async function clearUserId(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(USER_ID_KEY);
  } catch {
    // Idem : un coffre inaccessible signifie déjà « personne n'est identifié ».
  }
}
