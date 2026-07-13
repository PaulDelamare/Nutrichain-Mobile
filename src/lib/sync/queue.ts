import * as Crypto from 'expo-crypto';

import { getDatabase, withTransaction } from '../db';
import { getUserId } from '../session';
import {
  BLOCKED_STATUSES,
  type OperationStatus,
  type OperationUpdate,
  type QueuedOperation,
  type ReceiptPayload,
} from './types';

interface OperationRow {
  client_op_id: string;
  user_id: string;
  type: 'receipt';
  payload: string;
  status: OperationStatus;
  attempts: number;
  error: string | null;
  created_at: number;
}

function toOperation(row: OperationRow): QueuedOperation {
  return {
    clientOpId: row.client_op_id,
    type: row.type,
    payload: JSON.parse(row.payload) as ReceiptPayload,
    status: row.status,
    attempts: row.attempts,
    error: row.error,
    createdAt: row.created_at,
    orphan: row.user_id === '',
  };
}

const INSERT_OPERATION = `INSERT INTO operations (client_op_id, user_id, type, payload, status, created_at)
   VALUES (?, ?, ?, ?, 'PENDING', ?)`;

const SELECT_COLUMNS = 'client_op_id, user_id, type, payload, status, attempts, error, created_at';

/** Fragment SQL dérivé de la source unique : plus de liste de statuts recopiée à la main. */
const BLOCKED_STATUSES_SQL = `(${BLOCKED_STATUSES.map((status) => `'${status}'`).join(', ')})`;

/**
 * Un scan appartient à l'OPÉRATEUR qui l'a saisi, pas au téléphone.
 *
 * Le poste de terrain est partagé : A saisit cinq réceptions hors réseau, se déconnecte, B se
 * connecte. Sans propriétaire, la file de A repartait avec le jeton de B — et l'API gravait les
 * réceptions de A au nom de B, en base ET dans la chaîne d'audit. C'est la falsification d'identité
 * que tout le reste du système s'échine à empêcher, réintroduite par le mobile.
 *
 * L'identité est donc lue ICI, dans la file elle-même, et non passée en paramètre par les écrans :
 * un paramètre s'oublie sur un site d'appel, et l'oublier, c'est rouvrir la faille.
 */
async function requireOwner(): Promise<string> {
  const userId = await getUserId();

  if (!userId) {
    throw new Error("Aucun opérateur identifié : impossible d'enregistrer un scan.");
  }

  return userId;
}

/** L'identifiant est généré ici, une fois pour toutes : c'est la clé d'idempotence de l'API. */
export async function enqueueReceipt(payload: ReceiptPayload): Promise<string> {
  const db = await getDatabase();
  const userId = await requireOwner();
  const clientOpId = Crypto.randomUUID();

  await db.runAsync(
    INSERT_OPERATION,
    clientOpId,
    userId,
    'receipt',
    JSON.stringify(payload),
    Date.now()
  );

  return clientOpId;
}

/**
 * Le filtre de statut n'est pas une redondance de l'écran : supprimer une opération EN VOL
 * ferait perdre son verdict (et donc son identifiant serveur), et supprimer une opération
 * synchronisée effacerait une trace acquise.
 *
 * L'échec est bruyant : un DELETE qui n'affecte aucune ligne laissait l'opérateur croire son
 * scan supprimé alors qu'il était toujours là.
 */
export async function deleteOperation(clientOpId: string): Promise<void> {
  const db = await getDatabase();
  const userId = await requireOwner();
  // Un scan orphelin (`user_id` vide) est supprimable par qui le voit : il est bloqué, donc jamais
  // envoyé, et personne d'autre ne viendra le réclamer. En revanche le scan d'un AUTRE opérateur
  // identifié ne se supprime pas — ce n'est pas à lui d'en décider.
  const result = await db.runAsync(
    `DELETE FROM operations
      WHERE client_op_id = ? AND (user_id = ? OR user_id = '')
        AND status IN ${BLOCKED_STATUSES_SQL}`,
    clientOpId,
    userId
  );

  if (result.changes === 0) {
    throw new Error(`Aucune opération bloquée à supprimer : ${clientOpId}`);
  }
}

/**
 * Renvoie une opération bloquée (rejetée ou en conflit) sous un NOUVEL identifiant.
 *
 * C'est la SEULE exception à la règle « un scan = un identifiant immuable » : rejouer une
 * opération en conflit sous sa clé d'origine la ferait reconflicter indéfiniment, le serveur
 * ayant déjà enregistré autre chose sous cette clé. Le renvoi est donc, pour lui, une
 * opération neuve — au même contenu.
 *
 * Atomique : sans transaction, une application tuée entre l'insertion et la suppression
 * laisserait la copie ET l'originale, et l'opérateur — voyant son scan toujours bloqué —
 * le renverrait une seconde fois. Deux réceptions pour une seule palette.
 *
 * On ne renvoie QUE ses propres scans. Un scan orphelin (saisi avant que la file ait un
 * propriétaire) n'est pas renvoyable : le renvoyer le grave dans la chaîne d'audit au nom de celui
 * qui appuie — c'est-à-dire lui faire signer une réception qu'il n'a pas faite. Exactement la
 * falsification qu'on corrige, avec une case à cocher. Il se lit, et il se jette.
 */
export async function requeueOperation(clientOpId: string): Promise<string> {
  const db = await getDatabase();
  const userId = await requireOwner();
  const newClientOpId = Crypto.randomUUID();

  await withTransaction(db, async (tx) => {
    const row = await tx.getFirstAsync<{ payload: string; type: string }>(
      `SELECT payload, type FROM operations
        WHERE client_op_id = ? AND user_id = ?
          AND status IN ${BLOCKED_STATUSES_SQL}`,
      clientOpId,
      userId
    );

    if (!row) {
      throw new Error(`Aucune opération bloquée à renvoyer : ${clientOpId}`);
    }

    await tx.runAsync(
      INSERT_OPERATION,
      newClientOpId,
      userId,
      row.type,
      row.payload,
      Date.now()
    );
    await tx.runAsync('DELETE FROM operations WHERE client_op_id = ?', clientOpId);
  });

  return newClientOpId;
}

/** Sans purge, la file ne fait que grossir : l'historique noierait les scans en attente. */
export async function purgeSyncedBefore(timestamp: number): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    "DELETE FROM operations WHERE status = 'SYNCED' AND created_at < ?",
    timestamp
  );
}

/**
 * Une opération en attente depuis plus longtemps que le TTL d'idempotence du serveur ne doit
 * PLUS être rejouée à l'aveugle : sa clé y a expiré. Si la réception avait en fait été commitée
 * et que seule la réponse s'était perdue, la renvoyer créerait un doublon en base — le serveur
 * n'a plus de quoi la reconnaître. On la signale à l'opérateur au lieu de parier.
 */
export async function flagStalePending(timestamp: number, message: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE operations SET status = 'CONFLICT', error = ?
      WHERE status = 'PENDING' AND created_at < ?`,
    message,
    timestamp
  );
}

/** N'envoie QUE les scans de l'opérateur connecté : ceux d'un autre partiraient sous son identité. */
export async function getPendingOperations(now: number, limit: number): Promise<QueuedOperation[]> {
  const db = await getDatabase();
  const userId = await getUserId();

  if (!userId) {
    return [];
  }

  const rows = await db.getAllAsync<OperationRow>(
    `SELECT ${SELECT_COLUMNS}
       FROM operations
      WHERE status = 'PENDING' AND user_id = ? AND next_attempt_at <= ?
      ORDER BY created_at ASC
      LIMIT ?`,
    userId,
    now,
    limit
  );

  return rows.map(toOperation);
}

export async function saveOperationUpdates(updates: OperationUpdate[]): Promise<void> {
  const db = await getDatabase();

  // Transaction EXCLUSIVE : `withTransactionAsync` n'isole pas les requêtes émises en
  // parallèle sur la même connexion — une réception enregistrée pendant la synchro serait
  // aspirée dans la transaction, et un rollback effacerait un scan que l'écran a déjà
  // annoncé comme sauvegardé.
  await withTransaction(db, async (tx) => {
    for (const update of updates) {
      await tx.runAsync(
        `UPDATE operations
            SET status = ?, attempts = ?, next_attempt_at = ?, error = ?, server_id = ?
          WHERE client_op_id = ?`,
        update.status,
        update.attempts,
        update.nextAttemptAt,
        update.error,
        update.serverId,
        update.clientOpId
      );
    }
  });
}

/** Les compteurs de l'accueil ne parlent que de l'opérateur connecté : ce sont SES scans. */
export async function countByStatus(): Promise<Record<OperationStatus, number>> {
  const db = await getDatabase();
  const userId = await getUserId();

  const counts: Record<OperationStatus, number> = {
    PENDING: 0,
    SYNCED: 0,
    CONFLICT: 0,
    REJECTED: 0,
  };

  if (!userId) {
    return counts;
  }

  const rows = await db.getAllAsync<{ status: OperationStatus; total: number }>(
    'SELECT status, COUNT(*) AS total FROM operations WHERE user_id = ? GROUP BY status',
    userId
  );

  for (const row of rows) {
    counts[row.status] = row.total;
  }

  return counts;
}

/**
 * Combien de scans d'un AUTRE opérateur attendent encore dans ce téléphone.
 *
 * Sans ce compteur, l'écran affiche « Tout est synchronisé » alors que cinq réceptions dorment en
 * base : l'app affirme le contraire de la vérité. On ne montre RIEN de leur contenu — ni auteur,
 * ni lot : juste qu'ils existent, et que leur auteur doit se connecter pour les envoyer.
 */
export async function countForeignPending(): Promise<number> {
  const db = await getDatabase();
  const userId = await getUserId();

  if (!userId) {
    return 0;
  }

  const row = await db.getFirstAsync<{ total: number }>(
    `SELECT COUNT(*) AS total FROM operations
      WHERE user_id <> ? AND user_id <> '' AND status <> 'SYNCED'`,
    userId
  );

  return row?.total ?? 0;
}

/** L'historique est borné pour ne pas charger des milliers de lignes ; les scans bloqués, eux, ne le sont pas. */
const HISTORY_LIMIT = 50;

/**
 * Les opérations bloquées passent AVANT l'historique, et échappent à la limite.
 *
 * Sans ce tri, elles étaient invisibles : elles sont par nature les plus anciennes (une
 * opération signalée périmée a plus de 7 jours), donc reléguées hors des 50 dernières dès
 * qu'un poste scanne quelques dizaines de palettes par jour. L'accueil annonçait « 3 à
 * corriger » et l'écran n'en montrait aucune — le scan restait bloqué à jamais.
 *
 * Les scans orphelins (`user_id` vide, saisis avant que la file ait un propriétaire) sont montrés
 * à qui se connecte : ils sont bloqués, donc jamais envoyés, et il faut bien que quelqu'un puisse
 * les reprendre ou les jeter. Les cacher les condamnerait à rester en base pour toujours.
 */
export async function listOperations(): Promise<QueuedOperation[]> {
  const db = await getDatabase();
  const userId = await getUserId();

  if (!userId) {
    return [];
  }

  const blocked = await db.getAllAsync<OperationRow>(
    `SELECT ${SELECT_COLUMNS}
       FROM operations
      WHERE status IN ${BLOCKED_STATUSES_SQL} AND (user_id = ? OR user_id = '')
      ORDER BY created_at DESC`,
    userId
  );

  const history = await db.getAllAsync<OperationRow>(
    `SELECT ${SELECT_COLUMNS}
       FROM operations
      WHERE status NOT IN ${BLOCKED_STATUSES_SQL} AND user_id = ?
      ORDER BY created_at DESC
      LIMIT ?`,
    userId,
    HISTORY_LIMIT
  );

  return [...blocked, ...history].map(toOperation);
}
