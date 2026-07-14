import { apiClient } from './api';

/** Ce que l'API répond pour `GET /organization/quarantine-batches` — TOUS les lots BLOQUE de l'org. */
interface QuarantineBatchApi {
  id: string;
  lot_number: string;
  /** Decimal Prisma sérialisé en string. */
  quantite_actuelle: string;
  unite_code: string;
  date_peremption: string | null;
  date_creation: string;
  produit?: { nom: string } | null;
}

export interface QuarantineBatch {
  id: string;
  lotNumber: string;
  produitNom: string;
  quantite: number;
  uniteCode: string;
  /** DLC (ISO) ou null. */
  datePeremption: string | null;
  /** Date de création du lot (ISO). */
  dateCreation: string;
}

/**
 * Les lots en quarantaine — ou l'aveu qu'on n'a pas pu les demander.
 *
 * ⚠️ Comme les alertes froid ([[alerts]]), c'est un **état sanitaire vivant**, pas une donnée de
 * référence : pas de cache, et surtout PAS de troisième état masqué. `unverifiable` EST le canal
 * d'erreur. Renvoyer `[]` sur une panne réseau ferait afficher « aucun lot en quarantaine » — une
 * coche rassurante pendant que de la marchandise bloquée dort en base. L'appelant doit le DIRE.
 *
 * Cette fonction ne REJETTE jamais.
 */
export type QuarantineBatches =
  | { kind: 'ok'; batches: QuarantineBatch[] }
  | { kind: 'unverifiable'; error: unknown };

/** Decimal string → number. Une quantité illisible vaut 0 (un lot en base en a toujours une). */
function toNumber(value: string | null | undefined): number {
  if (value == null || value === '') return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export async function loadQuarantineBatches(): Promise<QuarantineBatches> {
  try {
    const { data } = await apiClient.get<{ data: QuarantineBatchApi[] }>(
      '/api/organization/quarantine-batches'
    );

    return {
      kind: 'ok',
      batches: data.data.map((b) => ({
        id: b.id,
        lotNumber: b.lot_number,
        produitNom: b.produit?.nom ?? 'Produit inconnu',
        quantite: toNumber(b.quantite_actuelle),
        uniteCode: b.unite_code,
        datePeremption: b.date_peremption,
        dateCreation: b.date_creation,
      })),
    };
  } catch (error: unknown) {
    return { kind: 'unverifiable', error };
  }
}
