import { Platform } from 'react-native';

import { withTransaction, type Transactable } from './db';

/**
 * Le web n'a PAS de transaction exclusive : expo-sqlite jette
 * « withExclusiveTransactionAsync is not supported on web ».
 *
 * Ce double le reproduit fidèlement. C'est tout l'objet de ce fichier : les tests de la file
 * fournissaient jusqu'ici un `withExclusiveTransactionAsync` opérationnel — une API que la
 * plateforme ne fournit pas — et validaient donc un monde imaginaire, pendant qu'en vrai aucun
 * statut n'était persisté et que chaque scan repartait indéfiniment.
 */
function fakeDatabase() {
  const appels: string[] = [];

  const database: Transactable = {
    getFirstAsync: async () => null,
    runAsync: async () => ({ changes: 1 }),
    withExclusiveTransactionAsync: async (run) => {
      appels.push('exclusive');

      if (Platform.OS === 'web') {
        throw new Error('withExclusiveTransactionAsync is not supported on web');
      }

      await run(database);
    },
    withTransactionAsync: async (run) => {
      appels.push('ordinaire');
      await run();
    },
  };

  return { database, appels };
}

describe('withTransaction', () => {
  const platform = Platform.OS;

  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { value: platform, configurable: true });
  });

  function surPlateforme(os: string) {
    Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
  }

  it('écrit sur le web, où la transaction exclusive n’existe pas', async () => {
    surPlateforme('web');
    const { database, appels } = fakeDatabase();
    let ecrit = false;

    await withTransaction(database, async () => {
      ecrit = true;
    });

    // Le corps s'exécute : c'est lui qui persiste le verdict de la synchronisation.
    expect(ecrit).toBe(true);
    // Et surtout : on n'a même pas TENTÉ l'exclusive, qui aurait jeté.
    expect(appels).toEqual(['ordinaire']);
  });

  it('garde la transaction exclusive sur mobile, où l’isolation est en jeu', async () => {
    surPlateforme('android');
    const { database, appels } = fakeDatabase();
    let ecrit = false;

    await withTransaction(database, async () => {
      ecrit = true;
    });

    expect(ecrit).toBe(true);
    // Une réception saisie pendant la synchro ne doit pas être aspirée dans sa transaction.
    expect(appels).toEqual(['exclusive']);
  });

  it('laisse remonter l’échec du corps, au lieu de commiter un verdict faux', async () => {
    surPlateforme('web');
    const { database } = fakeDatabase();

    await expect(
      withTransaction(database, async () => {
        throw new Error('base pleine');
      })
    ).rejects.toThrow('base pleine');
  });
});
