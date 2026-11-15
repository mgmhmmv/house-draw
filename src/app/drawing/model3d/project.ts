/**
 * Orthographic projection of the face model onto a vertical picture plane.
 *
 * Hidden surfaces are handled by back-face culling plus painter's ordering (far to near),
 * which is exact for the convex, mostly axis-aligned surfaces a house is made of and keeps
 * the output as filled vector paths. Sections clip every face against the cut plane and add
 * poché for whatever the plane passes through.
 */
import type { BuildingProject, FloorLevel, SectionLine } from '../../../model/types';
import { wallFrame } from '../plan/kernel';
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
}

export interface Drawing {
  faces: Projected[];
  /** Cut poché (sections only), as SVG path data. */
  cut: string;
  /** Roof cut band (sections only). */
  roofCut: string;
  uMin: number;
  uMax: number;
  zMax: number;
  rooms: { name: string; u: number; z: number; w: number }[];
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

const ringPath = (v: View, ring: V3[]) =>
  ring.map((p, i) => `${i ? 'L' : 'M'}${uOf(v, p).toFixed(3)} ${(-p.z).toFixed(3)}`).join('') + 'Z';

export function project(frame: BuildingFrame, view: View, opts: { section?: boolean } = {}): Drawing {
  const items: Projected[] = [];
  let uMin = Infinity;
  let uMax = -Infinity;
  let zMax = 0;

  for (const f of frame.faces) {
    // Back-face cull: keep faces whose normal points toward the viewer.
    if (f.n.x * view.look.x + f.n.y * view.look.y > -1e-4) continue;
    let pts = f.pts;
    let holes = f.holes ?? [];
    if (opts.section) {
      pts = clipFront(view, pts);
      if (pts.length < 3) continue;
      holes = holes.map((h) => clipFront(view, h)).filter((h) => h.length >= 3);
    }
    let dsum = 0;
    for (const p of pts) {
      const u = uOf(view, p);
      uMin = Math.min(uMin, u);
      uMax = Math.max(uMax, u);
      zMax = Math.max(zMax, p.z);
      dsum += depthOf(view, p);
    }
    const lines = (f.lines ?? [])
      .filter(([a, b]) => !opts.section || (depthOf(view, a) >= 0 && depthOf(view, b) >= 0))
      .map(([a, b]) => `M${uOf(view, a).toFixed(3)} ${(-a.z).toFixed(3)}L${uOf(view, b).toFixed(3)} ${(-b.z).toFixed(3)}`)
      .join('');
    items.push({
      d: ringPath(view, pts) + holes.map((h) => ringPath(view, h)).join(''),
      fill: f.fill,
      kind: f.kind,
      depth: dsum / pts.length - f.order * 0.002,
      lines,
    });
  }

  // Far to near.
  items.sort((a, b) => b.depth - a.depth);

  // Aerial perspective: surfaces further back fade toward the paper.
  if (items.length) {
    const dNear = Math.min(...items.map((i) => i.depth));
    const dFar = Math.max(...items.map((i) => i.depth));
    const span = Math.max(1, dFar - dNear);
    for (const it of items) {
      const f = (it.depth - dNear) / span;
      if (it.fill.startsWith('#')) it.fill = tint(it.fill, f * 0.45);
    }
  }

  return { faces: items, cut: '', roofCut: '', uMin, uMax, zMax, rooms: [] };
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
