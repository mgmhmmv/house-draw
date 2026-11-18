/**
 * Public 3D view: GET /api/public/model/<token> returns the building's shell only, for the
 * read-only viewer at /v/<token>. No login. What is left out on purpose: client, location and
 * every other project detail; room names and finishes; interior walls; services (MEP);
 * furniture (railings stay, they are part of the facade); costs, notes and custom objects.
 */
import { Env, HttpError, json } from './http';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isObj) : []);

/** The facade-only copy of a model. */
export function facadeOnly(model: Obj, title: string): Obj {
  const meta = isObj(model.meta) ? model.meta : {};
  const levels = arr(model.levels).map((l) => {
    const walls = arr(l.walls).filter((w) => w.isExterior !== false);
    const wallIds = new Set(walls.map((w) => w.id));
    return {
      id: l.id,
      index: l.index,
      name: typeof l.name === 'string' ? l.name.replace(/\s*\(.*\)/, '') : '',
      elevation: l.elevation,
      floorToFloorHeight: l.floorToFloorHeight,
      slabThickness: l.slabThickness,
      walls,
      openings: arr(l.openings).filter((o) => wallIds.has(o.wallId)),
      // Rooms shape the slabs and roof; only their outline and kind are kept.
      rooms: arr(l.rooms).map((r, i) => ({ id: `r${i}`, name: '', category: r.category, polygon: r.polygon, finish: 'concrete' })),
      columns: arr(l.columns),
      stairs: arr(l.stairs),
      furniture: arr(l.furniture).filter((f) => f.type === 'fence_railing'),
      mepNodes: [],
      mepCircuits: [],
    };
  });
  const solar = isObj(model.solar) ? model.solar : undefined;
  return {
    id: 'public',
    meta: { title, projectCode: '', client: '', architect: '', location: '', revision: '', date: '', scale: '', plotWidth: meta.plotWidth, plotDepth: meta.plotDepth, currency: '' },
    grid: { xAxes: [], yAxes: [] },
    levels,
    roof: model.roof,
    sections: [],
    rates: {},
    design: model.design,
    site: model.site,
    solar: solar
      ? { enabled: solar.enabled, panelCount: solar.panelCount, panelWattage: solar.panelWattage, inverterKW: 0, batteryKWh: 0, offsetX: solar.offsetX, offsetY: solar.offsetY, rotationDeg: solar.rotationDeg, roofFace: solar.roofFace, columns: solar.columns, strings: solar.strings, panelsPerString: solar.panelsPerString, serviceGapEvery: solar.serviceGapEvery, serviceGapWidth: solar.serviceGapWidth, panelOffsets: solar.panelOffsets }
      : undefined,
    hvac: { enabled: false },
  };
}

export async function handlePublic(env: Env, req: Request, path: string): Promise<Response> {
  const m = path.match(/^\/api\/public\/model\/([A-Za-z0-9_-]{16,64})$/);
  if (!m || req.method !== 'GET') throw new HttpError(404, 'not_found');
  const row = await env.DB.prepare('SELECT id, name FROM projects WHERE share_token = ?').bind(m[1]).first<{ id: string; name: string }>();
  if (!row) throw new HttpError(404, 'not_found', 'This link is no longer valid.');
  const obj = await env.FILES.get(`projects/${row.id}/model.json`);
  if (!obj) throw new HttpError(404, 'not_found');
  const model = (await obj.json()) as Obj;
  const r = json({ name: row.name, model: facadeOnly(model, row.name) });
  r.headers.set('cache-control', 'public, max-age=60');
  r.headers.set('x-robots-tag', 'noindex');
  return r;
}
