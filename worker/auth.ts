import { Env, HttpError, json, newId, now, readJson, str } from './http';

const SESSION_COOKIE = 'as_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
// Workers caps PBKDF2 at 100k iterations.
const PBKDF2_ITERATIONS = 100_000;

export interface User {
  id: string;
  email: string;
  name: string;
}

const enc = new TextEncoder();
const b64 = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
}

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${b64(salt)}$${b64(hash)}`;
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iter, salt, hash] = stored.split('$');
  if (scheme !== 'pbkdf2' || !iter || !salt || !hash) return false;
  const derived = await pbkdf2(password, unb64(salt), Number(iter));
  return timingSafeEqual(new Uint8Array(derived), unb64(hash));
}

async function sha256(value: string): Promise<string> {
  return b64(await crypto.subtle.digest('SHA-256', enc.encode(value)));
}

function sessionCookie(req: Request, token: string, maxAgeSec: number): string {
  const secure = new URL(req.url).protocol === 'https:' ? '; Secure' : '';
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure}`;
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get('cookie') || '';
  for (const part of header.split(/;\s*/)) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i) === name) return part.slice(i + 1);
  }
  return null;
}

async function startSession(env: Env, req: Request, user: User): Promise<Response> {
  const token = b64(crypto.getRandomValues(new Uint8Array(32))).replace(/[+/=]/g, (c) => ({ '+': '-', '/': '_', '=': '' })[c]!);
  const t = now();
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .bind(await sha256(token), user.id, t, t + SESSION_TTL_MS)
    .run();
  return json({ user }, { headers: { 'set-cookie': sessionCookie(req, token, SESSION_TTL_MS / 1000) } });
}

/** The signed-in user, or null. Expired sessions are treated as absent. */
export async function currentUser(env: Env, req: Request): Promise<User | null> {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token) return null;
  const row = await env.DB.prepare(
    `SELECT u.id, u.email, u.name FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ?`
  )
    .bind(await sha256(token), now())
    .first<User>();
  return row ?? null;
}

export async function requireUser(env: Env, req: Request): Promise<User> {
  const user = await currentUser(env, req);
  if (!user) throw new HttpError(401, 'unauthorized');
  return user;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function handleAuth(env: Env, req: Request, path: string): Promise<Response> {
  if (path === '/api/auth/me' && req.method === 'GET') {
    return json({ user: await currentUser(env, req) });
  }

  if (path === '/api/auth/signup' && req.method === 'POST') {
    const body = await readJson<{ email?: string; password?: string; name?: string }>(req, 8 * 1024);
    const email = str(body.email, 254).toLowerCase();
    const name = str(body.name, 120);
    const password = typeof body.password === 'string' ? body.password : '';
    if (!EMAIL_RE.test(email)) throw new HttpError(400, 'invalid_email', 'Enter a valid email address.');
    if (!name) throw new HttpError(400, 'invalid_name', 'Enter your name.');
    if (password.length < 8 || password.length > 256)
      throw new HttpError(400, 'weak_password', 'Use a password of at least 8 characters.');

    const exists = await env.DB.prepare('SELECT 1 FROM users WHERE email = ?').bind(email).first();
    if (exists) throw new HttpError(409, 'email_taken', 'An account with this email already exists.');

    const user: User = { id: newId(), email, name };
    await env.DB.prepare('INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(user.id, email, name, await hashPassword(password), now())
      .run();
    return startSession(env, req, user);
  }

  if (path === '/api/auth/login' && req.method === 'POST') {
    const body = await readJson<{ email?: string; password?: string }>(req, 8 * 1024);
    const email = str(body.email, 254).toLowerCase();
    const password = typeof body.password === 'string' ? body.password : '';
    const row = await env.DB.prepare('SELECT id, email, name, password_hash FROM users WHERE email = ?')
      .bind(email)
      .first<User & { password_hash: string }>();
    // Same message either way, so the form does not reveal which emails have accounts.
    if (!row || !(await verifyPassword(password, row.password_hash)))
      throw new HttpError(401, 'invalid_credentials', 'Email or password is incorrect.');
    return startSession(env, req, { id: row.id, email: row.email, name: row.name });
  }

  if (path === '/api/auth/logout' && req.method === 'POST') {
    const token = readCookie(req, SESSION_COOKIE);
    if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
    return json({ ok: true }, { headers: { 'set-cookie': sessionCookie(req, '', 0) } });
  }

  throw new HttpError(404, 'not_found');
}
