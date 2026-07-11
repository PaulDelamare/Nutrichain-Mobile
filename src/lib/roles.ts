const ROLE_LABELS: Record<string, string> = {
  owner: 'Propriétaire',
  admin: 'Administrateur',
  manager: 'Responsable',
  operator: 'Opérateur',
  member: 'Membre',
  logistics_owner: 'Responsable logistique',
  logistics_admin: 'Administrateur logistique',
  logistics_operator: 'Opérateur logistique',
  logistics_viewer: 'Consultation logistique',
  quality_control: 'Contrôle qualité',
};

/** Un rôle inconnu s'affiche brut : l'API peut en introduire un avant le mobile. */
export function formatRole(role: string): string {
  return ROLE_LABELS[role] ?? role;
}
