import 'server-only';
import { redirect } from 'next/navigation';
import { readSession } from '@/shared/auth/session';
import type { ApiErrorBody } from './types';

// Server-side config, never in the client bundle.
const API_URL = process.env.API_URL ?? 'http://localhost:4000';

export class ApiError extends Error {
  constructor(readonly status: number, readonly body: ApiErrorBody) {
    super(body.message);
  }
}

interface CallOptions {
  method?: string;
  body?: unknown;
  token?: string;
  headers?: Record<string, string>;
}

/** One API call from the Next.js server. Throws ApiError with the API's error body. */
export async function callApi<T>(path: string, options: CallOptions = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      ...(options.body !== undefined && { 'content-type': 'application/json' }),
      ...(options.token && { authorization: `Bearer ${options.token}` }),
      ...options.headers,
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    // Private, per-user data: never cached between requests.
    cache: 'no-store',
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as Partial<ApiErrorBody>;
    throw new ApiError(res.status, {
      statusCode: res.status,
      error: body.error ?? 'Error',
      message: body.message ?? 'Something went wrong',
      details: body.details,
      correlationId: body.correlationId,
    });
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

/** Same, as the signed-in user. An expired or missing session goes back to login. */
export async function callApiAsUser<T>(path: string, options: Omit<CallOptions, 'token'> = {}) {
  const session = await readSession();
  if (!session) redirect('/login');
  try {
    return await callApi<T>(path, { ...options, token: session.token });
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect('/login?expired=1');
    throw err;
  }
}

export { API_URL };
