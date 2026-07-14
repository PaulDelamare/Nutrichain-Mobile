import {
  blockingReason,
  findBatchByCode,
  isUsableBatch,
  loadBatch,
  loadBatches,
  resolveBatch,
  type Batch,
} from './batches';
import { readCache, writeCache } from './cache';
import { ApiError } from './errors';

jest.mock('./cache');
jest.mock('./api', () => ({ apiClient: { get: jest.fn() } }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { apiClient } = require('./api') as { apiClient: { get: jest.Mock } };
const cache = jest.mocked({ readCache, writeCache });

beforeEach(() => jest.clearAllMocks());

function batch(overrides: Partial<Batch> = {}): Batch {
  return {
    id: 'b-1',
    lot_number: '260711-ABC123',
    statut: 'EN_STOCK',
    quantite_actuelle: '120',
    unite_code: 'kg',
    date_peremption: null,
    produit: { nom: 'Lait cru' },
    ...overrides,
  };
}

describe('loadBatches', () => {
  it('met les lots en cache pour le travail hors réseau', async () => {
    const lots = [batch()];
    apiClient.get.mockResolvedValue({ data: { data: lots } });

    await expect(loadBatches()).resolves.toEqual(lots);
    expect(cache.writeCache).toHaveBeenCalledWith('batches', lots);
  });

  it('retombe sur le cache quand le réseau est coupé', async () => {
    apiClient.get.mockRejectedValue(new ApiError('Erreur réseau', 0));
    cache.readCache.mockResolvedValue([batch()]);

    await expect(loadBatches()).resolves.toHaveLength(1);
  });
});

describe('findBatchByCode', () => {
  const lots = [batch(), batch({ id: 'b-2', lot_number: '260711-XYZ789' })];

  it('résout le numéro de lot imprimé sur l’étiquette', () => {
    expect(findBatchByCode('260711-XYZ789', lots)?.id).toBe('b-2');
  });

  it('résout aussi l’identifiant du lot', () => {
    expect(findBatchByCode('b-1', lots)?.id).toBe('b-1');
  });

  // Un vrai identifiant est un UUID de 36 caractères — au-delà de la limite d'un numéro de lot GS1,
  // donc le décodeur ne le rend PAS. Seul le repli sur le code brut le résout. Avec une fixture
  // courte (« b-1 »), on pouvait supprimer ce repli sans qu'un seul test rougisse.
  it('résout un identifiant de lot RÉEL (un UUID)', () => {
    const uuid = '3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
    const avecUuid = [...lots, batch({ id: uuid, lot_number: '260712-QQQ111' })];

    expect(findBatchByCode(uuid, avecUuid)?.id).toBe(uuid);
  });

  // L'étiquette qu'imprime NutriChain n'est PAS le numéro de lot : c'est une URL GS1 Digital Link.
  // Sans décodage, scanner notre propre étiquette devant la cuve ou le camion répondait
  // « Lot inconnu » — l'opérateur voyait sa propre marchandise refusée.
  it('résout l’étiquette réellement imprimée par NutriChain (un lien GS1)', () => {
    const etiquette = 'https://api.nutrichain.fr/gs1/01/3042040209123/10/260711-XYZ789';

    expect(findBatchByCode(etiquette, lots)?.id).toBe('b-2');
  });

  it('résout une étiquette fournisseur (element string GS1)', () => {
    expect(findBatchByCode('010304204020912310260711-XYZ789', lots)?.id).toBe('b-2');
  });

  // ⚠️ LE piège. Le décodeur réécrit tout code commençant par un identifiant GS1 : « 10ABC » y est
  // lu « ABC ». Si l'interprétation passait avant le code brut, scanner le lot « 10ABC » engagerait
  // le lot « ABC » — SANS erreur, sans toast. Mauvaise marchandise en production, mauvais parent
  // dans la traçabilité. Un numéro de lot fournisseur peut parfaitement commencer par « 10 ».
  it('engage le lot qu’on a scanné, pas celui que le décodage suggère', () => {
    const pieges = [
      batch({ id: 'piege-1', lot_number: '10ABC' }),
      batch({ id: 'piege-2', lot_number: 'ABC' }),
    ];

    expect(findBatchByCode('10ABC', pieges)?.id).toBe('piege-1');
  });

  it('ignore la casse et les espaces', () => {
    expect(findBatchByCode('  260711-abc123 ', lots)?.id).toBe('b-1');
  });

  it('ne résout rien sur un code étranger', () => {
    // Un code produit ou une étiquette de frigo ne doit jamais passer pour un lot.
    expect(findBatchByCode('EQP-ABCDEF0123', lots)).toBeUndefined();
    expect(findBatchByCode('', lots)).toBeUndefined();
  });

  it('ne résout jamais un code vide, même sur un lot sans numéro', () => {
    // Un scan qui ne rend rien (étiquette illisible) ne doit pas « trouver » le lot dont l'API
    // aurait renvoyé un numéro vide : ce serait le mauvais lot, décompté pour de vrai.
    const abimes = [batch({ lot_number: '' })];

    expect(findBatchByCode('   ', abimes)).toBeUndefined();
  });
});

describe('isUsableBatch', () => {
  it('accepte un lot en stock', () => {
    expect(isUsableBatch(batch({ statut: 'EN_STOCK' }))).toBe(true);
  });

  it('refuse un lot qui attend son controle qualite de sortie d usine', () => {
    // Barriere qualite : le serveur le refuse. Sans cette ligne, l'operateur scanne le lot,
    // l'ecran l'accepte, et l'echec arrive dix minutes plus tard, a la synchronisation —
    // exactement ce que ce garde-fou local existe pour eviter.
    expect(isUsableBatch(batch({ statut: 'EN_ATTENTE_QC' }))).toBe(false);
  });

  it('refuse un lot en quarantaine', () => {
    // C'est la garde sanitaire : un lot bloqué (non-conformité, excursion froid) ne doit
    // JAMAIS entrer en transformation. Le serveur le refusera, mais l'opérateur doit le
    // savoir devant sa cuve, pas dix minutes plus tard.
    expect(isUsableBatch(batch({ statut: 'BLOQUE' }))).toBe(false);
    expect(isUsableBatch(batch({ statut: 'ALERTE' }))).toBe(false);
  });

  it('refuse un lot déjà expédié ou épuisé', () => {
    expect(isUsableBatch(batch({ statut: 'EXPEDIE' }))).toBe(false);
    expect(isUsableBatch(batch({ statut: 'EPUISE' }))).toBe(false);
  });

  it('refuse un lot déjà engagé en production', () => {
    // Il est physiquement dans une autre cuve : le reprendre ferait sortir deux fois la même
    // matière du stock.
    expect(isUsableBatch(batch({ statut: 'EN_PRODUCTION' }))).toBe(false);
  });

  it('bloque quelle que soit la casse du statut', () => {
    // Les statuts ne sont pas un enum Prisma : c'est une chaîne. Un « bloque » minuscule venu
    // d'un import ne doit pas ouvrir la porte à un lot en quarantaine.
    expect(isUsableBatch(batch({ statut: 'bloque' }))).toBe(false);
  });

  it('refuse un lot périmé', () => {
    // Une DLC dépassée est un motif de blocage sanitaire, pas une alerte cosmétique.
    const hier = new Date(Date.now() - 86_400_000).toISOString();

    expect(isUsableBatch(batch({ date_peremption: hier }))).toBe(false);
  });

  it('accepte un lot dont la date de péremption est encore devant', () => {
    const demain = new Date(Date.now() + 86_400_000).toISOString();

    expect(isUsableBatch(batch({ date_peremption: demain }))).toBe(true);
  });
});

describe('loadBatch', () => {
  it('mappe la fiche lot (produit inclus, Decimal → number)', async () => {
    apiClient.get.mockResolvedValue({
      data: {
        data: {
          id: 'b1',
          lot_number: '260709-000099',
          statut: 'BLOQUE',
          quantite_actuelle: '120',
          unite_code: 'kg',
          date_peremption: '2026-09-09T00:00:00.000Z',
          date_creation: '2026-07-11T00:00:00.000Z',
          produit: { nom: 'Beurre Doux', code_gtin: '3042040209456' },
        },
      },
    });

    const batch = await loadBatch('b1');

    expect(batch).toMatchObject({
      id: 'b1',
      lotNumber: '260709-000099',
      statut: 'BLOQUE',
      produitNom: 'Beurre Doux',
      codeGtin: '3042040209456',
      quantite: 120,
      uniteCode: 'kg',
    });
  });

  it('renvoie null hors réseau plutôt que de faire tomber l’écran', async () => {
    apiClient.get.mockRejectedValue(new Error('offline'));

    expect(await loadBatch('b1')).toBeNull();
  });
});

describe('blockingReason', () => {
  it('dit à l’opérateur POURQUOI le lot est bloqué, en français', () => {
    // Il lisait le code brut du statut (« EN_ATTENTE_QC ») : ça ne lui dit ni ce qui bloque,
    // ni qui peut le débloquer.
    expect(blockingReason(batch({ statut: 'EN_ATTENTE_QC' }))).toContain('contrôle qualité');
    expect(blockingReason(batch({ statut: 'BLOQUE' }))).toContain('quarantaine');
    expect(blockingReason(batch({ statut: 'ALERTE' }))).toContain('rappel');
  });

  it('ne dit rien d’un lot parfaitement utilisable', () => {
    expect(blockingReason(batch({ statut: 'EN_STOCK' }))).toBeNull();
  });

  it('signale une date de péremption dépassée', () => {
    const perime = batch({ statut: 'EN_STOCK', date_peremption: '2020-01-01T00:00:00.000Z' });
    expect(blockingReason(perime)).toContain('péremption');
  });
});

describe('resolveBatch — le lot qu’on vient de scanner', () => {
  it('interroge le serveur avec le numéro de lot', async () => {
    apiClient.get.mockResolvedValue({
      data: {
        data: {
          id: 'bat-1',
          lot_number: 'FRN-77',
          statut: 'EN_STOCK',
          quantite_actuelle: '400',
          unite_code: 'kg',
          date_peremption: null,
          date_creation: null,
          produit: { nom: 'Beurre' },
        },
      },
    });

    const found = await resolveBatch('FRN-77');

    expect(apiClient.get).toHaveBeenCalledWith('/api/logistics/batches/resolve', {
      params: { lot_number: 'FRN-77' },
    });
    expect(found?.id).toBe('bat-1');
    expect(found?.produitNom).toBe('Beurre');
  });

  it('rend null quand le lot n’existe pas (404)', async () => {
    apiClient.get.mockRejectedValue(new ApiError('Lot introuvable', 404, 'batch'));

    await expect(resolveBatch('INCONNU')).resolves.toBeNull();
  });

  // ⚠️ LE test de cette fonction. Avaler une panne réseau dans le même `null` que le 404 ferait
  // conclure « ce lot n'existe pas » alors qu'on n'en sait RIEN — et l'opérateur réceptionnerait
  // une seconde fois une palette déjà en stock. C'est le doublon que toute cette chaîne empêche.
  it('RELANCE une panne réseau au lieu de la confondre avec un lot inconnu', async () => {
    apiClient.get.mockRejectedValue(new ApiError('Erreur réseau', 0));

    await expect(resolveBatch('FRN-77')).rejects.toThrow('Erreur réseau');
  });

  it.each([
    ['une erreur serveur', new ApiError('Boom', 500)],
    ['une session expirée', new ApiError('Non authentifié', 401, 'auth')],
    ['un refus de droits', new ApiError('Accès refusé', 403, 'auth')],
    ['un numéro invalide', new ApiError('Trop long', 400, 'lot_number')],
  ])('relance %s — seul un 404 signifie « lot inconnu »', async (_cas, error) => {
    apiClient.get.mockRejectedValue(error);

    await expect(resolveBatch('FRN-77')).rejects.toThrow();
  });
});
