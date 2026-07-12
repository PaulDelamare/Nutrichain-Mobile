import { apiClient } from './api';

interface BatchApi {
  id: string;
  lot_number: string;
  statut: string;
  quantite_actuelle: string;
  unite_code: string;
  date_peremption: string | null;
  date_creation: string | null;
  produit?: { nom: string; code_gtin?: string | null } | null;
}

export interface BatchDetail {
  id: string;
  lotNumber: string;
  statut: string;
  produitNom: string;
  codeGtin: string | null;
  quantite: number;
  uniteCode: string;
  datePeremption: string | null;
  dateCreation: string | null;
}

/**
 * Fiche d'un lot (`GET /api/logistics/batches/:id`, include produit+unité).
 * Renvoie `null` si introuvable / hors réseau — l'écran affiche un état vide.
 */
export async function loadBatch(id: string): Promise<BatchDetail | null> {
  try {
    const { data } = await apiClient.get<{ data: BatchApi }>(`/api/logistics/batches/${id}`);
    const b = data.data;
    const quantite = Number(b.quantite_actuelle);
    return {
      id: b.id,
      lotNumber: b.lot_number,
      statut: b.statut,
      produitNom: b.produit?.nom ?? 'Produit inconnu',
      codeGtin: b.produit?.code_gtin ?? null,
      quantite: Number.isFinite(quantite) ? quantite : 0,
      uniteCode: b.unite_code,
      datePeremption: b.date_peremption,
      dateCreation: b.date_creation,
    };
  } catch {
    return null;
  }
}
