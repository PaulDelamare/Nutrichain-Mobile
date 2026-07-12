import { formatRelativeFr, syncedPercent } from './summary';

describe('syncedPercent', () => {
  it('renvoie 100 % quand la file est vide (rien à synchroniser)', () => {
    expect(syncedPercent({ PENDING: 0, SYNCED: 0, CONFLICT: 0, REJECTED: 0 })).toBe(100);
  });

  it('calcule la part synchronisée sur le total tracké', () => {
    // 7 synchronisées sur 10 (7 SYNCED + 2 PENDING + 1 REJECTED) → 70 %
    expect(syncedPercent({ PENDING: 2, SYNCED: 7, CONFLICT: 0, REJECTED: 1 })).toBe(70);
  });

  it('renvoie 0 % quand rien n’est encore parti', () => {
    expect(syncedPercent({ PENDING: 3, SYNCED: 0, CONFLICT: 0, REJECTED: 0 })).toBe(0);
  });
});

describe('formatRelativeFr', () => {
  const NOW = 1_000_000_000_000;

  it('affiche « à l’instant » sous la minute', () => {
    expect(formatRelativeFr(NOW - 30_000, NOW)).toBe("à l'instant");
  });

  it('affiche les minutes', () => {
    expect(formatRelativeFr(NOW - 12 * 60_000, NOW)).toBe('il y a 12 min');
  });

  it('bascule en heures puis en jours', () => {
    expect(formatRelativeFr(NOW - 3 * 3_600_000, NOW)).toBe('il y a 3 h');
    expect(formatRelativeFr(NOW - 2 * 86_400_000, NOW)).toBe('il y a 2 j');
  });

  it('renvoie une chaîne vide si l’horodatage est absent (littéraux de test)', () => {
    expect(formatRelativeFr(undefined, NOW)).toBe('');
  });
});
