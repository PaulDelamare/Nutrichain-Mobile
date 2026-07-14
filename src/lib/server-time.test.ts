import { readCache, writeCache } from './cache';
import {
  _resetServerTimeForTests,
  loadServerTimeOffset,
  rememberServerTime,
  serverNow,
} from './server-time';

jest.mock('./cache');

const mockedRead = jest.mocked(readCache);
const mockedWrite = jest.mocked(writeCache);

beforeEach(() => {
  jest.clearAllMocks();
  _resetServerTimeForTests();
  mockedWrite.mockResolvedValue(undefined);
  mockedRead.mockResolvedValue(null);
});

describe('serverNow', () => {
  it('AVOUE ne pas connaître l’heure tant que le serveur n’a jamais répondu', () => {
    // Retomber sur `Date.now()` « en attendant » rendrait la garde de péremption exactement aussi
    // fausse qu'avant, mais en silence. `unknown` n'est PAS « maintenant ».
    expect(serverNow()).toEqual({ kind: 'unknown' });
  });

  it('donne l’heure du SERVEUR, même si le téléphone est deux mois en retard', async () => {
    const vraieHeure = Date.now() + 60 * 24 * 60 * 60 * 1000;
    await rememberServerTime(new Date(vraieHeure).toUTCString());

    const now = serverNow();

    expect(now.kind).toBe('ok');
    // L'en-tête `Date` a une précision à la seconde : on tolère l'arrondi, pas les deux mois.
    if (now.kind === 'ok') expect(Math.abs(now.now - vraieHeure)).toBeLessThan(2_000);
  });

  it('mémorise l’ÉCART, pas l’heure : elle continue d’avancer', async () => {
    // Stocker l'heure elle-même la figerait à l'instant de la dernière réponse — et un lot périmé
    // depuis serait encore jugé « bon » des heures plus tard.
    await rememberServerTime(new Date().toUTCString());

    expect(mockedWrite).toHaveBeenCalledWith('server_time_offset', expect.any(Number));
  });

  it('survit au redémarrage : l’écart appris la veille est rechargé', async () => {
    // Sans ça, chaque lancement repartirait sans heure de référence — et hors ligne, l'application
    // ne pourrait plus jamais trancher une péremption.
    const ecart = 90_000;
    mockedRead.mockResolvedValue(ecart as never);

    await loadServerTimeOffset();
    const now = serverNow();

    expect(now.kind).toBe('ok');
    if (now.kind === 'ok') expect(now.now).toBeGreaterThan(Date.now() + ecart - 1_000);
  });

  it('REFUSE un en-tête aberrant : remplacer un mensonge par un autre n’aide personne', async () => {
    await rememberServerTime(new Date(Date.now() + 5 * 365 * 24 * 60 * 60 * 1000).toUTCString());

    expect(serverNow()).toEqual({ kind: 'unknown' });
    expect(mockedWrite).not.toHaveBeenCalled();
  });

  it('ignore un en-tête absent ou illisible', async () => {
    await rememberServerTime(undefined);
    await rememberServerTime('pas une date');

    expect(serverNow()).toEqual({ kind: 'unknown' });
  });
});
