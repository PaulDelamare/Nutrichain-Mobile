import { apiClient } from './api';

/**
 * Enum strict du serveur (`VALID_UNITS`). Une unité hors de cette liste fait rejeter TOUTE la
 * transformation — et la base mélange les casses (« kg » et « KG » y coexistent), donc on
 * normalise systématiquement en majuscules.
 */
const SERVER_UNITS = ['KG', 'G', 'L', 'ML', 'UNIT', 'PALLET', 'BOX'];

/** `inputs` est borné par `.maxLength(50)` côté serveur. */
const MAX_INPUTS = 50;

/**
 * `quantite_produite` et `quantite_prelevee` sont des `decimal([0, 2])` côté serveur : une
 * balance qui affiche 12.345 ferait rejeter la transformation en 422, après coup.
 */
const DECIMAL_PATTERN = /^\d+([.,]\d{1,2})?$/;

export interface TransformationInput {
  productId: string;
  /** La cuve, scannée sur place. */
  equipmentId: string;
  quantity: string;
  unit: string;
  inputs: {
    batchId: string;
    quantity: string;
    unit: string;
    /** Stock restant du lot parent : au-delà, le serveur refuse le prélèvement. */
    available: number;
  }[];
}

/**
 * Pas de `lot_parent_epuise` : depuis l'API #123, l'épuisement du lot parent est DÉRIVÉ du stock
 * relu en base après prélèvement, il n'est plus déclaré par le client. Le champ ne figure plus dans
 * le schéma VineJS du serveur, qui le jetait donc en silence à chaque envoi (#98). Le conserver
 * laissait croire que le mobile décidait de l'épuisement — ce qui n'est plus vrai.
 */
export interface TransformationPayload {
  id_produit_fini: string;
  id_materiel: string;
  quantite_produite: number;
  unite_code: string;
  inputs: {
    id_lot_parent: string;
    quantite_prelevee: number;
    unite: string;
  }[];
}

function parseQuantity(value: string): number {
  return Number(value.replace(',', '.'));
}

/**
 * Un lot dont l'unité est inconnue du serveur (« U », « litre », « pcs » — `unite_code` est du
 * texte libre à la réception) est intransformable. Sans ce contrôle AU SCAN, le lot s'ajoute
 * normalement et c'est le bouton d'envoi qui reste gris, sans jamais dire lequel des lots
 * est en cause : un cul-de-sac muet.
 */
export function isTransformableUnit(unit: string): boolean {
  return SERVER_UNITS.includes(unit.toUpperCase());
}

/**
 * Le message exact, sous le champ fautif. Un bouton grisé qui n'explique rien laisse
 * l'opérateur devant sa cuve sans issue.
 */
export function quantityError(value: string, available?: number): string | null {
  const raw = value.trim();

  if (!DECIMAL_PATTERN.test(raw)) {
    return 'Nombre invalide (2 décimales maximum).';
  }

  const quantity = parseQuantity(raw);

  if (quantity <= 0) {
    return 'La quantité doit être supérieure à 0.';
  }

  if (available !== undefined && quantity > available) {
    return `Stock insuffisant : ${available} disponibles.`;
  }

  return null;
}

/** Les unités réellement proposables : celles des lots, ramenées à la forme qu'accepte le serveur. */
export function transformationUnits(units: string[]): string[] {
  const normalized = units.map((unit) => unit.toUpperCase()).filter(isTransformableUnit);

  return [...new Set(normalized)];
}

/**
 * Seul garde-fou avant l'envoi. Une transformation refusée par le serveur, c'est un opérateur
 * debout devant sa cuve qui ne sait pas pourquoi — autant l'attraper ici.
 */
export function buildTransformation(input: TransformationInput): TransformationPayload | null {
  const valid =
    input.productId !== '' &&
    input.equipmentId !== '' &&
    quantityError(input.quantity) === null &&
    isTransformableUnit(input.unit) &&
    // Sans composant, la généalogie est rompue : le rappel ne pourrait plus remonter du
    // produit fini à ses matières premières.
    input.inputs.length > 0 &&
    input.inputs.length <= MAX_INPUTS &&
    input.inputs.every(
      (item) =>
        item.batchId !== '' &&
        quantityError(item.quantity, item.available) === null &&
        isTransformableUnit(item.unit)
    );

  if (!valid) {
    return null;
  }

  return {
    id_produit_fini: input.productId,
    id_materiel: input.equipmentId,
    quantite_produite: parseQuantity(input.quantity),
    unite_code: input.unit.toUpperCase(),
    inputs: input.inputs.map((item) => ({
      id_lot_parent: item.batchId,
      quantite_prelevee: parseQuantity(item.quantity),
      unite: item.unit.toUpperCase(),
    })),
  };
}

export async function createTransformation(payload: TransformationPayload): Promise<void> {
  await apiClient.post('/api/traceability/transformations', payload);
}
