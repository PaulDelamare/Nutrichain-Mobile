import { retryDelayMs } from './backoff';
import type { OperationUpdate, QueuedOperation, SyncItemResult } from './types';

/** Seul `internal` est transitoire : toute autre erreur vient du payload et se reproduira à l'identique. */
const TRANSIENT_ERROR_FIELD = 'internal';

export function retryOutcome(
  operation: QueuedOperation,
  now: number,
  message: string | null
): OperationUpdate {
  const attempts = operation.attempts + 1;

  return {
    clientOpId: operation.clientOpId,
    status: 'PENDING',
    attempts,
    nextAttemptAt: now + retryDelayMs(attempts),
    error: message,
    serverId: null,
  };
}

/** Verdict rendu sans passer par la réponse 207 : le lot entier a été refusé (400). */
export function rejectOutcome(operation: QueuedOperation, message: string): OperationUpdate {
  return {
    clientOpId: operation.clientOpId,
    status: 'REJECTED',
    attempts: operation.attempts,
    nextAttemptAt: 0,
    error: message,
    serverId: null,
  };
}

/**
 * Décide du sort local d'une opération à partir du verdict du serveur (réponse 207).
 * `result` est absent si le serveur n'a rien dit de cette opération (réponse tronquée) :
 * on la rejoue — l'idempotence de l'API garantit qu'un rejeu ne crée pas de doublon,
 * alors que l'abandonner perdrait un scan terrain.
 */
export function resolveOutcome(
  operation: QueuedOperation,
  result: SyncItemResult | undefined,
  now: number
): OperationUpdate {
  if (!result) {
    return retryOutcome(operation, now,null);
  }

  const base = {
    clientOpId: operation.clientOpId,
    attempts: operation.attempts,
    nextAttemptAt: 0,
    error: result.error?.message ?? null,
  };

  switch (result.status) {
    case 'ok':
      return {
        ...base,
        status: 'SYNCED',
        error: null,
        serverId: result.serverId ? JSON.stringify(result.serverId) : null,
      };

    case 'conflict':
      return { ...base, status: 'CONFLICT', serverId: null };

    case 'error':
      return result.error?.field === TRANSIENT_ERROR_FIELD
        ? retryOutcome(operation, now,result.error.message)
        : { ...base, status: 'REJECTED', serverId: null };

    default: {
      // Le contrat est détenu par le serveur : le jour où il ajoute un verdict, le classer
      // en REJECTED par défaut condamnerait silencieusement un scan terrain. On refuse de
      // compiler à la place.
      const unhandled: never = result.status;
      throw new Error(`Verdict serveur inconnu : ${String(unhandled)}`);
    }
  }
}
