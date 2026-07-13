import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import TransformationScreen from '@/app/transformation';
import { loadBatches, type Batch } from '@/lib/batches';
import { loadProducts } from '@/lib/catalog';
import { loadEquipment } from '@/lib/equipment';
import { ApiError } from '@/lib/errors';
import { toastMessage } from '@/lib/toast';

let mockScannedCode = '';

jest.mock('@/lib/batches', () => ({
  ...jest.requireActual('@/lib/batches'),
  loadBatches: jest.fn(),
}));
jest.mock('@/lib/catalog');
jest.mock('@/lib/equipment', () => ({
  ...jest.requireActual('@/lib/equipment'),
  loadEquipment: jest.fn(),
}));
jest.mock('@/lib/toast');
jest.mock('@/hooks/use-online-status', () => ({ useOnlineStatus: () => true }));
jest.mock('expo-router', () => ({ router: { back: jest.fn() } }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0 }) }));

// Le scanner réel ouvre la caméra : on le réduit à ce qu'il apporte à l'écran, un code scanné.
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
const mockedLoadProducts = jest.mocked(loadProducts);
const mockedLoadEquipment = jest.mocked(loadEquipment);
const mockedToastMessage = jest.mocked(toastMessage);

function batch(overrides: Partial<Batch> = {}): Batch {
  return {
    id: 'b-1',
    lot_number: 'LOT-001',
    statut: 'EN_STOCK',
    quantite_actuelle: '120',
    unite_code: 'kg',
    date_peremption: null,
    produit: { nom: 'Lait cru' },
    ...overrides,
  };
}

async function scanLot(code: string) {
  mockScannedCode = code;
  fireEvent.press(await screen.findByText('Scanner un lot'));
  fireEvent.press(screen.getByTestId('scan-now'));
}

describe('écran de transformation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedLoadProducts.mockResolvedValue([{ id: 'p-1', nom: 'Yaourt nature', unite_reference: 'kg' }]);
    mockedLoadEquipment.mockResolvedValue([]);
    mockedLoadBatches.mockResolvedValue([batch()]);
  });

  it('garde les données chargées quand une seule route échoue', async () => {
    // Un `Promise.all` jetait les trois catalogues dès qu'un seul échouait : l'écran s'affichait
    // vide et répondait « lot inconnu » à des lots qui existent.
    mockedLoadEquipment.mockRejectedValue(new ApiError('Erreur serveur', 500));

    render(<TransformationScreen />);

    await waitFor(() => expect(screen.getByText('Yaourt nature')).toBeTruthy());
    await scanLot('LOT-001');

    expect(screen.getByText('Lait cru')).toBeTruthy();
  });

  it('dit que le catalogue a échoué plutôt que d’accuser l’étiquette', async () => {
    mockedLoadBatches.mockRejectedValue(new ApiError('Erreur réseau', 0));

    render(<TransformationScreen />);
    await scanLot('LOT-001');

    expect(mockedToastMessage).toHaveBeenCalledWith(
      'Lots indisponibles',
      expect.stringContaining('Rechargez')
    );
  });

  it('explique pourquoi un lot est refusé, au lieu d’« une erreur est survenue »', async () => {
    render(<TransformationScreen />);
    await scanLot('LOT-INCONNU');

    expect(mockedToastMessage).toHaveBeenCalledWith(
      'Lot inconnu',
      'Ce code ne correspond à aucun lot de votre organisation.'
    );
  });

  it('refuse au scan un lot en quarantaine', async () => {
    mockedLoadBatches.mockResolvedValue([batch({ statut: 'BLOQUE' })]);

    render(<TransformationScreen />);
    await scanLot('LOT-001');

    expect(mockedToastMessage).toHaveBeenCalledWith(
      'Lot LOT-001 inutilisable',
      expect.stringContaining('BLOQUE')
    );
    expect(screen.queryByText('Lait cru')).toBeNull();
  });

  it('refuse au scan un lot dont l’unité est inconnue du serveur', async () => {
    // Sans ce contrôle, le lot s'ajoutait normalement et le bouton d'envoi restait gris À VIE,
    // sans jamais dire lequel des lots était en cause. « U » sort de l'écran de réception.
    mockedLoadBatches.mockResolvedValue([batch({ unite_code: 'U' })]);

    render(<TransformationScreen />);
    await scanLot('LOT-001');

    expect(mockedToastMessage).toHaveBeenCalledWith(
      'Lot LOT-001 non transformable',
      expect.stringContaining('« U »')
    );
    expect(screen.queryByText('Lait cru')).toBeNull();
  });

  it('annonce un sur-prélèvement sous le champ, sans attendre le refus du serveur', async () => {
    // Le serveur refuse, mais son message contient l'UUID brut du lot : inexploitable.
    render(<TransformationScreen />);
    await scanLot('LOT-001');

    fireEvent.changeText(await screen.findByPlaceholderText('Quantité prélevée (kg)'), '500');

    expect(screen.getByText('Stock insuffisant : 120 disponibles.')).toBeTruthy();
  });

  it('annonce une troisième décimale, que le serveur rejetterait en 422', async () => {
    render(<TransformationScreen />);

    fireEvent.changeText(await screen.findByPlaceholderText('0'), '12.345');

    expect(screen.getByText('Nombre invalide (2 décimales maximum).')).toBeTruthy();
  });
});
