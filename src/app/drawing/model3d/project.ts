/**
 * Orthographic projection of the face model onto a vertical picture plane.
 *
 * Hidden surfaces are handled by back-face culling plus painter's ordering (far to near),
 * which is exact for the convex, mostly axis-aligned surfaces a house is made of and keeps
 * the output as filled vector paths. Sections clip every face against the cut plane and add
 * poché for whatever the plane passes through.
 */
import type { BuildingProject, FloorLevel, SectionLine } from '../../../model/types';
import polygonClipping, { type MultiPolygon, type Polygon as PCPolygon, type Ring } from 'polygon-clipping';
import { multiPolygonPath, wallFrame } from '../plan/kernel';
import { levelBounds, tint, type BuildingFrame, type Face, type V3 } from './faces';

export interface View {
  /** Unit vector the viewer looks along (horizontal). */
  look: { x: number; y: number };
  /** Picture-plane origin; depth and u are measured from here. */
  origin: { x: number; y: number };
}

/** u axis = the viewer's right hand. */
export const rightOf = (look: View['look']) => ({ x: -look.y, y: look.x });

export interface Projected {
  d: string;
  fill: string;
  kind: Face['kind'];
  depth: number;
  lines: string;
  sash: string;
  /** Cast shadow falling on this face, if any. */
  shadow: string;
  /** Opening mark and the opening's extent, for tags. */
  tag?: { text: string; u: number; top: number; bottom: number };
}

export interface Drawing {
  faces: Projected[];
  /** Outline of everything visible: drawn as the heavy profile line. */
  profile: string;
  /** Cut poché (sections only), as SVG path data. */
  cut: string;
  /** Roof cut band (sections only). */
  roofCut: string;
  uMin: number;
  uMax: number;
  zMax: number;
  rooms: { name: string; u: number; z: number; w: number }[];
  /** One point per surface kind to hang a material note from, in (u, -z). */
  targets: { kind: Face['kind']; u: number; y: number }[];
}

const depthOf = (v: View, p: { x: number; y: number }) => (p.x - v.origin.x) * v.look.x + (p.y - v.origin.y) * v.look.y;
const uOf = (v: View, p: { x: number; y: number }) => {
  const r = rightOf(v.look);
  return (p.x - v.origin.x) * r.x + (p.y - v.origin.y) * r.y;
};

/** Sutherland–Hodgman against the half-space depth >= 0. */
function clipFront(v: View, poly: V3[]): V3[] {
  const out: V3[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const da = depthOf(v, a);
    const db = depthOf(v, b);
    if (da >= 0) out.push(a);
    if ((da >= 0) !== (db >= 0)) {
      const t = da / (da - db);
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
    }
  }
  return out;
}

/** Working record while projecting: polygons stay as numbers until the end. */
interface Item {
  poly: PCPolygon; // [outer, ...holes] in (u, -z)
  fill: string;
  kind: Face['kind'];
  depth: number;
  minDepth: number;
  planar: boolean;
  lines: string;
  sash: string;
  shadow: MultiPolygon;
  tag?: string;
}

const ring2 = (v: View, ring: V3[]): Ring => {
  const r = ring.map((p) => [uOf(v, p), -p.z] as [number, number]);
  r.push(r[0]);
  return r;
};
const segPath = (v: View, segs: [V3, V3][] | undefined, section: boolean) =>
  (segs ?? [])
    .filter(([a, b]) => !section || (depthOf(v, a) >= 0 && depthOf(v, b) >= 0))
    .map(([a, b]) => `M${uOf(v, a).toFixed(3)} ${(-a.z).toFixed(3)}L${uOf(v, b).toFixed(3)} ${(-b.z).toFixed(3)}`)
    .join('');

const bbox = (p: PCPolygon) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of p[0]) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1 };
};
/** Even-odd point-in-polygon over all rings (holes excluded). */
function insidePoly(p: PCPolygon, [x, y]: [number, number]): boolean {
  let inside = false;
  for (const ring of p)
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  return inside;
}
const shift = (p: PCPolygon, d: number): PCPolygon => p.map((r) => r.map(([x, y]) => [x + d, y + d] as [number, number]));
const safe = <T,>(fn: () => T, fallback: T): T => {
  try {
    return fn();
  } catch {
    return fallback;
  }
};

/** Light comes from the upper left at 45°, the drafting convention for elevation shadows. */
const SHADOW_MAX = 3;
const CASTERS = new Set<Face['kind']>(['wall', 'roof', 'fascia', 'sill', 'plinth', 'frame', 'gutter', 'downpipe', 'tank']);
const RECEIVERS = new Set<Face['kind']>(['wall', 'glass', 'door', 'plinth']);

export function project(frame: BuildingFrame, view: View, opts: { section?: boolean } = {}): Drawing {
  let items: Item[] = [];
  let uMin = Infinity;
  let uMax = -Infinity;
  let zMax = 0;

  for (const f of frame.faces) {
    // Back-face cull: keep faces whose normal points toward the viewer.
    const facing = f.n.x * view.look.x + f.n.y * view.look.y;
    if (facing > -1e-4) continue;
    let pts = f.pts;
    let holes = f.holes ?? [];
    if (opts.section) {
      pts = clipFront(view, pts);
      if (pts.length < 3) continue;
      holes = holes.map((h) => clipFront(view, h)).filter((h) => h.length >= 3);
    }
    let dsum = 0;
    let dmin = Infinity;
    for (const p of pts) {
      const u = uOf(view, p);
      uMin = Math.min(uMin, u);
      uMax = Math.max(uMax, u);
      zMax = Math.max(zMax, p.z);
      const d = depthOf(view, p);
      dsum += d;
      dmin = Math.min(dmin, d);
    }
    items.push({
      poly: [ring2(view, pts), ...holes.map((h) => ring2(view, h))],
      fill: f.fill,
      kind: f.kind,
      depth: dsum / pts.length - f.order * 0.002,
      minDepth: dmin,
      planar: facing < -0.995,
      lines: segPath(view, f.lines, !!opts.section),
      sash: segPath(view, f.sash, !!opts.section),
      shadow: [],
      tag: f.tag,
    });
  }

  // Merge coplanar wall faces of the same finish into one surface: no seams at junctions.
  const groups = new Map<string, Item[]>();
  const rest: Item[] = [];
  for (const it of items) {
    if (it.kind === 'wall' && it.planar) {
      const key = `${it.fill}|${it.depth.toFixed(3)}`;
      (groups.get(key) ?? groups.set(key, []).get(key)!).push(it);
    } else rest.push(it);
  }
  for (const g of groups.values()) {
    if (g.length === 1) {
      rest.push(g[0]);
      continue;
    }
    const merged = safe(() => polygonClipping.union(g[0].poly, ...g.slice(1).map((x) => x.poly)), g.map((x) => x.poly));
    for (const poly of merged)
      rest.push({ ...g[0], poly, lines: g.map((x) => x.lines).join(''), minDepth: Math.min(...g.map((x) => x.minDepth)) });
  }
  items = rest;

  // Cast shadows: each caster nearer than a receiver throws its outline down-right by the depth gap.
  const boxes = items.map((it) => bbox(it.poly));
  items.forEach((r, ri) => {
    if (!r.planar || !RECEIVERS.has(r.kind)) return;
    const rb = boxes[ri];
    const shifted: PCPolygon[] = [];
    items.forEach((c, ci) => {
      if (ci === ri || !CASTERS.has(c.kind)) return;
      const gap = r.depth - c.minDepth;
      if (gap < 0.015 || gap > SHADOW_MAX) return;
      const cb = boxes[ci];
      if (cb.x1 + gap < rb.x0 || cb.x0 + gap > rb.x1 || cb.y1 + gap < rb.y0 || cb.y0 + gap > rb.y1) return;
      shifted.push(shift(c.poly, gap));
    });
    if (!shifted.length) return;
    r.shadow = safe(() => polygonClipping.intersection([r.poly], polygonClipping.union(shifted[0], ...shifted.slice(1))), []);
  });

  // Far to near.
  items.sort((a, b) => b.depth - a.depth);

  // Aerial perspective: surfaces further back fade toward the paper.
  if (items.length) {
    const dNear = Math.min(...items.map((i) => i.depth));
    const dFar = Math.max(...items.map((i) => i.depth));
    const span = Math.max(1, dFar - dNear);
    for (const it of items) {
      const f = (it.depth - dNear) / span;
      if (it.fill.startsWith('#')) it.fill = tint(it.fill, f * 0.4);
    }
  }

  const profile = safe(() => {
    const outers = items.map((i) => [i.poly[0]] as PCPolygon);
    return outers.length ? multiPolygonPath(polygonClipping.union(outers[0], ...outers.slice(1)).map((p) => [p[0]])) : '';
  }, '');

  // Callout anchors: the largest visible surface of each kind, at a point clear of openings and shadow.
  const targets: Drawing['targets'] = [];
  const nearest = items.length ? Math.min(...items.map((i) => i.depth)) : 0;
  for (const kind of ['roof', 'solar', 'gutter', 'fascia', 'wall', 'frame', 'door', 'plinth', 'tank'] as Face['kind'][]) {
    const pool = items.filter((i) => i.kind === kind && i.depth - nearest < (kind === 'roof' ? 12 : 4));
    if (!pool.length) continue;
    const area = (i: Item) => {
      const b = bbox(i.poly);
      return (b.x1 - b.x0) * (b.y1 - b.y0);
    };
    const best = pool.reduce((a, b) => (area(b) > area(a) ? b : a));
    const b = bbox(best.poly);
    let pt: [number, number] | null = null;
    // Prefer the upper right of the surface (notes sit on the right of the sheet).
    // Frames are thin bars around glass, so try points along the border for them.
    const fys = kind === 'frame' ? [0.5, 0.03, 0.97] : [0.35, 0.5, 0.65, 0.25, 0.8];
    const fxs = kind === 'frame' ? [0.97, 0.03, 0.5] : [0.85, 0.75, 0.65, 0.92, 0.55, 0.45];
    for (const fy of fys)
      for (const fx of fxs) {
        const q: [number, number] = [b.x0 + (b.x1 - b.x0) * fx, b.y0 + (b.y1 - b.y0) * fy];
        if (!pt && insidePoly(best.poly, q) && !best.shadow.some((sp) => insidePoly(sp, q))) pt = q;
      }
    if (pt) targets.push({ kind, u: pt[0], y: pt[1] });
  }

  return {
    targets,
    faces: items.map((it) => ({
      d: multiPolygonPath([it.poly]),
      fill: it.fill,
      kind: it.kind,
      depth: it.depth,
      lines: it.lines,
      sash: it.sash,
      shadow: it.shadow.length ? multiPolygonPath(it.shadow) : '',
      tag: it.tag ? (() => {
        const b = bbox(it.poly);
        return { text: it.tag, u: (b.x0 + b.x1) / 2, top: b.y0, bottom: b.y1 };
      })() : undefined,
    })),
    profile,
    cut: '',
    roofCut: '',
    uMin,
    uMax,
    zMax,
    rooms: [],
  };
}

/* ── Sections ──────────────────────────────────────────────────────── */

/** The u-range where the plane depth = 0 crosses a closed polygon in plan. */
function crossRange(view: View, poly: { x: number; y: number }[]): [number, number] | null {
  const us: number[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const da = depthOf(view, a);
    const db = depthOf(view, b);
    if (da === 0) us.push(uOf(view, a));
    if ((da > 0) !== (db > 0) && da !== db) {
      const t = da / (da - db);
      us.push(uOf(view, { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }));
    }
  }
  if (us.length < 2) return null;
  return [Math.min(...us), Math.max(...us)];
}

const rect = (u0: number, u1: number, z0: number, z1: number) => `M${u0} ${-z1}L${u1} ${-z1}L${u1} ${-z0}L${u0} ${-z0}Z`;

function levelCut(view: View, lvl: FloorLevel, isGround: boolean): string {
  let d = '';
  for (const w of lvl.walls) {
    const f = wallFrame(w);
    if (f.length < 0.01) continue;
    const t = w.thickness / 2;
    const P = (s: number, off: number) => ({ x: w.start.x + f.dir.x * s + f.n.x * off, y: w.start.y + f.dir.y * s + f.n.y * off });
    const range = crossRange(view, [P(-t, -t), P(f.length + t, -t), P(f.length + t, t), P(-t, t)]);
    if (!range) continue;
    const z0 = lvl.elevation;
    const z1 = z0 + w.height;
    // Where does the plane cross the wall centreline? Openings there leave a gap in the cut.
    const d0 = depthOf(view, w.start);
    const d1 = depthOf(view, w.end);
    let gaps: [number, number][] = [];
    if ((d0 > 0) !== (d1 > 0)) {
      const sc = (d0 / (d0 - d1)) * f.length;
      gaps = lvl.openings
        .filter((o) => o.wallId === w.id && Math.abs(o.offset * f.length - sc) <= o.width / 2)
        .map((o) => {
          const oz0 = z0 + (o.kind === 'door' ? 0 : o.sillHeight);
          return [oz0, oz0 + o.height] as [number, number];
        })
        .sort((a, b) => a[0] - b[0]);
    }
    let z = z0;
    for (const [g0, g1] of gaps) {
      if (g0 > z) d += rect(range[0], range[1], z, g0);
      z = Math.max(z, g1);
    }
    if (z < z1) d += rect(range[0], range[1], z, z1);
  }
  const b = levelBounds(lvl);
  const slab = crossRange(view, [
    { x: b.minX, y: b.minY },
    { x: b.maxX, y: b.minY },
    { x: b.maxX, y: b.maxY },
    { x: b.minX, y: b.maxY },
  ]);
  if (slab) d += rect(slab[0], slab[1], lvl.elevation - (isGround ? 0.15 : lvl.slabThickness), lvl.elevation);
  return d;
}

export function sectionDrawing(model: BuildingProject, frame: BuildingFrame, s: SectionLine): { view: View; drawing: Drawing } {
  const dx = s.end.x - s.start.x;
  const dy = s.end.y - s.start.y;
  const L = Math.hypot(dx, dy) || 1;
  const view: View = { look: { x: -dy / L, y: dx / L }, origin: s.start };
  const drawing = project(frame, view, { section: true });

  drawing.cut = model.levels.map((l, i) => levelCut(view, l, i === 0)).join('');

  // Roof: where the plane crosses each roof plane, drawn as a band.
  let roof = '';
  for (const pl of frame.roofPlanes) {
    const pts: { u: number; z: number }[] = [];
    for (let i = 0; i < pl.pts.length; i++) {
      const a = pl.pts[i];
      const b = pl.pts[(i + 1) % pl.pts.length];
      const da = depthOf(view, a);
      const db = depthOf(view, b);
      if ((da >= 0) !== (db >= 0)) {
        const t = da / (da - db);
        pts.push({ u: uOf(view, { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }), z: a.z + (b.z - a.z) * t });
      }
    }
    if (pts.length >= 2) {
      const [p, q] = pts;
      const th = 0.18;
      roof += `M${p.u} ${-p.z}L${q.u} ${-q.z}L${q.u} ${-(q.z - th)}L${p.u} ${-(p.z - th)}Z`;
    }
  }
  drawing.roofCut = roof;

  // Gable and shed infill walls above the plate are cut too, so the roof meets solid wall.
  for (const f of frame.faces) {
    if (f.kind !== 'wall' || f.order !== 1) continue;
    const hits: { u: number; z: number }[] = [];
    for (let i = 0; i < f.pts.length; i++) {
      const a = f.pts[i];
      const b = f.pts[(i + 1) % f.pts.length];
      const da = depthOf(view, a);
      const db = depthOf(view, b);
      if ((da >= 0) !== (db >= 0)) {
        const t = da / (da - db);
        hits.push({ u: uOf(view, { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }), z: a.z + (b.z - a.z) * t });
      }
    }
    if (hits.length >= 2) {
      const u = (hits[0].u + hits[1].u) / 2;
      drawing.cut += rect(u - 0.115, u + 0.115, Math.min(hits[0].z, hits[1].z), Math.max(hits[0].z, hits[1].z));
    }
  }

  // Room names where the plane passes through a room.
  for (const lvl of model.levels) {
    for (const r of lvl.rooms) {
      const range = crossRange(view, r.polygon);
      if (range && range[1] - range[0] > 1.2) drawing.rooms.push({ name: r.name, u: (range[0] + range[1]) / 2, z: lvl.elevation + 2.55, w: range[1] - range[0] });
    }
  }
  return { view, drawing };
}

/** Two default sections through the middle when the project has none drawn. */
export function defaultSections(model: BuildingProject): SectionLine[] {
  if (model.sections.length) return model.sections;
  const b = levelBounds(model.levels[0]);
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  return [
    { id: 'auto-a', label: 'A-A', start: { x: b.minX - 1, y: cy }, end: { x: b.maxX + 1, y: cy } },
    { id: 'auto-b', label: 'B-B', start: { x: cx, y: b.maxY + 1 }, end: { x: cx, y: b.minY - 1 } },
  ];
}

export const ELEVATIONS: { id: 'north' | 'south' | 'east' | 'west'; name: string; look: View['look'] }[] = [
  { id: 'south', name: 'South elevation', look: { x: 0, y: -1 } },
  { id: 'north', name: 'North elevation', look: { x: 0, y: 1 } },
  { id: 'east', name: 'East elevation', look: { x: -1, y: 0 } },
  { id: 'west', name: 'West elevation', look: { x: 1, y: 0 } },
];

/** Position across the picture plane of a plan point, for grid bubbles and dimensions. */
export const uAt = (view: View, p: { x: number; y: number }) => uOf(view, p);
