import { render, screen, waitFor, fireEvent } from '@testing-library/react-native';
import { router } from 'expo-router';

import { loadQuarantineBatches } from '@/lib/quarantine';

import QuarantineScreen from '@/app/quarantine';

jest.mock('@/lib/quarantine');
jest.mock('expo-router', () => ({
  router: { navigate: jest.fn(), back: jest.fn() },
  useFocusEffect: (effect: () => void) => effect(),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0 }),
}));

const mockedLoad = jest.mocked(loadQuarantineBatches);

const BATCH = {
  id: 'b1',
  lotNumber: '260714-ABC123',
  produitNom: 'Lait cru',
  quantite: 42.5,
  uniteCode: 'kg',
  datePeremption: '2026-12-31T00:00:00.000Z',
  dateCreation: '2026-07-01T08:00:00.000Z',
};

describe('écran des lots en quarantaine', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedLoad.mockResolvedValue({ kind: 'ok', batches: [] });
  });

  it('liste les lots bloqués — invisibles jusqu’ici sur le terrain', async () => {
    mockedLoad.mockResolvedValue({ kind: 'ok', batches: [BATCH] });
    render(<QuarantineScreen />);

    await waitFor(() => expect(screen.getByText('260714-ABC123')).toBeTruthy());
    expect(screen.getByText('Lait cru')).toBeTruthy();
  });

  it('mène à la fiche complète d’un lot bloqué', async () => {
    mockedLoad.mockResolvedValue({ kind: 'ok', batches: [BATCH] });
    render(<QuarantineScreen />);

    await waitFor(() => expect(screen.getByText('260714-ABC123')).toBeTruthy());
    fireEvent.press(screen.getByText('260714-ABC123'));
    expect(router.navigate).toHaveBeenCalledWith({ pathname: '/batch/[id]', params: { id: 'b1' } });
  });

  it('dit clairement quand aucun lot n’est en quarantaine', async () => {
    mockedLoad.mockResolvedValue({ kind: 'ok', batches: [] });
    render(<QuarantineScreen />);

    await waitFor(() => expect(screen.getByText(/Aucun lot en quarantaine/i)).toBeTruthy());
  });

  // ⚠️ NE PAS MENTIR : sur une panne réseau, l'écran ne doit PAS afficher « aucun lot » (une coche
  // rassurante) — il doit AVOUER qu'il n'a pas pu vérifier. Sinon un opérateur croit la marchandise
  // saine alors que des lots dangereux sont bloqués en base.
  it('avoue l’échec réseau au lieu d’annoncer « aucun lot »', async () => {
    mockedLoad.mockResolvedValue({ kind: 'unverifiable', error: new Error('offline') });
    render(<QuarantineScreen />);

    await waitFor(() => expect(screen.getByText(/Impossible de vérifier/i)).toBeTruthy());
    expect(screen.queryByText(/Aucun lot en quarantaine/i)).toBeNull();
  });
});
