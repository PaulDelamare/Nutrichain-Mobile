import { useEffect, useState } from 'react';

import { isAuthenticated } from '@/lib/api';

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

export function useAuthStatus(): AuthStatus {
  const [status, setStatus] = useState<AuthStatus>('loading');

  useEffect(() => {
    let mounted = true;

    isAuthenticated().then((authenticated) => {
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
