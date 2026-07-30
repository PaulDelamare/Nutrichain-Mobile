import { useEffect, useSyncExternalStore } from 'react';

import {
  getAuthStatusSnapshot,
  resolveInitialAuthStatus,
  subscribeToAuthStatus,
  type AuthStatus,
} from '@/lib/api';

export type { AuthStatus };

/**
 * Le statut de session, LU sur l'état partagé — jamais recalculé ici.
 *
 * Ce hook lisait le coffre une seule fois, au montage (#105). Or `router.replace` ne remonte pas
 * la racine : après une connexion réussie, le statut restait « non authentifié » et la garde de
 * session renvoyait indéfiniment à l'écran de connexion. Le défaut était invisible avant la garde
 * de racine (#103), parce que la seule garde existante — celle de `(tabs)` — se remonte, elle, à
 * la navigation.
 *
 * `useSyncExternalStore` plutôt qu'un état local : c'est le mécanisme qu'expo-router utilise pour
 * ses propres segments, il se désabonne au démontage sans qu'on ait à y penser, et il garantit que
 * les deux gardes montées (racine et `(tabs)`) lisent EXACTEMENT le même statut au même instant —
 * deux gardes qui divergent laisseraient un écran métier monté sans session.
 */
export function useAuthStatus(): AuthStatus {
  const status = useSyncExternalStore(
    subscribeToAuthStatus,
    getAuthStatusSnapshot,
    getAuthStatusSnapshot
  );

  // Le coffre n'est lu qu'au démarrage. `resolveInitialAuthStatus` est idempotent : deux gardes
  // montées en même temps ne le déclenchent qu'une fois.
  useEffect(() => {
    void resolveInitialAuthStatus();
  }, []);

  return status;
}
