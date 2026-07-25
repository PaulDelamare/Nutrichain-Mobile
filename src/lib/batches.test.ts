import {
  blockingReason,
  findBatchByCode,
  isUsableBatch,
  loadBatch,
  loadBatches,
  lookupBatch,
  type Batch,
} from './batches';
import { readCache, writeCache } from './cache';
import { ApiError } from './errors';
import { serverNow } from './server-time';

jest.mock('./cache');
jest.mock('./server-time');
jest.mock('./api', () => ({ apiClient: { get: jest.fn() } }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { apiClient } = require('./api') as { apiClient: { get: jest.Mock } };
const cache = jest.mocked({ readCache, writeCache });
const mockedServerNow = jest.mocked(serverNow);

beforeEach(() => {
  jest.clearAllMocks();
  // Par défaut, l'app a déjà vu le serveur : son horloge est connue et fidèle.
  mockedServerNow.mockReturnValue({ kind: 'ok', now: Date.now() });
});

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

  /**
   * 🔴 LE bug de l'issue #99. L'API a paginé `GET /traceability/batches` : `data.data` est passé
   * d'un tableau à `{ data, pagination }`. Renvoyé tel quel, cet objet était typé `Batch[]` sans
   * que rien ne le vérifie — `findBatchByCode` faisait `batches.find(...)` dessus et l'onglet Scan
   * plantait pour tous les opérateurs, sans la moindre erreur TypeScript.
   */
  it('lit la réponse PAGINÉE de l’API, et n’en met en cache que les lots', async () => {
    const lots = [batch()];
    apiClient.get.mockResolvedValue({
      data: { data: { data: lots, pagination: { page: 1, limit: 500, total: 342, totalPages: 1 } } },
    });

    await expect(loadBatches()).resolves.toEqual(lots);
    expect(cache.writeCache).toHaveBeenCalledWith('batches', lots);
  });

  /**
   * Un APK vit sa vie sur un téléphone : il n'est pas déployé avec l'API. Une application à jour
   * peut donc parler à une API qui ne pagine pas encore — et l'inverse.
   */
  it('lit encore la réponse non paginée d’une API antérieure', async () => {
    const lots = [batch()];
    apiClient.get.mockResolvedValue({ data: { data: lots } });

    await expect(loadBatches()).resolves.toEqual(lots);
  });

  it('demande le catalogue le plus large possible — hors réseau, il n’y a pas de repli serveur', async () => {
    apiClient.get.mockResolvedValue({ data: { data: [] } });

    await loadBatches();

    expect(apiClient.get).toHaveBeenCalledWith('/api/traceability/batches', {
      params: { limit: 500 },
    });
  });

  it('ne met JAMAIS en cache autre chose qu’un tableau, même sur une réponse inattendue', async () => {
    apiClient.get.mockResolvedValue({ data: { data: null } });

    await expect(loadBatches()).resolves.toEqual([]);
    expect(cache.writeCache).toHaveBeenCalledWith('batches', []);
  });

  it('retombe sur le cache quand le réseau est coupé', async () => {
    apiClient.get.mockRejectedValue(new ApiError('Erreur réseau', 0));
    cache.readCache.mockResolvedValue([batch()]);

    await expect(loadBatches()).resolves.toHaveLength(1);
  });

  /**
   * ⚠️ Le cache survit à une mise à jour de l'app. Une version antérieure y a pu déposer la réponse
   * paginée entière ; la servir telle quelle ferait planter le scan hors réseau, là où l'opérateur
   * n'a aucun recours.
   */
  it('refuse un cache empoisonné par une version antérieure plutôt que de le servir', async () => {
    apiClient.get.mockRejectedValue(new ApiError('Erreur réseau', 0));
    cache.readCache.mockResolvedValue({ data: [batch()], pagination: { total: 1 } });

    await expect(loadBatches()).rejects.toThrow(ApiError);
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

  it('REFUSE un lot périmé même si le téléphone se croit deux mois dans le passé', () => {
    // ⚠️ LA faille sanitaire. La péremption était tranchée sur `Date.now()` — une horloge que
    // l'opérateur peut régler à la main. Reculée de deux mois, elle faisait ACCEPTER un lot périmé
    // en transformation et en expédition. La garde sanitaire de l'application était l'horloge du
    // téléphone. Elle est désormais celle du serveur.
    const perimeDepuisUnMois = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const telephoneDansLePasse = Date.now() - 60 * 86_400_000;

    jest.spyOn(Date, 'now').mockReturnValue(telephoneDansLePasse);
    mockedServerNow.mockReturnValue({ kind: 'ok', now: telephoneDansLePasse + 60 * 86_400_000 });

    expect(isUsableBatch(batch({ date_peremption: perimeDepuisUnMois }))).toBe(false);

    jest.spyOn(Date, 'now').mockRestore();
  });

  it('REFUSE de trancher la péremption quand l’heure du serveur est inconnue — et le DIT', () => {
    // Retomber sur l'horloge locale « en attendant » reproduirait le bug, en silence. Un opérateur
    // qui rappelle le bureau vaut mieux qu'un lot périmé dans une cuve.
    mockedServerNow.mockReturnValue({ kind: 'unknown' });
    const demain = new Date(Date.now() + 86_400_000).toISOString();

    const reason = blockingReason(batch({ date_peremption: demain }));

    expect(reason).toContain("l'heure du serveur est inconnue");
    expect(isUsableBatch(batch({ date_peremption: demain }))).toBe(false);
  });

  it('ne demande PAS l’heure pour un lot sans date de péremption', () => {
    // Un lot sans DLC ne doit pas devenir inutilisable hors ligne : il n'y a rien à trancher.
    mockedServerNow.mockReturnValue({ kind: 'unknown' });

    expect(isUsableBatch(batch({ date_peremption: null }))).toBe(true);
  });
});

describe('loadBatch', () => {
  it('renvoie « ok » et mappe la fiche lot (produit inclus, Decimal → number)', async () => {
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

    const result = await loadBatch('b1');

    expect(result.kind).toBe('ok');
    expect(result.kind === 'ok' && result.batch).toMatchObject({
      id: 'b1',
      lotNumber: '260709-000099',
      statut: 'BLOQUE',
      produitNom: 'Beurre Doux',
      codeGtin: '3042040209456',
      quantite: 120,
      uniteCode: 'kg',
    });
  });

  // ⚠️ LE cœur de l'issue : 404, 403 et panne réseau ne doivent PAS donner le même écran vide.
  // `lookupBatch` distinguait déjà ; `loadBatch` avalait tout dans un `null`.
  it('distingue un lot introuvable (404) d’une incertitude', async () => {
    apiClient.get.mockRejectedValue(new ApiError('Introuvable', 404));
    expect((await loadBatch('b1')).kind).toBe('unknown');
  });

  it('distingue un refus de droits (403) — permanent, pas une panne à réessayer', async () => {
    apiClient.get.mockRejectedValue(new ApiError('Interdit', 403));
    expect((await loadBatch('b1')).kind).toBe('forbidden');
  });

  it('AVOUE l’incertitude hors réseau (unverifiable), au lieu d’un « introuvable » mensonger', async () => {
    apiClient.get.mockRejectedValue(new ApiError('Erreur réseau', 0));
    expect((await loadBatch('b1')).kind).toBe('unverifiable');
  });

  it('ne rejette JAMAIS, même sur une erreur inattendue', async () => {
    apiClient.get.mockImplementation(() => {
      throw new Error('boom');
    });
    await expect(loadBatch('b1')).resolves.toMatchObject({ kind: 'unverifiable' });
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


describe('lookupBatch — retrouver le lot scanné, où qu’il soit', () => {
  const enLocal = batch({ id: 'local-1', lot_number: '260711-ABC123' });

  const reponseApi = (id: string, lotNumber: string) => ({
    data: {
      data: {
        id,
        lot_number: lotNumber,
        statut: 'EN_STOCK',
        quantite_actuelle: '400',
        unite_code: 'kg',
        date_peremption: '2027-01-01T00:00:00.000Z',
        date_creation: null,
        produit: { nom: 'Beurre' },
      },
    },
  });

  it('trouve un lot du catalogue local sans déranger le serveur', async () => {
    const found = await lookupBatch('260711-ABC123', [enLocal]);

    expect(found).toEqual({ kind: 'found', batch: enLocal });
    expect(apiClient.get).not.toHaveBeenCalled();
  });

  // 🔴 LE trou que cette fonction ferme. `GET /traceability/batches` est plafonné à 100 lots : un
  // ingrédient à longue conservation, plus ancien, était annoncé « Lot inconnu — ce code ne
  // correspond à aucun lot de votre organisation » DEVANT LE CAMION. C'est faux : il est en stock,
  // et c'est nous qui avons imprimé son étiquette.
  it('trouve un lot ABSENT du catalogue local en interrogeant le serveur', async () => {
    apiClient.get.mockResolvedValue(reponseApi('vieux-1', '250101-OLD001'));

    const found = await lookupBatch('250101-OLD001', [enLocal]);

    expect(found.kind).toBe('found');
    expect(apiClient.get).toHaveBeenCalledWith('/api/logistics/batches/resolve', {
      params: { lot_number: '250101-OLD001' },
    });
  });

  it('décode notre étiquette (un lien GS1) avant d’interroger le serveur', async () => {
    apiClient.get.mockResolvedValue(reponseApi('vieux-1', '250101-OLD001'));

    await lookupBatch('https://api.nutrichain.fr/gs1/01/3042040209123/10/250101-OLD001', []);

    expect(apiClient.get).toHaveBeenCalledWith('/api/logistics/batches/resolve', {
      params: { lot_number: '250101-OLD001' },
    });
  });

  // ⚠️ Le décodeur lit « 10ABC » comme « ABC ». Interroger le serveur avec l'interprétation AVANT
  // le code brut engagerait un AUTRE lot — sans erreur, sans message.
  it('interroge le serveur avec le code BRUT avant son interprétation', async () => {
    apiClient.get.mockResolvedValue(reponseApi('vrai', '10ABC'));

    await lookupBatch('10ABC', []);

    expect(apiClient.get).toHaveBeenNthCalledWith(1, '/api/logistics/batches/resolve', {
      params: { lot_number: '10ABC' },
    });
  });

  it('résout aussi un identifiant de lot, que l’endpoint des numéros refuserait', async () => {
    const uuid = '3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
    apiClient.get.mockResolvedValue(reponseApi(uuid, '250101-OLD001'));

    const found = await lookupBatch(uuid, []);

    expect(found.kind).toBe('found');
    expect(apiClient.get).toHaveBeenCalledWith(`/api/logistics/batches/${uuid}`, undefined);
  });

  it('dit « inconnu » quand le serveur a répondu qu’il ne connaît pas ce lot', async () => {
    apiClient.get.mockRejectedValue(new ApiError('Lot introuvable', 404, 'batch'));

    await expect(lookupBatch('JAMAIS-VU', [])).resolves.toEqual({ kind: 'unknown' });
  });

  // ⚠️ LA distinction. « Lot inconnu » sur une panne réseau est un MENSONGE : le lot existe
  // peut-être. C'est ce mensonge qui pousse l'opérateur à resaisir une marchandise déjà en stock.
  it('ne dit JAMAIS « inconnu » quand il n’a pas pu demander', async () => {
    apiClient.get.mockRejectedValue(new ApiError('Erreur réseau', 0));

    const found = await lookupBatch('260711-ABC123', []);

    expect(found.kind).toBe('unverifiable');
  });

  it.each([
    ['une session expirée', new ApiError('Non authentifié', 401, 'auth')],
    ['une erreur serveur', new ApiError('Boom', 500)],
  ])('traite %s comme une incertitude, pas comme un lot inconnu', async (_cas, error) => {
    apiClient.get.mockRejectedValue(error);

    expect((await lookupBatch('260711-ABC123', [])).kind).toBe('unverifiable');
  });

  it('n’interroge pas le serveur avec un code qui ne peut pas être un numéro de lot', async () => {
    const found = await lookupBatch('A'.repeat(40), []);

    expect(found).toEqual({ kind: 'unknown' });
    expect(apiClient.get).not.toHaveBeenCalled();
  });

  // Un SSCC identifie un COLIS. L'envoyer au serveur ferait attendre l'opérateur pour rien — et,
  // hors réseau, lui annoncerait « ce lot n'a pas pu être vérifié » sur un code qui ne peut
  // structurellement PAS être un lot.
  it('n’interroge pas le serveur pour un colis (SSCC)', async () => {
    const found = await lookupBatch('00376112345678901234', []);

    expect(found).toEqual({ kind: 'unknown' });
    expect(apiClient.get).not.toHaveBeenCalled();
  });

  // Un seul aller-retour, toujours : le code brut et son interprétation ne diffèrent que si le code
  // est structurellement GS1 — et dans ce cas le brut (une URL, une chaîne d'AI) dépasse la limite
  // des 20 caractères, donc n'est pas interrogeable.
  it('ne fait qu’un seul appel serveur pour une étiquette GS1', async () => {
    apiClient.get.mockRejectedValue(new ApiError('Lot introuvable', 404, 'batch'));

    await lookupBatch('https://api.nutrichain.fr/gs1/01/3042040209123/10/250101-OLD001', []);

    expect(apiClient.get).toHaveBeenCalledTimes(1);
  });
});
