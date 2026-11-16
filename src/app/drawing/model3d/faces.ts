/**
 * A light 3D face model of the building, made for drawing rather than rendering.
 *
 * Every surface is a planar polygon (optionally with holes) tagged with what it is. The
 * elevation and section views project these faces onto a picture plane and paint them
 * far-to-near, so hidden surfaces are covered naturally and the result stays pure vector.
 *
 * Axes: x = east, y = south (same as the plan), z = up. Metres.
 */
import {
  getDesignConfig,
  getRoofDrainageConfig,
  getSolarConfig,
  GUTTER_PROFILE_META,
  WATER_COLLECTION_META,
  type BuildingProject,
  type FloorLevel,
  type Opening,
} from '../../../model/types';
import { FACADE_MATERIAL_OPTIONS, ROOF_MATERIAL_OPTIONS } from '../../../components/Viewport3D';
import { wallFrame } from '../plan/kernel';
import { computeSolarArrayLayout } from '../../../engine/geometry';

export interface V3 {
  x: number;
  y: number;
  z: number;
}

export type FaceKind = 'wall' | 'glass' | 'door' | 'frame' | 'sill' | 'roof' | 'fascia' | 'slab' | 'plinth' | 'reveal' | 'gutter' | 'downpipe' | 'tank' | 'solar';

export interface Face {
  kind: FaceKind;
  pts: V3[];
  holes?: V3[][];
  /** Outward normal. */
  n: V3;
  /** Extra linework that belongs to the face (window mullions, panel lines). */
  lines?: [V3, V3][];
  /** Dashed opening-direction lines (casement sashes, door swings). */
  sash?: [V3, V3][];
  /** Opening mark (W1, D2) on the outward face of an exterior opening. */
  tag?: string;
  /** Raised seams / courses on a roof plane, built as real geometry in 3D. */
  ribs?: { a: V3; b: V3; width: number; height: number }[];
  fill: string;
  /** Painter's tie-break when depths are equal: higher draws later. */
  order: number;
}

export interface BuildingFrame {
  faces: Face[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  eaveZ: number;
  ridgeZ: number;
  groundFloorZ: number;
  roofPlanes: { pts: V3[] }[];
  /** Material notes for callouts, by surface kind. */
  notes: Partial<Record<FaceKind, string>>;
  /** Ridge and hip lines, for caps in 3D. */
  ridgeEdges: [V3, V3][];
  /** Rainwater goods, for round geometry in 3D (the faces carry the drawing version). */
  drainage: Drainage | null;
}

export interface Drainage {
  color: string;
  halfRound: boolean;
  gutters: { a: V3; b: V3; out: { x: number; y: number } }[];
  downpipes: { top: V3; wall: { x: number; y: number }; out: { x: number; y: number } }[];
  collection: { mode: string; x: number; y: number; radius: number; height: number } | null;
}

const v = (x: number, y: number, z: number): V3 => ({ x, y, z });

/** Mix a hex colour toward white. */
export function tint(hex: string, toWhite: number): string {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => Math.max(0, Math.min(255, Math.round(c + (255 - c) * toWhite))));
  return '#' + ch.map((c) => c.toString(16).padStart(2, '0')).join('');
}

const GLASS = '#D3DEE6';
const PLINTH = '#D9D5CC';

export function levelBounds(level: FloorLevel) {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const w of level.walls) {
    const t = w.thickness / 2;
    xs.push(w.start.x - t, w.end.x - t, w.start.x + t, w.end.x + t);
    ys.push(w.start.y - t, w.end.y - t, w.start.y + t, w.end.y + t);
  }
  if (!xs.length) return { minX: 0, minY: 0, maxX: 10, maxY: 8 };
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

/** Six faces of an axis-aligned box. */
function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, kind: FaceKind, fill: string, order = 0): Face[] {
  return [
    { kind, fill, order, n: v(0, -1, 0), pts: [v(x0, y0, z0), v(x1, y0, z0), v(x1, y0, z1), v(x0, y0, z1)] },
    { kind, fill, order, n: v(0, 1, 0), pts: [v(x1, y1, z0), v(x0, y1, z0), v(x0, y1, z1), v(x1, y1, z1)] },
    { kind, fill, order, n: v(-1, 0, 0), pts: [v(x0, y1, z0), v(x0, y0, z0), v(x0, y0, z1), v(x0, y1, z1)] },
    { kind, fill, order, n: v(1, 0, 0), pts: [v(x1, y0, z0), v(x1, y1, z0), v(x1, y1, z1), v(x1, y0, z1)] },
    { kind, fill, order, n: v(0, 0, 1), pts: [v(x0, y0, z1), v(x1, y0, z1), v(x1, y1, z1), v(x0, y1, z1)] },
  ];
}

interface Palette {
  wall: string;
  frame: string;
  door: string;
}

const FRAME_COLOR: Record<string, string> = {
  anthracite: '#3A3F44',
  bronze: '#6B5640',
  silver_anodized: '#A3A9AF',
  timber_oak: '#9C7A54',
  matte_black: '#26282A',
};
const DOOR_COLOR: Record<string, string> = {
  walnut: '#7A5A44',
  oak: '#B8925E',
  matte_black: '#3A3B3D',
  frosted_glass: '#DCE3E7',
  white_lacquer: '#F1F0EC',
};

/** A flat rectangle in the wall's frame (s along the wall, z up) at offset `off` from the centreline. */
function wallRect(P: (s: number, off: number, z: number) => V3, s0: number, s1: number, z0: number, z1: number, off: number, side: number) {
  return side > 0 ? [P(s0, off, z0), P(s1, off, z0), P(s1, off, z1), P(s0, off, z1)] : [P(s1, off, z0), P(s0, off, z0), P(s0, off, z1), P(s1, off, z1)];
}

function openingFaces(level: FloorLevel, o: Opening, pal: Palette, exterior: boolean, center: { x: number; y: number }): Face[] {
  // A colour chosen for this opening overrides the project's frame / door finish.
  if (o.frameColor) pal = { ...pal, frame: o.frameColor, door: o.kind === 'door' ? o.frameColor : pal.door };
  const w = level.walls.find((x) => x.id === o.wallId);
  if (!w) return [];
  const f = wallFrame(w);
  const z0 = level.elevation + (o.kind === 'door' ? 0 : o.sillHeight);
  const z1 = z0 + o.height;
  const c = o.offset * f.length;
  const P = (s: number, off: number, z: number) => v(w.start.x + f.dir.x * s + f.n.x * off, w.start.y + f.dir.y * s + f.n.y * off, z);
  const s0 = c - o.width / 2;
  const s1 = c + o.width / 2;
  const t = w.thickness / 2;
  const faces: Face[] = [];
  const fw = o.kind === 'window' ? 0.055 : 0.07; // frame width
  const bar = 0.04; // mullion / transom

  for (const side of [1, -1]) {
    const n = v(f.n.x * side, f.n.y * side, 0);
    const back = side * 0.02; // glass / leaf plane, set back in the reveal
    const front = side * 0.035; // frame plane, just proud of the glass
    const R = (a0: number, a1: number, b0: number, b1: number, off: number) => wallRect(P, a0, a1, b0, b1, off, side);
    const mid = P(c, 0, 0);
    const outward = (mid.x - center.x) * n.x + (mid.y - center.y) * n.y > 0;
    const tag = exterior && outward && o.label ? o.label : undefined;

    if (o.kind === 'window') {
      faces.push({ kind: 'glass', pts: R(s0, s1, z0, z1, back), n, fill: GLASS, order: 1 });
      // Frame: outer rectangle with the daylight opening cut out, plus mullion and transom bars.
      const holes: V3[][] = [];
      const panes: [number, number, number, number][] = [];
      const split = o.style === 'casement' || o.style === 'sliding' ? 2 : o.style === 'bay' ? 3 : 1;
      const transom = o.style === 'casement' && o.height > 1.25 ? z1 - fw - 0.42 : null;
      const inner0 = s0 + fw;
      const inner1 = s1 - fw;
      const paneW = (inner1 - inner0 - bar * (split - 1)) / split;
      for (let i = 0; i < split; i++) {
        const a0 = inner0 + i * (paneW + bar);
        const a1 = a0 + paneW;
        if (transom !== null) {
          panes.push([a0, a1, z0 + fw, transom], [a0, a1, transom + bar, z1 - fw]);
        } else panes.push([a0, a1, z0 + fw, z1 - fw]);
      }
      for (const [a0, a1, b0, b1] of panes) holes.push(R(a0, a1, b0, b1, front));
      // Casement sashes: dashed lines meeting at the hinge side (the conventional opening mark).
      const sash: [V3, V3][] = [];
      if (o.style === 'casement') {
        const lower = panes.filter((p) => p[2] === z0 + fw);
        lower.forEach(([a0, a1, b0, b1], i) => {
          const hingeAtLeft = (i === 0) === (side > 0);
          const hx = hingeAtLeft ? a0 : a1;
          const ox = hingeAtLeft ? a1 : a0;
          sash.push([P(ox, front, b0), P(hx, front, (b0 + b1) / 2)], [P(hx, front, (b0 + b1) / 2), P(ox, front, b1)]);
        });
      }
      faces.push({ kind: 'frame', pts: R(s0, s1, z0, z1, front), holes, n, fill: pal.frame, order: 2, sash, tag });
      // Sill: a slim projecting ledge under the window.
      const sz = z0 - 0.06;
      faces.push({ kind: 'sill', pts: R(s0 - 0.06, s1 + 0.06, sz, z0, side * (t + 0.05)), n, fill: '#F4F3EF', order: 3 });
    } else {
      // Door frame (head + jambs) and leaf.
      faces.push({ kind: 'frame', pts: R(s0, s1, z0, z1, front), holes: [R(s0 + fw, s1 - fw, z0, z1 - fw, front)], n, fill: pal.frame, order: 2 });
      const lines: [V3, V3][] = [];
      const lz1 = z1 - fw;
      if (o.style === 'garage') {
        for (let z = z0 + 0.25; z < lz1 - 0.05; z += 0.25) lines.push([P(s0 + fw, back, z), P(s1 - fw, back, z)]);
      } else {
        if (o.style === 'double' || o.style === 'sliding') lines.push([P(c, back, z0), P(c, back, lz1)]);
        // Recessed panels on each leaf.
        const leaves = o.style === 'double' || o.style === 'sliding' ? [[s0 + fw, c], [c, s1 - fw]] : [[s0 + fw, s1 - fw]];
        for (const [a0, a1] of leaves) {
          const m = 0.12;
          const pz0 = z0 + 0.15;
          const pz1 = lz1 - 0.15;
          const mid = (pz0 + pz1) / 2;
          for (const [b0, b1] of [[pz0, mid - 0.05], [mid + 0.05, pz1]])
            lines.push([P(a0 + m, back, b0), P(a1 - m, back, b0)], [P(a1 - m, back, b0), P(a1 - m, back, b1)], [P(a1 - m, back, b1), P(a0 + m, back, b1)], [P(a0 + m, back, b1), P(a0 + m, back, b0)]);
        }
        const hx = o.style === 'double' ? c - 0.1 : s1 - fw - 0.1;
        lines.push([P(hx, back, z0 + 0.98), P(hx, back, z0 + 1.12)]);
      }
      faces.push({ kind: 'door', pts: R(s0 + fw, s1 - fw, z0, lz1, back), n, fill: pal.door, order: 1, lines, tag });
    }
  }
  // Reveals from the wall face back to the glass.
  for (const side of [1, -1]) {
    const a = side * t;
    const b = side * 0.02;
    faces.push({ kind: 'reveal', fill: pal.wall, order: 0, n: v(f.dir.x, f.dir.y, 0), pts: [P(s0, a, z0), P(s0, b, z0), P(s0, b, z1), P(s0, a, z1)] });
    faces.push({ kind: 'reveal', fill: pal.wall, order: 0, n: v(-f.dir.x, -f.dir.y, 0), pts: [P(s1, b, z0), P(s1, a, z0), P(s1, a, z1), P(s1, b, z1)] });
  }
  return faces;
}

/** True when a wall end meets another wall (so its end cap is buried and must not be drawn). */
function endIsJoined(level: FloorLevel, wallId: string, p: { x: number; y: number }): boolean {
  for (const o of level.walls) {
    if (o.id === wallId) continue;
    const f = wallFrame(o);
    if (f.length < 1e-3) continue;
    const rx = p.x - o.start.x;
    const ry = p.y - o.start.y;
    const s = rx * f.dir.x + ry * f.dir.y;
    const d = Math.abs(rx * f.n.x + ry * f.n.y);
    if (s >= -o.thickness && s <= f.length + o.thickness && d <= o.thickness / 2 + 0.02) return true;
  }
  return false;
}

function wallFaces(level: FloorLevel, pal: Palette): Face[] {
  const faces: Face[] = [];
  const lb = levelBounds(level);
  const center = { x: (lb.minX + lb.maxX) / 2, y: (lb.minY + lb.maxY) / 2 };
  for (const w of level.walls) {
    const f = wallFrame(w);
    if (f.length < 0.01) continue;
    const t = w.thickness / 2;
    // Ends extend by half the thickness so corners close, as in the plan kernel.
    const sA = -t;
    const sB = f.length + t;
    const z0 = level.elevation;
    const z1 = z0 + w.height;
    const P = (s: number, off: number, z: number) => v(w.start.x + f.dir.x * s + f.n.x * off, w.start.y + f.dir.y * s + f.n.y * off, z);
    const openings = level.openings.filter((o) => o.wallId === w.id);
    const fill = w.color ? tint(w.color, 0.15) : w.isExterior ? pal.wall : '#F2F0EB';
    for (const side of [1, -1]) {
      const off = side * t;
      const n = v(f.n.x * side, f.n.y * side, 0);
      const holes = openings.map((o) => {
        const c = o.offset * f.length;
        const oz0 = z0 + (o.kind === 'door' ? 0 : o.sillHeight);
        return wallRect(P, c - o.width / 2, c + o.width / 2, oz0, oz0 + o.height, off, side);
      });
      faces.push({ kind: 'wall', pts: wallRect(P, sA, sB, z0, z1, off, side), holes, n, fill, order: 0 });
    }
    faces.push({ kind: 'wall', fill, order: 0, n: v(0, 0, 1), pts: [P(sA, -t, z1), P(sB, -t, z1), P(sB, t, z1), P(sA, t, z1)] });
    // End caps only where the wall stops freely; buried caps would draw false seams.
    if (!endIsJoined(level, w.id, w.start))
      faces.push({ kind: 'wall', fill, order: 0, n: v(-f.dir.x, -f.dir.y, 0), pts: [P(sA, t, z0), P(sA, -t, z0), P(sA, -t, z1), P(sA, t, z1)] });
    if (!endIsJoined(level, w.id, w.end))
      faces.push({ kind: 'wall', fill, order: 0, n: v(f.dir.x, f.dir.y, 0), pts: [P(sB, -t, z0), P(sB, t, z0), P(sB, t, z1), P(sB, -t, z1)] });
    for (const o of openings) faces.push(...openingFaces(level, o, pal, w.isExterior, center));
  }
  return faces;
}

function roofFaces(model: BuildingProject, top: FloorLevel, eaveZ: number): { faces: Face[]; ridgeZ: number; planes: { pts: V3[] }[] } {
  const r = model.roof;
  const b = levelBounds(top);
  const oh = r.overhang;
  const x0 = b.minX - oh;
  const x1 = b.maxX + oh;
  const y0 = b.minY - oh;
  const y1 = b.maxY + oh;
  const roofColor = ROOF_MATERIAL_OPTIONS.find((o) => o.id === r.material)?.base ?? '#64748b';
  const fill = tint(roofColor, 0.55);
  const wallFill = tint(FACADE_MATERIAL_OPTIONS.find((o) => o.id === getDesignConfig(model).exteriorFacade)?.base ?? '#eef2f6', 0.35);
  const tan = Math.tan((Math.max(2, r.pitchDeg) * Math.PI) / 180);
  const faces: Face[] = [];
  const planes: { pts: V3[] }[] = [];
  const fasciaH = 0.2;
  const plane = (pts: V3[]) => {
    // Normal from the first three points; flip so it points up.
    const a = pts[0], bb = pts[1], c = pts[2];
    const u = v(bb.x - a.x, bb.y - a.y, bb.z - a.z);
    const w = v(c.x - a.x, c.y - a.y, c.z - a.z);
    let n = v(u.y * w.z - u.z * w.y, u.z * w.x - u.x * w.z, u.x * w.y - u.y * w.x);
    if (n.z < 0) n = v(-n.x, -n.y, -n.z);
    const l = Math.hypot(n.x, n.y, n.z) || 1;
    const nn = v(n.x / l, n.y / l, n.z / l);
    const pat = roofPattern(pts, nn, r.material);
    faces.push({ kind: 'roof', pts, n: nn, fill, order: 2, lines: pat.lines, ribs: pat.ribs });
    planes.push({ pts });
  };

  if (r.type === 'flat') {
    const top = eaveZ + 0.2;
    const para = top + Math.max(0, r.parapetHeight);
    faces.push(...box(b.minX, b.minY, eaveZ, b.maxX, b.maxY, para, 'fascia', wallFill, 2));
    planes.push({ pts: [v(b.minX, b.minY, top), v(b.maxX, b.minY, top), v(b.maxX, b.maxY, top), v(b.minX, b.maxY, top)] });
    return { faces, ridgeZ: para, planes };
  }

  const W = x1 - x0;
  const D = y1 - y0;
  const alongX = W >= D;
  const span = alongX ? D : W;
  const rise = (span / 2) * tan;
  const rz = eaveZ + rise;
  const cy = (y0 + y1) / 2;
  const cxm = (x0 + x1) / 2;

  if (r.type === 'shed') {
    const hz = eaveZ + D * tan;
    plane([v(x0, y1, eaveZ), v(x1, y1, eaveZ), v(x1, y0, hz), v(x0, y0, hz)]);
    // Side infill above the wall plate.
    const sides = [b.minX, b.maxX];
    for (const x of sides) {
      const pts = [v(x, b.maxY, eaveZ), v(x, b.minY, eaveZ), v(x, b.minY, eaveZ + (b.maxY - b.minY + oh) * tan)];
      faces.push({ kind: 'wall', pts: x === b.minX ? pts : [...pts].reverse(), n: v(x === b.minX ? -1 : 1, 0, 0), fill: wallFill, order: 1 });
    }
    faces.push(...box(x0, y1 - 0.02, eaveZ - fasciaH, x1, y1, eaveZ, 'fascia', '#FFFFFF', 3));
    return { faces, ridgeZ: hz, planes };
  }

  if (alongX) {
    if (r.type === 'gable') {
      plane([v(x0, y0, eaveZ), v(x1, y0, eaveZ), v(x1, cy, rz), v(x0, cy, rz)]);
      plane([v(x1, y1, eaveZ), v(x0, y1, eaveZ), v(x0, cy, rz), v(x1, cy, rz)]);
      const gz = eaveZ + ((b.maxY - b.minY) / 2) * tan;
      faces.push({ kind: 'wall', fill: wallFill, order: 1, n: v(-1, 0, 0), pts: [v(b.minX, b.maxY, eaveZ), v(b.minX, b.minY, eaveZ), v(b.minX, cy, gz)] });
      faces.push({ kind: 'wall', fill: wallFill, order: 1, n: v(1, 0, 0), pts: [v(b.maxX, b.minY, eaveZ), v(b.maxX, b.maxY, eaveZ), v(b.maxX, cy, gz)] });
    } else {
      const h = D / 2;
      plane([v(x0, y0, eaveZ), v(x1, y0, eaveZ), v(x1 - h, cy, rz), v(x0 + h, cy, rz)]);
      plane([v(x1, y1, eaveZ), v(x0, y1, eaveZ), v(x0 + h, cy, rz), v(x1 - h, cy, rz)]);
      plane([v(x0, y1, eaveZ), v(x0, y0, eaveZ), v(x0 + h, cy, rz)]);
      plane([v(x1, y0, eaveZ), v(x1, y1, eaveZ), v(x1 - h, cy, rz)]);
    }
  } else {
    if (r.type === 'gable') {
      plane([v(x0, y1, eaveZ), v(x0, y0, eaveZ), v(cxm, y0, rz), v(cxm, y1, rz)]);
      plane([v(x1, y0, eaveZ), v(x1, y1, eaveZ), v(cxm, y1, rz), v(cxm, y0, rz)]);
      const gz = eaveZ + ((b.maxX - b.minX) / 2) * tan;
      faces.push({ kind: 'wall', fill: wallFill, order: 1, n: v(0, -1, 0), pts: [v(b.minX, b.minY, eaveZ), v(b.maxX, b.minY, eaveZ), v(cxm, b.minY, gz)] });
      faces.push({ kind: 'wall', fill: wallFill, order: 1, n: v(0, 1, 0), pts: [v(b.maxX, b.maxY, eaveZ), v(b.minX, b.maxY, eaveZ), v(cxm, b.maxY, gz)] });
    } else {
      const h = W / 2;
      plane([v(x0, y1, eaveZ), v(x0, y0, eaveZ), v(cxm, y0 + h, rz), v(cxm, y1 - h, rz)]);
      plane([v(x1, y0, eaveZ), v(x1, y1, eaveZ), v(cxm, y1 - h, rz), v(cxm, y0 + h, rz)]);
      plane([v(x0, y0, eaveZ), v(x1, y0, eaveZ), v(cxm, y0 + h, rz)]);
      plane([v(x1, y1, eaveZ), v(x0, y1, eaveZ), v(cxm, y1 - h, rz)]);
    }
  }
  // Fascia boards along the eaves only. A gable end has no eave: it gets sloping barge boards
  // under its verges instead (a level fascia there would run straight across the gable).
  const hip = r.type === 'hip';
  if (hip || alongX) {
    faces.push({ kind: 'fascia', fill: '#FFFFFF', order: 3, n: v(0, -1, 0), pts: [v(x0, y0, eaveZ - fasciaH), v(x1, y0, eaveZ - fasciaH), v(x1, y0, eaveZ), v(x0, y0, eaveZ)] });
    faces.push({ kind: 'fascia', fill: '#FFFFFF', order: 3, n: v(0, 1, 0), pts: [v(x1, y1, eaveZ - fasciaH), v(x0, y1, eaveZ - fasciaH), v(x0, y1, eaveZ), v(x1, y1, eaveZ)] });
  }
  if (hip || !alongX) {
    faces.push({ kind: 'fascia', fill: '#FFFFFF', order: 3, n: v(-1, 0, 0), pts: [v(x0, y1, eaveZ - fasciaH), v(x0, y0, eaveZ - fasciaH), v(x0, y0, eaveZ), v(x0, y1, eaveZ)] });
    faces.push({ kind: 'fascia', fill: '#FFFFFF', order: 3, n: v(1, 0, 0), pts: [v(x1, y0, eaveZ - fasciaH), v(x1, y1, eaveZ - fasciaH), v(x1, y1, eaveZ), v(x1, y0, eaveZ)] });
  }
  if (r.type === 'gable') {
    const barge = (a: V3, c: V3, n: V3) => faces.push({ kind: 'fascia', fill: '#FFFFFF', order: 3, n, pts: [v(a.x, a.y, a.z - fasciaH), v(c.x, c.y, c.z - fasciaH), c, a] });
    if (alongX) {
      // Gable ends at x0 and x1; verges run eave → ridge (y = cy) → eave.
      for (const [x, nx] of [[x0, -1], [x1, 1]] as [number, number][]) {
        barge(v(x, y0, eaveZ), v(x, cy, rz), v(nx, 0, 0));
        barge(v(x, cy, rz), v(x, y1, eaveZ), v(nx, 0, 0));
      }
    } else {
      for (const [y, ny] of [[y0, -1], [y1, 1]] as [number, number][]) {
        barge(v(x0, y, eaveZ), v(cxm, y, rz), v(0, ny, 0));
        barge(v(cxm, y, rz), v(x1, y, eaveZ), v(0, ny, 0));
      }
    }
  }
  return { faces, ridgeZ: rz, planes };
}

/**
 * Roof covering pattern for one plane. Sheets run straight down the slope and courses run
 * parallel to the eave, so every line is parallel to an edge of the plane and is clipped to
 * the plane's outline (never fanned to a point). pts[0]→pts[1] is always the eave.
 */
const PATTERN: Record<string, { along?: number; across?: number; rib?: [number, number] }> = {
  standing_seam: { along: 0.5, rib: [0.035, 0.035] },
  marine_metal: { along: 0.25, rib: [0.04, 0.018] },
  corrugated_metal: { along: 0.15, rib: [0.06, 0.012] },
  clay_tile: { across: 0.32, along: 0.28, rib: [0.06, 0.02] },
  natural_slate: { across: 0.24 },
  asphalt_shingle: { across: 0.2 },
  cedar_shake: { across: 0.22, rib: [0.03, 0.012] },
  thatch_palm: { along: 0.1, across: 0.45 },
  green_roof: {},
  concrete_slab: {},
};

function roofPattern(pts: V3[], n: V3, material: string): { lines: [V3, V3][]; ribs: { a: V3; b: V3; width: number; height: number }[] } {
  const spec = PATTERN[material] ?? { along: 0.5 };
  const p0 = pts[0];
  const ex = pts[1].x - p0.x;
  const ey = pts[1].y - p0.y;
  const el = Math.hypot(ex, ey) || 1;
  const u = v(ex / el, ey / el, 0); // along the eave
  // Up-slope direction in the plane: n × u, flipped to climb.
  let w = v(n.y * u.z - n.z * u.y, n.z * u.x - n.x * u.z, n.x * u.y - n.y * u.x);
  if (w.z < 0) w = v(-w.x, -w.y, -w.z);
  const wl = Math.hypot(w.x, w.y, w.z) || 1;
  w = v(w.x / wl, w.y / wl, w.z / wl);
  const loc = pts.map((p) => {
    const d = v(p.x - p0.x, p.y - p0.y, p.z - p0.z);
    return [d.x * u.x + d.y * u.y + d.z * u.z, d.x * w.x + d.y * w.y + d.z * w.z] as [number, number];
  });
  const at = (s: number, t: number) => v(p0.x + u.x * s + w.x * t, p0.y + u.y * s + w.y * t, p0.z + u.z * s + w.z * t);
  /** Range of the other coordinate where a constant-coordinate line crosses the (convex) plane. */
  const span = (axis: 0 | 1, c: number): [number, number] | null => {
    const hits: number[] = [];
    for (let i = 0; i < loc.length; i++) {
      const a = loc[i];
      const b = loc[(i + 1) % loc.length];
      if ((a[axis] - c) * (b[axis] - c) <= 0 && a[axis] !== b[axis]) {
        const t = (c - a[axis]) / (b[axis] - a[axis]);
        hits.push(a[1 - axis] + (b[1 - axis] - a[1 - axis]) * t);
      }
    }
    return hits.length >= 2 ? [Math.min(...hits), Math.max(...hits)] : null;
  };
  const sMin = Math.min(...loc.map((q) => q[0]));
  const sMax = Math.max(...loc.map((q) => q[0]));
  const tMax = Math.max(...loc.map((q) => q[1]));
  const lines: [V3, V3][] = [];
  const ribs: { a: V3; b: V3; width: number; height: number }[] = [];

  // Courses parallel to the eave (tiles, shingles, slate).
  if (spec.across) {
    for (let t = spec.across; t < tMax - 0.05; t += spec.across) {
      const r = span(1, t);
      if (!r) continue;
      lines.push([at(r[0], t), at(r[1], t)]);
      if (spec.rib && material !== 'clay_tile') ribs.push({ a: at(r[0], t), b: at(r[1], t), width: spec.rib[0], height: spec.rib[1] });
    }
  }
  // Sheets / tile columns straight down the slope.
  if (spec.along) {
    const start = Math.ceil(sMin / spec.along) * spec.along;
    for (let s = start; s <= sMax - 0.02; s += spec.along) {
      const r = span(0, s);
      if (!r || r[1] - r[0] < 0.05) continue;
      if (material !== 'clay_tile') lines.push([at(s, r[0]), at(s, r[1])]);
      if (spec.rib) ribs.push({ a: at(s, r[0]), b: at(s, r[1]), width: spec.rib[0], height: spec.rib[1] });
    }
  }
  return { lines, ribs };
}

/* ── Rainwater goods and solar ─────────────────────────────────────── */

const GUTTER_COLOR: Record<string, string> = { half_round_pvc: '#E9EBEE', k_style_alu: '#4A5361', box_concealed: '#5A6270', copper_half_round: '#B26A2E' };

function drainageFor(model: BuildingProject, top: FloorLevel, eaveZ: number): { faces: Face[]; drainage: Drainage | null } {
  const r = model.roof;
  const cfg = getRoofDrainageConfig(r);
  if (!cfg.gutterEnabled || r.type === 'flat') return { faces: [], drainage: null };
  const b = levelBounds(top);
  const oh = r.overhang;
  const x0 = b.minX - oh, x1 = b.maxX + oh, y0 = b.minY - oh, y1 = b.maxY + oh;
  const W = x1 - x0, D = y1 - y0;
  const alongX = W >= D;
  const color = GUTTER_COLOR[cfg.gutterProfile] ?? '#E9EBEE';
  const go = 0.09; // gutter centre, outward from the fascia
  type Edge = { a: V3; b: V3; out: { x: number; y: number } };
  const edges: Edge[] = [];
  const zg = eaveZ - 0.09;
  const N: Edge = { a: v(x0, y0 - go, zg), b: v(x1, y0 - go, zg), out: { x: 0, y: -1 } };
  const S: Edge = { a: v(x0, y1 + go, zg), b: v(x1, y1 + go, zg), out: { x: 0, y: 1 } };
  const Wd: Edge = { a: v(x0 - go, y0, zg), b: v(x0 - go, y1, zg), out: { x: -1, y: 0 } };
  const E: Edge = { a: v(x1 + go, y0, zg), b: v(x1 + go, y1, zg), out: { x: 1, y: 0 } };
  if (r.type === 'shed') edges.push(S);
  else if (r.type === 'gable') edges.push(...(alongX ? [N, S] : [Wd, E]));
  else edges.push(N, S, Wd, E);

  // Downpipes: corners first, then evenly along the longest gutter.
  const corners = [
    { gx: x0 + 0.2, gy: y1 + go, wx: b.minX + 0.12, wy: b.maxY + 0.06, out: { x: 0, y: 1 } },
    { gx: x1 - 0.2, gy: y1 + go, wx: b.maxX - 0.12, wy: b.maxY + 0.06, out: { x: 0, y: 1 } },
    { gx: x1 - 0.2, gy: y0 - go, wx: b.maxX - 0.12, wy: b.minY - 0.06, out: { x: 0, y: -1 } },
    { gx: x0 + 0.2, gy: y0 - go, wx: b.minX + 0.12, wy: b.minY - 0.06, out: { x: 0, y: -1 } },
  ].filter((c) => (r.type === 'shed' ? c.out.y > 0 : r.type === 'gable' && !alongX ? true : true));
  const count = Math.max(1, Math.min(8, cfg.downpipeCount));
  const pipes: Drainage['downpipes'] = corners.slice(0, Math.min(count, corners.length)).map((c) => ({ top: v(c.gx, c.gy, zg), wall: { x: c.wx, y: c.wy }, out: c.out }));
  for (let i = pipes.length; i < count; i++) {
    const t = (i - corners.length + 1) / (count - corners.length + 1);
    const x = x0 + W * t;
    pipes.push({ top: v(x, y1 + go, zg), wall: { x: Math.min(b.maxX, Math.max(b.minX, x)), y: b.maxY + 0.06 }, out: { x: 0, y: 1 } });
  }

  // Each pipe's top sits on a gutter that exists (gable roofs only have gutters on two sides).
  for (const pipe of pipes) {
    let best: { pt: V3; d: number } | null = null;
    for (const e of edges) {
      const dx = e.b.x - e.a.x;
      const dy = e.b.y - e.a.y;
      const L = Math.hypot(dx, dy) || 1;
      const t = Math.max(0.2, Math.min(L - 0.2, ((pipe.top.x - e.a.x) * dx + (pipe.top.y - e.a.y) * dy) / L));
      const pt = v(e.a.x + (dx * t) / L, e.a.y + (dy * t) / L, zg);
      const d = Math.hypot(pt.x - pipe.top.x, pt.y - pipe.top.y);
      if (!best || d < best.d) best = { pt, d };
    }
    if (best) pipe.top = best.pt;
  }

  // Every downpipe runs down a real outside wall. At an open corner (a verandah or patio under
  // the roof) there is no wall to fix it to: slide it along its gutter to the nearest wall face.
  const ext = top.walls.filter((w) => w.isExterior);
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  const wallFace = (p: { x: number; y: number }) => {
    let best: { q: { x: number; y: number }; d: number } | null = null;
    for (const w of ext) {
      const dx = w.end.x - w.start.x;
      const dy = w.end.y - w.start.y;
      const L2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((p.x - w.start.x) * dx + (p.y - w.start.y) * dy) / L2));
      const c = { x: w.start.x + dx * t, y: w.start.y + dy * t };
      // Out to the wall's outer face, away from the middle of the house.
      const L = Math.sqrt(L2);
      let n = { x: -dy / L, y: dx / L };
      if ((c.x - cx) * n.x + (c.y - cy) * n.y < 0) n = { x: -n.x, y: -n.y };
      const off = w.thickness / 2 + 0.06;
      const q = { x: c.x + n.x * off, y: c.y + n.y * off };
      const d = Math.hypot(p.x - q.x, p.y - q.y);
      if (!best || d < best.d) best = { q, d };
    }
    return best;
  };
  if (ext.length)
    for (const pipe of pipes) {
      const here = wallFace(pipe.wall);
      if (here && here.d < 0.2) continue;
      // Gutter points from this pipe outwards, nearest first; take the first above a wall face.
      const samples: { pt: V3; dist: number }[] = [];
      for (const e of edges) {
        const L = Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y);
        for (let t = 0.3; t <= L - 0.3; t += 0.25) {
          const pt = v(e.a.x + ((e.b.x - e.a.x) * t) / L, e.a.y + ((e.b.y - e.a.y) * t) / L, zg);
          samples.push({ pt, dist: Math.hypot(pt.x - pipe.top.x, pt.y - pipe.top.y) });
        }
      }
      samples.sort((p1, p2) => p1.dist - p2.dist);
      for (const smp of samples) {
        const f = wallFace(smp.pt);
        if (f && f.d <= oh + go + 0.35) {
          pipe.top = smp.pt;
          pipe.wall = f.q;
          const ox = f.q.x - smp.pt.x;
          const oy = f.q.y - smp.pt.y;
          pipe.out = Math.abs(ox) > Math.abs(oy) ? { x: ox > 0 ? -1 : 1, y: 0 } : { x: 0, y: oy > 0 ? -1 : 1 };
          break;
        }
      }
    }

  const faces: Face[] = [];
  for (const e of edges) {
    const minx = Math.min(e.a.x, e.b.x) - (e.out.x ? 0.075 : 0);
    const maxx = Math.max(e.a.x, e.b.x) + (e.out.x ? 0.075 : 0);
    const miny = Math.min(e.a.y, e.b.y) - (e.out.y ? 0.075 : 0);
    const maxy = Math.max(e.a.y, e.b.y) + (e.out.y ? 0.075 : 0);
    faces.push(...box(minx, miny, eaveZ - 0.16, maxx, maxy, eaveZ - 0.03, 'gutter', color, 4));
  }
  const pr = 0.045;
  for (const p of pipes) {
    // Vertical run down the wall to a shoe just above ground.
    faces.push(...box(p.wall.x - pr, p.wall.y - pr, 0.12, p.wall.x + pr, p.wall.y + pr, eaveZ - 0.3, 'downpipe', color, 4));
    // Gooseneck under the soffit back to the gutter.
    faces.push(...box(Math.min(p.wall.x, p.top.x) - pr, Math.min(p.wall.y, p.top.y) - pr, eaveZ - 0.34, Math.max(p.wall.x, p.top.x) + pr, Math.max(p.wall.y, p.top.y) + pr, eaveZ - 0.24, 'downpipe', color, 4));
  }

  let collection: Drainage['collection'] = null;
  const lead = pipes[0];
  if (lead) {
    const cx = lead.wall.x + lead.out.x * 0.9;
    const cy = lead.wall.y + lead.out.y * 0.9 + 0.0;
    if (cfg.waterCollectionMode === 'harvesting_tank') {
      const h = 1.8;
      const radius = Math.min(1.2, Math.max(0.45, Math.sqrt(cfg.harvestingTankLiters / 1000 / (Math.PI * h))));
      const ty = lead.wall.y + lead.out.y * (radius + 0.25);
      collection = { mode: cfg.waterCollectionMode, x: lead.wall.x + 0.2, y: ty, radius, height: h };
      faces.push(...box(lead.wall.x + 0.2 - radius, ty - radius, 0, lead.wall.x + 0.2 + radius, ty + radius, h, 'tank', '#5F7A6A', 4));
    } else {
      collection = { mode: cfg.waterCollectionMode, x: cx, y: cy, radius: 0.45, height: 0.06 };
      faces.push(...box(cx - 0.45, cy - 0.45, 0, cx + 0.45, cy + 0.45, 0.06, 'tank', '#9A968C', 4));
    }
  }
  return { faces, drainage: { color, halfRound: cfg.gutterProfile.includes('half_round'), gutters: edges, downpipes: pipes, collection } };
}

/** Solar panels sitting on the roof planes, using the engine's array layout. */
function solarFaces(model: BuildingProject, planes: { pts: V3[] }[]): Face[] {
  const cfg = getSolarConfig(model);
  if (!cfg.enabled || !planes.length) return [];
  const layout = computeSolarArrayLayout(model);
  const faces: Face[] = [];
  const inPlan = (pts: V3[], x: number, y: number) => {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++)
      if (pts[i].y > y !== pts[j].y > y && x < ((pts[j].x - pts[i].x) * (y - pts[i].y)) / (pts[j].y - pts[i].y) + pts[i].x) inside = !inside;
    return inside;
  };
  for (const p of layout.panels) {
    const plane = planes.find((pl) => inPlan(pl.pts, p.x, p.y)) ?? planes[0];
    const [a, b, c] = plane.pts;
    let n = v((b.y - a.y) * (c.z - a.z) - (b.z - a.z) * (c.y - a.y), (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z), (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
    if (n.z < 0) n = v(-n.x, -n.y, -n.z);
    const nl = Math.hypot(n.x, n.y, n.z) || 1;
    n = v(n.x / nl, n.y / nl, n.z / nl);
    const zAt = (x: number, y: number) => a.z - (n.x * (x - a.x) + n.y * (y - a.y)) / (n.z || 1) + 0.1;
    const rot = (p.rotationDeg * Math.PI) / 180;
    const hw = p.width / 2;
    const hd = p.depth / 2;
    const corner = (sx: number, sy: number) => {
      const x = p.x + sx * Math.cos(rot) - sy * Math.sin(rot);
      const y = p.y + sx * Math.sin(rot) + sy * Math.cos(rot);
      return v(x, y, zAt(x, y));
    };
    const pts = [corner(-hw, hd), corner(hw, hd), corner(hw, -hd), corner(-hw, -hd)];
    const lines: [V3, V3][] = [];
    const lerp = (q: V3, r: V3, t: number) => v(q.x + (r.x - q.x) * t, q.y + (r.y - q.y) * t, q.z + (r.z - q.z) * t);
    for (let i = 1; i < 3; i++) lines.push([lerp(pts[0], pts[1], i / 3), lerp(pts[3], pts[2], i / 3)]);
    for (let i = 1; i < 6; i++) lines.push([lerp(pts[0], pts[3], i / 6), lerp(pts[1], pts[2], i / 6)]);
    faces.push({ kind: 'solar', pts, n, fill: '#23324A', order: 5, lines });
  }
  return faces;
}

export function buildFrame(model: BuildingProject): BuildingFrame {
  const facade = FACADE_MATERIAL_OPTIONS.find((o) => o.id === getDesignConfig(model).exteriorFacade)?.base ?? '#eef2f6';
  const wallFill = tint(facade, 0.35);
  const design = getDesignConfig(model);
  const pal: Palette = { wall: wallFill, frame: FRAME_COLOR[design.windowFrame] ?? '#3A3F44', door: tint(DOOR_COLOR[design.doorMaterial] ?? '#B8925E', 0.12) };
  const faces: Face[] = [];
  const first = model.levels[0];
  const b0 = levelBounds(first);

  // Plinth from ground up to the ground-floor level.
  if (first && first.elevation > 0.02) faces.push(...box(b0.minX - 0.05, b0.minY - 0.05, 0, b0.maxX + 0.05, b0.maxY + 0.05, first.elevation, 'plinth', PLINTH));

  let eaveZ = 3;
  model.levels.forEach((lvl, i) => {
    faces.push(...wallFaces(lvl, pal));
    const top = lvl.elevation + Math.max(...lvl.walls.map((w) => w.height), 2.8);
    eaveZ = Math.max(eaveZ, top);
    if (i > 0) {
      const lb = levelBounds(lvl);
      // Slab edge is finished like the wall, so it merges into one facade with a single floor line.
      faces.push(...box(lb.minX, lb.minY, lvl.elevation - lvl.slabThickness, lb.maxX, lb.maxY, lvl.elevation, 'wall', wallFill));
    }
  });

  const top = model.levels[model.levels.length - 1];
  const roof = roofFaces(model, top, eaveZ);
  faces.push(...roof.faces);
  const rain = drainageFor(model, top, eaveZ);
  faces.push(...rain.faces);
  if (model.roof.type !== 'flat') faces.push(...solarFaces(model, roof.planes));

  // Ridge and hip lines: every roof-plane edge except its eave, de-duplicated.
  const seen = new Set<string>();
  const ridgeEdges: [V3, V3][] = [];
  if (model.roof.type !== 'flat')
    for (const pl of roof.planes)
      for (let i = 1; i < pl.pts.length; i++) {
        const a = pl.pts[i];
        const b2 = pl.pts[(i + 1) % pl.pts.length];
        if (Math.abs(a.z - b2.z) < 1e-3 && Math.abs(a.z - eaveZ) < 1e-3) continue; // eave
        const k = [a, b2].map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)}`).sort().join('|');
        if (seen.has(k)) continue;
        seen.add(k);
        // Gable verges (edge from eave straight up to the ridge end) are not capped.
        ridgeEdges.push([a, b2]);
      }

  const all = model.levels.map(levelBounds);
  return {
    faces,
    bounds: {
      minX: Math.min(...all.map((b) => b.minX)) - model.roof.overhang,
      minY: Math.min(...all.map((b) => b.minY)) - model.roof.overhang,
      maxX: Math.max(...all.map((b) => b.maxX)) + model.roof.overhang,
      maxY: Math.max(...all.map((b) => b.maxY)) + model.roof.overhang,
    },
    eaveZ,
    ridgeZ: roof.ridgeZ,
    groundFloorZ: first?.elevation ?? 0,
    roofPlanes: roof.planes,
    ridgeEdges,
    drainage: rain.drainage,
    notes: {
      roof: model.roof.type === 'flat' ? `${label(ROOF_MATERIAL_OPTIONS, model.roof.material)}, ${model.roof.parapetHeight > 0 ? 'parapet' : 'flat roof'}` : `${label(ROOF_MATERIAL_OPTIONS, model.roof.material)} roofing, ${model.roof.pitchDeg}° pitch`,
      wall: `${label(FACADE_MATERIAL_OPTIONS, design.exteriorFacade)} on ${model.levels[0]?.walls.find((w) => w.isExterior)?.material.replace(/_/g, ' ') ?? 'masonry'} walls`,
      frame: `${titleCase(design.windowFrame)} aluminium frames, clear glazing`,
      door: `${titleCase(design.doorMaterial)} door`,
      fascia: model.roof.type === 'flat' ? 'Parapet, finished to match walls' : 'Fascia board, painted white',
      plinth: 'Plinth, cement render',
      gutter: rain.drainage ? `${GUTTER_PROFILE_META[getRoofDrainageConfig(model.roof).gutterProfile]?.shortLabel ?? 'Gutter'} gutter & downpipes` : undefined,
      solar: getSolarConfig(model).enabled ? `${getSolarConfig(model).panelCount} × ${getSolarConfig(model).panelWattage} Wp solar PV panels` : undefined,
      tank: rain.drainage?.collection ? WATER_COLLECTION_META[getRoofDrainageConfig(model.roof).waterCollectionMode]?.shortLabel : undefined,
    },
  };
}

const label = (opts: { id: string; label: string }[], id: string) => opts.find((o) => o.id === id)?.label ?? titleCase(id);
const titleCase = (s: string) => s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
