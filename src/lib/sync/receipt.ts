import type { ReceiptPayload } from './types';

/** Bornes du schéma VineJS du serveur : au-delà, TOUT le lot de synchronisation est refusé. */
export const SHIPMENT_ID_MAX_LENGTH = 100;
const SHIPMENT_ID_MIN_LENGTH = 3;

// Miroirs des règles de `receiptPayload.schema.ts` (API). Un lot ou une DLC qui ne les respecte pas
// ferait rejeter TOUT le lot de synchronisation (400) : on préfère OMETTRE le champ (le serveur
// génère un numéro / retombe sur la conservation par défaut) plutôt que de bloquer la réception.
const LOT_NUMBER_PATTERN = /^[A-Za-z0-9._-]{1,20}$/;
const EXPIRY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export interface ReceiptInput {
  supplierId: string;
  productId: string;
  shipmentId: string;
  /** Tel que tapé : un opérateur français écrit « 12,5 ». */
  quantity: string;
  unit: string;
  status: ReceiptPayload['statut_controle'];
  /** Emplacement de stockage, résolu par le scan de l'équipement. Vide si non scanné. */
  equipmentId?: string;
  /** Numéro de lot décodé de l'étiquette (GS1 AI 10) ou saisi. Vide/hors charset ⇒ non envoyé. */
  lotNumber?: string;
  /** DLC décodée de l'étiquette (GS1 AI 17), `YYYY-MM-DD`. Format invalide ⇒ non envoyée. */
  expiry?: string;
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

  // Optionnels côté serveur : on ne les envoie que VALIDES. Invalides, on les omet (sans invalider
  // la réception), car un champ malformé ferait rejeter le lot de sync entier.
  const lotNumber = input.lotNumber?.trim();
  const expiry = input.expiry?.trim();

  return {
    id_fournisseur: input.supplierId,
    shipment_id: shipmentId,
    id_produit: input.productId,
    quantite_actuelle: quantity,
    unite_code: input.unit,
    statut_controle: input.status,
    // Le serveur valide `id_materiel` comme un UUID : une chaîne vide ferait refuser TOUT le lot.
    ...(input.equipmentId ? { id_materiel: input.equipmentId } : {}),
    ...(lotNumber && LOT_NUMBER_PATTERN.test(lotNumber) ? { lot_number: lotNumber } : {}),
    ...(expiry && EXPIRY_PATTERN.test(expiry) ? { date_peremption: expiry } : {}),
  };
}
