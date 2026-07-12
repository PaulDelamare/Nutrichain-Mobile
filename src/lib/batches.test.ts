import { loadBatch } from './batches';

jest.mock('./api', () => ({ apiClient: { get: jest.fn() } }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { apiClient } = require('./api') as { apiClient: { get: jest.Mock } };

beforeEach(() => jest.clearAllMocks());

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
