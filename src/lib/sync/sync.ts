import { apiClient } from '../api';
import { ApiError } from '../errors';
import { rejectOutcome, resolveOutcome } from './outcome';
import { getPendingOperations, saveOperationUpdates } from './queue';
import type { OperationUpdate, QueuedOperation, SyncItemResult } from './types';

/** L'API refuse au-delà de 100 items (garde anti-DoS et SLA de latence). */
export const MAX_BATCH_SIZE = 100;

/** Deux envois simultanés du même lot doubleraient le trafic sans rien gagner. */
let running = false;

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

function add(total: SyncSummary, batch: SyncSummary): SyncSummary {
  return {
    sent: total.sent + batch.sent,
    synced: total.synced + batch.synced,
    conflicts: total.conflicts + batch.conflicts,
    rejected: total.rejected + batch.rejected,
    retried: total.retried + batch.retried,
  };
}

async function syncBatch(operations: QueuedOperation[], now: number): Promise<SyncSummary> {
  let results: SyncItemResult[];

  try {
    results = await postBatch(operations);
  } catch (error) {
    // La validation du serveur est fail-fast sur le lot entier : un seul item malformé
    // le fait refuser en bloc (400), sans réponse 207. Le réessayer indéfiniment gèlerait
    // la file pour toujours — on scinde donc le lot jusqu'à isoler le coupable, ce qui
    // laisse passer les scans valides au lieu de tous les sacrifier.
    if (error instanceof ApiError && error.status === 400) {
      if (operations.length === 1) {
        const update = rejectOutcome(operations[0], error.message);
        await saveOperationUpdates([update]);
        return summarize([update]);
      }

      const middle = Math.floor(operations.length / 2);
      const first = await syncBatch(operations.slice(0, middle), now);
      const second = await syncBatch(operations.slice(middle), now);
      return add(first, second);
    }

    // Réseau coupé, 5xx, session refusée : rien n'est perdu, tout est replanifié avec
    // un délai — sinon un entrepôt qui reconnecte martèlerait l'API.
    results = [];
  }

  const byOpId = new Map(results.map((result) => [result.clientOpId, result]));
  const updates = operations.map((operation) =>
    resolveOutcome(operation, byOpId.get(operation.clientOpId), now)
  );

  await saveOperationUpdates(updates);

  return summarize(updates);
}

/**
 * Vide la file locale vers l'API, lot après lot. Les identifiants d'opération sont réémis
 * tels quels : c'est l'idempotence côté serveur qui garantit qu'un rejeu ne crée pas de doublon.
 *
 * Un verrou global empêche deux synchronisations concurrentes (bouton pressé deux fois,
 * retour du réseau pendant une sync manuelle) d'envoyer le même lot en double.
 */
export async function syncPendingOperations(): Promise<SyncSummary> {
  if (running) {
    return summarize([]);
  }
  running = true;

  try {
    let total = summarize([]);

    // Boucle : une file de 250 scans ne doit pas exiger trois appuis sur « Synchroniser ».
    // Les opérations replanifiées (backoff) sortent du lot suivant, ce qui borne la boucle.
    for (;;) {
      const now = Date.now();
      const operations = await getPendingOperations(now, MAX_BATCH_SIZE);

      if (operations.length === 0) {
        return total;
      }

      const batch = await syncBatch(operations, now);
      total = add(total, batch);

      // Rien n'est passé : réseau coupé ou serveur en vrac. Insister martèlerait l'API.
      if (batch.retried === batch.sent) {
        return total;
      }
    }
  } finally {
    running = false;
  }
}
