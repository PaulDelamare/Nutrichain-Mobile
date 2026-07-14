import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import Toast from 'react-native-toast-message';

import AlertDecisionScreen from '@/app/alert/[id]';
import { loadAlertDecision, releaseAndResolve, resolveAlert, type AlertDecision } from '@/lib/alerts';

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
    mockedLoad.mockResolvedValue(decision);
    mockedRelease.mockResolvedValue(undefined);
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
        ['b-1'],
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
});
