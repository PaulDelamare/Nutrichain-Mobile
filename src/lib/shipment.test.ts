import { buildShipment, shipmentQuantityError, type ShipmentInput } from './shipment';

const VALID: ShipmentInput = {
  customerId: 'c-1',
  shipmentId: 'EXP-2026-001',
  carrier: 'Transports Martin',
  address: '12 rue des Halles, 75001 Paris',
  lots: [
    { batchId: 'b-1', quantity: '40', available: 100 },
    { batchId: 'b-2', quantity: '12,5', available: 50 },
  ],
};

describe('buildShipment', () => {
  it('assemble une expédition complète', () => {
    expect(buildShipment(VALID)).toEqual({
      id_client: 'c-1',
      shipment_id: 'EXP-2026-001',
      transporteur: 'Transports Martin',
      destination_adresse: '12 rue des Halles, 75001 Paris',
      lots: [
        { id_lot: 'b-1', quantite_expediee: 40 },
        { id_lot: 'b-2', quantite_expediee: 12.5 },
      ],
    });
  });

  it('exige au moins un lot', () => {
    // Une expédition sans lot ne relie aucun produit à aucun client : le rappel produit ne
    // pourrait plus remonter jusqu'aux magasins livrés.
    expect(buildShipment({ ...VALID, lots: [] })).toBeNull();
  });

  it('refuse une quantité expédiée invalide', () => {
    expect(
      buildShipment({ ...VALID, lots: [{ batchId: 'b-1', quantity: '0', available: 100 }] })
    ).toBeNull();
    expect(
      buildShipment({ ...VALID, lots: [{ batchId: 'b-1', quantity: 'deux', available: 100 }] })
    ).toBeNull();
  });

  it('refuse d’expédier plus que le stock du lot', () => {
    // Sinon la quantité du lot passerait en négatif : un stock faux, c'est un rappel qui rate.
    expect(
      buildShipment({ ...VALID, lots: [{ batchId: 'b-1', quantity: '150', available: 100 }] })
    ).toBeNull();
  });

  it('refuse un lot sans identifiant', () => {
    expect(
      buildShipment({ ...VALID, lots: [{ batchId: '', quantity: '10', available: 100 }] })
    ).toBeNull();
  });

  it('respecte les bornes basses du serveur', () => {
    // Numéro de transport 3..100, transporteur 2..100, adresse au moins 5 caractères.
    expect(buildShipment({ ...VALID, shipmentId: 'AB' })).toBeNull();
    expect(buildShipment({ ...VALID, carrier: 'X' })).toBeNull();
    expect(buildShipment({ ...VALID, address: 'rue' })).toBeNull();
  });

  it('respecte les bornes hautes du serveur', () => {
    const tropLong = 'A'.repeat(101);

    expect(buildShipment({ ...VALID, shipmentId: tropLong })).toBeNull();
    expect(buildShipment({ ...VALID, carrier: tropLong })).toBeNull();
  });

  it('exige un client', () => {
    expect(buildShipment({ ...VALID, customerId: '' })).toBeNull();
  });

  it('coupe les espaces superflus', () => {
    const built = buildShipment({
      ...VALID,
      shipmentId: '  EXP-2026-001  ',
      carrier: '  Transports Martin  ',
      address: '  12 rue des Halles, 75001 Paris  ',
    });

    expect(built).toMatchObject({
      shipment_id: 'EXP-2026-001',
      transporteur: 'Transports Martin',
      destination_adresse: '12 rue des Halles, 75001 Paris',
    });
  });

  it('ne compte pas les espaces dans la longueur minimale', () => {
    // Sans le `trim`, « X   » (4 caractères) passerait la borne des 2 caractères du transporteur
    // et partirait au serveur comme un nom de transporteur vide.
    expect(buildShipment({ ...VALID, carrier: 'X   ' })).toBeNull();
    expect(buildShipment({ ...VALID, address: 'rue  ' })).toBeNull();
  });
});

describe('shipmentQuantityError', () => {
  it('accepte une quantité disponible', () => {
    expect(shipmentQuantityError('40', 100)).toBeNull();
  });

  it('nomme le stock restant', () => {
    expect(shipmentQuantityError('150', 100)).toBe('Stock insuffisant : 100 disponibles.');
  });

  it('accepte plus de deux décimales, que le serveur n’interdit pas ici', () => {
    // Contrairement à la transformation (`decimal([0, 2])`), le schéma d'expédition n'impose
    // aucune précision : inventer la contrainte refuserait une pesée légitime.
    expect(shipmentQuantityError('12.345', 100)).toBeNull();
  });
});
