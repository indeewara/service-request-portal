'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { ApiError, callApi } from '@/shared/api/client';
import type { LoginResult } from '@/shared/api/types';
import { startSession } from '@/shared/auth/session';
import { canOpen, homeFor, readClaims, safeNext } from '@/shared/auth/token';

export interface LoginState {
  error?: string;
}

const loginSchema = z.object({
  email: z.string().trim().email('Enter a valid email address'),
  password: z.string().min(1, 'Enter your password').max(200),
  next: z.string().optional(),
});

export async function login(_: LoginState, form: FormData): Promise<LoginState> {
  const parsed = loginSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  let result: LoginResult;
  try {
    // Pass the browser's IP on, so the API's login rate limit counts per user, not per web server.
    const forwardedFor = (await headers()).get('x-forwarded-for');
    result = await callApi<LoginResult>('/auth/login', {
      method: 'POST',
      body: { email: parsed.data.email, password: parsed.data.password },
      headers: forwardedFor ? { 'x-forwarded-for': forwardedFor } : {},
    });
  } catch (err) {
    if (err instanceof ApiError && (err.status === 401 || err.status === 429)) {
      return { error: err.message };
    }
    return { error: 'Login is unavailable right now. Please try again.' };
  }

  const claims = readClaims(result.accessToken);
  if (!claims) return { error: 'Login failed. Please try again.' };
  await startSession(result.accessToken, claims.expiresAt);
  // Only follow ?next= to a page this role may open; otherwise go home.
  const next = safeNext(parsed.data.next);
  redirect(next && canOpen(claims.role, next) ? next : homeFor(claims.role));
}
