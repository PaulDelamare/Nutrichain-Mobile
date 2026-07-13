import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import ExpeditionScreen from '@/app/expedition';
import { loadBatches, type Batch } from '@/lib/batches';
import { ApiError } from '@/lib/errors';
import { createShipment, loadCustomers } from '@/lib/shipment';
import { toastMessage } from '@/lib/toast';

let mockScannedCode = '';

jest.mock('@/lib/batches', () => ({
  ...jest.requireActual('@/lib/batches'),
  loadBatches: jest.fn(),
}));
jest.mock('@/lib/shipment', () => ({
  ...jest.requireActual('@/lib/shipment'),
  loadCustomers: jest.fn(),
  createShipment: jest.fn(),
}));
jest.mock('@/lib/toast');
jest.mock('@/hooks/use-online-status', () => ({ useOnlineStatus: () => true }));
jest.mock('expo-router', () => ({ router: { back: jest.fn() } }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0 }) }));

jest.mock('@/components/code-scanner', () => {
  // Requis dans la factory : jest.mock est hissé avant les imports du module.
  /* eslint-disable @typescript-eslint/no-require-imports */
  const React = require('react');
  const { Text, TouchableOpacity } = require('react-native');
  /* eslint-enable @typescript-eslint/no-require-imports */

  return {
    CodeScanner: ({ visible, onScan }: { visible: boolean; onScan: (code: string) => void }) =>
      visible
        ? React.createElement(
            TouchableOpacity,
            { testID: 'scan-now', onPress: () => onScan(mockScannedCode) },
            React.createElement(Text, null, 'scan')
          )
        : null,
  };
});

const mockedLoadBatches = jest.mocked(loadBatches);
const mockedLoadCustomers = jest.mocked(loadCustomers);
const mockedCreateShipment = jest.mocked(createShipment);
const mockedToastMessage = jest.mocked(toastMessage);

function batch(overrides: Partial<Batch> = {}): Batch {
  return {
    id: 'b-1',
    lot_number: 'LOT-001',
    statut: 'EN_STOCK',
    quantite_actuelle: '80',
    unite_code: 'kg',
    date_peremption: null,
    produit: { nom: 'Yaourt nature' },
    ...overrides,
  };
}

async function scanLot(code: string) {
  mockScannedCode = code;
  fireEvent.press(await screen.findByText('Scanner un lot'));
  fireEvent.press(screen.getByTestId('scan-now'));
}

describe('écran d’expédition', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedLoadCustomers.mockResolvedValue([
      { id: 'c-1', nom_enseigne: 'Épicerie du Coin', adresse_livraison: '12 rue des Halles, Paris' },
    ]);
    mockedLoadBatches.mockResolvedValue([batch()]);
  });

  it('garde les clients chargés quand les lots échouent', async () => {
    mockedLoadBatches.mockRejectedValue(new ApiError('Erreur serveur', 500));

    render(<ExpeditionScreen />);

    await waitFor(() => expect(screen.getByText('Épicerie du Coin')).toBeTruthy());
  });

  it('dit que le catalogue a échoué plutôt que d’accuser l’étiquette', async () => {
    mockedLoadBatches.mockRejectedValue(new ApiError('Erreur réseau', 0));

    render(<ExpeditionScreen />);
    await scanLot('LOT-001');

    expect(mockedToastMessage).toHaveBeenCalledWith(
      'Lots indisponibles',
      expect.stringContaining('Rechargez')
    );
  });

  it('refuse au scan un lot bloqué : il ne doit pas quitter l’usine', async () => {
    mockedLoadBatches.mockResolvedValue([batch({ statut: 'ALERTE' })]);

    render(<ExpeditionScreen />);
    await scanLot('LOT-001');

    expect(mockedToastMessage).toHaveBeenCalledWith(
      'Lot LOT-001 non expédiable',
      // L'opérateur lit une PHRASE, pas le code brut du statut.
      expect.stringContaining('sous rappel produit')
    );
    expect(screen.queryByText('Yaourt nature')).toBeNull();
  });

  it('annonce une quantité supérieure au stock sous le champ', async () => {
    render(<ExpeditionScreen />);
    await scanLot('LOT-001');

    fireEvent.changeText(await screen.findByPlaceholderText('Quantité expédiée (kg)'), '200');

    expect(screen.getByText('Stock insuffisant : 80 disponibles.')).toBeTruthy();
  });

  it('n’annonce pas un échec quand le réseau coupe pendant l’envoi', async () => {
    // Le serveur a pu commiter avant que la réponse se perde. Dire « refusée » pousserait
    // l'opérateur à ressaisir — et à sortir ses lots du stock une seconde fois.
    mockedCreateShipment.mockRejectedValue(new ApiError('Erreur réseau', 0));

    render(<ExpeditionScreen />);
    await scanLot('LOT-001');

    fireEvent.press(await screen.findByText('Épicerie du Coin'));
    fireEvent.changeText(screen.getByPlaceholderText('EXP-2026-001'), 'EXP-2026-009');
    fireEvent.changeText(screen.getByPlaceholderText('Transports Martin'), 'Transports Martin');
    fireEvent.changeText(screen.getByPlaceholderText('Quantité expédiée (kg)'), '20');
    fireEvent.press(screen.getByText(/Enregistrer l/));

    await waitFor(() =>
      expect(mockedToastMessage).toHaveBeenCalledWith(
        'Envoi interrompu',
        expect.stringContaining('peut-être été enregistrée')
      )
    );
  });
});
