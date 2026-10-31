import { cookies } from 'next/headers';
import { SESSION_COOKIE } from '@/shared/auth/token';
import { API_URL } from '@/shared/api/client';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Live-updates stream for the browser. EventSource can't send an
 * Authorization header, so this route reads the httpOnly cookie and forwards
 * the API's stream with the token. The API checks access to this request.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return new Response(null, { status: 401 });
  if (!UUID.test(id)) return new Response(null, { status: 404 });

  const upstream = await fetch(`${API_URL}/requests/${id}/events`, {
    headers: { authorization: `Bearer ${token}`, accept: 'text/event-stream' },
    signal: request.signal, // browser leaves → close the API connection too
    cache: 'no-store',
  });
  if (!upstream.ok || !upstream.body) return new Response(null, { status: upstream.status });

  return new Response(upstream.body, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no', // don't let proxies buffer the stream
    },
  });
}
