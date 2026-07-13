/**
 * @jest-environment node
 *
 * Le SQL de la file s'exécute ici sur un VRAI moteur SQLite (`node:sqlite`, intégré à Node
 * depuis la 22 — la version de la CI). Zéro dépendance, zéro compilation native.
 *
 * Les tests précédents assertaient sur des fragments de requête. Ils étaient à la fois trop
 * stricts (un `IN ('PENDING')` équivalent les cassait) et trop laxistes : une inversion des
 * paramètres `status` et `attempts` — qui ferait qu'AUCUN scan n'est jamais marqué
 * synchronisé, et que tous repartiraient indéfiniment — passait au vert.
 */
import { migrate, ORPHAN_OPERATION_MESSAGE, SCHEMA } from '../db';
import {
  countByStatus,
  countForeignPending,
  deleteOperation,
  enqueueReceipt,
  flagStalePending,
  getPendingOperations,
  listOperations,
  purgeSyncedBefore,
  requeueOperation,
  saveOperationUpdates,
} from './queue';
import type { OperationStatus, ReceiptPayload } from './types';

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

jest.mock('../db', () => ({
  ...jest.requireActual<typeof import('../db')>('../db'),
  getDatabase: async () => mockDatabase,
}));

jest.mock('expo-crypto', () => ({
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  randomUUID: () => require('crypto').randomUUID(),
}));

/** L'opérateur connecté, piloté par le test : c'est lui qui possède les scans qu'il saisit. */
let mockUserId: string | null = 'operateur-A';

jest.mock('../session', () => ({
  getUserId: async () => mockUserId,
}));

/** L'API d'expo-sqlite utilisée par la file, portée sur node:sqlite. */
const mockDatabase = {
  execAsync: async (sql: string) => engine.exec(sql),
  runAsync: async (sql: string, ...params: unknown[]) => engine.prepare(sql).run(...params),
  getAllAsync: async (sql: string, ...params: unknown[]) => engine.prepare(sql).all(...params),
  getFirstAsync: async (sql: string, ...params: unknown[]) =>
    engine.prepare(sql).get(...params) ?? null,
  withExclusiveTransactionAsync: async (run: (tx: unknown) => Promise<void>) => {
    engine.exec('BEGIN IMMEDIATE');
    try {
      await run(mockDatabase);
      engine.exec('COMMIT');
    } catch (error) {
      engine.exec('ROLLBACK');
      throw error;
    }
  },
};

const PAYLOAD: ReceiptPayload = {
  id_fournisseur: 'f-1',
  shipment_id: 'SHIP-001',
  id_produit: 'p-1',
  quantite_actuelle: 12,
  unite_code: 'kg',
  statut_controle: 'OK',
};

const NOW = 1_800_000_000_000;

function markAs(clientOpId: string, status: OperationStatus, createdAt = NOW) {
  engine
    .prepare('UPDATE operations SET status = ?, created_at = ? WHERE client_op_id = ?')
    .run(status, createdAt, clientOpId);
}

describeWithSqlite('file d’opérations (moteur SQLite réel)', () => {
  beforeEach(() => {
    engine = new DatabaseSync(':memory:');
    engine.exec(SCHEMA);
    mockUserId = 'operateur-A';
  });

  it('attribue un identifiant unique à chaque réception', async () => {
    // Clé d'idempotence : deux scans partageant un identifiant se marcheraient dessus.
    const first = await enqueueReceipt(PAYLOAD);
    const second = await enqueueReceipt(PAYLOAD);

    expect(first).not.toBe(second);
    await expect(countByStatus()).resolves.toMatchObject({ PENDING: 2 });
  });

  it('restitue le payload intact', async () => {
    await enqueueReceipt(PAYLOAD);

    const [operation] = await getPendingOperations(NOW, 100);

    expect(operation.payload).toEqual(PAYLOAD);
    expect(operation.status).toBe('PENDING');
    expect(operation.type).toBe('receipt');
  });

  it('borne le lot à la taille acceptée par l’API', async () => {
    for (let i = 0; i < 12; i++) await enqueueReceipt(PAYLOAD);

    await expect(getPendingOperations(NOW, 5)).resolves.toHaveLength(5);
  });

  it('respecte le délai de nouvelle tentative', async () => {
    // Le backoff est calculé ET stocké ; sans ce filtre SQL, il serait ignoré et l'API
    // martelée à chaque synchronisation.
    const clientOpId = await enqueueReceipt(PAYLOAD);
    await saveOperationUpdates([
      { clientOpId, status: 'PENDING', attempts: 1, nextAttemptAt: NOW + 30_000, error: 'Erreur serveur', serverId: null },
    ]);

    await expect(getPendingOperations(NOW, 100)).resolves.toHaveLength(0);
    await expect(getPendingOperations(NOW + 30_000, 100)).resolves.toHaveLength(1);
  });

  it('enregistre réellement le verdict du serveur', async () => {
    // Une inversion des paramètres écrirait le statut dans `attempts` : plus aucun scan ne
    // serait jamais marqué synchronisé, et tous repartiraient indéfiniment.
    const clientOpId = await enqueueReceipt(PAYLOAD);
    await saveOperationUpdates([
      { clientOpId, status: 'SYNCED', attempts: 1, nextAttemptAt: 0, error: null, serverId: '{"receiptId":"r-1"}' },
    ]);

    await expect(countByStatus()).resolves.toMatchObject({ SYNCED: 1, PENDING: 0 });
    await expect(getPendingOperations(NOW, 100)).resolves.toHaveLength(0);
  });

  it('renvoie une opération bloquée sous un nouvel identifiant, et supprime l’ancienne', async () => {
    const clientOpId = await enqueueReceipt(PAYLOAD);
    markAs(clientOpId, 'CONFLICT');

    const newClientOpId = await requeueOperation(clientOpId);

    expect(newClientOpId).not.toBe(clientOpId);
    const pending = await getPendingOperations(NOW, 100);
    expect(pending).toHaveLength(1);
    expect(pending[0].clientOpId).toBe(newClientOpId);
    expect(pending[0].payload).toEqual(PAYLOAD);
    await expect(countByStatus()).resolves.toMatchObject({ CONFLICT: 0 });
  });

  it('refuse de renvoyer ou de supprimer une opération qui n’est pas bloquée', async () => {
    // Renvoyer une opération synchronisée créerait un doublon ; en supprimer une en vol
    // ferait perdre son verdict. L'échec est bruyant, jamais silencieux.
    const clientOpId = await enqueueReceipt(PAYLOAD);

    await expect(requeueOperation(clientOpId)).rejects.toThrow();
    await expect(deleteOperation(clientOpId)).rejects.toThrow();
    await expect(countByStatus()).resolves.toMatchObject({ PENDING: 1 });
  });

  it('supprime une opération bloquée', async () => {
    const clientOpId = await enqueueReceipt(PAYLOAD);
    markAs(clientOpId, 'REJECTED');

    await deleteOperation(clientOpId);

    await expect(countByStatus()).resolves.toMatchObject({ REJECTED: 0 });
  });

  it('ne purge que l’historique synchronisé, jamais les scans en attente', async () => {
    // Le mutant qui retire ce filtre supprime les scans terrain au démarrage de l'app.
    const vieuxEnAttente = await enqueueReceipt(PAYLOAD);
    const vieuxSynchronise = await enqueueReceipt(PAYLOAD);
    markAs(vieuxEnAttente, 'PENDING', NOW - 100);
    markAs(vieuxSynchronise, 'SYNCED', NOW - 100);

    await purgeSyncedBefore(NOW);

    await expect(countByStatus()).resolves.toMatchObject({ SYNCED: 0, PENDING: 1 });
  });

  it('signale les opérations en attente au-delà du TTL au lieu de les rejouer', async () => {
    // Leur clé d'idempotence a expiré côté serveur : les rejouer pourrait créer un doublon.
    const perimee = await enqueueReceipt(PAYLOAD);
    const recente = await enqueueReceipt(PAYLOAD);
    markAs(perimee, 'PENDING', NOW - 100);
    markAs(recente, 'PENDING', NOW + 100);

    await flagStalePending(NOW, 'À vérifier');

    const counts = await countByStatus();
    expect(counts).toMatchObject({ CONFLICT: 1, PENDING: 1 });

    const [bloquee] = (await listOperations()).filter((operation) => operation.status === 'CONFLICT');
    expect(bloquee.error).toBe('À vérifier');
  });

  it('affiche les opérations bloquées même noyées sous l’historique', async () => {
    // Elles sont par nature les plus anciennes : sans tri dédié, elles sortaient des
    // 50 dernières lignes et devenaient invisibles — donc irrécupérables.
    const bloquee = await enqueueReceipt(PAYLOAD);
    markAs(bloquee, 'REJECTED', NOW - 10_000);

    for (let i = 0; i < 60; i++) {
      const recente = await enqueueReceipt(PAYLOAD);
      markAs(recente, 'SYNCED', NOW + i);
    }

    const listed = await listOperations();

    expect(listed[0].clientOpId).toBe(bloquee);
    expect(listed.filter((operation) => operation.status === 'REJECTED')).toHaveLength(1);
  });
});

describeWithSqlite('la file appartient à l’opérateur, pas au téléphone', () => {
  beforeEach(() => {
    engine = new DatabaseSync(':memory:');
    engine.exec(SCHEMA);
    mockUserId = 'operateur-A';
  });

  it('n’envoie JAMAIS les scans d’un autre opérateur', async () => {
    // LE bug : poste de terrain partagé. A saisit cinq réceptions hors réseau, se déconnecte,
    // B se connecte. Sans propriétaire, la file de A repartait avec le jeton de B — et l'API
    // gravait les réceptions de A au nom de B, en base ET dans la chaîne d'audit WORM.
    await enqueueReceipt(PAYLOAD);
    await enqueueReceipt(PAYLOAD);

    mockUserId = 'operateur-B';

    await expect(getPendingOperations(NOW, 100)).resolves.toHaveLength(0);
  });

  it('rend ses scans à leur auteur dès qu’il se reconnecte', async () => {
    // Le corollaire indispensable : on ne détruit rien. Une réception saisie hors réseau est une
    // donnée terrain que personne ne peut ressaisir — elle attend son auteur.
    await enqueueReceipt(PAYLOAD);

    mockUserId = 'operateur-B';
    expect(await getPendingOperations(NOW, 100)).toHaveLength(0);

    mockUserId = 'operateur-A';
    expect(await getPendingOperations(NOW, 100)).toHaveLength(1);
  });

  it('ne montre à un opérateur ni les compteurs ni l’historique d’un autre', async () => {
    await enqueueReceipt(PAYLOAD);

    mockUserId = 'operateur-B';

    await expect(countByStatus()).resolves.toMatchObject({ PENDING: 0 });
    await expect(listOperations()).resolves.toHaveLength(0);
  });

  it('refuse d’enregistrer un scan quand personne n’est identifié', async () => {
    // Un scan anonyme ne pourrait jamais être attribué : mieux vaut refuser la saisie que
    // fabriquer une opération que personne n'assumera.
    mockUserId = null;

    await expect(enqueueReceipt(PAYLOAD)).rejects.toThrow(/opérateur/i);
  });

  it('n’envoie rien tant que personne n’est identifié', async () => {
    await enqueueReceipt(PAYLOAD);
    mockUserId = null;

    await expect(getPendingOperations(NOW, 100)).resolves.toHaveLength(0);
  });

  it('interdit de supprimer le scan bloqué d’un autre opérateur', async () => {
    const scanDeA = await enqueueReceipt(PAYLOAD);
    markAs(scanDeA, 'REJECTED');

    mockUserId = 'operateur-B';

    await expect(deleteOperation(scanDeA)).rejects.toThrow();
    expect(engine.prepare('SELECT COUNT(*) AS n FROM operations').get().n).toBe(1);
  });

  it('rattache un scan renvoyé à celui qui le renvoie', async () => {
    // C'est lui qui en répond désormais : le serveur scellera SON identité dans l'audit.
    const bloque = await enqueueReceipt(PAYLOAD);
    markAs(bloque, 'CONFLICT');

    const renvoye = await requeueOperation(bloque);

    const row = engine
      .prepare('SELECT user_id FROM operations WHERE client_op_id = ?')
      .get(renvoye);
    expect(row.user_id).toBe('operateur-A');
  });

  it('interdit de RENVOYER le scan bloqué d’un autre opérateur', async () => {
    // La garde la plus sensible de la file : renvoyer, c'est réinscrire le scan sous SON identité.
    // Laisser B renvoyer un scan de A, c'est lui faire signer une réception qu'il n'a pas faite —
    // la falsification d'origine, avec une case à cocher.
    const scanDeA = await enqueueReceipt(PAYLOAD);
    markAs(scanDeA, 'CONFLICT');

    mockUserId = 'operateur-B';

    await expect(requeueOperation(scanDeA)).rejects.toThrow();
  });

  it('ne montre pas non plus les scans BLOQUÉS d’un autre opérateur', async () => {
    const scanDeA = await enqueueReceipt(PAYLOAD);
    markAs(scanDeA, 'REJECTED');

    mockUserId = 'operateur-B';

    await expect(listOperations()).resolves.toHaveLength(0);
  });

  it('refuse toute suppression quand personne n’est identifié', async () => {
    const scan = await enqueueReceipt(PAYLOAD);
    markAs(scan, 'REJECTED');

    mockUserId = null;

    await expect(deleteOperation(scan)).rejects.toThrow(/opérateur/i);
  });
});

describeWithSqlite('dire la vérité sur les scans qu’on ne montre pas', () => {
  beforeEach(() => {
    engine = new DatabaseSync(':memory:');
    engine.exec(SCHEMA);
    mockUserId = 'operateur-A';
  });

  it('annonce les scans d’un autre opérateur restés sur le téléphone', async () => {
    // Sans ce compteur, l'écran affirme « Tout est synchronisé » alors que des réceptions dorment
    // en base : l'application dit le contraire de la vérité.
    await enqueueReceipt(PAYLOAD);
    await enqueueReceipt(PAYLOAD);

    mockUserId = 'operateur-B';

    await expect(countForeignPending()).resolves.toBe(2);
  });

  it('ne compte pas les siens', async () => {
    await enqueueReceipt(PAYLOAD);

    await expect(countForeignPending()).resolves.toBe(0);
  });

  it('ne compte pas ce qui est déjà parti', async () => {
    const envoye = await enqueueReceipt(PAYLOAD);
    markAs(envoye, 'SYNCED');

    mockUserId = 'operateur-B';

    await expect(countForeignPending()).resolves.toBe(0);
  });

  it('ne compte pas les orphelins : ils sont visibles, eux', async () => {
    // Ils apparaissent dans la liste de celui qui se connecte — les compter en plus les
    // annoncerait deux fois.
    engine
      .prepare(
        `INSERT INTO operations (client_op_id, user_id, type, payload, status, created_at)
         VALUES ('orphelin', '', 'receipt', ?, 'CONFLICT', ?)`
      )
      .run(JSON.stringify(PAYLOAD), NOW);

    await expect(countForeignPending()).resolves.toBe(0);
  });

  it('signale un scan sans auteur, pour que l’écran lui refuse le renvoi', async () => {
    // Le drapeau porte une règle de sécurité, pas un détail d'affichage : sans lui, l'écran
    // proposerait « Renvoyer » sur un scan que la file refuse — et laisserait croire qu'on peut
    // signer la réception d'un autre.
    engine
      .prepare(
        `INSERT INTO operations (client_op_id, user_id, type, payload, status, created_at)
         VALUES ('orphelin', '', 'receipt', ?, 'CONFLICT', ?)`
      )
      .run(JSON.stringify(PAYLOAD), NOW);

    const [scan] = await listOperations();

    expect(scan.orphan).toBe(true);
  });

  it('ne marque PAS orphelin un scan qui a un auteur', async () => {
    const scan = await enqueueReceipt(PAYLOAD);
    markAs(scan, 'REJECTED');

    const [liste] = await listOperations();

    expect(liste.orphan).toBe(false);
  });
});

describeWithSqlite('scans orphelins (saisis avant que la file ait un propriétaire)', () => {
  beforeEach(() => {
    engine = new DatabaseSync(':memory:');
    engine.exec(SCHEMA);
    mockUserId = 'operateur-A';
  });

  /** Ce que la migration produit : une ligne sans auteur, bloquée, jamais envoyée. */
  function seedOrphan(status: OperationStatus = 'CONFLICT'): string {
    const id = 'orphelin-1';
    engine
      .prepare(
        `INSERT INTO operations (client_op_id, user_id, type, payload, status, created_at)
         VALUES (?, '', 'receipt', ?, ?, ?)`
      )
      .run(id, JSON.stringify(PAYLOAD), status, NOW);
    return id;
  }

  it('ne les envoie jamais : leur auteur est inconnu', async () => {
    seedOrphan('PENDING');

    await expect(getPendingOperations(NOW, 100)).resolves.toHaveLength(0);
  });

  it('les montre quand même : les cacher les condamnerait à rester en base pour toujours', async () => {
    seedOrphan();

    await expect(listOperations()).resolves.toHaveLength(1);
  });

  it('interdit de se les attribuer : ce serait signer la réception d’un autre', async () => {
    // Les renvoyer les graverait dans la chaîne d'audit au nom de celui qui appuie. Leur auteur
    // est inconnu, personne ne peut en répondre — on ne les remet pas en circulation.
    const orphelin = seedOrphan();

    await expect(requeueOperation(orphelin)).rejects.toThrow();
  });

  it('laisse l’opérateur les jeter, une fois qu’il les a lus', async () => {
    // Sans cette issue, ils resteraient en base pour toujours, invisibles et inertes.
    const orphelin = seedOrphan();

    await deleteOperation(orphelin);

    expect(engine.prepare('SELECT COUNT(*) AS n FROM operations').get().n).toBe(0);
  });
});

describeWithSqlite('migration d’une file sans propriétaire', () => {
  /** Le schéma d'AVANT : aucune colonne `user_id`. C'est la base réelle des téléphones déjà déployés. */
  const ANCIEN_SCHEMA = `
    CREATE TABLE operations (
      client_op_id    TEXT PRIMARY KEY NOT NULL,
      type            TEXT NOT NULL,
      payload         TEXT NOT NULL,
      status          TEXT NOT NULL,
      attempts        INTEGER NOT NULL DEFAULT 0,
      next_attempt_at INTEGER NOT NULL DEFAULT 0,
      error           TEXT,
      server_id       TEXT,
      created_at      INTEGER NOT NULL
    );
  `;

  function seedAncienScan(id: string, status: OperationStatus) {
    engine
      .prepare(
        `INSERT INTO operations (client_op_id, type, payload, status, created_at)
         VALUES (?, 'receipt', ?, ?, ?)`
      )
      .run(id, JSON.stringify(PAYLOAD), status, NOW);
  }

  beforeEach(() => {
    engine = new DatabaseSync(':memory:');
    engine.exec(ANCIEN_SCHEMA);
    mockUserId = 'operateur-A';
  });

  it('ajoute la colonne propriétaire sans toucher aux scans déjà synchronisés', async () => {
    seedAncienScan('deja-sync', 'SYNCED');

    await migrate(mockDatabase);

    const row = engine.prepare("SELECT status FROM operations WHERE client_op_id = 'deja-sync'").get();
    expect(row.status).toBe('SYNCED');
  });

  it('bloque les scans en attente : leur auteur ne peut plus être établi', async () => {
    // On ne peut ni les attribuer à qui se connecte ensuite (ce serait la falsification), ni les
    // détruire (ce sont des données terrain). On les arrête, avec le motif.
    seedAncienScan('sans-auteur', 'PENDING');

    await migrate(mockDatabase);

    const row = engine.prepare("SELECT status, error FROM operations WHERE client_op_id = 'sans-auteur'").get();
    expect(row.status).toBe('CONFLICT');
    expect(row.error).toBe(ORPHAN_OPERATION_MESSAGE);
  });

  it('ne repart JAMAIS sous l’identité du prochain connecté', async () => {
    seedAncienScan('sans-auteur', 'PENDING');

    await migrate(mockDatabase);

    await expect(getPendingOperations(NOW, 100)).resolves.toHaveLength(0);
  });

  it('est rejouable sans rien abîmer', async () => {
    seedAncienScan('sans-auteur', 'PENDING');

    await migrate(mockDatabase);
    await migrate(mockDatabase);

    expect(engine.prepare('SELECT COUNT(*) AS n FROM operations').get().n).toBe(1);
  });
});
