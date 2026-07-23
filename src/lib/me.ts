import { apiClient } from './api';
import { readCache, writeCache } from './cache';
import { isNetworkError } from './errors';

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  /** Rôle dans l'organisation active, vocabulaire canonique de l'API (`operator`, `quality`…). */
  role: string | null;
  organizationId: string | null;
}

/**
 * ⚠️ Le rôle vient de `/api/me`, et de nulle part ailleurs.
 *
 * Il était résolu en interrogeant `GET /organization/members` — une route réservée aux `owner` et
 * `admin`. Pour un `operator`, un `quality` ou un `viewer` — c'est-à-dire **exactement les
 * utilisateurs de cette application** — la requête prenait un 403, avalé en silence, et le rôle
 * valait `null`. Il ne s'affichait donc jamais pour ceux qu'il concerne, un 403 inutile partait à
 * chaque ouverture de l'app, et aucun filtrage d'interface par rôle n'était possible.
 *
 * `/api/me` le renvoie à la racine de sa réponse, pour tout le monde, dans le bon vocabulaire.
 */
interface MeResponse {
  data: {
    user: { id: string; name: string; email: string };
    activeOrgId?: string;
    role?: string | null;
  };
}

/**
 * (issue #71) Le rôle décide désormais quels écrans d'écriture sont proposés. Il doit donc
 * survivre au hors-ligne : sans mémoire locale, il redevient inconnu dès la première chambre
 * froide, et la garde s'évapore là où l'application sert.
 *
 * ⚠️ Le repli est réservé aux pannes RÉSEAU. Sur un 401, l'erreur remonte telle quelle : rendre
 * l'utilisateur mémorisé ferait passer une session morte pour vivante. Pas de TTL non plus — un
 * rôle périmé vaut mieux qu'aucun, et `clearCache()` le purge à la déconnexion comme sur 401.
 */
const CACHE_KEY = 'me';

export async function fetchCurrentUser(): Promise<CurrentUser> {
  try {
    const { data } = await apiClient.get<MeResponse>('/api/me');
    const { user, activeOrgId, role } = data.data;

    const current: CurrentUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: role ?? null,
      organizationId: activeOrgId ?? null,
    };

    await writeCache(CACHE_KEY, current);
    return current;
  } catch (error) {
    if (isNetworkError(error)) {
      const cached = await readCache<CurrentUser>(CACHE_KEY);
      if (cached) {
        return cached;
      }
    }

    throw error;
  }
}
