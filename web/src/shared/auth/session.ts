import 'server-only';
import { cookies } from 'next/headers';
import { readClaims, SESSION_COOKIE, type SessionClaims } from './token';

export async function readSession(): Promise<(SessionClaims & { token: string }) | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const claims = readClaims(token);
  return claims && token ? { ...claims, token } : null;
}

export async function startSession(token: string, expiresAt: number) {
  (await cookies()).set(SESSION_COOKIE, token, {
    // Not readable by JavaScript, so an XSS bug can't steal the token.
    httpOnly: true,
    // HTTPS only. Browsers treat http://localhost as secure, so local runs still work.
    secure: true,
    // Not sent on cross-site POSTs (part of the CSRF protection, see README).
    sameSite: 'lax',
    path: '/',
    expires: new Date(expiresAt),
  });
}

export async function endSession() {
  (await cookies()).delete(SESSION_COOKIE);
}
