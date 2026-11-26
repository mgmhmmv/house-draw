/**
 * Email-and-password accounts for people the studio owner invites (anyone not on the Google
 * allowlist). The owner adds an email in Settings → People and gets a one-time link (7 days);
 * the person sets their own password from it and then signs in with email and password.
 * Passwords are stored as PBKDF2-SHA-256 hashes; invite tokens as SHA-256 only.
 *
 *   POST /api/auth/password        { email, password }  → session
 *   POST /api/auth/set-password    { token, password }  → sets it from an invite, session
 *   GET  /api/auth/people                               → the owner's list
 *   POST /api/auth/people          { email, name? }     → invite (a new set-password link)
 *   POST /api/auth/people/remove   { email }            → access off, signed out everywhere
 */
import { Env, HttpError, json, newId, now } from './http';

const PBKDF2_ITERATIONS = 100_000; // the most Workers allows
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_PASSWORD = 10;

const enc = new TextEncoder();
const b64 = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export interface AuthHelpers {
  sha256: (v: string) => Promise<string>;
  random: () => string;
  startSession: (userId: string) => Promise<string>;
  requireOwner: () => Promise<{ email: string }>;
  origin: () => string;
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256));
}

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${PBKDF2_ITERATIONS}$${b64(salt)}$${b64(await pbkdf2(password, salt, PBKDF2_ITERATIONS))}`;
}

async function checkPassword(password: string, stored: string): Promise<boolean> {
  const [kind, iter, salt, hash] = stored.split('$');
  if (kind !== 'pbkdf2' || !iter || !salt || !hash) return false;
  const got = await pbkdf2(password, unb64(salt), Number(iter));
  const want = unb64(hash);
  if (got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got[i] ^ want[i];
  return diff === 0;
}

async function body(req: Request): Promise<Record<string, unknown>> {
  if (!(req.headers.get('content-type') ?? '').includes('application/json')) throw new HttpError(415, 'json_required');
  const text = await req.text();
  if (text.length > 4096) throw new HttpError(413, 'too_large');
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'bad_json');
  }
}

export async function passwordRoutes(env: Env, req: Request, path: string, h: AuthHelpers): Promise<Response> {
  if (path === '/api/auth/password' && req.method === 'POST') {
    const b = await body(req);
    const email = String(b.email ?? '').trim().toLowerCase().slice(0, 200);
    const password = String(b.password ?? '');
    const row = email
      ? await env.DB.prepare('SELECT id, password_hash, can_sign_in FROM users WHERE email = ?').bind(email).first<{ id: string; password_hash: string; can_sign_in: number }>()
      : null;
    const ok = !!row && row.can_sign_in === 1 && (await checkPassword(password, row.password_hash));
    if (!ok) {
      await new Promise((r) => setTimeout(r, 400)); // slow down guessing
      throw new HttpError(401, 'invalid_login', 'That email and password don’t match an account here.');
    }
    return json({ ok: true }, { headers: { 'set-cookie': await h.startSession(row!.id) } });
  }

  if (path === '/api/auth/set-password' && req.method === 'POST') {
    const b = await body(req);
    const token = String(b.token ?? '');
    const password = String(b.password ?? '');
    if (password.length < MIN_PASSWORD) throw new HttpError(400, 'weak_password', `Use at least ${MIN_PASSWORD} characters.`);
    const inv = token ? await env.DB.prepare('SELECT email, expires_at FROM invites WHERE token_hash = ?').bind(await h.sha256(token)).first<{ email: string; expires_at: number }>() : null;
    if (!inv || inv.expires_at < now()) throw new HttpError(410, 'invite_expired', 'This link has expired or was already used. Ask for a new one.');
    const user = await env.DB.prepare('SELECT id FROM users WHERE email = ? AND can_sign_in = 1').bind(inv.email).first<{ id: string }>();
    if (!user) throw new HttpError(410, 'invite_expired', 'This account no longer has access.');
    await env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(await hashPassword(password), user.id).run();
    await env.DB.prepare('DELETE FROM invites WHERE email = ?').bind(inv.email).run();
    await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id).run();
    return json({ ok: true }, { headers: { 'set-cookie': await h.startSession(user.id) } });
  }

  if (path === '/api/auth/people' && req.method === 'GET') {
    await h.requireOwner();
    const { results } = await env.DB.prepare(
      `SELECT email, name, created_at, password_hash LIKE 'pbkdf2$%' AS has_password FROM users WHERE can_sign_in = 1 ORDER BY created_at`
    ).all<{ email: string; name: string; created_at: number; has_password: number }>();
    return json({ people: results.map((r) => ({ email: r.email, name: r.name, createdAt: r.created_at, hasPassword: !!r.has_password })) });
  }

  if (path === '/api/auth/people' && req.method === 'POST') {
    const owner = await h.requireOwner();
    const b = await body(req);
    const email = String(b.email ?? '').trim().toLowerCase().slice(0, 200);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'invalid_email', 'Enter a valid email address.');
    const name = String(b.name ?? '').trim().slice(0, 120) || email.split('@')[0];
    const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first<{ id: string }>();
    if (existing) await env.DB.prepare('UPDATE users SET can_sign_in = 1 WHERE id = ?').bind(existing.id).run();
    else await env.DB.prepare('INSERT INTO users (id, email, name, password_hash, created_at, can_sign_in) VALUES (?, ?, ?, ?, ?, 1)').bind(newId(), email, name, 'invited', now()).run();
    const token = h.random();
    const t = now();
    await env.DB.prepare('DELETE FROM invites WHERE email = ?').bind(email).run();
    await env.DB.prepare('INSERT INTO invites (token_hash, email, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
      .bind(await h.sha256(token), email, owner.email, t, t + INVITE_TTL_MS)
      .run();
    // The token rides in the fragment, so it never reaches server logs.
    return json({ email, url: `${h.origin()}/set-password#t=${token}`, expiresAt: t + INVITE_TTL_MS });
  }

  if (path === '/api/auth/people/remove' && req.method === 'POST') {
    await h.requireOwner();
    const email = String((await body(req)).email ?? '').trim().toLowerCase();
    const u = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first<{ id: string }>();
    if (u) {
      await env.DB.prepare('UPDATE users SET can_sign_in = 0 WHERE id = ?').bind(u.id).run();
      await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(u.id).run();
      await env.DB.prepare('DELETE FROM invites WHERE email = ?').bind(email).run();
    }
    return json({ ok: true });
  }

  throw new HttpError(404, 'not_found');
}
