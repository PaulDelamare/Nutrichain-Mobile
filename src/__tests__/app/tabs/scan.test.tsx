import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';

import ScanScreen from '@/app/(tabs)/scan';
import { resolveBatch } from '@/lib/batches';
import { ApiError } from '@/lib/errors';

const mockOnBarcodeScanned = { current: undefined as ((result: { data: string }) => void) | undefined };

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  useFocusEffect: (effect: () => void) => effect(),
}));

jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0 }) }));

jest.mock('react-native-toast-message', () => ({ show: jest.fn() }));

// Le scan interroge le serveur : sans ce mock, le test partirait vraiment dans axios.
jest.mock('@/lib/batches', () => ({ resolveBatch: jest.fn() }));

// La caméra est native : on capture le callback qu'elle recevrait pour le déclencher à la main.
jest.mock('expo-camera', () => {
  // Requis dans la factory : jest.mock est hissé avant les imports du module.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Text: RNText } = require('react-native');
  return {
    useCameraPermissions: () => [{ granted: true }, jest.fn()],
    CameraView: (props: { onBarcodeScanned?: (r: { data: string }) => void }) => {
      mockOnBarcodeScanned.current = props.onBarcodeScanned;
      return <RNText>camera</RNText>;
    },
  };
});

const mockedRouter = jest.mocked(router);
const mockedResolveBatch = jest.mocked(resolveBatch);

const A_BATCH = { id: 'bat-1', lotNumber: 'FRN-77' } as Awaited<ReturnType<typeof resolveBatch>>;

/** L'étiquette réellement imprimée par NutriChain : une URL GS1 Digital Link. */
const NUTRICHAIN_LABEL = 'https://api.nutrichain.fr/gs1/01/3042040209123/10/FRN-77';

describe('écran de scan', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockOnBarcodeScanned.current = undefined;
    mockedResolveBatch.mockResolvedValue(null);
  });

  it('ouvre la FICHE du lot quand le lot scanné existe déjà', async () => {
    // Le geste le plus évident de la démo : scanner un lot en stock. Il ouvrait un formulaire de
    // RÉCEPTION — l'opérateur réceptionnait une seconde fois une palette déjà entrée.
    mockedResolveBatch.mockResolvedValue(A_BATCH);
    render(<ScanScreen />);

    mockOnBarcodeScanned.current?.({ data: NUTRICHAIN_LABEL });

    await waitFor(() => {
      expect(mockedRouter.push).toHaveBeenCalledWith({
        pathname: '/batch/[id]',
        params: { id: 'bat-1' },
      });
    });
    // Le numéro de lot est extrait de l'URL : le code brut ne résoudrait jamais rien.
    expect(mockedResolveBatch).toHaveBeenCalledWith('FRN-77');
  });

  it('ouvre la réception quand le lot n’existe pas (404)', async () => {
    mockedResolveBatch.mockResolvedValue(null);
    render(<ScanScreen />);

    mockOnBarcodeScanned.current?.({ data: NUTRICHAIN_LABEL });

    await waitFor(() => {
      expect(mockedRouter.push).toHaveBeenCalledWith({
        pathname: '/reception',
        params: { code: NUTRICHAIN_LABEL },
      });
    });
  });

  // Hors réseau, on ne SAIT PAS si le lot existe. Le déclarer inconnu recréerait le doublon que
  // toute cette chaîne cherche à éviter : on ouvre la réception, mais on le DIT.
  it('avertit qu’un lot n’a pas pu être vérifié quand le réseau manque', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Toast = require('react-native-toast-message');
    mockedResolveBatch.mockRejectedValue(new ApiError('Erreur réseau', 0));
    render(<ScanScreen />);

    mockOnBarcodeScanned.current?.({ data: NUTRICHAIN_LABEL });

    await waitFor(() => {
      expect(Toast.show).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error', text1: 'Lot non vérifié' })
      );
    });
    expect(mockedRouter.push).toHaveBeenCalledWith({
      pathname: '/reception',
      params: { code: NUTRICHAIN_LABEL },
    });
  });

  // Un SSCC identifie un COLIS, pas un lot : il n'y a rien à résoudre. Sans ce test, supprimer la
  // garde `if (!parsed.lotNumber)` — donc interroger le serveur avec un numéro de lot vide —
  // passait inaperçu. C'est aussi ce que produit le bouton « Simuler un scan » de la démo.
  it('ouvre la réception sans interroger le serveur quand le code ne porte aucun lot', async () => {
    render(<ScanScreen />);

    mockOnBarcodeScanned.current?.({ data: '00376112345678901234' });

    await waitFor(() => {
      expect(mockedRouter.push).toHaveBeenCalledWith({
        pathname: '/reception',
        params: { code: '00376112345678901234' },
      });
    });
    expect(mockedResolveBatch).not.toHaveBeenCalled();
  });

  // Une session expirée a DÉJÀ renvoyé l'opérateur vers l'écran de connexion (intercepteur 401) :
  // empiler une réception par-dessus le laisserait dans un formulaire qu'il ne pourra jamais
  // envoyer, sous un message parlant de mot de passe incorrect.
  it('n’ouvre pas de réception quand la session a expiré', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Toast = require('react-native-toast-message');
    mockedResolveBatch.mockRejectedValue(new ApiError('Non authentifié', 401, 'auth'));
    render(<ScanScreen />);

    mockOnBarcodeScanned.current?.({ data: NUTRICHAIN_LABEL });

    await waitFor(() => {
      expect(Toast.show).toHaveBeenCalledWith(
        expect.objectContaining({ text1: 'Scan impossible' })
      );
    });
    expect(mockedRouter.push).not.toHaveBeenCalled();
  });

  it('refuse l’étiquette d’un frigo : ce n’est pas un lot', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Toast = require('react-native-toast-message');
    render(<ScanScreen />);

    mockOnBarcodeScanned.current?.({ data: 'EQP-A1B2C3D4E5' });

    await waitFor(() => {
      expect(Toast.show).toHaveBeenCalledWith(
        expect.objectContaining({ text1: 'Ceci est un emplacement' })
      );
    });
    expect(mockedRouter.push).not.toHaveBeenCalled();
    expect(mockedResolveBatch).not.toHaveBeenCalled();
  });

  it('n’ouvre qu’un écran malgré une rafale de la caméra', async () => {
    render(<ScanScreen />);

    mockOnBarcodeScanned.current?.({ data: NUTRICHAIN_LABEL });
    mockOnBarcodeScanned.current?.({ data: NUTRICHAIN_LABEL });

    await waitFor(() => expect(mockedRouter.push).toHaveBeenCalledTimes(1));
  });

  // LE test du verrou. Un `push` ne démonte pas l'onglet : la caméra reste montée SOUS l'écran
  // ouvert et continue de lire la même étiquette. Relâcher le verrou après une navigation — ce que
  // ferait un `try/finally` naïf — empilerait donc une deuxième fiche, puis une troisième.
  // La rafale ci-dessus ne le prouve PAS : ses deux lectures partent avant la fin de l'await.
  it('ne rouvre pas la fiche quand la caméra continue de lire après la navigation', async () => {
    mockedResolveBatch.mockResolvedValue(A_BATCH);
    render(<ScanScreen />);

    mockOnBarcodeScanned.current?.({ data: NUTRICHAIN_LABEL });
    await waitFor(() => expect(mockedRouter.push).toHaveBeenCalledTimes(1));

    // La navigation a eu lieu ; la caméra, elle, n'a pas cessé de filmer l'étiquette.
    mockOnBarcodeScanned.current?.({ data: NUTRICHAIN_LABEL });
    mockOnBarcodeScanned.current?.({ data: NUTRICHAIN_LABEL });

    await waitFor(() => expect(mockedResolveBatch).toHaveBeenCalledTimes(1));
    expect(mockedRouter.push).toHaveBeenCalledTimes(1);
  });

  // Mais après un chemin qui NE navigue PAS, le scanner doit rester vivant. Sinon un frigo scanné
  // par mégarde le tue jusqu'au prochain changement d'onglet, sans rien dire.
  it('reste utilisable après un code refusé', async () => {
    render(<ScanScreen />);

    mockOnBarcodeScanned.current?.({ data: 'EQP-A1B2C3D4E5' });
    await waitFor(() => expect(mockedResolveBatch).not.toHaveBeenCalled());

    mockedResolveBatch.mockResolvedValue(A_BATCH);
    mockOnBarcodeScanned.current?.({ data: NUTRICHAIN_LABEL });

    await waitFor(() => {
      expect(mockedRouter.push).toHaveBeenCalledWith({
        pathname: '/batch/[id]',
        params: { id: 'bat-1' },
      });
    });
  });

  it('accepte une saisie manuelle et ignore une saisie vide', async () => {
    // Le scanner échoue sur un code abîmé ou givré : la saisie manuelle est le recours.
    mockedResolveBatch.mockResolvedValue(A_BATCH);
    render(<ScanScreen />);

    const input = screen.getByPlaceholderText('3761234567890123');

    fireEvent.changeText(input, '   ');
    expect(mockedRouter.push).not.toHaveBeenCalled();

    fireEvent.changeText(input, '  FRN-77  ');
    fireEvent(input, 'submitEditing');

    await waitFor(() => {
      expect(mockedRouter.push).toHaveBeenCalledWith({
        pathname: '/batch/[id]',
        params: { id: 'bat-1' },
      });
    });
  });
});
