/** Statuts locaux d'une opération, alignés sur docs/14_sync_mobile_offline.md. */
export type OperationStatus = 'PENDING' | 'SYNCED' | 'CONFLICT' | 'REJECTED';

export interface ReceiptPayload {
  id_fournisseur: string;
  shipment_id: string;
  id_produit: string;
  quantite_actuelle: number;
  unite_code: string;
  statut_controle: 'OK' | 'ALERTE' | 'NONCONFORME' | 'CONFORME';
}

export interface QueuedOperation {
  /** UUID v4 généré au scan et JAMAIS régénéré : c'est la clé d'idempotence de l'API. */
  clientOpId: string;
  type: 'receipt';
  payload: ReceiptPayload;
  status: OperationStatus;
  attempts: number;
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
