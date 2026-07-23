import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { useCurrentUser } from '@/hooks/use-current-user';

import TransformationScreen from '@/app/transformation';
import { loadBatches, lookupBatch, type Batch, type BatchLookup } from '@/lib/batches';
import { loadProducts } from '@/lib/catalog';
import {
  clearTransformationDraft,
  loadTransformationDraft,
  saveTransformationDraft,
} from '@/lib/draft';
import { loadEquipment } from '@/lib/equipment';
import { ApiError } from '@/lib/errors';
import { toastMessage } from '@/lib/toast';

let mockScannedCode = '';

jest.mock('@/lib/batches', () => ({
  ...jest.requireActual('@/lib/batches'),
  loadBatches: jest.fn(),
  lookupBatch: jest.fn(),
}));
jest.mock('@/lib/catalog');
jest.mock('@/lib/draft');
jest.mock('@/hooks/use-current-user');
jest.mock('@/lib/equipment', () => ({
  ...jest.requireActual('@/lib/equipment'),
  loadEquipment: jest.fn(),
}));
jest.mock('@/lib/toast');
jest.mock('@/hooks/use-online-status', () => ({ useOnlineStatus: () => true }));
jest.mock('expo-router', () => ({ router: { back: jest.fn() } }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0 }) }));

// Le scanner réel ouvre la caméra : on le réduit à ce qu'il apporte à l'écran. Il expose AUSSI
// `onClose` et `busy` : sans eux, l'annulation et l'indicateur de vérification seraient invisibles
// des tests — on testerait le mock, pas l'écran.
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
const mockedLoadProducts = jest.mocked(loadProducts);
const mockedLoadEquipment = jest.mocked(loadEquipment);
const mockedLookup = jest.mocked(lookupBatch);
const mockedToastMessage = jest.mocked(toastMessage);
const mockedLoadTransformationDraft = jest.mocked(loadTransformationDraft);
const mockedSaveTransformationDraft = jest.mocked(saveTransformationDraft);
const mockedClearTransformationDraft = jest.mocked(clearTransformationDraft);

 
const { findBatchByCode } = jest.requireActual('@/lib/batches') as typeof import('@/lib/batches');

/** Par défaut, la résolution se comporte comme le vrai code sur un lot du catalogue local. */
const resolveLocally = async (code: string, batches: Batch[] = []): Promise<BatchLookup> => {
  const found = findBatchByCode(code, batches);
  return found ? { kind: 'found', batch: found } : { kind: 'unknown' };
};

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

const mockedUser = jest.mocked(useCurrentUser);

describe('écran de transformation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedUser.mockReturnValue({ user: null, loading: false });
    mockedLookup.mockImplementation(resolveLocally);
    mockedLoadProducts.mockResolvedValue([
      { id: 'p-1', nom: 'Yaourt nature', unite_reference: 'kg', code_gtin: '3042040209123' },
    ]);
    mockedLoadEquipment.mockResolvedValue([]);
    mockedLoadBatches.mockResolvedValue([batch()]);
    mockedLoadTransformationDraft.mockResolvedValue(null);
    mockedSaveTransformationDraft.mockResolvedValue(undefined);
    mockedClearTransformationDraft.mockResolvedValue(undefined);
  });

  // (issue #73) Une session qui expire (401, même en fond) démonte l'écran et détruisait la cuve
  // scannée, les lots parents, les quantités. On restaure le brouillon au montage.
  it('restaure la cuve et les lots parents après une session expirée', async () => {
    mockedLoadTransformationDraft.mockResolvedValue({
      cuve: { id: 'cuve-1', nom: 'Cuve Inox A', type: 'CUVE', qr_code_id: null, lieu: { nom: 'Atelier' } },
      parents: [
        { batch: batch({ id: 'b-parent', lot_number: 'LOT-PARENT-9' }), quantity: '30', exhausted: false },
      ],
      productId: 'p-1',
      quantity: '25',
    });

    render(<TransformationScreen />);

    // La cuve et le lot parent reviennent, sans re-scan.
    await waitFor(() => expect(screen.getByText(/LOT-PARENT-9/)).toBeTruthy());
    expect(screen.getByText(/Cuve Inox A/)).toBeTruthy();
  });

  // ⚠️ (issue #72) L'unité du produit fini n'était liée à RIEN : un opérateur produisant un produit
  // référencé en kg pouvait choisir L → le lot naît en litres, le stock devient faux, personne ne le
  // voit. L'unité doit être DÉRIVÉE du produit choisi et VERROUILLÉE.
  it('verrouille l’unité sur celle du produit fini choisi', async () => {
    mockedLoadProducts.mockResolvedValue([
      { id: 'p-kg', nom: 'Yaourt', unite_reference: 'kg', code_gtin: '1' },
      { id: 'p-l', nom: 'Crème', unite_reference: 'L', code_gtin: '2' },
    ]);
    render(<TransformationScreen />);
    await waitFor(() => expect(screen.getByText('Yaourt')).toBeTruthy());

    // Tant qu'aucun produit n'est choisi, le sélecteur libre propose bien les deux unités.
    expect(screen.getByText('L')).toBeTruthy();

    fireEvent.press(screen.getByText('Yaourt')); // produit référencé en kg

    // L'unité est verrouillée à KG (celle du produit) — « L » n'est plus une option choisissable.
    await waitFor(() =>
      expect(screen.getByText(/KG.*déterminée par le produit fini/i)).toBeTruthy()
    );
    expect(screen.queryByText('L')).toBeNull();
  });

  it('garde les données chargées quand une seule route échoue', async () => {
    // Un `Promise.all` jetait les trois catalogues dès qu'un seul échouait : l'écran s'affichait
    // vide et répondait « lot inconnu » à des lots qui existent.
    mockedLoadEquipment.mockRejectedValue(new ApiError('Erreur serveur', 500));

    render(<TransformationScreen />);

    await waitFor(() => expect(screen.getByText('Yaourt nature')).toBeTruthy());
    await scanLot('LOT-001');

    await waitFor(() => expect(screen.getByText('Lait cru')).toBeTruthy());
  });

  // Avant, un catalogue local vide faisait sortir sur « Lots indisponibles » — ce qui
  // court-circuitait le serveur dans la situation MÊME où il est le seul recours : le chargement du
  // catalogue peut échouer (500, 403) alors que le réseau va parfaitement bien.
  it('interroge le serveur même quand le catalogue local a échoué', async () => {
    mockedLoadBatches.mockRejectedValue(new ApiError('Erreur serveur', 500));
    mockedLookup.mockResolvedValue({ kind: 'found', batch: batch() });

    render(<TransformationScreen />);
    await scanLot('LOT-001');

    await waitFor(() => expect(screen.getByText('Lait cru')).toBeTruthy());
    expect(mockedLookup).toHaveBeenCalledWith('LOT-001', []);
  });

  // 🔴 LE trou que cette PR ferme. Le catalogue local ne porte que les 100 lots les plus RÉCENTS :
  // un ingrédient à longue conservation (sucre, poudre de lait) était annoncé « Lot inconnu » DEVANT
  // LA CUVE — alors qu'il est en stock, et que c'est nous qui avons imprimé son étiquette.
  it('trouve un lot absent du catalogue local en interrogeant le serveur', async () => {
    const vieux = batch({ id: 'vieux', lot_number: '250101-OLD001', produit: { nom: 'Sucre' } });
    mockedLookup.mockResolvedValue({ kind: 'found', batch: vieux });

    render(<TransformationScreen />);
    await scanLot('250101-OLD001');

    await waitFor(() => expect(screen.getByText('Sucre')).toBeTruthy());
  });

  // « Lot inconnu » quand on n'a PAS PU demander est un mensonge : l'opérateur croirait son
  // étiquette fausse, et remettrait en cause une marchandise parfaitement valide.
  it('ne déclare pas un lot inconnu quand il n’a pas pu le vérifier', async () => {
    mockedLookup.mockResolvedValue({
      kind: 'unverifiable',
      error: new ApiError('Erreur réseau', 0),
    });

    render(<TransformationScreen />);
    await scanLot('LOT-001');

    await waitFor(() =>
      expect(mockedToastMessage).toHaveBeenCalledWith(
        'Lot non vérifié',
        expect.stringContaining('Impossible de confirmer')
      )
    );
    expect(mockedToastMessage).not.toHaveBeenCalledWith('Lot inconnu', expect.anything());
  });

  // ⚠️ LE test de la course. La vérification passe par le réseau : plusieurs scans peuvent être en
  // vol. Seul le DERNIER compte. Sans ça, le MÊME lot parent serait prélevé DEUX FOIS, et la
  // traçabilité enregistrerait une consommation qui n'a pas eu lieu.
  it('n’ajoute qu’une fois le lot parent, même rescanné pendant la vérification', async () => {
    let resolveLookup: (result: BatchLookup) => void = () => undefined;
    mockedLookup.mockReturnValue(
      new Promise<BatchLookup>((resolve) => {
        resolveLookup = resolve;
      })
    );

    mockScannedCode = 'LOT-001';
    render(<TransformationScreen />);
    fireEvent.press(await screen.findByText('Scanner un lot'));

    fireEvent.press(screen.getByTestId('scan-now'));
    fireEvent.press(screen.getByTestId('scan-now'));
    fireEvent.press(screen.getByTestId('scan-now'));

    resolveLookup({ kind: 'found', batch: batch() });

    await waitFor(() => expect(screen.getAllByText('Lait cru')).toHaveLength(1));
  });

  // 🔴 L'opérateur voit qu'il a scanné le mauvais lot et appuie sur la croix. Sans annulation de la
  // vérification en vol, le lot s'ajoutait QUAND MÊME une seconde plus tard — et entrait en cuve.
  it('n’ajoute pas le lot si l’opérateur annule pendant la vérification', async () => {
    let resolveLookup: (result: BatchLookup) => void = () => undefined;
    mockedLookup.mockReturnValue(
      new Promise<BatchLookup>((resolve) => {
        resolveLookup = resolve;
      })
    );

    mockScannedCode = 'LOT-001';
    render(<TransformationScreen />);
    fireEvent.press(await screen.findByText('Scanner un lot'));
    fireEvent.press(screen.getByTestId('scan-now'));

    fireEvent.press(screen.getByTestId('scan-close'));

    resolveLookup({ kind: 'found', batch: batch() });

    await waitFor(() => expect(screen.queryByTestId('scan-now')).toBeNull());
    expect(screen.queryByText('Lait cru')).toBeNull();
  });

  it('montre que la vérification est en cours, au lieu de fermer la modale sur du vide', async () => {
    mockedLookup.mockReturnValue(new Promise<BatchLookup>(() => undefined));

    mockScannedCode = 'LOT-001';
    render(<TransformationScreen />);
    fireEvent.press(await screen.findByText('Scanner un lot'));
    fireEvent.press(screen.getByTestId('scan-now'));

    await waitFor(() => expect(screen.getByText('Vérification du lot…')).toBeTruthy());
  });

  it('prévient qu’un lot est déjà dans la liste au lieu de le prélever deux fois', async () => {
    render(<TransformationScreen />);
    await scanLot('LOT-001');
    await waitFor(() => expect(screen.getByText('Lait cru')).toBeTruthy());

    await scanLot('LOT-001');

    await waitFor(() =>
      expect(mockedToastMessage).toHaveBeenCalledWith(
        'Lot déjà ajouté',
        expect.stringContaining('LOT-001')
      )
    );
    expect(screen.getAllByText('Lait cru')).toHaveLength(1);
  });

  it('explique pourquoi un lot est refusé, au lieu d’« une erreur est survenue »', async () => {
    render(<TransformationScreen />);
    await scanLot('LOT-INCONNU');

    await waitFor(() =>
      expect(mockedToastMessage).toHaveBeenCalledWith(
        'Lot inconnu',
        'Ce code ne correspond à aucun lot de votre organisation.'
      )
    );
  });

  it('refuse au scan un lot en quarantaine', async () => {
    mockedLoadBatches.mockResolvedValue([batch({ statut: 'BLOQUE' })]);

    render(<TransformationScreen />);
    await scanLot('LOT-001');

    await waitFor(() =>
      expect(mockedToastMessage).toHaveBeenCalledWith(
        'Lot LOT-001 inutilisable',
        // L'opérateur lit une PHRASE, pas le code brut du statut.
        expect.stringContaining('quarantaine')
      )
    );
    expect(screen.queryByText('Lait cru')).toBeNull();
  });

  it('refuse au scan un lot dont l’unité est inconnue du serveur', async () => {
    // Sans ce contrôle, le lot s'ajoutait normalement et le bouton d'envoi restait gris À VIE,
    // sans jamais dire lequel des lots était en cause. « U » sort de l'écran de réception.
    mockedLoadBatches.mockResolvedValue([batch({ unite_code: 'U' })]);

    render(<TransformationScreen />);
    await scanLot('LOT-001');

    await waitFor(() =>
      expect(mockedToastMessage).toHaveBeenCalledWith(
        'Lot LOT-001 non transformable',
        expect.stringContaining('« U »')
      )
    );
    expect(screen.queryByText('Lait cru')).toBeNull();
  });

  it('annonce un sur-prélèvement sous le champ, sans attendre le refus du serveur', async () => {
    // Le serveur refuse, mais son message contient l'UUID brut du lot : inexploitable.
    render(<TransformationScreen />);
    await scanLot('LOT-001');
    await waitFor(() => expect(screen.getByText('Lait cru')).toBeTruthy());

    fireEvent.changeText(await screen.findByPlaceholderText('Quantité prélevée (kg)'), '500');

    expect(screen.getByText('Stock insuffisant : 120 disponibles.')).toBeTruthy();
  });

  it('annonce une troisième décimale, que le serveur rejetterait en 422', async () => {
    render(<TransformationScreen />);

    fireEvent.changeText(await screen.findByPlaceholderText('0'), '12.345');

    expect(screen.getByText('Nombre invalide (2 décimales maximum).')).toBeTruthy();
  });
  // (issue #71) La garde de l'accueil ne suffit pas : sur le web, `/transformation` s'ouvre par URL
  // directe, sans jamais passer par les cartes. Sans garde ICI, un `viewer` remplissait le
  // formulaire, l'opération partait en file locale et n'était refusée qu'à la synchronisation.
  it('refuse l’entrée à un viewer au lieu de lui offrir le formulaire', () => {
    mockedUser.mockReturnValue({
      user: { id: 'u1', name: 'Paul', email: 'p@n.local', role: 'viewer', organizationId: 'o1' },
      loading: false,
    });

    render(<TransformationScreen />);

    expect(screen.getByText(/ne permet pas d’enregistrer|ne permet pas d'enregistrer/)).toBeTruthy();
    expect(screen.queryByText(/Enregistrer la transformation/)).toBeNull();
  });
});
