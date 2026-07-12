import { getDatabase } from './db';

export async function readCache<T>(key: string): Promise<T | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM cache WHERE key = ?',
    key
  );

  return row ? (JSON.parse(row.value) as T) : null;
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
  await db.runAsync(
    'INSERT INTO cache (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    key,
    JSON.stringify(value)
  );
}
