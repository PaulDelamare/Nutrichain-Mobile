import { apiClient } from './api';

/**
 * Retrait d'un lot du rayon d'un magasin — la seconde moitié du rappel, côté terrain.
 *
 * Distinct de la mise au rebut : détruire à l'usine et retirer du rayon ne sont pas le même geste.
 * La clé est (client, lot), jamais la ligne d'expédition : l'étiquette n'encode que le produit et
 * le lot, donc au scan on ignore de quelle livraison vient la marchandise — elle est fongible en
 * réserve. C'est aussi pourquoi la quantité est SAISIE : le scan identifie, l'humain compte.
 */

/** Ce qu'un magasin a reçu, retiré, et ce qu'il lui reste. Quantités en CHAÎNE : Decimal côté serveur. */
export interface ShelfWithdrawalProgress {
  customerId: string;
  customerName: string;
  quantiteLivree: string;
  quantiteRetiree: string;
  resteARetirer: string;
  unite: string;
  retraits: {
    id: string;
    quantite: string;
    motif: string;
    constateAupresDe: string | null;
    createdAt: string;
  }[];
}

export interface ShelfWithdrawalResult {
  id: string;
  quantiteLivree: string;
  quantiteRetiree: string;
  resteARetirer: string;
  unite: string;
}

export const WITHDRAWAL_REASON_MIN_LENGTH = 5;
export const WITHDRAWAL_REASON_MAX_LENGTH = 500;

/**
 * Contrôle local du motif, aux MÊMES bornes que le serveur : partir en requête pour se faire
 * refuser un motif trop court fait perdre le réseau et la patience de l'opérateur.
 */
export function withdrawalReasonError(reason: string): string | null {
  const trimmed = reason.trim();
  if (trimmed.length < WITHDRAWAL_REASON_MIN_LENGTH) {
    return `Motif trop court (${WITHDRAWAL_REASON_MIN_LENGTH} caractères minimum).`;
  }
  if (trimmed.length > WITHDRAWAL_REASON_MAX_LENGTH) {
    return `Motif trop long (${WITHDRAWAL_REASON_MAX_LENGTH} caractères maximum).`;
  }
  return null;
}

/**
 * Contrôle local de la quantité. Le reste à retirer vient du serveur, qui l'a calculé avec la règle
 * qui gouverne l'écriture — on ne le recalcule pas ici, on s'en sert comme borne.
 */
export function withdrawalQuantityError(saisie: string, resteARetirer: string): string | null {
  const valeur = Number(saisie.replace(',', '.'));
  if (!Number.isFinite(valeur) || valeur <= 0) {
    return 'Quantité retirée requise, strictement positive.';
  }
  if (valeur > Number(resteARetirer)) {
    return `Au-delà de ce qui reste à retirer (${resteARetirer}).`;
  }
  return null;
}

export async function loadShelfWithdrawals(batchId: string): Promise<ShelfWithdrawalProgress[]> {
  const { data } = await apiClient.get<{ data: { clients: ShelfWithdrawalProgress[] } }>(
    `/api/logistics/batches/${encodeURIComponent(batchId)}/withdrawals`
  );

  return data.data.clients;
}

/**
 * L'unité n'est PAS envoyée : le serveur la reprend du lot. L'ajouter permettrait de déclarer
 * 500 g contre un plafond exprimé en kg.
 */
export async function recordShelfWithdrawal(
  batchId: string,
  body: { id_client: string; quantite: number; motif: string; constate_aupres_de?: string },
): Promise<ShelfWithdrawalResult> {
  const { data } = await apiClient.post<{ data: ShelfWithdrawalResult }>(
    `/api/logistics/batches/${encodeURIComponent(batchId)}/withdrawals`,
    body
  );

  return data.data;
}
