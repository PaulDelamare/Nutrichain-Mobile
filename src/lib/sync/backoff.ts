/** 30 s → 1 min → 5 min → 15 min → 30 min (plafond), conformément à docs/14_sync_mobile_offline.md. */
const RETRY_DELAYS_MS = [30_000, 60_000, 300_000, 900_000, 1_800_000];

/**
 * Le plafond du backoff. Aucune date de nouvelle tentative légitime ne le dépasse : au-delà, elle a
 * été écrite par une horloge déréglée, et la lecture de la file la traite comme échue.
 */
export const MAX_RETRY_DELAY_MS = RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];

/**
 * Le plafond, plutôt qu'un abandon : une panne serveur ne doit jamais faire perdre un scan,
 * et un entrepôt entier qui reconnecte ne doit pas marteler l'API.
 */
export function retryDelayMs(attempts: number): number {
  const index = Math.min(Math.max(attempts, 1), RETRY_DELAYS_MS.length) - 1;
  return RETRY_DELAYS_MS[index];
}
