import {
  buildTransformation,
  isTransformableUnit,
  quantityError,
  transformationUnits,
  type TransformationInput,
} from './transformation';

const VALID: TransformationInput = {
  productId: 'p-1',
  equipmentId: 'eq-cuve',
  quantity: '250',
  unit: 'KG',
  inputs: [
    { batchId: 'b-1', quantity: '300', unit: 'L', exhausted: true, available: 400 },
    { batchId: 'b-2', quantity: '5', unit: 'KG', exhausted: false, available: 10 },
  ],
};

describe('buildTransformation', () => {
  it('assemble une transformation complète', () => {
    expect(buildTransformation(VALID)).toEqual({
      id_produit_fini: 'p-1',
      id_materiel: 'eq-cuve',
      quantite_produite: 250,
      unite_code: 'KG',
      inputs: [
        { id_lot_parent: 'b-1', quantite_prelevee: 300, unite: 'L', lot_parent_epuise: true },
        { id_lot_parent: 'b-2', quantite_prelevee: 5, unite: 'KG', lot_parent_epuise: false },
      ],
    });
  });

  it('accepte la virgule décimale', () => {
    expect(buildTransformation({ ...VALID, quantity: '12,5' })?.quantite_produite).toBe(12.5);
  });

  it('normalise en majuscules l’unité venue du lot', () => {
    // Les lots sont stockés en « kg » aussi bien qu'en « KG » : l'enum du serveur n'accepte que
    // la seconde forme. Sans normalisation, un lot en minuscules ferait rejeter tout l'envoi.
    const inputs = [{ batchId: 'b-1', quantity: '3', unit: 'kg', exhausted: false, available: 10 }];

    expect(buildTransformation({ ...VALID, unit: 'kg', inputs })).toMatchObject({
      unite_code: 'KG',
      inputs: [expect.objectContaining({ unite: 'KG' })],
    });
  });

  it('exige au moins un lot parent', () => {
    // Une transformation sans composant ne relie rien : la généalogie serait rompue, et le
    // rappel produit ne pourrait plus remonter du produit fini à ses matières premières.
    expect(buildTransformation({ ...VALID, inputs: [] })).toBeNull();
  });

  it('refuse plus de 50 lots parents', () => {
    const inputs = Array.from({ length: 51 }, (_, index) => ({
      batchId: `b-${index}`,
      quantity: '1',
      unit: 'KG',
      exhausted: false,
      available: 10,
    }));

    expect(buildTransformation({ ...VALID, inputs })).toBeNull();
    expect(buildTransformation({ ...VALID, inputs: inputs.slice(0, 50) })).not.toBeNull();
  });

  it('refuse une quantité nulle, négative ou illisible', () => {
    expect(buildTransformation({ ...VALID, quantity: '0' })).toBeNull();
    expect(buildTransformation({ ...VALID, quantity: '-3' })).toBeNull();
    expect(buildTransformation({ ...VALID, quantity: 'beaucoup' })).toBeNull();
  });

  it('refuse plus de deux décimales', () => {
    // Le serveur attend un `decimal([0, 2])` : une balance qui affiche 12.345 ferait rejeter la
    // transformation en 422, après que l'opérateur a tout ressaisi.
    expect(buildTransformation({ ...VALID, quantity: '12.345' })).toBeNull();
    expect(buildTransformation({ ...VALID, quantity: '12.34' })).not.toBeNull();
  });

  it('refuse un prélèvement supérieur au stock du lot', () => {
    // Le serveur refuse, mais son message contient l'UUID brut du lot : sur six parents,
    // l'opérateur ne saurait pas lequel corriger.
    const inputs = [{ batchId: 'b-1', quantity: '500', unit: 'L', exhausted: false, available: 400 }];

    expect(buildTransformation({ ...VALID, inputs })).toBeNull();
  });

  it('refuse un lot parent dont la quantité prélevée est invalide', () => {
    const inputs = [{ batchId: 'b-1', quantity: '0', unit: 'L', exhausted: false, available: 10 }];

    expect(buildTransformation({ ...VALID, inputs })).toBeNull();
  });

  it('refuse un lot parent sans identifiant', () => {
    const inputs = [{ batchId: '', quantity: '3', unit: 'L', exhausted: false, available: 10 }];

    expect(buildTransformation({ ...VALID, inputs })).toBeNull();
  });

  it('exige la cuve et le produit fini', () => {
    expect(buildTransformation({ ...VALID, equipmentId: '' })).toBeNull();
    expect(buildTransformation({ ...VALID, productId: '' })).toBeNull();
  });

  it('refuse une unité que le serveur n’accepte pas', () => {
    // Le serveur valide `unite_code` contre un enum strict : une unité inconnue fait
    // rejeter toute la transformation.
    expect(buildTransformation({ ...VALID, unit: 'tonnes' })).toBeNull();
  });

  it('refuse un lot parent dont l’unité est inconnue du serveur', () => {
    // `unite_code` est du texte libre à la réception : un lot peut naître en « U ». C'est la
    // SEULE garde qui empêche l'envoi de partir en 422 — elle doit être tenue par un test.
    const inputs = [{ batchId: 'b-1', quantity: '3', unit: 'U', exhausted: false, available: 10 }];

    expect(buildTransformation({ ...VALID, inputs })).toBeNull();
  });
});

describe('quantityError', () => {
  it('accepte une quantité valide', () => {
    expect(quantityError('12.5', 100)).toBeNull();
  });

  it('nomme le stock disponible plutôt que de laisser le serveur répondre un UUID', () => {
    expect(quantityError('500', 400)).toBe('Stock insuffisant : 400 disponibles.');
  });

  it('rejette une troisième décimale', () => {
    expect(quantityError('12.345')).toBe('Nombre invalide (2 décimales maximum).');
  });

  it('rejette zéro et le non-numérique', () => {
    expect(quantityError('0')).toBe('La quantité doit être supérieure à 0.');
    expect(quantityError('beaucoup')).toBe('Nombre invalide (2 décimales maximum).');
  });
});

describe('isTransformableUnit', () => {
  it('accepte une unité de l’enum serveur, quelle que soit sa casse', () => {
    expect(isTransformableUnit('kg')).toBe(true);
    expect(isTransformableUnit('KG')).toBe(true);
  });

  it('refuse une unité absente de l’enum serveur', () => {
    // « U » existe bel et bien en base (seed) et sort de l'écran de réception : c'est le cas
    // réel, pas une hypothèse.
    expect(isTransformableUnit('U')).toBe(false);
    expect(isTransformableUnit('litre')).toBe(false);
  });
});

describe('transformationUnits', () => {
  it('n’offre que les unités connues du serveur, en majuscules', () => {
    // La base contient à la fois « kg » et « KG », et les produits mélangent les deux. Le
    // serveur, lui, n'accepte que la forme majuscule de son enum : proposer « kg » ferait
    // rejeter la transformation.
    expect(transformationUnits(['kg', 'L', 'KG'])).toEqual(['KG', 'L']);
  });

  it('écarte les unités absentes de l’enum du serveur', () => {
    expect(transformationUnits(['tonnes', 'kg'])).toEqual(['KG']);
  });
});
