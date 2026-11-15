/**
 * IslePOS connection: the merchant's API key (encrypted at rest), a thin proxy to the IslePOS
 * REST API, and the record of which quotes/invoices belong to which ArchStudio project.
 *
 * The key never reaches the browser; the browser talks to /api/islepos/* and this Worker adds
 * the Authorization header. Only the routes ArchStudio needs are forwarded.
 */
import type { User } from './auth';
import { Env, HttpError, json, newId, now, readJson, str } from './http';

const BASE = {
  production: 'https://api.islepos.com/functions/v1/islepos-api',
  staging: 'https://doydvtrxajlpbladpozo.supabase.co/functions/v1/islepos-api',
} as const;
type IsleEnv = keyof typeof BASE;

const enc = new TextEncoder();
const b64 = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function aesKey(env: Env): Promise<CryptoKey> {
  if (!env.ISLEPOS_KEY_SECRET) throw new HttpError(503, 'islepos_not_configured', 'IslePOS isn’t configured on this server.');
  const raw = await crypto.subtle.digest('SHA-256', enc.encode(env.ISLEPOS_KEY_SECRET));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function seal(env: Env, plain: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(env), enc.encode(plain));
  return { cipher: b64(ct), iv: b64(iv) };
}

async function open(env: Env, cipher: string, iv: string) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await aesKey(env), unb64(cipher));
  return new TextDecoder().decode(pt);
}

interface Conn {
  key: string;
  env: IsleEnv;
  businessId: string | null;
}

async function connection(env: Env, user: User): Promise<Conn> {
  const row = await env.DB.prepare('SELECT * FROM integrations WHERE user_id = ? AND provider = ?')
    .bind(user.id, 'islepos')
    .first<{ key_cipher: string; key_iv: string; env: IsleEnv; business_id: string | null }>();
  if (!row) throw new HttpError(409, 'islepos_not_connected', 'Connect IslePOS in Settings first.');
  return { key: await open(env, row.key_cipher, row.key_iv), env: row.env, businessId: row.business_id };
}

async function call(c: Conn, method: string, path: string, body?: string, query = '') {
  const headers: Record<string, string> = { authorization: `Bearer ${c.key}` };
  if (body) headers['content-type'] = 'application/json';
  if (c.businessId) headers['x-business-id'] = c.businessId;
  return fetch(`${BASE[c.env]}${path}${query}`, { method, headers, body });
}

// Only these IslePOS routes are reachable through the proxy.
const ALLOWED = /^\/(products|customers(\/[\w-]+)?|quotes(\/[\w-]+(\/(issue|accept|reject|cancel|convert))?)?|invoices(\/[\w-]+(\/(issue|cancel))?)?)$/;

export async function handleIslepos(env: Env, req: Request, user: User, path: string): Promise<Response> {
  // Connection management
  if (path === '/api/integrations/islepos') {
    if (req.method === 'GET') {
      const row = await env.DB.prepare('SELECT env, key_hint, business_id, connected_at FROM integrations WHERE user_id = ? AND provider = ?')
        .bind(user.id, 'islepos')
        .first<{ env: string; key_hint: string; business_id: string | null; connected_at: number }>();
      return json({ connected: !!row, ...(row ?? {}) });
    }
    if (req.method === 'PUT') {
      const body = await readJson<{ key?: string; env?: string; businessId?: string }>(req, 8 * 1024);
      const key = str(body.key, 300);
      const ienv: IsleEnv = body.env === 'staging' ? 'staging' : 'production';
      if (!/^isle_mcp_[\w-]{8,}$/.test(key)) throw new HttpError(400, 'invalid_key', 'Paste an IslePOS key (it starts with isle_mcp_).');
      // Check the key works before storing it.
      const probe = await call({ key, env: ienv, businessId: str(body.businessId, 64) || null }, 'GET', '/');
      const info = (await probe.json().catch(() => ({}))) as { business_id?: string; permissions?: string[]; error?: string };
      if (!probe.ok) throw new HttpError(400, 'key_rejected', info.error || 'IslePOS didn’t accept that key.');
      const sealed = await seal(env, key);
      await env.DB.prepare(
        `INSERT INTO integrations (user_id, provider, env, key_cipher, key_iv, key_hint, business_id, connected_at)
         VALUES (?, 'islepos', ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, provider) DO UPDATE SET env = excluded.env, key_cipher = excluded.key_cipher, key_iv = excluded.key_iv,
           key_hint = excluded.key_hint, business_id = excluded.business_id, connected_at = excluded.connected_at`
      )
        .bind(user.id, ienv, sealed.cipher, sealed.iv, `…${key.slice(-4)}`, info.business_id ?? (str(body.businessId, 64) || null), now())
        .run();
      return json({ connected: true, env: ienv, business_id: info.business_id ?? null, permissions: info.permissions ?? [] });
    }
    if (req.method === 'DELETE') {
      await env.DB.prepare('DELETE FROM integrations WHERE user_id = ? AND provider = ?').bind(user.id, 'islepos').run();
      return json({ connected: false });
    }
    throw new HttpError(405, 'method_not_allowed');
  }

  // Proxy: /api/islepos/<route>
  const sub = path.slice('/api/islepos'.length) || '/';
  if (!ALLOWED.test(sub)) throw new HttpError(404, 'not_found');
  if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(req.method)) throw new HttpError(405, 'method_not_allowed');
  const c = await connection(env, user);
  const body = req.method === 'GET' || req.method === 'DELETE' ? undefined : await req.text();
  if (body && body.length > 256 * 1024) throw new HttpError(413, 'payload_too_large');
  const resp = await call(c, req.method, sub, body, new URL(req.url).search);
  const text = await resp.text();
  return new Response(text, { status: resp.status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}

/* ── Per-project billing records ───────────────────────────────────── */

export async function handleProjectBilling(env: Env, req: Request, projectId: string): Promise<Response> {
  if (req.method === 'GET') {
    const { results } = await env.DB.prepare('SELECT * FROM project_documents WHERE project_id = ? ORDER BY created_at DESC').bind(projectId).all();
    const p = await env.DB.prepare('SELECT islepos_customer_id FROM projects WHERE id = ?').bind(projectId).first<{ islepos_customer_id: string | null }>();
    return json({ customerId: p?.islepos_customer_id ?? null, documents: results });
  }
  if (req.method === 'PUT') {
    // { customerId?, document?: { kind, islepos_id, number, status, total, balance_due } }
    const body = await readJson<{ customerId?: string | null; document?: Record<string, unknown> }>(req, 16 * 1024);
    if (body.customerId !== undefined) {
      await env.DB.prepare('UPDATE projects SET islepos_customer_id = ?, updated_at = ? WHERE id = ?')
        .bind(body.customerId ? str(body.customerId, 64) : null, now(), projectId)
        .run();
    }
    const d = body.document;
    if (d) {
      const kind = d.kind === 'invoice' ? 'invoice' : 'quote';
      const iid = str(d.islepos_id, 64);
      if (!iid) throw new HttpError(400, 'invalid_document');
      const existing = await env.DB.prepare('SELECT id FROM project_documents WHERE project_id = ? AND islepos_id = ?').bind(projectId, iid).first<{ id: string }>();
      const total = Number(d.total) || 0;
      const bal = d.balance_due === null || d.balance_due === undefined ? null : Number(d.balance_due);
      if (existing)
        await env.DB.prepare('UPDATE project_documents SET number = ?, status = ?, total = ?, balance_due = ?, updated_at = ? WHERE id = ?')
          .bind(str(d.number, 60), str(d.status, 30) || 'draft', total, bal, now(), existing.id)
          .run();
      else
        await env.DB.prepare(
          'INSERT INTO project_documents (id, project_id, kind, islepos_id, number, status, total, balance_due, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        )
          .bind(newId(), projectId, kind, iid, str(d.number, 60), str(d.status, 30) || 'draft', total, bal, now(), now())
          .run();
    }
    return handleProjectBilling(env, new Request(req.url, { method: 'GET' }), projectId);
  }
  throw new HttpError(405, 'method_not_allowed');
}
