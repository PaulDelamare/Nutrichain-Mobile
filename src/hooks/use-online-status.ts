import * as Network from 'expo-network';
import { useEffect, useState } from 'react';

import { apiClient } from '@/lib/api';

/**
 * Ce que l'application peut honnêtement dire de sa connectivité.
 *
 * ⚠️ `expo-network` s'appuie sur `navigator.onLine` **sur le web** — qui vaut `true` dès qu'une
 * interface réseau est associée, y compris sur un Wi-Fi sans Internet, derrière un portail captif ou
 * face à une API éteinte. Le badge annonçait donc « En ligne » à un opérateur dont RIEN ne partait.
 * Et la démo se fait dans un navigateur.
 *
 * La question qui compte pour cette application n'est pas « ai-je du réseau ? » mais
 * **« le serveur me répond-il ? »**. On la pose donc au serveur, au lieu de la déduire.
 *
 * Le troisième état n'est pas un luxe : au démarrage, on ne sait pas ENCORE. Afficher « En ligne »
 * par défaut — ce que faisait ce hook — c'est affirmer précisément ce qu'on ignore.
 */
export type OnlineStatus = 'online' | 'offline' | 'checking';

/** Le serveur est injoignable bien avant les 30 s du client HTTP : l'opérateur n'attend pas. */
const PROBE_TIMEOUT_MS = 5_000;

/** Route publique : elle ne dit rien d'autre que « je réponds ». */
const PROBE_URL = '/api/health';

export function useOnlineStatus(): OnlineStatus {
  const [status, setStatus] = useState<OnlineStatus>('checking');

  useEffect(() => {
    let alive = true;

    async function probe(): Promise<void> {
      try {
        await apiClient.get(PROBE_URL, { timeout: PROBE_TIMEOUT_MS });
        if (alive) setStatus('online');
      } catch {
        // Réseau coupé, DNS mort, portail captif, serveur éteint : pour l'opérateur, c'est la même
        // chose — ses scans ne partiront pas.
        if (alive) setStatus('offline');
      }
    }

    void probe();

    // L'état de l'interface reste un bon DÉCLENCHEUR — il change quand on entre ou sort d'une zone
    // couverte. Il ne fait simplement pas foi : on s'en sert pour re-poser la question au serveur.
    const subscription = Network.addNetworkStateListener(() => {
      void probe();
    });

    return () => {
      alive = false;
      subscription.remove();
    };
  }, []);

  return status;
}
