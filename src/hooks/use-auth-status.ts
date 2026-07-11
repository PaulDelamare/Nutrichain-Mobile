import { useEffect, useState } from 'react';

import { isAuthenticated } from '@/lib/api';

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

export function useAuthStatus(): AuthStatus {
  const [status, setStatus] = useState<AuthStatus>('loading');

  useEffect(() => {
    let mounted = true;

    // Toute erreur imprévue doit mener à l'écran de connexion, jamais laisser le statut
    // bloqué sur 'loading' : l'app resterait figée sur son spinner.
    isAuthenticated()
      .catch(() => false)
      .then((authenticated) => {
        if (mounted) {
          setStatus(authenticated ? 'authenticated' : 'unauthenticated');
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  return status;
}
