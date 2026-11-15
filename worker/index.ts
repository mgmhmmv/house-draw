import { handleAi, handleAsset, handleAssist } from './ai';
import { handleAssets } from './assets';
import { handleSettings } from './settings';
import { handleAuth, requireUser } from './auth';
import { Env, HttpError, json } from './http';
import { handleProjects } from './projects';
import { handleClient, handleIslepos } from './islepos';

/**
 * Requests that change state must come from this site. With SameSite=Lax cookies this
 * closes the remaining cross-site form-post gap without a CSRF token.
 */
function checkOrigin(req: Request) {
  if (req.method === 'GET' || req.method === 'HEAD') return;
  const origin = req.headers.get('origin');
  if (origin && origin !== new URL(req.url).origin) throw new HttpError(403, 'bad_origin');
}

/** Baseline security headers for every response, app and API alike. */
function secure(resp: Response, req: Request): Response {
  const r = new Response(resp.body, resp);
  r.headers.set('x-content-type-options', 'nosniff');
  r.headers.set('x-frame-options', 'DENY');
  r.headers.set('referrer-policy', 'strict-origin-when-cross-origin');
  r.headers.set('permissions-policy', 'geolocation=(), microphone=(), camera=()');
  if (new URL(req.url).protocol === 'https:') r.headers.set('strict-transport-security', 'max-age=31536000; includeSubDomains');
  return r;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    return secure(await route(req, env), req);
  },
} satisfies ExportedHandler<Env>;

async function route(req: Request, env: Env): Promise<Response> {
  const path = new URL(req.url).pathname;
  if (!path.startsWith('/api/')) return env.ASSETS.fetch(req);

  try {
    checkOrigin(req);
    if (path.startsWith('/api/auth/')) return await handleAuth(env, req, path);
    const user = await requireUser(env, req);
    if (path === '/api/projects' || path.startsWith('/api/projects/')) return await handleProjects(env, req, user, path);
    if (path === '/api/integrations/islepos' || path.startsWith('/api/islepos/')) return await handleIslepos(env, req, user, path);
    const client = path.match(/^\/api\/clients\/([\w-]{1,64})$/);
    if (client && req.method === 'GET') return await handleClient(env, user, client[1]);
    if (path === '/api/ai/claude') return await handleAi(env, req);
    if (path === '/api/ai/assist') return await handleAssist(env, req);
    if (path === '/api/ai/asset') return await handleAsset(env, req);
    if (path === '/api/settings') return await handleSettings(env, req, user);
    if (path === '/api/assets' || path.startsWith('/api/assets/')) return await handleAssets(env, req, user, path);
    throw new HttpError(404, 'not_found');
  } catch (err) {
    if (err instanceof HttpError) return json({ ok: false, error: err.code, message: err.message }, { status: err.status });
    console.error(err);
    return json({ ok: false, error: 'internal_error', message: 'Something went wrong.' }, { status: 500 });
  }
}
