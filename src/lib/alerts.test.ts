import { loadActiveColdAlerts, loadAlertDecision, releaseAndResolve, resolveAlert } from './alerts';
import { ApiError } from './errors';

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
                // (issue #57) Le pic de l'incident, en champ structuré. VOLONTAIREMENT différent de
                // la temp ACTUELLE de l'équipement (7.4) : c'est 9 qu'il faut afficher, pas 7.4.
                peak_temp: '9',
                temp_seuil: '4',
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
      // ⚠️ On DEMANDE les lots de l'alerte. Avant, ils étaient devinés en filtrant
      // `/organization/quarantine-batches` (tous les lots BLOQUE de l'org) sur l'équipement : un lot
      // bloqué par un contrôle qualité sans rapport, rangé dans le même frigo, y entrait — et la
      // levée le remettait en stock.
      if (url === '/api/alerts/a1/batches') {
        return Promise.resolve({
          data: {
            data: [
              { id: 'b1', lot_number: '260709-000099', quantite_actuelle: '120', unite_code: 'kg', produit: { nom: 'Beurre' }, levable: true, motif_blocage: null },
              // Isolé par le froid, mais déclaré non conforme DEPUIS : la levée ne doit pas le rendre.
              { id: 'b2', lot_number: '260709-000100', quantite_actuelle: '5', unite_code: 'kg', produit: { nom: 'Lait' }, levable: false, motif_blocage: 'CONTROLE_NON_CONFORME' },
            ],
          },
        });
      }
      return Promise.reject(new Error(`URL inattendue: ${url}`));
    });
  }

  it('compose alerte + équipement + les lots que CETTE alerte retient', async () => {
    wireEndpoints();

    const result = await loadAlertDecision('a1');

    expect(result.kind).toBe('active');
    const decision = result.kind === 'active' ? result.decision : null;

    expect(decision?.equipmentNom).toBe('Chambre A');
    expect(decision?.lieuNom).toBe('Chambre froide A');
    // ⚠️ LE cœur de l'issue : la mesure vient du PIC de l'alerte (9), pas de la temp actuelle de
    // l'équipement (7.4) — jamais renseignée par l'IoT, donc « — » à l'écran.
    expect(decision?.tempMesuree).toBe(9);
    expect(decision?.tempSeuilMax).toBe(4);

    // Les lots viennent de l'API, qui sait lesquels CETTE alerte a isolés — on ne les devine plus.
    expect(decision?.batches).toHaveLength(2);
    expect(decision?.batches[0]).toMatchObject({
      id: 'b1',
      lotNumber: '260709-000099',
      produitNom: 'Beurre',
      quantite: 120,
      uniteCode: 'kg',
      levable: true,
      motifBlocage: null,
    });
    // Le lot condamné est transmis à l'écran — pour être MONTRÉ, pas pour être relâché.
    expect(decision?.batches[1]).toMatchObject({
      id: 'b2',
      levable: false,
      motifBlocage: 'CONTROLE_NON_CONFORME',
    });
  });

  // NE PAS MENTIR : une alerte sans pic (ancienne, avant le champ structuré) laisse la mesure à
  // « — » — on ne la remplace PAS par la temp actuelle de l'équipement, qui n'est pas l'incident.
  it('laisse la mesure à null quand l’alerte n’a pas de pic, sans retomber sur la temp équipement', async () => {
    apiClient.get.mockImplementation((url: string) => {
      if (url === '/api/organization/alerts') {
        return Promise.resolve({
          data: {
            data: [
              { id: 'a1', type: 'TEMP_EXCURSION', statut: 'ACTIVE', message: 'x', id_materiel: 'eq1', peak_temp: null, temp_seuil: null },
            ],
          },
        });
      }
      if (url === '/api/organization/equipment') {
        return Promise.resolve({
          data: { data: [{ id: 'eq1', nom: 'Chambre A', temp_actuelle: '7.4', temp_seuil_max: '4', sensor_id: 'S1', lieu: { nom: 'Chambre froide A' } }] },
        });
      }
      if (url === '/api/alerts/a1/batches') {
        return Promise.resolve({ data: { data: [] } });
      }
      return Promise.reject(new Error(`URL inattendue: ${url}`));
    });

    const result = await loadAlertDecision('a1');
    const decision = result.kind === 'active' ? result.decision : null;

    // Pas de pic connu → « — », JAMAIS 7.4 (la temp actuelle).
    expect(decision?.tempMesuree).toBeNull();
    // Le seuil, lui, retombe honnêtement sur celui configuré de l'équipement.
    expect(decision?.tempSeuilMax).toBe(4);
  });

  it("ne va JAMAIS chercher les lots dans « tous les lots bloqués de l'organisation »", async () => {
    wireEndpoints();

    await loadAlertDecision('a1');

    // C'est cet appel qui causait le relâchement non consenti : il ramassait les lots bloqués pour
    // n'importe quelle cause, du moment qu'ils étaient rangés dans le même frigo.
    const urls = apiClient.get.mock.calls.map((c: unknown[]) => c[0]);
    expect(urls).not.toContain('/api/organization/quarantine-batches');
    expect(urls).toContain('/api/alerts/a1/batches');
  });

  // ⚠️ L'ancien test encodait le mensonge : « absente de la liste ⇒ null », que l'écran traduisait
  // par « déjà résolue sur un autre poste ». Or `GET /organization/alerts` ne filtre RIEN : une
  // alerte résolue Y FIGURE ENCORE. Absente veut donc dire « identifiant inconnu ».
  it('dit « inconnue » — pas « résolue » — quand l’alerte est absente de la liste', async () => {
    apiClient.get.mockResolvedValue({ data: { data: [] } });

    expect(await loadAlertDecision('inconnue')).toEqual({ kind: 'unknown' });
    // Pas d'appel équipement/quarantaine si l'alerte n'existe pas.
    expect(apiClient.get).toHaveBeenCalledTimes(1);
  });

  // Le VRAI « déjà résolue » : l'alerte est TROUVÉE, mais clôturée. Avant, l'écran affichait
  // l'incident entier, boutons actifs — et « Maintenir la quarantaine » répondait 200 (idempotent),
  // donc un toast de SUCCÈS sur des lots déjà remis en stock.
  it('reconnaît une alerte déjà résolue au lieu de rouvrir l’incident', async () => {
    apiClient.get.mockResolvedValue({
      data: {
        data: [
          { id: 'a1', type: 'TEMP_EXCURSION', statut: 'RESOLVED', message: 'Pic 7,4 °C', id_materiel: 'eq1' },
        ],
      },
    });

    const result = await loadAlertDecision('a1');

    expect(result.kind).toBe('resolved');
    // On n'interroge ni l'équipement ni les lots : il n'y a plus de décision à prendre.
    expect(apiClient.get).toHaveBeenCalledTimes(1);
  });

  // ⚠️ LE test. Sur une panne réseau, la fonction JETAIT — et l'écran retombait sur son état
  // « introuvable », c'est-à-dire « déjà résolue », coche verte comprise. À un opérateur qui est
  // dans une chambre froide, sans réseau, devant une excursion thermique.
  it('AVOUE qu’il n’a pas pu vérifier, au lieu de laisser croire à une résolution', async () => {
    apiClient.get.mockRejectedValue(new ApiError('Erreur réseau', 0));

    const result = await loadAlertDecision('a1');

    expect(result.kind).toBe('unverifiable');
  });

  // Le contrat : elle ne rejette JAMAIS. L'écran l'appelle sans `.catch`.
  it('ne rejette JAMAIS, même sur une erreur inattendue', async () => {
    apiClient.get.mockImplementation(() => {
      throw new Error('boom');
    });

    await expect(loadAlertDecision('a1')).resolves.toMatchObject({ kind: 'unverifiable' });
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
  const lot = (id: string, lotNumber: string, levable = true) => ({
    id,
    lotNumber,
    produitNom: 'Beurre',
    quantite: 100,
    uniteCode: 'kg',
    levable,
    motifBlocage: levable ? null : ('CONTROLE_NON_CONFORME' as const),
  });
  const B1 = lot('b1', 'LOT-1');
  const B2 = lot('b2', 'LOT-2');
  const B3 = lot('b3', 'LOT-3');
  /** Isolé par le froid, mais déclaré non conforme DEPUIS. La levée ne doit pas le rendre au stock. */
  const CONDAMNE = lot('bx', 'LOT-X', false);

  /** Ce que le SERVEUR dit que cette alerte retient ENCORE, après coup. */
  const stillBlocked = (...ids: string[]) =>
    apiClient.get.mockResolvedValue({
      data: { data: ids.map((id) => ({ id, lot_number: id, quantite_actuelle: '1', unite_code: 'kg', levable: true, motif_blocage: null })) },
    });

  it('lève chaque lot (motif obligatoire) puis clôture l’alerte', async () => {
    apiClient.post.mockResolvedValue({ data: {} });
    apiClient.patch.mockResolvedValue({ data: {} });
    stillBlocked();

    const outcome = await releaseAndResolve('a1', [B1, B2], 'faux positif capteur');

    expect(apiClient.post).toHaveBeenCalledWith('/api/logistics/batches/b1/release', { motif: 'faux positif capteur' });
    expect(apiClient.post).toHaveBeenCalledWith('/api/logistics/batches/b2/release', { motif: 'faux positif capteur' });
    expect(apiClient.patch).toHaveBeenCalledWith('/api/alerts/a1/resolve', { note: 'faux positif capteur' });
    expect(outcome).toMatchObject({ alertResolved: true, stillBlocked: [] });
    expect(outcome.released).toHaveLength(2);
  });

  // ⚠️ LE test de cette PR. Un lot déclaré non conforme APRÈS son isolement est isolé par le froid
  // ET impropre. Le rendre au stock parce que la chambre froide est réparée remettrait en
  // circulation une marchandise que le labo a condamnée.
  it('ne relâche JAMAIS un lot non levable, même en levant les autres', async () => {
    apiClient.post.mockResolvedValue({ data: {} });
    apiClient.patch.mockResolvedValue({ data: {} });
    stillBlocked(); // le serveur ne retient plus aucun lot levable

    const outcome = await releaseAndResolve('a1', [B1, CONDAMNE], 'frigo réparé');

    expect(apiClient.post).toHaveBeenCalledTimes(1);
    expect(apiClient.post).toHaveBeenCalledWith('/api/logistics/batches/b1/release', { motif: 'frigo réparé' });
    expect(apiClient.post).not.toHaveBeenCalledWith('/api/logistics/batches/bx/release', expect.anything());

    expect(outcome.released.map((b) => b.id)).toEqual(['b1']);
    // Il reste isolé — et l'opérateur doit le savoir.
    expect(outcome.stillBlocked.map((b) => b.id)).toEqual(['bx']);
  });

  // ⚠️ Le piège inverse : refuser de clôturer tant qu'un lot est isolé rendrait l'alerte
  // DÉFINITIVEMENT inclôturable — le blocage d'un lot condamné ne vient pas du froid, et rien dans
  // ce circuit ne pourra jamais le lever. L'incident FROID, lui, est bien traité.
  it('clôture quand même l’alerte quand il ne reste que des lots condamnés', async () => {
    apiClient.post.mockResolvedValue({ data: {} });
    apiClient.patch.mockResolvedValue({ data: {} });
    stillBlocked();

    const outcome = await releaseAndResolve('a1', [B1, CONDAMNE], 'frigo réparé');

    expect(outcome.alertResolved).toBe(true);
    expect(apiClient.patch).toHaveBeenCalledWith('/api/alerts/a1/resolve', { note: 'frigo réparé' });
  });

  // ⚠️ LE test. La boucle n'est pas atomique : elle abandonnait au premier échec, et l'écran
  // affichait « Levée impossible ». Or les lots précédents étaient DÉJÀ remis en stock —
  // l'opérateur repartait convaincu que sa marchandise suspecte était toujours isolée.
  it('DIT ce qui est parti quand la levée est partielle', async () => {
    apiClient.post
      .mockResolvedValueOnce({ data: {} })   // b1 : relâché
      .mockResolvedValueOnce({ data: {} })   // b2 : relâché
      .mockRejectedValueOnce(new ApiError('Boom', 500)); // b3 : échec applicatif
    stillBlocked('b3');

    const outcome = await releaseAndResolve('a1', [B1, B2, B3], 'motif');

    expect(outcome.released.map((b) => b.id)).toEqual(['b1', 'b2']);
    expect(outcome.stillBlocked.map((b) => b.id)).toEqual(['b3']);
    // L'alerte reste OUVERTE : de la marchandise suspecte est encore isolée.
    expect(outcome.alertResolved).toBe(false);
    expect(apiClient.patch).not.toHaveBeenCalled();
  });

  // ⚠️ Une erreur APPLICATIVE (le serveur a répondu) ne concerne qu'UN lot : les suivants doivent
  // quand même être tentés. Sans ce test, « abandonner au premier échec » — le bug d'origine —
  // passe inaperçu : mon premier test plaçait l'échec sur le DERNIER lot, où les deux
  // comportements donnent le même résultat. Il ne prouvait rien.
  it('continue les lots suivants quand UN lot est refusé par le serveur', async () => {
    apiClient.post
      .mockRejectedValueOnce(new ApiError('Boom', 500)) // b1 : refusé
      .mockResolvedValueOnce({ data: {} })              // b2 : doit être tenté QUAND MÊME
      .mockResolvedValueOnce({ data: {} });             // b3 : idem
    stillBlocked('b1');

    const outcome = await releaseAndResolve('a1', [B1, B2, B3], 'motif');

    expect(apiClient.post).toHaveBeenCalledTimes(3);
    expect(outcome.released.map((b) => b.id)).toEqual(['b2', 'b3']);
    expect(outcome.stillBlocked.map((b) => b.id)).toEqual(['b1']);
    expect(outcome.alertResolved).toBe(false);
  });

  // ⚠️ Le `release` n'est PAS idempotent : un lot déjà relâché répond 409 POUR TOUJOURS. Compter
  // ce 409 comme un échec rendrait l'alerte DÉFINITIVEMENT inclôturable. On observe l'état réel.
  it('n’enferme pas l’alerte quand un lot est déjà relâché (409)', async () => {
    apiClient.post
      .mockResolvedValueOnce({ data: {} })
      .mockRejectedValueOnce(new ApiError('Seul un lot en quarantaine peut être levé', 409));
    stillBlocked(); // le serveur : plus AUCUN lot bloqué
    apiClient.patch.mockResolvedValue({ data: {} });

    const outcome = await releaseAndResolve('a1', [B1, B2], 'motif');

    expect(outcome.stillBlocked).toEqual([]);
    expect(outcome.alertResolved).toBe(true);
    expect(apiClient.patch).toHaveBeenCalled();
  });

  // Une panne réseau ARRÊTE la boucle : insister, c'est 30 s de délai d'attente PAR LOT — deux
  // minutes trente de spinner bloquant, dans une chambre froide.
  it('n’insiste pas lot après lot quand le réseau est coupé', async () => {
    apiClient.post.mockRejectedValue(new ApiError('Erreur réseau', 0));
    apiClient.get.mockRejectedValue(new ApiError('Erreur réseau', 0));

    const outcome = await releaseAndResolve('a1', [B1, B2, B3], 'motif');

    expect(apiClient.post).toHaveBeenCalledTimes(1);
    expect(outcome.released).toEqual([]);
    expect(outcome.alertResolved).toBe(false);
  });

  // On ne peut même plus OBSERVER l'état : on ne prétend rien. Surtout pas qu'un lot est relâché.
  it('ne déclare RIEN relâché quand il ne peut pas vérifier l’état', async () => {
    apiClient.post.mockResolvedValue({ data: {} });
    apiClient.get.mockRejectedValue(new ApiError('Erreur réseau', 0));

    const outcome = await releaseAndResolve('a1', [B1, B2], 'motif');

    expect(outcome.released).toEqual([]);
    expect(outcome.stillBlocked).toHaveLength(2);
    expect(outcome.alertResolved).toBe(false);
  });
});
