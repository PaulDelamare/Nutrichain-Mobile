import { render, screen, waitFor, fireEvent } from '@testing-library/react-native';
import Toast from 'react-native-toast-message';

import { loadProducts, loadSuppliers } from '@/lib/catalog';
import { loadEquipment } from '@/lib/equipment';
import { enqueueReceipt } from '@/lib/sync/queue';
import { syncPendingOperations } from '@/lib/sync/sync';
import { ApiError } from '@/lib/errors';

import ReceptionScreen from '@/app/reception';

// Le paramètre de route `code` = ce que le scan a lu. Pilotable par test pour simuler un scan.
const mockParams = { current: {} as { code?: string } };

jest.mock('@/lib/catalog');
jest.mock('@/lib/equipment');
jest.mock('@/lib/sync/queue');
jest.mock('@/lib/sync/sync');
jest.mock('expo-router', () => ({
  router: { back: jest.fn() },
  useLocalSearchParams: () => mockParams.current,
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0 }) }));
jest.mock('react-native-toast-message', () => ({ show: jest.fn() }));

/** Étiquette réellement imprimée par NutriChain : URL GS1 Digital Link (GTIN + lot + DLC). */
const DIGITAL_LINK = 'https://api.nutrichain.fr/gs1/01/3042040209123/10/260714-ABC123/17/261231';

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
    mockParams.current = {};
    catalog.loadSuppliers.mockResolvedValue([{ id: 'f-1', nom_ferme: 'Ferme Dupont' }]);
    // Le GTIN du produit permet de le retrouver depuis un code scanné (03042040209123 normalisé).
    catalog.loadProducts.mockResolvedValue([
      { id: 'p-1', nom: 'Lait cru', unite_reference: 'kg', code_gtin: '3042040209123' },
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

  // ─── Décodage GS1 du scan (issue #31) : le scan doit remplir le formulaire ────────────────
  // Avant : le code scanné (URL Digital Link de 60 caractères) partait BRUT dans « N° d'expédition »,
  // et le GTIN / lot / DLC étaient jetés — la palette rescannée redevenait un lot inconnu.

  // BUG REPRODUIT : sur le code actuel, l'URL brute remplit le n° d'expédition et rien n'est décodé.
  it('décode l’étiquette scannée au lieu de jeter le GTIN, le lot et la DLC', async () => {
    mockParams.current = { code: DIGITAL_LINK };
    render(<ReceptionScreen />);
    await waitFor(() => expect(screen.getByText('Ferme Dupont')).toBeTruthy());

    // L'URL brute ne doit PAS atterrir telle quelle dans le n° d'expédition.
    expect(screen.queryByDisplayValue(DIGITAL_LINK)).toBeNull();
    // Le numéro de lot décodé (AI 10) est pré-rempli et visible.
    expect(screen.getByDisplayValue('260714-ABC123')).toBeTruthy();
  });

  // CAS CORRECT : le produit est retrouvé par GTIN, et lot_number + date_peremption sont ENVOYÉS.
  it('envoie le produit (par GTIN), le lot et la DLC décodés du scan', async () => {
    mockParams.current = { code: DIGITAL_LINK };
    render(<ReceptionScreen />);
    await waitFor(() => expect(screen.getByText('Ferme Dupont')).toBeTruthy());

    // Le produit et l'unité sont déduits du GTIN ; il reste le fournisseur, le n° d'expédition
    // (absent de notre étiquette) et la quantité à saisir.
    fireEvent.press(screen.getByText('Ferme Dupont'));
    fireEvent.changeText(screen.getByPlaceholderText('SHIP-2026-001'), 'SHIP-1');
    fireEvent.changeText(screen.getByPlaceholderText('0'), '10');
    fireEvent.press(screen.getByText('Enregistrer la réception'));

    await waitFor(() =>
      expect(mockedEnqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          id_produit: 'p-1',
          shipment_id: 'SHIP-1',
          lot_number: '260714-ABC123',
          date_peremption: '2026-12-31',
        })
      )
    );
  });

  // NE PAS MENTIR : un GTIN scanné absent du catalogue ne doit pas pré-sélectionner un produit au
  // hasard — on le dit, et l'opérateur choisit lui-même.
  it('n’invente pas de produit quand le GTIN scanné est inconnu du catalogue', async () => {
    mockParams.current = { code: 'https://api.nutrichain.fr/gs1/01/9999999999999/10/LOT1' };
    render(<ReceptionScreen />);
    await waitFor(() => expect(screen.getByText('Ferme Dupont')).toBeTruthy());

    expect(screen.getByText(/introuvable dans le catalogue/i)).toBeTruthy();
  });

  // PAS DE RÉGRESSION : un code non-GS1 (ni URL, ni element string) n'est pas réinterprété — il
  // garde sa place dans le n° d'expédition, comme avant.
  it('laisse un code non-GS1 dans le n° d’expédition, sans le réinterpréter', async () => {
    mockParams.current = { code: 'SHIP-2026-001' };
    render(<ReceptionScreen />);
    await waitFor(() => expect(screen.getByText('Ferme Dupont')).toBeTruthy());

    expect(screen.getByDisplayValue('SHIP-2026-001')).toBeTruthy();
  });
  // ⚠️ `Promise.all` faisait rejeter la promesse ENTIÈRE dès qu'un appel échouait. Un 403 sur les
  // fournisseurs — le cas d'un `operator`, à qui l'API réserve cette route — emportait les produits,
  // pourtant revenus en 200 : deux listes vides, et plus aucune réception possible.
  it('affiche les produits même quand la liste des fournisseurs est refusee', async () => {
    catalog.loadSuppliers.mockRejectedValue(new Error('403'));

    render(<ReceptionScreen />);

    // Le produit, lui, a répondu : il DOIT être là.
    await waitFor(() => expect(screen.getByText('Lait cru')).toBeTruthy());
  });

  it('DIT quelle liste manque, au lieu d’un « catalogue indisponible » muet', async () => {
    catalog.loadSuppliers.mockRejectedValue(new Error('403'));

    render(<ReceptionScreen />);

    // Sans fournisseur, la réception est impossible : un sélecteur vide et un bouton gris ne le
    // disent pas. L'écran doit l'annoncer.
    await waitFor(() =>
      expect(screen.getByText(/Aucun fournisseur accessible/i)).toBeTruthy()
    );
  });

  it('n’annonce rien quand tout le catalogue a répondu', async () => {
    render(<ReceptionScreen />);

    await waitFor(() => expect(screen.getByText('Ferme Dupont')).toBeTruthy());
    expect(screen.queryByText(/Aucun fournisseur accessible/i)).toBeNull();
  });

  // ─── Erreurs de champ (issue #47) : plus de bouton gris muet ───────────────────────────────
  // L'écran le plus utilisé restait le seul à laisser l'opérateur devant un bouton grisé sans lui
  // dire quel champ le bloque — ce que transfo et expédition affichent déjà.

  // BUG REPRODUIT : une quantité invalide grise le bouton SANS message. Échoue sur le code actuel.
  it('affiche l’erreur sous la quantité au lieu d’un bouton gris muet', async () => {
    render(<ReceptionScreen />);
    await waitFor(() => expect(screen.getByText('Ferme Dupont')).toBeTruthy());

    fireEvent.changeText(screen.getByPlaceholderText('0'), '0');
    expect(screen.getByText(/supérieure à 0/i)).toBeTruthy();
  });

  it('affiche l’erreur sous un n° d’expédition trop court', async () => {
    render(<ReceptionScreen />);
    await waitFor(() => expect(screen.getByText('Ferme Dupont')).toBeTruthy());

    fireEvent.changeText(screen.getByPlaceholderText('SHIP-2026-001'), 'AB');
    expect(screen.getByText(/3 caractères/i)).toBeTruthy();
  });

  // CAS CORRECT : une saisie valide n'affiche AUCUNE erreur.
  it('n’affiche aucune erreur pour une saisie valide', async () => {
    render(<ReceptionScreen />);
    await waitFor(() => expect(screen.getByText('Ferme Dupont')).toBeTruthy());

    fireEvent.changeText(screen.getByPlaceholderText('0'), '12');
    fireEvent.changeText(screen.getByPlaceholderText('SHIP-2026-001'), 'SHIP-1');
    expect(screen.queryByText(/supérieure à 0/i)).toBeNull();
    expect(screen.queryByText(/3 caractères/i)).toBeNull();
  });

  // NE PAS HARCELER : un champ encore vide n'affiche pas d'erreur (ce n'est pas une faute, c'est un
  // champ pas encore rempli — comme transfo/expédition).
  it('ne montre aucune erreur tant que les champs sont vides', async () => {
    render(<ReceptionScreen />);
    await waitFor(() => expect(screen.getByText('Ferme Dupont')).toBeTruthy());

    expect(screen.queryByText(/supérieure à 0/i)).toBeNull();
    expect(screen.queryByText(/caractères/i)).toBeNull();
  });

  // ─── Ne pas mentir sur la synchro (issue #48) ─────────────────────────────────────────────
  // L'écoute réseau meurt avec l'app (pas de tâche de fond). Promettre « synchronisée dès que le
  // réseau reviendra » à un opérateur qui va fermer l'app est un mensonge : rien ne partira.
  it('promet un envoi honnête, conditionné à l’application ouverte', async () => {
    render(<ReceptionScreen />);
    await fillValidReceipt();

    fireEvent.press(screen.getByText('Enregistrer la réception'));

    await waitFor(() =>
      expect(jest.mocked(Toast.show)).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'success',
          text1: 'Réception enregistrée',
          text2: expect.stringMatching(/application ouverte/i),
        })
      )
    );
    // Et surtout : ne promet PLUS une synchro de fond que l'app ne tient pas.
    expect(jest.mocked(Toast.show)).not.toHaveBeenCalledWith(
      expect.objectContaining({ text2: expect.stringMatching(/dès que le réseau reviendra/i) })
    );
  });
});
