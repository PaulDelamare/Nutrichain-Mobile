import { renderHook, waitFor } from '@testing-library/react-native';

import { apiClient, getAuthStatusSnapshot, signIn, signOut } from '@/lib/api';
import { getToken, getUserId } from '@/lib/session';

import { useAuthStatus } from './use-auth-status';

jest.mock('@/lib/session');
jest.mock('@/lib/cache');
jest.mock('expo-router', () => ({ router: { replace: jest.fn() } }));

const session = jest.mocked({ getToken, getUserId });

/** Réponse Better-Auth d'une connexion réussie : un jeton, et QUI est connecté. */
const SIGN_IN_OK = { token: 'jwt-123', user: { id: 'user-1' } };

beforeEach(() => {
  jest.clearAllMocks();
  session.getToken.mockResolvedValue('jwt-123');
  session.getUserId.mockResolvedValue('user-1');
  // Court-circuite le réseau sans toucher aux intercepteurs, qui portent la logique testée.
  apiClient.defaults.adapter = async (config) => ({
    data: SIGN_IN_OK,
    status: 200,
    statusText: 'OK',
    headers: {},
    config,
  });
});

describe('useAuthStatus', () => {
  /**
   * ⚠️ CE test doit rester le PREMIER du fichier : c'est le seul moment où le magasin de statut,
   * qui vit dans le module, n'a encore été écrit par personne. Les cas suivants se connectent ou se
   * déconnectent, donc ils ne peuvent plus observer l'état de démarrage.
   *
   * Il prouve le câblage : sans la lecture déclenchée au montage, le statut resterait
   * indéfiniment « chargement » — et la racine, qui ne monte pas le navigateur pendant ce
   * chargement, n'ouvrirait JAMAIS l'application, même pour un opérateur déjà connecté.
   */
  it('déclenche la lecture du coffre au montage et quitte l’état chargement', async () => {
    const { result } = renderHook(() => useAuthStatus());

    expect(result.current).toBe('loading');
    await waitFor(() => expect(result.current).toBe('authenticated'));
  });

  it('rend le statut courant de la session', async () => {
    await signIn('operator@nutrichain.local', 'NutriChain!2026');

    const { result } = renderHook(() => useAuthStatus());

    expect(result.current).toBe('authenticated');
    expect(result.current).toBe(getAuthStatusSnapshot());
  });

  /**
   * #105 — LE test qui manquait. Le statut n'était calculé qu'au MONTAGE, et `router.replace` ne
   * remonte pas la racine : après une connexion réussie, la garde de session renvoyait
   * indéfiniment à l'écran de connexion. Ici, RIEN ne remonte le hook — seule la session change.
   */
  it('suit une connexion survenue APRÈS le montage, sans remontage', async () => {
    await signOut();

    const { result } = renderHook(() => useAuthStatus());
    expect(result.current).toBe('unauthenticated');

    await signIn('operator@nutrichain.local', 'NutriChain!2026');

    await waitFor(() => expect(result.current).toBe('authenticated'));
  });

  it('suit aussi la déconnexion, sans remontage', async () => {
    await signIn('operator@nutrichain.local', 'NutriChain!2026');

    const { result } = renderHook(() => useAuthStatus());
    expect(result.current).toBe('authenticated');

    await signOut();

    await waitFor(() => expect(result.current).toBe('unauthenticated'));
  });

  /**
   * Y retourner démonterait le navigateur : la racine ne le monte pas pendant le chargement, donc
   * la pile de navigation et la saisie en cours seraient perdues.
   */
  it('ne revient JAMAIS à l’état chargement une fois le statut connu', async () => {
    await signIn('operator@nutrichain.local', 'NutriChain!2026');

    const { result } = renderHook(() => useAuthStatus());

    await waitFor(() => expect(result.current).toBe('authenticated'));
    expect(result.current).not.toBe('loading');
  });

  it('les deux gardes montées lisent le MÊME statut, au même instant', async () => {
    // La racine et `(tabs)` portent chacune ce hook. Deux statuts qui divergeraient laisseraient
    // un écran métier monté sans session.
    await signOut();

    const racine = renderHook(() => useAuthStatus());
    const onglets = renderHook(() => useAuthStatus());

    await signIn('operator@nutrichain.local', 'NutriChain!2026');

    await waitFor(() => expect(racine.result.current).toBe('authenticated'));
    expect(onglets.result.current).toBe(racine.result.current);
  });
});
