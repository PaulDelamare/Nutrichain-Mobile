import * as Crypto from 'expo-crypto';

import { getDatabase } from '../db';
import type { OperationStatus, OperationUpdate, QueuedOperation, ReceiptPayload } from './types';

interface OperationRow {
  client_op_id: string;
  type: 'receipt';
  payload: string;
  status: OperationStatus;
  attempts: number;
}

function toOperation(row: OperationRow): QueuedOperation {
  return {
    clientOpId: row.client_op_id,
    type: row.type,
    payload: JSON.parse(row.payload) as ReceiptPayload,
    status: row.status,
    attempts: row.attempts,
  };
}

/** L'identifiant est généré ici, une fois pour toutes : c'est la clé d'idempotence de l'API. */
export async function enqueueReceipt(payload: ReceiptPayload): Promise<string> {
  const db = await getDatabase();
  const clientOpId = Crypto.randomUUID();

  await db.runAsync(
    `INSERT INTO operations (client_op_id, type, payload, status, created_at)
     VALUES (?, 'receipt', ?, 'PENDING', ?)`,
    clientOpId,
    JSON.stringify(payload),
    Date.now()
  );

  return clientOpId;
}

export async function getPendingOperations(now: number, limit: number): Promise<QueuedOperation[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<OperationRow>(
    `SELECT client_op_id, type, payload, status, attempts
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

export async function listOperations(limit = 50): Promise<QueuedOperation[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<OperationRow>(
    `SELECT client_op_id, type, payload, status, attempts
       FROM operations
      ORDER BY created_at DESC
      LIMIT ?`,
    limit
  );

  return rows.map(toOperation);
}
