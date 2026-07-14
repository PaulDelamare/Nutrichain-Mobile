import { readCache, writeCache } from './cache';
import {
  findEquipmentByCode,
  isEquipmentCode,
  isStorageEquipment,
  loadEquipment,
  type Equipment,
} from './equipment';
import { ApiError } from './errors';

jest.mock('./cache');
jest.mock('./api', () => ({ apiClient: { get: jest.fn() } }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { apiClient } = require('./api') as { apiClient: { get: jest.Mock } };
const cache = jest.mocked({ readCache, writeCache });

const FRIGO: Equipment = {
  id: 'eq-1',
  nom: 'Chambre froide A — groupe 1',
  type: 'FRIGO',
  qr_code_id: 'QR-FRIGO-A1',
  lieu: { nom: 'Chambre froide A' },
};

const CUVE: Equipment = {
  id: 'eq-2',
  nom: 'Cuve de pasteurisation',
  type: 'CUVE',
  qr_code_id: null,
  lieu: { nom: 'Ligne de conditionnement' },
};

describe('loadEquipment', () => {
  beforeEach(() => jest.clearAllMocks());

  it('sert la liste du serveur et la met en cache', async () => {
    apiClient.get.mockResolvedValue({ data: { data: [FRIGO, CUVE] } });

    await expect(loadEquipment()).resolves.toEqual([FRIGO, CUVE]);
    expect(cache.writeCache).toHaveBeenCalledWith('equipment', [FRIGO, CUVE]);
  });

  it('retombe sur le cache hors réseau', async () => {
    // C'est tout l'intérêt : le scan du frigo a lieu DANS la chambre froide, sans réseau.
    // Le code lu doit être résolu localement, sinon l'emplacement ne peut pas être saisi.
    apiClient.get.mockRejectedValue(new ApiError('Erreur réseau', 0));
    cache.readCache.mockResolvedValue([FRIGO]);

    await expect(loadEquipment()).resolves.toEqual([FRIGO]);
  });
});

describe('findEquipmentByCode', () => {
  const equipment = [FRIGO, CUVE];

  it('résout l’étiquette QR d’un équipement', () => {
    expect(findEquipmentByCode('QR-FRIGO-A1', equipment)).toBe(FRIGO);
  });

  it('résout aussi l’identifiant de l’équipement', () => {
    // Les étiquettes peuvent porter l'identifiant plutôt qu'un code QR dédié.
    expect(findEquipmentByCode('eq-2', equipment)).toBe(CUVE);
  });

  it('ignore la casse et les espaces d’un code scanné', () => {
    expect(findEquipmentByCode('  qr-frigo-a1 ', equipment)).toBe(FRIGO);
  });

  it('ne résout rien sur un code étranger', () => {
    // Un code produit scanné par erreur ne doit surtout pas passer pour un emplacement.
    expect(findEquipmentByCode('00376112345678901234', equipment)).toBeUndefined();
  });

  it('ne confond pas une étiquette vide avec un code vide', () => {
    // La colonne accepte la chaîne vide : sans la garde, une lecture ratée de la caméra
    // (code vide) résoudrait le premier matériel sans étiquette venu.
    const sansEtiquette: Equipment = { ...CUVE, qr_code_id: '' };

    expect(findEquipmentByCode('', [sansEtiquette])).toBeUndefined();
    expect(findEquipmentByCode('   ', [sansEtiquette])).toBeUndefined();
  });
});

describe('isStorageEquipment', () => {
  it('accepte les matériels où l’on range un lot', () => {
    expect(isStorageEquipment(FRIGO)).toBe(true);
  });

  it('refuse une cuve : elle transforme, elle ne stocke pas', () => {
    // Y rattacher un lot ferait porter la quarantaine sur un matériel qui n'est pas son
    // emplacement réel — et le lot vraiment stocké ailleurs ne serait jamais bloqué.
    expect(isStorageEquipment(CUVE)).toBe(false);
  });
});

describe('isEquipmentCode', () => {
  // L'étiquette d'un frigo scannée depuis l'onglet Scan ouvrait un formulaire de réception, avec
  // le code du matériel logé dans le numéro d'expédition. Reconnaître la FORME permet de le dire
  // même hors réseau, sans avoir la liste des matériels en main.
  it.each([
    ['une étiquette de matériel', 'EQP-A1B2C3D4E5', true],
    ['la même en minuscules', 'eqp-a1b2c3d4e5', true],
    ['avec des espaces autour', '  EQP-A1B2C3D4E5  ', true],
  ])('reconnaît %s', (_cas, code, attendu) => {
    expect(isEquipmentCode(code)).toBe(attendu);
  });

  // Un numéro de lot qui commence par « EQP » ne doit surtout pas être pris pour un frigo :
  // l'opérateur ne pourrait plus jamais ouvrir sa fiche.
  it.each([
    ['un numéro de lot qui y ressemble', 'EQP-2026-001'],
    ['un préfixe seul', 'EQP-'],
    ['une longueur non conforme', 'EQP-A1B2C3'],
    ['des caractères non hexadécimaux', 'EQP-ZZZZZZZZZZ'],
    ['un vrai numéro de lot', '260714-WRFG37'],
    ['une chaîne vide', ''],
  ])('ne prend pas %s pour un matériel', (_cas, code) => {
    expect(isEquipmentCode(code)).toBe(false);
  });
});
