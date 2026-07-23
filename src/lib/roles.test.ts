import { canWrite, formatRole, writeBlockedReason } from './roles';

describe('formatRole', () => {
  it('traduit les rôles de l’organisation', () => {
    expect(formatRole('owner')).toBe('Propriétaire');
    expect(formatRole('operator')).toBe('Opérateur');
  });

  // (issue #71) Le vocabulaire serveur a changé : `quality` et `viewer` ont remplacé
  // `quality_control` et les `logistics_*`. Sans eux, un contrôleur qualité lisait « quality » brut.
  it('traduit les rôles canoniques du serveur', () => {
    expect(formatRole('admin')).toBe('Administrateur');
    expect(formatRole('quality')).toBe('Contrôle qualité');
    expect(formatRole('viewer')).toBe('Consultation');
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
    expect(canWrite('owner')).toBe(true);
    expect(canWrite('admin')).toBe(true);
    expect(canWrite('operator')).toBe(true);
  });

  it('refuse le viewer et le quality — exclus des écritures côté API', () => {
    // ⚠️ Le mutant à tuer : inclure `quality` parce qu'il « a des droits ». Il en a d'AUTRES
    // (levée de quarantaine), mais pas l'écriture terrain — le serveur le refuse en 403.
    expect(canWrite('viewer')).toBe(false);
    expect(canWrite('quality')).toBe(false);
  });

  it('refuse un rôle inconnu plutôt que de le supposer permissif', () => {
    // Un rôle que le mobile ne connaît pas n'est pas une raison d'ouvrir l'écriture.
    expect(canWrite('chef_zone')).toBe(false);
  });

  /**
   * ⚠️ LE cas offline-first. `/api/me` exige le réseau : en chambre froide, le rôle peut être
   * INCONNU (`null`). Refuser l'écriture enfermerait l'opérateur là où l'app doit précisément
   * servir — un bug bien pire que celui qu'on corrige. La garde mobile est une affordance d'UI,
   * pas une frontière de sécurité : le serveur reste l'autorité et refuse en 403.
   */
  it('laisse passer quand le rôle est INCONNU, jamais l’inverse', () => {
    expect(canWrite(null)).toBe(true);
  });
});

describe('writeBlockedReason', () => {
  it('nomme le rôle dans une PHRASE, pas le code brut', () => {
    // L'opérateur lit « Consultation », pas « viewer » — même exigence que `blockingReason`.
    expect(writeBlockedReason('viewer')).toContain('Consultation');
  });

  it('ne dit rien quand l’écriture est permise', () => {
    expect(writeBlockedReason('operator')).toBeNull();
  });

  it('ne dit rien quand le rôle est inconnu : on n’accuse pas sans savoir', () => {
    expect(writeBlockedReason(null)).toBeNull();
  });
});
