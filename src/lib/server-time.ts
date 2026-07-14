import { readCache, writeCache } from './cache';

/**
 * L'heure, telle que le SERVEUR la connaît.
 *
 * ⚠️ L'application datait tout sur `Date.now()` — l'horloge du téléphone, que l'opérateur peut
 * régler à la main et que le système resynchronise sans prévenir. Trois conséquences, la dernière
 * étant sanitaire :
 *
 * - une horloge qui avance puis revient écrit un `next_attempt_at` dans un futur lointain : le scan
 *   reste « en attente » À VIE, jamais renvoyé, pendant que l'écran promet qu'il partira ;
 * - une horloge en retard au scan, corrigée ensuite, fait basculer en conflit des scans vieux de
 *   deux minutes, avec le motif « en attente depuis plus de 7 jours » — et efface leur historique ;
 * - une horloge reculée de deux mois fait **accepter un lot périmé** en transformation et en
 *   expédition. La garde sanitaire de péremption était celle du téléphone.
 *
 * Chaque réponse HTTP porte un en-tête `Date` : c'est l'heure du serveur, gratuite, et hors de
 * portée de l'appareil. On en mémorise l'ÉCART avec l'horloge locale — pas l'heure elle-même, qui
 * serait périmée à la seconde suivante. L'écart, lui, reste valable tant que l'horloge ne bouge pas,
 * et il survit hors ligne : c'est ce qui permet de continuer à trancher une péremption dans une
 * chambre froide sans réseau.
 */
const OFFSET_KEY = 'server_time_offset';

/**
 * Un écart de plus d'un an ne se corrige pas : il trahit une horloge (ou un en-tête) aberrante.
 * L'accepter reviendrait à remplacer un mensonge par un autre.
 */
const MAX_PLAUSIBLE_OFFSET_MS = 365 * 24 * 60 * 60 * 1000;

let offsetMs: number | null = null;

/** Ce qu'on peut honnêtement dire de l'heure. `unknown` n'est PAS « maintenant ». */
export type ServerNow = { kind: 'ok'; now: number } | { kind: 'unknown' };

/** À rappeler au démarrage : sans ça, l'écart appris la veille serait perdu à chaque lancement. */
export async function loadServerTimeOffset(): Promise<void> {
  const stored = await readCache<number>(OFFSET_KEY);
  if (typeof stored === 'number' && Number.isFinite(stored)) {
    offsetMs = stored;
  }
}

/**
 * Apprend l'écart depuis l'en-tête `Date` d'une réponse. Appelé sur CHAQUE réponse — y compris les
 * erreurs : un 401 date le serveur aussi bien qu'un 200.
 */
export async function rememberServerTime(dateHeader: unknown): Promise<void> {
  if (typeof dateHeader !== 'string') return;

  const serverMs = Date.parse(dateHeader);
  if (!Number.isFinite(serverMs)) return;

  const candidate = serverMs - Date.now();
  if (Math.abs(candidate) > MAX_PLAUSIBLE_OFFSET_MS) return;

  offsetMs = candidate;
  await writeCache(OFFSET_KEY, candidate);
}

/**
 * L'heure de référence — ou l'aveu qu'on ne l'a pas.
 *
 * Tant que le serveur n'a jamais répondu, on ne SAIT PAS quelle heure il est. Retomber sur
 * `Date.now()` « en attendant » rendrait la garde de péremption exactement aussi fausse qu'avant,
 * en silence. L'appelant doit traiter `unknown` — et le dire.
 */
export function serverNow(): ServerNow {
  if (offsetMs === null) return { kind: 'unknown' };
  return { kind: 'ok', now: Date.now() + offsetMs };
}

/** Uniquement pour les tests : repartir d'une application qui n'a jamais vu le serveur. */
export function _resetServerTimeForTests(): void {
  offsetMs = null;
}
