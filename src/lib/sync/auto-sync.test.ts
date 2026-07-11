import * as Network from 'expo-network';

import { startAutoSync } from './auto-sync';
import { flagStalePending, purgeSyncedBefore } from './queue';
import { syncPendingOperations } from './sync';

jest.mock('./sync');
jest.mock('./queue');
jest.mock('expo-network');

const mockedPurge = jest.mocked(purgeSyncedBefore);
const mockedFlagStale = jest.mocked(flagStalePending);
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

const network = jest.mocked(Network);
const mockedSync = jest.mocked(syncPendingOperations);

type Listener = (state: { isInternetReachable?: boolean | null }) => void;

function captureListener(): Listener {
  const [call] = network.addNetworkStateListener.mock.calls;
  return call[0] as unknown as Listener;
}

describe('startAutoSync', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    network.addNetworkStateListener.mockReturnValue({ remove: jest.fn() } as never);
    mockedSync.mockResolvedValue({ sent: 0, synced: 0, conflicts: 0, rejected: 0, retried: 0 });
    mockedPurge.mockResolvedValue(undefined);
    mockedFlagStale.mockResolvedValue(undefined);
  });

  it('purge l’historique synchronisé exactement au-delà de la rétention de l’API', async () => {
    // Une borne trop lâche (« au moins 7 jours ») validerait aussi une rétention de 700 jours,
    // c'est-à-dire une purge qui ne purge rien.
    network.getNetworkStateAsync.mockResolvedValue({ isInternetReachable: false } as never);

    await startAutoSync();

    const [cutoff] = mockedPurge.mock.calls[0];
    expect(Date.now() - cutoff).toBeGreaterThanOrEqual(SEVEN_DAYS_MS);
    expect(Date.now() - cutoff).toBeLessThan(SEVEN_DAYS_MS + 5_000);
  });

  it('signale les opérations périmées AVANT de tenter de les synchroniser', async () => {
    // Leur clé d'idempotence a expiré côté serveur : les rejouer pourrait créer un doublon.
    network.getNetworkStateAsync.mockResolvedValue({ isInternetReachable: true } as never);

    await startAutoSync();

    expect(mockedFlagStale).toHaveBeenCalled();
    expect(mockedFlagStale.mock.invocationCallOrder[0]).toBeLessThan(
      mockedSync.mock.invocationCallOrder[0]
    );
  });

  it('synchronise dès que le réseau redevient joignable', async () => {
    // La promesse faite à l'opérateur (« synchronisée dès que le réseau reviendra »)
    // n'est tenue que par ce déclencheur : sans lui, une zone blanche fige la file.
    network.getNetworkStateAsync.mockResolvedValue({ isInternetReachable: false } as never);
    await startAutoSync();
    mockedSync.mockClear();

    captureListener()({ isInternetReachable: true });

    expect(mockedSync).toHaveBeenCalledTimes(1);
  });

  it('ne synchronise pas sur une transition vers hors réseau', async () => {
    network.getNetworkStateAsync.mockResolvedValue({ isInternetReachable: true } as never);
    await startAutoSync();
    mockedSync.mockClear();

    captureListener()({ isInternetReachable: false });

    expect(mockedSync).not.toHaveBeenCalled();
  });

  it('ne relance rien tant que le réseau reste joignable', async () => {
    // Certaines plateformes réémettent l'état sans changement : réagir à chaque
    // notification martèlerait l'API.
    network.getNetworkStateAsync.mockResolvedValue({ isInternetReachable: true } as never);
    await startAutoSync();
    mockedSync.mockClear();

    captureListener()({ isInternetReachable: true });

    expect(mockedSync).not.toHaveBeenCalled();
  });

  it('synchronise au démarrage si le réseau est déjà là', async () => {
    // Une file laissée en attente lors de la fermeture de l'app doit repartir seule.
    network.getNetworkStateAsync.mockResolvedValue({ isInternetReachable: true } as never);

    await startAutoSync();

    expect(mockedSync).toHaveBeenCalledTimes(1);
  });
});
