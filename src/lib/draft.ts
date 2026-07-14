import type { Batch } from './batches';
import { getDatabase } from './db';
import type { Equipment } from './equipment';
import { getUserId } from './session';

/**
 * La saisie en cours, sauvegardée avant qu'un incident ne l'emporte.
 *
 * ⚠️ L'intercepteur HTTP, sur un 401, purge la session et redirige vers l'écran de connexion. Le
 * commentaire du code prenait soin de NE PAS purger le catalogue « pour ne pas détruire la saisie en
 * cours » — mais la redirection démonte l'écran juste après, et la précaution ne sert à rien. Un
 * simple rafraîchissement de fond qui prend un 401, pendant que l'opérateur remplit son formulaire
 * sur le quai (ou devant sa cuve), effaçait tout. Réception, transformation, expédition : tout était
 * à refaire, sans qu'il ait rien vu venir.
 *
 * Un brouillon appartient à l'OPÉRATEUR, jamais à l'appareil : il est clé par `user_id`, et ne se
 * rouvre donc jamais chez celui qui se connecte après. Sans cette règle, on rendrait à B la saisie
 * de A — qu'il enregistrerait sous SON nom.
 *
 * La colonne `kind` isole les trois écrans : chacun a son brouillon, sans collision.
 */
const KIND = { receipt: 'receipt', transformation: 'transformation', shipment: 'shipment' } as const;

// ── Cœur générique (privé) ────────────────────────────────────────────────────────────────────

async function saveDraft(kind: string, draft: unknown): Promise<void> {
  const userId = await getUserId();
  if (!userId) return;

  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO drafts (user_id, kind, value, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, kind) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    userId,
    kind,
    JSON.stringify(draft),
    Date.now()
  );
}

/** Le brouillon de l'opérateur CONNECTÉ — jamais celui d'un autre, jamais une exception. */
async function loadDraft<T>(kind: string): Promise<T | null> {
  const userId = await getUserId();
  if (!userId) return null;

  const db = await getDatabase();
  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM drafts WHERE user_id = ? AND kind = ?',
    userId,
    kind
  );
  if (!row) return null;

  try {
    return JSON.parse(row.value) as T;
  } catch {
    // Un brouillon illisible n'est pas une raison de bloquer l'écran : on repart d'un formulaire
    // vide, comme s'il n'y en avait pas.
    return null;
  }
}

/** Après mise en file / envoi : le brouillon a fait son office, le garder le ferait resurgir. */
async function clearDraft(kind: string): Promise<void> {
  const userId = await getUserId();
  if (!userId) return;

  const db = await getDatabase();
  await db.runAsync('DELETE FROM drafts WHERE user_id = ? AND kind = ?', userId, kind);
}

// ── Réception ─────────────────────────────────────────────────────────────────────────────────

export interface ReceiptDraft {
  supplierId: string;
  productId: string;
  shipmentId: string;
  lotNumber: string;
  quantity: string;
  unit: string;
  status: string;
  locationId: string | null;
}

export const saveReceiptDraft = (draft: ReceiptDraft): Promise<void> => saveDraft(KIND.receipt, draft);
export const loadReceiptDraft = (): Promise<ReceiptDraft | null> => loadDraft<ReceiptDraft>(KIND.receipt);
export const clearReceiptDraft = (): Promise<void> => clearDraft(KIND.receipt);

// ── Transformation ────────────────────────────────────────────────────────────────────────────

export interface TransformationDraft {
  /** La cuve scannée, entière : la restaurer sans réseau ni re-scan. */
  cuve: Equipment | null;
  /** Les lots parents scannés, avec leurs quantités prélevées et l'état « épuisé ». */
  parents: { batch: Batch; quantity: string; exhausted: boolean }[];
  productId: string;
  quantity: string;
}

export const saveTransformationDraft = (draft: TransformationDraft): Promise<void> =>
  saveDraft(KIND.transformation, draft);
export const loadTransformationDraft = (): Promise<TransformationDraft | null> =>
  loadDraft<TransformationDraft>(KIND.transformation);
export const clearTransformationDraft = (): Promise<void> => clearDraft(KIND.transformation);

// ── Expédition ────────────────────────────────────────────────────────────────────────────────

export interface ShipmentDraft {
  customerId: string;
  shipmentId: string;
  carrier: string;
  address: string;
  /** Les lots scannés pour l'expédition, avec la quantité chargée. */
  lots: { batch: Batch; quantity: string }[];
}

export const saveShipmentDraft = (draft: ShipmentDraft): Promise<void> => saveDraft(KIND.shipment, draft);
export const loadShipmentDraft = (): Promise<ShipmentDraft | null> => loadDraft<ShipmentDraft>(KIND.shipment);
export const clearShipmentDraft = (): Promise<void> => clearDraft(KIND.shipment);
