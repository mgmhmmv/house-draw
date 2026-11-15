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
  type BuildingProject,
  type FloorLevel,
  type Opening,
} from '../../../model/types';
import { FACADE_MATERIAL_OPTIONS, ROOF_MATERIAL_OPTIONS } from '../../../components/Viewport3D';
import { wallFrame } from '../plan/kernel';

export interface V3 {
  x: number;
  y: number;
  z: number;
}

export type FaceKind = 'wall' | 'glass' | 'door' | 'frame' | 'sill' | 'roof' | 'fascia' | 'slab' | 'plinth' | 'reveal';

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

function openingFaces(level: FloorLevel, o: Opening, pal: Palette): Face[] {
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
      faces.push({ kind: 'frame', pts: R(s0, s1, z0, z1, front), holes, n, fill: pal.frame, order: 2, sash });
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
      faces.push({ kind: 'door', pts: R(s0 + fw, s1 - fw, z0, lz1, back), n, fill: pal.door, order: 1, lines });
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
    const fill = w.isExterior ? pal.wall : '#F2F0EB';
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
    for (const o of openings) faces.push(...openingFaces(level, o, pal));
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
    faces.push({ kind: 'roof', pts, n: v(n.x / l, n.y / l, n.z / l), fill, order: 2, lines: seamLines(pts, r.material) });
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
  // Fascia boards along the eaves.
  faces.push({ kind: 'fascia', fill: '#FFFFFF', order: 3, n: v(0, -1, 0), pts: [v(x0, y0, eaveZ - fasciaH), v(x1, y0, eaveZ - fasciaH), v(x1, y0, eaveZ), v(x0, y0, eaveZ)] });
  faces.push({ kind: 'fascia', fill: '#FFFFFF', order: 3, n: v(0, 1, 0), pts: [v(x1, y1, eaveZ - fasciaH), v(x0, y1, eaveZ - fasciaH), v(x0, y1, eaveZ), v(x1, y1, eaveZ)] });
  if (r.type === 'hip' || !alongX) {
    faces.push({ kind: 'fascia', fill: '#FFFFFF', order: 3, n: v(-1, 0, 0), pts: [v(x0, y1, eaveZ - fasciaH), v(x0, y0, eaveZ - fasciaH), v(x0, y0, eaveZ), v(x0, y1, eaveZ)] });
    faces.push({ kind: 'fascia', fill: '#FFFFFF', order: 3, n: v(1, 0, 0), pts: [v(x1, y0, eaveZ - fasciaH), v(x1, y1, eaveZ - fasciaH), v(x1, y1, eaveZ), v(x1, y0, eaveZ)] });
  }
  return { faces, ridgeZ: rz, planes };
}

/** Light seam or course lines across a roof plane, so material reads at a glance. */
function seamLines(pts: V3[], material: string): [V3, V3][] {
  if (pts.length < 3) return [];
  const metal = ['standing_seam', 'corrugated_metal', 'marine_metal'].includes(material);
  const lines: [V3, V3][] = [];
  // Eave edge is pts[0]→pts[1]; run lines from the eave toward the far edge.
  const a = pts[0];
  const b = pts[1];
  const far = pts.length === 4 ? [pts[3], pts[2]] : [pts[2], pts[2]];
  const n = metal ? Math.max(2, Math.round(Math.hypot(b.x - a.x, b.y - a.y) / 0.6)) : 0;
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z };
    const q = { x: far[0].x + (far[1].x - far[0].x) * t, y: far[0].y + (far[1].y - far[0].y) * t, z: far[0].z };
    lines.push([p, q]);
  }
  if (!metal) {
    // Tile / shingle courses parallel to the eave.
    for (let t = 0.12; t < 0.98; t += 0.12) {
      const p = { x: a.x + (far[0].x - a.x) * t, y: a.y + (far[0].y - a.y) * t, z: a.z + (far[0].z - a.z) * t };
      const q = { x: b.x + (far[1].x - b.x) * t, y: b.y + (far[1].y - b.y) * t, z: b.z + (far[1].z - b.z) * t };
      lines.push([p, q]);
    }
  }
  return lines;
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
  };
}
