import { render, screen, waitFor, fireEvent } from '@testing-library/react-native';

import { router } from 'expo-router';
import Toast from 'react-native-toast-message';

import { useCurrentUser } from '@/hooks/use-current-user';
import { useOnlineStatus } from '@/hooks/use-online-status';
import { loadBatch } from '@/lib/batches';
import { recallReasonError, triggerRecall } from '@/lib/traceability';

import BatchDetailScreen from '@/app/batch/[id]';

jest.mock('@/lib/batches', () => ({ loadBatch: jest.fn() }));
jest.mock('@/lib/traceability');
jest.mock('@/hooks/use-current-user');
jest.mock('@/hooks/use-online-status');
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), navigate: jest.fn() },
  useLocalSearchParams: () => ({ id: 'b1' }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0 }),
}));
jest.mock('react-native-toast-message', () => ({
  __esModule: true,
  default: { show: jest.fn(), hide: jest.fn() },
}));

const mockedLoad = jest.mocked(loadBatch);
const mockedUser = jest.mocked(useCurrentUser);
const mockedOnline = jest.mocked(useOnlineStatus);
const mockedRecall = jest.mocked(triggerRecall);
const mockedToastShow = jest.mocked(Toast.show);

/** `recallReasonError` reste RÉEL : la validation du motif est du vrai code métier, pas un mock. */
const { recallReasonError: realReasonError } =
  jest.requireActual<typeof import('@/lib/traceability')>('@/lib/traceability');

const asRole = (role: string | null) =>
  mockedUser.mockReturnValue({
    user: { id: 'u1', name: 'Paul', email: 'p@n.local', role, organizationId: 'o1' },
    loading: false,
  });

const DETAIL = {
  id: 'b1',
  lotNumber: '260709-ABC',
  statut: 'EN_STOCK',
  produitNom: 'Beurre Doux',
  codeGtin: '3042040209456',
  quantite: 120,
  uniteCode: 'kg',
  datePeremption: null,
  dateCreation: null,
};

describe('fiche lot', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    asRole('quality');
    mockedOnline.mockReturnValue('online');
    jest.mocked(recallReasonError).mockImplementation(realReasonError);
  });

  it('affiche la fiche quand le lot est trouvé', async () => {
    mockedLoad.mockResolvedValue({ kind: 'ok', batch: DETAIL });
    render(<BatchDetailScreen />);

    await waitFor(() => expect(screen.getByText('Beurre Doux')).toBeTruthy());
    expect(screen.getByText('En stock')).toBeTruthy();
  });

  // ⚠️ LE cœur de l'issue : une panne réseau est TRANSITOIRE → on propose de RÉESSAYER, jamais un
  // écran vide muet. (Avant, 403 / réseau / 404 donnaient tous le même « indisponible » sans bouton.)
  it('propose de réessayer sur une panne réseau, et la relance aboutit', async () => {
    mockedLoad.mockResolvedValue({ kind: 'unverifiable', error: new Error('offline') });
    render(<BatchDetailScreen />);

    await waitFor(() => expect(screen.getByText(/Impossible de vérifier/i)).toBeTruthy());

    mockedLoad.mockResolvedValue({ kind: 'ok', batch: DETAIL });
    fireEvent.press(screen.getByText(/Réessayer/i));

    await waitFor(() => expect(screen.getByText('Beurre Doux')).toBeTruthy());
  });

  // Un refus de droits (403) n'est PAS une panne : message clair, et PAS de « Réessayer » (rejouer
  // avec les mêmes droits ne changera rien).
  it('dit clairement un refus d’accès (403), sans Réessayer', async () => {
    mockedLoad.mockResolvedValue({ kind: 'forbidden' });
    render(<BatchDetailScreen />);

    await waitFor(() => expect(screen.getByText(/accès/i)).toBeTruthy());
    expect(screen.queryByText(/Réessayer/i)).toBeNull();
  });

  // Un 404 = lot introuvable : réponse DÉFINITIVE, pas une incertitude → pas de Réessayer.
  it('dit « introuvable » sur un 404, sans Réessayer', async () => {
    mockedLoad.mockResolvedValue({ kind: 'unknown' });
    render(<BatchDetailScreen />);

    await waitFor(() => expect(screen.getByText(/introuvable/i)).toBeTruthy());
    expect(screen.queryByText(/Réessayer/i)).toBeNull();
  });

  // BONUS : EXPEDIE est un vrai statut de l'API — il doit avoir un libellé lisible, pas le code brut.
  it('affiche un libellé lisible pour un statut EXPEDIE (pas le code brut)', async () => {
    mockedLoad.mockResolvedValue({ kind: 'ok', batch: { ...DETAIL, statut: 'EXPEDIE' } });
    render(<BatchDetailScreen />);

    await waitFor(() => expect(screen.getByText('Expédié')).toBeTruthy());
    expect(screen.queryByText('EXPEDIE')).toBeNull();
  });

  // ── (issues #77 / #89) Généalogie et rappel ──────────────────────────────────────────────────

  const showFiche = async () => {
    mockedLoad.mockResolvedValue({ kind: 'ok', batch: DETAIL });
    render(<BatchDetailScreen />);
    await waitFor(() => expect(screen.getByText('Beurre Doux')).toBeTruthy());
  };

  it('ouvre la généalogie — lecture ouverte à TOUS les rôles', async () => {
    // `ALL_ROLES` côté API : même un viewer doit pouvoir remonter la chaîne d'un lot suspect.
    asRole('viewer');
    await showFiche();

    fireEvent.press(screen.getByText('Voir la généalogie'));

    expect(jest.mocked(router.navigate)).toHaveBeenCalledWith('/genealogy/b1');
  });

  /**
   * ⚠️ LE cœur de #89 : l'`operator` — la persona de cette application — est exclu de
   * `QUALITY_ROLES`. Lui offrir le bouton lui vaudrait un 403 après coup, sur l'action la plus
   * destructrice du système. On l'annonce AVANT, en invoquant la raison sanitaire.
   */
  it('refuse le rappel à un operator, en disant pourquoi', async () => {
    asRole('operator');
    await showFiche();

    expect(screen.queryByText('Déclencher un rappel')).toBeNull();
    expect(screen.getByText(/réservé au contrôle qualité/)).toBeTruthy();
  });

  it('distingue « rôle non vérifié » de « pas le droit »', async () => {
    // Accuser quelqu'un d'un manque de droits qu'on n'a pas pu constater serait un mensonge.
    asRole(null);
    await showFiche();

    expect(screen.getByText(/non vérifié/)).toBeTruthy();
    expect(screen.queryByText('Déclencher un rappel')).toBeNull();
  });

  it('n’offre pas le rappel hors réseau : il ne passe pas par la file offline', async () => {
    mockedOnline.mockReturnValue('offline');
    await showFiche();

    expect(screen.queryByText('Déclencher un rappel')).toBeNull();
    expect(screen.getByText(/ne peut pas être mise? en attente/)).toBeTruthy();
  });

  it('exige un motif recevable avant d’ouvrir la confirmation', async () => {
    await showFiche();
    fireEvent.press(screen.getByText('Déclencher un rappel'));

    // Le motif part dans l'e-mail aux clients : « xx » ne dit rien à personne.
    fireEvent.changeText(screen.getByPlaceholderText(/Listeria/), 'xx');

    expect(screen.getByText(/au moins 5 caractères/)).toBeTruthy();
    expect(screen.queryByText('Déclencher le rappel ?')).toBeNull();
  });

  it('déclenche le rappel après confirmation et annonce les lots bloqués', async () => {
    mockedRecall.mockResolvedValue({
      blockedBatchesCount: 7,
      impactedBatchIds: ['b1'],
      affectedShipments: [{ shipmentRef: 'EXP-1', customerName: 'Épicerie' }],
      depthSaturated: false,
    });
    await showFiche();

    fireEvent.press(screen.getByText('Déclencher un rappel'));
    fireEvent.changeText(screen.getByPlaceholderText(/Listeria/), 'Listeria détectée au contrôle');
    fireEvent.press(screen.getByText('Continuer'));

    // `Alert.alert` est un no-op sur le web : la confirmation est un vrai composant, donc visible.
    expect(screen.getByText('Déclencher le rappel ?')).toBeTruthy();
    fireEvent.press(screen.getByText('Déclencher'));

    await waitFor(() =>
      expect(mockedRecall).toHaveBeenCalledWith('b1', 'Listeria détectée au contrôle')
    );
    expect(mockedToastShow).toHaveBeenCalledWith(
      expect.objectContaining({ text1: expect.stringContaining('7 lot(s) bloqué(s)') })
    );
  });

  /**
   * ⚠️ `depthSaturated` : la descendance bloquée peut être INCOMPLÈTE. Annoncer un succès net
   * ferait croire le rappel terminé alors qu'il reste peut-être des lots en rayon.
   */
  it('avoue une descendance possiblement incomplète au lieu d’un succès net', async () => {
    mockedRecall.mockResolvedValue({
      blockedBatchesCount: 7,
      impactedBatchIds: ['b1'],
      affectedShipments: [],
      depthSaturated: true,
    });
    await showFiche();

    fireEvent.press(screen.getByText('Déclencher un rappel'));
    fireEvent.changeText(screen.getByPlaceholderText(/Listeria/), 'Listeria détectée au contrôle');
    fireEvent.press(screen.getByText('Continuer'));
    fireEvent.press(screen.getByText('Déclencher'));

    await waitFor(() =>
      expect(mockedToastShow).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'error',
          text2: expect.stringContaining('INCOMPLÈTE'),
        })
      )
    );
  });
});
