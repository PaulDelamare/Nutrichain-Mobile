import * as SecureStore from 'expo-secure-store';

import { clearToken, getToken, saveToken } from './session';

jest.mock('expo-secure-store');

const secureStore = jest.mocked(SecureStore);

describe('session', () => {
  beforeEach(() => jest.clearAllMocks());

  it('stocke le jeton dans le coffre chiffré du système', async () => {
    await saveToken('jwt-123');

    expect(secureStore.setItemAsync).toHaveBeenCalledWith('auth_token', 'jwt-123');
  });

  it('relit le jeton stocké', async () => {
    secureStore.getItemAsync.mockResolvedValue('jwt-123');

    await expect(getToken()).resolves.toBe('jwt-123');
  });

  it('retourne null quand aucun jeton n’est stocké', async () => {
    secureStore.getItemAsync.mockResolvedValue(null);

    await expect(getToken()).resolves.toBeNull();
  });

  it('efface le jeton', async () => {
    await clearToken();

    expect(secureStore.deleteItemAsync).toHaveBeenCalledWith('auth_token');
  });

  it('dégrade en « déconnecté » si le coffre est inaccessible', async () => {
    // Une promesse rompue ici figerait l'app sur son écran de chargement.
    secureStore.getItemAsync.mockRejectedValue(new Error('Keystore indisponible'));

    await expect(getToken()).resolves.toBeNull();
  });

  it('n’échoue pas quand l’effacement est impossible', async () => {
    secureStore.deleteItemAsync.mockRejectedValue(new Error('Keystore indisponible'));

    await expect(clearToken()).resolves.toBeUndefined();
  });
});
