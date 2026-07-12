import * as Crypto from 'expo-crypto';

import { getDatabase } from '../db';
import {
  BLOCKED_STATUSES,
  type OperationStatus,
  type OperationUpdate,
  type QueuedOperation,
  type ReceiptPayload,
} from './types';

interface OperationRow {
  client_op_id: string;
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
  };
}

const INSERT_OPERATION = `INSERT INTO operations (client_op_id, type, payload, status, created_at)
   VALUES (?, ?, ?, 'PENDING', ?)`;

/** Fragment SQL dérivé de la source unique : plus de liste de statuts recopiée à la main. */
const BLOCKED_STATUSES_SQL = `(${BLOCKED_STATUSES.map((status) => `'${status}'`).join(', ')})`;

/** L'identifiant est généré ici, une fois pour toutes : c'est la clé d'idempotence de l'API. */
export async function enqueueReceipt(payload: ReceiptPayload): Promise<string> {
  const db = await getDatabase();
  const clientOpId = Crypto.randomUUID();

  await db.runAsync(INSERT_OPERATION, clientOpId, 'receipt', JSON.stringify(payload), Date.now());

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
  const result = await db.runAsync(
    `DELETE FROM operations WHERE client_op_id = ? AND status IN ${BLOCKED_STATUSES_SQL}`,
    clientOpId
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
 */
export async function requeueOperation(clientOpId: string): Promise<string> {
  const db = await getDatabase();
  const newClientOpId = Crypto.randomUUID();

  await db.withExclusiveTransactionAsync(async (tx) => {
    const row = await tx.getFirstAsync<{ payload: string; type: string }>(
      `SELECT payload, type FROM operations
        WHERE client_op_id = ? AND status IN ${BLOCKED_STATUSES_SQL}`,
      clientOpId
    );

    if (!row) {
      throw new Error(`Aucune opération bloquée à renvoyer : ${clientOpId}`);
    }

    await tx.runAsync(INSERT_OPERATION, newClientOpId, row.type, row.payload, Date.now());
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

export async function getPendingOperations(now: number, limit: number): Promise<QueuedOperation[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<OperationRow>(
    `SELECT client_op_id, type, payload, status, attempts, error, created_at
       FROM operations
      WHERE status = 'PENDING' AND next_attempt_at <= ?
      ORDER BY created_at ASC
      LIMIT ?`,
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
  await db.withExclusiveTransactionAsync(async (tx) => {
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

export async function countByStatus(): Promise<Record<OperationStatus, number>> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ status: OperationStatus; total: number }>(
    'SELECT status, COUNT(*) AS total FROM operations GROUP BY status'
  );

  const counts: Record<OperationStatus, number> = {
    PENDING: 0,
    SYNCED: 0,
    CONFLICT: 0,
    REJECTED: 0,
  };

  for (const row of rows) {
    counts[row.status] = row.total;
  }

  return counts;
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
 */
export async function listOperations(): Promise<QueuedOperation[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<OperationRow>(
    `SELECT client_op_id, type, payload, status, attempts, error, created_at
       FROM operations
      WHERE status IN ${BLOCKED_STATUSES_SQL}
      ORDER BY created_at DESC`
  );

  const history = await db.getAllAsync<OperationRow>(
    `SELECT client_op_id, type, payload, status, attempts, error, created_at
       FROM operations
      WHERE status NOT IN ${BLOCKED_STATUSES_SQL}
      ORDER BY created_at DESC
      LIMIT ?`,
    HISTORY_LIMIT
  );

  return [...rows, ...history].map(toOperation);
}
