import { NextResponse, type NextRequest } from 'next/server';
import { homeFor, readClaims, SESSION_COOKIE } from '@/shared/auth/token';

/**
 * Route guard, before any page renders: customer pages need a CUSTOMER session,
 * staff pages a STAFF one. Doing it here (not in each page) keeps /requests/new
 * a static page. It only routes; the API still authorizes every call.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const claims = readClaims(request.cookies.get(SESSION_COOKIE)?.value);
  const to = (path: string) => NextResponse.redirect(new URL(path, request.url));

  if (pathname === '/') return to(claims ? homeFor(claims.role) : '/login');
  if (pathname === '/login') return claims ? to(homeFor(claims.role)) : NextResponse.next();

  // Route handlers (the live-updates stream): no redirects, the API decides access.
  if (pathname.startsWith('/api/')) {
    return claims ? NextResponse.next() : new NextResponse(null, { status: 401 });
  }

  if (!claims) {
    const res = to(`/login?next=${encodeURIComponent(pathname + search)}`);
    res.cookies.delete(SESSION_COOKIE); // expired or malformed
    return res;
  }
  const needed = pathname.startsWith('/staff') ? 'STAFF' : 'CUSTOMER';
  return claims.role === needed ? NextResponse.next() : to(homeFor(claims.role));
}

export const config = {
  matcher: ['/', '/login', '/requests/:path*', '/staff/:path*', '/api/:path*'],
};
