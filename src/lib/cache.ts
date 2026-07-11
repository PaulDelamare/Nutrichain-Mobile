import { getDatabase } from './db';

export async function readCache<T>(key: string): Promise<T | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM cache WHERE key = ?',
    key
  );

  return row ? (JSON.parse(row.value) as T) : null;
}

export async function writeCache(key: string, value: unknown): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    'INSERT INTO cache (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    key,
    JSON.stringify(value)
  );
}
