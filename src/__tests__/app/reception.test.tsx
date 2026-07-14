import { render, screen, waitFor, fireEvent } from '@testing-library/react-native';

import { loadProducts, loadSuppliers } from '@/lib/catalog';
import { loadEquipment } from '@/lib/equipment';
import { enqueueReceipt } from '@/lib/sync/queue';
import { syncPendingOperations } from '@/lib/sync/sync';
import { ApiError } from '@/lib/errors';

import ReceptionScreen from '@/app/reception';

jest.mock('@/lib/catalog');
jest.mock('@/lib/equipment');
jest.mock('@/lib/sync/queue');
jest.mock('@/lib/sync/sync');
jest.mock('expo-router', () => ({
  router: { back: jest.fn() },
  useLocalSearchParams: () => ({}),
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0 }) }));
jest.mock('react-native-toast-message', () => ({ show: jest.fn() }));

const catalog = jest.mocked({ loadProducts, loadSuppliers });
const mockedLoadEquipment = jest.mocked(loadEquipment);
const mockedEnqueue = jest.mocked(enqueueReceipt);
const mockedSync = jest.mocked(syncPendingOperations);

/** Remplit tous les champs obligatoires pour que « Enregistrer » soit actif. Le statut de
 *  contrôle reste au défaut (« Conforme »/OK) — chaque test le change s'il le veut. */
async function fillValidReceipt(): Promise<void> {
  await waitFor(() => expect(screen.getByText('Ferme Dupont')).toBeTruthy());
  fireEvent.press(screen.getByText('Ferme Dupont'));
  // Sélectionner le produit renseigne l'unité (kg) depuis son unite_reference.
  fireEvent.press(screen.getByText('Lait cru'));
  fireEvent.changeText(screen.getByPlaceholderText('SHIP-2026-001'), 'SHIP-1');
  fireEvent.changeText(screen.getByPlaceholderText('0'), '10');
}

describe('écran de réception', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    catalog.loadSuppliers.mockResolvedValue([{ id: 'f-1', nom_ferme: 'Ferme Dupont' }]);
    catalog.loadProducts.mockResolvedValue([
      { id: 'p-1', nom: 'Lait cru', unite_reference: 'kg' },
    ]);
    mockedLoadEquipment.mockResolvedValue([]);
    mockedEnqueue.mockResolvedValue('op-1');
    mockedSync.mockResolvedValue({ sent: 0, synced: 0, conflicts: 0, rejected: 0, retried: 0 });
  });

  it('reste utilisable quand la liste des emplacements est indisponible', async () => {
    // L'emplacement est optionnel, le catalogue ne l'est pas. Les charger ensemble ferait
    // échouer TOUTE la saisie dès que les matériels manquent du cache — c'est-à-dire au
    // premier lancement hors réseau après une mise à jour. La réception serait impossible
    // là où l'application doit précisément servir.
    mockedLoadEquipment.mockRejectedValue(new ApiError('Erreur réseau', 0));

    render(<ReceptionScreen />);

    await waitFor(() => expect(screen.getByText('Ferme Dupont')).toBeTruthy());
    expect(screen.getByText('Lait cru')).toBeTruthy();
  });

  it('avertit quand aucun emplacement n’est renseigné', async () => {
    // Sans emplacement, la quarantaine automatique ne bloquera jamais ce lot.
    render(<ReceptionScreen />);

    await waitFor(() => expect(screen.getByText(/Scanner l'emplacement/)).toBeTruthy());
    expect(screen.getByText(/ne sera pas mis en quarantaine/)).toBeTruthy();
  });

  // ─── Contrôle : ne pas mettre un lot en quarantaine à l'insu de l'opérateur ──────────────
  // (issue #30) Le picker affichait les CODES bruts de l'énum, dont un « CONFORME » redondant
  // (traité comme OK côté serveur) et un « NONCONFORME » qui, coché comme une case anodine,
  // crée le lot en quarantaine (BLOQUE) sans que rien ne le dise.

  // BUG REPRODUIT : les libellés sont des codes d'énum, et « CONFORME » — sans effet distinct
  // de OK côté serveur — encombre la liste. Échoue sur le code actuel (les deux sont présents).
  it('n’affiche ni code d’énum brut ni le CONFORME redondant', async () => {
    render(<ReceptionScreen />);
    await waitFor(() => expect(screen.getByText('Ferme Dupont')).toBeTruthy());

    expect(screen.queryByText('CONFORME')).toBeNull();
    expect(screen.queryByText('NONCONFORME')).toBeNull();
    // Le choix conforme existe, mais sous un libellé métier.
    expect(screen.getByText('Conforme')).toBeTruthy();
  });

  // BUG REPRODUIT (le cœur de l'issue) : une décision sanitaire lourde partait sur un simple
  // effleurement. Après correctif, la conséquence est NOMMÉE et l'écriture attend confirmation.
  it('nomme la quarantaine et attend confirmation avant d’enregistrer un lot non conforme', async () => {
    render(<ReceptionScreen />);
    await fillValidReceipt();

    fireEvent.press(screen.getByText('Non conforme'));
    fireEvent.press(screen.getByText('Enregistrer la réception'));

    // Rien n'est enfilé tant que l'opérateur n'a pas confirmé la mise en quarantaine.
    expect(mockedEnqueue).not.toHaveBeenCalled();
    fireEvent.press(screen.getByText('Mettre en quarantaine'));

    await waitFor(() =>
      expect(mockedEnqueue).toHaveBeenCalledWith(
        expect.objectContaining({ statut_controle: 'NONCONFORME' })
      )
    );
    expect(mockedEnqueue).toHaveBeenCalledTimes(1);
  });

  // CAS CORRECT : un lot conforme s'enregistre directement. On n'invente pas une quarantaine qui
  // n'existe pas — pas de confirmation trompeuse sur le chemin nominal.
  it('enregistre directement un lot conforme, sans détour par la quarantaine', async () => {
    render(<ReceptionScreen />);
    await fillValidReceipt();

    // Le statut par défaut est « Conforme » (OK).
    fireEvent.press(screen.getByText('Enregistrer la réception'));

    expect(screen.queryByText('Mettre en quarantaine')).toBeNull();
    await waitFor(() =>
      expect(mockedEnqueue).toHaveBeenCalledWith(
        expect.objectContaining({ statut_controle: 'OK' })
      )
    );
  });
});
