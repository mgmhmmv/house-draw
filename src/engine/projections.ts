import { BuildingProject, getSolarConfig, Point2D, SectionLine } from '../model/types';
import {
  computeSolarArrayLayout,
  levelBoundingBox,
  segmentIntersection,
  wallLength,
} from './geometry';
import { getOpeningMarkMap } from './standardsEngine';

export type ElevationDirection = 'North' | 'South' | 'East' | 'West';

export interface ProjectedOpening {
  id: string;
  tag: string;
  width: number;
  height: number;
  sillHeight: number;
  headHeight: number;
  x1: number;
  x2: number;
  yBottom: number; // height above ground 0
  yTop: number;
  kind: 'door' | 'window';
  style: string;
}

export interface ProjectedSolarPanel {
  u1: number;
  u2: number;
  yBottom: number;
  yTop: number;
  tiltDeg: number;
}

export interface ElevationData {
  direction: ElevationDirection;
  minU: number;
  maxU: number;
  width: number;
  eaveHeight: number;
  ridgeHeight: number;
  roofType: string;
  pitchDeg: number;
  slopeRatio: string;
  overhang: number;
  rafterLength: number;
  apexAngleDeg: number;
  ridgeHalf: number;
  pierPoints: number[];
  sillHeights: number[];
  headHeights: number[];
  solarPanels: ProjectedSolarPanel[];
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

export interface SectionCutRoom {
  id: string;
  code: string;
  name: string;
  u1: number;
  u2: number;
  elevation: number;
  ceilingHeight: number;
  floorFinish: string;
}

export interface SectionCutOpening {
  tag: string;
  kind: 'door' | 'window';
  u1: number;
  u2: number;
  yBottom: number;
  yTop: number;
}

export interface SectionData {
  label: string;
  axis: 'X' | 'Y';
  length: number;
  walls: SectionCutWall[];
  rooms: SectionCutRoom[];
  openings: SectionCutOpening[];
  slabs: { u1: number; u2: number; yBottom: number; yTop: number }[];
  footings: { u: number; width: number; depth: number }[];
  roofRidgeY: number;
  roofEaveY: number;
  pitchDeg: number;
  slopeRatio: string;
  overhang: number;
  rafterLength: number;
  apexAngleDeg: number;
  minU: number;
  maxU: number;
}

function dedupeSorted(values: number[], minGap = 0.08): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const out: number[] = [];
  for (const v of sorted) {
    if (out.length === 0 || v - out[out.length - 1] >= minGap) {
      out.push(Number(v.toFixed(2)));
    }
  }
  return out;
}

function formatSlopeRatio(roofType: string, pitchDeg: number): string {
  if (roofType === 'flat') return '1:50 (Min Fall)';
  const tan = Math.tan((Math.max(1, pitchDeg) * Math.PI) / 180);
  const run = tan > 0.001 ? 1 / tan : 50;
  return `1:${run.toFixed(2)}`;
}

export function computeElevation(project: BuildingProject, direction: ElevationDirection): ElevationData {
  const ground = project.levels[0];
  const bb = ground ? levelBoundingBox(ground) : { minX: 0, minY: 0, maxX: 12, maxY: 10, width: 12, depth: 10 };

  const horizontal = direction === 'North' || direction === 'South';
  const minU = horizontal ? bb.minX : bb.minY;
  const maxU = horizontal ? bb.maxX : bb.maxY;
  const width = Math.max(4, maxU - minU);
  const crossSpan = Math.max(4, horizontal ? bb.depth : bb.width);

  const openings: ProjectedOpening[] = [];
  const wallSilhouettes: { u1: number; u2: number; yBottom: number; yTop: number }[] = [];
  const levelDatums: { name: string; elevation: number; topHeight: number }[] = [];
  const openingMarks = getOpeningMarkMap(project);

  for (const lvl of project.levels) {
    const baseElev = lvl.elevation;
    const topH = baseElev + lvl.floorToFloorHeight;
    levelDatums.push({ name: lvl.name, elevation: baseElev, topHeight: topH });

    for (const wall of lvl.walls) {
      if (!wall.isExterior) continue;
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

        const yBottom = baseElev + op.sillHeight;
        const yTop = yBottom + op.height;
        const tag = openingMarks.get(op.id) ?? op.label ?? (op.kind === 'door' ? 'D1' : 'W1');

        openings.push({
          id: op.id,
          tag,
          width: op.width,
          height: op.height,
          sillHeight: op.sillHeight,
          headHeight: yTop,
          x1: cu - projSpan / 2,
          x2: cu + projSpan / 2,
          yBottom,
          yTop,
          kind: op.kind,
          style: op.style,
        });
      }
    }
  }

  const lastLevel = project.levels[project.levels.length - 1];
  const eaveHeight = lastLevel ? lastLevel.elevation + lastLevel.floorToFloorHeight : 3.65;
  const ov = project.roof.overhang;
  const pitchDeg = project.roof.type === 'flat' ? 1.15 : project.roof.pitchDeg;
  const pitchRad = (pitchDeg * Math.PI) / 180;

  let ridgeRise = 0;
  let rafterLength = width + 2 * ov;
  let apexAngleDeg = 180;
  if (project.roof.type === 'gable' || project.roof.type === 'hip') {
    const halfShort = Math.min(bb.width, bb.depth) / 2;
    ridgeRise = halfShort * Math.tan(pitchRad);
    const run = halfShort + ov;
    rafterLength = Math.hypot(run, ridgeRise + ov * Math.tan(pitchRad));
    apexAngleDeg = Math.max(20, 180 - 2 * project.roof.pitchDeg);
  } else if (project.roof.type === 'shed') {
    ridgeRise = crossSpan * Math.tan(pitchRad) * 0.65;
    rafterLength = Math.hypot(crossSpan + 2 * ov, ridgeRise);
    apexAngleDeg = 90 + pitchDeg;
  } else {
    ridgeRise = project.roof.parapetHeight;
    rafterLength = width;
    apexAngleDeg = 180;
  }

  const hw = (bb.width + ov * 2) / 2;
  const hd = (bb.depth + ov * 2) / 2;
  const ridgeHalf = project.roof.type === 'hip' ? Math.max(0.2, hw - hd * 0.85) : hw;

  const pierRaw: number[] = [minU, maxU];
  const sillRaw: number[] = [];
  const headRaw: number[] = [];
  for (const op of openings) {
    pierRaw.push(op.x1, op.x2);
    if (op.sillHeight > 0.05) sillRaw.push(op.yBottom);
    headRaw.push(op.yTop);
  }

  const solarCfg = getSolarConfig(project);
  const solarPanels: ProjectedSolarPanel[] = [];
  if (solarCfg.enabled) {
    const layout = computeSolarArrayLayout(project);
    for (const p of layout.panels) {
      const rotTilt = Math.max(Math.abs((p.rotX * 180) / Math.PI), Math.abs((p.rotZ * 180) / Math.PI));
      const tiltDeg = Number((rotTilt > 0.5 ? rotTilt : pitchDeg).toFixed(1));
      if (horizontal) {
        const halfRise = (p.depth / 2) * Math.sin(Math.abs(p.rotX || pitchRad));
        solarPanels.push({
          u1: p.x - p.width / 2,
          u2: p.x + p.width / 2,
          yBottom: p.z3d - Math.max(0.05, halfRise),
          yTop: p.z3d + Math.max(0.05, halfRise),
          tiltDeg,
        });
      } else {
        const halfRun = (p.depth / 2) * Math.cos(Math.abs(p.rotX || pitchRad));
        const halfRise = (p.depth / 2) * Math.sin(Math.abs(p.rotX || pitchRad));
        solarPanels.push({
          u1: p.y - halfRun,
          u2: p.y + halfRun,
          yBottom: p.z3d - Math.max(0.05, halfRise),
          yTop: p.z3d + Math.max(0.05, halfRise),
          tiltDeg,
        });
      }
    }
  }

  return {
    direction,
    minU,
    maxU,
    width,
    eaveHeight,
    ridgeHeight: eaveHeight + ridgeRise,
    roofType: project.roof.type,
    pitchDeg,
    slopeRatio: formatSlopeRatio(project.roof.type, pitchDeg),
    overhang: ov,
    rafterLength: Number(rafterLength.toFixed(2)),
    apexAngleDeg: Number(apexAngleDeg.toFixed(1)),
    ridgeHalf,
    pierPoints: dedupeSorted(pierRaw, 0.12),
    sillHeights: dedupeSorted(sillRaw, 0.12),
    headHeights: dedupeSorted(headRaw, 0.12),
    solarPanels,
    levelDatums,
    openings,
    wallSilhouettes,
  };
}

export function computeSection(project: BuildingProject, section: SectionLine): SectionData {
  const dxSec = Math.abs(section.end.x - section.start.x);
  const dySec = Math.abs(section.end.y - section.start.y);
  const axis: 'X' | 'Y' = dxSec >= dySec ? 'X' : 'Y';
  const sLen = Math.hypot(section.end.x - section.start.x, section.end.y - section.start.y) || 1;
  const walls: SectionCutWall[] = [];
  const rooms: SectionCutRoom[] = [];
  const openings: SectionCutOpening[] = [];
  const slabs: { u1: number; u2: number; yBottom: number; yTop: number }[] = [];
  const footings: { u: number; width: number; depth: number }[] = [];
  const openingMarks = getOpeningMarkMap(project);

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

        const wLen = wallLength(w);
        for (const op of lvl.openings.filter((o) => o.wallId === w.id)) {
          const distFromCenter = Math.abs(hit.u - op.offset) * wLen;
          if (distFromCenter <= op.width / 2 + 0.25) {
            openings.push({
              tag: openingMarks.get(op.id) ?? op.label ?? (op.kind === 'door' ? 'D1' : 'W1'),
              kind: op.kind,
              u1: u - w.thickness / 2,
              u2: u + w.thickness / 2,
              yBottom: lvl.elevation + op.sillHeight,
              yTop: lvl.elevation + op.sillHeight + op.height,
            });
          }
        }

        if (u < lvlMin) lvlMin = u;
        if (u > lvlMax) lvlMax = u;
        if (u < minU) minU = u;
        if (u > maxU) maxU = u;
      }
    }

    lvl.rooms.forEach((r, rIdx) => {
      if (r.polygon.length < 3) return;
      const tHits: number[] = [];
      for (let i = 0; i < r.polygon.length; i++) {
        const p1 = r.polygon[i];
        const p2 = r.polygon[(i + 1) % r.polygon.length];
        const h = segmentIntersection(section.start, section.end, p1, p2);
        if (h) tHits.push(h.t * sLen);
      }
      if (tHits.length >= 2) {
        const u1 = Math.min(...tHits);
        const u2 = Math.max(...tHits);
        if (u2 - u1 > 0.4) {
          rooms.push({
            id: r.id,
            code: `RM-${(lvl.index + 1) * 100 + rIdx + 1}`,
            name: r.name,
            u1,
            u2,
            elevation: lvl.elevation,
            ceilingHeight: r.ceilingHeight,
            floorFinish: r.finish,
          });
        }
      }
    });

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
  const ov = project.roof.overhang;
  const span = Math.max(4, maxU - minU);
  const pitchDeg = project.roof.type === 'flat' ? 1.15 : project.roof.pitchDeg;
  const pitchRad = (pitchDeg * Math.PI) / 180;
  const roofRidgeY =
    project.roof.type === 'flat'
      ? roofEaveY + project.roof.parapetHeight
      : roofEaveY + (span / 2) * Math.tan(pitchRad);

  const halfRun = span / 2 + ov;
  const rise = roofRidgeY - roofEaveY;
  const rafterLength = project.roof.type === 'flat' ? span + 2 * ov : Math.hypot(halfRun, rise);
  const apexAngleDeg = project.roof.type === 'flat' ? 180 : Math.max(20, 180 - 2 * project.roof.pitchDeg);

  return {
    label: section.label,
    axis,
    length: sLen,
    walls,
    rooms,
    openings,
    slabs,
    footings,
    roofRidgeY,
    roofEaveY,
    pitchDeg,
    slopeRatio: formatSlopeRatio(project.roof.type, pitchDeg),
    overhang: ov,
    rafterLength: Number(rafterLength.toFixed(2)),
    apexAngleDeg: Number(apexAngleDeg.toFixed(1)),
    minU,
    maxU,
  };
}
