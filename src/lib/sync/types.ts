/** Statuts locaux d'une opération, alignés sur docs/14_sync_mobile_offline.md. */
export type OperationStatus = 'PENDING' | 'SYNCED' | 'CONFLICT' | 'REJECTED';

/**
 * Une opération bloquée ne repartira jamais seule : elle attend une décision humaine.
 * Source unique — la file (SQL), l'écran de synchronisation et le compteur d'accueil en
 * dépendaient chacun de leur côté, dont un via une chaîne SQL qu'aucun compilateur ne
 * vérifiait : une divergence rendait le bouton « Supprimer » silencieusement inopérant.
 */
export const BLOCKED_STATUSES = ['CONFLICT', 'REJECTED'] as const satisfies readonly OperationStatus[];

export function isBlocked(status: OperationStatus): boolean {
  return (BLOCKED_STATUSES as readonly OperationStatus[]).includes(status);
}

export interface ReceiptPayload {
  id_fournisseur: string;
  shipment_id: string;
  id_produit: string;
  quantite_actuelle: number;
  unite_code: string;
  statut_controle: 'OK' | 'ALERTE' | 'NONCONFORME' | 'CONFORME';
}

export interface QueuedOperation {
  /**
   * UUID v4 généré au scan : c'est la clé d'idempotence de l'API, et un rejeu doit la
   * conserver telle quelle, sous peine de créer un doublon en base.
   * Seule exception : `requeueOperation`, qui renvoie une opération BLOQUÉE — dont le
   * serveur n'a jamais rien enregistré — sous une clé neuve.
   */
  clientOpId: string;
  type: 'receipt';
  payload: ReceiptPayload;
  status: OperationStatus;
  attempts: number;
  /** Motif du blocage, tel que renvoyé par le serveur : sans lui, l'opérateur doit deviner. */
  error: string | null;
}

/** Un item de la réponse 207 de POST /api/sync/scans. */
export interface SyncItemResult {
  clientOpId: string;
  status: 'ok' | 'error' | 'conflict';
  serverId?: { receiptId: string; batchId: string };
  error?: { field: string; message: string };
}

export interface OperationUpdate {
  clientOpId: string;
  status: OperationStatus;
  attempts: number;
  /** Epoch ms avant lequel l'opération ne doit pas être renvoyée (backoff). */
  nextAttemptAt: number;
  error: string | null;
  serverId: string | null;
}
