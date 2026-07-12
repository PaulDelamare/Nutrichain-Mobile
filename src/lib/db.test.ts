import * as SQLite from 'expo-sqlite';

jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn() }));

const mockedOpen = jest.mocked(SQLite.openDatabaseAsync);

function fakeDatabase() {
  return {
    execAsync: jest.fn().mockResolvedValue(undefined),
    runAsync: jest.fn().mockResolvedValue(undefined),
    getAllAsync: jest.fn().mockResolvedValue([{ name: 'user_id' }]),
  } as unknown as SQLite.SQLiteDatabase;
}

/** La connexion est mémorisée dans le module : chaque test en repart d'un état neuf. */
function freshDb(): typeof import('./db') {
  let module!: typeof import('./db');

  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    module = require('./db') as typeof import('./db');
  });

  return module;
}

describe('getDatabase', () => {
  beforeEach(() => jest.clearAllMocks());

  it('n’ouvre qu’une seule connexion, même sous appels concurrents', async () => {
    // Deux connexions ruineraient la sérialisation des transactions : une réception enregistrée
    // pendant une synchronisation pourrait être aspirée dans un rollback.
    mockedOpen.mockResolvedValue(fakeDatabase());
    const { getDatabase } = freshDb();

    const [first, second] = await Promise.all([getDatabase(), getDatabase()]);

    expect(first).toBe(second);
    expect(mockedOpen).toHaveBeenCalledTimes(1);
  });

  it('n’enferme pas l’application dans un échec passager', async () => {
    // La promesse REJETÉE était mémorisée : une base momentanément verrouillée pendant la
    // migration condamnait tous les accès suivants, et l'app restait morte jusqu'au redémarrage —
    // c'est-à-dire, sur le terrain, jusqu'à ce que l'opérateur tue l'application.
    mockedOpen.mockRejectedValueOnce(new Error('base verrouillée'));
    const { getDatabase } = freshDb();

    await expect(getDatabase()).rejects.toThrow('base verrouillée');

    mockedOpen.mockResolvedValue(fakeDatabase());
    await expect(getDatabase()).resolves.toBeDefined();
  });
});
