import { render, screen, waitFor } from '@testing-library/react-native';

import { loadProducts, loadSuppliers } from '@/lib/catalog';
import { loadEquipment } from '@/lib/equipment';
import { ApiError } from '@/lib/errors';

import ReceptionScreen from './reception';

jest.mock('@/lib/catalog');
jest.mock('@/lib/equipment');
jest.mock('@/lib/sync/queue');
jest.mock('@/lib/sync/sync');
jest.mock('expo-router', () => ({
  router: { back: jest.fn() },
  useLocalSearchParams: () => ({}),
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0 }) }));

const catalog = jest.mocked({ loadProducts, loadSuppliers });
const mockedLoadEquipment = jest.mocked(loadEquipment);

describe('écran de réception', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    catalog.loadSuppliers.mockResolvedValue([{ id: 'f-1', nom_ferme: 'Ferme Dupont' }]);
    catalog.loadProducts.mockResolvedValue([
      { id: 'p-1', nom: 'Lait cru', unite_reference: 'kg' },
    ]);
    mockedLoadEquipment.mockResolvedValue([]);
  });

  it('reste utilisable quand la liste des emplacements est indisponible', async () => {
    // L'emplacement est optionnel, le catalogue ne l'est pas. Les charger ensemble ferait
    // échouer TOUTE la saisie dès que les matériels manquent du cache — c'est-à-dire au
    // premier lancement hors réseau après une mise à jour. La réception serait impossible
    // là où l'application doit précisément servir.
    mockedLoadEquipment.mockRejectedValue(new ApiError('Erreur réseau', 0));

    render(<ReceptionScreen />);

    await waitFor(() => expect(screen.getByText('Ferme Dupont')).toBeTruthy());
    expect(screen.getByText('Lait cru')).toBeTruthy();
  });

  it('avertit quand aucun emplacement n’est renseigné', async () => {
    // Sans emplacement, la quarantaine automatique ne bloquera jamais ce lot.
    render(<ReceptionScreen />);

    await waitFor(() => expect(screen.getByText(/Scanner l'emplacement/)).toBeTruthy());
    expect(screen.getByText(/ne sera pas mis en quarantaine/)).toBeTruthy();
  });
});
