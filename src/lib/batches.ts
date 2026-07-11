import { apiClient } from './api';
import { readCache, writeCache } from './cache';

// ── Le catalogue des lots : ce qu'on scanne devant la cuve ou le camion ───────────────────────

export interface Batch {
  id: string;
  /** Numéro imprimé sur l'étiquette du lot (AI 10 du GS1). */
  lot_number: string;
  statut: string;
  /** Prisma sérialise les Decimal en chaîne. */
  quantite_actuelle: string;
  unite_code: string;
  date_peremption: string | null;
  produit: { nom: string };
}

/**
 * Statuts qui interdisent à un lot de quitter le stock : c'est la garde sanitaire centrale
 * (quarantaine qualité, excursion de température, rappel). Le serveur la fait respecter, mais
 * l'opérateur doit le savoir devant sa cuve — pas dix minutes plus tard, à la synchronisation.
 */
const BLOCKING_STATUSES = ['BLOQUE', 'ALERTE', 'EXPEDIE', 'EPUISE', 'EN_PRODUCTION'];

export async function loadBatches(): Promise<Batch[]> {
  try {
    const { data } = await apiClient.get<{ data: Batch[] }>('/api/traceability/batches');
    await writeCache('batches', data.data);
    return data.data;
  } catch (error) {
    const cached = await readCache<Batch[]>('batches');
    if (cached) {
      return cached;
    }
    throw error;
  }
}

/** Résout localement l'étiquette d'un lot : aucun endpoint serveur ne le fait. */
export function findBatchByCode(code: string, batches: Batch[]): Batch | undefined {
  const needle = code.trim().toLowerCase();

  if (needle === '') {
    return undefined;
  }

  return batches.find(
    (batch) => batch.lot_number.toLowerCase() === needle || batch.id.toLowerCase() === needle
  );
}

export function isUsableBatch(batch: Batch): boolean {
  if (BLOCKING_STATUSES.includes(batch.statut.toUpperCase())) {
    return false;
  }

  // Une date de péremption dépassée est un motif de blocage sanitaire, pas un détail.
  return !batch.date_peremption || new Date(batch.date_peremption).getTime() > Date.now();
}

// ── La fiche d'un lot : ce qu'on affiche une fois le lot ouvert ───────────────────────────────

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
