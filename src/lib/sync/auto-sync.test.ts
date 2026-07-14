import * as Network from 'expo-network';

import { loadServerTimeOffset, serverNow } from '../server-time';
import { startAutoSync } from './auto-sync';
import { flagStalePending, purgeSyncedBefore } from './queue';
import { syncPendingOperations } from './sync';

jest.mock('./sync');
jest.mock('./queue');
jest.mock('expo-network');
jest.mock('../server-time');
jest.mock('../toast', () => ({ toastError: jest.fn() }));

const mockedPurge = jest.mocked(purgeSyncedBefore);
const mockedFlagStale = jest.mocked(flagStalePending);
const mockedServerNow = jest.mocked(serverNow);
const mockedLoadOffset = jest.mocked(loadServerTimeOffset);
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
    mockedLoadOffset.mockResolvedValue(undefined);
    // Par défaut, l'heure du serveur est connue (l'app a déjà vu le serveur au moins une fois).
    mockedServerNow.mockReturnValue({ kind: 'ok', now: Date.now() });
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

  it('ne CONDAMNE ni n’EFFACE rien tant que l’heure du serveur est inconnue', async () => {
    // ⚠️ Ces deux opérations condamnent des scans et effacent leur historique sur la foi d'une date.
    // Les dater sur l'horloge du téléphone était un piège : un appareil déchargé démarre en retard,
    // se resynchronise ensuite, et des scans vieux de deux minutes basculaient en conflit avec le
    // motif « en attente depuis plus de 7 jours ». Un scan gardé un jour de trop est réparable ;
    // un scan condamné à tort ne l'est pas.
    mockedServerNow.mockReturnValue({ kind: 'unknown' });
    network.getNetworkStateAsync.mockResolvedValue({ isInternetReachable: true } as never);

    await startAutoSync();

    expect(mockedFlagStale).not.toHaveBeenCalled();
    expect(mockedPurge).not.toHaveBeenCalled();
    // La synchronisation, elle, a bien lieu : c'est le seul moyen d'apprendre l'heure du serveur.
    expect(mockedSync).toHaveBeenCalled();
  });

  it('date la rétention sur l’horloge du SERVEUR, pas sur celle du téléphone', async () => {
    // Le téléphone se croit deux mois dans le passé : sans cette correction, la purge et la mise en
    // conflit se feraient sur une date fausse.
    const serveur = Date.now() + 60 * 24 * 60 * 60 * 1000;
    mockedServerNow.mockReturnValue({ kind: 'ok', now: serveur });
    network.getNetworkStateAsync.mockResolvedValue({ isInternetReachable: false } as never);

    await startAutoSync();

    expect(mockedPurge).toHaveBeenCalledWith(serveur - SEVEN_DAYS_MS);
    expect(mockedFlagStale).toHaveBeenCalledWith(serveur - SEVEN_DAYS_MS, expect.any(String));
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
