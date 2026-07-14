import {
  SHIPMENT_ID_MAX_LENGTH,
  buildReceipt,
  receiptQuantityError,
  receiptShipmentError,
} from './receipt';

const VALID = {
  supplierId: 'f-1',
  productId: 'p-1',
  shipmentId: 'SHIP-001',
  quantity: '12',
  unit: 'kg',
  status: 'OK' as const,
};

describe('buildReceipt', () => {
  it('accepte une saisie complète', () => {
    expect(buildReceipt(VALID)).toEqual({
      id_fournisseur: 'f-1',
      shipment_id: 'SHIP-001',
      id_produit: 'p-1',
      quantite_actuelle: 12,
      unite_code: 'kg',
      statut_controle: 'OK',
    });
  });

  it('transmet l’emplacement scanné', () => {
    // Sans lui, la quarantaine automatique sur excursion de température ne ciblera jamais ce lot.
    expect(buildReceipt({ ...VALID, equipmentId: 'eq-1' })?.id_materiel).toBe('eq-1');
  });

  it('omet l’emplacement plutôt que d’envoyer une chaîne vide', () => {
    // Le serveur valide `id_materiel` comme un UUID : une chaîne vide ferait refuser TOUT le lot.
    expect(buildReceipt(VALID)).not.toHaveProperty('id_materiel');
    expect(buildReceipt({ ...VALID, equipmentId: '' })).not.toHaveProperty('id_materiel');
  });

  it('accepte la virgule décimale, comme la tape un opérateur français', () => {
    expect(buildReceipt({ ...VALID, quantity: '12,5' })?.quantite_actuelle).toBe(12.5);
  });

  it('coupe les espaces autour du numéro d’expédition', () => {
    expect(buildReceipt({ ...VALID, shipmentId: '  SHIP-001  ' })?.shipment_id).toBe('SHIP-001');
  });

  it('refuse un numéro d’expédition trop court ou trop long', () => {
    // Les bornes du serveur (VineJS, 3..100) : au-delà, c'est TOUT le lot de synchronisation
    // qui est refusé en bloc, pas seulement cette opération.
    expect(buildReceipt({ ...VALID, shipmentId: 'AB' })).toBeNull();
    expect(buildReceipt({ ...VALID, shipmentId: 'X'.repeat(SHIPMENT_ID_MAX_LENGTH + 1) })).toBeNull();
    expect(buildReceipt({ ...VALID, shipmentId: 'X'.repeat(SHIPMENT_ID_MAX_LENGTH) })).not.toBeNull();
  });

  it('refuse une quantité nulle, négative ou illisible', () => {
    expect(buildReceipt({ ...VALID, quantity: '0' })).toBeNull();
    expect(buildReceipt({ ...VALID, quantity: '-3' })).toBeNull();
    expect(buildReceipt({ ...VALID, quantity: '1,2,3' })).toBeNull();
    expect(buildReceipt({ ...VALID, quantity: '' })).toBeNull();
  });

  it('exige une unité, un fournisseur et un produit', () => {
    // L'unité est une clé étrangère côté serveur : vide, la réception part en file puis
    // se fait rejeter — et le scan terrain reste bloqué.
    expect(buildReceipt({ ...VALID, unit: '' })).toBeNull();
    expect(buildReceipt({ ...VALID, supplierId: '' })).toBeNull();
    expect(buildReceipt({ ...VALID, productId: '' })).toBeNull();
  });

  // ─── Numéro de lot (AI 10) et DLC (AI 17) décodés du scan (issue #31) ──────────────────────
  describe('lot et DLC décodés de l’étiquette', () => {
    // La raison d'être du scan : ces valeurs étaient JETÉES. Sans elles, la palette rescannée
    // redevient un lot inconnu, et l'API — qui sait pourtant les enregistrer — n'en voit rien.
    it('transmet le lot_number et la date_peremption', () => {
      const receipt = buildReceipt({ ...VALID, lotNumber: '260714-ABC123', expiry: '2026-12-31' });
      expect(receipt?.lot_number).toBe('260714-ABC123');
      expect(receipt?.date_peremption).toBe('2026-12-31');
    });

    it('coupe les espaces et omet un lot vide plutôt que d’envoyer une chaîne vide', () => {
      expect(buildReceipt(VALID)).not.toHaveProperty('lot_number');
      expect(buildReceipt({ ...VALID, lotNumber: '  ' })).not.toHaveProperty('lot_number');
      expect(buildReceipt({ ...VALID, lotNumber: '  LOT9  ' })?.lot_number).toBe('LOT9');
    });

    // Le serveur borne le lot à [A-Za-z0-9._-] : un « / » casse l'URL Digital Link, et l'envoyer
    // ferait rejeter TOUT le lot de sync (400). On omet le champ (le serveur génère un numéro)
    // plutôt que de bloquer une réception par ailleurs valide.
    it('omet un lot_number hors charset serveur sans invalider la réception', () => {
      const receipt = buildReceipt({ ...VALID, lotNumber: 'A/B' });
      expect(receipt).not.toBeNull();
      expect(receipt).not.toHaveProperty('lot_number');
    });

    // La DLC doit être un jour ISO strict (AAAA-MM-JJ) : le serveur refuse tout autre format.
    it('omet une DLC qui n’est pas au format AAAA-MM-JJ, sans invalider la réception', () => {
      const receipt = buildReceipt({ ...VALID, expiry: '31/12/2026' });
      expect(receipt).not.toBeNull();
      expect(receipt).not.toHaveProperty('date_peremption');
    });
  });
});

// ─── Messages d'erreur par champ (issue #47) : ne plus laisser un bouton gris muet ───────────
describe('receiptQuantityError', () => {
  it('exige un nombre lisible', () => {
    expect(receiptQuantityError('abc')).toMatch(/nombre/i);
    expect(receiptQuantityError('1,2,3')).toMatch(/nombre/i);
  });

  it('exige une quantité strictement positive', () => {
    expect(receiptQuantityError('0')).toMatch(/supérieure à 0/i);
    expect(receiptQuantityError('-3')).toMatch(/supérieure à 0/i);
  });

  it('accepte une quantité valide, virgule décimale française comprise', () => {
    expect(receiptQuantityError('12')).toBeNull();
    expect(receiptQuantityError('12,5')).toBeNull();
  });
});

describe('receiptShipmentError', () => {
  it('exige au moins 3 caractères', () => {
    expect(receiptShipmentError('AB')).toMatch(/3 caractères/i);
  });

  it('refuse au-delà de la borne serveur', () => {
    expect(receiptShipmentError('X'.repeat(SHIPMENT_ID_MAX_LENGTH + 1))).toMatch(/dépasser/i);
  });

  it('accepte un n° valide, espaces rognés', () => {
    expect(receiptShipmentError('  SHIP-1  ')).toBeNull();
  });
});

// Les messages et buildReceipt partagent la MÊME règle : un champ que le message signale fautif
// doit rendre buildReceipt null, et inversement. Sinon l'écran mentirait (message sans bouton gris,
// ou l'inverse).
describe('les messages et buildReceipt ne divergent jamais', () => {
  it('quantité invalide : message ET bouton grisé', () => {
    expect(receiptQuantityError('0')).not.toBeNull();
    expect(buildReceipt({ ...VALID, quantity: '0' })).toBeNull();
  });

  it('n° d’expédition trop court : message ET bouton grisé', () => {
    expect(receiptShipmentError('AB')).not.toBeNull();
    expect(buildReceipt({ ...VALID, shipmentId: 'AB' })).toBeNull();
  });

  it('saisie valide : aucun message, réception construite', () => {
    expect(receiptQuantityError(VALID.quantity)).toBeNull();
    expect(receiptShipmentError(VALID.shipmentId)).toBeNull();
    expect(buildReceipt(VALID)).not.toBeNull();
  });
});
