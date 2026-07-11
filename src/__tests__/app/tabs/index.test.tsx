import { render, screen, waitFor } from '@testing-library/react-native';

import { useCurrentUser } from '@/hooks/use-current-user';
import { useOnlineStatus } from '@/hooks/use-online-status';
import { loadActiveColdAlerts } from '@/lib/alerts';
import { countByStatus } from '@/lib/sync/queue';

import HomeScreen from '@/app/(tabs)/index';

jest.mock('@/hooks/use-current-user');
jest.mock('@/hooks/use-online-status');
jest.mock('@/lib/alerts');
jest.mock('@/lib/sync/queue');
jest.mock('expo-router', () => ({
  router: { navigate: jest.fn() },
  useFocusEffect: (effect: () => void) => effect(),
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0 }) }));

const mockedUser = jest.mocked(useCurrentUser);
const mockedOnline = jest.mocked(useOnlineStatus);
const mockedAlerts = jest.mocked(loadActiveColdAlerts);
const mockedCounts = jest.mocked(countByStatus);

function counts(overrides: Partial<Record<'PENDING' | 'SYNCED' | 'CONFLICT' | 'REJECTED', number>> = {}) {
  mockedCounts.mockResolvedValue({ PENDING: 0, SYNCED: 0, CONFLICT: 0, REJECTED: 0, ...overrides });
}

describe('écran d’accueil', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedUser.mockReturnValue({ user: null, loading: false });
    mockedOnline.mockReturnValue(true);
    mockedAlerts.mockResolvedValue([]);
    counts();
  });

  it('annonce l’état réseau réel', async () => {
    // Le badge était codé en dur : hors réseau, l'app affichait quand même « En ligne »,
    // et l'opérateur croyait ses scans partis alors qu'ils dormaient en file.
    mockedOnline.mockReturnValue(false);

    render(<HomeScreen />);

    await waitFor(() => expect(screen.getByText('Hors ligne')).toBeTruthy());
    expect(screen.queryByText('En ligne')).toBeNull();
  });

  it('affiche le nombre de scans en attente d’envoi', async () => {
    counts({ PENDING: 7 });

    render(<HomeScreen />);

    await waitFor(() => expect(screen.getByText('7')).toBeTruthy());
    expect(screen.getByText('EN ATTENTE SYNC')).toBeTruthy();
  });

  it('regroupe les scans bloqués sous « à corriger »', async () => {
    // Conflits et rejets demandent tous deux une décision humaine : les compter séparément
    // laisserait croire à l'opérateur qu'il n'a rien à faire.
    counts({ CONFLICT: 2, REJECTED: 3 });

    render(<HomeScreen />);

    await waitFor(() => expect(screen.getByText('À CORRIGER')).toBeTruthy());
    expect(screen.getByText('5')).toBeTruthy();
  });

  it('affiche l’alerte chaîne du froid en cours', async () => {
    mockedAlerts.mockResolvedValue([
      { id: '1', type: 'TEMP_EXCURSION', statut: 'ACTIVE', message: 'Palette SSCC 00376 — +4.2 °C' },
    ]);

    render(<HomeScreen />);

    await waitFor(() => expect(screen.getByText(/Palette SSCC 00376/)).toBeTruthy());
  });

  it('reste affiché quand la base locale est en erreur', async () => {
    // Un échec SQLite ne doit pas faire tomber l'accueil : l'opérateur garde son écran.
    mockedCounts.mockRejectedValue(new Error('base corrompue'));

    render(<HomeScreen />);

    await waitFor(() => expect(screen.getByText('Scanner un lot')).toBeTruthy());
  });
});
