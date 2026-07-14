import * as Network from 'expo-network';

import { loadServerTimeOffset, serverNow } from '../server-time';
import { toastError } from '../toast';
import { flagStalePending, purgeSyncedBefore } from './queue';
import { syncPendingOperations } from './sync';

/** TTL des clés d'idempotence de l'API : au-delà, un rejeu n'y serait plus reconnu. */
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

const STALE_MESSAGE =
  'En attente depuis plus de 7 jours : à vérifier côté serveur avant tout renvoi.';

let online = false;

function trigger(): void {
  // Fire-and-forget : l'écran appelant n'attend pas, et une sync ratée sera relancée au prochain
  // retour du réseau ou à l'ouverture de l'onglet Sync.
  //
  // ⚠️ Mais une PANNE n'est pas un échec ordinaire. `.catch(() => undefined)` avalait aussi bien la
  // base illisible que le verdict serveur inconnu (`outcome.ts` jette volontairement) : le jour où
  // l'API ajoute un verdict, le mobile cesserait de synchroniser POUR TOUJOURS, sans un mot. Une
  // erreur réseau, elle, est normale hors ligne : elle est déjà traitée dans `syncPendingOperations`
  // (mise en attente de nouvelle tentative) et ne remonte pas jusqu'ici.
  syncPendingOperations().catch((error: unknown) => {
    toastError('Synchronisation automatique interrompue', error);
  });
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
  // L'écart appris la veille : sans lui, chaque lancement repartirait sans heure de référence.
  await loadServerTimeOffset().catch(() => undefined);

  // ⚠️ Ces deux opérations CONDAMNENT et EFFACENT des scans sur la foi d'une date. Les dater sur
  // l'horloge du téléphone était un piège : un appareil déchargé démarre en retard, se resynchronise
  // ensuite — et au lancement suivant, des scans vieux de deux minutes basculaient en conflit avec
  // le motif « en attente depuis plus de 7 jours », leur historique effacé au passage.
  //
  // Sans heure de référence, on ne fait RIEN. Un scan gardé un jour de trop est réparable ; un scan
  // condamné à tort ne l'est pas.
  const reference = serverNow();
  if (reference.kind === 'ok') {
    const cutoff = reference.now - RETENTION_MS;

    // L'historique synchronisé n'a plus d'utilité, et la file ne doit pas grossir sans fin.
    purgeSyncedBefore(cutoff).catch(() => undefined);

    // AVANT toute synchronisation : une opération dont la clé d'idempotence a expiré côté
    // serveur ne peut plus être rejouée sans risque de doublon. On la signale, on ne parie pas.
    await flagStalePending(cutoff, STALE_MESSAGE).catch(() => undefined);
  }

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
