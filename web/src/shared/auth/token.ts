import type { Role } from '@/shared/api/types';

export const SESSION_COOKIE = 'session';

export interface SessionClaims {
  userId: string;
  role: Role;
  expiresAt: number;
}

/**
 * Reads the JWT's claims without verifying the signature. Only used to route
 * the user (which pages to show); the API verifies the token on every call.
 */
export function readClaims(token: string | undefined): SessionClaims | null {
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (typeof payload.sub !== 'string' || typeof payload.exp !== 'number') return null;
    if (payload.role !== 'CUSTOMER' && payload.role !== 'STAFF') return null;
    if (payload.exp * 1000 <= Date.now()) return null;
    return { userId: payload.sub, role: payload.role, expiresAt: payload.exp * 1000 };
  } catch {
    return null;
  }
}

export const homeFor = (role: Role) => (role === 'STAFF' ? '/staff' : '/requests');
