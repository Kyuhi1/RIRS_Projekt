import { errorMessage, getJson, postJson } from './api';

export type Role = 'trader' | 'mentor' | 'admin';
export interface User {
  id: number;
  email: string;
  name: string;
  role: Role;
}

export const ROLE_LABELS: Record<Role, string> = { trader: 'Trgovec', mentor: 'Mentor', admin: 'Administrator' };

// Prijavljenega uporabnika vrne strežnik na podlagi piškotka; brez veljavne prijave vrne null.
export async function fetchCurrentUser(): Promise<User | null> {
  try {
    const { status, data } = await getJson('/api/auth/me');
    return status === 200 ? (data as User) : null;
  } catch {
    return null;
  }
}

export type LoginResult = { user: User } | { error: string };

export async function login(email: string, password: string): Promise<LoginResult> {
  try {
    const { status, data } = await postJson('/api/auth/login', { email, password });
    if (status === 200) return { user: data as User };
    return { error: errorMessage(data, 'Prijava ni uspela, poskusite znova.') };
  } catch {
    return { error: 'Strežnik ni dosegljiv, poskusite znova.' };
  }
}

export async function logout(): Promise<void> {
  await postJson('/api/auth/logout').catch(() => undefined);
}
