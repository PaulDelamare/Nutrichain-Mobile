import { canQuality, canWrite, formatRole, recallBlockedReason, writeBlockedReason } from './roles';

describe('formatRole', () => {
  // (issues #71 / #75) Les CINQ rôles canoniques, et eux seuls. `quality` et `viewer` manquaient :
  // ils s'affichaient en anglais brut au milieu d'une interface française.
  it('traduit les cinq rôles canoniques du serveur', () => {
    expect(formatRole('owner')).toBe('Propriétaire');
    expect(formatRole('admin')).toBe('Administrateur');
    expect(formatRole('quality')).toBe('Contrôle qualité');
    expect(formatRole('operator')).toBe('Opérateur');
    expect(formatRole('viewer')).toBe('Consultation');
  });

  /**
   * (issue #75) L'ancien vocabulaire a été SUPPRIMÉ par la refonte RBAC de l'API : plus aucune
   * route, plus aucun seed ne le produit. Le garder entretenait une table à double vocabulaire
   * dont la moitié ne pouvait plus jamais apparaître.
   *
   * ⚠️ Le mutant à tuer : les réintroduire « au cas où ». Traduire un rôle que l'API ne produit
   * plus ferait passer un état anormal pour un état légitime — mieux vaut le voir brut.
   */
  it('n’entretient plus l’ancien vocabulaire retiré de l’API', () => {
    expect(formatRole('logistics_operator')).toBe('logistics_operator');
    expect(formatRole('logistics_owner')).toBe('logistics_owner');
    expect(formatRole('quality_control')).toBe('quality_control');
    expect(formatRole('manager')).toBe('manager');
    expect(formatRole('member')).toBe('member');
  });

  it('affiche tel quel un rôle inconnu plutôt que rien', () => {
    // L'API peut introduire un rôle avant le mobile : mieux vaut « chef_zone » que du vide.
    expect(formatRole('chef_zone')).toBe('chef_zone');
  });
});

/**
 * (issue #71) Miroir de `WRITE_ROLES` côté API. Le mobile laissait un `viewer` scanner, saisir et
 * valider : l'opération partait en file locale et n'était refusée qu'à la synchronisation (403 →
 * REJECTED). Le travail était perdu APRÈS COUP, sans que rien ne l'ait annoncé.
 */
describe('canWrite', () => {
  it('autorise les rôles d’écriture terrain', () => {
    expect(canWrite('owner', true)).toBe(true);
    expect(canWrite('admin', true)).toBe(true);
    expect(canWrite('operator', true)).toBe(true);
  });

  it('refuse le viewer et le quality — exclus des écritures côté API', () => {
    // ⚠️ Le mutant à tuer : inclure `quality` parce qu'il « a des droits ». Il en a d'AUTRES
    // (levée de quarantaine), mais pas l'écriture terrain — le serveur le refuse en 403.
    expect(canWrite('viewer', true)).toBe(false);
    expect(canWrite('quality', true)).toBe(false);
  });

  it('refuse un rôle inconnu plutôt que de le supposer permissif', () => {
    // Un rôle que le mobile ne connaît pas n'est pas une raison d'ouvrir l'écriture.
    expect(canWrite('chef_zone', true)).toBe(false);
  });

  /**
   * ⚠️ LE cas offline-first. `/api/me` exige le réseau : en chambre froide, le rôle peut être
   * INCONNU (`null`). Refuser l'écriture enfermerait l'opérateur là où l'app doit précisément
   * servir — un bug bien pire que celui qu'on corrige. La garde mobile est une affordance d'UI,
   * pas une frontière de sécurité : le serveur reste l'autorité et refuse en 403.
   */
  it('laisse passer quand le rôle est INCONNU, jamais l’inverse', () => {
    expect(canWrite(null, true)).toBe(true);
  });

  /**
   * #102 — `role === null` recouvrait DEUX états que la fonction ne distinguait pas : « on ne sait
   * pas encore » (hors ligne, session valide) et « il n'y a aucune session ». Le premier justifie
   * la permissivité ; le second, jamais. La garde de rôle « à l'entrée » que les écrans annoncent
   * ne se déclenchait donc pas dans le seul cas où elle comptait vraiment.
   *
   * Le second paramètre est OBLIGATOIRE, et c'est le point : aucun appelant ne peut conserver
   * l'ancien comportement par omission — TypeScript le force à trancher.
   */
  describe('sans session (#102)', () => {
    it('refuse quand il n’y a aucune session, rôle inconnu', () => {
      expect(canWrite(null, false)).toBe(false);
    });

    it('refuse même avec un rôle d’écriture en cache', () => {
      // Un rôle mémorisé d'un opérateur précédent ne vaut pas session : l'appareil a été déconnecté.
      expect(canWrite('operator', false)).toBe(false);
      expect(canWrite('owner', false)).toBe(false);
    });

    it('préserve le confort hors ligne quand la session, elle, existe', () => {
      // LE cas à ne pas casser : chambre froide, `/api/me` injoignable, rôle inconnu — on passe.
      expect(canWrite(null, true)).toBe(true);
    });
  });
});

/**
 * (issue #89) `QUALITY_ROLES` exclut l'`operator` — la persona même de cette app. Ce n'est pas un
 * oubli : celui qui réceptionne ne signe pas le rappel qui bloque son lot (séparation HACCP).
 */
describe('canQuality', () => {
  it('autorise owner, admin et quality', () => {
    expect(canQuality('owner')).toBe(true);
    expect(canQuality('admin')).toBe(true);
    expect(canQuality('quality')).toBe(true);
  });

  it('refuse l’operator — il écrit des réceptions mais ne SIGNE pas un rappel', () => {
    expect(canQuality('operator')).toBe(false);
    expect(canQuality('viewer')).toBe(false);
  });

  /**
   * ⚠️ Le contraire de `canWrite`, et c'est VOULU. La permissivité de `canWrite` protège la saisie
   * hors ligne ; le rappel est en ligne uniquement, donc cet argument tombe. Offrir l'action la
   * plus destructrice du système sans pouvoir confirmer le droit recréerait l'échec 403 différé.
   */
  it('refuse quand le rôle est INCONNU, à l’inverse de canWrite', () => {
    expect(canQuality(null)).toBe(false);
    expect(canWrite(null, true)).toBe(true);
  });
});

describe('writeBlockedReason sans session (#102)', () => {
  it('explique l’absence de session plutôt que d’inventer un rôle', () => {
    // Sans ce cas, le message aurait affiché « Votre rôle (null) » : illisible, et faux.
    const raison = writeBlockedReason(null, false);

    expect(raison).not.toBeNull();
    expect(raison).not.toContain('null');
    expect(raison?.toLowerCase()).toContain('session');
  });
});

describe('recallBlockedReason', () => {
  it('ne dit rien au contrôle qualité', () => {
    expect(recallBlockedReason('quality')).toBeNull();
  });

  it('invoque la sécurité sanitaire, pas un code de rôle', () => {
    const reason = recallBlockedReason('operator');

    expect(reason).toContain('contrôle qualité');
    expect(reason).toContain('Opérateur');
    expect(reason).not.toContain('QUALITY_ROLES');
  });

  it('distingue « non vérifié » de « pas le droit »', () => {
    // Accuser l'utilisateur d'un manque de droits qu'on n'a PAS pu constater serait un mensonge.
    const inconnu = recallBlockedReason(null);

    expect(inconnu).toContain('non vérifié');
    expect(inconnu).not.toContain('ne le permet pas');
  });
});

describe('writeBlockedReason', () => {
  it('nomme le rôle dans une PHRASE, pas le code brut', () => {
    // L'opérateur lit « Consultation », pas « viewer » — même exigence que `blockingReason`.
    expect(writeBlockedReason('viewer', true)).toContain('Consultation');
  });

  it('ne dit rien quand l’écriture est permise', () => {
    expect(writeBlockedReason('operator', true)).toBeNull();
  });

  it('ne dit rien quand le rôle est inconnu : on n’accuse pas sans savoir', () => {
    expect(writeBlockedReason(null, true)).toBeNull();
  });
});
