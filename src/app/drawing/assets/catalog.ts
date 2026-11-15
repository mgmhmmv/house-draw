/**
 * The asset library: furniture, kitchen and bathroom fittings, appliances, climate and lighting
 * equipment, trees, gates and boundaries, doors and windows. Every item is parametric (it is
 * rebuilt at whatever size it is placed at) and gives both a 3D model and a plan symbol.
 */
import type { DoorStyle, MEPNodeKind, WindowStyle } from '../../../model/types';
import { B, C, H, L, R, S, T, legs, vessel, type Part, type Prim } from './kit';

export type Category =
  | 'living'
  | 'dining'
  | 'bedroom'
  | 'kitchen'
  | 'bathroom'
  | 'office'
  | 'climate'
  | 'lighting'
  | 'openings'
  | 'outdoor'
  | 'trees'
  | 'boundary';

export const CATEGORIES: { id: Category; name: string }[] = [
  { id: 'living', name: 'Living' },
  { id: 'dining', name: 'Dining' },
  { id: 'bedroom', name: 'Bedroom' },
  { id: 'kitchen', name: 'Kitchen & laundry' },
  { id: 'bathroom', name: 'Bathroom' },
  { id: 'office', name: 'Study' },
  { id: 'climate', name: 'AC & fans' },
  { id: 'lighting', name: 'Lighting' },
  { id: 'openings', name: 'Doors & windows' },
  { id: 'outdoor', name: 'Outdoor' },
  { id: 'trees', name: 'Trees & plants' },
  { id: 'boundary', name: 'Gates & boundary' },
];

export interface AssetDef {
  id: string;
  name: string;
  category: Category;
  /** Default size, metres. */
  w: number;
  d: number;
  h: number;
  /** Where it hangs: on the floor (default), against a wall, or from the ceiling. */
  mount?: 'floor' | 'wall' | 'ceiling';
  /** Height of its underside above the floor, for wall-mounted items. */
  elevation?: number;
  parts?: (w: number, d: number, h: number) => Part[];
  /** Extra plan linework drawn over the top view. */
  symbol?: (w: number, d: number) => Prim[];
  /** Placed as a service point (counts in the electrical design) rather than as furniture. */
  mep?: { kind: MEPNodeKind; system: 'electrical' | 'plumbing'; wattage?: number };
  /** Placed into a wall as a door or window. */
  opening?: { kind: 'door' | 'window'; style: DoorStyle | WindowStyle; height: number; sill: number };
  keywords?: string;
}

const line = (x1: number, y1: number, x2: number, y2: number, style: Prim['style'] = 'line'): Prim => ({ k: 'line', x1, y1, x2, y2, style });

/* ── Shared sub-models ──────────────────────────────────────────────────────── */

/** A dining chair at (x, z) facing `face` radians (0 = facing +z / front). */
function chair(x: number, z: number, face: number, seatW = 0.44): Part[] {
  const c = Math.cos(face);
  const s = Math.sin(face);
  const at = (lx: number, lz: number): [number, number] => [x + lx * c + lz * s, z - lx * s + lz * c];
  const out: Part[] = [];
  for (const [lx, lz] of [
    [-0.18, -0.18],
    [0.18, -0.18],
    [-0.18, 0.18],
    [0.18, 0.18],
  ] as const) {
    const [px, pz] = at(lx, lz);
    out.push(B(px, pz, 0, 0.035, 0.035, 0.45, 'woodDark', { plan: false }));
  }
  const [sx, sz] = at(0, 0);
  out.push(R(sx, sz, 0.43, seatW, seatW, 0.05, 'wood', 0.015, { rot: [0, face, 0] }));
  out.push(R(sx, sz, 0.475, seatW - 0.04, seatW - 0.06, 0.03, 'cushion', 0.012, { rot: [0, face, 0] }));
  const [bx, bz] = at(0, -seatW / 2 + 0.02);
  out.push(R(bx, bz, 0.48, seatW, 0.03, 0.42, 'wood', 0.012, { rot: [-0.08, face, 0] }));
  return out;
}

/** Bed of any width with frame, mattress, duvet, pillows and headboard. */
function bed(w: number, d: number, pillows: number): Part[] {
  const out: Part[] = [
    R(0, 0.02, 0.08, w, d - 0.04, 0.22, 'wood', 0.02),
    ...legs(w, d - 0.04, 0.08, 'woodDark', 0.06, 0.03, false),
    R(0, -d / 2 + 0.04, 0, w + 0.04, 0.08, 1.05, 'fabric', 0.03),
    R(0, 0.04, 0.3, w - 0.06, d - 0.16, 0.22, 'mattress', 0.06),
    R(0, 0.16, 0.42, w - 0.02, d * 0.66, 0.12, 'duvet', 0.05),
    R(0, -d / 2 + d * 0.52, 0.5, w - 0.03, 0.22, 0.06, 'linen', 0.03),
  ];
  const pw = (w - 0.2) / pillows - 0.06;
  for (let i = 0; i < pillows; i++) out.push(R(-w / 2 + 0.13 + pw / 2 + i * (pw + 0.06), -d / 2 + 0.3, 0.5, pw, 0.34, 0.13, 'linen', 0.06));
  return out;
}

/** Cabinet fronts: n doors across a carcass face at z, with gaps and bar handles. */
function fronts(x0: number, w: number, z: number, y0: number, h: number, n: number, m: Part['m'] = 'offwhite', handle: 'v' | 'h' = 'v'): Part[] {
  const out: Part[] = [];
  const dw = w / n;
  for (let i = 0; i < n; i++) {
    const cx = x0 + dw * (i + 0.5);
    out.push(B(cx, z, y0, dw - 0.006, 0.02, h, m, { plan: false }));
    const hx = cx + (i % 2 === 0 ? dw / 2 - 0.05 : -dw / 2 + 0.05);
    out.push(handle === 'v' ? B(n === 1 ? cx + dw / 2 - 0.05 : hx, z + 0.02, y0 + h - 0.22, 0.012, 0.02, 0.16, 'chrome', { plan: false }) : B(cx, z + 0.02, y0 + h - 0.06, Math.min(0.2, dw * 0.5), 0.02, 0.012, 'chrome', { plan: false }));
  }
  return out;
}

/** A tree: trunk plus a canopy of overlapping spheres, sized to w × h. */
function broadleaf(w: number, h: number, leaf: Part['m'] = 'leaf', trunkH = 0.45): Part[] {
  const r = w / 2;
  const th = h * trunkH;
  const out: Part[] = [C(0, 0, 0, Math.max(0.05, w * 0.045), th + r * 0.3, 'trunk', { r2: Math.max(0.07, w * 0.06), seg: 10, plan: false })];
  const cy = th + (h - th) / 2;
  const blobs: [number, number, number, number][] = [
    [0, 0, 0, 0.62],
    [0.42, -0.1, 0.12, 0.45],
    [-0.4, -0.05, -0.15, 0.47],
    [0.1, 0.25, -0.4, 0.42],
    [-0.15, 0.2, 0.42, 0.44],
    [0, 0.42, 0, 0.4],
  ];
  for (const [bx, by, bz, br] of blobs) out.push(S(bx * r, cy + by * (h - th), bz * r, br * r * 1.05, leaf, { seg: 14, sc: [1, (h - th) / (2 * r) / 1.05 + 0.15, 1] }));
  return out;
}

/** Palm: curved trunk of stacked segments and a crown of arching fronds. */
function palm(w: number, h: number, lean = 0.12, fronds = 9): Part[] {
  const out: Part[] = [];
  const n = 9;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const x = Math.sin(t * 1.4) * lean * h * 0.35;
    out.push(C(x, 0, t * h * 0.86, 0.11 - t * 0.035, (h * 0.86) / n + 0.01, 'trunk', { r2: 0.12 - t * 0.035, seg: 10, plan: i === 0 ? 'fill' : false }));
  }
  const topX = Math.sin(1.4) * lean * h * 0.35;
  const topY = h * 0.86;
  out.push(S(topX, topY, 0, 0.16, 'trunk', { seg: 10, plan: false }));
  const len = w / 2;
  for (let i = 0; i < fronds; i++) {
    const a = (i / fronds) * Math.PI * 2;
    const droop = 0.35 + (i % 3) * 0.12;
    const cx = topX + Math.cos(a) * len * 0.5;
    const cz = Math.sin(a) * len * 0.5;
    out.push({ g: 'box', p: [cx, topY + 0.1 - droop * len * 0.3, cz], s: [len, 0.02, 0.32], m: 'leaf', rot: [0, -a, -droop * (Math.cos(a) >= 0 ? 1 : -1) * 0], plan: 'fill' });
    out.push({ g: 'box', p: [cx, topY + 0.08 - droop * len * 0.3, cz], s: [len * 0.98, 0.02, 0.32], m: 'leaf', rot: [droop * 0.9, -a, 0], plan: false });
  }
  return out;
}

/** Steel bars between rails, for gates and railings. */
function bars(x0: number, x1: number, z: number, y0: number, y1: number, gap: number, m: Part['m'] = 'black'): Part[] {
  const out: Part[] = [];
  const n = Math.max(2, Math.round((x1 - x0) / gap));
  for (let i = 0; i <= n; i++) out.push(B(x0 + ((x1 - x0) * i) / n, z, y0, 0.025, 0.025, y1 - y0, m, { plan: false }));
  return out;
}

/** Door swing in plan: leaf line plus quarter arc from the hinge side. */
const swing = (x: number, y: number, r: number, dir: 1 | -1, open: 1 | -1 = 1): Prim[] => [
  line(x, y, x, y + open * r),
  { k: 'path', d: `M ${x + dir * r} ${y} A ${r} ${r} 0 0 ${dir * open > 0 ? 1 : 0} ${x} ${y + open * r}`, style: 'thin' },
];

/* ── The catalogue ──────────────────────────────────────────────────────────── */

export const ASSETS: AssetDef[] = [
  /* Living */
  {
    id: 'sofa',
    name: 'Sofa, 3 seat',
    category: 'living',
    w: 2.1,
    d: 0.9,
    h: 0.82,
    keywords: 'couch settee lounge',
    parts: (w, d) => {
      const n = w > 1.7 ? 3 : 2;
      const inner = w - 0.36;
      const cw = inner / n;
      return [
        ...legs(w - 0.06, d - 0.06, 0.1, 'woodDark', 0.04, 0.02),
        R(0, 0, 0.1, w, d, 0.28, 'fabric', 0.04),
        R(-w / 2 + 0.09, 0, 0.1, 0.18, d, 0.52, 'fabric', 0.06),
        R(w / 2 - 0.09, 0, 0.1, 0.18, d, 0.52, 'fabric', 0.06),
        R(0, -d / 2 + 0.1, 0.38, inner, 0.2, 0.44, 'fabric', 0.05),
        ...Array.from({ length: n }, (_, i) => R(-inner / 2 + cw * (i + 0.5), 0.07, 0.38, cw - 0.015, d - 0.3, 0.14, 'cushion', 0.05)),
        ...Array.from({ length: n }, (_, i) => R(-inner / 2 + cw * (i + 0.5), -d / 2 + 0.25, 0.52, cw - 0.015, 0.14, 0.32, 'cushion', 0.06, { rot: [-0.14, 0, 0] })),
        R(-inner / 2 + 0.25, -d / 2 + 0.36, 0.55, 0.4, 0.12, 0.36, 'accent', 0.06, { rot: [-0.3, 0.2, 0] }),
        R(inner / 2 - 0.25, -d / 2 + 0.36, 0.55, 0.4, 0.12, 0.36, 'accent', 0.06, { rot: [-0.3, -0.2, 0] }),
      ];
    },
  },
  {
    id: 'sofa_2',
    name: 'Sofa, 2 seat',
    category: 'living',
    w: 1.6,
    d: 0.88,
    h: 0.82,
    keywords: 'loveseat couch',
    parts: (w, d, h) => ASSETS.find((a) => a.id === 'sofa')!.parts!(w, d, h),
  },
  {
    id: 'sofa_l',
    name: 'Corner sofa',
    category: 'living',
    w: 2.6,
    d: 1.8,
    h: 0.82,
    keywords: 'sectional l-shape',
    parts: (w, d) => [
      R(0, -d / 2 + 0.45, 0.1, w, 0.9, 0.28, 'fabric', 0.04),
      R(w / 2 - 0.45, 0.45, 0.1, 0.9, d - 0.9, 0.28, 'fabric', 0.04),
      R(0, -d / 2 + 0.1, 0.38, w - 0.2, 0.2, 0.44, 'fabric', 0.05),
      R(w / 2 - 0.1, 0.1, 0.38, 0.2, d - 0.2, 0.44, 'fabric', 0.05),
      R(-w / 2 + 0.09, -d / 2 + 0.45, 0.1, 0.18, 0.9, 0.52, 'fabric', 0.06),
      R(w / 2 - 0.45, d / 2 - 0.09, 0.1, 0.9, 0.18, 0.52, 'fabric', 0.06),
      ...[0, 1, 2].map((i) => R(-w / 2 + 0.2 + (w - 0.6) * (i / 3) + (w - 0.6) / 6, -d / 2 + 0.52, 0.38, (w - 0.6) / 3 - 0.02, 0.62, 0.14, 'cushion', 0.05)),
      R(w / 2 - 0.5, 0.2, 0.38, 0.62, d - 0.95, 0.14, 'cushion', 0.05),
      R(w / 2 - 0.3, -d / 2 + 0.36, 0.55, 0.12, 0.4, 0.36, 'accent', 0.06, { rot: [0, 0.6, 0.25] }),
      ...legs(w - 0.06, 0.84, 0.1, 'woodDark', 0.04, 0.02).map((p) => ({ ...p, p: [p.p[0], p.p[1], p.p[2] - d / 2 + 0.45] as [number, number, number] })),
    ],
  },
  {
    id: 'armchair',
    name: 'Armchair',
    category: 'living',
    w: 0.85,
    d: 0.85,
    h: 0.8,
    parts: (w, d) => [
      ...legs(w - 0.06, d - 0.06, 0.12, 'woodDark', 0.04, 0.02),
      R(0, 0, 0.12, w, d, 0.26, 'fabric', 0.04),
      R(-w / 2 + 0.08, 0, 0.12, 0.16, d, 0.5, 'fabric', 0.06),
      R(w / 2 - 0.08, 0, 0.12, 0.16, d, 0.5, 'fabric', 0.06),
      R(0, -d / 2 + 0.09, 0.38, w - 0.32, 0.18, 0.42, 'fabric', 0.05),
      R(0, 0.07, 0.38, w - 0.34, d - 0.28, 0.13, 'cushion', 0.05),
      R(0, -d / 2 + 0.3, 0.55, 0.36, 0.11, 0.32, 'accent', 0.06, { rot: [-0.3, 0, 0] }),
    ],
  },
  {
    id: 'coffee_table',
    name: 'Coffee table',
    category: 'living',
    w: 1.2,
    d: 0.6,
    h: 0.4,
    parts: (w, d, h) => [
      R(0, 0, h - 0.04, w, d, 0.04, 'wood', 0.012),
      R(0, 0, 0.1, w - 0.12, d - 0.12, 0.02, 'wood', 0.01, { plan: false }),
      ...legs(w, d, h - 0.04, 'woodDark', 0.05, 0.022, false),
      R(0.2, 0.05, h, 0.28, 0.2, 0.04, 'book2', 0.004),
      C(-0.3, -0.05, h, 0.06, 0.12, 'ceramic', { r2: 0.045 }),
    ],
  },
  {
    id: 'side_table',
    name: 'Side table',
    category: 'living',
    w: 0.5,
    d: 0.5,
    h: 0.55,
    parts: (w, d, h) => [C(0, 0, h - 0.03, Math.min(w, d) / 2, 0.03, 'wood', { seg: 32 }), C(0, 0, 0.02, 0.025, h - 0.05, 'metal', { plan: false }), C(0, 0, 0, Math.min(w, d) * 0.3, 0.02, 'metal', { plan: false })],
  },
  {
    id: 'tv_unit',
    name: 'TV unit with TV',
    category: 'living',
    w: 1.8,
    d: 0.45,
    h: 1.12,
    keywords: 'television media console',
    parts: (w, d) => [
      B(0, 0, 0, w - 0.1, d - 0.08, 0.06, 'black', { plan: false }),
      R(0, 0, 0.06, w, d, 0.4, 'wood', 0.01),
      ...fronts(-w / 2 + 0.02, w - 0.04, d / 2, 0.09, 0.34, 3, 'woodDark', 'h'),
      B(0, -0.04, 0.46, 0.3, 0.2, 0.02, 'black'),
      B(0, -0.06, 0.48, 0.05, 0.04, 0.1, 'black', { plan: false }),
      R(0, -0.06, 0.55, Math.min(1.45, w * 0.82), 0.05, Math.min(1.45, w * 0.82) * 0.57, 'screen', 0.01),
    ],
  },
  {
    id: 'tv_wall',
    name: 'Wall TV',
    category: 'living',
    w: 1.45,
    d: 0.06,
    h: 0.83,
    mount: 'wall',
    elevation: 1.0,
    keywords: 'television',
    parts: (w, d, h) => [R(0, 0, 0, w, d, h, 'screen', 0.008), B(0, -d / 2 + 0.005, 0.15, 0.4, 0.01, 0.3, 'black', { plan: false })],
  },
  {
    id: 'bookshelf',
    name: 'Bookshelf',
    category: 'living',
    w: 1.0,
    d: 0.32,
    h: 1.9,
    keywords: 'shelving bookcase',
    parts: (w, d, h) => {
      const out: Part[] = [B(-w / 2 + 0.01, 0, 0, 0.02, d, h, 'wood'), B(w / 2 - 0.01, 0, 0, 0.02, d, h, 'wood'), B(0, -d / 2 + 0.005, 0, w, 0.01, h, 'woodDark', { plan: false })];
      const shelves = Math.max(3, Math.round(h / 0.36));
      const cols: Part['m'][] = ['book1', 'book2', 'book3', 'offwhite', 'black'];
      for (let i = 0; i <= shelves; i++) {
        const y = (i / shelves) * (h - 0.02);
        out.push(B(0, 0, y, w - 0.04, d, 0.02, 'wood', { plan: i === shelves ? 'fill' : false }));
        if (i < shelves && i % 2 === 0) {
          let x = -w / 2 + 0.04;
          let k = i * 3;
          while (x < w / 2 - 0.12) {
            const bw = 0.03 + ((k * 7) % 5) * 0.008;
            const bh = 0.2 + ((k * 13) % 7) * 0.012;
            out.push(B(x + bw / 2, 0.01, y + 0.02, bw, d - 0.06, bh, cols[k % cols.length], { plan: false }));
            x += bw + 0.003;
            k++;
          }
        }
      }
      return out;
    },
  },
  {
    id: 'rug',
    name: 'Rug',
    category: 'living',
    w: 2.4,
    d: 1.7,
    h: 0.012,
    parts: (w, d, h) => [R(0, 0, 0, w, d, h, 'cushion', 0.005, { plan: 'dash' }), R(0, 0, 0.001, w - 0.16, d - 0.16, h, 'fabric', 0.004, { plan: false })],
  },
  {
    id: 'plant_indoor',
    name: 'Indoor plant',
    category: 'living',
    w: 0.5,
    d: 0.5,
    h: 1.2,
    keywords: 'pot planter',
    parts: (w, _d, h) => [
      C(0, 0, 0, w * 0.3, 0.36, 'ceramic', { r2: w * 0.24 }),
      C(0, 0, 0.33, w * 0.28, 0.02, 'soil', { plan: false }),
      C(0, 0, 0.34, 0.015, h * 0.45, 'trunk', { plan: false }),
      S(0, h * 0.68, 0, w * 0.42, 'leaf', { seg: 12, sc: [1, 1.15, 1] }),
      S(w * 0.15, h * 0.85, 0.05, w * 0.28, 'leaf', { seg: 12 }),
      S(-w * 0.12, h * 0.55, -0.06, w * 0.3, 'leaf', { seg: 12 }),
    ],
  },

  /* Dining */
  {
    id: 'dining_table',
    name: 'Dining table, 6 seats',
    category: 'dining',
    w: 2.2,
    d: 1.2,
    h: 0.76,
    keywords: 'table chairs',
    parts: (w, d, h) => {
      const tw = w - 0.5;
      const td = d - 0.5;
      const n = Math.max(1, Math.floor(tw / 0.62));
      const out: Part[] = [R(0, 0, h - 0.04, tw, td, 0.04, 'wood', 0.01), ...legs(tw, td, h - 0.04, 'woodDark', 0.06, 0.03, false), B(0, 0, h - 0.12, tw - 0.12, td - 0.12, 0.08, 'wood', { plan: false })];
      for (let i = 0; i < n; i++) {
        const x = -tw / 2 + (tw / n) * (i + 0.5);
        out.push(...chair(x, -d / 2 + 0.22, 0), ...chair(x, d / 2 - 0.22, Math.PI));
      }
      if (tw >= 1.6) out.push(...chair(-w / 2 + 0.22, 0, -Math.PI / 2), ...chair(w / 2 - 0.22, 0, Math.PI / 2));
      return out;
    },
  },
  {
    id: 'dining_4',
    name: 'Dining table, 4 seats',
    category: 'dining',
    w: 1.6,
    d: 1.3,
    h: 0.76,
    parts: (w, d, h) => ASSETS.find((a) => a.id === 'dining_table')!.parts!(w, d, h),
  },
  {
    id: 'dining_round',
    name: 'Round table, 4 seats',
    category: 'dining',
    w: 1.5,
    d: 1.5,
    h: 0.76,
    parts: (w, d, h) => {
      const r = Math.min(w, d) / 2 - 0.3;
      return [
        C(0, 0, h - 0.035, r, 0.035, 'wood', { seg: 40 }),
        C(0, 0, 0.03, 0.06, h - 0.07, 'woodDark', { plan: false }),
        C(0, 0, 0, 0.28, 0.03, 'woodDark', { plan: false }),
        ...[0, 1, 2, 3].flatMap((i) => {
          const a = (i * Math.PI) / 2 + Math.PI / 4;
          return chair(Math.sin(a) * (r + 0.1), Math.cos(a) * (r + 0.1), a + Math.PI);
        }),
      ];
    },
  },
  {
    id: 'dining_chair',
    name: 'Dining chair',
    category: 'dining',
    w: 0.46,
    d: 0.5,
    h: 0.9,
    parts: () => chair(0, 0.02, 0),
  },
  {
    id: 'bar_stool',
    name: 'Bar stool',
    category: 'dining',
    w: 0.42,
    d: 0.42,
    h: 0.75,
    parts: (w, _d, h) => [
      C(0, 0, h - 0.06, w / 2, 0.06, 'woodDark', { seg: 28 }),
      ...[0, 1, 2, 3].map((i) => {
        const a = (i * Math.PI) / 2 + Math.PI / 4;
        return B(Math.sin(a) * w * 0.33, Math.cos(a) * w * 0.33, 0, 0.025, 0.025, h - 0.06, 'black', { plan: false, rot: [0, a, 0] });
      }),
      T(0, h * 0.35, 0, w * 0.32, 0.01, 'black', { plan: false }),
    ],
  },
  {
    id: 'sideboard',
    name: 'Sideboard',
    category: 'dining',
    w: 1.6,
    d: 0.45,
    h: 0.8,
    keywords: 'buffet cabinet',
    parts: (w, d, h) => [...legs(w, d, 0.12, 'black', 0.06, 0.015), R(0, 0, 0.12, w, d, h - 0.12, 'wood', 0.01), ...fronts(-w / 2 + 0.02, w - 0.04, d / 2, 0.15, h - 0.18, 4, 'woodDark')],
  },

  /* Bedroom */
  { id: 'bed_double', name: 'Double bed', category: 'bedroom', w: 1.6, d: 2.1, h: 1.05, keywords: 'queen', parts: (w, d) => bed(w, d, 2) },
  { id: 'bed_king', name: 'King bed', category: 'bedroom', w: 1.95, d: 2.15, h: 1.05, parts: (w, d) => bed(w, d, 2) },
  { id: 'bed_single', name: 'Single bed', category: 'bedroom', w: 1.0, d: 2.05, h: 1.0, parts: (w, d) => bed(w, d, 1) },
  {
    id: 'bunk_bed',
    name: 'Bunk bed',
    category: 'bedroom',
    w: 1.0,
    d: 2.05,
    h: 1.65,
    keywords: 'kids',
    parts: (w, d, h) => [
      ...legs(w, d, h, 'wood', 0.03, 0.03, false),
      R(0, 0, 0.18, w - 0.06, d - 0.06, 0.06, 'wood', 0.01, { plan: false }),
      R(0, 0, 0.24, w - 0.1, d - 0.1, 0.16, 'mattress', 0.05, { plan: false }),
      R(0, 0, h - 0.62, w - 0.06, d - 0.06, 0.06, 'wood', 0.01),
      R(0, 0, h - 0.56, w - 0.1, d - 0.1, 0.16, 'mattress', 0.05),
      R(0, 0.2, h - 0.42, w - 0.08, d * 0.6, 0.08, 'duvet', 0.04),
      R(0, -d / 2 + 0.28, h - 0.42, w - 0.25, 0.3, 0.1, 'linen', 0.05),
      B(-w / 2 + 0.03, 0, h - 0.4, 0.04, d, 0.04, 'wood', { plan: false }),
      ...[0.3, 0.6, 0.9, 1.2].map((y) => B(w / 2 - 0.03, d / 2 - 0.25, y, 0.04, 0.4, 0.03, 'wood', { plan: false })),
    ],
  },
  {
    id: 'nightstand',
    name: 'Bedside table',
    category: 'bedroom',
    w: 0.48,
    d: 0.4,
    h: 0.55,
    keywords: 'nightstand',
    parts: (w, d, h) => [...legs(w, d, 0.1, 'woodDark', 0.03, 0.015), R(0, 0, 0.1, w, d, h - 0.1, 'wood', 0.01), ...fronts(-w / 2 + 0.015, w - 0.03, d / 2, 0.13, (h - 0.16) / 2 - 0.01, 1, 'offwhite', 'h'), ...fronts(-w / 2 + 0.015, w - 0.03, d / 2, 0.13 + (h - 0.16) / 2, (h - 0.16) / 2 - 0.01, 1, 'offwhite', 'h')],
  },
  {
    id: 'wardrobe',
    name: 'Wardrobe',
    category: 'bedroom',
    w: 1.8,
    d: 0.6,
    h: 2.2,
    keywords: 'closet cupboard',
    parts: (w, d, h) => [B(0, 0, 0, w - 0.04, d - 0.04, 0.08, 'black', { plan: false }), R(0, 0, 0.08, w, d, h - 0.08, 'offwhite', 0.01), ...fronts(-w / 2 + 0.01, w - 0.02, d / 2, 0.1, h - 0.14, Math.max(2, Math.round(w / 0.5)), 'white')],
    symbol: (w, d) => [line(-w / 2 + 0.05, 0, w / 2 - 0.05, 0, 'thin'), line(-w / 2, d / 2, w / 2, -d / 2, 'thin')],
  },
  {
    id: 'dresser',
    name: 'Chest of drawers',
    category: 'bedroom',
    w: 1.2,
    d: 0.48,
    h: 0.85,
    keywords: 'dresser drawers',
    parts: (w, d, h) => {
      const out: Part[] = [...legs(w, d, 0.1, 'woodDark', 0.04, 0.02), R(0, 0, 0.1, w, d, h - 0.1, 'wood', 0.01)];
      for (let r = 0; r < 3; r++) out.push(...fronts(-w / 2 + 0.015, w - 0.03, d / 2, 0.13 + r * ((h - 0.16) / 3), (h - 0.16) / 3 - 0.012, 2, 'offwhite', 'h'));
      return out;
    },
  },
  {
    id: 'dressing_table',
    name: 'Dressing table',
    category: 'bedroom',
    w: 1.1,
    d: 0.45,
    h: 1.5,
    keywords: 'vanity mirror',
    parts: (w, d) => [...legs(w, d, 0.72, 'wood', 0.03, 0.02, false), R(0, 0, 0.72, w, d, 0.04, 'wood', 0.01), ...fronts(-w / 2 + 0.03, w - 0.06, d / 2, 0.6, 0.11, 2, 'offwhite', 'h'), R(0, -d / 2 + 0.03, 0.8, w * 0.6, 0.03, 0.7, 'chrome', 0.02, { plan: false }), ...chair(0, d / 2 + 0.3, Math.PI).map((p) => ({ ...p, plan: false as const }))],
  },
  {
    id: 'crib',
    name: 'Baby cot',
    category: 'bedroom',
    w: 0.7,
    d: 1.3,
    h: 0.95,
    keywords: 'crib',
    parts: (w, d, h) => [...legs(w, d, h, 'white', 0.025, 0.025, false), R(0, 0, 0.3, w - 0.04, d - 0.04, 0.12, 'mattress', 0.04), B(0, -d / 2 + 0.025, 0.3, w, 0.03, h - 0.3, 'white', { plan: false }), B(0, d / 2 - 0.025, 0.3, w, 0.03, h - 0.3, 'white', { plan: false }), ...bars(-d / 2 + 0.05, d / 2 - 0.05, 0, 0.42, h - 0.05, 0.08, 'white').map((p) => ({ ...p, p: [-w / 2 + 0.02, p.p[1], p.p[0]] as [number, number, number] })), ...bars(-d / 2 + 0.05, d / 2 - 0.05, 0, 0.42, h - 0.05, 0.08, 'white').map((p) => ({ ...p, p: [w / 2 - 0.02, p.p[1], p.p[0]] as [number, number, number] }))],
  },

  /* Kitchen & laundry */
  {
    id: 'kitchen_counter',
    name: 'Kitchen run with sink & hob',
    category: 'kitchen',
    w: 3.0,
    d: 0.65,
    h: 0.92,
    keywords: 'counter cabinets worktop',
    parts: (w, d, h) => {
      const top = h - 0.04;
      const sinkX = -0.3;
      const hobX = -w / 2 + w * 0.78;
      return [
        B(0, 0.04, 0, w - 0.04, d - 0.1, 0.1, 'black', { plan: false }),
        B(0, -0.02, 0.1, w, d - 0.06, top - 0.1, 'offwhite'),
        ...fronts(-w / 2 + 0.005, w - 0.01, d / 2 - 0.05, 0.11, top - 0.13, Math.max(2, Math.round(w / 0.6)), 'white', 'h'),
        R(0, 0, top, w, d, 0.04, 'stone', 0.004),
        ...vessel(sinkX, 0.02, top - 0.17, 0.5, 0.4, 0.21, 0.012, 'steel', 0.02),
        C(sinkX, -d / 2 + 0.08, h, 0.022, 0.32, 'chrome', { plan: false }),
        H(sinkX, h + 0.31, -d / 2 + 0.15, 0.014, 0.16, 'z', 'chrome', { plan: false }),
        B(hobX, 0.02, h, 0.6, 0.5, 0.008, 'screen'),
        ...[
          [-0.15, -0.11],
          [0.15, -0.11],
          [-0.15, 0.12],
          [0.15, 0.12],
        ].map(([bx, bz]) => T(hobX + bx, h + 0.009, 0.02 + bz, 0.07, 0.006, 'metal')),
      ];
    },
  },
  {
    id: 'kitchen_base',
    name: 'Base cabinet',
    category: 'kitchen',
    w: 1.2,
    d: 0.6,
    h: 0.92,
    keywords: 'counter cupboard',
    parts: (w, d, h) => [B(0, 0.04, 0, w - 0.04, d - 0.1, 0.1, 'black', { plan: false }), B(0, -0.02, 0.1, w, d - 0.06, h - 0.14, 'offwhite'), ...fronts(-w / 2 + 0.005, w - 0.01, d / 2 - 0.05, 0.11, h - 0.17, Math.max(1, Math.round(w / 0.6)), 'white', 'h'), R(0, 0, h - 0.04, w, d, 0.04, 'stone', 0.004)],
  },
  {
    id: 'kitchen_island',
    name: 'Kitchen island',
    category: 'kitchen',
    w: 2.2,
    d: 1.0,
    h: 0.92,
    parts: (w, d, h) => [
      B(0, -0.12, 0.1, w - 0.1, d - 0.4, h - 0.14, 'offwhite'),
      B(0, -0.12, 0, w - 0.16, d - 0.46, 0.1, 'black', { plan: false }),
      ...fronts(-w / 2 + 0.06, w - 0.12, -0.12 - (d - 0.4) / 2, 0.11, h - 0.17, Math.max(2, Math.round(w / 0.6)), 'white', 'h').map((p) => ({ ...p, rot: [0, Math.PI, 0] as [number, number, number] })),
      R(0, 0, h - 0.04, w, d, 0.04, 'stone', 0.006),
      ...[-0.5, 0, 0.5].filter((x) => Math.abs(x) < w / 2 - 0.3).flatMap((x) => [C(x, d / 2 + 0.05, 0.62, 0.18, 0.05, 'woodDark', { plan: 'line' }), C(x, d / 2 + 0.05, 0, 0.02, 0.62, 'black', { plan: false }), C(x, d / 2 + 0.05, 0, 0.16, 0.015, 'black', { plan: false })]),
    ],
  },
  {
    id: 'wall_cabinet',
    name: 'Wall cabinet',
    category: 'kitchen',
    w: 1.2,
    d: 0.35,
    h: 0.72,
    mount: 'wall',
    elevation: 1.45,
    parts: (w, d, h) => [B(0, 0, 0, w, d - 0.02, h, 'offwhite'), ...fronts(-w / 2 + 0.005, w - 0.01, d / 2 - 0.01, 0.005, h - 0.01, Math.max(1, Math.round(w / 0.5)), 'white', 'v').map((p) => (p.m === 'chrome' ? { ...p, p: [p.p[0], 0.1, p.p[2]] as [number, number, number] } : p))],
  },
  {
    id: 'tall_pantry',
    name: 'Tall pantry',
    category: 'kitchen',
    w: 0.6,
    d: 0.6,
    h: 2.2,
    keywords: 'larder cupboard',
    parts: (w, d, h) => [B(0, 0.02, 0, w - 0.04, d - 0.1, 0.1, 'black', { plan: false }), B(0, -0.02, 0.1, w, d - 0.06, h - 0.1, 'offwhite'), ...fronts(-w / 2 + 0.005, w - 0.01, d / 2 - 0.05, 0.11, h - 0.14, 1, 'white', 'v')],
    symbol: (w, d) => [line(-w / 2, -d / 2, w / 2, d / 2, 'thin')],
  },
  {
    id: 'fridge',
    name: 'Fridge freezer',
    category: 'kitchen',
    w: 0.7,
    d: 0.7,
    h: 1.85,
    keywords: 'refrigerator',
    parts: (w, d, h) => [
      R(0, -0.03, 0, w, d - 0.06, h, 'steel', 0.02),
      B(0, d / 2 - 0.035, 0.08, w - 0.01, 0.05, h * 0.36, 'steel', { plan: false }),
      B(0, d / 2 - 0.035, 0.1 + h * 0.36, w - 0.01, 0.05, h * 0.6 - 0.1, 'steel', { plan: false }),
      B(w / 2 - 0.06, d / 2 + 0.01, h * 0.42, 0.02, 0.03, h * 0.4, 'chrome', { plan: false }),
      B(w / 2 - 0.06, d / 2 + 0.01, 0.22, 0.02, 0.03, h * 0.2, 'chrome', { plan: false }),
    ],
    symbol: (w, d) => [line(-w / 2, d / 2 - 0.06, w / 2, d / 2 - 0.06, 'thin')],
  },
  {
    id: 'range_cooker',
    name: 'Range cooker',
    category: 'kitchen',
    w: 0.9,
    d: 0.65,
    h: 0.92,
    keywords: 'oven stove',
    parts: (w, d, h) => [
      B(0, 0, 0, w, d, h - 0.03, 'steel'),
      B(0, d / 2 + 0.002, 0.12, w - 0.1, 0.01, 0.48, 'screen', { plan: false }),
      H(0, 0.66, d / 2 + 0.03, 0.012, w - 0.2, 'x', 'chrome', { plan: false }),
      ...[-0.3, -0.15, 0, 0.15, 0.3].map((x) => H(x * w, h - 0.12, d / 2 + 0.015, 0.018, 0.03, 'z', 'black', { plan: false })),
      B(0, 0.02, h - 0.03, w, d - 0.04, 0.03, 'black'),
      ...[
        [-0.22, -0.13],
        [0.22, -0.13],
        [-0.22, 0.15],
        [0.22, 0.15],
        [0, 0.01],
      ].flatMap(([bx, bz]) => [C(bx * w, bz, h, 0.045, 0.02, 'metal', { plan: 'line' }), T(bx * w, h + 0.025, bz, 0.08, 0.008, 'black')]),
    ],
  },
  {
    id: 'cooker_hood',
    name: 'Cooker hood',
    category: 'kitchen',
    w: 0.9,
    d: 0.5,
    h: 0.9,
    mount: 'wall',
    elevation: 1.55,
    keywords: 'extractor chimney',
    parts: (w, d, h) => [{ g: 'cyl', p: [0, 0.08, -d / 2 + w * 0.36], s: [0.13, 0.16, w * 0.62], m: 'steel', seg: 4, rot: [0, Math.PI / 4, 0], sc: [1, 1, d / (w * 1.25)] }, B(0, -d / 2 + 0.13, 0.16, 0.26, 0.24, h - 0.16, 'steel')],
  },
  {
    id: 'washing_machine',
    name: 'Washing machine',
    category: 'kitchen',
    w: 0.6,
    d: 0.6,
    h: 0.85,
    keywords: 'laundry washer',
    parts: (w, d, h) => [R(0, 0, 0, w, d, h, 'white', 0.02), B(0, d / 2, h - 0.12, w - 0.04, 0.01, 0.1, 'offwhite', { plan: false }), H(0, h * 0.45, d / 2 + 0.01, 0.17, 0.02, 'z', 'glass', { plan: false }), { g: 'tor', p: [0, h * 0.45, d / 2 + 0.015], s: [0.18, 0.025, 0], m: 'chrome', plan: false }, H(w * 0.3, h - 0.07, d / 2 + 0.01, 0.025, 0.02, 'z', 'chrome', { plan: false })],
    symbol: () => [{ k: 'ellipse', cx: 0, cy: 0, rx: 0.18, ry: 0.18, style: 'thin' }],
  },
  {
    id: 'dishwasher',
    name: 'Dishwasher',
    category: 'kitchen',
    w: 0.6,
    d: 0.6,
    h: 0.85,
    parts: (w, d, h) => [B(0, 0, 0, w, d, h, 'steel'), B(0, d / 2, 0.08, w - 0.01, 0.01, h - 0.1, 'steel', { plan: false }), H(0, h - 0.1, d / 2 + 0.025, 0.01, w - 0.16, 'x', 'chrome', { plan: false })],
  },

  /* Bathroom */
  {
    id: 'wc',
    name: 'Toilet',
    category: 'bathroom',
    w: 0.4,
    d: 0.7,
    h: 0.8,
    keywords: 'wc loo',
    parts: (w, d, h) => [
      R(0, -d / 2 + 0.1, 0.4, w * 0.95, 0.18, h - 0.4, 'ceramic', 0.03),
      B(0, -d / 2 + 0.1, h, 0.04, 0.02, 0.01, 'chrome', { plan: false }),
      C(0, 0.04, 0, 0.11, 0.3, 'ceramic', { r2: 0.13, sc: [1, 1, 1.25], plan: false }),
      S(0, 0.3, 0.06, w * 0.46, 'ceramic', { sc: [1, 0.35, 1.32], seg: 28 }),
      { g: 'tor', p: [0, 0.4, 0.06], s: [w * 0.38, 0.03, 0], m: 'ceramic', rot: [Math.PI / 2, 0, 0], sc: [1, 1.28, 1], plan: false },
      R(0, -d / 2 + 0.23, 0.42, w * 0.78, 0.03, 0.4, 'ceramic', 0.02, { rot: [-0.15, 0, 0], plan: false }),
    ],
  },
  {
    id: 'sink',
    name: 'Vanity basin',
    category: 'bathroom',
    w: 0.7,
    d: 0.48,
    h: 0.9,
    keywords: 'basin washbasin',
    parts: (w, d, h) => [
      R(0, 0, 0.15, w, d, 0.65, 'wood', 0.01),
      ...fronts(-w / 2 + 0.01, w - 0.02, d / 2, 0.18, 0.58, 2, 'woodDark', 'v'),
      R(0, 0, 0.8, w, d, 0.03, 'stone', 0.004),
      L(0, 0.04, 0.83, [
        [0.04, 0],
        [0.17, 0.02],
        [0.2, 0.08],
        [0.205, 0.12],
        [0.19, 0.12],
        [0.16, 0.06],
        [0.03, 0.035],
      ], 'ceramic', { sc: [Math.min(1, w / 0.5), 1, Math.min(1, d / 0.5)] }),
      C(0, -d / 2 + 0.06, 0.83, 0.018, h - 0.69, 'chrome', { plan: false }),
      H(0, h + 0.13, -d / 2 + 0.12, 0.012, 0.12, 'z', 'chrome', { plan: false }),
    ],
  },
  {
    id: 'basin_wall',
    name: 'Wall basin',
    category: 'bathroom',
    w: 0.5,
    d: 0.4,
    h: 0.88,
    parts: (w, d) => [
      L(0, 0, 0.62, [
        [0.03, 0],
        [0.12, 0.05],
        [0.2, 0.18],
        [0.21, 0.24],
        [0.19, 0.24],
        [0.16, 0.12],
        [0.025, 0.08],
      ], 'ceramic', { sc: [w / 0.42, 1, d / 0.42] }),
      C(0, 0, 0.3, 0.06, 0.33, 'ceramic', { plan: false }),
      C(0, -d / 2 + 0.05, 0.86, 0.016, 0.16, 'chrome', { plan: false }),
    ],
  },
  {
    id: 'shower',
    name: 'Shower',
    category: 'bathroom',
    w: 0.9,
    d: 0.9,
    h: 2.1,
    parts: (w, d, h) => [
      R(0, 0, 0, w, d, 0.05, 'ceramic', 0.01),
      C(0, 0, 0.05, 0.04, 0.003, 'chrome', { plan: 'line' }),
      B(0, d / 2 - 0.01, 0.05, w, 0.01, h - 0.05, 'glass'),
      B(w / 2 - 0.01, 0, 0.05, 0.01, d, h - 0.05, 'glass'),
      B(w / 2 - 0.01, d / 2 - 0.01, 0.05, 0.02, 0.02, h - 0.05, 'chrome', { plan: false }),
      C(-w / 2 + 0.12, -d / 2 + 0.03, 0.9, 0.012, h - 0.95, 'chrome', { plan: false }),
      H(-w / 2 + 0.12, h - 0.05, -d / 2 + 0.12, 0.01, 0.18, 'z', 'chrome', { plan: false }),
      C(-w / 2 + 0.12, -d / 2 + 0.22, h - 0.1, 0.1, 0.02, 'chrome'),
      B(-w / 2 + 0.12, -d / 2 + 0.015, 1.05, 0.08, 0.03, 0.12, 'chrome', { plan: false }),
    ],
    symbol: (w, d) => [line(-w / 2, -d / 2, w / 2, d / 2, 'thin'), line(w / 2, -d / 2, -w / 2, d / 2, 'thin')],
  },
  {
    id: 'bathtub',
    name: 'Bathtub',
    category: 'bathroom',
    w: 1.7,
    d: 0.75,
    h: 0.58,
    keywords: 'bath tub',
    parts: (w, d, h) => [...vessel(0, 0, 0, w, d, h, 0.08, 'ceramic', 0.04), R(0.08, 0, h * 0.35, w - 0.3, d - 0.24, 0.02, 'water', 0.08, { plan: false }), C(-w / 2 + 0.04, 0, h, 0.02, 0.12, 'chrome', { plan: false }), H(-w / 2 + 0.11, h + 0.11, 0, 0.014, 0.14, 'x', 'chrome', { plan: false })],
    symbol: (w) => [{ k: 'ellipse', cx: -w / 2 + 0.2, cy: 0, rx: 0.03, ry: 0.03, style: 'thin' }],
  },
  {
    id: 'mirror_cabinet',
    name: 'Mirror cabinet',
    category: 'bathroom',
    w: 0.7,
    d: 0.14,
    h: 0.7,
    mount: 'wall',
    elevation: 1.15,
    parts: (w, d, h) => [B(0, 0, 0, w, d, h, 'white'), B(0, d / 2, 0.01, w - 0.02, 0.01, h - 0.02, 'chrome', { plan: false })],
  },
  {
    id: 'towel_rail',
    name: 'Towel rail',
    category: 'bathroom',
    w: 0.6,
    d: 0.1,
    h: 0.8,
    mount: 'wall',
    elevation: 0.7,
    parts: (w, d, h) => [C(-w / 2 + 0.02, 0, 0, 0.012, h, 'chrome'), C(w / 2 - 0.02, 0, 0, 0.012, h, 'chrome'), ...[0.1, 0.3, 0.5, 0.7].map((y) => H(0, y * h + 0.04, 0, 0.01, w - 0.04, 'x', 'chrome', { plan: false })), R(0, d / 2 - 0.02, h * 0.45, w * 0.7, 0.03, h * 0.45, 'linen', 0.01, { plan: false })],
  },

  /* Study */
  {
    id: 'desk',
    name: 'Desk',
    category: 'office',
    w: 1.4,
    d: 0.7,
    h: 0.75,
    keywords: 'office table',
    parts: (w, d, h) => [
      R(0, 0, h - 0.03, w, d, 0.03, 'wood', 0.008),
      B(-w / 2 + 0.03, 0, 0, 0.04, d - 0.06, h - 0.03, 'black', { plan: false }),
      B(w / 2 - 0.2, 0, 0, 0.4, d - 0.06, h - 0.03, 'offwhite', { plan: false }),
      ...[0, 1, 2].flatMap((i) => fronts(w / 2 - 0.4, 0.4, d / 2 - 0.02, 0.04 + i * ((h - 0.1) / 3), (h - 0.1) / 3 - 0.01, 1, 'white', 'h')),
      B(0, -d / 2 + 0.12, h, 0.25, 0.18, 0.012, 'black', { plan: false }),
      B(0, -d / 2 + 0.12, h, 0.03, 0.03, 0.16, 'black', { plan: false }),
      R(0, -d / 2 + 0.14, h + 0.12, 0.62, 0.025, 0.37, 'screen', 0.008),
      R(0, 0.08, h, 0.42, 0.13, 0.015, 'black', 0.004),
    ],
  },
  {
    id: 'office_chair',
    name: 'Office chair',
    category: 'office',
    w: 0.65,
    d: 0.65,
    h: 1.1,
    parts: (w, _d, h) => [
      ...[0, 1, 2, 3, 4].flatMap((i) => {
        const a = (i / 5) * Math.PI * 2;
        return [B(Math.sin(a) * w * 0.2, Math.cos(a) * w * 0.2, 0.05, w * 0.42, 0.04, 0.03, 'black', { rot: [0, a + Math.PI / 2, 0], plan: false }), S(Math.sin(a) * w * 0.42, 0.03, Math.cos(a) * w * 0.42, 0.03, 'rubber', { plan: false })];
      }),
      C(0, 0, 0.06, 0.025, 0.36, 'chrome', { plan: false }),
      R(0, 0.02, 0.42, 0.5, 0.48, 0.08, 'black', 0.03),
      R(0, -0.24, 0.52, 0.46, 0.06, h - 0.55, 'black', 0.03, { rot: [-0.12, 0, 0] }),
      B(-0.27, 0, 0.5, 0.04, 0.05, 0.16, 'black', { plan: false }),
      B(0.27, 0, 0.5, 0.04, 0.05, 0.16, 'black', { plan: false }),
      R(-0.27, 0.02, 0.66, 0.06, 0.26, 0.03, 'black', 0.01),
      R(0.27, 0.02, 0.66, 0.06, 0.26, 0.03, 'black', 0.01),
    ],
  },
  {
    id: 'filing_cabinet',
    name: 'Filing cabinet',
    category: 'office',
    w: 0.45,
    d: 0.6,
    h: 1.0,
    parts: (w, d, h) => [B(0, 0, 0, w, d, h, 'metal'), ...[0, 1, 2].flatMap((i) => fronts(-w / 2 + 0.01, w - 0.02, d / 2, 0.03 + i * (h / 3), h / 3 - 0.03, 1, 'metal', 'h'))],
  },

  /* AC & fans */
  {
    id: 'ac_split',
    name: 'Split AC, wall unit',
    category: 'climate',
    w: 0.9,
    d: 0.23,
    h: 0.3,
    mount: 'wall',
    elevation: 2.15,
    keywords: 'air conditioner indoor unit',
    mep: { kind: 'ac_split', system: 'electrical', wattage: 1100 },
    parts: (w, d, h) => [
      R(0, 0, 0.04, w, d, h - 0.04, 'white', 0.04),
      B(0, d / 2 - 0.05, 0, w - 0.06, 0.1, 0.05, 'offwhite'),
      B(0, d / 2 - 0.02, 0.03, w - 0.1, 0.05, 0.012, 'black', { rot: [0.5, 0, 0], plan: false }),
      B(w / 2 - 0.1, d / 2 + 0.001, h * 0.55, 0.05, 0.004, 0.02, 'screen', { plan: false }),
      ...[0, 1, 2, 3, 4, 5].map((i) => B(0, -d / 2 + 0.05 + i * 0.022, h - 0.002, w - 0.12, 0.008, 0.003, 'offwhite', { plan: false })),
    ],
  },
  {
    id: 'ac_cassette',
    name: 'Ceiling cassette AC',
    category: 'climate',
    w: 0.84,
    d: 0.84,
    h: 0.06,
    mount: 'ceiling',
    keywords: 'air conditioner 4-way',
    mep: { kind: 'ac_split', system: 'electrical', wattage: 1600 },
    parts: (w, d, h) => [
      R(0, 0, 0, w, d, h, 'white', 0.01),
      B(0, 0, -0.002, w * 0.45, d * 0.45, 0.004, 'offwhite'),
      ...[0, 1, 2, 3].map((i) => {
        const a = (i * Math.PI) / 2;
        return B(Math.sin(a) * w * 0.34, Math.cos(a) * d * 0.34, -0.003, w * 0.5, 0.06, 0.005, 'black', { rot: [0, a, 0] });
      }),
    ],
  },
  {
    id: 'ac_condenser',
    name: 'AC outdoor unit',
    category: 'climate',
    w: 0.8,
    d: 0.3,
    h: 0.58,
    keywords: 'condenser compressor',
    mep: { kind: 'ac_condenser', system: 'electrical' },
    parts: (w, d, h) => [
      B(-w / 2 + 0.04, 0, 0, 0.06, d + 0.06, 0.05, 'black', { plan: false }),
      B(w / 2 - 0.04, 0, 0, 0.06, d + 0.06, 0.05, 'black', { plan: false }),
      R(0, 0, 0.05, w, d, h - 0.05, 'offwhite', 0.015),
      H(-w * 0.12, 0.05 + (h - 0.05) / 2, d / 2 + 0.005, h * 0.36, 0.01, 'z', 'black', { plan: false, seg: 32 }),
      ...[0.36, 0.26, 0.16].map((r) => ({ g: 'tor' as const, p: [-w * 0.12, 0.05 + (h - 0.05) / 2, d / 2 + 0.012] as [number, number, number], s: [h * r, 0.004, 0] as [number, number, number], m: 'metal' as const, plan: false as const })),
      B(w * 0.36, d / 2 + 0.002, 0.15, w * 0.18, 0.005, h - 0.25, 'metal', { plan: false }),
    ],
  },
  {
    id: 'ceiling_fan',
    name: 'Ceiling fan',
    category: 'climate',
    w: 1.3,
    d: 1.3,
    h: 0.4,
    mount: 'ceiling',
    mep: { kind: 'ceiling_fan', system: 'electrical', wattage: 75 },
    parts: (w, _d, h) => [
      C(0, 0, h - 0.06, 0.06, 0.06, 'white', { r2: 0.04, plan: false }),
      C(0, 0, 0.12, 0.012, h - 0.18, 'white', { plan: false }),
      L(0, 0, 0, [
        [0.03, 0],
        [0.11, 0.02],
        [0.12, 0.08],
        [0.09, 0.13],
        [0.02, 0.14],
      ], 'white'),
      ...[0, 1, 2].map((i) => {
        const a = (i / 3) * Math.PI * 2;
        const L2 = w / 2 - 0.1;
        return R(Math.cos(a) * (0.1 + L2 / 2), Math.sin(a) * (0.1 + L2 / 2), 0.07, L2, 0.13, 0.008, 'wood', 0.004, { rot: [0, -a, 0.04] });
      }),
      C(0, 0, -0.02, 0.07, 0.03, 'lamp', { plan: false }),
    ],
  },
  {
    id: 'stand_fan',
    name: 'Pedestal fan',
    category: 'climate',
    w: 0.45,
    d: 0.45,
    h: 1.3,
    keywords: 'standing fan',
    parts: (w, _d, h) => [
      C(0, 0, 0, w * 0.45, 0.04, 'white', { seg: 32 }),
      C(0, 0, 0.04, 0.015, h - 0.3, 'chrome', { plan: false }),
      H(0, h - 0.2, -0.06, 0.06, 0.14, 'z', 'white', { plan: false }),
      ...[0, 1].map((i) => ({ g: 'tor' as const, p: [0, h - 0.2, 0.04 + i * 0.07] as [number, number, number], s: [0.2, 0.005, 0] as [number, number, number], m: 'chrome' as const, plan: false as const })),
      ...[0, 1, 2].map((i) => {
        const a = (i / 3) * Math.PI * 2;
        return B(Math.cos(a) * 0.09, h - 0.2 + Math.sin(a) * 0.09, 0.07, 0.15, 0.08, 0.004, 'glass', { rot: [Math.PI / 2, 0, a], plan: false });
      }),
    ],
  },

  /* Lighting */
  {
    id: 'light_ceiling',
    name: 'Ceiling light',
    category: 'lighting',
    w: 0.35,
    d: 0.35,
    h: 0.08,
    mount: 'ceiling',
    keywords: 'flush mount',
    mep: { kind: 'light_ceiling', system: 'electrical', wattage: 18 },
    parts: (w, _d, h) => [C(0, 0, 0.01, w / 2, h - 0.01, 'lamp', { seg: 36 }), C(0, 0, h - 0.012, w / 2 + 0.01, 0.012, 'white', { seg: 36 })],
    symbol: (w) => [line(-w / 2, 0, w / 2, 0, 'thin'), line(0, -w / 2, 0, w / 2, 'thin')],
  },
  {
    id: 'pendant',
    name: 'Pendant light',
    category: 'lighting',
    w: 0.4,
    d: 0.4,
    h: 0.75,
    mount: 'ceiling',
    keywords: 'hanging lamp',
    mep: { kind: 'light_ceiling', system: 'electrical', wattage: 12 },
    parts: (w, _d, h) => [
      C(0, 0, h - 0.025, 0.06, 0.025, 'black', { plan: false }),
      C(0, 0, 0.2, 0.004, h - 0.22, 'black', { plan: false }),
      L(0, 0, 0, [
        [w / 2, 0],
        [w / 2 - 0.02, 0.06],
        [w * 0.3, 0.16],
        [0.04, 0.22],
        [0.02, 0.22],
      ], 'black', { plan: 'fill' }),
      S(0, 0.06, 0, 0.05, 'lamp', { plan: false }),
    ],
  },
  {
    id: 'downlight',
    name: 'Downlight',
    category: 'lighting',
    w: 0.12,
    d: 0.12,
    h: 0.02,
    mount: 'ceiling',
    keywords: 'recessed spot',
    mep: { kind: 'light_ceiling', system: 'electrical', wattage: 7 },
    parts: (w, _d, h) => [C(0, 0, 0, w / 2, h, 'white'), C(0, 0, -0.001, w / 2 - 0.02, 0.003, 'lamp')],
  },
  {
    id: 'wall_light',
    name: 'Wall light',
    category: 'lighting',
    w: 0.14,
    d: 0.14,
    h: 0.24,
    mount: 'wall',
    elevation: 1.85,
    keywords: 'sconce',
    mep: { kind: 'light_ceiling', system: 'electrical', wattage: 8 },
    parts: (w, d, h) => [B(0, -d / 2 + 0.01, 0.05, 0.08, 0.02, 0.14, 'black'), C(0, 0.01, 0, w / 2 - 0.01, h, 'black', { seg: 24 }), C(0, 0.01, -0.001, w / 2 - 0.02, 0.003, 'lamp', { plan: false })],
  },
  {
    id: 'floor_lamp',
    name: 'Floor lamp',
    category: 'lighting',
    w: 0.45,
    d: 0.45,
    h: 1.65,
    parts: (w, _d, h) => [
      C(0, 0, 0, w * 0.4, 0.03, 'black', { seg: 32 }),
      C(0, 0, 0.03, 0.012, h - 0.3, 'black', { plan: false }),
      C(0, 0, h - 0.32, w / 2, 0.3, 'linen', { r2: w / 2, seg: 32 }),
      S(0, h - 0.22, 0, 0.04, 'lamp', { plan: false }),
    ],
  },
  {
    id: 'table_lamp',
    name: 'Table lamp',
    category: 'lighting',
    w: 0.3,
    d: 0.3,
    h: 0.5,
    parts: (w, _d, h) => [
      L(0, 0, 0, [
        [0.02, 0],
        [0.09, 0.02],
        [0.1, 0.12],
        [0.06, 0.24],
        [0.015, 0.26],
      ], 'ceramic'),
      C(0, 0, 0.26, 0.008, 0.06, 'chrome', { plan: false }),
      C(0, 0, h - 0.2, w * 0.35, 0.2, 'linen', { r2: w / 2, seg: 32 }),
    ],
  },

  /* Doors & windows (placed into walls) */
  {
    id: 'door_single',
    name: 'Door, single',
    category: 'openings',
    w: 0.9,
    d: 0.2,
    h: 2.1,
    opening: { kind: 'door', style: 'single', height: 2.1, sill: 0 },
    parts: (w, d, h) => [
      B(-w / 2 + 0.03, 0, 0, 0.06, d, h + 0.06, 'white'),
      B(w / 2 - 0.03, 0, 0, 0.06, d, h + 0.06, 'white'),
      B(0, 0, h, w, d, 0.06, 'white'),
      B(0, 0, 0, w - 0.12, 0.04, h, 'wood'),
      ...[0.25, 0.65].map((t) => B(0, 0.022, h * t, w - 0.32, 0.006, h * 0.28, 'woodDark', { plan: false })),
      H(w / 2 - 0.14, 1.0, 0.05, 0.01, 0.12, 'x', 'chrome', { plan: false }),
      B(w / 2 - 0.08, 0.03, 0.95, 0.03, 0.01, 0.14, 'chrome', { plan: false }),
    ],
    symbol: (w, d) => swing(-w / 2 + 0.06, d / 2, w - 0.12, 1),
  },
  {
    id: 'door_double',
    name: 'Door, double',
    category: 'openings',
    w: 1.6,
    d: 0.2,
    h: 2.1,
    opening: { kind: 'door', style: 'double', height: 2.1, sill: 0 },
    parts: (w, d, h) => [
      B(-w / 2 + 0.03, 0, 0, 0.06, d, h + 0.06, 'white'),
      B(w / 2 - 0.03, 0, 0, 0.06, d, h + 0.06, 'white'),
      B(0, 0, h, w, d, 0.06, 'white'),
      ...[-1, 1].flatMap((s) => [
        B((s * (w - 0.12)) / 4, 0, 0, (w - 0.12) / 2 - 0.006, 0.04, h, 'wood'),
        B((s * (w - 0.12)) / 4, 0.022, h * 0.15, (w - 0.12) / 2 - 0.2, 0.006, h * 0.7, 'glass', { plan: false }),
        B(s * 0.06, 0.04, 0.9, 0.02, 0.02, 0.25, 'chrome', { plan: false }),
      ]),
    ],
    symbol: (w, d) => [...swing(-w / 2 + 0.06, d / 2, (w - 0.12) / 2, 1), ...swing(w / 2 - 0.06, d / 2, (w - 0.12) / 2, -1)],
  },
  {
    id: 'door_sliding',
    name: 'Sliding door',
    category: 'openings',
    w: 2.4,
    d: 0.2,
    h: 2.2,
    keywords: 'patio glass',
    opening: { kind: 'door', style: 'sliding', height: 2.2, sill: 0 },
    parts: (w, d, h) => [
      B(0, 0, 0, w, d, 0.03, 'metal'),
      B(0, 0, h, w, d, 0.05, 'metal'),
      B(-w / 2 + 0.025, 0, 0, 0.05, d, h, 'metal'),
      B(w / 2 - 0.025, 0, 0, 0.05, d, h, 'metal'),
      ...[-1, 1].flatMap((s) => [B((s * w) / 4, s * 0.025, 0.03, w / 2, 0.035, h - 0.03, 'glass'), B((s * w) / 4 - (s * w) / 4 + s * 0.01, s * 0.025, 0.03, 0.05, 0.04, h - 0.03, 'metal', { plan: false })]),
    ],
    symbol: (w) => [line(-w / 2, -0.025, 0.05, -0.025), line(-0.05, 0.025, w / 2, 0.025)],
  },
  {
    id: 'door_garage',
    name: 'Garage door',
    category: 'openings',
    w: 2.7,
    d: 0.2,
    h: 2.4,
    keywords: 'roller sectional',
    opening: { kind: 'door', style: 'garage', height: 2.4, sill: 0 },
    parts: (w, d, h) => [B(0, 0, 0, w, 0.05, h, 'paint'), ...Array.from({ length: 5 }, (_, i) => B(0, 0.028, (i + 1) * (h / 6), w - 0.02, 0.006, 0.012, 'metal', { plan: false })), B(-w / 2 - 0.04, 0, 0, 0.08, d, h + 0.08, 'white'), B(w / 2 + 0.04, 0, 0, 0.08, d, h + 0.08, 'white'), B(0, 0, h, w + 0.16, d, 0.08, 'white')],
    symbol: (w) => [line(-w / 2, 0.4, w / 2, 0.4, 'dash')],
  },
  {
    id: 'window_casement',
    name: 'Casement window',
    category: 'openings',
    w: 1.2,
    d: 0.2,
    h: 1.35,
    opening: { kind: 'window', style: 'casement', height: 1.35, sill: 0.9 },
    parts: (w, d, h) => [B(0, 0, 0, w + 0.1, d + 0.04, 0.04, 'stone'), ...frameWithPanes(w, d, h, 2, 1, 0.04)],
  },
  {
    id: 'window_sliding',
    name: 'Sliding window',
    category: 'openings',
    w: 1.8,
    d: 0.2,
    h: 1.2,
    opening: { kind: 'window', style: 'sliding', height: 1.2, sill: 0.95 },
    parts: (w, d, h) => [B(0, 0, 0, w + 0.1, d + 0.04, 0.04, 'stone'), ...frameWithPanes(w, d, h, 2, 1, 0.04, true)],
  },
  {
    id: 'window_picture',
    name: 'Picture window',
    category: 'openings',
    w: 2.0,
    d: 0.2,
    h: 1.8,
    keywords: 'fixed glazing',
    opening: { kind: 'window', style: 'picture', height: 1.8, sill: 0.45 },
    parts: (w, d, h) => [B(0, 0, 0, w + 0.1, d + 0.04, 0.04, 'stone'), ...frameWithPanes(w, d, h, 1, 1, 0.04)],
  },
  {
    id: 'window_louvre',
    name: 'Louvre window',
    category: 'openings',
    w: 0.6,
    d: 0.2,
    h: 0.6,
    keywords: 'bathroom ventilation jalousie',
    opening: { kind: 'window', style: 'casement', height: 0.6, sill: 1.6 },
    parts: (w, d, h) => [...frameWithPanes(w, d, h, 1, 1, 0.035).filter((p) => p.m !== 'glass'), ...Array.from({ length: Math.round(h / 0.1) }, (_, i) => B(0, 0, 0.04 + i * 0.1, w - 0.08, 0.1, 0.006, 'glass', { rot: [0.5, 0, 0] }))],
  },

  /* Outdoor */
  {
    id: 'car',
    name: 'Car',
    category: 'outdoor',
    w: 1.85,
    d: 4.5,
    h: 1.48,
    keywords: 'parking vehicle',
    parts: (w, d, h) => {
      // Built along z; if placed wider than deep, it is turned to fit.
      const along = d >= w;
      const L2 = along ? d : w;
      const W = along ? w : d;
      const parts: Part[] = [
        R(0, 0, 0.18, W, L2, 0.55, 'paint', 0.18),
        R(0, -L2 * 0.05, 0.68, W - 0.16, L2 * 0.5, h - 0.7, 'glass', 0.16),
        R(0, -L2 * 0.05, h - 0.06, W - 0.22, L2 * 0.4, 0.05, 'paint', 0.04),
        ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => H(sx * (W / 2 - 0.12), 0.32, sz * L2 * 0.32, 0.32, 0.22, 'x', 'rubber', { plan: false }))),
        ...[-1, 1].map((sx) => B(sx * (W / 2 - 0.22), L2 / 2 - 0.02, 0.5, 0.28, 0.03, 0.08, 'lamp', { plan: false })),
      ];
      return along ? parts : parts.map((p) => ({ ...p, p: [p.p[2], p.p[1], -p.p[0]] as [number, number, number], rot: [(p.rot?.[0] ?? 0), (p.rot?.[1] ?? 0) + Math.PI / 2, p.rot?.[2] ?? 0] as [number, number, number] }));
    },
  },
  {
    id: 'sun_lounger',
    name: 'Sun lounger',
    category: 'outdoor',
    w: 0.7,
    d: 1.95,
    h: 0.75,
    keywords: 'pool deck chair',
    parts: (w, d) => [...legs(w, d - 0.1, 0.25, 'wood', 0.05, 0.025, false), B(0, 0.25, 0.25, w, d * 0.66, 0.05, 'wood'), R(0, 0.25, 0.3, w - 0.06, d * 0.64, 0.05, 'linen', 0.02), R(0, -d / 2 + 0.33, 0.3, w, 0.62, 0.05, 'wood', 0.01, { rot: [0.75, 0, 0] }), R(0, -d / 2 + 0.36, 0.35, w - 0.06, 0.6, 0.05, 'linen', 0.02, { rot: [0.75, 0, 0], plan: false })],
  },
  {
    id: 'outdoor_set',
    name: 'Outdoor table set',
    category: 'outdoor',
    w: 1.6,
    d: 1.6,
    h: 2.4,
    keywords: 'patio umbrella',
    parts: (w, d) => [...ASSETS.find((a) => a.id === 'dining_round')!.parts!(w, d, 0.74), C(0, 0, 0, 0.02, 2.3, 'metal', { plan: false }), L(0, 0, 2.0, [[w * 0.62, 0], [w * 0.3, 0.2], [0.02, 0.32]], 'linen', { seg: 8, plan: 'dash' })],
  },
  {
    id: 'bbq',
    name: 'Barbecue grill',
    category: 'outdoor',
    w: 1.1,
    d: 0.55,
    h: 1.15,
    parts: (w, d) => [...legs(w * 0.55, d - 0.05, 0.85, 'black', 0.03, 0.02, false), R(0, 0, 0.7, w * 0.55, d - 0.05, 0.2, 'black', 0.04), H(0, 0.92, -0.02, 0.22, w * 0.55, 'x', 'black', { sc: [1, 1, 1], plan: false }), B(-w * 0.38, 0, 0.85, w * 0.22, d - 0.1, 0.02, 'steel'), B(w * 0.38, 0, 0.85, w * 0.22, d - 0.1, 0.02, 'steel'), ...[-1, 1].map((s) => H(s * 0.15, 0.1, 0, 0.06, 0.04, 'x', 'rubber', { plan: false }))],
  },
  {
    id: 'water_tank',
    name: 'Water tank',
    category: 'outdoor',
    w: 1.4,
    d: 1.4,
    h: 1.7,
    keywords: 'rainwater storage',
    parts: (w, _d, h) => [C(0, 0, 0, w / 2, h - 0.1, 'accent', { seg: 32 }), C(0, 0, h - 0.1, w / 2 - 0.05, 0.1, 'accent', { r2: w / 2, seg: 32 }), C(0, 0, h, 0.2, 0.06, 'black'), ...[0.25, 0.5, 0.75].map((t) => ({ g: 'tor' as const, p: [0, h * t, 0] as [number, number, number], s: [w / 2 + 0.005, 0.015, 0] as [number, number, number], m: 'accent' as const, rot: [Math.PI / 2, 0, 0] as [number, number, number], plan: false as const }))],
  },

  /* Trees & plants */
  { id: 'tree_shade', name: 'Shade tree', category: 'trees', w: 5, d: 5, h: 6, keywords: 'broadleaf canopy', parts: (w, _d, h) => broadleaf(w, h) },
  { id: 'tree_small', name: 'Small tree', category: 'trees', w: 2.5, d: 2.5, h: 3.5, parts: (w, _d, h) => broadleaf(w, h, 'leaf', 0.4) },
  {
    id: 'tree_frangipani',
    name: 'Frangipani',
    category: 'trees',
    w: 3,
    d: 3,
    h: 3.5,
    keywords: 'plumeria flowering',
    parts: (w, _d, h) => {
      const out: Part[] = [C(0, 0, 0, 0.09, h * 0.35, 'trunk', { seg: 8, r2: 0.12, plan: false })];
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 + 0.3;
        const bx = Math.cos(a) * w * 0.28;
        const bz = Math.sin(a) * w * 0.28;
        out.push({ g: 'cyl', p: [bx / 2, h * 0.5, bz / 2], s: [0.045, h * 0.42, 0.06], m: 'trunk', rot: [Math.sin(a) * 0.7, 0, -Math.cos(a) * 0.7], seg: 8, plan: false });
        out.push(S(bx, h * 0.72, bz, w * 0.2, 'leaf', { seg: 12, sc: [1, 0.55, 1] }));
        out.push(S(bx * 1.05, h * 0.8, bz * 1.05, w * 0.06, 'linen', { seg: 8, plan: false }));
      }
      return out;
    },
  },
  {
    id: 'tree_conifer',
    name: 'Conifer',
    category: 'trees',
    w: 2.2,
    d: 2.2,
    h: 6,
    keywords: 'pine cypress casuarina',
    parts: (w, _d, h) => [C(0, 0, 0, 0.09, h * 0.25, 'trunk', { seg: 8, plan: false }), ...[0, 1, 2, 3].map((i) => C(0, 0, h * (0.18 + i * 0.19), 0.02, h * 0.32, 'leaf', { r2: (w / 2) * (1 - i * 0.2), seg: 16 }))],
  },
  { id: 'palm_coconut', name: 'Coconut palm', category: 'trees', w: 6, d: 6, h: 9, keywords: 'palm tree', parts: (w, _d, h) => [...palm(w, h, 0.14, 11), ...[0, 1, 2].map((i) => S(Math.sin(1.4) * 0.14 * h * 0.35 + Math.cos(i * 2.1) * 0.18, h * 0.84, Math.sin(i * 2.1) * 0.18, 0.1, 'accent', { seg: 10, plan: false }))] },
  { id: 'palm_areca', name: 'Areca palm', category: 'trees', w: 2.2, d: 2.2, h: 3.2, keywords: 'palm clump', parts: (w, _d, h) => [-0.25, 0.1, 0.3].flatMap((o, i) => palm(w * 0.8, h * (0.8 + i * 0.12), 0.05, 7).map((p) => ({ ...p, p: [p.p[0] + o, p.p[1], p.p[2] + (i - 1) * 0.2] as [number, number, number] }))) },
  {
    id: 'banana',
    name: 'Banana plant',
    category: 'trees',
    w: 2.5,
    d: 2.5,
    h: 3.5,
    parts: (w, _d, h) => [
      C(0, 0, 0, 0.12, h * 0.55, 'accent', { r2: 0.15, seg: 10 }),
      ...Array.from({ length: 7 }, (_, i) => {
        const a = (i / 7) * Math.PI * 2;
        return B(Math.cos(a) * w * 0.22, Math.sin(a) * w * 0.22, h * 0.58 + (i % 2) * 0.2, w * 0.5, 0.35, 0.015, 'leaf', { rot: [0.25, -a, 0.35] });
      }),
    ],
  },
  {
    id: 'shrub',
    name: 'Shrub',
    category: 'trees',
    w: 1.2,
    d: 1.2,
    h: 1.0,
    keywords: 'bush hedge',
    parts: (w, _d, h) => [S(0, h * 0.45, 0, w * 0.45, 'leaf', { seg: 12, sc: [1, h / w + 0.05, 1] }), S(w * 0.2, h * 0.55, w * 0.1, w * 0.3, 'leaf', { seg: 12 }), S(-w * 0.18, h * 0.4, -w * 0.12, w * 0.32, 'leaf', { seg: 12 })],
  },
  {
    id: 'hedge',
    name: 'Hedge',
    category: 'trees',
    w: 3,
    d: 0.6,
    h: 1.2,
    parts: (w, d, h) => [R(0, 0, 0, w, d, h, 'leaf', Math.min(0.25, d / 2 - 0.01)), ...Array.from({ length: Math.round(w / 0.5) }, (_, i) => S(-w / 2 + 0.25 + i * 0.5, h - 0.05, 0, d * 0.4, 'leaf', { seg: 10, plan: false }))],
  },
  {
    id: 'planter',
    name: 'Planter box',
    category: 'trees',
    w: 1.2,
    d: 0.45,
    h: 0.9,
    parts: (w, d) => [...vessel(0, 0, 0, w, d, 0.5, 0.04, 'terracotta', 0.02), B(0, 0, 0.42, w - 0.08, d - 0.08, 0.04, 'soil', { plan: false }), ...((n) => Array.from({ length: n }, (_, i) => S(-w / 2 + (w / n) * (i + 0.5), 0.65, 0, Math.min(0.2, d / 2), 'leaf', { seg: 10, sc: [1, 1.2, 1] })))(Math.max(2, Math.round(w / 0.35)))],
  },

  /* Gates & boundary */
  {
    id: 'gate_swing_double',
    name: 'Driveway gate, double swing',
    category: 'boundary',
    w: 3.6,
    d: 0.4,
    h: 1.8,
    keywords: 'gate entrance',
    parts: (w, d, h) => {
      const leaf = (w - 0.8) / 2;
      return [
        ...[-1, 1].map((s) => B(s * (w / 2 - 0.2), 0, 0, 0.4, d, h + 0.3, 'white')),
        ...[-1, 1].map((s) => B(s * (w / 2 - 0.2), 0, h + 0.3, 0.46, d + 0.06, 0.06, 'stone', { plan: false })),
        ...[-1, 1].flatMap((s) => {
          const x0 = s > 0 ? 0.01 : -leaf - 0.01;
          return [B(x0 + leaf / 2, 0, 0.08, leaf, 0.05, 0.06, 'black', { plan: false }), B(x0 + leaf / 2, 0, h - 0.08, leaf, 0.05, 0.06, 'black'), ...bars(x0 + 0.04, x0 + leaf - 0.04, 0, 0.14, h - 0.08, 0.12)];
        }),
      ];
    },
    symbol: (w, d) => {
      const leaf = (w - 0.8) / 2;
      return [...swing(-w / 2 + 0.4, d / 2, leaf, 1), ...swing(w / 2 - 0.4, d / 2, leaf, -1)];
    },
  },
  {
    id: 'gate_sliding',
    name: 'Sliding gate',
    category: 'boundary',
    w: 4.0,
    d: 0.3,
    h: 1.8,
    keywords: 'driveway rolling',
    parts: (w, d, h) => [
      B(-w / 2 - 0.15, 0, 0, 0.3, d, h + 0.2, 'white'),
      B(w / 2 + 0.15, 0, 0, 0.3, d, h + 0.2, 'white'),
      B(0, 0, 0, w + 0.6, 0.06, 0.02, 'metal', { plan: false }),
      B(0, 0, 0.06, w, 0.06, 0.1, 'black'),
      B(0, 0, h - 0.1, w, 0.06, 0.1, 'black'),
      ...Array.from({ length: Math.round((h - 0.2) / 0.16) }, (_, i) => B(0, 0, 0.18 + i * 0.16, w - 0.02, 0.04, 0.1, 'woodDark', { plan: false })),
      ...[-1, 1].map((s) => H(s * (w / 2 - 0.3), 0.05, 0, 0.05, 0.04, 'x', 'metal', { plan: false })),
    ],
    symbol: (w, d) => [line(-w / 2, d / 2 + 0.05, w / 2 + 0.4, d / 2 + 0.05, 'dash')],
  },
  {
    id: 'gate_pedestrian',
    name: 'Pedestrian gate',
    category: 'boundary',
    w: 1.4,
    d: 0.4,
    h: 1.8,
    keywords: 'side gate',
    parts: (w, d, h) => {
      const leaf = w - 0.6;
      return [...[-1, 1].map((s) => B(s * (w / 2 - 0.15), 0, 0, 0.3, d, h + 0.25, 'white')), B(0, 0, 0.08, leaf, 0.05, 0.05, 'black', { plan: false }), B(0, 0, h - 0.06, leaf, 0.05, 0.05, 'black'), ...bars(-leaf / 2 + 0.03, leaf / 2 - 0.03, 0, 0.13, h - 0.06, 0.11), B(leaf / 2 - 0.08, 0.04, 1.0, 0.1, 0.03, 0.06, 'chrome', { plan: false })];
    },
    symbol: (w, d) => swing(-w / 2 + 0.3, d / 2, w - 0.6, 1),
  },
  {
    id: 'gate_timber',
    name: 'Timber gate',
    category: 'boundary',
    w: 3.2,
    d: 0.35,
    h: 1.9,
    keywords: 'wooden driveway',
    parts: (w, d, h) => {
      const leaf = (w - 0.7) / 2;
      return [
        ...[-1, 1].map((s) => B(s * (w / 2 - 0.175), 0, 0, 0.35, d, h + 0.2, 'stone')),
        ...[-1, 1].flatMap((s) => {
          const cx = s * (leaf / 2 + 0.005);
          return [...Array.from({ length: Math.round(leaf / 0.12) }, (_, i) => B(cx - leaf / 2 + 0.06 + i * 0.12, 0, 0.06, 0.11, 0.04, h - 0.1, 'wood', { plan: i === 0 ? 'fill' : false })), B(cx, 0.03, 0.3, leaf, 0.03, 0.1, 'woodDark', { plan: false }), B(cx, 0.03, h - 0.45, leaf, 0.03, 0.1, 'woodDark', { plan: false })];
        }),
      ];
    },
    symbol: (w, d) => {
      const leaf = (w - 0.7) / 2;
      return [line(-leaf, 0, leaf, 0), ...swing(-w / 2 + 0.35, d / 2, leaf, 1), ...swing(w / 2 - 0.35, d / 2, leaf, -1)];
    },
  },
  {
    id: 'boundary_wall',
    name: 'Boundary wall',
    category: 'boundary',
    w: 4.0,
    d: 0.23,
    h: 1.8,
    keywords: 'compound wall',
    parts: (w, d, h) => {
      const n = Math.max(1, Math.round(w / 3));
      return [B(0, 0, 0, w, d, h, 'white'), B(0, 0, h, w + 0.02, d + 0.06, 0.05, 'stone', { plan: false }), ...Array.from({ length: n + 1 }, (_, i) => B(-w / 2 + (w / n) * i, 0, 0, 0.35, d + 0.1, h + 0.12, 'white', { plan: 'line' })), B(0, 0, 0, w + 0.06, d + 0.08, 0.12, 'stone', { plan: false })];
    },
  },
  {
    id: 'fence_picket',
    name: 'Picket fence',
    category: 'boundary',
    w: 3.0,
    d: 0.1,
    h: 1.1,
    parts: (w, _d, h) => [...Array.from({ length: Math.round(w / 1.5) + 1 }, (_, i) => B(-w / 2 + i * (w / Math.round(w / 1.5)), 0, 0, 0.08, 0.08, h + 0.05, 'white')), B(0, -0.04, 0.25, w, 0.03, 0.08, 'white', { plan: false }), B(0, -0.04, h - 0.3, w, 0.03, 0.08, 'white', { plan: false }), ...Array.from({ length: Math.round(w / 0.13) }, (_, i) => B(-w / 2 + 0.065 + i * 0.13, 0, 0, 0.08, 0.02, h - (i % 2) * 0.04, 'white', { plan: false }))],
    symbol: (w) => [line(-w / 2, 0, w / 2, 0)],
  },
  {
    id: 'fence_railing',
    name: 'Steel railing',
    category: 'boundary',
    w: 3.0,
    d: 0.1,
    h: 1.1,
    keywords: 'balcony balustrade fence',
    parts: (w, _d, h) => [...Array.from({ length: Math.round(w / 1.5) + 1 }, (_, i) => B(-w / 2 + i * (w / Math.round(w / 1.5)), 0, 0, 0.05, 0.05, h, 'black')), B(0, 0, h - 0.04, w, 0.06, 0.04, 'black'), B(0, 0, 0.08, w, 0.03, 0.03, 'black', { plan: false }), ...bars(-w / 2 + 0.06, w / 2 - 0.06, 0, 0.11, h - 0.04, 0.11)],
  },
];

/** Walls, doors and windows of a frame, split into panes, for window thumbnails and models. */
function frameWithPanes(w: number, d: number, h: number, cols: number, rows: number, f: number, sliding = false): Part[] {
  const y0 = 0.04;
  const out: Part[] = [B(-w / 2 + f / 2, 0, y0, f, d * 0.5, h, 'metal'), B(w / 2 - f / 2, 0, y0, f, d * 0.5, h, 'metal'), B(0, 0, y0, w, d * 0.5, f, 'metal'), B(0, 0, y0 + h - f, w, d * 0.5, f, 'metal')];
  for (let c = 1; c < cols; c++) out.push(B(-w / 2 + (w / cols) * c, 0, y0, f * 0.8, d * 0.5, h, 'metal', { plan: false }));
  for (let r = 1; r < rows; r++) out.push(B(0, 0, y0 + (h / rows) * r, w, d * 0.5, f * 0.8, 'metal', { plan: false }));
  for (let c = 0; c < cols; c++) out.push(B(-w / 2 + (w / cols) * (c + 0.5), sliding ? (c % 2 ? 0.02 : -0.02) : 0, y0 + f, w / cols - f, 0.01, h - 2 * f, 'glass'));
  return out;
}

export const ASSET_BY_ID = new Map(ASSETS.map((a) => [a.id, a]));

/** Older projects used a few fixed furniture types; they map onto library items. */
const LEGACY: Record<string, string> = { kitchen_counter: 'kitchen_counter', sink: 'sink', shower: 'shower', wc: 'wc', car: 'car', desk: 'desk', sofa: 'sofa', dining_table: 'dining_table', bed_double: 'bed_double', bed_single: 'bed_single' };
export const assetFor = (type: string): AssetDef | undefined => ASSET_BY_ID.get(LEGACY[type] ?? type);

/** Default library model for each kind of service point, when the point does not name one. */
export const MEP_DEFAULT_ASSET: Partial<Record<MEPNodeKind, string>> = {
  ac_split: 'ac_split',
  ac_condenser: 'ac_condenser',
  ceiling_fan: 'ceiling_fan',
  light_ceiling: 'light_ceiling',
};
