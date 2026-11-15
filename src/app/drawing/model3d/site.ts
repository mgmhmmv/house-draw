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

  const runs: SiteRun[] = [];
  let wallLength = 0;
  if (s.boundary)
    for (const side of ['N', 'E', 'S', 'W'] as PlotSide[]) {
      const L = len(side);
      const cuts = gaps[side].sort((p, q) => p[0] - q[0]);
      let t = 0;
      for (const [a, b] of [...cuts, [L, L] as [number, number]]) {
        if (a - t > 0.05) {
          runs.push({ a: along(side, t), b: along(side, a), side });
          wallLength += a - t;
        }
        t = Math.max(t, b);
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

  return { plot: s.plot, boundary: s.boundary, height: s.boundaryHeight, thickness: s.boundaryThickness, runs, gates, meter, wallLength };
}
