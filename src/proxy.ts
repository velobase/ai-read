import { NextResponse, type NextRequest } from 'next/server';

export function proxy(request: NextRequest) {
  const port = process.env.PORT || '4173';
  const authority = request.headers.get('host');
  const configured = process.env.APP_ORIGIN ? new URL(process.env.APP_ORIGIN) : null;
  const localHosts = [`127.0.0.1:${port}`, `localhost:${port}`];
  const hostAllowed =
    authority &&
    (configured && !localHosts.includes(configured.host)
      ? authority === configured.host
      : localHosts.includes(authority));
  const origin =
    configured && authority === configured.host ? configured.origin : `http://${authority}`;
  const api = request.nextUrl.pathname.startsWith('/api/');
  // Google navigates here from accounts.google.com. Auth.js verifies PKCE, state and nonce.
  const oauthCallback =
    (request.method === 'GET' && request.nextUrl.pathname === '/api/auth/callback/google') ||
    (request.method === 'POST' &&
      request.nextUrl.pathname === '/api/auth/callback/apple' &&
      request.headers.get('origin') === 'https://appleid.apple.com');
  const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
  let response: NextResponse;
  if (!hostAllowed) {
    response = NextResponse.json({ error: 'Host 不被允许。' }, { status: 403 });
  } else if (
    api &&
    !oauthCallback &&
    ((unsafe && request.headers.get('origin') !== origin) ||
      (request.headers.has('origin') && request.headers.get('origin') !== origin) ||
      request.headers.get('sec-fetch-site') === 'cross-site')
  ) {
    response = NextResponse.json({ error: '不允许跨站请求。' }, { status: 403 });
  } else {
    const headers = new Headers(request.headers);
    headers.set('x-forwarded-host', authority!);
    headers.set('x-forwarded-proto', new URL(origin).protocol.slice(0, -1));
    response = NextResponse.next({ request: { headers } });
  }
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.headers.set('X-Frame-Options', 'DENY');
  if (api || response.status === 403) response.headers.set('Cache-Control', 'no-store');
  return response;
}
