import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import ExpeditionScreen from '@/app/expedition';
import { loadBatches, lookupBatch, type BatchLookup, type Batch } from '@/lib/batches';
import { ApiError } from '@/lib/errors';
import { createShipment, loadCustomers } from '@/lib/shipment';
import { toastMessage } from '@/lib/toast';

let mockScannedCode = '';

jest.mock('@/lib/batches', () => ({
  ...jest.requireActual('@/lib/batches'),
  loadBatches: jest.fn(),
  lookupBatch: jest.fn(),
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

// Le faux scanner expose AUSSI `onClose` et `busy` : sans eux, l'annulation et l'indicateur de
// vérification seraient invisibles des tests — on testerait le mock, pas l'écran.
jest.mock('@/components/code-scanner', () => {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const React = require('react');
  const { Text, TouchableOpacity } = require('react-native');
  /* eslint-enable @typescript-eslint/no-require-imports */

  return {
    CodeScanner: ({
      visible,
      busy,
      onScan,
      onClose,
    }: {
      visible: boolean;
      busy?: boolean;
      onScan: (code: string) => void;
      onClose: () => void;
    }) =>
      visible
        ? React.createElement(React.Fragment, null, [
            React.createElement(
              TouchableOpacity,
              { key: 'scan', testID: 'scan-now', onPress: () => onScan(mockScannedCode) },
              React.createElement(Text, null, 'scan')
            ),
            React.createElement(
              TouchableOpacity,
              { key: 'close', testID: 'scan-close', onPress: onClose },
              React.createElement(Text, null, 'fermer')
            ),
            busy ? React.createElement(Text, { key: 'busy' }, 'Vérification du lot…') : null,
          ])
        : null,
  };
});

const mockedLoadBatches = jest.mocked(loadBatches);
const mockedLookup = jest.mocked(lookupBatch);

 
const { findBatchByCode } = jest.requireActual('@/lib/batches') as typeof import('@/lib/batches');

/** Par défaut, la résolution se comporte comme le vrai code sur un lot du catalogue local. */
const resolveLocally = async (code: string, batches: Batch[] = []): Promise<BatchLookup> => {
  const found = findBatchByCode(code, batches);
  return found ? { kind: 'found', batch: found } : { kind: 'unknown' };
};
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
    mockedLookup.mockImplementation(resolveLocally);
    mockedLoadCustomers.mockResolvedValue([
      { id: 'c-1', nom_enseigne: 'Épicerie du Coin', adresse_livraison: '12 rue des Halles, Paris' },
    ]);
    mockedLoadBatches.mockResolvedValue([batch()]);
  });

  // ⚠️ LE test de la course. La vérification passe par le réseau : plusieurs scans peuvent être en
  // vol. Seul le DERNIER compte — les résultats périmés sont jetés. Sans ça, la même palette
  // partirait DEUX FOIS dans le camion, et la traçabilité enregistrerait une sortie qui n'a pas eu
  // lieu.
  it('n’ajoute qu’une fois le lot, même rescanné pendant la vérification', async () => {
    let resolveLookup: (result: BatchLookup) => void = () => undefined;
    mockedLookup.mockReturnValue(
      new Promise<BatchLookup>((resolve) => {
        resolveLookup = resolve;
      })
    );

    mockScannedCode = 'LOT-001';
    render(<ExpeditionScreen />);
    fireEvent.press(await screen.findByText('Scanner un lot'));

    fireEvent.press(screen.getByTestId('scan-now'));
    // La vérification est en vol : l'opérateur rescanne, croyant que rien n'a pris.
    fireEvent.press(screen.getByTestId('scan-now'));
    fireEvent.press(screen.getByTestId('scan-now'));

    resolveLookup({ kind: 'found', batch: batch() });

    await waitFor(() => expect(screen.getAllByText('Yaourt nature')).toHaveLength(1));
  });

  // 🔴 L'opérateur voit qu'il a scanné la mauvaise palette et appuie sur la croix. Sans annulation
  // de la vérification en vol, le lot s'ajoutait QUAND MÊME une seconde plus tard — et partait dans
  // le camion. Il n'y a aucun moyen pour l'opérateur de comprendre ce qui s'est passé.
  it('n’ajoute pas le lot si l’opérateur annule pendant la vérification', async () => {
    let resolveLookup: (result: BatchLookup) => void = () => undefined;
    mockedLookup.mockReturnValue(
      new Promise<BatchLookup>((resolve) => {
        resolveLookup = resolve;
      })
    );

    mockScannedCode = 'LOT-001';
    render(<ExpeditionScreen />);
    fireEvent.press(await screen.findByText('Scanner un lot'));
    fireEvent.press(screen.getByTestId('scan-now'));

    // L'opérateur ferme la modale : il ne veut plus de ce lot.
    fireEvent.press(screen.getByTestId('scan-close'));

    resolveLookup({ kind: 'found', batch: batch() });

    await waitFor(() => expect(screen.queryByTestId('scan-now')).toBeNull());
    expect(screen.queryByText('Yaourt nature')).toBeNull();
  });

  it('montre que la vérification est en cours, au lieu de fermer la modale sur du vide', async () => {
    mockedLookup.mockReturnValue(new Promise<BatchLookup>(() => undefined));

    mockScannedCode = 'LOT-001';
    render(<ExpeditionScreen />);
    fireEvent.press(await screen.findByText('Scanner un lot'));
    fireEvent.press(screen.getByTestId('scan-now'));

    await waitFor(() => expect(screen.getByText('Vérification du lot…')).toBeTruthy());
  });

  it('prévient qu’un lot est déjà dans la liste au lieu de l’ajouter deux fois', async () => {
    render(<ExpeditionScreen />);
    await scanLot('LOT-001');
    await waitFor(() => expect(screen.getByText('Yaourt nature')).toBeTruthy());

    await scanLot('LOT-001');

    await waitFor(() =>
      expect(mockedToastMessage).toHaveBeenCalledWith(
        'Lot déjà ajouté',
        expect.stringContaining('LOT-001')
      )
    );
    expect(screen.getAllByText('Yaourt nature')).toHaveLength(1);
  });

  it('garde les clients chargés quand les lots échouent', async () => {
    mockedLoadBatches.mockRejectedValue(new ApiError('Erreur serveur', 500));

    render(<ExpeditionScreen />);

    await waitFor(() => expect(screen.getByText('Épicerie du Coin')).toBeTruthy());
  });

  // Avant, un catalogue local vide faisait sortir sur « Lots indisponibles » — ce qui court-circuitait
  // le serveur dans la situation même où il est le seul recours. Le chargement du catalogue peut
  // échouer (500, 403) alors que le réseau va très bien : le scan doit quand même aboutir.
  it('interroge le serveur même quand le catalogue local a échoué', async () => {
    mockedLoadBatches.mockRejectedValue(new ApiError('Erreur serveur', 500));
    mockedLookup.mockResolvedValue({ kind: 'found', batch: batch() });

    render(<ExpeditionScreen />);
    await scanLot('LOT-001');

    await waitFor(() => expect(screen.getByText('Yaourt nature')).toBeTruthy());
    expect(mockedLookup).toHaveBeenCalledWith('LOT-001', []);
  });

  // « Lot inconnu » quand on n'a PAS PU demander est un mensonge : le lot existe peut-être, et
  // l'opérateur croirait son étiquette fausse.
  it('ne déclare pas un lot inconnu quand il n’a pas pu le vérifier', async () => {
    mockedLookup.mockResolvedValue({
      kind: 'unverifiable',
      error: new ApiError('Erreur réseau', 0),
    });

    render(<ExpeditionScreen />);
    await scanLot('LOT-001');

    await waitFor(() =>
      expect(mockedToastMessage).toHaveBeenCalledWith(
        'Lot non vérifié',
        expect.stringContaining('Impossible de confirmer')
      )
    );
    expect(mockedToastMessage).not.toHaveBeenCalledWith('Lot inconnu', expect.anything());
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
