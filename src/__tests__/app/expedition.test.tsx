import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import Toast from 'react-native-toast-message';

import ExpeditionScreen from '@/app/expedition';
import { loadBatches, lookupBatch, type BatchLookup, type Batch } from '@/lib/batches';
import { clearShipmentDraft, loadShipmentDraft, saveShipmentDraft } from '@/lib/draft';
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
jest.mock('@/lib/draft');
jest.mock('@/lib/toast');
// La confirmation de succès passe par `Toast.show` (pas `toastMessage`) : on le capture pour vérifier
// que le n° d'expédition attribué par le serveur y est bien affiché.
jest.mock('react-native-toast-message', () => ({
  __esModule: true,
  default: { show: jest.fn(), hide: jest.fn() },
}));
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
const mockedLoadShipmentDraft = jest.mocked(loadShipmentDraft);
const mockedSaveShipmentDraft = jest.mocked(saveShipmentDraft);
const mockedClearShipmentDraft = jest.mocked(clearShipmentDraft);
const mockedToastShow = jest.mocked(Toast.show);

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
    mockedLoadShipmentDraft.mockResolvedValue(null);
    mockedSaveShipmentDraft.mockResolvedValue(undefined);
    mockedClearShipmentDraft.mockResolvedValue(undefined);
  });

  // (issue #73) Un 401 en fond démonte l'écran et détruisait le client, le n° de transport, les
  // lots chargés. On restaure le brouillon au montage.
  it('restaure le client, le transport et les lots après une session expirée', async () => {
    mockedLoadShipmentDraft.mockResolvedValue({
      customerId: 'c-1',
      shipmentId: 'EXP-2026-042',
      autoShipmentId: false,
      carrier: 'Transporteur Nord',
      address: '9 quai des Docks',
      lots: [{ batch: batch({ id: 'b-ship', lot_number: 'LOT-CHARGE-7' }), quantity: '15' }],
    });

    render(<ExpeditionScreen />);

    // Le n° de transport et le lot chargé reviennent, sans re-scan ni re-saisie.
    await waitFor(() => expect(screen.getByDisplayValue('EXP-2026-042')).toBeTruthy());
    expect(screen.getByText(/LOT-CHARGE-7/)).toBeTruthy();
  });

  // (issue #76) Le choix « laisser le serveur générer » fait partie de la saisie : un 401 ne doit pas
  // le perdre non plus, sinon l'opérateur re-bascule en mode auto à chaque reprise.
  it('restaure le mode « génération serveur » après une session expirée', async () => {
    mockedLoadShipmentDraft.mockResolvedValue({
      customerId: 'c-1',
      shipmentId: '',
      autoShipmentId: true,
      carrier: 'Transporteur Nord',
      address: '9 quai des Docks',
      lots: [],
    });

    render(<ExpeditionScreen />);

    // Le champ manuel reste masqué et la bascule propose de revenir à la saisie : on est bien en auto.
    await waitFor(() => expect(screen.getByText('Saisir manuellement')).toBeTruthy());
    expect(screen.queryByPlaceholderText('EXP-2026-001')).toBeNull();
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

  // (issue #76) L'opérateur devait inventer un n° unique par organisation ; une collision (contrainte
  // d'unicité en base) le faisait rejeter devant le camion, sans qu'il puisse deviner ce qui est pris.
  // Le bouton « Générer un n° (SSCC) » envoie 'AUTO' : le serveur attribue un SSCC conforme GS1.
  it('laisse le serveur générer le n° et affiche le SSCC retourné', async () => {
    mockedCreateShipment.mockResolvedValue('006141410000000157');

    render(<ExpeditionScreen />);
    await scanLot('LOT-001');

    fireEvent.press(await screen.findByText('Épicerie du Coin'));
    // L'opérateur ne saisit AUCUN numéro : il délègue au serveur.
    fireEvent.press(screen.getByText('Générer un n° (SSCC)'));
    // Le champ de saisie manuelle disparaît : il n'y a plus rien à inventer.
    expect(screen.queryByPlaceholderText('EXP-2026-001')).toBeNull();
    fireEvent.changeText(screen.getByPlaceholderText('Transports Martin'), 'Transports Martin');
    fireEvent.changeText(screen.getByPlaceholderText('Quantité expédiée (kg)'), '20');
    fireEvent.press(screen.getByText(/Enregistrer l/));

    // Le payload porte 'AUTO' : c'est CE mot qui déclenche la génération côté serveur.
    await waitFor(() =>
      expect(mockedCreateShipment).toHaveBeenCalledWith(
        expect.objectContaining({ shipment_id: 'AUTO' })
      )
    );
    // Le n° attribué revient à l'opérateur — sinon il repartirait sans connaître son SSCC.
    expect(mockedToastShow).toHaveBeenCalledWith(
      expect.objectContaining({ text2: expect.stringContaining('006141410000000157') })
    );
  });

  // Garde-fou : le mode automatique ne doit pas détourner une saisie manuelle. Un n° tapé part TEL
  // QUEL (jamais remplacé par 'AUTO'), sinon on générerait un doublon là où l'opérateur voulait SON n°.
  it('envoie le n° saisi à la main quand l’opérateur ne délègue pas', async () => {
    mockedCreateShipment.mockResolvedValue('EXP-2026-009');

    render(<ExpeditionScreen />);
    await scanLot('LOT-001');

    fireEvent.press(await screen.findByText('Épicerie du Coin'));
    fireEvent.changeText(screen.getByPlaceholderText('EXP-2026-001'), 'EXP-2026-009');
    fireEvent.changeText(screen.getByPlaceholderText('Transports Martin'), 'Transports Martin');
    fireEvent.changeText(screen.getByPlaceholderText('Quantité expédiée (kg)'), '20');
    fireEvent.press(screen.getByText(/Enregistrer l/));

    await waitFor(() =>
      expect(mockedCreateShipment).toHaveBeenCalledWith(
        expect.objectContaining({ shipment_id: 'EXP-2026-009' })
      )
    );
  });
});
