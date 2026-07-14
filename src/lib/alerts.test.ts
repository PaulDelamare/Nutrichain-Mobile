import { loadActiveColdAlerts, loadAlertDecision, releaseAndResolve, resolveAlert } from './alerts';

jest.mock('./api', () => ({
  apiClient: { get: jest.fn(), post: jest.fn(), patch: jest.fn() },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { apiClient } = require('./api') as {
  apiClient: { get: jest.Mock; post: jest.Mock; patch: jest.Mock };
};

beforeEach(() => jest.clearAllMocks());

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

    const result = await loadActiveColdAlerts();

    expect(result.kind).toBe('ok');
    expect(result.kind === 'ok' && result.alerts).toHaveLength(1);
    expect(result.kind === 'ok' && result.alerts[0].id).toBe('1');
  });

  // ⚠️ L'ancien test exigeait `[]` quand les alertes sont inaccessibles — il CANONISAIT le mensonge.
  // Renvoyer une liste vide fait afficher « ALERTES FROID : 0 » à l'accueil : la seule information
  // sanitaire de l'écran annonce « tout va bien », pendant une excursion thermique.
  it('AVOUE qu’il n’a pas pu vérifier, au lieu de renvoyer une liste vide', async () => {
    apiClient.get.mockRejectedValue(new Error('offline'));

    const result = await loadActiveColdAlerts();

    expect(result.kind).toBe('unverifiable');
  });

  // Le contrat : cette fonction ne REJETTE jamais. `unverifiable` EST le canal d'erreur — sinon
  // l'accueil (qui l'appelle sans `.catch`) partirait en rejet non géré, et resterait sur son zéro.
  it('ne rejette JAMAIS, même sur une erreur inattendue', async () => {
    apiClient.get.mockImplementation(() => {
      throw new Error('boom');
    });

    await expect(loadActiveColdAlerts()).resolves.toMatchObject({ kind: 'unverifiable' });
  });
});

describe('loadAlertDecision', () => {
  function wireEndpoints() {
    apiClient.get.mockImplementation((url: string) => {
      if (url === '/api/organization/alerts') {
        return Promise.resolve({
          data: {
            data: [
              {
                id: 'a1',
                type: 'TEMP_EXCURSION',
                statut: 'ACTIVE',
                message: 'Excursion',
                niveau_gravite: 'CRITIQUE',
                id_materiel: 'eq1',
                created_at: '2026-07-11T22:52:20.000Z',
              },
            ],
          },
        });
      }
      if (url === '/api/organization/equipment') {
        return Promise.resolve({
          data: {
            data: [
              { id: 'eq1', nom: 'Chambre A', temp_actuelle: '7.4', temp_seuil_max: '4', sensor_id: 'S1', lieu: { nom: 'Chambre froide A' } },
              { id: 'eq2', nom: 'Autre', temp_actuelle: null, temp_seuil_max: null, sensor_id: null },
            ],
          },
        });
      }
      if (url === '/api/organization/quarantine-batches') {
        return Promise.resolve({
          data: {
            data: [
              { id: 'b1', lot_number: '260709-000099', quantite_actuelle: '120', unite_code: 'kg', id_materiel_actuel: 'eq1', produit: { nom: 'Beurre' } },
              // Sur un AUTRE équipement : ne doit PAS être retenu (sinon on isolerait des lots sains).
              { id: 'b2', lot_number: '260709-000100', quantite_actuelle: '5', unite_code: 'kg', id_materiel_actuel: 'eqOTHER', produit: { nom: 'Lait' } },
            ],
          },
        });
      }
      return Promise.reject(new Error(`URL inattendue: ${url}`));
    });
  }

  it('compose alerte + équipement + lots en quarantaine du bon équipement', async () => {
    wireEndpoints();

    const decision = await loadAlertDecision('a1');

    expect(decision?.equipmentNom).toBe('Chambre A');
    expect(decision?.lieuNom).toBe('Chambre froide A');
    // Decimal Prisma (string) → number
    expect(decision?.tempMesuree).toBe(7.4);
    expect(decision?.tempSeuilMax).toBe(4);
    // Filtre par id_materiel_actuel : seul b1 (eq1) est concerné, pas b2 (eqOTHER)
    expect(decision?.batches).toHaveLength(1);
    expect(decision?.batches[0]).toMatchObject({
      id: 'b1',
      lotNumber: '260709-000099',
      produitNom: 'Beurre',
      quantite: 120,
      uniteCode: 'kg',
    });
  });

  it('renvoie null quand l’alerte est introuvable (déjà résolue ailleurs)', async () => {
    apiClient.get.mockResolvedValue({ data: { data: [] } });

    expect(await loadAlertDecision('inconnue')).toBeNull();
    // Pas d'appel équipement/quarantaine si l'alerte n'existe pas.
    expect(apiClient.get).toHaveBeenCalledTimes(1);
  });
});

describe('resolveAlert', () => {
  it('envoie la note (nettoyée) quand elle est renseignée', async () => {
    apiClient.patch.mockResolvedValue({ data: {} });

    await resolveAlert('a1', '  mesure répétée  ');

    expect(apiClient.patch).toHaveBeenCalledWith('/api/alerts/a1/resolve', { note: 'mesure répétée' });
  });

  it('omet la note quand elle est vide (empty string refusée par le validateur API)', async () => {
    apiClient.patch.mockResolvedValue({ data: {} });

    await resolveAlert('a1', '   ');

    expect(apiClient.patch).toHaveBeenCalledWith('/api/alerts/a1/resolve', {});
  });
});

describe('releaseAndResolve', () => {
  it('lève chaque lot (motif obligatoire) puis clôture l’alerte', async () => {
    apiClient.post.mockResolvedValue({ data: {} });
    apiClient.patch.mockResolvedValue({ data: {} });

    await releaseAndResolve('a1', ['b1', 'b2'], 'faux positif capteur');

    expect(apiClient.post).toHaveBeenCalledWith('/api/logistics/batches/b1/release', { motif: 'faux positif capteur' });
    expect(apiClient.post).toHaveBeenCalledWith('/api/logistics/batches/b2/release', { motif: 'faux positif capteur' });
    expect(apiClient.patch).toHaveBeenCalledWith('/api/alerts/a1/resolve', { note: 'faux positif capteur' });
  });
});
