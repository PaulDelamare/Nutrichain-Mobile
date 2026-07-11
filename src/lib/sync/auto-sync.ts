import * as Network from 'expo-network';

import { flagStalePending, purgeSyncedBefore } from './queue';
import { syncPendingOperations } from './sync';

/** TTL des clés d'idempotence de l'API : au-delà, un rejeu n'y serait plus reconnu. */
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

const STALE_MESSAGE =
  'En attente depuis plus de 7 jours : à vérifier côté serveur avant tout renvoi.';

let online = false;

function trigger(): void {
  // Fire-and-forget : l'écran appelant n'attend pas, et une sync ratée sera
  // relancée au prochain retour du réseau ou à l'ouverture de l'onglet Sync.
  syncPendingOperations().catch(() => undefined);
}

/**
 * Déclencheur de la synchronisation différée : sans lui, les opérations enregistrées
 * hors réseau attendraient un appui manuel sur « Synchroniser », et la promesse faite
 * à l'opérateur (« synchronisée dès que le réseau reviendra ») serait fausse.
 *
 * On ne réagit qu'aux TRANSITIONS vers l'état joignable : les plateformes réémettent
 * l'état courant sans changement, et relancer à chaque notification martèlerait l'API.
 */
export async function startAutoSync(): Promise<() => void> {
  const cutoff = Date.now() - RETENTION_MS;

  // L'historique synchronisé n'a plus d'utilité, et la file ne doit pas grossir sans fin.
  purgeSyncedBefore(cutoff).catch(() => undefined);

  // AVANT toute synchronisation : une opération dont la clé d'idempotence a expiré côté
  // serveur ne peut plus être rejouée sans risque de doublon. On la signale, on ne parie pas.
  await flagStalePending(cutoff, STALE_MESSAGE).catch(() => undefined);

  const state = await Network.getNetworkStateAsync();
  online = state.isInternetReachable === true;

  if (online) {
    trigger();
  }

  const subscription = Network.addNetworkStateListener(({ isInternetReachable }) => {
    const reachable = isInternetReachable === true;
    const wasOffline = !online;
    online = reachable;

    if (reachable && wasOffline) {
      trigger();
    }
  });

  return () => subscription.remove();
}
