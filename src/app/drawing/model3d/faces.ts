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

export type FaceKind = 'wall' | 'glass' | 'door' | 'roof' | 'fascia' | 'slab' | 'plinth' | 'reveal';

export interface Face {
  kind: FaceKind;
  pts: V3[];
  holes?: V3[][];
  /** Outward normal. */
  n: V3;
  /** Extra linework that belongs to the face (window mullions, panel lines). */
  lines?: [V3, V3][];
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
const DOOR = '#C9B49A';
const PLINTH = '#D9D5CC';
const SLAB = '#E6E3DC';

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

function openingFaces(level: FloorLevel, o: Opening, wallFill: string): Face[] {
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
  // Glass or door leaf sits in the middle of the wall, so the reveal reads as depth.
  for (const side of [1, -1]) {
    const off = side * 0.02;
    const n = v(f.n.x * side, f.n.y * side, 0);
    const pts = side > 0 ? [P(s0, off, z0), P(s1, off, z0), P(s1, off, z1), P(s0, off, z1)] : [P(s1, off, z0), P(s0, off, z0), P(s0, off, z1), P(s1, off, z1)];
    const lines: [V3, V3][] = [];
    const fw = 0.05; // frame width
    // Frame inset outline
    lines.push([P(s0 + fw, off, z0 + fw), P(s1 - fw, off, z0 + fw)], [P(s1 - fw, off, z0 + fw), P(s1 - fw, off, z1 - fw)]);
    lines.push([P(s1 - fw, off, z1 - fw), P(s0 + fw, off, z1 - fw)], [P(s0 + fw, off, z1 - fw), P(s0 + fw, off, z0 + fw)]);
    if (o.kind === 'window') {
      if (o.style === 'casement' || o.style === 'sliding') lines.push([P(c, off, z0 + fw), P(c, off, z1 - fw)]);
      if (o.style === 'casement' && o.height > 1.2) lines.push([P(s0 + fw, off, z1 - 0.45), P(s1 - fw, off, z1 - 0.45)]);
      // A single reflection stroke keeps glass from reading as a flat panel.
      lines.push([P(s0 + o.width * 0.18, off, z0 + o.height * 0.3), P(s0 + o.width * 0.32, off, z0 + o.height * 0.62)]);
    } else {
      if (o.style === 'double' || o.style === 'sliding') lines.push([P(c, off, z0), P(c, off, z1 - fw)]);
      if (o.style === 'garage') for (let z = z0 + 0.3; z < z1 - 0.1; z += 0.3) lines.push([P(s0 + fw, off, z), P(s1 - fw, off, z)]);
      const hx = o.style === 'double' ? c - 0.08 : s1 - 0.12;
      lines.push([P(hx, off, z0 + 1.0), P(hx, off, z0 + 1.12)]);
    }
    faces.push({ kind: o.kind === 'window' ? 'glass' : 'door', pts, n, lines, fill: o.kind === 'window' ? GLASS : DOOR, order: 1 });
  }
  // Reveals (jambs, head, sill) from wall face to glass.
  for (const side of [1, -1]) {
    const a = side * t;
    const b = side * 0.02;
    faces.push({ kind: 'reveal', fill: tint(wallFill, 0.1), order: 0, n: v(f.dir.x, f.dir.y, 0), pts: [P(s0, a, z0), P(s0, b, z0), P(s0, b, z1), P(s0, a, z1)] });
    faces.push({ kind: 'reveal', fill: tint(wallFill, 0.1), order: 0, n: v(-f.dir.x, -f.dir.y, 0), pts: [P(s1, b, z0), P(s1, a, z0), P(s1, a, z1), P(s1, b, z1)] });
    faces.push({ kind: 'reveal', fill: wallFill, order: 0, n: v(0, 0, -1), pts: [P(s0, a, z1), P(s1, a, z1), P(s1, b, z1), P(s0, b, z1)] });
  }
  return faces;
}

function wallFaces(level: FloorLevel, wallFill: string): Face[] {
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
    for (const side of [1, -1]) {
      const off = side * t;
      const n = v(f.n.x * side, f.n.y * side, 0);
      const outer = side > 0 ? [P(sA, off, z0), P(sB, off, z0), P(sB, off, z1), P(sA, off, z1)] : [P(sB, off, z0), P(sA, off, z0), P(sA, off, z1), P(sB, off, z1)];
      const holes = openings.map((o) => {
        const c = o.offset * f.length;
        const oz0 = z0 + (o.kind === 'door' ? 0 : o.sillHeight);
        const oz1 = oz0 + o.height;
        return [P(c - o.width / 2, off, oz0), P(c + o.width / 2, off, oz0), P(c + o.width / 2, off, oz1), P(c - o.width / 2, off, oz1)];
      });
      faces.push({ kind: 'wall', pts: outer, holes, n, fill: w.isExterior ? wallFill : '#F2F0EB', order: 0 });
    }
    // Wall top
    faces.push({ kind: 'wall', fill: wallFill, order: 0, n: v(0, 0, 1), pts: [P(sA, -t, z1), P(sB, -t, z1), P(sB, t, z1), P(sA, t, z1)] });
    // End caps
    faces.push({ kind: 'wall', fill: wallFill, order: 0, n: v(-f.dir.x, -f.dir.y, 0), pts: [P(sA, t, z0), P(sA, -t, z0), P(sA, -t, z1), P(sA, t, z1)] });
    faces.push({ kind: 'wall', fill: wallFill, order: 0, n: v(f.dir.x, f.dir.y, 0), pts: [P(sB, -t, z0), P(sB, t, z0), P(sB, t, z1), P(sB, -t, z1)] });
    for (const o of openings) faces.push(...openingFaces(level, o, wallFill));
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
  const faces: Face[] = [];
  const first = model.levels[0];
  const b0 = levelBounds(first);

  // Plinth from ground up to the ground-floor level.
  if (first && first.elevation > 0.02) faces.push(...box(b0.minX - 0.05, b0.minY - 0.05, 0, b0.maxX + 0.05, b0.maxY + 0.05, first.elevation, 'plinth', PLINTH));

  let eaveZ = 3;
  model.levels.forEach((lvl, i) => {
    faces.push(...wallFaces(lvl, wallFill));
    const top = lvl.elevation + Math.max(...lvl.walls.map((w) => w.height), 2.8);
    eaveZ = Math.max(eaveZ, top);
    if (i > 0) {
      const lb = levelBounds(lvl);
      faces.push(...box(lb.minX, lb.minY, lvl.elevation - lvl.slabThickness, lb.maxX, lb.maxY, lvl.elevation, 'slab', SLAB));
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
