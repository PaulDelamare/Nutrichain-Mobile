import { apiClient } from './api';

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  /** Absent de /api/me : résolu depuis les membres de l'organisation, null si inaccessible. */
  role: string | null;
  organizationId: string | null;
}

interface MeResponse {
  data: {
    user: { id: string; name: string; email: string };
    activeOrgId?: string;
  };
}

interface MembersResponse {
  data: { userId: string; role: string }[];
}

async function fetchRole(userId: string): Promise<string | null> {
  try {
    const { data } = await apiClient.get<MembersResponse>('/api/organization/members');
    return data.data.find((member) => member.userId === userId)?.role ?? null;
  } catch {
    // Le rôle est un confort d'affichage : son refus ne doit pas priver l'écran d'identité.
    return null;
  }
}

export async function fetchCurrentUser(): Promise<CurrentUser> {
  const { data } = await apiClient.get<MeResponse>('/api/me');
  const { user, activeOrgId } = data.data;

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: await fetchRole(user.id),
    organizationId: activeOrgId ?? null,
  };
}
