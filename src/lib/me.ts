import { apiClient } from './api';

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

export async function fetchCurrentUser(): Promise<CurrentUser> {
  const { data } = await apiClient.get<MeResponse>('/api/me');
  const { user, activeOrgId, role } = data.data;

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: role ?? null,
    organizationId: activeOrgId ?? null,
  };
}
