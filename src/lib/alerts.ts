import { apiClient } from './api';

export interface Alert {
  id: string;
  type: string;
  statut: string;
  message: string;
  niveau_gravite?: string;
  // Pour une excursion froid, l'alerte pointe l'ÉQUIPEMENT (pas un lot précis) via ce champ.
  id_materiel?: string | null;
  created_at?: string;
}

const COLD_CHAIN_TYPE = 'TEMP_EXCURSION';

/**
 * Les alertes froid actives — ou l'aveu qu'on n'a pas pu les demander.
 *
 * ⚠️ Pas de cache, et pas de troisième état. Une alerte froid n'est pas une donnée de référence
 * comme le catalogue : c'est un **état sanitaire vivant**, produit par les capteurs. Un cache ne
 * pourrait JAMAIS montrer l'alerte née pendant la coupure — c'est-à-dire exactement celle qui
 * compte — et il ne saurait qu'en ressortir une déjà résolue. On importerait le mensonge inverse
 * sans rien gagner pour la saisie hors ligne.
 *
 * Cette fonction ne REJETTE jamais : `unverifiable` EST le canal d'erreur. L'appelant doit le DIRE.
 */
export type ColdAlerts =
  | { kind: 'ok'; alerts: Alert[] }
  | { kind: 'unverifiable'; error: unknown };

export async function loadActiveColdAlerts(): Promise<ColdAlerts> {
  try {
    // L'API renvoie toutes les alertes de l'organisation, sans filtre possible : le tri est à nous.
    const { data } = await apiClient.get<{ data: Alert[] }>('/api/organization/alerts');

    return {
      kind: 'ok',
      alerts: data.data.filter(
        (alert) => alert.type === COLD_CHAIN_TYPE && alert.statut === 'ACTIVE'
      ),
    };
  } catch (error: unknown) {
    // Renvoyer `[]` — ce que faisait ce code — faisait afficher « ALERTES FROID : 0 » à l'accueil
    // sur une simple panne réseau. La seule information sanitaire de l'écran, et elle annonçait
    // « tout va bien » pendant une excursion thermique.
    return { kind: 'unverifiable', error };
  }
}

// ── Vue de décision d'une alerte ──────────────────────────────────────────────
// L'API n'a pas d'endpoint de détail : on recompose la vue en croisant l'alerte,
// l'équipement (seuil, température, lieu) et les lots en quarantaine sur cet
// équipement. Une excursion froid isole TOUS les lots EN_STOCK de l'équipement
// (0..N), l'alerte ne référence aucun lot précis.

interface EquipmentApi {
  id: string;
  nom: string;
  temp_actuelle: string | null;
  temp_seuil_max: string | null;
  sensor_id: string | null;
  lieu?: { nom: string } | null;
}

interface QuarantineBatchApi {
  id: string;
  lot_number: string;
  quantite_actuelle: string;
  unite_code: string;
  id_materiel_actuel: string | null;
  produit?: { nom: string } | null;
}

export interface AlertDecisionBatch {
  id: string;
  lotNumber: string;
  produitNom: string;
  quantite: number;
  uniteCode: string;
}

export interface AlertDecision {
  alert: Alert;
  equipmentNom: string | null;
  lieuNom: string | null;
  /** Température mesurée (structurée quand l'équipement la porte, sinon null → cf. message). */
  tempMesuree: number | null;
  tempSeuilMax: number | null;
  /** Lots actuellement en quarantaine sur l'équipement de l'alerte. */
  batches: AlertDecisionBatch[];
}

/** Decimal Prisma sérialisé en string : conversion sûre (null/"" → null). */
function toNumber(value: string | null | undefined): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Recompose la vue de décision. Renvoie `null` si l'alerte est introuvable
 * (déjà résolue par un autre poste, ou id erroné).
 */
export async function loadAlertDecision(alertId: string): Promise<AlertDecision | null> {
  const { data: alertsResp } = await apiClient.get<{ data: Alert[] }>(
    '/api/organization/alerts'
  );
  const alert = alertsResp.data.find((a) => a.id === alertId);
  if (!alert) return null;

  const materielId = alert.id_materiel ?? null;
  if (!materielId) {
    return {
      alert,
      equipmentNom: null,
      lieuNom: null,
      tempMesuree: null,
      tempSeuilMax: null,
      batches: [],
    };
  }

  const [{ data: eqResp }, { data: qbResp }] = await Promise.all([
    apiClient.get<{ data: EquipmentApi[] }>('/api/organization/equipment'),
    apiClient.get<{ data: QuarantineBatchApi[] }>('/api/organization/quarantine-batches'),
  ]);

  const equipment = eqResp.data.find((e) => e.id === materielId);
  const batches: AlertDecisionBatch[] = qbResp.data
    .filter((b) => b.id_materiel_actuel === materielId)
    .map((b) => ({
      id: b.id,
      lotNumber: b.lot_number,
      produitNom: b.produit?.nom ?? 'Produit inconnu',
      quantite: toNumber(b.quantite_actuelle) ?? 0,
      uniteCode: b.unite_code,
    }));

  return {
    alert,
    equipmentNom: equipment?.nom ?? null,
    lieuNom: equipment?.lieu?.nom ?? null,
    tempMesuree: toNumber(equipment?.temp_actuelle),
    tempSeuilMax: toNumber(equipment?.temp_seuil_max),
    batches,
  };
}

// ── Actions de décision (écritures en ligne, hors file offline) ────────────────
// Réservées aux rôles qualité côté API (owner/admin/quality) : un `operator`
// reçoit un 403 (séparation des tâches HACCP), remonté tel quel à l'UI.

/**
 * « Maintenir la quarantaine » : les lots ont déjà été isolés automatiquement à
 * la détection ; on se contente de clôturer l'alerte (avec une note d'action).
 */
export async function resolveAlert(alertId: string, note?: string): Promise<void> {
  const trimmed = note?.trim();
  await apiClient.patch(
    `/api/alerts/${alertId}/resolve`,
    trimmed ? { note: trimmed } : {}
  );
}

/**
 * « Enregistrer sans isolation » : lève la quarantaine des lots (BLOQUE → EN_STOCK)
 * puis clôture l'alerte. Le `motif` (obligatoire côté API, 3–500 car.) et la note
 * partagent le texte d'action corrective saisi par l'opérateur.
 */
export async function releaseAndResolve(
  alertId: string,
  batchIds: string[],
  motif: string
): Promise<void> {
  for (const id of batchIds) {
    await apiClient.post(`/api/logistics/batches/${id}/release`, { motif });
  }
  await resolveAlert(alertId, motif);
}
