/**
 * The site laid out: boundary wall runs round the plot with gaps for the gates, each gate and
 * pedestrian door with its position and turn, the canopy over an entrance, and where the meter
 * box sits in the wall. Plans, the 3D model and the bill of quantities all read this.
 */
import { getSite, type BuildingProject, type GateKind, type PlotSide, type SiteGate } from '../../../model/types';

type P = { x: number; y: number };

export interface SiteRun {
  a: P;
  b: P;
  side: PlotSide;
  /** A short piece of a rounded plot corner; `toward` is the arc's centre. */
  toward?: P;
}
export interface SiteGatePlaced {
  gate: SiteGate;
  /** Plan rotation for library items (0 = item's back to the north: spans east–west). */
  rot: number;
  /** Outward normal (towards the street). */
  out: P;
  main: { center: P; width: number; asset: string };
  ped: { center: P; width: number } | null;
  /** The whole entrance span, pier to pier. */
  span: { a: P; b: P };
}
export interface SiteLayout {
  plot: { x: number; y: number; w: number; d: number };
  boundary: boolean;
  height: number;
  thickness: number;
  runs: SiteRun[];
  /** The property line, corner to corner (with the rounded corner, if the plot has one). */
  outline: P[];
  gates: SiteGatePlaced[];
  meter: { at: P; out: P; rot: number } | null;
  /** Total boundary wall length (m), without the openings. */
  wallLength: number;
}

const ASSET: Record<GateKind, string> = { sliding: 'gate_sliding', swing_double: 'gate_swing_double', timber: 'gate_timber', pedestrian: 'gate_pedestrian' };
/** Gate library items are drawn wider than their clear opening (piers): extra per item. */
const PIERS: Record<GateKind, number> = { sliding: 0.6, swing_double: 0.8, timber: 0.7, pedestrian: 0.6 };

export function siteLayout(model: BuildingProject): SiteLayout {
  const s = getSite(model);
  const { x, y, w, d } = s.plot;
  const sides: Record<PlotSide, { a: P; b: P; out: P; rot: number }> = {
    N: { a: { x, y }, b: { x: x + w, y }, out: { x: 0, y: -1 }, rot: 0 },
    S: { a: { x, y: y + d }, b: { x: x + w, y: y + d }, out: { x: 0, y: 1 }, rot: 0 },
    W: { a: { x, y }, b: { x, y: y + d }, out: { x: -1, y: 0 }, rot: 90 },
    E: { a: { x: x + w, y }, b: { x: x + w, y: y + d }, out: { x: 1, y: 0 }, rot: 90 },
  };
  const along = (side: PlotSide, t: number): P => {
    const sd = sides[side];
    const L = Math.hypot(sd.b.x - sd.a.x, sd.b.y - sd.a.y) || 1;
    return { x: sd.a.x + ((sd.b.x - sd.a.x) * t) / L, y: sd.a.y + ((sd.b.y - sd.a.y) * t) / L };
  };
  const len = (side: PlotSide) => (side === 'N' || side === 'S' ? w : d);

  const gates: SiteGatePlaced[] = [];
  const gaps: Record<PlotSide, [number, number][]> = { N: [], S: [], E: [], W: [] };
  for (const g of s.gates) {
    const sd = sides[g.side];
    const mainW = Math.max(0.8, g.width) + PIERS[g.kind];
    const pedW = g.pedestrianWidth > 0 ? g.pedestrianWidth + PIERS.pedestrian : 0;
    const total = mainW + pedW;
    const L = len(g.side);
    const c = Math.min(L - total / 2 - 0.2, Math.max(total / 2 + 0.2, g.at));
    const t0 = c - total / 2;
    gaps[g.side].push([t0, t0 + total]);
    gates.push({
      gate: g,
      rot: sd.rot,
      out: sd.out,
      main: { center: along(g.side, t0 + mainW / 2), width: mainW, asset: ASSET[g.kind] },
      ped: pedW ? { center: along(g.side, t0 + mainW + pedW / 2), width: pedW } : null,
      span: { a: along(g.side, t0), b: along(g.side, t0 + total) },
    });
  }

  // A rounded corner: both sides stop short of it by the radius and an arc joins them.
  const rc = s.roundedCorner && s.roundedCorner.radius > 0 ? { corner: s.roundedCorner.corner, r: Math.min(s.roundedCorner.radius, w / 2, d / 2) } : null;
  const trim = (side: PlotSide): [number, number] => {
    if (!rc) return [0, len(side)];
    const [ns, ew] = [rc.corner[0], rc.corner[1]];
    const L = len(side);
    if (side === 'N' || side === 'S') return side !== ns ? [0, L] : ew === 'W' ? [rc.r, L] : [0, L - rc.r];
    return side !== ew ? [0, L] : ns === 'N' ? [rc.r, L] : [0, L - rc.r];
  };
  const CORNERS: P[] = [{ x, y }, { x: x + w, y }, { x: x + w, y: y + d }, { x, y: y + d }];
  const NAMES = ['NW', 'NE', 'SE', 'SW'];
  let arc: P[] = [];
  let arcCentre: P | null = null;
  if (rc) {
    const q = CORNERS[NAMES.indexOf(rc.corner)];
    const sx = rc.corner[1] === 'W' ? 1 : -1;
    const sy = rc.corner[0] === 'N' ? 1 : -1;
    const c = { x: q.x + sx * rc.r, y: q.y + sy * rc.r };
    arcCentre = c;
    const n = 10;
    // In clockwise order round the plot, from the side before the corner to the side after it.
    const startAngle = { NW: Math.PI, NE: -Math.PI / 2, SE: 0, SW: Math.PI / 2 }[rc.corner];
    arc = Array.from({ length: n + 1 }, (_, i) => {
      const th = startAngle + ((Math.PI / 2) * i) / n;
      return { x: c.x + rc.r * Math.cos(th), y: c.y + rc.r * Math.sin(th) };
    });
  }
  const outline = CORNERS.flatMap((q, i) => (rc && NAMES[i] === rc.corner ? arc : [q]));

  const runs: SiteRun[] = [];
  let wallLength = 0;
  if (s.boundary) {
    for (const side of ['N', 'E', 'S', 'W'] as PlotSide[]) {
      const [t0, t1] = trim(side);
      const cuts = gaps[side].sort((p, q) => p[0] - q[0]);
      let t = t0;
      for (const [a0, b] of [...cuts, [t1, t1] as [number, number]]) {
        const a = Math.min(a0, t1);
        if (a - t > 0.05) {
          runs.push({ a: along(side, t), b: along(side, a), side });
          wallLength += a - t;
        }
        t = Math.max(t, b);
      }
    }
    if (rc && arcCentre)
      for (let i = 0; i < arc.length - 1; i++) {
        runs.push({ a: arc[i], b: arc[i + 1], side: rc.corner[0] as PlotSide, toward: arcCentre });
        wallLength += Math.hypot(arc[i + 1].x - arc[i].x, arc[i + 1].y - arc[i].y);
      }
  }

  // Meter box in the pier beside the pedestrian door (or the main gate), on the street face.
  let meter: SiteLayout['meter'] = null;
  if (s.meterAtGate && gates.length) {
    const g = gates[0];
    const sd = sides[g.gate.side];
    const end = g.span.b;
    const dir = { x: (sd.b.x - sd.a.x) / (len(g.gate.side) || 1), y: (sd.b.y - sd.a.y) / (len(g.gate.side) || 1) };
    meter = { at: { x: end.x + dir.x * 0.45, y: end.y + dir.y * 0.45 }, out: sd.out, rot: sd.rot };
  }

  return { plot: s.plot, boundary: s.boundary, height: s.boundaryHeight, thickness: s.boundaryThickness, runs, outline, gates, meter, wallLength };
}
