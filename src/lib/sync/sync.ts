import { apiClient } from '../api';
import { resolveOutcome } from './outcome';
import { getPendingOperations, saveOperationUpdates } from './queue';
import type { OperationUpdate, QueuedOperation, SyncItemResult } from './types';

/** L'API refuse au-delà de 100 items (garde anti-DoS et SLA de latence). */
export const MAX_BATCH_SIZE = 100;

export interface SyncSummary {
  sent: number;
  synced: number;
  conflicts: number;
  rejected: number;
  retried: number;
}

interface SyncResponse {
  data: { results: SyncItemResult[] };
}

function summarize(updates: OperationUpdate[]): SyncSummary {
  return {
    sent: updates.length,
    synced: updates.filter((u) => u.status === 'SYNCED').length,
    conflicts: updates.filter((u) => u.status === 'CONFLICT').length,
    rejected: updates.filter((u) => u.status === 'REJECTED').length,
    retried: updates.filter((u) => u.status === 'PENDING').length,
  };
}

async function postBatch(operations: QueuedOperation[]): Promise<SyncItemResult[]> {
  const { data } = await apiClient.post<SyncResponse>('/api/sync/scans', {
    items: operations.map(({ clientOpId, type, payload }) => ({ clientOpId, type, payload })),
  });

  return data.data.results;
}

/**
 * Vide la file locale vers l'API. Les identifiants d'opération sont réémis tels quels :
 * c'est l'idempotence côté serveur qui garantit qu'un rejeu ne crée pas de doublon.
 */
export async function syncPendingOperations(): Promise<SyncSummary> {
  const now = Date.now();
  const operations = await getPendingOperations(now, MAX_BATCH_SIZE);

  if (operations.length === 0) {
    return summarize([]);
  }

  let results: SyncItemResult[];
  try {
    results = await postBatch(operations);
  } catch {
    // Échec global (réseau coupé, 500) : aucune opération n'est perdue, toutes sont
    // replanifiées avec un délai — sinon un entrepôt qui reconnecte martèlerait l'API.
    results = [];
  }

  const byOpId = new Map(results.map((result) => [result.clientOpId, result]));
  const updates = operations.map((operation) =>
    resolveOutcome(operation, byOpId.get(operation.clientOpId), now)
  );

  await saveOperationUpdates(updates);

  return summarize(updates);
}
