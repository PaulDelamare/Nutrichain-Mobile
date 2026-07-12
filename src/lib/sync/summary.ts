import type { OperationStatus } from './types';

/**
 * Part des opérations déjà synchronisées, en pourcentage (0–100). File vide → 100 %
 * (« à jour »). Sert l'anneau de progression de l'écran de synchronisation.
 */
export function syncedPercent(counts: Record<OperationStatus, number>): number {
  const total = counts.PENDING + counts.SYNCED + counts.CONFLICT + counts.REJECTED;
  if (total === 0) return 100;
  return Math.round((counts.SYNCED / total) * 100);
}

/**
 * Âge relatif « il y a … » en français, à partir d'un epoch ms. Volontairement grossier
 * (minute / heure / jour) : l'opérateur veut savoir si un scan traîne, pas la seconde près.
 * `createdAt` peut être absent (littéraux de test) → chaîne vide, l'UI n'affiche rien.
 */
export function formatRelativeFr(fromMs: number | undefined, nowMs: number): string {
  if (fromMs == null) return '';
  const diffSec = Math.max(0, Math.floor((nowMs - fromMs) / 1000));

  if (diffSec < 60) return "à l'instant";

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `il y a ${diffMin} min`;

  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `il y a ${diffH} h`;

  const diffJ = Math.floor(diffH / 24);
  return `il y a ${diffJ} j`;
}
