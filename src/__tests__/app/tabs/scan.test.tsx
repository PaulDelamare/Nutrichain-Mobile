import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { Linking, Platform } from 'react-native';
import { router } from 'expo-router';

import ScanScreen from '@/app/(tabs)/scan';
import { lookupBatch } from '@/lib/batches';
import { ApiError } from '@/lib/errors';

const mockOnBarcodeScanned = { current: undefined as ((result: { data: string }) => void) | undefined };

// La permission est pilotable par test : l'écran change de forme selon `granted`/`canAskAgain`.
// Défaut = accordée, pour que les tests de scan ci-dessous voient bien la caméra.
const mockPermission = {
  current: { granted: true, canAskAgain: true } as { granted: boolean; canAskAgain: boolean },
};
const mockRequestPermission = jest.fn();

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  useFocusEffect: (effect: () => void) => effect(),
}));

jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0 }) }));

jest.mock('react-native-toast-message', () => ({ show: jest.fn() }));

// Le scan interroge le serveur : sans ce mock, le test partirait vraiment dans axios.
jest.mock('@/lib/batches', () => ({ lookupBatch: jest.fn() }));

// La caméra est native : on capture le callback qu'elle recevrait pour le déclencher à la main.
jest.mock('expo-camera', () => {
  // Requis dans la factory : jest.mock est hissé avant les imports du module.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Text: RNText } = require('react-native');
  return {
    useCameraPermissions: () => [mockPermission.current, mockRequestPermission],
    CameraView: (props: { onBarcodeScanned?: (r: { data: string }) => void }) => {
      mockOnBarcodeScanned.current = props.onBarcodeScanned;
      return <RNText>camera</RNText>;
    },
  };
});

const mockedRouter = jest.mocked(router);
const mockedLookup = jest.mocked(lookupBatch);

const FOUND = { kind: 'found', batch: { id: 'bat-1' } } as Awaited<ReturnType<typeof lookupBatch>>;
const UNKNOWN = { kind: 'unknown' } as Awaited<ReturnType<typeof lookupBatch>>;
const unverifiable = (error: unknown) =>
  ({ kind: 'unverifiable', error }) as Awaited<ReturnType<typeof lookupBatch>>;

/** L'étiquette réellement imprimée par NutriChain : une URL GS1 Digital Link. */
const NUTRICHAIN_LABEL = 'https://api.nutrichain.fr/gs1/01/3042040209123/10/FRN-77';

describe('écran de scan', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockOnBarcodeScanned.current = undefined;
    mockedLookup.mockResolvedValue(UNKNOWN);
    // Chaque test repart caméra accordée ; les tests de permission écrasent ce défaut.
    mockPermission.current = { granted: true, canAskAgain: true };
    jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
  });

  /**
   * Scanner une palette que NOUS avons montée et étiquetée ouvrait un formulaire de RÉCEPTION :
   * son SSCC retombait dans « inconnu », que cet écran interprète comme « marchandise qui
   * arrive ». Valider aurait créé un doublon de stock sur de la marchandise déjà présente.
   */
  it('ouvre la PALETTE quand le code scanné est un SSCC que nous connaissons', async () => {
    mockedLookup.mockResolvedValue({
      kind: 'pallet',
      pallet: {
        id: 'palette-1',
        sscc: '034567890000000606',
        contient_lot_rappele: false,
        lots: [],
      },
    } as Awaited<ReturnType<typeof lookupBatch>>);
    render(<ScanScreen />);

    mockOnBarcodeScanned.current?.({ data: '00034567890000000606' });

    await waitFor(() => {
      expect(mockedRouter.push).toHaveBeenCalledWith({
        pathname: '/palette/[sscc]',
        params: { sscc: '034567890000000606' },
      });
    });
    expect(mockedRouter.push).not.toHaveBeenCalledWith(
      expect.objectContaining({ pathname: '/reception' })
    );
  });

  it('ouvre la FICHE du lot quand le lot scanné existe déjà', async () => {
    // Le geste le plus évident de la démo : scanner un lot en stock. Il ouvrait un formulaire de
    // RÉCEPTION — l'opérateur réceptionnait une seconde fois une palette déjà entrée.
    mockedLookup.mockResolvedValue(FOUND);
    render(<ScanScreen />);

    mockOnBarcodeScanned.current?.({ data: NUTRICHAIN_LABEL });

    await waitFor(() => {
      expect(mockedRouter.push).toHaveBeenCalledWith({
        pathname: '/batch/[id]',
        params: { id: 'bat-1' },
      });
    });
    // Le code part ENTIER : la résolution est partagée avec la transformation et l'expédition, et
    // c'est ELLE qui décode — en essayant le code brut avant son interprétation.
    expect(mockedLookup).toHaveBeenCalledWith(NUTRICHAIN_LABEL);
  });

  it('ouvre la réception quand le lot n’existe pas (404)', async () => {
    mockedLookup.mockResolvedValue(UNKNOWN);
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
    mockedLookup.mockResolvedValue(unverifiable(new ApiError('Erreur réseau', 0)));
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

  // Un SSCC identifie un COLIS, pas un lot. On le soumet quand même à la résolution — une seule
  // règle pour tous les codes vaut mieux qu'une exception à maintenir — et le serveur tranche.
  // C'est ce que produit le bouton « Simuler un scan » de la démo.
  it('ouvre la réception quand le code désigne un colis, pas un lot', async () => {
    mockedLookup.mockResolvedValue(UNKNOWN);
    render(<ScanScreen />);

    mockOnBarcodeScanned.current?.({ data: '00376112345678901234' });

    await waitFor(() => {
      expect(mockedRouter.push).toHaveBeenCalledWith({
        pathname: '/reception',
        params: { code: '00376112345678901234' },
      });
    });
    expect(mockedLookup).toHaveBeenCalledWith('00376112345678901234');
  });

  // Une session expirée a DÉJÀ renvoyé l'opérateur vers l'écran de connexion (intercepteur 401) :
  // empiler une réception par-dessus le laisserait dans un formulaire qu'il ne pourra jamais
  // envoyer, sous un message parlant de mot de passe incorrect.
  it('n’ouvre pas de réception quand la session a expiré', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Toast = require('react-native-toast-message');
    mockedLookup.mockResolvedValue(unverifiable(new ApiError('Non authentifié', 401, 'auth')));
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
    expect(mockedLookup).not.toHaveBeenCalled();
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
    mockedLookup.mockResolvedValue(FOUND);
    render(<ScanScreen />);

    mockOnBarcodeScanned.current?.({ data: NUTRICHAIN_LABEL });
    await waitFor(() => expect(mockedRouter.push).toHaveBeenCalledTimes(1));

    // La navigation a eu lieu ; la caméra, elle, n'a pas cessé de filmer l'étiquette.
    mockOnBarcodeScanned.current?.({ data: NUTRICHAIN_LABEL });
    mockOnBarcodeScanned.current?.({ data: NUTRICHAIN_LABEL });

    await waitFor(() => expect(mockedLookup).toHaveBeenCalledTimes(1));
    expect(mockedRouter.push).toHaveBeenCalledTimes(1);
  });

  // Mais après un chemin qui NE navigue PAS, le scanner doit rester vivant. Sinon un frigo scanné
  // par mégarde le tue jusqu'au prochain changement d'onglet, sans rien dire.
  it('reste utilisable après un code refusé', async () => {
    render(<ScanScreen />);

    mockOnBarcodeScanned.current?.({ data: 'EQP-A1B2C3D4E5' });
    await waitFor(() => expect(mockedLookup).not.toHaveBeenCalled());

    mockedLookup.mockResolvedValue(FOUND);
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
    mockedLookup.mockResolvedValue(FOUND);
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

  // ─── Caméra refusée : l'app ne doit PAS mourir ─────────────────────────────
  describe('caméra non autorisée', () => {
    // LE bug : l'écran de permission remplaçait TOUT le contenu, saisie manuelle comprise. Un
    // opérateur ayant refusé la caméra ne pouvait plus taper le moindre numéro de lot — app morte.
    it('laisse la saisie manuelle accessible même sans caméra', async () => {
      mockPermission.current = { granted: false, canAskAgain: true };
      mockedLookup.mockResolvedValue(FOUND);
      render(<ScanScreen />);

      const input = screen.getByPlaceholderText('3761234567890123');
      fireEvent.changeText(input, 'FRN-77');
      fireEvent(input, 'submitEditing');

      await waitFor(() => {
        expect(mockedRouter.push).toHaveBeenCalledWith({
          pathname: '/batch/[id]',
          params: { id: 'bat-1' },
        });
      });
    });

    // Tant qu'on peut encore demander, le bouton relance le dialogue système.
    it('redemande l’accès tant que le refus n’est pas définitif', () => {
      mockPermission.current = { granted: false, canAskAgain: true };
      render(<ScanScreen />);

      fireEvent.press(screen.getByText(/^Autoriser l.accès$/));
      expect(mockRequestPermission).toHaveBeenCalledTimes(1);
      expect(Linking.openSettings).not.toHaveBeenCalled();
    });

    // Refus DÉFINITIF (canAskAgain false) : rappeler requestPermission() ne rouvrirait aucun
    // dialogue — bouton mort. On ne le propose donc plus ; on renvoie vers les réglages système.
    it('renvoie vers les réglages quand le refus est définitif', () => {
      mockPermission.current = { granted: false, canAskAgain: false };
      render(<ScanScreen />);

      expect(screen.queryByText(/^Autoriser l.accès$/)).toBeNull();
      fireEvent.press(screen.getByText('Ouvrir les réglages'));
      expect(Linking.openSettings).toHaveBeenCalledTimes(1);
      expect(mockRequestPermission).not.toHaveBeenCalled();
    });

    // ⚠️ (issue #58) Sur le WEB, `Linking.openSettings` n'existe pas (react-native-web) → TypeError,
    // et la démo se fait dans un navigateur. On remplace le bouton par une consigne navigateur ; la
    // saisie manuelle, elle, reste le recours (comme sur natif).
    it('sur le web, remplace « Ouvrir les réglages » par une consigne navigateur', () => {
      const originalOS = Platform.OS;
      Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true });
      try {
        mockPermission.current = { granted: false, canAskAgain: false };
        render(<ScanScreen />);

        expect(screen.getByText(/réglages de votre navigateur/i)).toBeTruthy();
        expect(screen.queryByText('Ouvrir les réglages')).toBeNull();
        expect(Linking.openSettings).not.toHaveBeenCalled();
        // La saisie manuelle survit — le recours quand la caméra manque.
        expect(screen.getByPlaceholderText('3761234567890123')).toBeTruthy();
      } finally {
        Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true });
      }
    });
  });
});
