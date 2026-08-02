import { apiClient } from './api';
import { moveBatchToStorage, storageOptions } from './storage';
import type { Equipment } from './equipment';

jest.mock('./api', () => ({ apiClient: { patch: jest.fn() } }));

const materiel = (id: string, nom: string, type: string): Equipment => ({
  id,
  nom,
  type,
  qr_code_id: null,
  lieu: { nom: 'Site' },
});

describe('storageOptions', () => {
  /**
   * Une cuve ou un mixeur transforment, ils ne stockent pas. Y rattacher un lot ferait porter la
   * quarantaine froid sur un matériel qui n'est pas son emplacement réel — et le lot vraiment
   * stocké ailleurs ne serait jamais bloqué.
   */
  it('ne propose que des emplacements de stockage', () => {
    const options = storageOptions([
      materiel('1', 'Chambre froide A', 'FRIGO'),
      materiel('2', 'Cuve 3', 'CUVE'),
      materiel('3', 'Étagère B', 'ETAGERE'),
      materiel('4', 'Mixeur', 'MIXEUR'),
    ]);

    expect(options.map((o) => o.nom)).toEqual(['Chambre froide A', 'Étagère B']);
  });

  /** Sans tri, l'ordre suit la réponse de l'API : la liste sauterait d'un rendu à l'autre. */
  it('trie par nom, et ne modifie pas le tableau reçu', () => {
    const recu = [materiel('1', 'Zone Z', 'ETAGERE'), materiel('2', 'Alpha', 'FRIGO')];

    const options = storageOptions(recu);

    expect(options.map((o) => o.nom)).toEqual(['Alpha', 'Zone Z']);
    expect(recu[0].nom).toBe('Zone Z');
  });

  it('rend une liste vide plutôt que de planter quand rien ne stocke', () => {
    expect(storageOptions([materiel('1', 'Cuve', 'CUVE')])).toEqual([]);
  });
});

describe('moveBatchToStorage', () => {
  it("appelle la route de rangement avec le seul champ qu'elle accepte", async () => {
    await moveBatchToStorage('lot-1', 'frigo-1');

    expect(apiClient.patch).toHaveBeenCalledWith('/api/logistics/batches/lot-1/location', {
      id_materiel: 'frigo-1',
    });
  });

  /** Un identifiant venu d'un scan peut contenir n'importe quoi : il ne doit pas construire l'URL. */
  it("échappe l'identifiant du lot dans l'URL", async () => {
    await moveBatchToStorage('lot/../../admin', 'frigo-1');

    expect(apiClient.patch).toHaveBeenCalledWith(
      '/api/logistics/batches/lot%2F..%2F..%2Fadmin/location',
      { id_materiel: 'frigo-1' }
    );
  });
});
