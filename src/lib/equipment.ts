import { apiClient } from './api';
import { readCache, writeCache } from './cache';

export interface Equipment {
  id: string;
  nom: string;
  type: string;
  /** Étiquette scannable apposée sur le matériel. Absente tant qu'aucune n'a été imprimée. */
  qr_code_id: string | null;
  lieu: { nom: string };
}

/**
 * Réseau d'abord, cache en secours : le scan du frigo a lieu DANS la chambre froide, sans
 * réseau. Sans cette liste en local, l'emplacement serait impossible à saisir — donc jamais
 * enregistré, et la quarantaine automatique sur excursion de température ne ciblerait aucun lot.
 */
export async function loadEquipment(): Promise<Equipment[]> {
  try {
    const { data } = await apiClient.get<{ data: Equipment[] }>('/api/organization/equipment');
    await writeCache('equipment', data.data);
    return data.data;
  } catch (error) {
    const cached = await readCache<Equipment[]>('equipment');
    if (cached) {
      return cached;
    }
    throw error;
  }
}

/**
 * Où un lot peut être RANGÉ. Une cuve ou un mixeur transforment, ils ne stockent pas :
 * y rattacher un lot ferait porter la quarantaine sur un matériel qui n'est pas son
 * emplacement réel — et le lot vraiment stocké ailleurs ne serait jamais bloqué.
 */
const STORAGE_TYPES = ['FRIGO', 'CONGELATEUR', 'ETAGERE'];

export function isStorageEquipment(equipment: Equipment): boolean {
  return STORAGE_TYPES.includes(equipment.type.toUpperCase());
}

/**
 * L'étiquette d'un matériel se reconnaît à l'œil : le serveur la frappe `EQP-` + 10 hexadécimaux
 * (cf. `equipment.service.ts`). Reconnaître la FORME, sans avoir la liste des matériels en main,
 * permet de dire « ceci est un emplacement » même hors réseau et cache vide — au lieu d'ouvrir une
 * réception avec le code d'un frigo dans le numéro d'expédition.
 */
const EQUIPMENT_CODE = /^EQP-[0-9A-F]{10}$/i;

export function isEquipmentCode(code: string): boolean {
  return EQUIPMENT_CODE.test(code.trim());
}

/**
 * Résout un code scanné en équipement, localement. On accepte l'étiquette QR comme
 * l'identifiant : toutes les étiquettes ne portent pas encore de code dédié.
 *
 * Un code inconnu ne résout RIEN : un code produit scanné par mégarde ne doit jamais passer
 * pour un emplacement.
 */
export function findEquipmentByCode(code: string, equipment: Equipment[]): Equipment | undefined {
  const needle = code.trim().toLowerCase();

  // Un code vide ne doit rien résoudre : une étiquette non renseignée (chaîne vide en base)
  // ferait alors correspondre n'importe quelle lecture ratée de la caméra.
  if (needle === '') {
    return undefined;
  }

  return equipment.find(
    (item) => item.qr_code_id?.toLowerCase() === needle || item.id.toLowerCase() === needle
  );
}
