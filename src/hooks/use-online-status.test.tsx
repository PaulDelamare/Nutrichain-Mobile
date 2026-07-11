import { renderHook, waitFor, act } from '@testing-library/react-native';
import * as Network from 'expo-network';

import { useOnlineStatus } from './use-online-status';

jest.mock('expo-network');

const network = jest.mocked(Network);

type Listener = (state: { isInternetReachable?: boolean | null }) => void;

describe('useOnlineStatus', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    network.addNetworkStateListener.mockReturnValue({ remove: jest.fn() } as never);
  });

  it('reflète l’absence de réseau', async () => {
    // L'accueil affichait « En ligne » en dur : l'opérateur croyait ses scans partis.
    network.getNetworkStateAsync.mockResolvedValue({ isInternetReachable: false } as never);

    const { result } = renderHook(() => useOnlineStatus());

    await waitFor(() => expect(result.current).toBe(false));
  });

  it('suit les changements d’état du réseau', async () => {
    network.getNetworkStateAsync.mockResolvedValue({ isInternetReachable: false } as never);

    const { result } = renderHook(() => useOnlineStatus());
    await waitFor(() => expect(result.current).toBe(false));

    const [call] = network.addNetworkStateListener.mock.calls;
    act(() => (call[0] as unknown as Listener)({ isInternetReachable: true }));

    await waitFor(() => expect(result.current).toBe(true));
  });
});
