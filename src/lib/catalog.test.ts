import { readCache, writeCache } from './cache';
import { loadProducts, loadSuppliers } from './catalog';
import { ApiError } from './errors';

jest.mock('./cache');
jest.mock('./api', () => ({
  apiClient: { get: jest.fn() },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { apiClient } = require('./api') as { apiClient: { get: jest.Mock } };
const cache = jest.mocked({ readCache, writeCache });

const SUPPLIERS = [{ id: 'f-1', nom_ferme: 'Ferme des Trois Chênes' }];

describe('loadSuppliers', () => {
  beforeEach(() => jest.clearAllMocks());

  it('sert les données du serveur et les met en cache', async () => {
    apiClient.get.mockResolvedValue({ data: { data: SUPPLIERS } });

    await expect(loadSuppliers()).resolves.toEqual(SUPPLIERS);
    expect(cache.writeCache).toHaveBeenCalledWith('suppliers', SUPPLIERS);
  });

  it('retombe sur le cache quand le réseau est coupé', async () => {
    // Sans ce repli, une réception serait impossible à saisir hors réseau —
    // c'est-à-dire exactement là où l'application doit servir.
    apiClient.get.mockRejectedValue(new ApiError('Erreur réseau', 0));
    cache.readCache.mockResolvedValue(SUPPLIERS);

    await expect(loadSuppliers()).resolves.toEqual(SUPPLIERS);
  });

  it('remonte l’erreur quand rien n’a jamais été mis en cache', async () => {
    apiClient.get.mockRejectedValue(new ApiError('Erreur réseau', 0));
    cache.readCache.mockResolvedValue(null);

    await expect(loadSuppliers()).rejects.toThrow(ApiError);
  });
});

describe('loadProducts', () => {
  beforeEach(() => jest.clearAllMocks());

  it('met les produits en cache sous leur propre clé', async () => {
    const products = [{ id: 'p-1', nom: 'Tomate', unite_reference: 'KG' }];
    apiClient.get.mockResolvedValue({ data: { data: products } });

    await expect(loadProducts()).resolves.toEqual(products);
    expect(cache.writeCache).toHaveBeenCalledWith('products', products);
  });
});
