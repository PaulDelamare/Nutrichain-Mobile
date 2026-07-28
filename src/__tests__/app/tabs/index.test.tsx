import { render, screen, waitFor, fireEvent } from '@testing-library/react-native';
import { router } from 'expo-router';

import { useCurrentUser } from '@/hooks/use-current-user';
import { useOnlineStatus } from '@/hooks/use-online-status';
import { loadActiveColdAlerts } from '@/lib/alerts';
import { loadQuarantineBatches } from '@/lib/quarantine';
import { countByStatus } from '@/lib/sync/queue';

import HomeScreen from '@/app/(tabs)/index';

// Ces suites exercent les écrans AVEC une session : la garde de session est testée séparément
// (`_layout.test.tsx`), et la sémantique de `canWrite` dans `roles.test.ts` (#102).
jest.mock('@/hooks/use-auth-status', () => ({ useAuthStatus: () => 'authenticated' }));
jest.mock('@/hooks/use-current-user');
jest.mock('@/hooks/use-online-status');
jest.mock('@/lib/alerts');
jest.mock('@/lib/quarantine');
jest.mock('@/lib/sync/queue');
jest.mock('expo-router', () => ({
  router: { navigate: jest.fn() },
  useFocusEffect: (effect: () => void) => effect(),
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0 }) }));

const mockedRouter = jest.mocked(router);
const mockedUser = jest.mocked(useCurrentUser);
const mockedOnline = jest.mocked(useOnlineStatus);
const mockedAlerts = jest.mocked(loadActiveColdAlerts);
const mockedQuarantine = jest.mocked(loadQuarantineBatches);
const mockedCounts = jest.mocked(countByStatus);

function counts(overrides: Partial<Record<'PENDING' | 'SYNCED' | 'CONFLICT' | 'REJECTED', number>> = {}) {
  mockedCounts.mockResolvedValue({ PENDING: 0, SYNCED: 0, CONFLICT: 0, REJECTED: 0, ...overrides });
}

const quarantineBatch = (id: string) => ({
  id,
  lotNumber: `LOT-${id}`,
  produitNom: 'Lait cru',
  quantite: 1,
  uniteCode: 'kg',
  datePeremption: null,
  dateCreation: '2026-07-01T08:00:00.000Z',
});

describe('écran d’accueil', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedUser.mockReturnValue({ user: null, loading: false });
    mockedOnline.mockReturnValue('online');
    mockedAlerts.mockResolvedValue({ kind: 'ok', alerts: [] });
    mockedQuarantine.mockResolvedValue({ kind: 'ok', batches: [] });
    counts();
  });

  it('ne prétend PAS « En ligne » tant qu’il n’a pas interrogé le serveur', async () => {
    // Le badge démarrait à « En ligne » par défaut : il affirmait exactement ce qu'il ignorait.
    mockedOnline.mockReturnValue('checking');

    render(<HomeScreen />);

    await waitFor(() => expect(screen.getByText('Vérification…')).toBeTruthy());
    expect(screen.queryByText('En ligne')).toBeNull();
    expect(screen.queryByText('Hors ligne')).toBeNull();
  });

  it('annonce l’état réseau réel', async () => {
    // Le badge était codé en dur : hors réseau, l'app affichait quand même « En ligne »,
    // et l'opérateur croyait ses scans partis alors qu'ils dormaient en file.
    mockedOnline.mockReturnValue('offline');

    render(<HomeScreen />);

    await waitFor(() => expect(screen.getByText('Hors ligne')).toBeTruthy());
    expect(screen.queryByText('En ligne')).toBeNull();
  });

  it('affiche le nombre de scans en attente d’envoi', async () => {
    counts({ PENDING: 7 });

    render(<HomeScreen />);

    await waitFor(() => expect(screen.getByText('7')).toBeTruthy());
    expect(screen.getByText('EN ATTENTE SYNC')).toBeTruthy();
  });

  it('regroupe les scans bloqués sous « à corriger »', async () => {
    // Conflits et rejets demandent tous deux une décision humaine : les compter séparément
    // laisserait croire à l'opérateur qu'il n'a rien à faire.
    counts({ CONFLICT: 2, REJECTED: 3 });

    render(<HomeScreen />);

    await waitFor(() => expect(screen.getByText('À CORRIGER')).toBeTruthy());
    expect(screen.getByText('5')).toBeTruthy();
  });

  it('affiche l’alerte chaîne du froid en cours', async () => {
    mockedAlerts.mockResolvedValue({
      kind: 'ok',
      alerts: [
        { id: '1', type: 'TEMP_EXCURSION', statut: 'ACTIVE', message: 'Palette SSCC 00376 — +4.2 °C' },
      ],
    });

    render(<HomeScreen />);

    await waitFor(() => expect(screen.getByText(/Palette SSCC 00376/)).toBeTruthy());
  });

  it('reste affiché quand la base locale est en erreur', async () => {
    // Un échec SQLite ne doit pas faire tomber l'accueil : l'opérateur garde son écran.
    mockedCounts.mockRejectedValue(new Error('base corrompue'));

    render(<HomeScreen />);

    await waitFor(() => expect(screen.getByText('Scanner un lot')).toBeTruthy());
  });

  // ⚠️ LE test. « ALERTES FROID : 0 » sur une panne réseau, c'est la seule information sanitaire de
  // l'écran qui annonce « tout va bien » — pendant une excursion thermique. L'ancien test vérifiait
  // que l'app renvoyait `[]` : il CANONISAIT le mensonge.
  it('n’affiche pas « 0 » alerte froid quand il n’a pas pu vérifier', async () => {
    mockedAlerts.mockResolvedValue({ kind: 'unverifiable', error: new Error('offline') });

    render(<HomeScreen />);

    await waitFor(() => expect(screen.getByText(/Alertes froid non vérifiées/)).toBeTruthy());
    expect(screen.getByText('ALERTES FROID')).toBeTruthy();
    // Le « — » est présent, et surtout AUCUN zéro rassurant sous cette carte.
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  // « Tout est à jour » est une AFFIRMATION, plus grave encore que le chiffre : l'écran l'écrivait
  // sous le bouton Synchroniser alors que la file était ILLISIBLE.
  it('ne dit pas « Tout est à jour » quand la file est illisible', async () => {
    mockedCounts.mockRejectedValue(new Error('base corrompue'));

    render(<HomeScreen />);

    await waitFor(() => expect(screen.getByText('File non vérifiée')).toBeTruthy());
    expect(screen.queryByText('Tout est à jour')).toBeNull();
  });

  it('ne montre aucun chiffre avant d’avoir rien vérifié', async () => {
    // Au tout premier rendu, les compteurs valaient 0 : un chiffre rassurant que personne n'avait
    // demandé. Un compteur non chargé n'est pas un compteur à zéro.
    mockedCounts.mockReturnValue(new Promise(() => undefined));
    mockedAlerts.mockReturnValue(new Promise(() => undefined));
    mockedQuarantine.mockReturnValue(new Promise(() => undefined));

    render(<HomeScreen />);

    await waitFor(() => expect(screen.getByText('EN ATTENTE SYNC')).toBeTruthy());
    expect(screen.queryByText('0')).toBeNull();
    expect(screen.queryByText('Tout est à jour')).toBeNull();
  });

  // ⚠️ « Je charge » et « je n'ai pas pu » ne sont PAS la même chose. Les confondre ferait clignoter
  // un message d'ÉCHEC à chaque ouverture de l'application — un mensonge à l'envers, celui-là.
  it('ne crie pas à l’échec pendant un chargement normal', async () => {
    mockedAlerts.mockReturnValue(new Promise(() => undefined));
    mockedCounts.mockReturnValue(new Promise(() => undefined));

    render(<HomeScreen />);

    await waitFor(() => expect(screen.getByText('ALERTES FROID')).toBeTruthy());
    expect(screen.queryByText(/Alertes froid non vérifiées/)).toBeNull();
    expect(screen.queryByText('File non vérifiée')).toBeNull();
  });

  // (issue #32) Les lots bloqués par un contrôle qualité étaient invisibles : personne sur le
  // terrain ne savait qu'ils existaient. L'accueil les surface et mène à leur écran.
  it('surface les lots en quarantaine et mène à leur écran', async () => {
    mockedQuarantine.mockResolvedValue({
      kind: 'ok',
      batches: [quarantineBatch('1'), quarantineBatch('2'), quarantineBatch('3')],
    });

    render(<HomeScreen />);

    await waitFor(() => expect(screen.getByText('Lots en quarantaine')).toBeTruthy());
    expect(screen.getByText('3')).toBeTruthy();

    fireEvent.press(screen.getByText('Lots en quarantaine'));
    expect(mockedRouter.navigate).toHaveBeenCalledWith('/quarantine');
  });

  // ⚠️ Même règle que les alertes froid : sur une panne réseau, PAS de « 0 » rassurant sous la
  // quarantaine — on avoue « — ». Un opérateur ne doit jamais croire « rien de bloqué » à tort.
  it('n’affiche pas « 0 » lot en quarantaine quand il n’a pas pu vérifier', async () => {
    mockedQuarantine.mockResolvedValue({ kind: 'unverifiable', error: new Error('offline') });

    render(<HomeScreen />);

    await waitFor(() => expect(screen.getByText('Lots en quarantaine')).toBeTruthy());
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  // (issue #71) L'accueil offrait les quatre cartes à TOUS les rôles. Un `viewer` pouvait ouvrir la
  // réception, scanner, saisir, valider — l'opération partait en file locale et n'était refusée
  // qu'à la synchronisation (403 → REJECTED). Le travail était perdu après coup, sans prévenir.
  const asRole = (role: string | null) =>
    mockedUser.mockReturnValue({
      user: { id: 'u1', name: 'Paul', email: 'paul@nutrichain.local', role, organizationId: 'o1' },
      loading: false,
    });

  it('n’ouvre pas la réception à un viewer, et dit pourquoi', () => {
    asRole('viewer');

    render(<HomeScreen />);
    fireEvent.press(screen.getByText('Réception'));

    // Un bouton qui mène à un échec différé est pire qu'un bouton absent.
    expect(mockedRouter.navigate).not.toHaveBeenCalledWith('/reception');
    expect(screen.getByText(/ne permet pas d’enregistrer|ne permet pas d'enregistrer/)).toBeTruthy();
  });

  it('ferme aussi la transformation et l’expédition au viewer', () => {
    asRole('viewer');

    render(<HomeScreen />);
    fireEvent.press(screen.getByText('Transformation'));
    fireEvent.press(screen.getByText('Expédition'));

    expect(mockedRouter.navigate).not.toHaveBeenCalledWith('/transformation');
    expect(mockedRouter.navigate).not.toHaveBeenCalledWith('/expedition');
  });

  it('laisse la synchronisation ouverte à tous : elle n’écrit rien de neuf', () => {
    // Purger sa propre file locale n'est pas une écriture métier — la fermer punirait un `viewer`
    // qui a des opérations en attente d'un rôle qu'il avait avant.
    asRole('viewer');

    render(<HomeScreen />);
    fireEvent.press(screen.getByText('Synchroniser'));

    expect(mockedRouter.navigate).toHaveBeenCalledWith('/sync');
  });

  it('ne gêne pas l’opérateur, qui a le droit d’écrire', () => {
    asRole('operator');

    render(<HomeScreen />);
    fireEvent.press(screen.getByText('Réception'));

    expect(mockedRouter.navigate).toHaveBeenCalledWith('/reception');
  });

  // ⚠️ Le cas offline-first : `/api/me` exige le réseau. Un rôle inconnu ne doit PAS fermer
  // l'écriture, sinon l'app s'auto-condamne en chambre froide — là où elle sert.
  it('laisse passer quand le rôle est inconnu', () => {
    asRole(null);

    render(<HomeScreen />);
    fireEvent.press(screen.getByText('Réception'));

    expect(mockedRouter.navigate).toHaveBeenCalledWith('/reception');
  });
});
