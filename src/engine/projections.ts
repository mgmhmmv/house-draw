import { BuildingProject, Point2D, SectionLine } from '../model/types';
import { levelBoundingBox, segmentIntersection, wallLength } from './geometry';

export type ElevationDirection = 'North' | 'South' | 'East' | 'West';

export interface ProjectedOpening {
  x1: number;
  x2: number;
  yBottom: number; // height above ground 0
  yTop: number;
  kind: 'door' | 'window';
  style: string;
}

export interface ElevationData {
  direction: ElevationDirection;
  minU: number;
  maxU: number;
  width: number;
  eaveHeight: number;
  ridgeHeight: number;
  roofType: string;
  levelDatums: { name: string; elevation: number; topHeight: number }[];
  openings: ProjectedOpening[];
  wallSilhouettes: { u1: number; u2: number; yBottom: number; yTop: number }[];
}

export interface SectionCutWall {
  u: number; // position along section line (meters)
  thickness: number;
  yBottom: number;
  yTop: number;
  isExterior: boolean;
}

export interface SectionData {
  label: string;
  length: number;
  walls: SectionCutWall[];
  slabs: { u1: number; u2: number; yBottom: number; yTop: number }[];
  footings: { u: number; width: number; depth: number }[];
  roofRidgeY: number;
  roofEaveY: number;
  minU: number;
  maxU: number;
}

export function computeElevation(project: BuildingProject, direction: ElevationDirection): ElevationData {
  const ground = project.levels[0];
  const bb = ground ? levelBoundingBox(ground) : { minX: 0, minY: 0, maxX: 12, maxY: 10, width: 12, depth: 10 };

  const horizontal = direction === 'North' || direction === 'South';
  const minU = horizontal ? bb.minX : bb.minY;
  const maxU = horizontal ? bb.maxX : bb.maxY;
  const width = Math.max(4, maxU - minU);

  const openings: ProjectedOpening[] = [];
  const wallSilhouettes: { u1: number; u2: number; yBottom: number; yTop: number }[] = [];
  const levelDatums: { name: string; elevation: number; topHeight: number }[] = [];

  for (const lvl of project.levels) {
    const baseElev = lvl.elevation;
    const topH = baseElev + lvl.floorToFloorHeight;
    levelDatums.push({ name: lvl.name, elevation: baseElev, topHeight: topH });

    for (const wall of lvl.walls) {
      if (!wall.isExterior) continue;
      // Check if wall faces the elevation side roughly
      const u1 = horizontal ? wall.start.x : wall.start.y;
      const u2 = horizontal ? wall.end.x : wall.end.y;
      const depthCoord = horizontal ? (wall.start.y + wall.end.y) / 2 : (wall.start.x + wall.end.x) / 2;

      const isFacing =
        (direction === 'North' && depthCoord <= (bb.minY + bb.maxY) / 2 + 1) ||
        (direction === 'South' && depthCoord >= (bb.minY + bb.maxY) / 2 - 1) ||
        (direction === 'West' && depthCoord <= (bb.minX + bb.maxX) / 2 + 1) ||
        (direction === 'East' && depthCoord >= (bb.minX + bb.maxX) / 2 - 1);

      if (Math.abs(u2 - u1) > 0.25) {
        wallSilhouettes.push({
          u1: Math.min(u1, u2),
          u2: Math.max(u1, u2),
          yBottom: baseElev,
          yTop: baseElev + wall.height,
        });
      }

      if (!isFacing) continue;
      const wLen = wallLength(wall);
      if (wLen < 0.2) continue;

      for (const op of lvl.openings.filter((o) => o.wallId === wall.id)) {
        const cx = wall.start.x + (wall.end.x - wall.start.x) * op.offset;
        const cy = wall.start.y + (wall.end.y - wall.start.y) * op.offset;
        const cu = horizontal ? cx : cy;
        const dx = Math.abs(wall.end.x - wall.start.x) / wLen;
        const dy = Math.abs(wall.end.y - wall.start.y) / wLen;
        const projSpan = op.width * (horizontal ? dx : dy);
        if (projSpan < 0.15) continue;

        openings.push({
          x1: cu - projSpan / 2,
          x2: cu + projSpan / 2,
          yBottom: baseElev + op.sillHeight,
          yTop: baseElev + op.sillHeight + op.height,
          kind: op.kind,
          style: op.style,
        });
      }
    }
  }

  const lastLevel = project.levels[project.levels.length - 1];
  const eaveHeight = lastLevel ? lastLevel.elevation + lastLevel.floorToFloorHeight : 3.65;
  const spanForRoof = horizontal ? bb.depth : bb.width;
  const pitchRad = (project.roof.pitchDeg * Math.PI) / 180;
  let ridgeRise = 0;
  if (project.roof.type === 'gable' || project.roof.type === 'hip') {
    ridgeRise = (Math.min(bb.width, bb.depth) / 2) * Math.tan(pitchRad);
  } else if (project.roof.type === 'shed') {
    ridgeRise = spanForRoof * Math.tan(pitchRad) * 0.65;
  } else {
    ridgeRise = project.roof.parapetHeight;
  }

  return {
    direction,
    minU,
    maxU,
    width,
    eaveHeight,
    ridgeHeight: eaveHeight + ridgeRise,
    roofType: project.roof.type,
    levelDatums,
    openings,
    wallSilhouettes,
  };
}

export function computeSection(project: BuildingProject, section: SectionLine): SectionData {
  const sLen = Math.hypot(section.end.x - section.start.x, section.end.y - section.start.y) || 1;
  const walls: SectionCutWall[] = [];
  const slabs: { u1: number; u2: number; yBottom: number; yTop: number }[] = [];
  const footings: { u: number; width: number; depth: number }[] = [];

  let minU = Infinity;
  let maxU = -Infinity;

  for (const lvl of project.levels) {
    const bb = levelBoundingBox(lvl);
    const corners: Point2D[] = [
      { x: bb.minX, y: bb.minY },
      { x: bb.maxX, y: bb.minY },
      { x: bb.maxX, y: bb.maxY },
      { x: bb.minX, y: bb.maxY },
    ];
    let lvlMin = sLen;
    let lvlMax = 0;

    for (const w of lvl.walls) {
      const hit = segmentIntersection(section.start, section.end, w.start, w.end);
      if (hit) {
        const u = hit.t * sLen;
        walls.push({
          u,
          thickness: w.thickness,
          yBottom: lvl.elevation,
          yTop: lvl.elevation + w.height,
          isExterior: w.isExterior,
        });
        if (lvl.index === 0) {
          footings.push({ u, width: w.isExterior ? 0.7 : 0.5, depth: 0.9 });
        }
        if (u < lvlMin) lvlMin = u;
        if (u > lvlMax) lvlMax = u;
        if (u < minU) minU = u;
        if (u > maxU) maxU = u;
      }
    }

    // Fallback projection of bounding box along section line if walls missed
    if (lvlMin >= lvlMax) {
      const proj = corners.map((c) => {
        const dx = section.end.x - section.start.x;
        const dy = section.end.y - section.start.y;
        return ((c.x - section.start.x) * dx + (c.y - section.start.y) * dy) / sLen;
      });
      lvlMin = Math.max(0, Math.min(...proj));
      lvlMax = Math.min(sLen, Math.max(...proj));
    }
    if (lvlMax > lvlMin) {
      slabs.push({
        u1: lvlMin - 0.15,
        u2: lvlMax + 0.15,
        yBottom: lvl.elevation - lvl.slabThickness,
        yTop: lvl.elevation,
      });
      if (lvlMin < minU) minU = lvlMin;
      if (lvlMax > maxU) maxU = lvlMax;
    }
  }

  if (!isFinite(minU) || !isFinite(maxU)) {
    minU = 1;
    maxU = sLen - 1;
  }

  const lastLevel = project.levels[project.levels.length - 1];
  const roofEaveY = lastLevel ? lastLevel.elevation + lastLevel.floorToFloorHeight : 3.65;
  const span = Math.max(4, maxU - minU);
  const pitchRad = (project.roof.pitchDeg * Math.PI) / 180;
  const roofRidgeY =
    project.roof.type === 'flat'
      ? roofEaveY + project.roof.parapetHeight
      : roofEaveY + (span / 2) * Math.tan(pitchRad);

  return {
    label: section.label,
    length: sLen,
    walls,
    slabs,
    footings,
    roofRidgeY,
    roofEaveY,
    minU,
    maxU,
  };
}
