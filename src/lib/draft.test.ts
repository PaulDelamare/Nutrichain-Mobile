/**
 * @jest-environment node
 *
 * Sur un VRAI moteur SQLite (`node:sqlite`), comme la file : le brouillon est une table, et c'est
 * son comportement en base qu'on vérifie — pas la forme d'une requête.
 */
import { SCHEMA } from './db';
import { clearReceiptDraft, loadReceiptDraft, saveReceiptDraft, type ReceiptDraft } from './draft';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let DatabaseSync: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  ({ DatabaseSync } = require('node:sqlite'));
} catch {
  DatabaseSync = null;
}

/** Node 20 en local, Node 22 en CI : le module n'existe qu'à partir de 22. */
const describeWithSqlite = DatabaseSync ? describe : describe.skip;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let engine: any;
let mockUserId: string | null = 'operateur-A';

jest.mock('./db', () => ({
  ...jest.requireActual<typeof import('./db')>('./db'),
  getDatabase: async () => mockDatabase,
}));

jest.mock('./session', () => ({
  getUserId: async () => mockUserId,
}));

const mockDatabase = {
  runAsync: async (sql: string, ...params: unknown[]) => engine.prepare(sql).run(...params),
  getFirstAsync: async (sql: string, ...params: unknown[]) =>
    engine.prepare(sql).get(...params) ?? null,
};

const DRAFT: ReceiptDraft = {
  supplierId: 'f-1',
  productId: 'p-1',
  shipmentId: 'SHIP-001',
  lotNumber: 'LOT-42',
  quantity: '12',
  unit: 'kg',
  status: 'OK',
  locationId: 'frigo-3',
};

describeWithSqlite('brouillon de réception', () => {
  beforeEach(() => {
    engine = new DatabaseSync(':memory:');
    engine.exec(SCHEMA);
    mockUserId = 'operateur-A';
  });

  it('rend la saisie à l’opérateur qui l’a tapée', async () => {
    // Une session qui expire pendant la saisie renvoie l'opérateur à l'écran de connexion, et
    // l'écran de réception est démonté. Sans brouillon, tout ce qu'il a tapé sur le quai est perdu.
    await saveReceiptDraft(DRAFT);

    expect(await loadReceiptDraft()).toEqual(DRAFT);
  });

  it('conserve l’EMPLACEMENT scanné', async () => {
    // Le plus coûteux à ressaisir : il faut retourner physiquement au frigo. Et un lot sans
    // emplacement échappe à la quarantaine automatique si son frigo dérive.
    await saveReceiptDraft(DRAFT);

    expect((await loadReceiptDraft())?.locationId).toBe('frigo-3');
  });

  it('n’ouvre JAMAIS le brouillon d’un opérateur chez un autre', async () => {
    // ⚠️ Le poste de terrain est partagé. Rendre à B la saisie de A, c'est lui faire enregistrer —
    // sous SON nom — une réception qu'il n'a pas faite. C'est la falsification d'identité que tout
    // le reste du système s'échine à empêcher.
    await saveReceiptDraft(DRAFT);

    mockUserId = 'operateur-B';

    expect(await loadReceiptDraft()).toBeNull();
  });

  it('remplace le brouillon au lieu d’en empiler un second', async () => {
    await saveReceiptDraft(DRAFT);
    await saveReceiptDraft({ ...DRAFT, quantity: '99' });

    expect((await loadReceiptDraft())?.quantity).toBe('99');
  });

  it('est effacé une fois la réception mise en file', async () => {
    // Le garder le ferait resurgir par-dessus la réception SUIVANTE.
    await saveReceiptDraft(DRAFT);

    await clearReceiptDraft();

    expect(await loadReceiptDraft()).toBeNull();
  });

  it('n’efface pas le brouillon d’un AUTRE opérateur', async () => {
    await saveReceiptDraft(DRAFT);

    mockUserId = 'operateur-B';
    await clearReceiptDraft();

    mockUserId = 'operateur-A';
    expect(await loadReceiptDraft()).toEqual(DRAFT);
  });

  it('ne rend rien quand personne n’est connecté', async () => {
    await saveReceiptDraft(DRAFT);
    mockUserId = null;

    expect(await loadReceiptDraft()).toBeNull();
  });

  it('ne jette pas sur un brouillon illisible : on repart d’un formulaire vide', async () => {
    await saveReceiptDraft(DRAFT);
    engine.prepare("UPDATE drafts SET value = '{cassé' WHERE user_id = ?").run('operateur-A');

    await expect(loadReceiptDraft()).resolves.toBeNull();
  });
});
