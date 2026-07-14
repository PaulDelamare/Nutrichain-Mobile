import { render, screen, waitFor, fireEvent } from '@testing-library/react-native';

import { countByStatus, deleteOperation, listOperations, requeueOperation } from '@/lib/sync/queue';
import { syncPendingOperations } from '@/lib/sync/sync';
import type { OperationStatus, QueuedOperation } from '@/lib/sync/types';

import SyncScreen from '@/app/(tabs)/sync';

jest.mock('@/lib/sync/queue');
jest.mock('@/lib/sync/sync');
jest.mock('@/hooks/use-online-status', () => ({ useOnlineStatus: () => true }));
jest.mock('expo-router', () => ({ useFocusEffect: (effect: () => void) => effect() }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0 }) }));

const queue = jest.mocked({ countByStatus, deleteOperation, listOperations, requeueOperation });
const mockedSync = jest.mocked(syncPendingOperations);

function operation(status: OperationStatus): QueuedOperation {
  return {
    clientOpId: `op-${status}`,
    type: 'receipt',
    payload: {
      id_fournisseur: 'f-1',
      shipment_id: `SHIP-${status}`,
      id_produit: 'p-1',
      quantite_actuelle: 12,
      unite_code: 'kg',
      statut_controle: 'OK',
    },
    status,
    attempts: 0,
    error: status === 'REJECTED' ? 'Produit introuvable' : null,
  };
}

function withOperations(...operations: QueuedOperation[]): void {
  queue.listOperations.mockResolvedValue(operations);
  queue.countByStatus.mockResolvedValue({ PENDING: 0, SYNCED: 0, CONFLICT: 0, REJECTED: 0 });
}

/**
 * Les deux actions passent par une confirmation. Elle n'utilise plus `Alert.alert` — un no-op
 * littéral sur le web, où se fait la démo : les boutons y étaient MORTS. C'est une vraie modale,
 * donc on la pilote comme l'opérateur : en appuyant dessus.
 *
 * Le libellé de confirmation est le même que celui du bouton de la liste : la modale étant rendue
 * après, c'est la DERNIÈRE occurrence.
 */
function confirmDialog(label: string): void {
  const buttons = screen.getAllByText(label);
  fireEvent.press(buttons[buttons.length - 1]);
}

describe('écran de synchronisation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    queue.requeueOperation.mockResolvedValue('nouvel-id');
    queue.deleteOperation.mockResolvedValue(undefined);
    mockedSync.mockResolvedValue({ sent: 0, synced: 0, conflicts: 0, rejected: 0, retried: 0 });
  });

  it('renvoie une opération rejetée après confirmation, sinon le scan est perdu', async () => {
    withOperations(operation('REJECTED'));

    render(<SyncScreen />);

    await waitFor(() => expect(screen.getByText('Renvoyer')).toBeTruthy());
    fireEvent.press(screen.getByText('Renvoyer'));

    // Un renvoi écrit dans le registre de traçabilité : il ne part pas sur un simple effleurement.
    expect(queue.requeueOperation).not.toHaveBeenCalled();

    confirmDialog('Renvoyer');

    await waitFor(() => expect(queue.requeueOperation).toHaveBeenCalledWith('op-REJECTED'));
  });

  it('supprime réellement l’opération quand la suppression est confirmée', async () => {
    withOperations(operation('REJECTED'));

    render(<SyncScreen />);

    await waitFor(() => expect(screen.getByText('Supprimer')).toBeTruthy());
    fireEvent.press(screen.getByText('Supprimer'));
    confirmDialog('Supprimer');

    await waitFor(() => expect(queue.deleteOperation).toHaveBeenCalledWith('op-REJECTED'));
  });

  it('ne renvoie qu’une seule fois malgré un double appui', async () => {
    // Sans verrou, deux appuis créeraient deux réceptions en base pour une seule palette :
    // c'est le seul chemin qui contourne l'idempotence du serveur.
    withOperations(operation('CONFLICT'));

    render(<SyncScreen />);

    await waitFor(() => expect(screen.getByText('Renvoyer')).toBeTruthy());

    let resolveRequeue: (id: string) => void = () => undefined;
    queue.requeueOperation.mockReturnValue(
      new Promise<string>((resolve) => {
        resolveRequeue = resolve;
      })
    );

    fireEvent.press(screen.getByText('Renvoyer'));
    confirmDialog('Renvoyer');
    fireEvent.press(screen.getByText('Renvoyer'));
    confirmDialog('Renvoyer');

    resolveRequeue('nouvel-id');

    await waitFor(() => expect(queue.requeueOperation).toHaveBeenCalledTimes(1));
  });

  it('affiche le motif du blocage', async () => {
    // Le motif était enregistré en base... et jamais relu. « Rejeté » seul n'apprend rien :
    // l'opérateur ne peut ni corriger la cause, ni juger s'il vaut la peine de renvoyer.
    withOperations(operation('REJECTED'));

    render(<SyncScreen />);

    await waitFor(() => expect(screen.getByText('Produit introuvable')).toBeTruthy());
  });

  it('propose de renvoyer une opération en conflit', async () => {
    withOperations(operation('CONFLICT'));

    render(<SyncScreen />);

    await waitFor(() => expect(screen.getByText('Renvoyer')).toBeTruthy());
    expect(screen.getByText('Supprimer')).toBeTruthy();
  });

  it("n'offre aucune action sur une opération en attente ou déjà synchronisée", async () => {
    // Supprimer un scan encore en vol, ou en double, n'a aucun sens.
    withOperations(operation('PENDING'), operation('SYNCED'));

    render(<SyncScreen />);

    await waitFor(() => expect(screen.getByText('Réception · SHIP-PENDING')).toBeTruthy());
    expect(screen.queryByText('Renvoyer')).toBeNull();
    expect(screen.queryByText('Supprimer')).toBeNull();
  });
});
