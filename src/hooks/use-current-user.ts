import { useEffect, useState } from 'react';

import { fetchCurrentUser, type CurrentUser } from '@/lib/me';

interface CurrentUserState {
  user: CurrentUser | null;
  loading: boolean;
}

export function useCurrentUser(): CurrentUserState {
  const [state, setState] = useState<CurrentUserState>({ user: null, loading: true });

  useEffect(() => {
    let mounted = true;

    fetchCurrentUser()
      // Un 401 est déjà traité par l'intercepteur (purge + retour à la connexion) :
      // ici on cesse simplement de charger, sans masquer l'écran derrière une erreur.
      .catch(() => null)
      .then((user) => {
        if (mounted) {
          setState({ user, loading: false });
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  return state;
}
