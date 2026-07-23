import { apiClient } from './api';
import { ApiError } from './errors';

/**
 * Généalogie et rappel produit — le cœur du cahier des charges NutriChain, côté terrain.
 *
 * Ces deux routes vivent sur `/api/traceability/batches/:id/…` et NON sur `/api/logistics/…` :
 * la fiche d'un lot est une donnée logistique, sa chaîne est une donnée de traçabilité.
 */

/** Un lot de la chaîne. Le serveur joint le produit (`nom_produit`) : un n° de lot seul ne parle pas. */
export interface GenealogyBatch {
  id: string;
  lot_number: string;
  statut: string;
  /** Decimal côté serveur, donc CHAÎNE en JSON — jamais un `number` (perte de précision). */
  quantite_actuelle: string;
  unite_code: string;
  nom_produit: string;
  date_peremption: string | null;
}

/** Point d'entrée matière première : la « ferme » du « de la ferme au rayon ». */
export interface Origin {
  lot_number: string;
  date_reception: string;
  fournisseur: { id: string; nom_ferme: string };
}

export interface Genealogy {
  batchId: string;
  /** Ascendance : ce dont ce lot est fait. */
  upstream: GenealogyBatch[];
  /** Descendance : ce qui a été fait avec ce lot — la cible d'un rappel. */
  downstream: GenealogyBatch[];
  origines: Origin[];
}

/**
 * ⚠️ QUATRE issues, jamais un `null` fourre-tout — même contrat que `loadBatch`.
 *
 * Sur une chaîne de traçabilité, confondre « ce lot n'a pas de descendance » avec « je n'ai pas
 * pu demander » est le mensonge le plus coûteux du produit : on croirait qu'aucun lot n'est parti
 * en rayon alors qu'on n'en sait rien.
 */
export type GenealogyResult =
  | { kind: 'ok'; genealogy: Genealogy }
  /** 404 : ce lot n'existe pas. Réponse DÉFINITIVE. */
  | { kind: 'unknown' }
  /** 403 : pas les droits. PERMANENT — rejouer ne changera rien. */
  | { kind: 'forbidden' }
  /** Réseau / 401 / 500 : on n'a pas pu demander. TRANSITOIRE — l'écran propose de réessayer. */
  | { kind: 'unverifiable'; error: unknown };

interface GenealogyApi {
  data: {
    batchId: string;
    upstream?: GenealogyBatch[];
    downstream?: GenealogyBatch[];
    origines?: Origin[];
  };
}

/** Chaîne complète d'un lot (`GET …/genealogy`, tous rôles). Ne REJETTE jamais. */
export async function loadGenealogy(id: string): Promise<GenealogyResult> {
  try {
    const { data } = await apiClient.get<GenealogyApi>(
      `/api/traceability/batches/${id}/genealogy`
    );

    return {
      kind: 'ok',
      genealogy: {
        batchId: data.data.batchId,
        // Des listes absentes restent VIDES : `undefined` casserait un `.map` à l'écran.
        upstream: data.data.upstream ?? [],
        downstream: data.data.downstream ?? [],
        origines: data.data.origines ?? [],
      },
    };
  } catch (error: unknown) {
    if (error instanceof ApiError && error.status === 404) return { kind: 'unknown' };
    if (error instanceof ApiError && error.status === 403) return { kind: 'forbidden' };
    return { kind: 'unverifiable', error };
  }
}

// ── Rappel produit ────────────────────────────────────────────────────────────────────────────

/** Bornes du schéma VineJS du serveur (`recallPayload.schema.ts`) : les franchir fait rejeter. */
const REASON_MIN_LENGTH = 5;
export const REASON_MAX_LENGTH = 500;

/**
 * Le motif est-il recevable ? Le serveur le `trim()` avant de mesurer : sans le même trim ici,
 * « xx␣␣␣ » passerait la validation locale pour se faire rejeter par le serveur.
 *
 * Ce motif n'est pas décoratif : il est recopié dans l'alerte, dans l'e-mail envoyé aux clients
 * et dans le mouvement de lot. « x » ne dit rien à personne.
 */
export function recallReasonError(reason: string): string | null {
  const trimmed = reason.trim();

  if (trimmed.length < REASON_MIN_LENGTH) {
    return `Le motif doit faire au moins ${REASON_MIN_LENGTH} caractères : il sera lu par vos clients.`;
  }

  if (trimmed.length > REASON_MAX_LENGTH) {
    return `Le motif ne peut pas dépasser ${REASON_MAX_LENGTH} caractères.`;
  }

  return null;
}

/** Une expédition déjà partie qui contient un lot rappelé — le client est à prévenir. */
export interface AffectedShipment {
  shipmentRef: string;
  customerName: string;
}

export interface RecallResult {
  blockedBatchesCount: number;
  impactedBatchIds: string[];
  affectedShipments: AffectedShipment[];
  /**
   * ⚠️ `true` = la garde anti-cycle du serveur a été atteinte : la descendance bloquée peut être
   * INCOMPLÈTE. Annoncer « N lots bloqués » sans le dire ferait croire le rappel terminé alors
   * qu'il reste peut-être des lots en rayon. À afficher, toujours.
   */
  depthSaturated: boolean;
}

/**
 * Déclenche le rappel (`POST …/recall`, rôles qualité — cf. `canQuality`).
 *
 * REJETTE en cas d'échec, contrairement aux lectures de ce fichier : une écriture qui échoue en
 * silence sur l'action la plus destructrice du système serait indéfendable. L'écran l'annonce.
 */
export async function triggerRecall(id: string, reason: string): Promise<RecallResult> {
  const { data } = await apiClient.post<{ data: RecallResult }>(
    `/api/traceability/batches/${id}/recall`,
    { reason: reason.trim() }
  );

  return data.data;
}
