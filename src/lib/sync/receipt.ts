import type { ReceiptPayload } from './types';

/** Bornes du schéma VineJS du serveur : au-delà, TOUT le lot de synchronisation est refusé. */
export const SHIPMENT_ID_MAX_LENGTH = 100;
const SHIPMENT_ID_MIN_LENGTH = 3;

export interface ReceiptInput {
  supplierId: string;
  productId: string;
  shipmentId: string;
  /** Tel que tapé : un opérateur français écrit « 12,5 ». */
  quantity: string;
  unit: string;
  status: ReceiptPayload['statut_controle'];
}

/**
 * Seul garde-fou avant la file : une saisie invalide y entre, fait refuser le lot entier
 * (validation fail-fast du serveur), et l'opérateur se retrouve avec un scan bloqué qu'il
 * ne peut plus corriger. Retourne `null` si la saisie ne peut pas devenir une réception.
 */
export function buildReceipt(input: ReceiptInput): ReceiptPayload | null {
  const shipmentId = input.shipmentId.trim();
  const quantity = Number(input.quantity.replace(',', '.'));

  const isValid =
    input.supplierId !== '' &&
    input.productId !== '' &&
    input.unit !== '' &&
    shipmentId.length >= SHIPMENT_ID_MIN_LENGTH &&
    shipmentId.length <= SHIPMENT_ID_MAX_LENGTH &&
    Number.isFinite(quantity) &&
    quantity > 0;

  if (!isValid) {
    return null;
  }

  return {
    id_fournisseur: input.supplierId,
    shipment_id: shipmentId,
    id_produit: input.productId,
    quantite_actuelle: quantity,
    unite_code: input.unit,
    statut_controle: input.status,
  };
}
