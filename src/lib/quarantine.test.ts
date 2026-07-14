import { loadQuarantineBatches } from './quarantine';

jest.mock('./api', () => ({ apiClient: { get: jest.fn() } }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { apiClient } = require('./api') as { apiClient: { get: jest.Mock } };

beforeEach(() => jest.clearAllMocks());

describe('loadQuarantineBatches', () => {
  it('mappe les lots BLOQUE renvoyés par le serveur', async () => {
    apiClient.get.mockResolvedValue({
      data: {
        data: [
          {
            id: 'b1',
            lot_number: '260714-ABC123',
            quantite_actuelle: '42.5',
            unite_code: 'kg',
            date_peremption: '2026-12-31T00:00:00.000Z',
            date_creation: '2026-07-01T08:00:00.000Z',
            produit: { nom: 'Lait cru' },
          },
        ],
      },
    });

    const result = await loadQuarantineBatches();

    expect(result.kind).toBe('ok');
    expect(result.kind === 'ok' && result.batches).toEqual([
      {
        id: 'b1',
        lotNumber: '260714-ABC123',
        produitNom: 'Lait cru',
        quantite: 42.5,
        uniteCode: 'kg',
        datePeremption: '2026-12-31T00:00:00.000Z',
        dateCreation: '2026-07-01T08:00:00.000Z',
      },
    ]);
  });

  it('interroge l’endpoint des lots en quarantaine de l’organisation', async () => {
    apiClient.get.mockResolvedValue({ data: { data: [] } });
    await loadQuarantineBatches();
    expect(apiClient.get).toHaveBeenCalledWith('/api/organization/quarantine-batches');
  });

  it('nomme un produit manquant au lieu d’afficher du vide', async () => {
    apiClient.get.mockResolvedValue({
      data: {
        data: [
          {
            id: 'b1',
            lot_number: 'L1',
            quantite_actuelle: '1',
            unite_code: 'kg',
            date_peremption: null,
            date_creation: '2026-07-01T08:00:00.000Z',
            produit: null,
          },
        ],
      },
    });

    const result = await loadQuarantineBatches();
    expect(result.kind === 'ok' && result.batches[0].produitNom).toBe('Produit inconnu');
  });

  // ⚠️ Le cœur du « ne pas mentir » : sur une panne réseau, on AVOUE — jamais une liste vide qui
  // ferait afficher « aucun lot en quarantaine » alors que de la marchandise bloquée dort en base.
  it('AVOUE qu’il n’a pas pu vérifier au lieu de renvoyer une liste vide', async () => {
    apiClient.get.mockRejectedValue(new Error('offline'));
    const result = await loadQuarantineBatches();
    expect(result.kind).toBe('unverifiable');
  });

  // Le contrat : cette fonction ne REJETTE jamais — `unverifiable` EST le canal d'erreur, sinon
  // l'accueil (qui l'appelle sans `.catch`) partirait en rejet non géré.
  it('ne rejette JAMAIS, même sur une erreur inattendue', async () => {
    apiClient.get.mockImplementation(() => {
      throw new Error('boom');
    });
    await expect(loadQuarantineBatches()).resolves.toMatchObject({ kind: 'unverifiable' });
  });
});
