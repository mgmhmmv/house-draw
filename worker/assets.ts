import type { User } from './auth';
import { Env, HttpError, json, now, readJson, str } from './http';

const ID = /^ai_[a-z0-9_]{3,48}$/;
const MAX_SPEC = 96 * 1024;

/**
 * /api/assets — the user's own library objects (made with the AI).
 *   GET            → { assets: spec[] }
 *   PUT /:id       { spec } → save or replace
 *   DELETE /:id
 * Specs are checked again in the app before use; here we only bound their size and shape.
 */
export async function handleAssets(env: Env, req: Request, user: User, path: string): Promise<Response> {
  const id = path.split('/')[3];
  if (!id && req.method === 'GET') {
    const { results } = await env.DB.prepare('SELECT spec FROM custom_assets WHERE owner_id = ? ORDER BY updated_at DESC LIMIT 500').bind(user.id).all<{ spec: string }>();
    return json({ assets: results.flatMap((r) => { try { return [JSON.parse(r.spec)]; } catch { return []; } }) });
  }
  if (!id || !ID.test(id)) throw new HttpError(400, 'invalid_id');
  if (req.method === 'PUT') {
    const body = await readJson<{ spec?: Record<string, unknown> }>(req, MAX_SPEC + 1024);
    const spec = body.spec;
    if (!spec || typeof spec !== 'object' || spec.id !== id || !Array.isArray(spec.parts) || spec.parts.length > 400) throw new HttpError(400, 'invalid_spec');
    const text = JSON.stringify(spec);
    if (text.length > MAX_SPEC) throw new HttpError(413, 'too_large');
    const t = now();
    await env.DB.prepare(
      `INSERT INTO custom_assets (id, owner_id, name, spec, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(owner_id, id) DO UPDATE SET name = excluded.name, spec = excluded.spec, updated_at = excluded.updated_at`
    )
      .bind(id, user.id, str(spec.name, 60) || 'Object', text, t, t)
      .run();
    return json({ ok: true });
  }
  if (req.method === 'DELETE') {
    await env.DB.prepare('DELETE FROM custom_assets WHERE owner_id = ? AND id = ?').bind(user.id, id).run();
    return json({ ok: true });
  }
  throw new HttpError(405, 'method_not_allowed');
}
