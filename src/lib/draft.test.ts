/**
 * @jest-environment node
 *
 * Sur un VRAI moteur SQLite (`node:sqlite`), comme la file : le brouillon est une table, et c'est
 * son comportement en base qu'on vérifie — pas la forme d'une requête.
 */
import { SCHEMA } from './db';
import {
  clearReceiptDraft,
  clearShipmentDraft,
  clearTransformationDraft,
  loadReceiptDraft,
  loadShipmentDraft,
  loadTransformationDraft,
  saveReceiptDraft,
  saveShipmentDraft,
  saveTransformationDraft,
  type ReceiptDraft,
  type ShipmentDraft,
  type TransformationDraft,
} from './draft';

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

// (issue #73) Transformation et expédition n'avaient AUCUN brouillon : une cuve scannée, six lots
// parents, le client, le n° de transport — tout partait sur un 401. On étend le mécanisme.

const TRANSFO_DRAFT: TransformationDraft = {
  cuve: { id: 'cuve-1', nom: 'Cuve A', type: 'CUVE', qr_code_id: null, lieu: { nom: 'Atelier' } },
  parents: [
    {
      batch: {
        id: 'b1',
        lot_number: 'L1',
        statut: 'EN_STOCK',
        quantite_actuelle: '100',
        unite_code: 'kg',
        date_peremption: null,
        produit: { nom: 'Lait cru' },
      },
      quantity: '30',
      exhausted: false,
    },
  ],
  productId: 'p-1',
  quantity: '25',
};

const SHIP_DRAFT: ShipmentDraft = {
  customerId: 'c-1',
  shipmentId: 'EXP-001',
  carrier: 'DHL',
  address: '1 rue de la Ferme',
  autoShipmentId: false,
  lots: [
    {
      batch: {
        id: 'b2',
        lot_number: 'L2',
        statut: 'EN_STOCK',
        quantite_actuelle: '80',
        unite_code: 'kg',
        date_peremption: null,
        produit: { nom: 'Beurre' },
      },
      quantity: '10',
    },
  ],
};

describeWithSqlite('brouillon de transformation', () => {
  beforeEach(() => {
    engine = new DatabaseSync(':memory:');
    engine.exec(SCHEMA);
    mockUserId = 'operateur-A';
  });

  it('rend la cuve et les lots parents scannés à l’opérateur', async () => {
    await saveTransformationDraft(TRANSFO_DRAFT);
    expect(await loadTransformationDraft()).toEqual(TRANSFO_DRAFT);
  });

  it('n’ouvre jamais le brouillon d’un opérateur chez un autre', async () => {
    await saveTransformationDraft(TRANSFO_DRAFT);
    mockUserId = 'operateur-B';
    expect(await loadTransformationDraft()).toBeNull();
  });

  it('est effacé après l’envoi', async () => {
    await saveTransformationDraft(TRANSFO_DRAFT);
    await clearTransformationDraft();
    expect(await loadTransformationDraft()).toBeNull();
  });
});

describeWithSqlite('brouillon d’expédition', () => {
  beforeEach(() => {
    engine = new DatabaseSync(':memory:');
    engine.exec(SCHEMA);
    mockUserId = 'operateur-A';
  });

  it('rend le client, le transport et les lots chargés', async () => {
    await saveShipmentDraft(SHIP_DRAFT);
    expect(await loadShipmentDraft()).toEqual(SHIP_DRAFT);
  });

  it('n’ouvre jamais le brouillon d’un opérateur chez un autre', async () => {
    await saveShipmentDraft(SHIP_DRAFT);
    mockUserId = 'operateur-B';
    expect(await loadShipmentDraft()).toBeNull();
  });

  it('est effacé après l’envoi', async () => {
    await saveShipmentDraft(SHIP_DRAFT);
    await clearShipmentDraft();
    expect(await loadShipmentDraft()).toBeNull();
  });
});

// La colonne `kind` isole les trois écrans : un brouillon n'écrase pas celui d'un autre écran.
describeWithSqlite('isolation des trois brouillons', () => {
  beforeEach(() => {
    engine = new DatabaseSync(':memory:');
    engine.exec(SCHEMA);
    mockUserId = 'operateur-A';
  });

  it('garde les trois brouillons du même opérateur, sans collision', async () => {
    await saveReceiptDraft(DRAFT);
    await saveTransformationDraft(TRANSFO_DRAFT);
    await saveShipmentDraft(SHIP_DRAFT);

    expect(await loadReceiptDraft()).toEqual(DRAFT);
    expect(await loadTransformationDraft()).toEqual(TRANSFO_DRAFT);
    expect(await loadShipmentDraft()).toEqual(SHIP_DRAFT);

    // Effacer l'un ne touche pas les autres.
    await clearTransformationDraft();
    expect(await loadTransformationDraft()).toBeNull();
    expect(await loadReceiptDraft()).toEqual(DRAFT);
    expect(await loadShipmentDraft()).toEqual(SHIP_DRAFT);
  });
});
