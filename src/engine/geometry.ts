import {
  BuildingProject,
  FloorLevel,
  getSolarConfig,
  Opening,
  Point2D,
  Room,
  StructuralColumn,
  StructuralGrid,
  Wall,
} from '../model/types';

export function uid(prefix = 'id'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

export function dist(a: Point2D, b: Point2D): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function midpoint(a: Point2D, b: Point2D): Point2D {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function roundTo(val: number, step = 0.05): number {
  return Math.round(val / step) * step;
}

export function snapPoint(pt: Point2D, gridSize = 0.25): Point2D {
  return {
    x: Number(roundTo(pt.x, gridSize).toFixed(3)),
    y: Number(roundTo(pt.y, gridSize).toFixed(3)),
  };
}

export function projectPointOnSegment(
  p: Point2D,
  a: Point2D,
  b: Point2D
): { t: number; point: Point2D; distance: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-8) {
    return { t: 0, point: { ...a }, distance: dist(p, a) };
  }
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  const proj = { x: a.x + t * dx, y: a.y + t * dy };
  return { t, point: proj, distance: dist(p, proj) };
}

export function wallAngleRad(w: Wall): number {
  return Math.atan2(w.end.y - w.start.y, w.end.x - w.start.x);
}

export function wallLength(w: Wall): number {
  return dist(w.start, w.end);
}

export function wallNormal(w: Wall): Point2D {
  const len = wallLength(w) || 1;
  return {
    x: -(w.end.y - w.start.y) / len,
    y: (w.end.x - w.start.x) / len,
  };
}

export function openingWorldCenter(wall: Wall, opening: Opening): Point2D {
  return {
    x: wall.start.x + (wall.end.x - wall.start.x) * opening.offset,
    y: wall.start.y + (wall.end.y - wall.start.y) * opening.offset,
  };
}

export function polygonArea(poly: Point2D[]): number {
  if (poly.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

export function polygonPerimeter(poly: Point2D[]): number {
  if (poly.length < 2) return 0;
  let total = 0;
  for (let i = 0; i < poly.length; i++) {
    total += dist(poly[i], poly[(i + 1) % poly.length]);
  }
  return total;
}

export function polygonCentroid(poly: Point2D[]): Point2D {
  if (poly.length === 0) return { x: 0, y: 0 };
  let x = 0;
  let y = 0;
  for (const p of poly) {
    x += p.x;
    y += p.y;
  }
  return { x: x / poly.length, y: y / poly.length };
}

export function boundingBox(points: Point2D[]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  depth: number;
} {
  if (points.length === 0) {
    return { minX: 0, minY: 0, maxX: 12, maxY: 10, width: 12, depth: 10 };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, depth: maxY - minY };
}

export function levelBoundingBox(level: FloorLevel) {
  const pts: Point2D[] = [];
  for (const w of level.walls) {
    pts.push(w.start, w.end);
  }
  for (const r of level.rooms) {
    pts.push(...r.polygon);
  }
  return boundingBox(pts);
}

export function segmentIntersection(
  a1: Point2D,
  a2: Point2D,
  b1: Point2D,
  b2: Point2D
): { point: Point2D; t: number; u: number } | null {
  const d1x = a2.x - a1.x;
  const d1y = a2.y - a1.y;
  const d2x = b2.x - b1.x;
  const d2y = b2.y - b1.y;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-8) return null;
  const dx = b1.x - a1.x;
  const dy = b1.y - a1.y;
  const t = (dx * d2y - dy * d2x) / denom;
  const u = (dx * d1y - dy * d1x) / denom;
  if (t >= -1e-4 && t <= 1 + 1e-4 && u >= -1e-4 && u <= 1 + 1e-4) {
    return {
      point: { x: a1.x + t * d1x, y: a1.y + t * d1y },
      t: Math.max(0, Math.min(1, t)),
      u: Math.max(0, Math.min(1, u)),
    };
  }
  return null;
}

export function autoGenerateStructuralGrid(level: FloorLevel): StructuralGrid {
  const xCoords = new Set<number>();
  const yCoords = new Set<number>();
  for (const w of level.walls) {
    if (!w.isExterior && !(w.isLoadBearing && wallLength(w) >= 2.5)) continue;
    if (Math.abs(w.start.x - w.end.x) < 0.08) {
      xCoords.add(Number(roundTo(w.start.x, 0.1).toFixed(2)));
    }
    if (Math.abs(w.start.y - w.end.y) < 0.08) {
      yCoords.add(Number(roundTo(w.start.y, 0.1).toFixed(2)));
    }
  }
  for (const c of level.columns) {
    xCoords.add(Number(roundTo(c.position.x, 0.1).toFixed(2)));
    yCoords.add(Number(roundTo(c.position.y, 0.1).toFixed(2)));
  }

  const filterClose = (vals: number[], minGap = 1.35): number[] => {
    const sorted = [...vals].sort((a, b) => a - b);
    const out: number[] = [];
    for (const v of sorted) {
      if (out.length === 0 || v - out[out.length - 1] >= minGap) {
        out.push(v);
      }
    }
    return out;
  };

  const xs = filterClose(Array.from(xCoords));
  const ys = filterClose(Array.from(yCoords));
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  return {
    xAxes: xs.map((coord, i) => ({
      label: letters[i % letters.length] + (i >= 26 ? String(Math.floor(i / 26)) : ''),
      coord,
    })),
    yAxes: ys.map((coord, i) => ({
      label: String(i + 1),
      coord,
    })),
  };
}

export function autoPlaceStructuralColumns(level: FloorLevel): StructuralColumn[] {
  const intersections: Point2D[] = [];
  const addUnique = (pt: Point2D) => {
    if (!intersections.some((p) => dist(p, pt) < 1.55)) {
      intersections.push(snapPoint(pt, 0.05));
    }
  };

  // Pass 1: Exterior perimeter corners first so primary building extents always receive corner columns
  for (const wi of level.walls) {
    if (!wi.isExterior) continue;
    addUnique(wi.start);
    addUnique(wi.end);
  }
  // Pass 2: Structural/exterior wall intersections and load-bearing wall endpoints
  for (let i = 0; i < level.walls.length; i++) {
    const wi = level.walls[i];
    if (!wi.isLoadBearing && !wi.isExterior) continue;
    addUnique(wi.start);
    addUnique(wi.end);
    for (let j = i + 1; j < level.walls.length; j++) {
      const wj = level.walls[j];
      const hit = segmentIntersection(wi.start, wi.end, wj.start, wj.end);
      if (hit) addUnique(hit.point);
    }
  }

  return intersections.map((pos, idx) => ({
    id: uid('col'),
    position: pos,
    width: 0.3,
    depth: 0.3,
    label: `C${idx + 1}`,
    footingSize: 1.2,
    rebarSpec: '4Ø16 + Ø8@150',
  }));
}

export function getRoomFloorColor(room: Room, isLight = true): string {
  if (room.color) return room.color;
  if (isLight) {
    switch (room.finish) {
      case 'herringbone_oak':
        return '#f5e1c0';
      case 'hardwood':
        return '#f7ead5';
      case 'carrara_marble':
        return '#f8fafc';
      case 'terrazzo':
        return '#eef2f6';
      case 'concrete':
        return '#e4e4e7';
      case 'carpet':
        return '#ede9fe';
      case 'ceramic_antiskid':
        return '#cffafe';
      default:
        break;
    }
    switch (room.category) {
      case 'living':
        return '#f1f5f9';
      case 'kitchen':
        return '#e0f2fe';
      case 'dining':
        return '#f1f5f9';
      case 'bedroom':
        return '#fef3c7';
      case 'bathroom':
        return '#cffafe';
      case 'garage':
        return '#e4e4e7';
      case 'office':
        return '#ede9fe';
      case 'porch':
      case 'balcony':
        return '#dcfce7';
      default:
        return '#f1f5f9';
    }
  }
  switch (room.finish) {
    case 'herringbone_oak':
      return '#3b2616';
    case 'carrara_marble':
      return '#26303d';
    case 'terrazzo':
      return '#282c34';
    default:
      break;
  }
  switch (room.category) {
    case 'living':
      return '#1e293b';
    case 'kitchen':
      return '#172554';
    case 'dining':
      return '#1e293b';
    case 'bedroom':
      return '#1f2937';
    case 'bathroom':
      return '#0f3a47';
    case 'garage':
      return '#27272a';
    case 'office':
      return '#1e1b4b';
    case 'porch':
    case 'balcony':
      return '#14261c';
    default:
      return '#1e293b';
  }
}

export function computeTotalFloorArea(project: BuildingProject): number {
  let total = 0;
  for (const lvl of project.levels) {
    for (const r of lvl.rooms) {
      total += polygonArea(r.polygon);
    }
    if (lvl.rooms.length === 0 && lvl.walls.length >= 3) {
      const bb = levelBoundingBox(lvl);
      total += bb.width * bb.depth;
    }
  }
  return total;
}

export interface ComputedSolarPanel {
  index: number;
  x: number; // world X center (meters)
  y: number; // world Y/Z center in plan (meters)
  z3d: number; // 3D elevation Y above ground datum (meters)
  width: number; // panel width in X (meters)
  depth: number; // panel depth in Z/Y (meters)
  rotX: number; // 3D pitch rotation (rad)
  rotY: number; // 3D yaw rotation (rad)
  rotZ: number; // 3D roll rotation (rad)
  rotationDeg: number; // 2D plan rotation (deg)
}

export interface ComputedSolarLayout {
  anchorX: number;
  anchorY: number;
  bounds: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    width: number;
    depth: number;
    centerX: number;
    centerY: number;
  };
  cols: number;
  rows: number;
  panels: ComputedSolarPanel[];
}

export function computeRoofSurfaceAt(
  project: BuildingProject,
  worldX: number,
  worldY: number
): { y3d: number; rotX: number; rotY: number; rotZ: number } {
  const lastLevel = project.levels[project.levels.length - 1];
  const rBB = lastLevel ? levelBoundingBox(lastLevel) : { minX: 0, maxX: 12, minY: 0, maxY: 10, width: 12, depth: 10 };
  const eaveY = lastLevel ? lastLevel.elevation + lastLevel.floorToFloorHeight : 3.5;
  const ov = project.roof.overhang;
  const w = rBB.width + ov * 2;
  const d = rBB.depth + ov * 2;
  const cx = (rBB.minX + rBB.maxX) / 2;
  const cz = (rBB.minY + rBB.maxY) / 2;
  const hw = Math.max(0.5, w / 2);
  const hd = Math.max(0.5, d / 2);
  const pitchRad = (project.roof.pitchDeg * Math.PI) / 180;
  const rise = Math.max(0.4, (Math.min(w, d) / 2) * Math.tan(pitchRad));
  const ridgeHalf = project.roof.type === 'hip' ? Math.max(0.2, hw - hd * 0.85) : hw;

  if (project.roof.type === 'flat') {
    return { y3d: eaveY + 0.38, rotX: 0.22, rotY: 0, rotZ: 0 };
  }

  if (project.roof.type === 'shed') {
    const slopeAngle = Math.atan2(rise, Math.max(0.4, d));
    const tNorm = Math.max(0.04, Math.min(0.96, 0.5 + (worldY - cz) / Math.max(0.4, d)));
    return {
      y3d: eaveY + rise * tNorm + 0.16,
      rotX: -slopeAngle,
      rotY: 0,
      rotZ: 0,
    };
  }

  const dx = worldX - cx;
  const dz = worldY - cz;
  const tNS = Math.min(1.02, Math.abs(dz) / hd);
  const tEW =
    project.roof.type === 'hip'
      ? Math.min(1.02, Math.max(0, (Math.abs(dx) - ridgeHalf) / Math.max(0.2, hw - ridgeHalf)))
      : 0;
  const tDrop = Math.min(0.98, Math.max(tNS, tEW));
  const y3d = eaveY + rise * (1 - tDrop) + 0.14;

  if (project.roof.type === 'hip' && tEW > tNS) {
    const hipPitch = Math.atan2(rise, Math.max(0.25, hw - ridgeHalf));
    return {
      y3d,
      rotX: 0,
      rotY: 0,
      rotZ: dx >= 0 ? -hipPitch : hipPitch,
    };
  }

  const slopePitch = Math.atan2(rise, hd);
  return {
    y3d,
    rotX: dz >= 0 ? slopePitch : -slopePitch,
    rotY: 0,
    rotZ: 0,
  };
}

export function computeSolarArrayLayout(project: BuildingProject): ComputedSolarLayout {
  const solar = getSolarConfig(project);
  const lastLevel = project.levels[project.levels.length - 1];
  const rBB = lastLevel ? levelBoundingBox(lastLevel) : { minX: 0, maxX: 12, minY: 0, maxY: 10, width: 12, depth: 10 };
  const ov = project.roof.overhang;
  const w = rBB.width + ov * 2;
  const d = rBB.depth + ov * 2;
  const cx = (rBB.minX + rBB.maxX) / 2;
  const cz = (rBB.minY + rBB.maxY) / 2;
  const hw = Math.max(0.5, w / 2);
  const hd = Math.max(0.5, d / 2);
  const ridgeHalf = project.roof.type === 'hip' ? Math.max(0.2, hw - hd * 0.85) : hw;

  const face = solar.roofFace ?? 'south';
  let baseAnchorX = cx;
  let baseAnchorY = cz + hd * 0.56;
  if (project.roof.type === 'flat' || face === 'flat_center') {
    baseAnchorX = cx;
    baseAnchorY = cz;
  } else if (face === 'north') {
    baseAnchorX = cx;
    baseAnchorY = cz - hd * 0.56;
  } else if (face === 'east') {
    baseAnchorX = cx + ridgeHalf + (hw - ridgeHalf) * 0.45;
    baseAnchorY = cz;
  } else if (face === 'west') {
    baseAnchorX = cx - ridgeHalf - (hw - ridgeHalf) * 0.45;
    baseAnchorY = cz;
  }

  const anchorX = baseAnchorX + (solar.offsetX ?? 0);
  const anchorY = baseAnchorY + (solar.offsetY ?? 0);
  const rotDeg = (((solar.rotationDeg ?? 0) % 360) + 360) % 360;
  const isSideways = rotDeg === 90 || rotDeg === 270;

  const baseW = 1.0;
  const baseD = 1.55;
  const modW = isSideways ? baseD : baseW;
  const modD = isSideways ? baseW : baseD;
  const gap = 0.08;

  // With strings set, one string per row (strings × panels per string).
  const stringed = (solar.strings ?? 0) > 0 && (solar.panelsPerString ?? 0) > 0;
  const count = stringed ? solar.strings! * solar.panelsPerString! : Math.max(1, solar.panelCount || 1);
  let cols = stringed ? solar.panelsPerString! : solar.columns && solar.columns > 0 ? Math.min(count, solar.columns) : 0;
  if (!cols) {
    if (face === 'east' || face === 'west') {
      cols = Math.min(3, Math.max(2, Math.floor(count / 3) || 2));
    } else if (project.roof.type === 'hip') {
      const slopeWidthAtAnchor = Math.max(3.6, (ridgeHalf + 0.36 * (hw - ridgeHalf)) * 2);
      const maxFitCols = Math.max(3, Math.min(8, Math.floor((slopeWidthAtAnchor - 0.3) / (modW + gap))));
      cols = Math.min(maxFitCols, Math.max(3, Math.ceil(count / 2)));
    } else {
      cols = Math.min(8, Math.max(3, Math.ceil(count / 2)));
    }
  }
  const rows = Math.max(1, Math.ceil(count / cols));

  const rad = (rotDeg * Math.PI) / 180;
  const cosR = Math.cos(rad);
  const sinR = Math.sin(rad);
  const totalGridD = rows * modD + (rows - 1) * gap;

  const panels: ComputedSolarPanel[] = [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (let idx = 0; idx < count; idx++) {
    const r = Math.floor(idx / cols);
    const c = idx % cols;
    const colsInRow = Math.min(cols, count - r * cols);
    const rowW = colsInRow * modW + (colsInRow - 1) * gap;

    // Local coordinates unrotated before array rotation
    const lxBase = -rowW / 2 + modW / 2 + c * (modW + gap);
    const lyBase = -totalGridD / 2 + modD / 2 + r * (modD + gap);
    // Keep grid orientation steady around array center when rotating module layout
    const rx = isSideways ? lxBase : lxBase * cosR - lyBase * sinR;
    const ry = isSideways ? lyBase : lxBase * sinR + lyBase * cosR;

    const pOff = solar.panelOffsets?.[idx];
    const px = Number((anchorX + rx + (pOff?.x ?? 0)).toFixed(3));
    const py = Number((anchorY + ry + (pOff?.y ?? 0)).toFixed(3));

    const surf = computeRoofSurfaceAt(project, px, py);

    panels.push({
      index: idx,
      x: px,
      y: py,
      z3d: surf.y3d,
      width: modW,
      depth: modD,
      rotX: surf.rotX,
      rotY: surf.rotY,
      rotZ: surf.rotZ,
      rotationDeg: rotDeg,
    });

    minX = Math.min(minX, px - modW / 2);
    maxX = Math.max(maxX, px + modW / 2);
    minY = Math.min(minY, py - modD / 2);
    maxY = Math.max(maxY, py + modD / 2);
  }

  if (!Number.isFinite(minX)) {
    minX = anchorX - 1;
    maxX = anchorX + 1;
    minY = anchorY - 1;
    maxY = anchorY + 1;
  }

  return {
    anchorX,
    anchorY,
    bounds: {
      minX,
      minY,
      maxX,
      maxY,
      width: maxX - minX,
      depth: maxY - minY,
      centerX: (minX + maxX) / 2,
      centerY: (minY + maxY) / 2,
    },
    cols,
    rows,
    panels,
  };
}
