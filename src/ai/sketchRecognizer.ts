import { BuildingProject, Opening, Point2D, Room, RoomCategory, SketchStroke, Wall } from '../model/types';
import {
  autoGenerateStructuralGrid,
  autoPlaceStructuralColumns,
  dist,
  levelBoundingBox,
  midpoint,
  projectPointOnSegment,
  snapPoint,
  uid,
} from '../engine/geometry';
import { autoPopulateMEPForLevel } from '../engine/mepEngine';

function perpendicularDist(pt: Point2D, lineStart: Point2D, lineEnd: Point2D): number {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return dist(pt, lineStart);
  return Math.abs(dy * pt.x - dx * pt.y + lineEnd.x * lineStart.y - lineEnd.y * lineStart.x) / len;
}

export function simplifyDouglasPeucker(points: Point2D[], epsilon = 0.35): Point2D[] {
  if (points.length <= 2) return points;
  let maxDist = 0;
  let index = 0;
  const end = points.length - 1;
  for (let i = 1; i < end; i++) {
    const d = perpendicularDist(points[i], points[0], points[end]);
    if (d > maxDist) {
      maxDist = d;
      index = i;
    }
  }
  if (maxDist > epsilon) {
    const left = simplifyDouglasPeucker(points.slice(0, index + 1), epsilon);
    const right = simplifyDouglasPeucker(points.slice(index), epsilon);
    return [...left.slice(0, -1), ...right];
  }
  return [points[0], points[end]];
}

function snapSegmentOrtho45(a: Point2D, b: Point2D): { start: Point2D; end: Point2D } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 0.25) return { start: a, end: b };
  const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
  // Snap within 15 deg to nearest 0/90/180 or 45 deg
  const nearest45 = Math.round(angleDeg / 45) * 45;
  const diff = Math.abs(angleDeg - nearest45);
  const snappedRad = ((diff <= 18 ? nearest45 : angleDeg) * Math.PI) / 180;
  const end = snapPoint(
    {
      x: a.x + Math.cos(snappedRad) * len,
      y: a.y + Math.sin(snappedRad) * len,
    },
    0.25
  );
  return { start: snapPoint(a, 0.25), end };
}

export interface SketchConversionSummary {
  project: BuildingProject;
  wallsAdded: number;
  openingsAdded: number;
  roomsDetected: number;
}

export function convertSketchStrokesToBIM(
  project: BuildingProject,
  levelIndex: number,
  strokes: SketchStroke[]
): SketchConversionSummary {
  const targetLevel = project.levels[levelIndex] ?? project.levels[0];
  const wallStrokes = strokes.filter((s) => s.kind === 'wall' && s.points.length >= 2);
  const doorStrokes = strokes.filter((s) => s.kind === 'door' && s.points.length >= 1);
  const windowStrokes = strokes.filter((s) => s.kind === 'window' && s.points.length >= 1);

  const rawSegments: { start: Point2D; end: Point2D }[] = [];
  for (const s of wallStrokes) {
    const simplified = simplifyDouglasPeucker(s.points, 0.35);
    for (let i = 0; i < simplified.length - 1; i++) {
      const seg = snapSegmentOrtho45(simplified[i], simplified[i + 1]);
      if (dist(seg.start, seg.end) >= 0.4) {
        rawSegments.push(seg);
      }
    }
  }

  // Cluster/weld endpoints within 0.55m so sketched corners meet cleanly
  const weldedPoints: Point2D[] = [];
  for (const w of targetLevel.walls) {
    weldedPoints.push(w.start, w.end);
  }
  const weld = (pt: Point2D): Point2D => {
    for (const existing of weldedPoints) {
      if (dist(existing, pt) <= 0.55) {
        return { ...existing };
      }
    }
    const clean = snapPoint(pt, 0.25);
    weldedPoints.push(clean);
    return clean;
  };

  const newWalls: Wall[] = [];
  for (const seg of rawSegments) {
    const start = weld(seg.start);
    const end = weld(seg.end);
    if (dist(start, end) < 0.4) continue;
    newWalls.push({
      id: uid('w'),
      start,
      end,
      thickness: 0.23,
      height: targetLevel.floorToFloorHeight - targetLevel.slabThickness,
      isExterior: true,
      isLoadBearing: true,
      material: 'brick',
    });
  }

  const allWalls = [...targetLevel.walls, ...newWalls];

  // Classify interior vs exterior walls using bounding box of all walls
  const allPts = allWalls.flatMap((w) => [w.start, w.end]);
  const minX = Math.min(...allPts.map((p) => p.x));
  const maxX = Math.max(...allPts.map((p) => p.x));
  const minY = Math.min(...allPts.map((p) => p.y));
  const maxY = Math.max(...allPts.map((p) => p.y));

  for (const w of allWalls) {
    const onPerimeter =
      (Math.abs(w.start.x - minX) < 0.4 && Math.abs(w.end.x - minX) < 0.4) ||
      (Math.abs(w.start.x - maxX) < 0.4 && Math.abs(w.end.x - maxX) < 0.4) ||
      (Math.abs(w.start.y - minY) < 0.4 && Math.abs(w.end.y - minY) < 0.4) ||
      (Math.abs(w.start.y - maxY) < 0.4 && Math.abs(w.end.y - maxY) < 0.4);
    w.isExterior = onPerimeter;
    w.thickness = onPerimeter ? 0.23 : 0.12;
  }

  // Project sketched doors & windows onto nearest wall
  const newOpenings: Opening[] = [];
  const attachOpening = (stroke: SketchStroke, kind: 'door' | 'window') => {
    const center =
      stroke.points.length >= 2
        ? midpoint(stroke.points[0], stroke.points[stroke.points.length - 1])
        : stroke.points[0];
    let bestWall: Wall | null = null;
    let bestT = 0.5;
    let bestD = Infinity;
    for (const w of allWalls) {
      const proj = projectPointOnSegment(center, w.start, w.end);
      if (proj.distance < bestD) {
        bestD = proj.distance;
        bestT = proj.t;
        bestWall = w;
      }
    }
    if (bestWall && bestD < 1.8) {
      const strokeSpan =
        stroke.points.length >= 2
          ? Math.min(2.4, Math.max(0.8, dist(stroke.points[0], stroke.points[stroke.points.length - 1])))
          : kind === 'door'
          ? 0.9
          : 1.5;
      newOpenings.push({
        id: uid('op'),
        wallId: bestWall.id,
        kind,
        style: kind === 'door' ? 'single' : 'casement',
        offset: Math.max(0.1, Math.min(0.9, Number(bestT.toFixed(2)))),
        width: Number(snapPoint({ x: strokeSpan, y: 0 }, 0.1).x.toFixed(2)),
        height: kind === 'door' ? 2.15 : 1.35,
        sillHeight: kind === 'door' ? 0 : 0.9,
        swingDirection: 1,
        label: kind === 'door' ? 'D1' : 'W1',
      });
    }
  };

  doorStrokes.forEach((s) => attachOpening(s, 'door'));
  windowStrokes.forEach((s) => attachOpening(s, 'window'));

  // Synthesize detected rooms by slicing bounding box along interior orthogonal walls
  let rooms: Room[] = [...targetLevel.rooms];
  if (newWalls.length >= 3 && targetLevel.rooms.length === 0) {
    const xCuts = Array.from(
      new Set([
        minX,
        maxX,
        ...allWalls.filter((w) => Math.abs(w.start.x - w.end.x) < 0.3).map((w) => Number(w.start.x.toFixed(1))),
      ])
    ).sort((a, b) => a - b);
    const yCuts = Array.from(
      new Set([
        minY,
        maxY,
        ...allWalls.filter((w) => Math.abs(w.start.y - w.end.y) < 0.3).map((w) => Number(w.start.y.toFixed(1))),
      ])
    ).sort((a, b) => a - b);

    const detected: Room[] = [];
    const labels: { name: string; cat: RoomCategory; finish: Room['finish'] }[] = [
      { name: 'Living Area', cat: 'living', finish: 'porcelain' },
      { name: 'Kitchen / Dining', cat: 'kitchen', finish: 'porcelain' },
      { name: 'Primary Bedroom', cat: 'bedroom', finish: 'hardwood' },
      { name: 'Bath Suite', cat: 'bathroom', finish: 'ceramic_antiskid' },
      { name: 'Bedroom 02', cat: 'bedroom', finish: 'hardwood' },
      { name: 'Study / Hall', cat: 'office', finish: 'hardwood' },
    ];
    let idx = 0;
    for (let xi = 0; xi < xCuts.length - 1; xi++) {
      for (let yi = 0; yi < yCuts.length - 1; yi++) {
        const w = xCuts[xi + 1] - xCuts[xi];
        const h = yCuts[yi + 1] - yCuts[yi];
        if (w < 1.5 || h < 1.5) continue;
        const tpl = labels[idx % labels.length];
        detected.push({
          id: uid('rm'),
          name: idx < labels.length ? tpl.name : `Zone ${idx + 1}`,
          category: tpl.cat,
          polygon: [
            { x: xCuts[xi], y: yCuts[yi] },
            { x: xCuts[xi + 1], y: yCuts[yi] },
            { x: xCuts[xi + 1], y: yCuts[yi + 1] },
            { x: xCuts[xi], y: yCuts[yi + 1] },
          ],
          finish: tpl.finish,
          ceilingHeight: 3.0,
        });
        idx++;
      }
    }
    if (detected.length > 0) {
      rooms = detected;
    }
  }

  let updatedLevel = {
    ...targetLevel,
    walls: allWalls,
    openings: [...targetLevel.openings, ...newOpenings],
    rooms,
  };
  updatedLevel.columns = autoPlaceStructuralColumns(updatedLevel);
  updatedLevel = autoPopulateMEPForLevel(updatedLevel);

  const levels = project.levels.map((l, i) => (i === levelIndex ? updatedLevel : l));
  const bb = levelBoundingBox(updatedLevel);

  return {
    project: {
      ...project,
      levels,
      grid: autoGenerateStructuralGrid(updatedLevel),
      sections: [
        {
          id: 'sec_a',
          label: 'A-A',
          start: { x: bb.minX - 1.2, y: (bb.minY + bb.maxY) / 2 },
          end: { x: bb.maxX + 1.2, y: (bb.minY + bb.maxY) / 2 },
        },
      ],
    },
    wallsAdded: newWalls.length,
    openingsAdded: newOpenings.length,
    roomsDetected: rooms.length - targetLevel.rooms.length,
  };
}
