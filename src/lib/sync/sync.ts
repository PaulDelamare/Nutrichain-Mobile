import { apiClient } from '../api';
import { ApiError } from '../errors';
import { getToken, getUserId } from '../session';
import { rejectOutcome, resolveOutcome, retryOutcome } from './outcome';
import { getPendingOperations, resetBackoff, saveOperationUpdates } from './queue';
import type { OperationUpdate, QueuedOperation, SyncItemResult } from './types';

/**
 * L'API marque d'un champ `auth` tout refus qui vise l'APPELANT — rôle insuffisant, accès révoqué,
 * session sans organisation active — par opposition aux refus qui visent le CONTENU du scan.
 *
 * La distinction est vitale ici : un refus de contenu se règle en isolant le scan fautif (on
 * découpe le lot) ; un refus d'appelant frappe identiquement tout ce que cet opérateur enverra.
 * Le découper reviendrait à condamner un à un des scans parfaitement valides.
 */
const CALLER_ERROR_FIELD = 'auth';

/** Le rôle n'autorise pas l'écriture : c'est le seul refus d'appelant qu'un rejeu ne lèvera jamais. */
const PERMANENT_REFUSAL_STATUS = 403;

/** L'API refuse au-delà de 100 items (garde anti-DoS et SLA de latence). */
export const MAX_BATCH_SIZE = 100;

/** Garde-fou de terminaison : 100 lots de 100 scans, largement au-delà d'une journée de terrain. */
const MAX_ROUNDS = 100;

/** Deux envois simultanés du même lot doubleraient le trafic sans rien gagner. */
let running = false;

export interface SyncSummary {
  sent: number;
  synced: number;
  conflicts: number;
  rejected: number;
  retried: number;
}

interface SyncResponse {
  data: { results: SyncItemResult[] };
}

function summarize(updates: OperationUpdate[]): SyncSummary {
  return {
    sent: updates.length,
    synced: updates.filter((u) => u.status === 'SYNCED').length,
    conflicts: updates.filter((u) => u.status === 'CONFLICT').length,
    rejected: updates.filter((u) => u.status === 'REJECTED').length,
    retried: updates.filter((u) => u.status === 'PENDING').length,
  };
}

/**
 * L'opérateur a changé entre la lecture de la file et l'émission. On abandonne le lot : le rejouer
 * sous le jeton du nouveau venu graverait les scans de l'ancien à son nom.
 */
class OwnerChanged extends Error {}

/**
 * Le serveur a refusé l'opérateur lui-même. Poursuivre avec les lots suivants prendrait le même
 * verdict, cent scans à la fois : la synchronisation entière s'arrête, en remontant le sort déjà
 * appliqué aux opérations parties.
 */
class CallerRefused extends Error {
  constructor(readonly summary: SyncSummary) {
    super('Synchronisation refusée pour cet opérateur');
  }
}

/** L'opérateur épinglé pour toute la durée d'une synchronisation : son identité ET son jeton. */
interface Owner {
  userId: string;
  token: string;
}

/**
 * L'identité est ré-assertée juste avant chaque requête, et le jeton est posé EXPLICITEMENT.
 *
 * Sinon la file est lue avec l'identité de l'opérateur, tandis que le jeton est attaché par
 * l'intercepteur au moment de l'émission : deux lectures distinctes de la session, jamais
 * réconciliées. Entre elles, une déconnexion suivie d'une connexion suffisait à faire partir les
 * scans de A avec le jeton de B — et un lot refusé en 400 est redécoupé en plusieurs requêtes
 * successives, ce qui élargissait la fenêtre à plusieurs secondes.
 *
 * En posant le jeton nous-mêmes, la valeur vérifiée et la valeur envoyée sont la MÊME.
 */
async function postBatch(
  operations: QueuedOperation[],
  owner: Owner
): Promise<SyncItemResult[]> {
  if ((await getUserId()) !== owner.userId) {
    throw new OwnerChanged();
  }

  const { data } = await apiClient.post<SyncResponse>(
    '/api/sync/scans',
    { items: operations.map(({ clientOpId, type, payload }) => ({ clientOpId, type, payload })) },
    { headers: { Authorization: `Bearer ${owner.token}` } }
  );

  return data.data.results;
}

function add(total: SyncSummary, batch: SyncSummary): SyncSummary {
  return {
    sent: total.sent + batch.sent,
    synced: total.synced + batch.synced,
    conflicts: total.conflicts + batch.conflicts,
    rejected: total.rejected + batch.rejected,
    retried: total.retried + batch.retried,
  };
}

async function syncBatch(
  operations: QueuedOperation[],
  now: number,
  owner: Owner
): Promise<SyncSummary> {
  let results: SyncItemResult[];

  try {
    results = await postBatch(operations, owner);
  } catch (error) {
    // Plus personne, ou quelqu'un d'autre : on ne touche à rien. Les scans restent en attente,
    // propriété de leur auteur, et repartiront quand il se reconnectera.
    if (error instanceof OwnerChanged) {
      return summarize([]);
    }

    // Le refus vise l'opérateur, pas ses scans. Il est donc tranché AVANT le découpage du 400 :
    // l'API refuse une session sans organisation active avec un 400 elle aussi, et le découpage
    // aurait rejeté définitivement, un par un, des scans terrain que personne ne peut ressaisir —
    // pour une panne de session qu'une simple reconnexion répare.
    //
    // Un rôle sans droit d'écriture (403), lui, ne cédera jamais : laisser ces scans « En attente »
    // les rendrait éternellement inertes — ni synchronisables, ni supprimables, ni remédiables —
    // pendant que l'écran promet qu'ils partiront. REJECTED les rend enfin actionnables.
    if (error instanceof ApiError && error.field === CALLER_ERROR_FIELD) {
      const permanent = error.status === PERMANENT_REFUSAL_STATUS;
      const updates = operations.map((operation) =>
        permanent
          ? rejectOutcome(operation, error.message)
          : retryOutcome(operation, now, error.message)
      );

      await saveOperationUpdates(updates);
      throw new CallerRefused(summarize(updates));
    }

    // La validation du serveur est fail-fast sur le lot entier : un seul item malformé
    // le fait refuser en bloc (400), sans réponse 207. Le réessayer indéfiniment gèlerait
    // la file pour toujours — on scinde donc le lot jusqu'à isoler le coupable, ce qui
    // laisse passer les scans valides au lieu de tous les sacrifier.
    if (error instanceof ApiError && error.status === 400) {
      if (operations.length === 1) {
        const update = rejectOutcome(operations[0], error.message);
        await saveOperationUpdates([update]);
        return summarize([update]);
      }

      const middle = Math.floor(operations.length / 2);
      const first = await syncBatch(operations.slice(0, middle), now, owner);

      try {
        const second = await syncBatch(operations.slice(middle), now, owner);
        return add(first, second);
      } catch (refusal) {
        // Un refus dans la seconde moitié interrompt tout — mais la première est DÉJÀ partie, et
        // synchronisée en base. Laisser l'exception filer telle quelle la ferait disparaître du
        // résumé : l'écran annoncerait « 1 bloquée » sans dire que les autres sont passées, et
        // c'est sur ce chiffre que l'opérateur décide de laisser repartir le camion.
        if (refusal instanceof CallerRefused) {
          throw new CallerRefused(add(first, refusal.summary));
        }

        throw refusal;
      }
    }

    // Réseau coupé, 5xx, session refusée : rien n'est perdu, tout est replanifié avec
    // un délai — sinon un entrepôt qui reconnecte martèlerait l'API.
    results = [];
  }

  const byOpId = new Map(results.map((result) => [result.clientOpId, result]));
  const updates = operations.map((operation) =>
    resolveOutcome(operation, byOpId.get(operation.clientOpId), now)
  );

  await saveOperationUpdates(updates);

  return summarize(updates);
}

/**
 * Vide la file locale vers l'API, lot après lot. Les identifiants d'opération sont réémis
 * tels quels : c'est l'idempotence côté serveur qui garantit qu'un rejeu ne crée pas de doublon.
 *
 * Un verrou global empêche deux synchronisations concurrentes (bouton pressé deux fois,
 * retour du réseau pendant une sync manuelle) d'envoyer le même lot en double.
 */
export interface SyncOptions {
  /**
   * L'opérateur a appuyé lui-même sur « Synchroniser ». On efface alors le délai d'attente du
   * backoff : sans ça, un scan repoussé à +30 min n'était PAS renvoyé, et aucun appui humain ne
   * pouvait le débloquer. Le backoff protège l'API des relances automatiques, pas des gens.
   */
  manual?: boolean;
}

export async function syncPendingOperations(options: SyncOptions = {}): Promise<SyncSummary> {
  if (running) {
    return summarize([]);
  }
  running = true;

  try {
    if (options.manual) {
      await resetBackoff();
    }

    let total = summarize([]);

    // L'opérateur est épinglé pour toute la durée de la synchronisation : c'est LUI dont les scans
    // partent, et c'est SON jeton qui doit les porter. Sans propriétaire, il n'y a rien à envoyer.
    const userId = await getUserId();
    const token = await getToken();

    if (!userId || !token) {
      return total;
    }

    const owner: Owner = { userId, token };

    // Boucle : une file de 250 scans ne doit pas exiger trois appuis sur « Synchroniser ».
    // Les opérations replanifiées (backoff) sortent du lot suivant, ce qui borne la boucle.
    //
    // Le compteur de tours n'est pas une coquetterie : la sortie de boucle repose entièrement sur
    // le fait que chaque tour change le statut des opérations. Si une régression future le rompt,
    // la boucle ne rougit pas — elle FIGE l'application (et la CI). Une borne, et le pire cas
    // devient une synchronisation incomplète, pas un gel.
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const now = Date.now();
      const operations = await getPendingOperations(now, MAX_BATCH_SIZE);

      if (operations.length === 0) {
        return total;
      }

      let batch: SyncSummary;

      try {
        batch = await syncBatch(operations, now, owner);
      } catch (error) {
        // Le serveur a refusé l'opérateur : les lots suivants essuieraient le même verdict.
        if (error instanceof CallerRefused) {
          return add(total, error.summary);
        }

        throw error;
      }

      total = add(total, batch);

      // Rien n'est passé : réseau coupé ou serveur en vrac. Insister martèlerait l'API.
      if (batch.retried === batch.sent) {
        return total;
      }
    }

    return total;
  } finally {
    running = false;
  }
}
