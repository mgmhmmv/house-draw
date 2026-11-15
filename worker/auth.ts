/**
 * Sign-in with Google, limited to an allowlist of email addresses (ALLOWED_EMAILS).
 * There is no sign-up and no password: an allowed Google account gets a session on first sign-in.
 *
 * Flow (OAuth 2.0 authorization code + PKCE, OpenID Connect):
 *   GET /api/auth/google          → sets a short-lived state cookie, redirects to Google
 *   GET /api/auth/google/callback → checks state, exchanges the code server-side, checks the
 *                                   ID token (issuer, audience, expiry, nonce, verified email,
 *                                   allowlist), starts a session, redirects to the app
 * The ID token comes straight from Google's token endpoint over TLS, which OIDC §3.1.3.7 allows
 * in place of verifying its signature.
 */
import { Env, HttpError, json, newId, now } from './http';

const SESSION_COOKIE = 'as_session';
const OAUTH_COOKIE = 'as_oauth';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const OAUTH_TTL_S = 600;

export interface User {
  id: string;
  email: string;
  name: string;
}

const enc = new TextEncoder();
const b64 = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const b64url = (buf: ArrayBuffer | Uint8Array) => b64(buf).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const random = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)));

async function sha256(value: string): Promise<string> {
  return b64(await crypto.subtle.digest('SHA-256', enc.encode(value)));
}

function allowed(env: Env): Set<string> {
  return new Set(
    (env.ALLOWED_EMAILS ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
  );
}

const isHttps = (req: Request) => new URL(req.url).protocol === 'https:';

function cookie(req: Request, name: string, value: string, maxAgeSec: number, path = '/'): string {
  return `${name}=${value}; Path=${path}; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${isHttps(req) ? '; Secure' : ''}`;
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get('cookie') || '';
  for (const part of header.split(/;\s*/)) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i) === name) return part.slice(i + 1);
  }
  return null;
}

/** The public origin the browser used (the dev proxy forwards the Host header unchanged). */
const appOrigin = (env: Env, req: Request) => env.APP_ORIGIN || new URL(req.url).origin;
const redirectUri = (env: Env, req: Request) => `${appOrigin(env, req)}/api/auth/google/callback`;

function redirect(to: string, cookies: string[] = []): Response {
  const headers = new Headers({ location: to, 'cache-control': 'no-store' });
  for (const c of cookies) headers.append('set-cookie', c);
  return new Response(null, { status: 302, headers });
}

/** The signed-in user, or null. Expired sessions and emails no longer allowed count as signed out. */
export async function currentUser(env: Env, req: Request): Promise<User | null> {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token) return null;
  const row = await env.DB.prepare(
    `SELECT u.id, u.email, u.name FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ?`
  )
    .bind(await sha256(token), now())
    .first<User>();
  if (!row || !allowed(env).has(row.email.toLowerCase())) return null;
  return row;
}

export async function requireUser(env: Env, req: Request): Promise<User> {
  const user = await currentUser(env, req);
  if (!user) throw new HttpError(401, 'unauthorized');
  return user;
}

function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const part = jwt.split('.')[1] ?? '';
  const pad = part.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((part.length + 3) % 4);
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(pad), (c) => c.charCodeAt(0))));
}

export async function handleAuth(env: Env, req: Request, path: string): Promise<Response> {
  if (path === '/api/auth/me' && req.method === 'GET') {
    return json({ user: await currentUser(env, req), providers: { google: !!env.GOOGLE_CLIENT_ID } });
  }

  if (path === '/api/auth/google' && req.method === 'GET') {
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return redirect('/login?error=not_configured');
    const state = random();
    const verifier = random(48);
    const nonce = random();
    const challenge = b64url(await crypto.subtle.digest('SHA-256', enc.encode(verifier)));
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      redirect_uri: redirectUri(env, req),
      response_type: 'code',
      scope: 'openid email profile',
      state,
      nonce,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      prompt: 'select_account',
    }).toString();
    return redirect(url.toString(), [cookie(req, OAUTH_COOKIE, `${state}.${verifier}.${nonce}`, OAUTH_TTL_S, '/api/auth')]);
  }

  if (path === '/api/auth/google/callback' && req.method === 'GET') {
    const url = new URL(req.url);
    const clear = cookie(req, OAUTH_COOKIE, '', 0, '/api/auth');
    const fail = (code: string) => redirect(`/login?error=${code}`, [clear]);
    if (url.searchParams.get('error')) return fail('cancelled');
    const [state, verifier, nonce] = (readCookie(req, OAUTH_COOKIE) ?? '').split('.');
    const code = url.searchParams.get('code');
    if (!state || !verifier || !nonce || !code || url.searchParams.get('state') !== state) return fail('expired');

    const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_CLIENT_ID!,
        client_secret: env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: redirectUri(env, req),
        grant_type: 'authorization_code',
        code_verifier: verifier,
      }),
    });
    if (!tokenResp.ok) return fail('google');
    const tokens = (await tokenResp.json()) as { id_token?: string };
    if (!tokens.id_token) return fail('google');

    let claims: Record<string, unknown>;
    try {
      claims = decodeJwtPayload(tokens.id_token);
    } catch {
      return fail('google');
    }
    const email = String(claims.email ?? '').toLowerCase();
    const okIssuer = claims.iss === 'https://accounts.google.com' || claims.iss === 'accounts.google.com';
    const okAudience = claims.aud === env.GOOGLE_CLIENT_ID;
    const okExpiry = typeof claims.exp === 'number' && claims.exp * 1000 > now();
    if (!okIssuer || !okAudience || !okExpiry || claims.nonce !== nonce || claims.email_verified !== true || !email) return fail('google');
    if (!allowed(env).has(email)) return fail('not_allowed');

    // Find or create the account for this allowed email.
    let user = await env.DB.prepare('SELECT id, email, name FROM users WHERE email = ?').bind(email).first<User>();
    const name = String(claims.name ?? email.split('@')[0]).slice(0, 120);
    if (!user) {
      user = { id: newId(), email, name };
      await env.DB.prepare('INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)')
        .bind(user.id, email, name, 'google', now())
        .run();
    }

    const t = now();
    // Housekeeping: drop expired sessions whenever someone signs in.
    await env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(t).run();
    const token = random();
    await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .bind(await sha256(token), user.id, t, t + SESSION_TTL_MS)
      .run();
    return redirect('/', [clear, cookie(req, SESSION_COOKIE, token, SESSION_TTL_MS / 1000)]);
  }

  if (path === '/api/auth/logout' && req.method === 'POST') {
    const token = readCookie(req, SESSION_COOKIE);
    if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
    return json({ ok: true }, { headers: { 'set-cookie': cookie(req, SESSION_COOKIE, '', 0) } });
  }

  // Sign out on every device.
  if (path === '/api/auth/logout-all' && req.method === 'POST') {
    const user = await requireUser(env, req);
    await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id).run();
    return json({ ok: true }, { headers: { 'set-cookie': cookie(req, SESSION_COOKIE, '', 0) } });
  }

  throw new HttpError(404, 'not_found');
}
