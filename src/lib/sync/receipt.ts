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
 * Le message exact, sous le champ fautif — comme la transformation (`quantityError`) et l'expédition
 * (`shipmentQuantityError`). Un bouton grisé qui n'explique rien laissait l'opérateur du quai devant
 * le formulaire le plus utilisé de l'app sans savoir quoi corriger. `null` = champ valide.
 *
 * ⚠️ Reception n'impose PAS la limite de 2 décimales de la transformation : ne pas inventer de
 * contrainte que le serveur ne pose pas.
 */
export function receiptQuantityError(value: string): string | null {
  const quantity = Number(value.trim().replace(',', '.'));

  if (!Number.isFinite(quantity)) {
    return 'Quantité invalide : un nombre est attendu.';
  }
  if (quantity <= 0) {
    return 'La quantité doit être supérieure à 0.';
  }

  return null;
}

/** Le message exact sous le n° d'expédition. Bornes du schéma serveur (VineJS, 3..100). */
export function receiptShipmentError(value: string): string | null {
  const length = value.trim().length;

  if (length < SHIPMENT_ID_MIN_LENGTH) {
    return `Le n° d'expédition doit faire au moins ${SHIPMENT_ID_MIN_LENGTH} caractères.`;
  }
  if (length > SHIPMENT_ID_MAX_LENGTH) {
    return `Le n° d'expédition ne doit pas dépasser ${SHIPMENT_ID_MAX_LENGTH} caractères.`;
  }

  return null;
}

/**
 * Seul garde-fou avant la file : une saisie invalide y entre, fait refuser le lot entier
 * (validation fail-fast du serveur), et l'opérateur se retrouve avec un scan bloqué qu'il
 * ne peut plus corriger. Retourne `null` si la saisie ne peut pas devenir une réception.
 *
 * Partage ses règles quantité/n° d'expédition avec les messages ci-dessus : une SEULE source, pour
 * qu'un message affiché et un bouton grisé ne se contredisent jamais.
 */
export function buildReceipt(input: ReceiptInput): ReceiptPayload | null {
  const isValid =
    input.supplierId !== '' &&
    input.productId !== '' &&
    input.unit !== '' &&
    receiptShipmentError(input.shipmentId) === null &&
    receiptQuantityError(input.quantity) === null;

  if (!isValid) {
    return null;
  }

  const shipmentId = input.shipmentId.trim();
  const quantity = Number(input.quantity.replace(',', '.'));

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
