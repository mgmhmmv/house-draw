import { handleAi } from './ai';
import { handleAuth, requireUser } from './auth';
import { Env, HttpError, json } from './http';
import { handleProjects } from './projects';

/**
 * Requests that change state must come from this site. With SameSite=Lax cookies this
 * closes the remaining cross-site form-post gap without a CSRF token.
 */
function checkOrigin(req: Request) {
  if (req.method === 'GET' || req.method === 'HEAD') return;
  const origin = req.headers.get('origin');
  if (origin && origin !== new URL(req.url).origin) throw new HttpError(403, 'bad_origin');
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const path = new URL(req.url).pathname;
    if (!path.startsWith('/api/')) return env.ASSETS.fetch(req);

    try {
      checkOrigin(req);
      if (path.startsWith('/api/auth/')) return await handleAuth(env, req, path);
      const user = await requireUser(env, req);
      if (path === '/api/projects' || path.startsWith('/api/projects/')) return await handleProjects(env, req, user, path);
      if (path === '/api/ai/claude') return await handleAi(env, req);
      throw new HttpError(404, 'not_found');
    } catch (err) {
      if (err instanceof HttpError) return json({ ok: false, error: err.code, message: err.message }, { status: err.status });
      console.error(err);
      return json({ ok: false, error: 'internal_error', message: 'Something went wrong.' }, { status: 500 });
    }
  },
} satisfies ExportedHandler<Env>;
