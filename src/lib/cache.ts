import { getDatabase } from './db';

/**
 * Fenêtre de fraîcheur du catalogue local (produits, fournisseurs, matériels, clients).
 *
 * Sans TTL, un produit retiré du catalogue restait proposé À VIE sur un téléphone non
 * resynchronisé — et l'opérateur pouvait réceptionner contre un produit qui n'existe plus. 7 jours :
 * aligné sur l'horizon d'idempotence de la file, assez généreux pour une tournée hors réseau, assez
 * court pour ne pas figer un catalogue disparu. Le cache est de toute façon rafraîchi à chaque
 * requête réseau réussie (réseau d'abord) : le TTL ne mord que sur un téléphone hors ligne au-delà.
 */
export const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Lit une entrée du cache — périmée au-delà de `maxAgeMs`, où elle est traitée comme ABSENTE.
 *
 * ⚠️ Le TTL est une DURÉE (`now − cached_at`), pas une date absolue : robuste à un décalage
 * d'horloge constant, `Date.now()` y suffit (contrairement à la garde de péremption, qui compare une
 * date de calendrier et exige, elle, l'heure serveur — cf. [[server-time]]).
 *
 * Par défaut, AUCUNE expiration : l'offset serveur ([[server-time]]) est stocké ici et doit survivre
 * indéfiniment. Seuls les appelants « catalogue » passent explicitement `CACHE_TTL_MS`.
 */
export async function readCache<T>(key: string, maxAgeMs = Infinity): Promise<T | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ value: string; cached_at: number }>(
    'SELECT value, cached_at FROM cache WHERE key = ?',
    key
  );

  if (!row) return null;
  // Périmée : on ne sert PAS une donnée d'âge dépassé. L'appelant retombe sur son chemin d'échec
  // (réception impossible → « catalogue indisponible »), jamais sur un catalogue fantôme.
  if (Date.now() - row.cached_at > maxAgeMs) return null;

  return JSON.parse(row.value) as T;
}

/**
 * Le catalogue est celui de l'organisation de l'opérateur connecté. Le laisser en place après une
 * déconnexion le montrerait, hors réseau, à l'opérateur suivant — qui n'est pas forcément de la
 * même organisation. Aucune perte : il se recharge à la première connexion.
 */
export async function clearCache(): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM cache');
}

export async function writeCache(key: string, value: unknown): Promise<void> {
  const db = await getDatabase();
  // `cached_at` horodate la fraîcheur : une réécriture (réponse réseau) remet le compteur du TTL à
  // zéro. Local exprès (voir readCache) : écriture et lecture partagent la même base de temps.
  await db.runAsync(
    'INSERT INTO cache (key, value, cached_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, cached_at = excluded.cached_at',
    key,
    JSON.stringify(value),
    Date.now()
  );
}
