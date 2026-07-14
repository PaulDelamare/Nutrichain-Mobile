import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import Toast from 'react-native-toast-message';

import AlertDecisionScreen from '@/app/alert/[id]';
import { loadAlertDecision, releaseAndResolve, resolveAlert, type AlertDecision } from '@/lib/alerts';
import { ApiError } from '@/lib/errors';

jest.mock('@/lib/alerts', () => ({
  ...jest.requireActual('@/lib/alerts'),
  loadAlertDecision: jest.fn(),
  releaseAndResolve: jest.fn(),
  resolveAlert: jest.fn(),
}));
jest.mock('@/lib/toast');
jest.mock('react-native-toast-message', () => ({ show: jest.fn() }));
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), navigate: jest.fn() },
  useLocalSearchParams: () => ({ id: 'alert-1' }),
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));

const mockedLoad = jest.mocked(loadAlertDecision);
const mockedRelease = jest.mocked(releaseAndResolve);
const mockedResolve = jest.mocked(resolveAlert);
const mockedToast = jest.mocked(Toast);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const mockedRouter = jest.mocked((require('expo-router') as { router: { back: jest.Mock } }).router);

const decision: AlertDecision = {
  alert: {
    id: 'alert-1',
    type: 'TEMPERATURE',
    statut: 'ACTIVE',
    message: 'Excursion thermique — Frigo A',
    niveau_gravite: 'PANIC',
    created_at: '2026-07-14T08:00:00.000Z',
  },
  equipmentNom: 'Frigo A',
  lieuNom: 'Site Loire',
  tempMesuree: 12.4,
  tempSeuilMax: 4,
  batches: [
    { id: 'b-1', lotNumber: 'LOT-001', produitNom: 'Lait cru', quantite: 200, uniteCode: 'L' },
  ],
};

/** Le libellé de confirmation vit dans la modale, rendue en dernier. */
function confirmDialog(label: string): void {
  const buttons = screen.getAllByText(label);
  fireEvent.press(buttons[buttons.length - 1]);
}

async function ouvrirLEcran() {
  render(<AlertDecisionScreen />);
  await waitFor(() => expect(screen.getByText('Enregistrer sans isolation')).toBeTruthy());
}

describe('écran de décision sur une alerte froid', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedLoad.mockResolvedValue({ kind: 'active', decision });
    mockedRelease.mockResolvedValue({
      released: decision.batches,
      stillBlocked: [],
      alertResolved: true,
    });
    mockedResolve.mockResolvedValue(undefined);
  });

  // ⚠️ LE test de cet écran. Lever une quarantaine remet en stock des lots que la chaîne du froid a
  // isolés : c'est irréversible et tracé dans l'audit. La confirmation passait par `Alert.alert` —
  // un no-op littéral sur le web, où se fait la DÉMO : le bouton était MORT. On cliquait, rien.
  it('lève la quarantaine après confirmation — le bouton n’est plus mort', async () => {
    await ouvrirLEcran();

    fireEvent.changeText(
      screen.getByPlaceholderText(/isolation immédiate/i),
      'Mesure thermique répétée, produit conforme'
    );
    fireEvent.press(screen.getByText('Enregistrer sans isolation'));

    // Une décision irréversible ne part pas sur un simple effleurement.
    expect(mockedRelease).not.toHaveBeenCalled();

    confirmDialog('Lever');

    await waitFor(() =>
      expect(mockedRelease).toHaveBeenCalledWith(
        'alert-1',
        // On passe les LOTS, pas seulement leurs identifiants : le compte-rendu d'une levée
        // partielle doit pouvoir nommer ceux qui sont partis et ceux qui restent.
        [expect.objectContaining({ id: 'b-1' })],
        'Mesure thermique répétée, produit conforme'
      )
    );
  });

  it('n’ouvre même pas la confirmation sans motif : l’API l’exige, et l’audit aussi', async () => {
    await ouvrirLEcran();

    fireEvent.press(screen.getByText('Enregistrer sans isolation'));

    expect(screen.queryByText('Lever la quarantaine ?')).toBeNull();
    expect(mockedToast.show).toHaveBeenCalledWith(
      expect.objectContaining({ text1: 'Motif requis' })
    );
  });

  it('annuler la confirmation ne lève RIEN', async () => {
    await ouvrirLEcran();

    fireEvent.changeText(screen.getByPlaceholderText(/isolation immédiate/i), 'Motif valable');
    fireEvent.press(screen.getByText('Enregistrer sans isolation'));

    await waitFor(() => expect(screen.getByText('Lever la quarantaine ?')).toBeTruthy());
    fireEvent.press(screen.getByText('Annuler'));

    expect(mockedRelease).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByText('Lever la quarantaine ?')).toBeNull());
  });

  it('maintenir la quarantaine clôture l’alerte sans remettre les lots en stock', async () => {
    await ouvrirLEcran();

    fireEvent.press(screen.getByText('Maintenir la quarantaine'));

    await waitFor(() => expect(mockedResolve).toHaveBeenCalledWith('alert-1', ''));
    expect(mockedRelease).not.toHaveBeenCalled();
  });

  // ⚠️ LE test. Sur une panne réseau, l'écran affichait « Alerte introuvable — elle a peut-être déjà
  // été résolue sur un autre poste », AVEC UNE COCHE VERTE. À un opérateur qui est dans une chambre
  // froide, sans réseau, devant une excursion thermique en cours.
  it('ne dit PAS « déjà résolue » quand il n’a pas pu vérifier', async () => {
    mockedLoad.mockResolvedValue({ kind: 'unverifiable', error: new ApiError('Erreur réseau', 0) });

    render(<AlertDecisionScreen />);

    await waitFor(() =>
      expect(screen.getByText(/Impossible de vérifier cette alerte/)).toBeTruthy()
    );
    expect(screen.getByText(/n’est PAS résolue pour autant/)).toBeTruthy();
    expect(screen.queryByText(/déjà résolue/)).toBeNull();
  });

  it('permet de réessayer au lieu de laisser l’opérateur dans un cul-de-sac', async () => {
    mockedLoad.mockResolvedValueOnce({
      kind: 'unverifiable',
      error: new ApiError('Erreur réseau', 0),
    });
    mockedLoad.mockResolvedValue({ kind: 'active', decision });

    render(<AlertDecisionScreen />);

    await waitFor(() => expect(screen.getByText('↻ Réessayer')).toBeTruthy());
    fireEvent.press(screen.getByText('↻ Réessayer'));

    await waitFor(() => expect(screen.getByText('Enregistrer sans isolation')).toBeTruthy());
  });

  // « Absente de la liste » ne veut PAS dire « résolue » : l'API ne filtre rien, une alerte résolue
  // y figure encore. Absente = identifiant inconnu. Pas de coche verte rassurante.
  it('dit « inconnue », pas « résolue », sur un identifiant absent', async () => {
    mockedLoad.mockResolvedValue({ kind: 'unknown' });

    render(<AlertDecisionScreen />);

    await waitFor(() => expect(screen.getByText(/Alerte inconnue/)).toBeTruthy());
    expect(screen.queryByText(/déjà résolue/)).toBeNull();
  });

  // Le VRAI « déjà résolue ». Avant, l'écran rouvrait l'incident ENTIER, boutons actifs — et
  // « Maintenir la quarantaine » répondait 200 (endpoint idempotent) : un toast de SUCCÈS sur des
  // lots déjà remis en stock.
  it('ne rouvre pas l’incident sur une alerte déjà clôturée', async () => {
    mockedLoad.mockResolvedValue({ kind: 'resolved', alert: decision.alert });

    render(<AlertDecisionScreen />);

    await waitFor(() => expect(screen.getByText(/Alerte déjà résolue/)).toBeTruthy());
    expect(screen.queryByText('Maintenir la quarantaine')).toBeNull();
    expect(screen.queryByText('Enregistrer sans isolation')).toBeNull();
  });

  // Sans lot isolé, la levée boucle sur RIEN : elle ne relâche rien, clôture l'alerte, et annonce
  // « Lot(s) remis en stock ». Le bouton ne doit pas exister.
  it('ne propose pas de lever une quarantaine quand aucun lot n’est isolé', async () => {
    mockedLoad.mockResolvedValue({
      kind: 'active',
      decision: { ...decision, batches: [] },
    });

    render(<AlertDecisionScreen />);

    await waitFor(() => expect(screen.getByText(/Aucun lot isolé/)).toBeTruthy());
    expect(screen.queryByText('Enregistrer sans isolation')).toBeNull();
  });

  // ⚠️ LE test. La boucle n'est pas atomique. Si le 3e lot échoue, les deux premiers sont DÉJÀ
  // remis en stock — et l'écran affichait « Levée impossible ». L'opérateur repartait convaincu
  // que sa marchandise suspectée d'excursion thermique était toujours isolée.
  it('DIT qu’une levée est partielle au lieu d’annoncer un échec total', async () => {
    const autre = { ...decision.batches[0], id: 'b-2', lotNumber: 'LOT-002' };
    mockedLoad.mockResolvedValue({
      kind: 'active',
      decision: { ...decision, batches: [decision.batches[0], autre] },
    });
    mockedRelease.mockResolvedValue({
      released: [decision.batches[0]],
      stillBlocked: [autre],
      alertResolved: false,
      error: new ApiError('Boom', 500),
    });

    render(<AlertDecisionScreen />);
    await waitFor(() => expect(screen.getByText('Enregistrer sans isolation')).toBeTruthy());

    fireEvent.changeText(screen.getByPlaceholderText(/isolation immédiate/i), 'Motif valable');
    fireEvent.press(screen.getByText('Enregistrer sans isolation'));
    confirmDialog('Lever');

    // Un bandeau PERSISTANT : un toast disparaît, et l'opérateur reviendrait sur un écran
    // identique sans savoir que de la marchandise est déjà repartie en stock.
    await waitFor(() => expect(screen.getByText(/Levée incomplète/)).toBeTruthy());
    expect(screen.getByText(/1 lot\(s\) déjà remis en stock/)).toBeTruthy();
    expect(screen.getByText(/1 encore isolé/)).toBeTruthy();
    // On ne revient PAS en arrière : l'opérateur doit voir les lots restants.
    expect(mockedRouter.back).not.toHaveBeenCalled();
  });

  // Sans lot isolé, dire « lot(s) laissé(s) en quarantaine » est un FAUX TÉMOIGNAGE : ils sont
  // tous en stock. C'est le mensonge que le correctif aurait simplement DÉPLACÉ.
  it('ne prétend pas « laisser des lots en quarantaine » quand il n’y en a plus', async () => {
    mockedLoad.mockResolvedValue({ kind: 'active', decision: { ...decision, batches: [] } });

    render(<AlertDecisionScreen />);
    await waitFor(() => expect(screen.getByText('Maintenir la quarantaine')).toBeTruthy());

    fireEvent.press(screen.getByText('Maintenir la quarantaine'));

    await waitFor(() =>
      expect(mockedToast.show).toHaveBeenCalledWith(
        expect.objectContaining({ text1: 'Alerte clôturée' })
      )
    );
    expect(mockedToast.show).not.toHaveBeenCalledWith(
      expect.objectContaining({ text1: 'Quarantaine maintenue' })
    );
  });
});