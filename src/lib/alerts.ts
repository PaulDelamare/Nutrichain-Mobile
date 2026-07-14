import { apiClient } from './api';
import { isNetworkError } from './errors';

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

/** Ce que l'API répond pour `GET /alerts/:id/batches` — les lots que CETTE alerte retient. */
interface AlertBatchApi {
  id: string;
  lot_number: string;
  quantite_actuelle: string;
  unite_code: string;
  produit?: { nom: string } | null;
  levable: boolean;
  motif_blocage: 'CONTROLE_NON_CONFORME' | null;
}

export interface AlertDecisionBatch {
  id: string;
  lotNumber: string;
  produitNom: string;
  quantite: number;
  uniteCode: string;
  /**
   * Faux si le lot porte un contrôle qualité NON CONFORME postérieur à son isolement : il est isolé
   * par le froid ET déclaré impropre. Réparer la chambre froide ne le rend pas consommable — la
   * levée de cette alerte ne doit PAS le remettre en stock.
   */
  levable: boolean;
  motifBlocage: 'CONTROLE_NON_CONFORME' | null;
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
 * Ce qu'on peut dire d'une alerte — QUATRE issues, et pas une de moins.
 *
 * L'écran n'en connaissait que deux (« j'ai la décision » / `null`), et il traduisait `null` par
 * **« déjà résolue sur un autre poste »**, coche verte à l'appui. Or :
 *
 * - une **panne réseau** faisait JETER la fonction → l'écran retombait sur ce même `null` → il
 *   annonçait l'incident réglé à un opérateur qui, précisément, est dans une chambre froide ;
 * - `GET /organization/alerts` ne filtre RIEN (vérifié : `organization.service.ts`) : une alerte
 *   résolue **figure encore dans la liste**. Donc « absente » ne veut pas dire « résolue », mais
 *   **« id inconnu »** ;
 * - et une alerte **vraiment résolue ailleurs** était donc TROUVÉE → l'écran affichait l'incident
 *   entier, **boutons actifs**. « Maintenir la quarantaine » appelait alors un endpoint idempotent
 *   qui répond 200 → **toast de succès** sur des lots qui sont déjà en stock.
 *
 * Cette fonction ne REJETTE jamais : `unverifiable` EST le canal d'erreur.
 */
export type AlertDecisionResult =
  | { kind: 'active'; decision: AlertDecision }
  /** Trouvée, mais clôturée : c'est ICI, et seulement ici, que « déjà résolue » est vrai. */
  | { kind: 'resolved'; alert: Alert }
  /** Absente de la liste : identifiant inconnu. On ne prétend pas savoir pourquoi. */
  | { kind: 'unknown' }
  | { kind: 'unverifiable'; error: unknown };

/**
 * ⚠️ Aucun rendu PARTIEL. Si l'équipement ou les lots manquent, on refuse d'afficher : un écran
 * qui montre l'incident sans ses lots proposerait « Lever la quarantaine », annoncerait
 * « 0 lot(s) seront remis en stock », **ne relâcherait rien** — et clôturerait quand même l'alerte
 * en annonçant « Lot(s) remis en stock ». Mieux vaut ne rien montrer que montrer à moitié.
 */
async function buildAlertDecision(alertId: string): Promise<AlertDecisionResult> {
  const { data: alertsResp } = await apiClient.get<{ data: Alert[] }>(
    '/api/organization/alerts'
  );
  const alert = alertsResp.data.find((a) => a.id === alertId);
  if (!alert) return { kind: 'unknown' };

  if (alert.statut !== 'ACTIVE') {
    return { kind: 'resolved', alert };
  }

  const materielId = alert.id_materiel ?? null;
  if (!materielId) {
    return {
      kind: 'active',
      decision: {
        alert,
        equipmentNom: null,
        lieuNom: null,
        tempMesuree: null,
        tempSeuilMax: null,
        batches: [],
      },
    };
  }

  // ⚠️ On DEMANDE les lots de l'alerte — on ne les devine plus.
  //
  // Avant, cette liste était reconstituée en filtrant `/organization/quarantine-batches` (qui renvoie
  // TOUS les lots BLOQUE de l'organisation) sur l'équipement de l'alerte. Un lot bloqué par un
  // contrôle qualité sans aucun rapport — corps étranger, DLC — mais rangé dans le même frigo s'y
  // retrouvait, et « Enregistrer sans isolation » le REMETTAIT EN STOCK. Un relâchement non consenti,
  // sur une marchandise que l'opérateur n'avait jamais examinée.
  //
  // L'API sait, elle, quels lots CETTE alerte retient (elle l'écrit depuis toujours). Elle dit aussi
  // lesquels sont `levable` : un lot déclaré non conforme APRÈS son isolement ne doit pas repartir en
  // stock sous prétexte que le frigo est réparé.
  const [{ data: eqResp }, { data: abResp }] = await Promise.all([
    apiClient.get<{ data: EquipmentApi[] }>('/api/organization/equipment'),
    apiClient.get<{ data: AlertBatchApi[] }>(`/api/alerts/${alertId}/batches`),
  ]);

  const equipment = eqResp.data.find((e) => e.id === materielId);
  const batches: AlertDecisionBatch[] = abResp.data.map((b) => ({
    id: b.id,
    lotNumber: b.lot_number,
    produitNom: b.produit?.nom ?? 'Produit inconnu',
    quantite: toNumber(b.quantite_actuelle) ?? 0,
    uniteCode: b.unite_code,
    levable: b.levable,
    motifBlocage: b.motif_blocage,
  }));

  return {
    kind: 'active',
    decision: {
      alert,
      equipmentNom: equipment?.nom ?? null,
      lieuNom: equipment?.lieu?.nom ?? null,
      tempMesuree: toNumber(equipment?.temp_actuelle),
      tempSeuilMax: toNumber(equipment?.temp_seuil_max),
      batches,
    },
  };
}

export async function loadAlertDecision(alertId: string): Promise<AlertDecisionResult> {
  try {
    return await buildAlertDecision(alertId);
  } catch (error: unknown) {
    return { kind: 'unverifiable', error };
  }
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

/** Ce qui s'est RÉELLEMENT passé — observé côté serveur, jamais déduit des exceptions. */
export interface ReleaseOutcome {
  /** Lots effectivement sortis de quarantaine. */
  released: AlertDecisionBatch[];
  /** Lots ENCORE isolés. Tant qu'il y en a, la levée n'est pas terminée. */
  stillBlocked: AlertDecisionBatch[];
  /** L'alerte n'est clôturée que si plus aucun lot n'est isolé. */
  alertResolved: boolean;
  /** La cause de l'échec, s'il y en a eu une — pour la dire à l'opérateur. */
  error?: unknown;
}

/** Les lots que cette alerte retient ENCORE, selon le SERVEUR. */
async function stillQuarantined(alertId: string): Promise<Set<string>> {
  const { data } = await apiClient.get<{ data: AlertBatchApi[] }>(`/api/alerts/${alertId}/batches`);
  return new Set(data.data.map((b) => b.id));
}

/**
 * « Enregistrer sans isolation » : lève la quarantaine des lots, puis clôture l'alerte.
 *
 * ⚠️ La boucle n'est PAS atomique (l'API n'a pas d'endpoint de levée en masse). Elle ne l'était pas
 * non plus avant — mais elle **abandonnait au premier échec** en laissant croire que rien n'avait
 * bougé : sur 5 lots, si le 3e échouait, les deux premiers étaient **déjà remis en stock** et
 * l'écran affichait « Levée impossible ». L'opérateur repartait convaincu que sa marchandise
 * suspecte était toujours isolée.
 *
 * Trois règles, chacune apprise d'une erreur :
 *
 * 1. **Une panne réseau ARRÊTE la boucle.** Insister, c'est 30 s de délai d'attente × N lots :
 *    deux minutes trente de spinner bloquant, dans une chambre froide. Une erreur applicative (le
 *    serveur a répondu), elle, ne concerne qu'un lot : on continue.
 * 2. **Le compte-rendu est OBSERVÉ, pas déduit.** Le `release` n'est pas idempotent : un lot déjà
 *    relâché répond **409 pour toujours**. Compter ce 409 comme un échec rendrait l'alerte
 *    **définitivement inclôturable**. On relit donc l'état réel côté serveur.
 * 3. **L'alerte n'est clôturée que si plus aucun lot n'est isolé.** Sinon elle disparaîtrait de
 *    l'écran avec de la marchandise suspecte encore bloquée — et personne pour la traiter.
 */
export async function releaseAndResolve(
  alertId: string,
  batches: AlertDecisionBatch[],
  motif: string
): Promise<ReleaseOutcome> {
  // ⚠️ On ne relâche QUE les lots levables. Un lot déclaré non conforme après son isolement est isolé
  // par le froid ET impropre : le rendre au stock parce que la chambre froide est réparée serait
  // remettre en circulation une marchandise que le labo a condamnée. Il reste isolé — et un autre
  // circuit (le contrôle qualité) tranchera son sort.
  const levables = batches.filter((b) => b.levable);
  const condamnes = batches.filter((b) => !b.levable);

  let failure: unknown;

  for (const batch of levables) {
    try {
      await apiClient.post(`/api/logistics/batches/${batch.id}/release`, { motif });
    } catch (error: unknown) {
      failure = error;
      // Sans réponse du serveur, les suivants échoueront pareil : on ne fait pas patienter
      // l'opérateur 30 secondes de plus par lot.
      if (isNetworkError(error)) break;
    }
  }

  let held: Set<string>;
  try {
    held = await stillQuarantined(alertId);
  } catch (error: unknown) {
    // On ne peut même plus observer : on ne prétend RIEN. Aucun lot n'est déclaré relâché.
    return { released: [], stillBlocked: batches, alertResolved: false, error: failure ?? error };
  }

  const released = levables.filter((b) => !held.has(b.id));
  const echoues = levables.filter((b) => held.has(b.id));

  if (echoues.length > 0) {
    // Les condamnés ne sont pas un échec — ils sont un refus assumé. Mais ils restent isolés, donc
    // l'opérateur doit les voir dans la liste de ce qui l'est encore.
    return {
      released,
      stillBlocked: [...echoues, ...condamnes],
      alertResolved: false,
      error: failure,
    };
  }

  // ⚠️ L'alerte se clôture même s'il reste des lots condamnés. Ne pas la clôturer la rendrait
  // DÉFINITIVEMENT inclôturable : leur blocage ne vient pas du froid, et rien dans ce circuit ne
  // pourra jamais le lever. L'incident froid, lui, est bien traité.
  await resolveAlert(alertId, motif);
  return { released, stillBlocked: condamnes, alertResolved: true };
}
