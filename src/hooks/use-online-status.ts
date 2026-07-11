import * as Network from 'expo-network';
import { useEffect, useState } from 'react';

/**
 * État réseau réel. L'accueil affichait « En ligne » en dur : sur une application dont
 * l'intérêt est justement de fonctionner hors réseau, afficher un état faux est le pire
 * des mensonges — l'opérateur croit ses scans partis alors qu'ils dorment en file.
 */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    let mounted = true;

    Network.getNetworkStateAsync()
      .then((state) => {
        if (mounted) setOnline(state.isInternetReachable === true);
      })
      .catch(() => undefined);

    const subscription = Network.addNetworkStateListener(({ isInternetReachable }) => {
      if (mounted) setOnline(isInternetReachable === true);
    });

    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  return online;
}
