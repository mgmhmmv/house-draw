import type { User } from './auth';
import { Env, HttpError, json, newId, now, readJson, str } from './http';

const STATUSES = ['concept', 'design', 'documentation', 'construction', 'complete', 'archived'] as const;
const MODEL_MAX_BYTES = 8 * 1024 * 1024;
const FILE_MAX_BYTES = 25 * 1024 * 1024;
const FILE_KINDS = ['attachment', 'trace', 'export', 'cover'] as const;

interface ProjectRow {
  id: string;
  name: string;
  client: string;
  location: string;
  status: string;
  template: string;
  summary: string;
  version: number;
  created_at: number;
  updated_at: number;
}

const modelKey = (id: string) => `projects/${id}/model.json`;

function toProject(row: ProjectRow) {
  let summary: unknown = {};
  try {
    summary = JSON.parse(row.summary);
  } catch {
    /* keep {} */
  }
  return {
    id: row.id,
    name: row.name,
    client: row.client,
    location: row.location,
    status: row.status,
    template: row.template,
    summary,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Only numbers and short strings, so a card cannot be made to carry anything else. */
function cleanSummary(input: unknown): string {
  const out: Record<string, number | string> = {};
  if (input && typeof input === 'object') {
    for (const [k, v] of Object.entries(input as Record<string, unknown>).slice(0, 20)) {
      if (typeof v === 'number' && Number.isFinite(v)) out[k.slice(0, 40)] = v;
      else if (typeof v === 'string') out[k.slice(0, 40)] = v.slice(0, 80);
    }
  }
  return JSON.stringify(out);
}

async function ownedProject(env: Env, user: User, id: string): Promise<ProjectRow> {
  const row = await env.DB.prepare('SELECT * FROM projects WHERE id = ? AND owner_id = ?').bind(id, user.id).first<ProjectRow>();
  if (!row) throw new HttpError(404, 'project_not_found');
  return row;
}

export async function handleProjects(env: Env, req: Request, user: User, path: string): Promise<Response> {
  const parts = path.split('/').filter(Boolean); // ['api','projects',id?,sub?,subId?]
  const id = parts[2];
  const sub = parts[3];

  // GET /api/projects
  if (!id && req.method === 'GET') {
    const { results } = await env.DB.prepare(
      'SELECT * FROM projects WHERE owner_id = ? ORDER BY updated_at DESC LIMIT 500'
    )
      .bind(user.id)
      .all<ProjectRow>();
    return json({ projects: results.map(toProject) });
  }

  // POST /api/projects  { name, client, location, template, summary, model }
  if (!id && req.method === 'POST') {
    const body = await readJson<Record<string, unknown>>(req, MODEL_MAX_BYTES);
    const name = str(body.name, 120);
    if (!name) throw new HttpError(400, 'invalid_name', 'Give the project a name.');
    if (!body.model || typeof body.model !== 'object') throw new HttpError(400, 'invalid_model');
    const t = now();
    const pid = newId();
    await env.FILES.put(modelKey(pid), JSON.stringify(body.model), {
      httpMetadata: { contentType: 'application/json' },
    });
    await env.DB.prepare(
      `INSERT INTO projects (id, owner_id, name, client, location, status, template, summary, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'concept', ?, ?, 1, ?, ?)`
    )
      .bind(pid, user.id, name, str(body.client, 120), str(body.location, 120), str(body.template, 40) || 'blank', cleanSummary(body.summary), t, t)
      .run();
    return json({ project: toProject(await ownedProject(env, user, pid)) }, { status: 201 });
  }

  if (!id) throw new HttpError(405, 'method_not_allowed');
  const row = await ownedProject(env, user, id);

  if (!sub) {
    if (req.method === 'GET') {
      const obj = await env.FILES.get(modelKey(id));
      const model = obj ? await obj.json() : null;
      return json({ project: toProject(row), model });
    }
    if (req.method === 'PATCH') {
      const body = await readJson<Record<string, unknown>>(req, 8 * 1024);
      const name = body.name !== undefined ? str(body.name, 120) || row.name : row.name;
      const status = STATUSES.includes(body.status as never) ? (body.status as string) : row.status;
      const client = body.client !== undefined ? str(body.client, 120) : row.client;
      const location = body.location !== undefined ? str(body.location, 120) : row.location;
      await env.DB.prepare('UPDATE projects SET name = ?, status = ?, client = ?, location = ?, updated_at = ? WHERE id = ?')
        .bind(name, status, client, location, now(), id)
        .run();
      return json({ project: toProject(await ownedProject(env, user, id)) });
    }
    if (req.method === 'DELETE') {
      const files = await env.DB.prepare('SELECT r2_key FROM project_files WHERE project_id = ?').bind(id).all<{ r2_key: string }>();
      await env.FILES.delete([modelKey(id), ...files.results.map((f) => f.r2_key)]);
      await env.DB.prepare('DELETE FROM projects WHERE id = ?').bind(id).run();
      return json({ ok: true });
    }
    throw new HttpError(405, 'method_not_allowed');
  }

  // PUT /api/projects/:id/model  { model, summary, baseVersion }
  if (sub === 'model' && req.method === 'PUT') {
    const body = await readJson<{ model?: unknown; summary?: unknown; baseVersion?: number }>(req, MODEL_MAX_BYTES);
    if (!body.model || typeof body.model !== 'object') throw new HttpError(400, 'invalid_model');
    if (typeof body.baseVersion === 'number' && body.baseVersion !== row.version)
      throw new HttpError(409, 'version_conflict', 'This project was changed somewhere else. Reload to get the latest.');
    await env.FILES.put(modelKey(id), JSON.stringify(body.model), { httpMetadata: { contentType: 'application/json' } });
    const version = row.version + 1;
    await env.DB.prepare('UPDATE projects SET summary = ?, version = ?, updated_at = ? WHERE id = ?')
      .bind(cleanSummary(body.summary), version, now(), id)
      .run();
    return json({ version, updatedAt: now() });
  }

  if (sub === 'files') {
    const fileId = parts[4];
    if (!fileId && req.method === 'GET') {
      const { results } = await env.DB.prepare(
        'SELECT id, kind, name, content_type, size, created_at FROM project_files WHERE project_id = ? ORDER BY created_at DESC'
      )
        .bind(id)
        .all();
      return json({ files: results });
    }
    // POST /api/projects/:id/files?name=plan.png&kind=trace   body = raw bytes
    if (!fileId && req.method === 'POST') {
      const url = new URL(req.url);
      const name = str(url.searchParams.get('name'), 200) || 'file';
      const kind = FILE_KINDS.includes(url.searchParams.get('kind') as never) ? url.searchParams.get('kind')! : 'attachment';
      const contentType = str(req.headers.get('content-type'), 120) || 'application/octet-stream';
      const size = Number(req.headers.get('content-length') || 0);
      if (!size || size > FILE_MAX_BYTES) throw new HttpError(413, 'file_too_large', 'Files can be up to 25 MB.');
      const fid = newId();
      const key = `projects/${id}/files/${fid}`;
      await env.FILES.put(key, req.body, { httpMetadata: { contentType } });
      await env.DB.prepare(
        'INSERT INTO project_files (id, project_id, kind, name, r2_key, content_type, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      )
        .bind(fid, id, kind, name, key, contentType, size, now())
        .run();
      return json({ file: { id: fid, kind, name, content_type: contentType, size } }, { status: 201 });
    }
    if (fileId) {
      const file = await env.DB.prepare('SELECT * FROM project_files WHERE id = ? AND project_id = ?')
        .bind(fileId, id)
        .first<{ r2_key: string; name: string; content_type: string }>();
      if (!file) throw new HttpError(404, 'file_not_found');
      if (req.method === 'GET') {
        const obj = await env.FILES.get(file.r2_key);
        if (!obj) throw new HttpError(404, 'file_not_found');
        return new Response(obj.body, {
          headers: {
            'content-type': file.content_type,
            'content-disposition': `inline; filename="${file.name.replace(/[^\w.\- ]/g, '_')}"`,
            'cache-control': 'private, max-age=300',
            'x-content-type-options': 'nosniff',
          },
        });
      }
      if (req.method === 'DELETE') {
        await env.FILES.delete(file.r2_key);
        await env.DB.prepare('DELETE FROM project_files WHERE id = ?').bind(fileId).run();
        return json({ ok: true });
      }
    }
  }

  throw new HttpError(404, 'not_found');
}
