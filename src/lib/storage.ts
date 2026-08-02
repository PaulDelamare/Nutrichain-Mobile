import { apiClient } from './api';
import { isStorageEquipment, type Equipment } from './equipment';

/**
 * Ranger un lot : lui donner son emplacement de stockage.
 *
 * C'est le geste terrain le plus courant après la réception, et il n'était appelable par AUCUNE
 * application — la route existait depuis des mois, sans client. L'issue #282 décrivait la douleur
 * d'un rangement « lot par lot » ; en réalité on ne pouvait pas ranger un seul lot.
 *
 * L'emplacement compte au-delà du confort : la quarantaine automatique sur excursion de température
 * cible les lots RANGÉS dans le matériel en cause. Un lot sans emplacement n'est bloqué par aucune
 * alerte froid.
 */

/** Les emplacements où un lot peut être rangé, triés pour que la liste ne saute pas d'un rendu à l'autre. */
export function storageOptions(equipment: Equipment[]): Equipment[] {
  return equipment
    .filter(isStorageEquipment)
    .slice()
    .sort((gauche, droite) => gauche.nom.localeCompare(droite.nom));
}

/**
 * Range le lot à l'emplacement donné.
 *
 * L'API répond 200 même si le lot y était déjà (idempotent) : un second appui, ou un renvoi réseau,
 * ne doit pas alarmer l'opérateur qui a les mains prises.
 */
export async function moveBatchToStorage(batchId: string, equipmentId: string): Promise<void> {
  await apiClient.patch(`/api/logistics/batches/${encodeURIComponent(batchId)}/location`, {
    id_materiel: equipmentId,
  });
}
