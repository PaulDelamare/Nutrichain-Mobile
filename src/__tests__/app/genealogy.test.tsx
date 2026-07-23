import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';

import GenealogyScreen from '@/app/genealogy/[id]';
import { loadGenealogy, type Genealogy } from '@/lib/traceability';

jest.mock('@/lib/traceability', () => ({ loadGenealogy: jest.fn() }));
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), navigate: jest.fn() },
  useLocalSearchParams: () => ({ id: 'b1' }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0 }),
}));

const mockedLoad = jest.mocked(loadGenealogy);

const CHAINE: Genealogy = {
  batchId: 'b1',
  upstream: [
    {
      id: 'b-parent',
      lot_number: '260714-LAIT01',
      statut: 'EPUISE',
      quantite_actuelle: '0',
      unite_code: 'L',
      nom_produit: 'Lait cru',
      date_peremption: null,
    },
  ],
  downstream: [
    {
      id: 'b-enfant',
      lot_number: '260716-YAOU01',
      statut: 'EN_STOCK',
      quantite_actuelle: '120',
      unite_code: 'kg',
      nom_produit: 'Yaourt nature',
      date_peremption: null,
    },
  ],
  origines: [
    {
      lot_number: '260714-LAIT01',
      date_reception: '2026-07-14T06:00:00.000Z',
      fournisseur: { id: 'f-1', nom_ferme: 'Ferme des Trois Chênes' },
    },
  ],
};

describe('écran de généalogie', () => {
  beforeEach(() => jest.clearAllMocks());

  it('remonte la chaîne : origine, ascendance, descendance', async () => {
    mockedLoad.mockResolvedValue({ kind: 'ok', genealogy: CHAINE });

    render(<GenealogyScreen />);

    // « De la ferme au rayon » : l'origine NOMME l'exploitation, pas seulement un identifiant.
    await waitFor(() => expect(screen.getByText('Ferme des Trois Chênes')).toBeTruthy());
    expect(screen.getByText('Lait cru')).toBeTruthy();
    expect(screen.getByText('Yaourt nature')).toBeTruthy();
  });

  it('ouvre la fiche d’un lot de la chaîne', async () => {
    mockedLoad.mockResolvedValue({ kind: 'ok', genealogy: CHAINE });

    render(<GenealogyScreen />);
    fireEvent.press(await screen.findByText('Yaourt nature'));

    expect(jest.mocked(router.navigate)).toHaveBeenCalledWith('/batch/b-enfant');
  });

  /**
   * ⚠️ LE mensonge à ne pas commettre. Une descendance vide affichée sur une panne réseau ferait
   * croire qu'aucun lot n'est parti en rayon — sur une suspicion sanitaire, c'est le pire.
   */
  it('n’affiche pas une chaîne vide quand il n’a pas pu la remonter', async () => {
    mockedLoad.mockResolvedValue({ kind: 'unverifiable', error: new Error('offline') });

    render(<GenealogyScreen />);

    await waitFor(() => expect(screen.getByText(/Ne concluez pas/)).toBeTruthy());
    expect(screen.queryByText('Descendance')).toBeNull();
    // Panne TRANSITOIRE → on propose de réessayer.
    expect(screen.getByText(/Réessayer/)).toBeTruthy();
  });

  it('dit « aucun lot » quand la chaîne est vraiment vide — c’est une RÉPONSE', async () => {
    // Vide vérifié ≠ vide non vérifié : ici on sait, donc on l'écrit.
    mockedLoad.mockResolvedValue({
      kind: 'ok',
      genealogy: { batchId: 'b1', upstream: [], downstream: [], origines: [] },
    });

    render(<GenealogyScreen />);

    await waitFor(() => expect(screen.getByText('Descendance')).toBeTruthy());
    expect(screen.getAllByText('Aucun lot.')).toHaveLength(3);
  });

  it('ne propose pas de réessayer sur un refus de droits — c’est PERMANENT', async () => {
    mockedLoad.mockResolvedValue({ kind: 'forbidden' });

    render(<GenealogyScreen />);

    await waitFor(() => expect(screen.getByText(/Accès refusé/)).toBeTruthy());
    expect(screen.queryByText(/Réessayer/)).toBeNull();
  });

  it('distingue un lot introuvable d’une panne', async () => {
    mockedLoad.mockResolvedValue({ kind: 'unknown' });

    render(<GenealogyScreen />);

    await waitFor(() => expect(screen.getByText(/introuvable/)).toBeTruthy());
    expect(screen.queryByText(/Réessayer/)).toBeNull();
  });
});
