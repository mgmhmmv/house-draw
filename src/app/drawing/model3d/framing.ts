/**
 * The roof structure that carries the covering: wall plates on the top-floor walls, then either
 * trusses (top and bottom chords with webs) or rafters (with a ridge board, hip rafters and
 * ceiling joists), and purlins or battens across them right under the covering.
 *
 * Every member is a straight piece with a section, placed in model space (x east, y south,
 * z up) from the same roof planes the covering uses, so the 3D model, sections, roof plan and
 * the bill of quantities all agree.
 */
import { getRoofStructure, ROOF_STRUCTURE_META, type BuildingProject, type MemberSection, type RoofStructureMeta } from '../../../model/types';
import { buildFrame, levelBounds, type V3 } from './faces';

export type MemberKind = 'plate' | 'chord' | 'web' | 'rafter' | 'ridge' | 'hip' | 'joist' | 'purlin';

export interface Member {
  kind: MemberKind;
  a: V3;
  b: V3;
  sec: MemberSection;
  /** Which way the member's depth points (unit vector, model space). */
  up: V3;
  /** Truss or rafter number, for marks on drawings. */
  n?: number;
}

export interface RoofFraming {
  meta: RoofStructureMeta;
  spacing: number;
  purlinSpacing: number;
  members: Member[];
  /** Trusses (or rafter lines) in plan, for the roof plan: x/y line and its mark. */
  marks: { a: { x: number; y: number }; b: { x: number; y: number }; tag: string }[];
  trussCount: number;
  /** Plate (wall top) and the top of the plate. */
  plateZ: number;
}

const v = (x: number, y: number, z: number): V3 => ({ x, y, z });
const len = (m: Member) => Math.hypot(m.b.x - m.a.x, m.b.y - m.a.y, m.b.z - m.a.z);
export const memberLength = len;

interface Plane {
  pts: V3[];
  n: V3;
  z: (x: number, y: number) => number;
}

function planeOf(pts: V3[]): Plane {
  const [a, b, c] = pts;
  let n = v((b.y - a.y) * (c.z - a.z) - (b.z - a.z) * (c.y - a.y), (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z), (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
  if (n.z < 0) n = v(-n.x, -n.y, -n.z);
  const l = Math.hypot(n.x, n.y, n.z) || 1;
  n = v(n.x / l, n.y / l, n.z / l);
  return { pts, n, z: (x, y) => a.z - (n.x * (x - a.x) + n.y * (y - a.y)) / (n.z || 1e-9) };
}

/** Horizontal cut of a planar polygon at height z: the segment where it crosses. */
function contour(pts: V3[], z: number): [V3, V3] | null {
  const hits: V3[] = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    if ((p.z - z) * (q.z - z) < 0 || (Math.abs(p.z - z) < 1e-9 && Math.abs(q.z - z) > 1e-9)) {
      const t = (z - p.z) / (q.z - p.z);
      hits.push(v(p.x + (q.x - p.x) * t, p.y + (q.y - p.y) * t, z));
    }
  }
  if (hits.length < 2) return null;
  // Furthest pair (a convex polygon gives exactly two).
  let best: [V3, V3] = [hits[0], hits[1]];
  let d = 0;
  for (let i = 0; i < hits.length; i++)
    for (let j = i + 1; j < hits.length; j++) {
      const dd = Math.hypot(hits[i].x - hits[j].x, hits[i].y - hits[j].y);
      if (dd > d) {
        d = dd;
        best = [hits[i], hits[j]];
      }
    }
  return d > 0.05 ? best : null;
}

/** Distance from p along direction dir (plan) to where it leaves the polygon (plan). */
function exitDistance(poly: V3[], p: { x: number; y: number }, dir: { x: number; y: number }) {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const den = dir.x * ey - dir.y * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((a.x - p.x) * ey - (a.y - p.y) * ex) / den;
    const s = ((a.x - p.x) * dir.y - (a.y - p.y) * dir.x) / den;
    if (t > 1e-4 && s >= -1e-6 && s <= 1 + 1e-6) best = Math.min(best, t);
  }
  return best;
}

export function roofFraming(model: BuildingProject): RoofFraming | null {
  if (model.roof.type === 'flat' || !model.levels.length || (model.roof.sections && model.roof.sections.length > 0)) return null;
  const cfg = getRoofStructure(model.roof);
  const meta = ROOF_STRUCTURE_META[cfg.system];
  const spacing = Math.min(2.4, Math.max(0.3, cfg.spacing));
  const purlinSpacing = Math.min(2, Math.max(0.2, cfg.purlinSpacing));
  const frame = buildFrame(model);
  const top = model.levels[model.levels.length - 1];
  const b = levelBounds(top);
  const oh = model.roof.overhang;
  const planes = frame.roofPlanes.map((p) => planeOf(p.pts));
  if (!planes.length) return null;
  const skin = (x: number, y: number) => Math.min(...planes.map((p) => p.z(x, y)));
  const members: Member[] = [];
  const marks: RoofFraming['marks'] = [];
  const UP = v(0, 0, 1);
  const plateTop = frame.eaveZ + meta.plate.d;
  const gap = 0.035; // clearance under the covering, so angled member ends never show through

  // Wall plates on every external wall of the top floor.
  for (const w of top.walls.filter((w) => w.isExterior)) {
    const z = frame.eaveZ + meta.plate.d / 2;
    members.push({ kind: 'plate', a: v(w.start.x, w.start.y, z), b: v(w.end.x, w.end.y, z), sec: meta.plate, up: UP });
  }

  const W = b.maxX - b.minX + 2 * oh;
  const D = b.maxY - b.minY + 2 * oh;
  const alongX = W >= D; // ridge runs along x: trusses span y
  // Centreline height of a member of depth d sitting under the purlins at (x, y).
  const under = (x: number, y: number, d: number) => skin(x, y) - gap - meta.purlin.d - d / 2;
  const P = (s: number, t: number, z: number) => (alongX ? v(s, t, z) : v(t, s, z));

  if (meta.kind === 'truss') {
    // Trusses across the short span, from wall to wall along the ridge, tails out to the eaves.
    const s0 = (alongX ? b.minX : b.minY) + 0.06;
    const s1 = (alongX ? b.maxX : b.maxY) - 0.06;
    const t0 = alongX ? b.minY : b.minX;
    const t1 = alongX ? b.maxY : b.maxX;
    const count = Math.max(2, Math.ceil((s1 - s0) / spacing) + 1);
    const dc = meta.chord.d;
    const zBot = plateTop + dc / 2;
    const span = t1 - t0;
    const panels = Math.max(4, 2 * Math.round(span / 2.4));
    for (let i = 0; i < count; i++) {
      const s = s0 + ((s1 - s0) * i) / (count - 1);
      const n = i + 1;
      // Over the walls the top chord never drops below the bottom chord; the tails beyond the
      // walls simply follow the covering down to the fascia.
      const topAt = (t: number) => {
        const u = under(alongX ? s : t, alongX ? t : s, dc);
        return t < t0 || t > t1 ? u : Math.max(zBot + dc, u);
      };
      // Top chord: follow the covering, eave to eave, breaking only where the slope changes.
      // Tails stop behind the fascia, as plumb-cut rafter ends do.
      const tail = Math.max(0, oh - 0.12);
      const ts: number[] = [];
      for (let t = t0 - tail; t <= t1 + tail + 1e-6; t += 0.25) ts.push(Math.min(t, t1 + tail));
      if (ts[ts.length - 1] < t1 + tail - 1e-6) ts.push(t1 + tail);
      const pts = ts.map((t) => ({ t, z: topAt(t) }));
      const keep = pts.filter((p, k) => {
        if (k === 0 || k === pts.length - 1) return true;
        const a = pts[k - 1];
        const c = pts[k + 1];
        const zc = a.z + ((p.t - a.t) / (c.t - a.t)) * (c.z - a.z);
        return Math.abs(zc - p.z) > 1e-3;
      });
      for (let k = 1; k < keep.length; k++) members.push({ kind: 'chord', a: P(s, keep[k - 1].t, keep[k - 1].z), b: P(s, keep[k].t, keep[k].z), sec: meta.chord, up: UP, n });
      // Bottom chord (ceiling tie) wall to wall.
      members.push({ kind: 'chord', a: P(s, t0, zBot), b: P(s, t1, zBot), sec: meta.chord, up: UP, n });
      // Webs: verticals at panel points, diagonals leaning to the middle (Howe).
      const tp = Array.from({ length: panels + 1 }, (_, k) => t0 + (span * k) / panels);
      const mid = (t0 + t1) / 2;
      tp.forEach((t, k) => {
        const zt = topAt(t) - dc / 2;
        if (zt - zBot > dc) members.push({ kind: 'web', a: P(s, t, zBot + dc / 2), b: P(s, t, zt), sec: meta.web, up: UP, n });
        if (k < panels) {
          const t2 = tp[k + 1];
          const a = t2 <= mid + 1e-6 ? P(s, t, zBot + dc / 2) : P(s, t, topAt(t) - dc / 2);
          const c = t2 <= mid + 1e-6 ? P(s, t2, topAt(t2) - dc / 2) : P(s, t2, zBot + dc / 2);
          if (Math.abs(a.z - c.z) > dc * 1.5) members.push({ kind: 'web', a, b: c, sec: meta.web, up: UP, n });
        }
      });
      const ma = alongX ? { x: s, y: t0 - oh } : { x: t0 - oh, y: s };
      const mb = alongX ? { x: s, y: t1 + oh } : { x: t1 + oh, y: s };
      marks.push({ a: ma, b: mb, tag: `T${n}` });
    }
  }

  // Rafters: on every plane for rafter roofs; on hip ends for truss roofs (jack rafters).
  let rafterNo = 0;
  for (const pl of planes) {
    const h = Math.hypot(pl.n.x, pl.n.y);
    if (h < 1e-6) continue;
    const down = { x: pl.n.x / h, y: pl.n.y / h };
    const isHipEnd = pl.pts.length === 3 || Math.abs(alongX ? down.y : down.x) < 0.5;
    if (meta.kind === 'truss' && !isHipEnd) continue;
    // Eave edge: the lowest horizontal edge.
    let eave: [V3, V3] | null = null;
    for (let i = 0; i < pl.pts.length; i++) {
      const p = pl.pts[i];
      const q = pl.pts[(i + 1) % pl.pts.length];
      if (Math.abs(p.z - q.z) < 1e-6 && Math.abs(p.z - frame.eaveZ) < 1e-3) eave = [p, q];
    }
    if (!eave) continue;
    const ex = eave[1].x - eave[0].x;
    const ey = eave[1].y - eave[0].y;
    const el = Math.hypot(ex, ey);
    const nR = Math.max(1, Math.round(el / spacing));
    const sec = meta.chord;
    for (let k = 0; k <= nR; k++) {
      const f = Math.min(0.98, Math.max(0.02, k / nR));
      // Start just behind the fascia line.
      const p0 = { x: eave[0].x + ex * f - down.x * 0.12, y: eave[0].y + ey * f - down.y * 0.12 };
      const uphill = { x: -down.x, y: -down.y };
      let dist = exitDistance(pl.pts, p0, uphill);
      if (!isFinite(dist)) continue;
      // Jack rafters on a truss roof stop at the end truss; full rafters run to the ridge/hip.
      if (meta.kind === 'truss') {
        const wallLine = alongX ? (down.x < 0 ? b.minX : b.maxX) : down.y < 0 ? b.minY : b.maxY;
        const toWall = Math.abs((alongX ? p0.x : p0.y) - wallLine) + 0.6;
        dist = Math.min(dist, toWall);
      }
      if (dist < 0.3) continue;
      const p1 = { x: p0.x + uphill.x * dist, y: p0.y + uphill.y * dist };
      const off = gap + meta.purlin.d + sec.d / 2;
      // Offset perpendicular to the plane, under the covering.
      const a = v(p0.x - pl.n.x * off, p0.y - pl.n.y * off, pl.z(p0.x, p0.y) - pl.n.z * off);
      const c = v(p1.x - pl.n.x * off, p1.y - pl.n.y * off, pl.z(p1.x, p1.y) - pl.n.z * off);
      members.push({ kind: 'rafter', a, b: c, sec, up: pl.n, n: ++rafterNo });
    }
  }

  if (meta.kind === 'rafter') {
    // Ridge board and hip rafters along the ridge/hip lines.
    for (const [a, c] of frame.ridgeEdges) {
      const horizontal = Math.abs(a.z - c.z) < 1e-3;
      const sec = meta.ridge;
      const off = gap + meta.purlin.d + sec.d / 2;
      // Sloping edges are hips on a hip roof, verge (barge) rafters on gables and sheds.
      const kind: MemberKind = horizontal ? 'ridge' : model.roof.type === 'hip' ? 'hip' : 'rafter';
      members.push({ kind, a: v(a.x, a.y, a.z - off), b: v(c.x, c.y, c.z - off), sec: kind === 'rafter' ? meta.chord : sec, up: UP });
    }
    // Ceiling joists across the short span at plate level.
    const s0 = (alongX ? b.minX : b.minY) + 0.05;
    const s1 = (alongX ? b.maxX : b.maxY) - 0.05;
    const t0 = alongX ? b.minY : b.minX;
    const t1 = alongX ? b.maxY : b.maxX;
    const nJ = Math.max(2, Math.ceil((s1 - s0) / spacing) + 1);
    for (let i = 0; i < nJ; i++) {
      const s = s0 + ((s1 - s0) * i) / (nJ - 1);
      members.push({ kind: 'joist', a: P(s, t0, plateTop + meta.joist.d / 2), b: P(s, t1, plateTop + meta.joist.d / 2), sec: meta.joist, up: UP });
      const ma = alongX ? { x: s, y: t0 - oh } : { x: t0 - oh, y: s };
      const mb = alongX ? { x: s, y: t1 + oh } : { x: t1 + oh, y: s };
      marks.push({ a: ma, b: mb, tag: `R${i + 1}` });
    }
  }

  // Purlins / battens: level lines across each plane, from just above the eave to the ridge.
  for (const pl of planes) {
    const zTop = Math.max(...pl.pts.map((p) => p.z));
    const sinP = Math.sqrt(Math.max(0, 1 - pl.n.z * pl.n.z));
    if (sinP < 1e-3) continue;
    const dz = purlinSpacing * sinP;
    for (let z = frame.eaveZ + 0.1 * sinP; z < zTop - 0.05 * sinP; z += dz) {
      const seg = contour(pl.pts, z);
      if (!seg) continue;
      const off = gap + meta.purlin.d / 2;
      const [a, c] = seg.map((p) => v(p.x - pl.n.x * off, p.y - pl.n.y * off, p.z - pl.n.z * off));
      members.push({ kind: 'purlin', a, b: c, sec: meta.purlin, up: pl.n });
    }
    // One right at the ridge on each side.
    const seg = contour(pl.pts, zTop - 0.12 * sinP);
    if (seg) {
      const off = gap + meta.purlin.d / 2;
      const [a, c] = seg.map((p) => v(p.x - pl.n.x * off, p.y - pl.n.y * off, p.z - pl.n.z * off));
      members.push({ kind: 'purlin', a, b: c, sec: meta.purlin, up: pl.n });
    }
  }

  const trussCount = meta.kind === 'truss' ? marks.length : 0;
  return { meta, spacing, purlinSpacing, members, marks, trussCount, plateZ: frame.eaveZ };
}

/** Quantities for the bill: lengths by member kind, timber volume or steel weight, counts. */
export function framingQuantities(f: RoofFraming) {
  const byKind = new Map<MemberKind, number>();
  let volume = 0;
  let kg = 0;
  for (const m of f.members) {
    if (m.kind === 'purlin') continue;
    const l = len(m);
    volume += l * m.sec.w * m.sec.d;
    kg += l * (m.sec.kgPerM ?? 0);
  }
  for (const m of f.members) byKind.set(m.kind, (byKind.get(m.kind) ?? 0) + len(m));
  const get = (k: MemberKind) => byKind.get(k) ?? 0;
  const rafters = f.members.filter((m) => m.kind === 'rafter').length;
  return {
    trusses: f.trussCount,
    rafters,
    trussLm: get('chord') + get('web'),
    rafterLm: get('rafter') + get('ridge') + get('hip'),
    joistLm: get('joist'),
    purlinLm: get('purlin'),
    plateLm: get('plate'),
    timberM3: f.meta.material === 'timber' ? volume * 1.1 : 0, // + 10% waste
    steelKg: f.meta.material === 'steel' ? kg * 1.05 : 0, // + 5% laps and offcuts
    connectors: 2 * (f.trussCount || rafters) + Math.round(get('purlin') / f.spacing),
  };
}
