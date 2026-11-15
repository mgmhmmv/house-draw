/**
 * Plan geometry kernel: turns the BIM model into drawable 2D primitives.
 *
 * The key difference from the old renderer is that walls are no longer drawn one rectangle
 * at a time. Every wall on a level is unioned into one poché shape, then openings are cut
 * out of it, so corners, tees and crossings join cleanly with no seams or overlaps.
 */
import polygonClipping, { type MultiPolygon, type Polygon as PCPolygon, type Ring } from 'polygon-clipping';
import polylabel from 'polylabel';
import type { FloorLevel, Opening, Point2D, Room, Wall } from '../../../model/types';
import { polygonArea } from '../../../engine/geometry';

export type Vec = Point2D;

const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a: Vec, k: number): Vec => ({ x: a.x * k, y: a.y * k });
const len = (a: Vec) => Math.hypot(a.x, a.y);
const norm = (a: Vec): Vec => {
  const l = len(a) || 1;
  return { x: a.x / l, y: a.y / l };
};
const perp = (a: Vec): Vec => ({ x: -a.y, y: a.x });

export interface WallFrame {
  wall: Wall;
  dir: Vec; // unit along the wall
  n: Vec; // unit normal (left of dir)
  length: number;
}

export function wallFrame(w: Wall): WallFrame {
  const d = sub(w.end, w.start);
  const dir = norm(d);
  return { wall: w, dir, n: perp(dir), length: len(d) };
}

/** Point on the wall centerline at distance s from start, shifted by o along the normal. */
export const along = (f: WallFrame, s: number, o = 0): Vec => add(add(f.wall.start, mul(f.dir, s)), mul(f.n, o));

const toRing = (pts: Vec[]): Ring => {
  const r = pts.map((p) => [p.x, p.y] as [number, number]);
  r.push(r[0]);
  return r;
};

/** Wall body, extended by half its thickness at each end so L-corners fill when unioned. */
function wallQuad(f: WallFrame): PCPolygon {
  const t = f.wall.thickness / 2;
  const s0 = -t;
  const s1 = f.length + t;
  return [toRing([along(f, s0, -t), along(f, s1, -t), along(f, s1, t), along(f, s0, t)])];
}

/** Rectangle removed from the wall for an opening (slightly deeper than the wall). */
function openingCut(f: WallFrame, o: Opening): PCPolygon {
  const c = o.offset * f.length;
  const h = o.width / 2;
  const t = f.wall.thickness / 2 + 0.01;
  return [toRing([along(f, c - h, -t), along(f, c + h, -t), along(f, c + h, t), along(f, c - h, t)])];
}

export interface PlanGeometry {
  /** Unioned walls with openings removed — one compound path. */
  pochePath: string;
  frames: Map<string, WallFrame>;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

export function multiPolygonPath(mp: MultiPolygon): string {
  let d = '';
  for (const poly of mp)
    for (const ring of poly) {
      ring.forEach(([x, y], i) => (d += `${i ? 'L' : 'M'}${x.toFixed(4)} ${y.toFixed(4)}`));
      d += 'Z';
    }
  return d;
}

export function buildPlanGeometry(level: FloorLevel, walls: Wall[] = level.walls): PlanGeometry {
  const frames = new Map<string, WallFrame>();
  const quads: PCPolygon[] = [];
  for (const w of walls) {
    const f = wallFrame(w);
    if (f.length < 1e-3) continue;
    frames.set(w.id, f);
    quads.push(wallQuad(f));
  }
  const cuts: PCPolygon[] = [];
  for (const o of level.openings) {
    const f = frames.get(o.wallId);
    if (f) cuts.push(openingCut(f, o));
  }

  let poche: MultiPolygon = [];
  try {
    if (quads.length) poche = polygonClipping.union(quads[0], ...quads.slice(1));
    if (cuts.length && poche.length) poche = polygonClipping.difference(poche, ...cuts);
  } catch {
    // Degenerate input (e.g. a wall drawn twice exactly on top of itself): fall back to raw quads.
    poche = quads;
  }

  const xs: number[] = [];
  const ys: number[] = [];
  for (const poly of poche) for (const [x, y] of poly[0]) (xs.push(x), ys.push(y));
  for (const r of level.rooms) for (const p of r.polygon) (xs.push(p.x), ys.push(p.y));
  const bounds = xs.length
    ? { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) }
    : { minX: 0, minY: 0, maxX: 12, maxY: 10 };

  return { pochePath: multiPolygonPath(poche), frames, bounds };
}

/* ── Openings ──────────────────────────────────────────────────────── */

export interface OpeningSymbol {
  opening: Opening;
  /** Thin lines (window frames/glass, door jambs). */
  lines: [Vec, Vec][];
  /** Door leaves (drawn heavier). */
  leaves: [Vec, Vec][];
  /** SVG arc paths for door swings. */
  arcs: string[];
  /** Hit area polygon. */
  hit: Vec[];
  center: Vec;
}

export function openingSymbol(f: WallFrame, o: Opening): OpeningSymbol {
  const c = o.offset * f.length;
  const h = o.width / 2;
  const t = f.wall.thickness / 2;
  const s0 = c - h;
  const s1 = c + h;
  const side = o.swingDirection >= 0 ? 1 : -1;
  const lines: [Vec, Vec][] = [];
  const leaves: [Vec, Vec][] = [];
  const arcs: string[] = [];
  const P = (s: number, off: number) => along(f, s, off);
  const arc = (from: Vec, to: Vec, r: number, sweep: 0 | 1) =>
    `M${from.x} ${from.y}A${r} ${r} 0 0 ${sweep} ${to.x} ${to.y}`;

  if (o.kind === 'window') {
    // Frame lines on both faces, plus a double glass line on the centerline.
    lines.push([P(s0, -t), P(s1, -t)], [P(s0, t), P(s1, t)]);
    lines.push([P(s0, -0.025), P(s1, -0.025)], [P(s0, 0.025), P(s1, 0.025)]);
    lines.push([P(s0, -t), P(s0, t)], [P(s1, -t), P(s1, t)]);
    if (o.style === 'bay') {
      const d = Math.min(0.6, o.width * 0.3);
      lines.push([P(s0, t), P(s0 + d, t + d)], [P(s0 + d, t + d), P(s1 - d, t + d)], [P(s1 - d, t + d), P(s1, t)]);
    }
  } else {
    lines.push([P(s0, -t), P(s0, t)], [P(s1, -t), P(s1, t)]);
    const face = side * t;
    const sweepFlag = (k: number): 0 | 1 => ((side > 0) === (k > 0) ? 1 : 0);
    if (o.style === 'sliding') {
      lines.push([P(s0, -0.04), P(c + 0.05, -0.04)], [P(c - 0.05, 0.04), P(s1, 0.04)]);
    } else if (o.style === 'garage') {
      lines.push([P(s0, -t), P(s1, -t)]);
      leaves.push([P(s0, -t - 0.02), P(s1, -t - 0.02)]);
    } else if (o.style === 'double') {
      const r = h;
      const hingeA = P(s0, face);
      const tipA = add(hingeA, mul(f.n, side * r));
      leaves.push([hingeA, tipA]);
      arcs.push(arc(tipA, P(c, face), r, sweepFlag(-1)));
      const hingeB = P(s1, face);
      const tipB = add(hingeB, mul(f.n, side * r));
      leaves.push([hingeB, tipB]);
      arcs.push(arc(tipB, P(c, face), r, sweepFlag(1)));
    } else {
      const r = o.width;
      const hinge = P(s0, face);
      const tip = add(hinge, mul(f.n, side * r));
      leaves.push([hinge, tip]);
      arcs.push(arc(tip, P(s1, face), r, sweepFlag(-1)));
    }
  }

  const reach = o.kind === 'door' && o.style !== 'sliding' && o.style !== 'garage' ? (o.style === 'double' ? h : o.width) : 0;
  const lo = Math.min(-t, side * reach) - 0.05;
  const hi = Math.max(t, side * reach) + 0.05;
  return { opening: o, lines, leaves, arcs, hit: [P(s0, lo), P(s1, lo), P(s1, hi), P(s0, hi)], center: P(c, 0) };
}

/* ── Rooms ─────────────────────────────────────────────────────────── */

export interface RoomTag {
  room: Room;
  at: Vec;
  area: number;
  /** Rough inscribed size, used to shrink or drop the tag in small rooms. */
  room_w: number;
}

export function roomTag(room: Room): RoomTag {
  const ring = room.polygon.map((p) => [p.x, p.y] as [number, number]);
  const at = ring.length >= 3 ? (polylabel([ring], 0.05) as unknown as [number, number] & { distance: number }) : null;
  const xs = room.polygon.map((p) => p.x);
  return {
    room,
    at: at ? { x: at[0], y: at[1] } : room.polygon[0] ?? { x: 0, y: 0 },
    area: polygonArea(room.polygon),
    room_w: at ? at.distance * 2 : Math.max(...xs) - Math.min(...xs),
  };
}

/* ── Dimensions ────────────────────────────────────────────────────── */

export interface DimChain {
  side: 'top' | 'bottom' | 'left' | 'right';
  /** Positions along the side's axis (x for top/bottom, y for left/right). */
  stops: number[];
  /** Coordinate of the dimension line on the other axis. */
  at: number;
  overallAt: number;
}

const uniqSorted = (vals: number[], tol = 0.04) => {
  const s = [...vals].sort((a, b) => a - b);
  const out: number[] = [];
  for (const v of s) if (!out.length || v - out[out.length - 1] > tol) out.push(v);
  return out;
};

/**
 * Exterior dimension strings on four sides: one chain through openings and wall junctions,
 * and one overall dimension outside it — the conventional pair on a general arrangement plan.
 */
export function dimensionChains(level: FloorLevel, geo: PlanGeometry): DimChain[] {
  const { minX, minY, maxX, maxY } = geo.bounds;
  const tol = 0.75;
  const gap1 = 1.1;
  const gap2 = 1.8;
  const chains: DimChain[] = [];

  const sides: { side: DimChain['side']; horizontal: boolean; edge: number; out: number }[] = [
    { side: 'top', horizontal: true, edge: minY, out: -1 },
    { side: 'bottom', horizontal: true, edge: maxY, out: 1 },
    { side: 'left', horizontal: false, edge: minX, out: -1 },
    { side: 'right', horizontal: false, edge: maxX, out: 1 },
  ];

  for (const s of sides) {
    const stops: number[] = [s.horizontal ? minX : minY, s.horizontal ? maxX : maxY];
    for (const f of geo.frames.values()) {
      const w = f.wall;
      const isAlong = s.horizontal ? Math.abs(f.dir.y) < 0.2 : Math.abs(f.dir.x) < 0.2;
      const coord = (p: Vec) => (s.horizontal ? p.y : p.x);
      const axis = (p: Vec) => (s.horizontal ? p.x : p.y);
      if (isAlong && Math.abs(coord(w.start) - s.edge) < tol && Math.abs(coord(w.end) - s.edge) < tol) {
        for (const o of level.openings.filter((x) => x.wallId === w.id)) {
          const c = o.offset * f.length;
          stops.push(axis(along(f, c - o.width / 2)), axis(along(f, c + o.width / 2)));
        }
      } else if (!isAlong) {
        // A wall running into this facade: dimension to its centerline.
        for (const p of [w.start, w.end]) if (Math.abs(coord(p) - s.edge) < tol) stops.push(axis(p));
      }
    }
    chains.push({
      side: s.side,
      stops: uniqSorted(stops),
      at: s.edge + s.out * gap1,
      overallAt: s.edge + s.out * gap2,
    });
  }
  return chains;
}

/** Millimetres, grouped the way drawings print them: 14 500. */
export const fmtMM = (m: number) => Math.round(m * 1000).toLocaleString('en-US').replace(/,/g, '\u2009');

/** Nearest wall to a point within `maxDist`, with the parametric position along it. */
export function nearestWall(level: FloorLevel, p: Vec, maxDist = 0.6): { wall: Wall; t: number; d: number } | null {
  let best: { wall: Wall; t: number; d: number } | null = null;
  for (const w of level.walls) {
    const f = wallFrame(w);
    if (f.length < 1e-3) continue;
    const rel = sub(p, w.start);
    const s = Math.max(0, Math.min(f.length, rel.x * f.dir.x + rel.y * f.dir.y));
    const q = along(f, s);
    const d = len(sub(p, q));
    if (d <= maxDist && (!best || d < best.d)) best = { wall: w, t: s / f.length, d };
  }
  return best;
}
