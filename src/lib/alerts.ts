import { apiClient } from './api';

export interface Alert {
  id: string;
  type: string;
  statut: string;
  message: string;
  niveau_gravite?: string;
}

const COLD_CHAIN_TYPE = 'TEMP_EXCURSION';

/**
 * L'API renvoie toutes les alertes de l'organisation, sans filtre possible :
 * le tri est donc à notre charge. Hors réseau, l'accueil reste utilisable.
 */
export async function loadActiveColdAlerts(): Promise<Alert[]> {
  try {
    const { data } = await apiClient.get<{ data: Alert[] }>('/api/organization/alerts');
    return data.data.filter(
      (alert) => alert.type === COLD_CHAIN_TYPE && alert.statut === 'ACTIVE'
    );
  } catch {
    return [];
  }
}
