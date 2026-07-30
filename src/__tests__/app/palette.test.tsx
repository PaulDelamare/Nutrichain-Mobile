import { render, screen, waitFor } from '@testing-library/react-native';

import { loadPallet } from '@/lib/batches';
import { ApiError } from '@/lib/errors';

import PalletScreen from '@/app/palette/[sscc]';

jest.mock('@/lib/batches', () => ({ loadPallet: jest.fn() }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0 }),
}));
jest.mock('expo-router', () => ({
  router: { back: jest.fn() },
  useLocalSearchParams: () => ({ sscc: '034567890000000606' }),
}));

const mockedLoadPallet = jest.mocked(loadPallet);

const palette = (overrides: Record<string, unknown> = {}) => ({
  kind: 'ok' as const,
  pallet: {
    id: 'palette-1',
    sscc: '034567890000000606',
    contient_lot_rappele: false,
    lots: [
      {
        id: 'lot-1',
        numero_lot: '260729-AAAAAA',
        produit: 'Beurre doux',
        statut: 'EN_STOCK',
        quantite: 30,
        unite: 'kg',
      },
    ],
    ...overrides,
  },
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('Écran palette', () => {
  it('affiche le contenu de la palette scannée', async () => {
    mockedLoadPallet.mockResolvedValue(palette());

    render(<PalletScreen />);

    expect(await screen.findByText('Beurre doux')).toBeTruthy();
    expect(screen.getByText('260729-AAAAAA')).toBeTruthy();
    expect(screen.getByText('En stock')).toBeTruthy();
  });

  /**
   * Le rappel est la raison d'être de ce scan : un lot peut passer sous rappel APRÈS la
   * palettisation. Sans ce bandeau, l'opérateur charge la palette dans le camion.
   */
  it('avertit quand la palette porte un lot sous rappel', async () => {
    mockedLoadPallet.mockResolvedValue(
      palette({
        contient_lot_rappele: true,
        lots: [
          { id: 'lot-1', numero_lot: '260729-AAAAAA', produit: 'Beurre doux', statut: 'ALERTE' },
        ],
      })
    );

    render(<PalletScreen />);

    expect(await screen.findByText(/ne doit pas être expédiée/)).toBeTruthy();
    expect(screen.getByText('Sous rappel')).toBeTruthy();
  });

  /**
   * Hors réseau, afficher une palette vide la ferait passer pour une palette sans contenu — et
   * l'opérateur la traiterait comme telle. Ne pas savoir doit se dire, et se réessayer.
   */
  it('distingue « pas pu vérifier » d’une palette vide', async () => {
    mockedLoadPallet.mockResolvedValue({
      kind: 'unverifiable',
      error: new ApiError('Réseau indisponible', 0, 'network'),
    });

    render(<PalletScreen />);

    expect(await screen.findByText('Palette non vérifiée')).toBeTruthy();
    expect(screen.getByText('Réessayer')).toBeTruthy();
  });

  // Un SSCC fournisseur : réponse définitive, rien à réessayer, et l'écran oriente vers la
  // réception plutôt que de laisser l'opérateur devant un écran muet.
  it('annonce une palette inconnue sans proposer de réessayer', async () => {
    mockedLoadPallet.mockResolvedValue({ kind: 'unknown' });

    render(<PalletScreen />);

    expect(await screen.findByText('Palette inconnue')).toBeTruthy();
    expect(screen.queryByText('Réessayer')).toBeNull();
  });

  it('dit qu’une palette vidée ne porte plus rien, au lieu de n’afficher aucune ligne', async () => {
    mockedLoadPallet.mockResolvedValue(palette({ lots: [] }));

    render(<PalletScreen />);

    await waitFor(() => expect(screen.getByText(/ne porte plus aucun lot/)).toBeTruthy());
  });
});
