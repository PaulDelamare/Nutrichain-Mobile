import { formatRole } from './roles';

describe('formatRole', () => {
  it('traduit les rôles de l’organisation', () => {
    expect(formatRole('owner')).toBe('Propriétaire');
    expect(formatRole('operator')).toBe('Opérateur');
  });

  it('traduit les rôles métier logistiques', () => {
    expect(formatRole('logistics_operator')).toBe('Opérateur logistique');
    expect(formatRole('quality_control')).toBe('Contrôle qualité');
  });

  it('affiche tel quel un rôle inconnu plutôt que rien', () => {
    // L'API peut introduire un rôle avant le mobile : mieux vaut « chef_zone » que du vide.
    expect(formatRole('chef_zone')).toBe('chef_zone');
  });
});
