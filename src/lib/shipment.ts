import { apiClient } from './api';
import { readCache, writeCache } from './cache';

export interface Customer {
  id: string;
  nom_enseigne: string;
  /** Pré-remplit l'adresse de destination : une saisie de moins, et une faute de frappe en moins. */
  adresse_livraison: string;
}

export interface ShipmentInput {
  customerId: string;
  shipmentId: string;
  carrier: string;
  address: string;
  lots: {
    batchId: string;
    quantity: string;
    /** Stock restant du lot : expédier au-delà mettrait la quantité en négatif. */
    available: number;
  }[];
}

export interface ShipmentPayload {
  id_client: string;
  shipment_id: string;
  transporteur: string;
  destination_adresse: string;
  lots: { id_lot: string; quantite_expediee: number }[];
}

export async function loadCustomers(): Promise<Customer[]> {
  try {
    const { data } = await apiClient.get<{ data: Customer[] }>('/api/organization/customers');
    await writeCache('customers', data.data);
    return data.data;
  } catch (error) {
    const cached = await readCache<Customer[]>('customers');
    if (cached) {
      return cached;
    }
    throw error;
  }
}

function parseQuantity(value: string): number {
  return Number(value.replace(',', '.'));
}

/**
 * Le message exact, sous le champ fautif. Le serveur ne pose ici aucune contrainte décimale
 * (contrairement à la transformation) : ne pas en inventer une.
 */
export function shipmentQuantityError(value: string, available: number): string | null {
  const quantity = parseQuantity(value.trim());

  if (!Number.isFinite(quantity) || quantity <= 0) {
    return 'La quantité doit être supérieure à 0.';
  }

  if (quantity > available) {
    return `Stock insuffisant : ${available} disponibles.`;
  }

  return null;
}

/** Bornes du schéma VineJS du serveur : les franchir fait rejeter toute l'expédition. */
export function buildShipment(input: ShipmentInput): ShipmentPayload | null {
  const shipmentId = input.shipmentId.trim();
  const carrier = input.carrier.trim();
  const address = input.address.trim();

  const valid =
    input.customerId !== '' &&
    shipmentId.length >= 3 &&
    shipmentId.length <= 100 &&
    carrier.length >= 2 &&
    carrier.length <= 100 &&
    address.length >= 5 &&
    // Sans lot, l'expédition ne relie aucun produit à aucun client : le rappel ne pourrait
    // plus remonter jusqu'aux magasins livrés.
    input.lots.length > 0 &&
    input.lots.every(
      (lot) => lot.batchId !== '' && shipmentQuantityError(lot.quantity, lot.available) === null
    );

  if (!valid) {
    return null;
  }

  return {
    id_client: input.customerId,
    shipment_id: shipmentId,
    transporteur: carrier,
    destination_adresse: address,
    lots: input.lots.map((lot) => ({
      id_lot: lot.batchId,
      quantite_expediee: parseQuantity(lot.quantity),
    })),
  };
}

export async function createShipment(payload: ShipmentPayload): Promise<void> {
  await apiClient.post('/api/logistics/shipments', payload);
}
