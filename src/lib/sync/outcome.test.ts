import { retryDelayMs } from './backoff';
import { resolveOutcome } from './outcome';
import type { QueuedOperation, SyncItemResult } from './types';

const NOW = 1_800_000_000_000;

function operation(overrides: Partial<QueuedOperation> = {}): QueuedOperation {
  return {
    clientOpId: 'op-1',
    type: 'receipt',
    payload: {
      id_fournisseur: 'f-1',
      shipment_id: 'SHIP-001',
      id_produit: 'p-1',
      quantite_actuelle: 12,
      unite_code: 'KG',
      statut_controle: 'OK',
    },
    status: 'PENDING',
    attempts: 0,
    ...overrides,
  };
}

function result(overrides: Partial<SyncItemResult> = {}): SyncItemResult {
  return { clientOpId: 'op-1', status: 'ok', ...overrides };
}

describe('resolveOutcome', () => {
  it('marque l’opération synchronisée et retient l’identifiant serveur', () => {
    const update = resolveOutcome(
      operation(),
      result({ status: 'ok', serverId: { receiptId: 'r-1', batchId: 'b-1' } }),
      NOW
    );

    expect(update.status).toBe('SYNCED');
    expect(update.serverId).toContain('r-1');
  });

  it('signale un conflit d’idempotence sans le rejouer', () => {
    // Même clientOpId, payload divergent : rejouer masquerait une corruption du client.
    const update = resolveOutcome(
      operation(),
      result({
        status: 'conflict',
        error: { field: 'clientOpId', message: 'Idempotency conflict — payload diverged' },
      }),
      NOW
    );

    expect(update.status).toBe('CONFLICT');
    expect(update.error).toContain('Idempotency conflict');
  });

  it('rejette définitivement une erreur métier', () => {
    // Un fournisseur inexistant ne le deviendra pas : réessayer est une boucle infinie.
    const update = resolveOutcome(
      operation(),
      result({ status: 'error', error: { field: 'id_fournisseur', message: 'Introuvable' } }),
      NOW
    );

    expect(update.status).toBe('REJECTED');
    expect(update.error).toContain('Introuvable');
  });

  it('réessaie une erreur serveur transitoire, avec un délai croissant', () => {
    const update = resolveOutcome(
      operation({ attempts: 1 }),
      result({ status: 'error', error: { field: 'internal', message: 'Erreur serveur' } }),
      NOW
    );

    expect(update.status).toBe('PENDING');
    expect(update.attempts).toBe(2);
    expect(update.nextAttemptAt).toBe(NOW + retryDelayMs(2));
  });

  it('réessaie une opération dont le serveur n’a rien dit', () => {
    // Réponse tronquée : la perdre ou la considérer envoyée serait pire que la rejouer
    // (l'idempotence côté API garantit qu'un rejeu ne crée pas de doublon).
    const update = resolveOutcome(operation(), undefined, NOW);

    expect(update.status).toBe('PENDING');
    expect(update.attempts).toBe(1);
  });
});

describe('retryDelayMs', () => {
  it('croît avec le nombre de tentatives', () => {
    expect(retryDelayMs(1)).toBe(30_000);
    expect(retryDelayMs(2)).toBe(60_000);
    expect(retryDelayMs(3)).toBe(300_000);
  });

  it('plafonne pour ne jamais abandonner ni marteler le serveur', () => {
    expect(retryDelayMs(99)).toBe(1_800_000);
  });
});
