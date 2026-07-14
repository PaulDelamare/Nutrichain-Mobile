import { apiClient } from './api';
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
 * Statuts qui interdisent à un lot de quitter le stock : c'est la garde sanitaire centrale
 * (quarantaine qualité, excursion de température, rappel). Le serveur la fait respecter, mais
 * l'opérateur doit le savoir devant sa cuve — pas dix minutes plus tard, à la synchronisation.
 */
const BLOCKING_STATUSES = [
  'EN_ATTENTE_QC',
  'BLOQUE',
  'ALERTE',
  'EXPEDIE',
  'EPUISE',
  'EN_PRODUCTION',
];

/**
 * Pourquoi ce lot ne peut pas sortir, EN FRANÇAIS. L'opérateur lisait le code brut du statut
 * (« EN_ATTENTE_QC ») : ça ne lui dit ni ce qui bloque, ni qui peut le débloquer.
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
  if (batch.date_peremption && new Date(batch.date_peremption).getTime() <= Date.now()) {
    return 'La date de péremption de ce lot est dépassée.';
  }

  return null;
}

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
 * ⚠️ Portée : `batches` ne contient que les 100 lots les plus RÉCENTS (l'API plafonne). Cette
 * fonction ne peut donc PAS conclure « ce lot n'existe pas » — seul `lookupBatch`, qui interroge le
 * serveur en repli, en a le droit.
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
 * Fiche d'un lot (`GET /api/logistics/batches/:id`, include produit+unité).
 * Renvoie `null` si introuvable / hors réseau — l'écran affiche un état vide.
 */
export async function loadBatch(id: string): Promise<BatchDetail | null> {
  try {
    const { data } = await apiClient.get<{ data: BatchApi }>(`/api/logistics/batches/${id}`);
    return toBatchDetail(data.data);
  } catch {
    return null;
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
 * 2. Sinon le serveur. Indispensable : `GET /traceability/batches` est plafonné à 100 lots, donc un
 *    lot plus ancien (un ingrédient à longue conservation) était annoncé « inconnu » devant le
 *    camion alors qu'il est en stock, étiqueté par nous.
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
