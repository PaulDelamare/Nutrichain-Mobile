import { getDatabase } from './db';
import { getUserId } from './session';

/**
 * La saisie en cours, sauvegardée avant qu'un incident ne l'emporte.
 *
 * ⚠️ L'intercepteur HTTP, sur un 401, purge la session et redirige vers l'écran de connexion. Le
 * commentaire du code prenait soin de NE PAS purger le catalogue « pour ne pas détruire la saisie en
 * cours » — mais la redirection démonte l'écran de réception juste après, et la précaution ne sert à
 * rien. Un simple rafraîchissement de fond qui prend un 401, pendant que l'opérateur remplit son
 * formulaire sur le quai, effaçait fournisseur, produit, quantité, et jusqu'à l'emplacement scanné.
 * Tout était à refaire, sans qu'il ait rien vu venir.
 *
 * Un brouillon appartient à l'OPÉRATEUR, jamais à l'appareil : il est clé par `user_id`, et ne se
 * rouvre donc jamais chez celui qui se connecte après. Sans cette règle, on rendrait à B la saisie
 * de A — qu'il enregistrerait sous SON nom.
 */
const RECEIPT: string = 'receipt';

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

export async function saveReceiptDraft(draft: ReceiptDraft): Promise<void> {
  const userId = await getUserId();
  if (!userId) return;

  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO drafts (user_id, kind, value, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, kind) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    userId,
    RECEIPT,
    JSON.stringify(draft),
    Date.now()
  );
}

/** Le brouillon de l'opérateur CONNECTÉ — jamais celui d'un autre, jamais une exception. */
export async function loadReceiptDraft(): Promise<ReceiptDraft | null> {
  const userId = await getUserId();
  if (!userId) return null;

  const db = await getDatabase();
  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM drafts WHERE user_id = ? AND kind = ?',
    userId,
    RECEIPT
  );
  if (!row) return null;

  try {
    return JSON.parse(row.value) as ReceiptDraft;
  } catch {
    // Un brouillon illisible n'est pas une raison de bloquer l'écran : on repart d'un formulaire
    // vide, comme s'il n'y en avait pas.
    return null;
  }
}

/** Après mise en file : le brouillon a fait son office, le garder le ferait resurgir au scan suivant. */
export async function clearReceiptDraft(): Promise<void> {
  const userId = await getUserId();
  if (!userId) return;

  const db = await getDatabase();
  await db.runAsync('DELETE FROM drafts WHERE user_id = ? AND kind = ?', userId, RECEIPT);
}
