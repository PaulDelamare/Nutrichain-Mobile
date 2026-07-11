import { loadActiveColdAlerts } from './alerts';

jest.mock('./api', () => ({ apiClient: { get: jest.fn() } }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { apiClient } = require('./api') as { apiClient: { get: jest.Mock } };

describe('loadActiveColdAlerts', () => {
  it('ne retient que les excursions de température encore actives', async () => {
    // L'API ne propose aucun filtre : tout tri se fait ici, sous peine d'annoncer
    // à l'opérateur des alertes déjà résolues ou étrangères à la chaîne du froid.
    apiClient.get.mockResolvedValue({
      data: {
        data: [
          { id: '1', type: 'TEMP_EXCURSION', statut: 'ACTIVE', message: 'Palette +4.2 °C' },
          { id: '2', type: 'TEMP_EXCURSION', statut: 'RESOLVED', message: 'Déjà traitée' },
          { id: '3', type: 'PRODUCT_RECALL', statut: 'ACTIVE', message: 'Rappel produit' },
        ],
      },
    });

    const alerts = await loadActiveColdAlerts();

    expect(alerts).toHaveLength(1);
    expect(alerts[0].id).toBe('1');
  });

  it('ne fait pas échouer l’accueil quand les alertes sont inaccessibles', async () => {
    apiClient.get.mockRejectedValue(new Error('offline'));

    await expect(loadActiveColdAlerts()).resolves.toEqual([]);
  });
});
