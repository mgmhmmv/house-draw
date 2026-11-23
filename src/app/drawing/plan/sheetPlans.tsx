/**
 * Plans that are drawn from the model rather than edited: the roof plan (from the same roof
 * planes, gutters and panels the 3D view and elevations use) and the sewage plan (sanitary
 * fittings run to inspection chambers, a septic tank and a soakaway). Everything is in metres;
 * text sizes are paper sizes at 1:100, kept readable on screen through `k`.
 */
import { useMemo } from 'react';
import type { BuildingProject, FloorLevel } from '../../../model/types';
import { buildFrame } from '../model3d/faces';
import { roofFraming } from '../model3d/framing';
import { siteLayout } from '../model3d/site';
import { assetFor } from '../assets/catalog';
import { assetPlan } from '../assets/render';
import { PlanPrims } from '../assets/PlanSymbol';
import { buildPlanGeometry, fmtMM } from './kernel';
import { INK, INK_2, INK_3, MEP_COLOR, WEIGHT } from '../style';

const NS = 'non-scaling-stroke' as const;
type P = { x: number; y: number };
const pts = (a: P[]) => a.map((p) => `${p.x},${p.y}`).join(' ');
const lvl = (z: number) => `${z > 0.0005 ? '+' : z < -0.0005 ? '' : '±'}${z.toFixed(3)}`;

/* ── Roof plan ─────────────────────────────────────────────────────── */

export function RoofPlan({ model, k }: { model: BuildingProject; k: number }) {
  const frame = useMemo(() => buildFrame(model), [model]);
  const framing = useMemo(() => roofFraming(model), [model]);
  const top = model.levels[model.levels.length - 1];
  const walls = useMemo(() => buildPlanGeometry(top, top.walls.filter((w) => w.isExterior)), [top]);
  const fs = (size: number, px: number) => Math.max(size, px / k);
  const tSmall = fs(0.16, 9.5);
  const tNote = fs(0.18, 10.5);
  const b = frame.bounds;
  const flat = model.roof.type === 'flat';
  const solar = frame.faces.filter((f) => f.kind === 'solar');
  const panelBoxes = solar.map((f) => ({ minX: Math.min(...f.pts.map((q) => q.x)), maxX: Math.max(...f.pts.map((q) => q.x)), minY: Math.min(...f.pts.map((q) => q.y)), maxY: Math.max(...f.pts.map((q) => q.y)) }));

  // Downhill direction and pitch of each plane, for the slope arrows.
  const planes = frame.roofPlanes.map((pl) => {
    const [a, b2, c3] = pl.pts;
    let n = { x: (b2.y - a.y) * (c3.z - a.z) - (b2.z - a.z) * (c3.y - a.y), y: (b2.z - a.z) * (c3.x - a.x) - (b2.x - a.x) * (c3.z - a.z), z: (b2.x - a.x) * (c3.y - a.y) - (b2.y - a.y) * (c3.x - a.x) };
    if (n.z < 0) n = { x: -n.x, y: -n.y, z: -n.z };
    const h = Math.hypot(n.x, n.y);
    const cx = pl.pts.reduce((s, p) => s + p.x, 0) / pl.pts.length;
    const cy = pl.pts.reduce((s, p) => s + p.y, 0) / pl.pts.length;
    const down = h > 1e-3 * Math.abs(n.z) ? { x: n.x / h, y: n.y / h } : null;
    // Keep the arrow clear of the solar panels: slide it sideways along the slope until it is.
    let c = { x: cx, y: cy };
    if (down) {
      const clear = (q: P) => [-0.75, 0, 0.75].every((t) => !panelBoxes.some((bx) => q.x + down.x * t > bx.minX - 0.3 && q.x + down.x * t < bx.maxX + 0.3 && q.y + down.y * t > bx.minY - 0.3 && q.y + down.y * t < bx.maxY + 0.3));
      for (let i = 1; i < 30 && !clear(c); i++) {
        const sgn = i % 2 ? 1 : -1;
        const d = Math.ceil(i / 2) * 0.4 * sgn;
        const q = { x: cx - down.y * d, y: cy + down.x * d };
        if (clear(q) && inPoly(pl.pts, q)) {
          c = q;
          break;
        }
      }
    }
    return { pts: pl.pts, down, c };
  });
  const ridges = frame.ridgeEdges.filter(([a, c]) => Math.abs(a.z - c.z) < 1e-3 && Math.abs(a.z - frame.ridgeZ) < 1e-3);
  const dimY = b.maxY + 1.1;
  const dimX = b.maxX + 1.1;

  return (
    <g>
      {/* Roof planes */}
      {planes.map((pl, i) => (
        <polygon key={i} points={pts(pl.pts)} fill={flat ? '#F2F1ED' : '#F3EFE7'} stroke={INK} strokeWidth={WEIGHT.medium} strokeLinejoin="round" vectorEffect={NS} />
      ))}
      {/* Walls below, dashed */}
      <path d={walls.pochePath} fill="none" stroke={INK_3} strokeWidth={WEIGHT.hair} strokeDasharray="5 3" vectorEffect={NS} />
      {/* Ridges and hips */}
      {frame.ridgeEdges.map(([a, c], i) => (
        <line key={i} x1={a.x} y1={a.y} x2={c.x} y2={c.y} stroke={INK} strokeWidth={WEIGHT.cut} vectorEffect={NS} />
      ))}

      {/* Roof structure under the covering, dashed: trusses with their marks, or rafters */}
      {framing && (
        <g pointerEvents="none">
          {framing.meta.kind === 'truss'
            ? framing.marks.map((m, i) => (
                <g key={i}>
                  <line x1={m.a.x} y1={m.a.y} x2={m.b.x} y2={m.b.y} stroke={INK_2} strokeWidth={WEIGHT.hair} strokeDasharray="6 2 1 2" vectorEffect={NS} />
                  {(i === 0 || i === framing.marks.length - 1 || i % 2 === 0) && (
                    <text
                      x={m.a.x + (m.a.x === m.b.x ? 0 : -0.35)}
                      y={m.a.y + (m.a.y === m.b.y ? 0 : -0.35)}
                      fontSize={tSmall * 0.9}
                      fill={INK_2}
                      fontWeight={600}
                      textAnchor="middle"
                    >
                      {m.tag}
                    </text>
                  )}
                </g>
              ))
            : framing.members
                .filter((m) => m.kind === 'rafter')
                .map((m, i) => <line key={i} x1={m.a.x} y1={m.a.y} x2={m.b.x} y2={m.b.y} stroke={INK_2} strokeWidth={WEIGHT.hair} strokeDasharray="6 2 1 2" vectorEffect={NS} />)}
        </g>
      )}

      {/* Solar panels */}
      {solar.map((f, i) => (
        <g key={i}>
          <polygon points={pts(f.pts)} fill="#DCE4F0" stroke="#3D5A80" strokeWidth={WEIGHT.light} vectorEffect={NS} />
          {(f.lines ?? []).map(([a, c], j) => (
            <line key={j} x1={a.x} y1={a.y} x2={c.x} y2={c.y} stroke="#3D5A80" strokeWidth={WEIGHT.hair * 0.6} vectorEffect={NS} opacity={0.6} />
          ))}
        </g>
      ))}

      {/* Slope arrows: they point down the slope, to the gutter */}
      {planes.map((pl, i) => {
        if (!pl.down) return null;
        const L = 1.3;
        const a = { x: pl.c.x - (pl.down.x * L) / 2, y: pl.c.y - (pl.down.y * L) / 2 };
        const e = { x: pl.c.x + (pl.down.x * L) / 2, y: pl.c.y + (pl.down.y * L) / 2 };
        const s = 0.16;
        const nx = -pl.down.y;
        const ny = pl.down.x;
        const head = `M${e.x} ${e.y}L${e.x - pl.down.x * s * 1.6 + nx * s * 0.6} ${e.y - pl.down.y * s * 1.6 + ny * s * 0.6}L${e.x - pl.down.x * s * 1.6 - nx * s * 0.6} ${e.y - pl.down.y * s * 1.6 - ny * s * 0.6}Z`;
        const t = { x: a.x + nx * 0.28, y: a.y + ny * 0.28 };
        return (
          <g key={i} pointerEvents="none">
            <line x1={a.x} y1={a.y} x2={e.x} y2={e.y} stroke={INK} strokeWidth={WEIGHT.light} vectorEffect={NS} />
            <path d={head} fill={INK} />
            <text x={t.x} y={t.y + tSmall * 0.35} fontSize={tSmall} fill={INK_2} textAnchor="middle" fontWeight={600}>
              {model.roof.pitchDeg}°
            </text>
          </g>
        );
      })}

      {/* Gutters, rainwater pipes and collection */}
      {frame.drainage && (
        <g>
          {frame.drainage.gutters.map((g, i) => (
            <line key={i} x1={g.a.x} y1={g.a.y} x2={g.b.x} y2={g.b.y} stroke={INK_2} strokeWidth={2.2} vectorEffect={NS} />
          ))}
          {frame.drainage.downpipes.map((d, i) => (
            <g key={i}>
              <circle cx={d.top.x} cy={d.top.y} r={0.08} fill="#fff" stroke={INK} strokeWidth={WEIGHT.medium} vectorEffect={NS} />
              <text x={d.top.x + d.out.x * 0.35 + (d.out.x ? 0 : 0.15)} y={d.top.y + d.out.y * 0.35 + tSmall * 0.35} fontSize={tSmall} fill={INK_2} textAnchor={d.out.x < 0 ? 'end' : 'start'}>
                RWP{i + 1}
              </text>
            </g>
          ))}
          {frame.drainage.collection && (
            <g>
              <circle cx={frame.drainage.collection.x} cy={frame.drainage.collection.y} r={frame.drainage.collection.radius} fill="none" stroke={INK_2} strokeWidth={WEIGHT.light} strokeDasharray="4 2" vectorEffect={NS} />
              <text x={frame.drainage.collection.x + frame.drainage.collection.radius + 0.2} y={frame.drainage.collection.y + tSmall * 0.35} fontSize={tSmall} fill={INK_2}>
                {frame.drainage.collection.mode === 'harvesting_tank' ? 'RAINWATER TANK' : frame.drainage.collection.mode === 'underground_cistern' ? 'CISTERN' : 'SOAKAWAY / SPLASH PAD'}
              </text>
            </g>
          )}
        </g>
      )}

      {/* Ridge level */}
      {ridges.slice(0, 1).map(([a, c], i) => (
        <text key={i} x={(a.x + c.x) / 2} y={(a.y + c.y) / 2 - 0.22} fontSize={tSmall} fontWeight={600} fill={INK} textAnchor="middle" stroke="#F3EFE7" strokeWidth={3} style={{ paintOrder: 'stroke' }}>
          RIDGE {lvl(frame.ridgeZ)}
        </text>
      ))}
      {!flat && (
        <text x={(b.minX + b.maxX) / 2} y={b.maxY - 0.3} fontSize={tSmall} fontWeight={600} fill={INK_2} textAnchor="middle">
          EAVE {lvl(frame.eaveZ)}
        </text>
      )}

      {/* Overall dimensions */}
      <Dim a={{ x: b.minX, y: dimY }} b={{ x: b.maxX, y: dimY }} size={tSmall} />
      <Dim a={{ x: dimX, y: b.minY }} b={{ x: dimX, y: b.maxY }} size={tSmall} vertical />

      {/* Notes */}
      <g fontSize={tNote} fill={INK_2}>
        <text x={b.minX} y={dimY + 0.9}>{frame.notes.roof?.toUpperCase()}</text>
        <text x={b.minX} y={dimY + 0.9 + tNote * 1.5}>{`OVERHANG ${fmtMM(model.roof.overhang)} BEYOND WALLS · EXTERNAL WALLS BELOW SHOWN DASHED`}</text>
        {frame.notes.gutter && <text x={b.minX} y={dimY + 0.9 + tNote * 3}>{frame.notes.gutter.toUpperCase()}</text>}
        {frame.notes.solar && <text x={b.minX} y={dimY + 0.9 + tNote * (frame.notes.gutter ? 4.5 : 3)}>{frame.notes.solar.toUpperCase()}</text>}
        {framing && (
          <text x={b.minX} y={dimY + 0.9 + tNote * (1.5 + (frame.notes.gutter ? 1.5 : 0) + (frame.notes.solar ? 1.5 : 0) + 1.5)}>
            {(framing.meta.kind === 'truss'
              ? `${framing.meta.label}: T1–T${framing.trussCount} at ${Math.round(framing.spacing * 1000)} c/c, ${framing.meta.chord.name}; ${framing.meta.purlin.name} at ${Math.round(framing.purlinSpacing * 1000)} c/c`
              : `${framing.meta.label}: ${framing.meta.chord.name} at ${Math.round(framing.spacing * 1000)} c/c; ${framing.meta.purlin.name} at ${Math.round(framing.purlinSpacing * 1000)} c/c`
            ).toUpperCase()}
          </text>
        )}
      </g>
    </g>
  );
}

/** Extents a roof plan draws (for fitting it on paper). */
export function roofPlanBounds(model: BuildingProject) {
  const b = buildFrame(model).bounds;
  return { minX: b.minX - 0.8, minY: b.minY - 1.2, maxX: b.maxX + 2.2, maxY: b.maxY + 3.6 };
}

function Dim({ a, b, size, vertical }: { a: P; b: P; size: number; vertical?: boolean }) {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const t = 0.12;
  const tick = (p: P) => <line x1={p.x - t} y1={p.y + t} x2={p.x + t} y2={p.y - t} stroke={INK} strokeWidth={WEIGHT.medium} vectorEffect={NS} />;
  const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  return (
    <g pointerEvents="none">
      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={INK_2} strokeWidth={WEIGHT.hair} vectorEffect={NS} />
      {tick(a)}
      {tick(b)}
      <text
        x={vertical ? m.x + 0.12 : m.x}
        y={vertical ? m.y : m.y - 0.1}
        fontSize={size}
        fill={INK}
        textAnchor="middle"
        transform={vertical ? `rotate(-90 ${m.x + 0.12} ${m.y})` : undefined}
        dy={vertical ? -0.1 : 0}
        style={{ fontVariantNumeric: 'tabular-nums' }}
      >
        {fmtMM(len)}
      </text>
    </g>
  );
}

/* ── Sewage plan ───────────────────────────────────────────────────── */

const DRAIN_NODE: Record<string, { tag: string; soil: boolean }> = {
  plumb_wc: { tag: 'WC', soil: true },
  plumb_basin: { tag: 'WHB', soil: false },
  plumb_sink: { tag: 'KS', soil: false },
  plumb_shower: { tag: 'SHR', soil: false },
  floor_trap: { tag: 'FT', soil: false },
};
const DRAIN_ITEM: Record<string, { tag: string; soil: boolean }> = {
  wc: { tag: 'WC', soil: true },
  basin_wall: { tag: 'WHB', soil: false },
  sink: { tag: 'KS', soil: false },
  shower: { tag: 'SHR', soil: false },
  bathtub: { tag: 'BATH', soil: false },
};

function inPoly(poly: P[], p: P) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++)
    if (poly[i].y > p.y !== poly[j].y > p.y && p.x < ((poly[j].x - poly[i].x) * (p.y - poly[i].y)) / (poly[j].y - poly[i].y) + poly[i].x) inside = !inside;
  return inside;
}

type Side = 'N' | 'S' | 'W' | 'E';

export interface SewerLayout {
  fittings: { at: P; tag: string; soil: boolean }[];
  branches: { d: string; soil: boolean }[];
  chambers: { id: string; at: P; side: Side; il: number; main?: boolean }[];
  /** Lower floors: soil stacks down the outside wall instead of chambers. */
  stacks: { at: P }[];
  mains: string[];
  septic: { at: P; w: number; d: number; along: 'x' | 'y' } | null;
  soak: { at: P; r: number } | null;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

/**
 * A sewer layout from the sanitary fittings: each wet room collects to a point and runs out
 * through the nearest external wall to an inspection chamber (or a soil stack on upper floors);
 * chambers are linked round the building to the one nearest the septic tank, which overflows
 * to a soakaway. Positions are indicative, as on a planning drawing.
 */
export function sewerLayout(model: BuildingProject, level: FloorLevel): SewerLayout {
  const geo = buildPlanGeometry(level);
  const bb = geo.bounds;
  const fittings: SewerLayout['fittings'] = [];
  for (const n of level.mepNodes) {
    const d = DRAIN_NODE[n.kind];
    if (d) fittings.push({ at: n.position, ...d });
  }
  for (const f of level.furniture) {
    const d = DRAIN_ITEM[f.type];
    if (d && !fittings.some((x) => Math.hypot(x.at.x - f.position.x, x.at.y - f.position.y) < 0.4)) fittings.push({ at: f.position, ...d });
  }

  // Group by room.
  const groups = new Map<string, typeof fittings>();
  for (const f of fittings) {
    const room = level.rooms.find((r) => inPoly(r.polygon, f.at));
    const key = room?.id ?? `f${groups.size}`;
    groups.set(key, [...(groups.get(key) ?? []), f]);
  }

  const off = 1.0; // chambers sit this far outside the walls
  const ring = { x0: bb.minX - off, y0: bb.minY - off, x1: bb.maxX + off, y1: bb.maxY + off };
  const upper = level.index > 0 || model.levels.indexOf(level) > 0;
  const branches: SewerLayout['branches'] = [];
  const outs: { at: P; side: Side }[] = [];
  for (const g of groups.values()) {
    const c = { x: g.reduce((s, f) => s + f.at.x, 0) / g.length, y: g.reduce((s, f) => s + f.at.y, 0) / g.length };
    const dist: [Side, number][] = [
      ['N', c.y - bb.minY],
      ['S', bb.maxY - c.y],
      ['W', c.x - bb.minX],
      ['E', bb.maxX - c.x],
    ];
    const side = dist.sort((a, b) => a[1] - b[1])[0][0];
    const out = upper
      ? side === 'N' ? { x: c.x, y: bb.minY - 0.12 } : side === 'S' ? { x: c.x, y: bb.maxY + 0.12 } : side === 'W' ? { x: bb.minX - 0.12, y: c.y } : { x: bb.maxX + 0.12, y: c.y }
      : side === 'N' ? { x: c.x, y: ring.y0 } : side === 'S' ? { x: c.x, y: ring.y1 } : side === 'W' ? { x: ring.x0, y: c.y } : { x: ring.x1, y: c.y };
    for (const f of g) branches.push({ d: `M${f.at.x} ${f.at.y}L${f.at.x} ${c.y}L${c.x} ${c.y}`, soil: f.soil });
    branches.push({ d: `M${c.x} ${c.y}L${out.x} ${out.y}`, soil: true });
    // Chambers close together on one side are one chamber.
    const near = outs.find((o) => o.side === side && Math.hypot(o.at.x - out.x, o.at.y - out.y) < 1.6);
    if (near) branches.push({ d: `M${out.x} ${out.y}L${near.at.x} ${near.at.y}`, soil: true });
    else outs.push({ at: out, side });
  }

  if (upper || !outs.length) {
    return { fittings, branches, chambers: [], stacks: upper ? outs.map((o) => ({ at: o.at })) : [], mains: [], septic: null, soak: null, bounds: { minX: bb.minX - 1.5, minY: bb.minY - 1.5, maxX: bb.maxX + 1.5, maxY: bb.maxY + 2.5 } };
  }

  // Septic tank on the side with most chambers (south first on a tie), beyond the chambers.
  const count = (s: Side) => outs.filter((o) => o.side === s).length;
  const side = (['S', 'E', 'W', 'N'] as Side[]).sort((a, b) => count(b) - count(a))[0];
  const onSide = outs.filter((o) => o.side === side);
  const horiz = side === 'N' || side === 'S';
  const mid = onSide.reduce((s, o) => s + (horiz ? o.at.x : o.at.y), 0) / onSide.length;
  // The main chamber: the one nearest the middle of that side; the tank sits straight out from it.
  const main = [...onSide].sort((a, b) => Math.abs((horiz ? a.at.x : a.at.y) - mid) - Math.abs((horiz ? b.at.x : b.at.y) - mid))[0];
  const w = 2.4;
  const d = 1.2;
  const gap = 1.6;
  const septicAt = horiz
    ? { x: main.at.x + w / 2 - 0.4, y: side === 'S' ? ring.y1 + gap + d / 2 : ring.y0 - gap - d / 2 }
    : { x: side === 'E' ? ring.x1 + gap + d / 2 : ring.x0 - gap - d / 2, y: main.at.y + w / 2 - 0.4 };
  const septic = { at: septicAt, w: horiz ? w : d, d: horiz ? d : w, along: (horiz ? 'x' : 'y') as 'x' | 'y' };
  const r = 0.75;
  const soakAt = horiz
    ? { x: septicAt.x + w / 2 + 2.0 + r, y: septicAt.y }
    : { x: septicAt.x, y: septicAt.y + w / 2 + 2.0 + r };

  // The other chambers run to the main one round the ring, the short way.
  const W = ring.x1 - ring.x0;
  const H = ring.y1 - ring.y0;
  const per = 2 * (W + H);
  const tOf = (p: P) => (Math.abs(p.y - ring.y0) < 1e-6 ? p.x - ring.x0 : Math.abs(p.x - ring.x1) < 1e-6 ? W + (p.y - ring.y0) : Math.abs(p.y - ring.y1) < 1e-6 ? W + H + (ring.x1 - p.x) : 2 * W + H + (ring.y1 - p.y));
  const corners = [W, W + H, 2 * W + H, per];
  const at = (t: number): P => {
    t = ((t % per) + per) % per;
    if (t <= W) return { x: ring.x0 + t, y: ring.y0 };
    if (t <= W + H) return { x: ring.x1, y: ring.y0 + (t - W) };
    if (t <= 2 * W + H) return { x: ring.x1 - (t - W - H), y: ring.y1 };
    return { x: ring.x0, y: ring.y1 - (t - 2 * W - H) };
  };
  const run = (a: P, b: P) => {
    const ta = tOf(a);
    const tb = tOf(b);
    let fwd = (tb - ta + per) % per;
    const dir = fwd <= per / 2 ? 1 : -1;
    if (dir < 0) fwd = per - fwd;
    const stops: P[] = [a];
    for (const cIdx of [0, 1, 2, 3, 4, 5, 6, 7]) {
      const cT = corners[cIdx % 4] + (cIdx >= 4 ? per : 0);
      const rel = dir > 0 ? (cT - ta + per * 2) % per : (ta - cT + per * 2) % per;
      if (rel > 1e-6 && rel < fwd - 1e-6 && !stops.some((s) => Math.hypot(s.x - at(cT).x, s.y - at(cT).y) < 1e-6)) stops.push({ ...at(cT), r: rel } as P & { r: number });
    }
    const sorted = [stops[0], ...(stops.slice(1) as (P & { r: number })[]).sort((p, q) => p.r - q.r), b];
    return `M${sorted.map((p) => `${p.x} ${p.y}`).join('L')}`;
  };
  const mains = outs.filter((o) => o !== main).map((o) => run(o.at, main.at));
  const inlet = horiz ? { x: main.at.x, y: side === 'S' ? septicAt.y - d / 2 : septicAt.y + d / 2 } : { x: side === 'E' ? septicAt.x - d / 2 : septicAt.x + d / 2, y: main.at.y };
  mains.push(`M${main.at.x} ${main.at.y}L${inlet.x} ${inlet.y}`);
  mains.push(horiz ? `M${septicAt.x + w / 2} ${septicAt.y}L${soakAt.x - r} ${soakAt.y}` : `M${septicAt.x} ${septicAt.y + w / 2}L${soakAt.x} ${soakAt.y - r}`);

  // Invert levels fall towards the main chamber (1:60 from 0.45 m deep at the furthest).
  const runLen = (o: { at: P }) => (o === main ? 0 : Math.min((tOf(o.at) - tOf(main.at) + per) % per, (tOf(main.at) - tOf(o.at) + per) % per));
  const far = Math.max(0, ...outs.map(runLen));
  const chambers = outs.map((o, i) => ({ id: `IC${i + 1}`, at: o.at, side: o.side, il: -(0.45 + (far - runLen(o)) / 60), main: o === main }));
  const xs = [ring.x0, ring.x1, septicAt.x - septic.w / 2 - 0.5, septicAt.x + septic.w / 2 + 0.5, soakAt.x - r - 0.5, soakAt.x + r + 3.5];
  const ys = [ring.y0, ring.y1, septicAt.y - septic.d / 2 - 0.5, septicAt.y + septic.d / 2 + 1.2, soakAt.y - r - 0.5, soakAt.y + r + 1.2];
  return {
    fittings,
    branches,
    chambers,
    stacks: [],
    mains,
    septic,
    soak: { at: soakAt, r },
    bounds: { minX: Math.min(...xs) - 1, minY: Math.min(...ys) - 1, maxX: Math.max(...xs) + 1, maxY: Math.max(...ys) + 2.2 },
  };
}

export function SewagePlan({ layout, k }: { layout: SewerLayout; k: number }) {
  const fs = (size: number, px: number) => Math.max(size, px / k);
  const tSmall = fs(0.15, 9);
  const tNote = fs(0.18, 10.5);
  const c = MEP_COLOR.drain;
  const L = layout;
  return (
    <g>
      <g fill="none" strokeLinecap="round" strokeLinejoin="round" pointerEvents="none">
        {L.branches.map((b, i) => (
          <path key={i} d={b.d} stroke={c} strokeWidth={b.soil ? 1.8 : 1.1} strokeDasharray={b.soil ? undefined : '5 3'} vectorEffect={NS} />
        ))}
        {L.mains.map((d, i) => (
          <path key={i} d={d} stroke={c} strokeWidth={2.2} vectorEffect={NS} />
        ))}
      </g>
      {L.fittings.map((f, i) => (
        <g key={i} transform={`translate(${f.at.x} ${f.at.y})`}>
          <circle r={0.11} fill="#fff" stroke={c} strokeWidth={1.2} vectorEffect={NS} />
          <text x={0.18} y={-0.14} fontSize={tSmall} fill={INK_2} fontWeight={600}>
            {f.tag}
          </text>
        </g>
      ))}
      {L.stacks.map((s, i) => (
        <g key={i} transform={`translate(${s.at.x} ${s.at.y})`}>
          <circle r={0.1} fill={c} />
          <text x={0.2} y={tSmall * 0.35} fontSize={tSmall} fill={INK_2} fontWeight={600}>
            SVP Ø110 DOWN TO IC
          </text>
        </g>
      ))}
      {L.chambers.map((ch) => {
        const s = ch.main ? 0.45 : 0.3;
        const lx = ch.side === 'W' ? -s - 0.15 : s + 0.15;
        return (
          <g key={ch.id} transform={`translate(${ch.at.x} ${ch.at.y})`}>
            <rect x={-s} y={-s} width={s * 2} height={s * 2} fill="#fff" stroke={INK} strokeWidth={WEIGHT.medium} vectorEffect={NS} />
            <line x1={-s} y1={-s} x2={s} y2={s} stroke={INK} strokeWidth={WEIGHT.hair} vectorEffect={NS} />
            <text x={lx} y={-0.05} fontSize={tSmall} fontWeight={700} fill={INK} textAnchor={ch.side === 'W' ? 'end' : 'start'}>
              {ch.id}
            </text>
            <text x={lx} y={tSmall * 1.1} fontSize={tSmall * 0.9} fill={INK_2} textAnchor={ch.side === 'W' ? 'end' : 'start'} style={{ fontVariantNumeric: 'tabular-nums' }}>
              {ch.main ? '900×900' : '600×600'} · IL {ch.il.toFixed(2)}
            </text>
          </g>
        );
      })}
      {L.septic && (
        <g>
          <rect x={L.septic.at.x - L.septic.w / 2} y={L.septic.at.y - L.septic.d / 2} width={L.septic.w} height={L.septic.d} fill="#F4F1EA" stroke={INK} strokeWidth={WEIGHT.cut} vectorEffect={NS} />
          {L.septic.along === 'x' ? (
            <line x1={L.septic.at.x + L.septic.w / 6} y1={L.septic.at.y - L.septic.d / 2} x2={L.septic.at.x + L.septic.w / 6} y2={L.septic.at.y + L.septic.d / 2} stroke={INK} strokeWidth={WEIGHT.light} vectorEffect={NS} />
          ) : (
            <line x1={L.septic.at.x - L.septic.w / 2} y1={L.septic.at.y + L.septic.d / 6} x2={L.septic.at.x + L.septic.w / 2} y2={L.septic.at.y + L.septic.d / 6} stroke={INK} strokeWidth={WEIGHT.light} vectorEffect={NS} />
          )}
          <text x={L.septic.at.x} y={L.septic.at.y + L.septic.d / 2 + tSmall * 1.4} fontSize={tSmall} fontWeight={700} fill={INK} textAnchor="middle">
            SEPTIC TANK
          </text>
          <text x={L.septic.at.x} y={L.septic.at.y + L.septic.d / 2 + tSmall * 2.6} fontSize={tSmall * 0.9} fill={INK_2} textAnchor="middle">
            2-chamber, {fmtMM(Math.max(L.septic.w, L.septic.d))} × {fmtMM(Math.min(L.septic.w, L.septic.d))}
          </text>
        </g>
      )}
      {L.soak && (
        <g>
          <circle cx={L.soak.at.x} cy={L.soak.at.y} r={L.soak.r} fill="#F4F1EA" stroke={INK} strokeWidth={WEIGHT.cut} vectorEffect={NS} />
          <circle cx={L.soak.at.x} cy={L.soak.at.y} r={L.soak.r * 0.7} fill="none" stroke={INK_3} strokeWidth={WEIGHT.hair} strokeDasharray="3 2" vectorEffect={NS} />
          <text x={L.soak.at.x} y={L.soak.at.y + L.soak.r + tSmall * 1.4} fontSize={tSmall} fontWeight={700} fill={INK} textAnchor="middle">
            SOAKAWAY PIT
          </text>
          <text x={L.soak.at.x} y={L.soak.at.y + L.soak.r + tSmall * 2.6} fontSize={tSmall * 0.9} fill={INK_2} textAnchor="middle">
            Ø{fmtMM(L.soak.r * 2)}, perforated rings
          </text>
        </g>
      )}
      {!L.fittings.length && (
        <text x={(L.bounds.minX + L.bounds.maxX) / 2} y={(L.bounds.minY + L.bounds.maxY) / 2} fontSize={tNote} fill={INK_3} textAnchor="middle">
          No sanitary fittings on this level
        </text>
      )}
      <g fontSize={tNote} fill={INK_2}>
        {[
          'SOIL Ø110 uPVC CLASS-B, WASTE Ø50 uPVC, LAID TO 1:60 MIN. FALL',
          'INSPECTION CHAMBERS AT EVERY CHANGE OF DIRECTION; IL = INVERT LEVEL (m) BELOW GROUND',
          'SEPTIC TANK AND SOAKAWAY POSITIONS INDICATIVE: SET OUT ON SITE TO COUNCIL REQUIREMENTS',
        ].map((t, i) => (
          <text key={i} x={L.bounds.minX + 1} y={L.bounds.maxY - 1.4 + i * tNote * 1.5}>
            {t}
          </text>
        ))}
      </g>
    </g>
  );
}


/* ── Site: plot line, boundary wall, gates, entrance canopy, meter ─── */

export function SitePlan({ model, k }: { model: BuildingProject; k: number }) {
  const sl = useMemo(() => siteLayout(model), [model]);
  const fs = (size: number, px: number) => Math.max(size, px / k);
  const t = sl.thickness;
  const p = sl.plot;
  const hasSite = !!model.site;
  if (!hasSite) return null;
  return (
    <g pointerEvents="none">
      {/* Plot boundary (property line) */}
      <polygon points={pts(sl.outline)} fill="none" stroke={INK_3} strokeWidth={WEIGHT.light} strokeDasharray="9 3 2 3" vectorEffect={NS} />
      {/* Boundary wall, inside the property line */}
      {sl.runs.map((r, i) => {
        if (r.toward) {
          // A piece of the rounded corner: the wall's thickness measured in towards the arc's centre.
          const c = r.toward;
          const inn = (q: P) => {
            const L = Math.hypot(c.x - q.x, c.y - q.y) || 1;
            return { x: q.x + ((c.x - q.x) / L) * t, y: q.y + ((c.y - q.y) / L) * t };
          };
          return <polygon key={i} data-kind="boundary" data-id="boundary" pointerEvents="all" points={pts([r.a, r.b, inn(r.b), inn(r.a)])} fill="#8A857D" stroke="#8A857D" strokeWidth={WEIGHT.light} vectorEffect={NS} />;
        }
        const horiz = Math.abs(r.a.y - r.b.y) < 1e-6;
        const inward = r.side === 'N' ? 1 : r.side === 'S' ? -1 : r.side === 'W' ? 1 : -1;
        const x = horiz ? Math.min(r.a.x, r.b.x) : r.a.x + (inward > 0 ? 0 : -t);
        const y = horiz ? r.a.y + (inward > 0 ? 0 : -t) : Math.min(r.a.y, r.b.y);
        return (
          <rect
            key={i}
            data-kind="boundary"
            data-id="boundary"
            pointerEvents="all"
            x={x}
            y={y}
            width={horiz ? Math.abs(r.b.x - r.a.x) : t}
            height={horiz ? t : Math.abs(r.b.y - r.a.y)}
            fill="#8A857D"
            stroke={INK}
            strokeWidth={WEIGHT.medium}
            vectorEffect={NS}
          />
        );
      })}
      {/* Gates and pedestrian doors, with the canopy dashed overhead */}
      {sl.gates.map((g, i) => {
        const inset = { x: -g.out.x * (t / 2), y: -g.out.y * (t / 2) };
        const main = assetFor(g.main.asset);
        const ped = assetFor('gate_pedestrian');
        const ax = g.span.a;
        const bx = g.span.b;
        const along = { x: bx.x - ax.x, y: bx.y - ax.y };
        const L = Math.hypot(along.x, along.y) || 1;
        const u = { x: along.x / L, y: along.y / L };
        const half = 0.75;
        const over = 0.45;
        const c1 = { x: ax.x - u.x * over, y: ax.y - u.y * over };
        const c2 = { x: bx.x + u.x * over, y: bx.y + u.y * over };
        const corner = (q: P, s: number) => ({ x: q.x + g.out.x * half * s, y: q.y + g.out.y * half * s });
        const canopy = [corner(c1, 1), corner(c2, 1), corner(c2, -1), corner(c1, -1)];
        const hx = Math.min(ax.x, bx.x) - 0.1;
        const hy = Math.min(ax.y, bx.y) - 0.1;
        return (
          <g key={i}>
            {/* Click target for the whole entrance */}
            <rect data-kind="gate" data-id={`gate:${g.gate.id}`} pointerEvents="all" x={hx - Math.abs(g.out.x) * 0.4} y={hy - Math.abs(g.out.y) * 0.4} width={Math.abs(bx.x - ax.x) + 0.2 + Math.abs(g.out.x) * 0.8} height={Math.abs(bx.y - ax.y) + 0.2 + Math.abs(g.out.y) * 0.8} fill="transparent" />
            {main && (
              <g transform={`translate(${g.main.center.x + inset.x} ${g.main.center.y + inset.y}) rotate(${g.rot})`}>
                <PlanPrims prims={assetPlan(main, g.main.width, 0.3)} ink={INK} width={WEIGHT.light} />
              </g>
            )}
            {g.ped && ped && (
              <g transform={`translate(${g.ped.center.x + inset.x} ${g.ped.center.y + inset.y}) rotate(${g.rot})`}>
                <PlanPrims prims={assetPlan(ped, g.ped.width, 0.3)} ink={INK} width={WEIGHT.light} />
              </g>
            )}
            {g.gate.canopy !== 'none' && (
              <g>
                <polygon points={pts(canopy)} fill="none" stroke={INK_2} strokeWidth={WEIGHT.light} strokeDasharray="5 3" vectorEffect={NS} />
                {g.gate.canopy === 'gable' && <line x1={c1.x} y1={c1.y} x2={c2.x} y2={c2.y} stroke={INK_2} strokeWidth={WEIGHT.light} strokeDasharray="5 3" vectorEffect={NS} />}

              </g>
            )}
            {/* Labels outside the wall, on the street side */}
            <text x={(c1.x + c2.x) / 2 + g.out.x * (half + 0.35)} y={(c1.y + c2.y) / 2 + g.out.y * (half + 0.35) + fs(0.15, 9) * 0.35} fontSize={fs(0.15, 9)} fill={INK_2} textAnchor="middle">
              {`${g.gate.kind === 'sliding' ? 'SLIDING' : g.gate.kind === 'pedestrian' ? 'PEDESTRIAN' : 'SWING'} GATE ${fmtMM(g.gate.width)}${g.ped ? ` + DOOR ${fmtMM(g.gate.pedestrianWidth)}` : ''}`}
            </text>
            {g.gate.canopy !== 'none' && (
              <text x={(c1.x + c2.x) / 2 + g.out.x * (half + 0.35) + g.out.x * fs(0.15, 9) * 1.5} y={(c1.y + c2.y) / 2 + g.out.y * (half + 0.35) + g.out.y * fs(0.15, 9) * 1.5 + fs(0.15, 9) * 0.35} fontSize={fs(0.15, 9)} fill={INK_2} textAnchor="middle">
                {g.gate.canopy === 'gable' ? 'GABLE CANOPY OVER ENTRANCE' : 'CANOPY OVER ENTRANCE'}
              </text>
            )}
          </g>
        );
      })}
      {sl.meter && (
        <g transform={`translate(${sl.meter.at.x + sl.meter.out.x * (t / 2 + 0.15)} ${sl.meter.at.y + sl.meter.out.y * (t / 2 + 0.15)})`}>
          <rect x={-0.21} y={-0.12} width={0.42} height={0.24} fill="#fff" stroke={MEP_COLOR.power} strokeWidth={1.2} vectorEffect={NS} />
          <text y={0.06} fontSize={0.16} fontWeight={700} fill={MEP_COLOR.power} textAnchor="middle">
            M
          </text>
          <text y={-0.28} fontSize={fs(0.14, 8.5)} fill={INK_2} textAnchor="middle">
            UTILITY METER
          </text>
        </g>
      )}
      {/* Street name side */}
      {sl.gates[0] && (
        <text
          x={p.x + p.w / 2 + sl.gates[0].out.x * (p.w / 2 + 2.0)}
          y={p.y + p.d / 2 + sl.gates[0].out.y * (p.d / 2 + 2.0) + fs(0.2, 11) * 0.35}
          fontSize={fs(0.2, 11)}
          fontWeight={700}
          letterSpacing={0.05}
          fill={INK_3}
          textAnchor="middle"
        >
          STREET
        </text>
      )}
    </g>
  );
}

/** Plot extents (with room for the street label), when the project has a site. */
export function siteBounds(model: BuildingProject) {
  if (!model.site) return null;
  const p = siteLayout(model).plot;
  return { minX: p.x - 1.4, minY: p.y - 1.4, maxX: p.x + p.w + 1.4, maxY: p.y + p.d + 2.6 };
}
