import { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios';

import { apiClient } from './api';
import { loadGenealogy, recallReasonError, triggerRecall } from './traceability';

jest.mock('./cache');
jest.mock('./session', () => ({
  getToken: jest.fn().mockResolvedValue('jwt-123'),
  clearToken: jest.fn(),
  saveToken: jest.fn(),
  getUserId: jest.fn().mockResolvedValue('user-1'),
  clearUserId: jest.fn(),
  saveUserId: jest.fn(),
}));
jest.mock('expo-router', () => ({ router: { replace: jest.fn() } }));

/** Dernière requête vue par l'adaptateur : on vérifie l'URL ET le corps réellement envoyés. */
let lastRequest: InternalAxiosRequestConfig | null = null;

function stub(status: number, data: unknown): void {
  const adapter: AxiosAdapter = async (config: InternalAxiosRequestConfig) => {
    lastRequest = config;
    const response = { data, status, statusText: '', headers: {}, config };
    if (status >= 400) {
      const error = new AxiosError('Request failed', undefined, config, null, response);
      error.response = response;
      throw error;
    }
    return response;
  };
  apiClient.defaults.adapter = adapter;
}

/** Panne réseau : pas de réponse du tout, à distinguer d'un refus. */
function offline(): void {
  apiClient.defaults.adapter = (async (config: InternalAxiosRequestConfig) => {
    throw new AxiosError('Network Error', 'ERR_NETWORK', config, {}, undefined);
  }) as AxiosAdapter;
}

const GENEALOGY = {
  status: 200,
  message: 'Généalogie récupérée.',
  data: {
    batchId: 'b-1',
    upstream: [
      {
        id: 'b-parent',
        lot_number: '260714-LAIT01',
        statut: 'EPUISE',
        quantite_actuelle: '0',
        unite_code: 'L',
        nom_produit: 'Lait cru',
        date_peremption: null,
      },
    ],
    downstream: [
      {
        id: 'b-enfant',
        lot_number: '260716-YAOU01',
        statut: 'EN_STOCK',
        quantite_actuelle: '120',
        unite_code: 'kg',
        nom_produit: 'Yaourt nature',
        date_peremption: '2026-08-01T00:00:00.000Z',
      },
    ],
    origines: [
      {
        lot_number: '260714-LAIT01',
        date_reception: '2026-07-14T06:00:00.000Z',
        fournisseur: { id: 'f-1', nom_ferme: 'Ferme des Trois Chênes' },
      },
    ],
  },
};

beforeEach(() => {
  lastRequest = null;
});

describe('loadGenealogy', () => {
  it('rend l’ascendance, la descendance et les origines', async () => {
    stub(200, GENEALOGY);

    const result = await loadGenealogy('b-1');

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.genealogy.upstream[0].nom_produit).toBe('Lait cru');
    expect(result.genealogy.downstream[0].lot_number).toBe('260716-YAOU01');
    // L'origine NOMME la ferme : c'est le « de la ferme au rayon » du cahier des charges.
    expect(result.genealogy.origines[0].fournisseur.nom_ferme).toBe('Ferme des Trois Chênes');
  });

  it('interroge la route de traçabilité, pas celle de logistique', async () => {
    stub(200, GENEALOGY);

    await loadGenealogy('b-1');

    expect(lastRequest?.url).toBe('/api/traceability/batches/b-1/genealogy');
  });

  /**
   * ⚠️ QUATRE issues, jamais un `null` fourre-tout — même contrat que `loadBatch`. Confondre
   * « ce lot n'existe pas » avec « je n'ai pas pu demander » ferait croire à une chaîne vide
   * alors qu'elle est peut-être pleine : sur un rappel, c'est le pire mensonge possible.
   */
  it('distingue introuvable, interdit et non vérifiable', async () => {
    stub(404, { message: 'Not found' });
    expect((await loadGenealogy('b-1')).kind).toBe('unknown');

    stub(403, { message: 'Forbidden' });
    expect((await loadGenealogy('b-1')).kind).toBe('forbidden');

    offline();
    expect((await loadGenealogy('b-1')).kind).toBe('unverifiable');
  });

  it('ne rejette JAMAIS : l’écran ne doit pas planter sur une chaîne suspecte', async () => {
    offline();

    await expect(loadGenealogy('b-1')).resolves.toBeDefined();
  });

  it('n’invente pas de listes vides quand l’API n’en renvoie pas', async () => {
    // Une chaîne absente doit rester vide, pas devenir `undefined` et casser un `.map` à l'écran.
    stub(200, { status: 200, data: { batchId: 'b-1' } });

    const result = await loadGenealogy('b-1');

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.genealogy.upstream).toEqual([]);
    expect(result.genealogy.downstream).toEqual([]);
    expect(result.genealogy.origines).toEqual([]);
  });
});

/** Miroir de `recallPayload.schema.ts` : `vine.string().trim().minLength(5).maxLength(500)`. */
describe('recallReasonError', () => {
  it('exige un motif d’au moins 5 caractères', () => {
    // Le motif est recopié dans l'alerte ET dans l'e-mail envoyé aux clients : « x » ne dit rien.
    expect(recallReasonError('x')).not.toBeNull();
    expect(recallReasonError('Listeria détectée')).toBeNull();
  });

  it('ne compte pas les espaces, comme le `trim()` du serveur', () => {
    // Sans le trim, « xx   » (5 caractères) passerait ici et serait rejeté par le serveur.
    expect(recallReasonError('xx   ')).not.toBeNull();
  });

  it('refuse au-delà de 500 caractères', () => {
    expect(recallReasonError('a'.repeat(501))).not.toBeNull();
    expect(recallReasonError('a'.repeat(500))).toBeNull();
  });
});

describe('triggerRecall', () => {
  const OK = {
    status: 200,
    message: 'Rappel produit exécuté avec succès.',
    data: {
      blockedBatchesCount: 7,
      impactedBatchIds: ['b-1', 'b-2'],
      affectedShipments: [
        { shipmentRef: 'EXP-2026-004', customerName: 'Épicerie du Coin' },
      ],
      depthSaturated: false,
    },
  };

  it('envoie le motif sur la route de rappel', async () => {
    stub(200, OK);

    await triggerRecall('b-1', 'Listeria détectée sur le lot');

    expect(lastRequest?.url).toBe('/api/traceability/batches/b-1/recall');
    expect(JSON.parse(String(lastRequest?.data))).toEqual({ reason: 'Listeria détectée sur le lot' });
  });

  it('remonte le nombre de lots bloqués et les expéditions à notifier', async () => {
    stub(200, OK);

    const result = await triggerRecall('b-1', 'Listeria détectée sur le lot');

    expect(result.blockedBatchesCount).toBe(7);
    expect(result.affectedShipments[0].customerName).toBe('Épicerie du Coin');
  });

  /**
   * ⚠️ `depthSaturated` : la garde anti-cycle a été atteinte, donc la descendance bloquée peut
   * être INCOMPLÈTE. Annoncer « 7 lots bloqués » sans le dire ferait croire le rappel terminé
   * alors qu'il reste peut-être des lots en rayon. C'est le mensonge le plus coûteux du produit.
   */
  it('remonte l’aveu d’incomplétude du serveur', async () => {
    stub(200, { ...OK, data: { ...OK.data, depthSaturated: true } });

    expect((await triggerRecall('b-1', 'Listeria détectée')).depthSaturated).toBe(true);
  });

  it('propage le refus : un rappel n’échoue jamais en silence', async () => {
    // Contrairement aux lectures, une écriture qui échoue DOIT remonter — l'écran l'annonce.
    stub(403, { message: 'Forbidden' });

    await expect(triggerRecall('b-1', 'Listeria détectée')).rejects.toBeDefined();
  });
});
