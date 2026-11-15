import type { User } from './auth';
import { Env, HttpError, json, now, readJson } from './http';

/** GET/PUT /api/settings — a small JSON object of the user's preferences (studio profile). */
export async function handleSettings(env: Env, req: Request, user: User): Promise<Response> {
  if (req.method === 'GET') {
    const row = await env.DB.prepare('SELECT data FROM user_settings WHERE user_id = ?').bind(user.id).first<{ data: string }>();
    let data: unknown = {};
    try {
      data = row ? JSON.parse(row.data) : {};
    } catch {
      /* keep {} */
    }
    return json({ settings: data });
  }
  if (req.method === 'PUT') {
    const body = await readJson<{ settings?: Record<string, unknown> }>(req, 16 * 1024);
    if (!body.settings || typeof body.settings !== 'object') throw new HttpError(400, 'invalid_settings');
    // Strings only, bounded.
    const clean: Record<string, string> = {};
    for (const [k, v] of Object.entries(body.settings).slice(0, 40)) if (typeof v === 'string') clean[k.slice(0, 40)] = v.slice(0, 400);
    await env.DB.prepare('INSERT INTO user_settings (user_id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at')
      .bind(user.id, JSON.stringify(clean), now())
      .run();
    return json({ settings: clean });
  }
  throw new HttpError(405, 'method_not_allowed');
}
