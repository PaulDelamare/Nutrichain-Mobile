import * as Network from 'expo-network';

import { syncPendingOperations } from './sync';

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
