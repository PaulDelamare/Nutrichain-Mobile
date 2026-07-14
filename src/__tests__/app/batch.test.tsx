import { render, screen, waitFor, fireEvent } from '@testing-library/react-native';

import { loadBatch } from '@/lib/batches';

import BatchDetailScreen from '@/app/batch/[id]';

jest.mock('@/lib/batches', () => ({ loadBatch: jest.fn() }));
jest.mock('expo-router', () => ({
  router: { back: jest.fn() },
  useLocalSearchParams: () => ({ id: 'b1' }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0 }),
}));

const mockedLoad = jest.mocked(loadBatch);

const DETAIL = {
  id: 'b1',
  lotNumber: '260709-ABC',
  statut: 'EN_STOCK',
  produitNom: 'Beurre Doux',
  codeGtin: '3042040209456',
  quantite: 120,
  uniteCode: 'kg',
  datePeremption: null,
  dateCreation: null,
};

describe('fiche lot', () => {
  beforeEach(() => jest.clearAllMocks());

  it('affiche la fiche quand le lot est trouvé', async () => {
    mockedLoad.mockResolvedValue({ kind: 'ok', batch: DETAIL });
    render(<BatchDetailScreen />);

    await waitFor(() => expect(screen.getByText('Beurre Doux')).toBeTruthy());
    expect(screen.getByText('En stock')).toBeTruthy();
  });

  // ⚠️ LE cœur de l'issue : une panne réseau est TRANSITOIRE → on propose de RÉESSAYER, jamais un
  // écran vide muet. (Avant, 403 / réseau / 404 donnaient tous le même « indisponible » sans bouton.)
  it('propose de réessayer sur une panne réseau, et la relance aboutit', async () => {
    mockedLoad.mockResolvedValue({ kind: 'unverifiable', error: new Error('offline') });
    render(<BatchDetailScreen />);

    await waitFor(() => expect(screen.getByText(/Impossible de vérifier/i)).toBeTruthy());

    mockedLoad.mockResolvedValue({ kind: 'ok', batch: DETAIL });
    fireEvent.press(screen.getByText(/Réessayer/i));

    await waitFor(() => expect(screen.getByText('Beurre Doux')).toBeTruthy());
  });

  // Un refus de droits (403) n'est PAS une panne : message clair, et PAS de « Réessayer » (rejouer
  // avec les mêmes droits ne changera rien).
  it('dit clairement un refus d’accès (403), sans Réessayer', async () => {
    mockedLoad.mockResolvedValue({ kind: 'forbidden' });
    render(<BatchDetailScreen />);

    await waitFor(() => expect(screen.getByText(/accès/i)).toBeTruthy());
    expect(screen.queryByText(/Réessayer/i)).toBeNull();
  });

  // Un 404 = lot introuvable : réponse DÉFINITIVE, pas une incertitude → pas de Réessayer.
  it('dit « introuvable » sur un 404, sans Réessayer', async () => {
    mockedLoad.mockResolvedValue({ kind: 'unknown' });
    render(<BatchDetailScreen />);

    await waitFor(() => expect(screen.getByText(/introuvable/i)).toBeTruthy());
    expect(screen.queryByText(/Réessayer/i)).toBeNull();
  });

  // BONUS : EXPEDIE est un vrai statut de l'API — il doit avoir un libellé lisible, pas le code brut.
  it('affiche un libellé lisible pour un statut EXPEDIE (pas le code brut)', async () => {
    mockedLoad.mockResolvedValue({ kind: 'ok', batch: { ...DETAIL, statut: 'EXPEDIE' } });
    render(<BatchDetailScreen />);

    await waitFor(() => expect(screen.getByText('Expédié')).toBeTruthy());
    expect(screen.queryByText('EXPEDIE')).toBeNull();
  });
});
