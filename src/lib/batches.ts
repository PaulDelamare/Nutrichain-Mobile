import { apiClient } from './api';
import { serverNow } from './server-time';
import { readCache, writeCache } from './cache';
import { ApiError } from './errors';
import { isPackageCode, LOT_NUMBER_MAX_LENGTH, scanCandidates } from './gs1';

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
 * Pourquoi ce lot ne peut pas sortir, EN FRANÇAIS. L'opérateur lisait le code brut du statut
 * (« EN_ATTENTE_QC ») : ça ne lui dit ni ce qui bloque, ni qui peut le débloquer.
 *
 * C'est la garde sanitaire centrale — quarantaine qualité, excursion de température, rappel,
 * péremption — et elle n'existe qu'ICI. Le serveur la fait respecter de son côté, mais l'opérateur
 * doit le savoir devant sa cuve, pas dix minutes plus tard à la synchronisation.
 */
export function blockingReason(batch: Batch): string | null {
  const statut = batch.statut.toUpperCase();

  if (statut === 'EN_ATTENTE_QC') {
    return "Ce lot attend son contrôle qualité de sortie d'usine. Le service qualité doit le libérer.";
  }
  if (statut === 'BLOQUE') {
    return 'Ce lot est en quarantaine. Seule une décision qualité peut la lever.';
  }
  if (statut === 'ALERTE') {
    return 'Ce lot est sous rappel produit. Il ne doit plus quitter le stock.';
  }
  if (statut === 'EXPEDIE' || statut === 'EPUISE') {
    return "Ce lot a déjà quitté le stock.";
  }
  if (statut === 'EN_PRODUCTION') {
    return 'Ce lot est en cours de transformation.';
  }
  // ⚠️ La péremption se tranche sur l'horloge du SERVEUR, jamais sur celle du téléphone.
  //
  // `Date.now()` est réglable à la main, et le système la resynchronise sans prévenir. Une horloge
  // reculée de deux mois faisait ACCEPTER un lot périmé en transformation et en expédition : la
  // garde sanitaire de l'application était l'horloge de l'appareil.
  //
  // Et quand on ne connaît pas l'heure du serveur, on ne conclut RIEN. Retomber sur l'horloge
  // locale « en attendant » reproduirait exactement le bug, en silence. On refuse le lot en le
  // DISANT : mieux vaut un opérateur qui rappelle le bureau qu'un lot périmé dans une cuve.
  if (batch.date_peremption) {
    const reference = serverNow();

    if (reference.kind === 'unknown') {
      return "Impossible de vérifier la péremption : l'heure du serveur est inconnue (aucune connexion depuis l'installation). Reconnectez-vous une fois avant d'utiliser ce lot.";
    }
    if (new Date(batch.date_peremption).getTime() <= reference.now) {
      return 'La date de péremption de ce lot est dépassée.';
    }
  }

  return null;
}

/**
 * Taille de page demandée au catalogue — le plafond de volumétrie de l'API.
 *
 * Ce qui n'est pas dans cette liste n'est résolvable QUE par le serveur (`lookupBatch`), donc pas
 * du tout dans une chambre froide. Chaque lot manquant ici est un « Lot inconnu » hors réseau sur
 * une marchandise bien réelle : autant en emporter le maximum tant qu'on a du signal. La liste
 * n'est jamais affichée — elle ne sert qu'à résoudre un code scanné — donc sa taille ne coûte
 * rien à l'écran.
 */
const BATCH_CATALOG_LIMIT = 500;

/**
 * Le catalogue tel que l'API le renvoie — sous ses DEUX formes.
 *
 * `GET /api/traceability/batches` répondait par un tableau nu ; il est devenu paginé
 * (`{ data, pagination }`, nutrichain-api#231). Une application mobile n'est pas déployée avec son
 * API : un APK distribué sur un téléphone continue d'appeler la version qu'il trouve. Les deux
 * formes doivent donc être lues, dans les deux sens de mise à jour.
 */
type BatchCatalogPayload =
  | Batch[]
  | { data?: Batch[]; pagination?: { total?: number } }
  | null
  | undefined;

/**
 * ⚠️ Ne renvoie JAMAIS autre chose qu'un tableau.
 *
 * `data.data` était renvoyé tel quel, typé `Batch[]` sans que rien ne le vérifie à l'exécution.
 * Le jour où l'API a paginé, ce « tableau » est devenu un objet : `findBatchByCode` appelait
 * `batches.find(...)` dessus et l'onglet Scan plantait, sans la moindre erreur TypeScript.
 */
function toBatchArray(payload: BatchCatalogPayload): Batch[] {
  if (Array.isArray(payload)) {
    return payload;
  }

  return Array.isArray(payload?.data) ? payload.data : [];
}

export async function loadBatches(): Promise<Batch[]> {
  try {
    const { data } = await apiClient.get<{ data: BatchCatalogPayload }>(
      '/api/traceability/batches',
      { params: { limit: BATCH_CATALOG_LIMIT } }
    );
    const batches = toBatchArray(data.data);

    await writeCache('batches', batches);
    return batches;
  } catch (error) {
    const cached = await readCache<BatchCatalogPayload>('batches');
    // Le cache peut avoir été écrit par une version antérieure de l'app, qui y déposait la réponse
    // paginée entière. On ne le sert pas tel quel : hors réseau, ce serait un plantage sans recours.
    if (Array.isArray(cached)) {
      return cached;
    }
    throw error;
  }
}

/**
 * Résout un code scanné en lot, parmi ceux déjà chargés.
 *
 * L'étiquette qu'imprime NutriChain n'est pas le numéro de lot : c'est une URL GS1 Digital Link.
 * Sans décodage, scanner notre propre marchandise devant la cuve ou le camion répondait
 * « Lot inconnu ». Le décodage vit ICI, pas chez les appelants — le prochain écran qui scanne un
 * lot l'oublierait.
 *
 * ⚠️ Le code BRUT est essayé en PREMIER, le décodé ensuite : le brut est la clé de nos données, le
 * décodage n'est qu'une interprétation.
 *
 * ⚠️ Portée : `batches` ne contient qu'une PAGE du catalogue, la plus récente. Cette fonction ne
 * peut donc PAS conclure « ce lot n'existe pas » — seul `lookupBatch`, qui interroge le serveur en
 * repli, en a le droit.
 */
export function findBatchByCode(code: string, batches: Batch[]): Batch | undefined {
  for (const needle of scanCandidates(code).map((value) => value.toLowerCase())) {
    const found = batches.find(
      (batch) => batch.lot_number.toLowerCase() === needle || batch.id.toLowerCase() === needle
    );
    if (found) {
      return found;
    }
  }

  return undefined;
}

/**
 * ⚠️ Dérivé de `blockingReason`, et non réécrit à côté.
 *
 * La règle sanitaire vivait en DEUX exemplaires : une correction dans l'un laissait l'autre intact.
 * Un lot pouvait donc être « refusé avec un motif » d'un côté, et « utilisable » de l'autre — et
 * c'est le second qui garde la cuve. Un seul endroit décide.
 */
export function isUsableBatch(batch: Batch): boolean {
  return blockingReason(batch) === null;
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

function toBatchDetail(b: BatchApi): BatchDetail {
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
}

/**
 * Ce qu'on peut honnêtement dire d'une fiche lot — QUATRE issues, jamais un `null` fourre-tout.
 *
 * Avant, `catch { return null }` confondait un lot introuvable (404), un refus de droits (403) et une
 * panne réseau sous le même écran vide « indisponible », sans bouton Réessayer. `lookupBatch` faisait
 * pourtant déjà la distinction dans ce fichier. On l'aligne.
 */
export type BatchDetailResult =
  | { kind: 'ok'; batch: BatchDetail }
  /** 404 : ce lot n'existe pas. Réponse DÉFINITIVE — rien à réessayer. */
  | { kind: 'unknown' }
  /** 403 : pas les droits sur ce lot. PERMANENT — rejouer avec les mêmes droits ne changera rien. */
  | { kind: 'forbidden' }
  /** Réseau / 401 / 500 : on n'a pas pu demander. TRANSITOIRE — l'écran propose de réessayer. */
  | { kind: 'unverifiable'; error: unknown };

/** Fiche d'un lot (`GET /api/logistics/batches/:id`, include produit+unité). Ne REJETTE jamais. */
export async function loadBatch(id: string): Promise<BatchDetailResult> {
  try {
    const { data } = await apiClient.get<{ data: BatchApi }>(`/api/logistics/batches/${id}`);
    return { kind: 'ok', batch: toBatchDetail(data.data) };
  } catch (error: unknown) {
    if (error instanceof ApiError && error.status === 404) return { kind: 'unknown' };
    if (error instanceof ApiError && error.status === 403) return { kind: 'forbidden' };
    // Tout le reste (panne réseau, 401, 500) est une incertitude, pas une réponse : le dire.
    return { kind: 'unverifiable', error };
  }
}

// ── Retrouver le lot qu'on vient de scanner ───────────────────────────────────────────────────

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toBatch(b: BatchApi): Batch {
  return {
    id: b.id,
    lot_number: b.lot_number,
    statut: b.statut,
    quantite_actuelle: b.quantite_actuelle,
    unite_code: b.unite_code,
    date_peremption: b.date_peremption,
    produit: { nom: b.produit?.nom ?? 'Produit inconnu' },
  };
}

/**
 * Les trois issues d'un scan — et elles sont bien TROIS.
 *
 * Confondre « ce lot n'existe pas » et « je n'ai pas pu le demander » est la faute qui revient sans
 * cesse ici : elle fait annoncer « Lot inconnu » sur une marchandise bien réelle, et pousse
 * l'opérateur à la resaisir.
 */
export type BatchLookup =
  | { kind: 'found'; batch: Batch }
  | { kind: 'unknown' }
  | { kind: 'unverifiable'; error: unknown };

async function askServer(path: string, params?: Record<string, string>): Promise<Batch | null> {
  try {
    const { data } = await apiClient.get<{ data: BatchApi }>(path, params ? { params } : undefined);
    return toBatch(data.data);
  } catch (error: unknown) {
    // 404 = « ce lot n'existe pas ». TOUT le reste (réseau, 401, 500) est une incertitude, pas une
    // réponse : l'avaler dans le même `null` ferait mentir tous les écrans d'un coup.
    if (error instanceof ApiError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

/**
 * Retrouve le lot désigné par un code scanné. **Le seul point de résolution** : l'onglet Scan, la
 * transformation et l'expédition passent tous par ici, donc une même étiquette donne partout la
 * même réponse.
 *
 * 1. La liste déjà chargée, si on en a une : instantané, et suffisant dans l'immense majorité des cas.
 * 2. Sinon le serveur. Indispensable : `GET /traceability/batches` est paginé, donc un lot plus
 *    ancien (un ingrédient à longue conservation) était annoncé « inconnu » devant le camion alors
 *    qu'il est en stock, étiqueté par nous.
 */
export async function lookupBatch(code: string, batches: Batch[] = []): Promise<BatchLookup> {
  const local = findBatchByCode(code, batches);
  if (local) {
    return { kind: 'found', batch: local };
  }

  // Un SSCC désigne un colis : il n'y a aucun lot à chercher, et l'annoncer « non vérifié » hors
  // réseau serait un faux problème.
  if (isPackageCode(code)) {
    return { kind: 'unknown' };
  }

  // Une panne sur UN candidat ne doit pas enterrer le suivant : sinon une étiquette dont le code
  // brut part en 500 n'essaierait jamais le numéro de lot décodé — qui, lui, aurait été trouvé.
  let failure: unknown;

  for (const candidate of scanCandidates(code)) {
    try {
      const batch = UUID.test(candidate)
        ? // Un identifiant de lot n'est pas un numéro de lot : l'endpoint de résolution le
          // refuserait (36 caractères). Il a sa propre route — et `findBatchByCode` accepte les
          // deux, donc le serveur doit accepter les deux aussi.
          await askServer(`/api/logistics/batches/${candidate}`)
        : candidate.length <= LOT_NUMBER_MAX_LENGTH
          ? await askServer('/api/logistics/batches/resolve', { lot_number: candidate })
          : null;

      if (batch) {
        return { kind: 'found', batch };
      }
    } catch (error: unknown) {
      failure = error;
    }
  }

  // Aucun candidat n'a abouti. Si l'un d'eux a échoué sans réponse, on ne SAIT PAS : le dire.
  return failure ? { kind: 'unverifiable', error: failure } : { kind: 'unknown' };
}
