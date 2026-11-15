import {
  BuildingProject,
  FloorLevel,
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

  const filterClose = (vals: number[], minGap = 0.6): number[] => {
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
    if (!intersections.some((p) => dist(p, pt) < 0.65)) {
      intersections.push(snapPoint(pt, 0.05));
    }
  };

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
