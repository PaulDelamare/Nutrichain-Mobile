import { renderHook, waitFor } from '@testing-library/react-native';
import * as Network from 'expo-network';

import { apiClient } from '@/lib/api';
import { useOnlineStatus } from './use-online-status';

jest.mock('@/lib/api', () => ({ apiClient: { get: jest.fn() } }));
jest.mock('expo-network', () => ({
  addNetworkStateListener: jest.fn(() => ({ remove: jest.fn() })),
  getNetworkStateAsync: jest.fn(),
}));

const mockedGet = jest.mocked(apiClient.get);
const mockedListener = jest.mocked(Network.addNetworkStateListener);

beforeEach(() => {
  jest.clearAllMocks();
  mockedListener.mockReturnValue({ remove: jest.fn() } as never);
});

describe('useOnlineStatus', () => {
  it('ne dit rien tant qu’il n’a pas de réponse : « checking », pas « online »', () => {
    mockedGet.mockReturnValue(new Promise(() => undefined) as never);

    const { result } = renderHook(() => useOnlineStatus());

    // Le hook démarrait à `true` : il affirmait être en ligne avant d'avoir rien demandé.
    expect(result.current).toBe('checking');
  });

  it('est « online » quand le SERVEUR répond', async () => {
    mockedGet.mockResolvedValue({ data: {} } as never);

    const { result } = renderHook(() => useOnlineStatus());

    await waitFor(() => expect(result.current).toBe('online'));
    expect(mockedGet).toHaveBeenCalledWith('/api/health', expect.objectContaining({ timeout: 5000 }));
  });

  it('est « offline » quand le serveur ne répond pas — même si l’interface se dit connectée', async () => {
    // ⚠️ LE bug. Sur le web, `expo-network` s'appuie sur `navigator.onLine`, qui vaut `true` sur un
    // Wi-Fi sans Internet, derrière un portail captif ou face à une API éteinte. Le badge annonçait
    // « En ligne » à un opérateur dont rien ne partait. On ne le croit plus sur parole.
    mockedGet.mockRejectedValue(new Error('Network Error'));

    const { result } = renderHook(() => useOnlineStatus());

    await waitFor(() => expect(result.current).toBe('offline'));
  });

  it('re-interroge le serveur quand l’interface réseau change', async () => {
    mockedGet.mockRejectedValueOnce(new Error('Network Error')).mockResolvedValue({ data: {} } as never);

    const { result } = renderHook(() => useOnlineStatus());
    await waitFor(() => expect(result.current).toBe('offline'));

    // L'état de l'interface reste un bon DÉCLENCHEUR — simplement, il ne fait pas foi.
    const notify = mockedListener.mock.calls[0]![0];
    notify({ isInternetReachable: true } as never);

    await waitFor(() => expect(result.current).toBe('online'));
  });
});
