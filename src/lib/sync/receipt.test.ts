import { SHIPMENT_ID_MAX_LENGTH, buildReceipt } from './receipt';

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
});
