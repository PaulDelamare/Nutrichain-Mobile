/**
 * Vocabulaire de rôles — miroir de `src/modules/identity/constants/roles.constants.ts` côté API.
 *
 * ⚠️ Le serveur est la SEULE source de vérité des droits (`requireOrgRole`). Ce qui suit ne
 * duplique ce vocabulaire que pour une raison d'UI : ne pas offrir un bouton qui mènera à un
 * refus. Un écart entre les deux listes ne crée pas de faille (le 403 reste), mais rend
 * l'application menteuse — d'où le miroir explicite, à corriger si l'API change.
 *
 * L'ancien vocabulaire (`member`, `manager`, `logistics_*`, `quality_control`) a été REMPLACÉ
 * côté serveur ; il n'est conservé ici qu'en traduction, pour les sessions et journaux anciens.
 */
const ROLE_LABELS: Record<string, string> = {
  owner: 'Propriétaire',
  admin: 'Administrateur',
  quality: 'Contrôle qualité',
  operator: 'Opérateur',
  viewer: 'Consultation',
  // Vocabulaire retiré côté API — traduit encore pour ne rien afficher de brut.
  manager: 'Responsable',
  member: 'Membre',
  logistics_owner: 'Responsable logistique',
  logistics_admin: 'Administrateur logistique',
  logistics_operator: 'Opérateur logistique',
  logistics_viewer: 'Consultation logistique',
  quality_control: 'Contrôle qualité',
};

/** Écritures métier : réception, transformation, expédition, scans terrain (`WRITE_ROLES`). */
const WRITE_ROLES = ['owner', 'admin', 'operator'];

/**
 * Décisions qualité : rappel produit, levée de quarantaine, résolution d'alerte (`QUALITY_ROLES`).
 *
 * ⚠️ L'`operator` — la persona de cette application — en est EXCLU, délibérément : celui qui
 * réceptionne un lot ne signe pas le rappel qui le bloque (séparation des tâches HACCP,
 * cf. `roles.constants.ts:42`). Ce n'est pas un oubli d'implémentation mais une frontière.
 */
const QUALITY_ROLES = ['owner', 'admin', 'quality'];

/** Un rôle inconnu s'affiche brut : l'API peut en introduire un avant le mobile. */
export function formatRole(role: string): string {
  return ROLE_LABELS[role] ?? role;
}

/**
 * ⚠️ `role === null` signifie « on ne SAIT pas », pas « aucun droit ».
 *
 * Le rôle vient de `GET /api/me`, qui exige le réseau. En chambre froide, ou tant que la première
 * réponse n'est pas revenue, il est inconnu. Refuser l'écriture dans ce cas enfermerait
 * l'opérateur là où l'application doit précisément servir — une panne bien pire que le bouton
 * trompeur qu'on corrige. On laisse donc passer : le serveur tranchera en 403, comme aujourd'hui.
 */
export function canWrite(role: string | null): boolean {
  return role === null || WRITE_ROLES.includes(role);
}

/**
 * Pourquoi l'écriture est refusée, EN FRANÇAIS — ou `null` si elle est permise (ou indécidable).
 * Même contrat que `blockingReason` sur un lot : l'opérateur lit une phrase, jamais un code.
 */
export function writeBlockedReason(role: string | null): string | null {
  if (canWrite(role)) {
    return null;
  }

  return `Votre rôle (${formatRole(role as string)}) ne permet pas d'enregistrer une opération. Demandez un accès opérateur.`;
}

/**
 * (issue #89) Le rappel produit est-il permis ? Contrairement à `canWrite`, un rôle INCONNU
 * répond `false`.
 *
 * La permissivité de `canWrite` n'existe que pour une raison : ne pas enfermer l'opérateur en
 * chambre froide, où la saisie doit marcher sans réseau. Le rappel, lui, est **en ligne
 * uniquement** — cet argument ne s'applique pas. Et c'est l'action la plus destructrice du
 * système (blocage en cascade de toute la descendance) : l'offrir sans pouvoir confirmer le
 * droit, c'est recréer l'échec 403 différé que l'application vient d'éliminer.
 */
export function canQuality(role: string | null): boolean {
  return role !== null && QUALITY_ROLES.includes(role);
}

/**
 * Pourquoi le rappel est indisponible — ou `null` s'il est permis.
 *
 * ⚠️ TROIS états, jamais deux : « on ne sait pas » n'est PAS « vous n'avez pas le droit ». Un
 * rôle non vérifié doit le dire, et non accuser l'utilisateur d'un manque de droits qu'on n'a
 * pas pu constater.
 */
export function recallBlockedReason(role: string | null): string | null {
  if (role === null) {
    return "Rôle non vérifié : impossible de confirmer que vous pouvez déclencher un rappel. Vérifiez votre connexion.";
  }

  if (canQuality(role)) {
    return null;
  }

  return `Un rappel engage la sécurité sanitaire : il est réservé au contrôle qualité. Votre rôle (${formatRole(role)}) ne le permet pas.`;
}
