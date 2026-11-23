import { moduleLabel, pvString } from '../model/pvModule';
import {
  BuildingProject,
  FloorLevel,
  getHVACConfig,
  getRoofDrainageConfig,
  getSolarConfig,
  getWaterSupply,
  type WaterSupplyMode,
  GUTTER_PROFILE_META,
  MEPCircuit,
  MEPNode,
  Point2D,
  Room,
  WATER_COLLECTION_META,
  WaterCollectionMode,
  WiringRouteMode,
} from '../model/types';
import {
  computeRoofSurfaceAt,
  computeSolarArrayLayout,
  levelBoundingBox,
  openingWorldCenter,
  polygonArea,
  polygonCentroid,
  projectPointOnSegment,
  uid,
} from './geometry';

export { getDesignConfig, getHVACConfig, getSolarConfig } from '../model/types';

export interface HVACRoomLoadRow {
  roomId: string;
  roomCode: string;
  roomName: string;
  levelName: string;
  category: string;
  areaM2: number;
  volumeM3: number;
  sensibleWatts: number;
  latentWatts: number;
  totalCoolingWatts: number;
  selectedBtu: number;
  selectedKWth: number;
  unitCount: number;
  unitTag: string;
  electricalInputWatts: number;
  refrigerantPipeSpec: string;
  condensatePipeSpec: string;
  airflowCfm: number;
  hasCeilingFan: boolean;
}

export interface HVACEngineeringReport {
  climateLabel: string;
  outdoorSpec: string;
  indoorSpec: string;
  totalCoolingKWth: number;
  totalCoolingBtu: number;
  totalCoolingTons: number;
  totalElectricalKW: number;
  seerCop: number;
  sensibleHeatRatio: number;
  condenserUnitsCount: number;
  refrigerantSpec: string;
  condenserCoatingSpec: string;
  ventilationSpec: string;
  rows: HVACRoomLoadRow[];
}

export interface ElectricalCircuitScheduleRow {
  circuitId: string;
  name: string;
  phase: 'L1' | 'L2' | 'L3' | '1-Ph';
  loadWatts: number;
  demandFactor: number;
  designAmps: number;
  breakerRating: string;
  cableSpec: string;
  pointCount: number;
  cableLengthM: number;
  voltageDropV: number;
  voltageDropPct: number;
  breakingCapacityKA: number;
  rcdSensitivitymA: number;
  zsMaxOhms: number;
}

export interface SolarPVReport {
  enabled: boolean;
  panelCount: number;
  panelWattage: number;
  arrayKwp: number;
  stringsCount: number;
  panelsPerString: number;
  stringVocV: number;
  /** String Voc at the coolest cell temperature (20 °C). */
  stringVocColdV: number;
  stringVmpV: number;
  stringIscA: number;
  /** Module make and model, e.g. "Luxen Solar LNVU-590ND". */
  module: string;
  inverterKW: number;
  batteryKWh: number;
  dcCableSpec: string;
  dcIsolatorSpec: string;
  stringFuseSpec: string;
  acBreakerSpec: string;
  estimatedDailyKWh: number;
  netGridDemandKW: number;
}

export interface EquipmentRoutingSummary {
  mdbPos: Point2D;
  meterPos: Point2D;
  inverterPos: Point2D;
  bessPos: Point2D;
  meterToMdbM: number;
  pvToInverterM: number;
  inverterToMdbM: number;
  inverterToBessM: number;
}

export interface ElectricalSLDReport {
  totalConnectedWatts: number;
  diversifiedLoadKW: number;
  designCurrentAmps: number;
  mainBreakerSpec: string;
  supplyCableSpec: string;
  earthingSpec: string;
  supplySystem: string;
  powerFactor: number;
  maxVoltageDropPct: number;
  phaseBalance: { L1_kW: number; L2_kW: number; L3_kW: number };
  spdSpec: string;
  solarPV: SolarPVReport;
  equipmentRouting: EquipmentRoutingSummary;
  circuits: ElectricalCircuitScheduleRow[];
}

export interface CoreElectricalNodes {
  mdb: MEPNode;
  meter: MEPNode;
  inverter: MEPNode;
  bess: MEPNode;
  pvAnchor: MEPNode | null;
}

/** Resolves MDB, Utility kWh Meter, Hybrid Inverter & BESS nodes on a floor level (with legacy fallbacks). */
export function getCoreElectricalNodes(level: FloorLevel): CoreElectricalNodes {
  const bb = levelBoundingBox(level);
  const findOrDefault = (
    kind: MEPNode['kind'],
    fallbackPos: Point2D,
    label: string,
    circuitId?: string
  ): MEPNode => {
    const existing = level.mepNodes.find((n) => n.kind === kind);
    if (existing) return existing;
    return {
      id: `virtual_${kind}_${level.index}`,
      kind,
      system: 'electrical',
      position: fallbackPos,
      circuitId,
      label,
    };
  };

  const mdb = findOrDefault(
    'mdb',
    { x: Number((bb.minX + 0.5).toFixed(2)), y: Number((bb.minY + 0.5).toFixed(2)) },
    `MDB-${level.index + 1}`
  );
  const meter = findOrDefault(
    'utility_meter',
    { x: Number((bb.minX - 0.12).toFixed(2)), y: Number((bb.minY + 1.35).toFixed(2)) },
    'KWH-MTR',
    'GRID-IN'
  );
  const inverter = findOrDefault(
    'solar_inv',
    { x: Number((bb.minX - 0.12).toFixed(2)), y: Number((bb.minY + 2.35).toFixed(2)) },
    'HYB-INV',
    'PV-DC1'
  );
  const bess = findOrDefault(
    'solar_bess',
    { x: Number((bb.minX - 0.12).toFixed(2)), y: Number((bb.minY + 3.15).toFixed(2)) },
    'BESS',
    'PV-DC1'
  );
  const pvAnchor = level.mepNodes.find((n) => n.kind === 'solar_pv') ?? null;

  return { mdb, meter, inverter, bess, pvAnchor };
}

export interface Point3D {
  x: number;
  y: number;
  z: number;
}

export interface RoutePathResult {
  points2D: Point2D[];
  points3D: Point3D[];
  waypoints: Point2D[];
  lengthM: number;
  modeUsed: WiringRouteMode;
  label: string;
}

export interface PVAndEquipmentRoutes {
  pvCombinerPos: Point2D;
  pvCombinerY3d: number;
  pvToInverter: RoutePathResult;
  inverterToMdb: RoutePathResult;
  meterToMdb: RoutePathResult;
  inverterToBess: RoutePathResult;
}

function roundPt(p: Point2D): Point2D {
  return { x: Number(p.x.toFixed(2)), y: Number(p.y.toFixed(2)) };
}

function pruneOrthoPolyline2D(pts: Point2D[], minStep = 0.06): Point2D[] {
  const dedup: Point2D[] = [];
  for (const raw of pts) {
    const p = roundPt(raw);
    const prev = dedup[dedup.length - 1];
    if (!prev || Math.hypot(p.x - prev.x, p.y - prev.y) >= minStep) {
      dedup.push(p);
    }
  }
  if (dedup.length <= 2) return dedup;
  const simplified: Point2D[] = [dedup[0]];
  for (let i = 1; i < dedup.length - 1; i++) {
    const a = simplified[simplified.length - 1];
    const b = dedup[i];
    const c = dedup[i + 1];
    const sameX = Math.abs(a.x - b.x) < 0.03 && Math.abs(b.x - c.x) < 0.03;
    const sameY = Math.abs(a.y - b.y) < 0.03 && Math.abs(b.y - c.y) < 0.03;
    if (!sameX && !sameY) {
      simplified.push(b);
    }
  }
  simplified.push(dedup[dedup.length - 1]);
  return simplified;
}

function polylineLength2D(pts: Point2D[]): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  }
  return len;
}

function polylineLength3D(pts: Point3D[]): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y, pts[i].z - pts[i - 1].z);
  }
  return len;
}

/** Finds structural corridor / hallway centerline or longest internal spine wall on a floor level. */
export function findLevelCorridorSpine(level: FloorLevel): { spineY: number; spineX: number } {
  const bb = levelBoundingBox(level);
  const hallRooms = level.rooms.filter(
    (r) =>
      r.category === 'hallway' ||
      /foyer|hall|corridor|gallery/i.test(r.name)
  );
  let spineY = Number(((bb.minY + bb.maxY) / 2).toFixed(2));
  let spineX = Number(((bb.minX + bb.maxX) / 2).toFixed(2));

  if (hallRooms.length > 0) {
    const c = polygonCentroid(hallRooms[0].polygon);
    spineY = Number(c.y.toFixed(2));
    spineX = Number(c.x.toFixed(2));
    return { spineY, spineX };
  }

  let bestHorizLen = 0;
  let bestVertLen = 0;
  for (const w of level.walls) {
    const dx = Math.abs(w.end.x - w.start.x);
    const dy = Math.abs(w.end.y - w.start.y);
    const midY = (w.start.y + w.end.y) / 2;
    const midX = (w.start.x + w.end.x) / 2;
    const isInteriorY = midY > bb.minY + 0.8 && midY < bb.maxY - 0.8;
    const isInteriorX = midX > bb.minX + 0.8 && midX < bb.maxX - 0.8;
    if (dx > dy * 3 && isInteriorY && dx > bestHorizLen) {
      bestHorizLen = dx;
      spineY = Number(midY.toFixed(2));
    }
    if (dy > dx * 3 && isInteriorX && dy > bestVertLen) {
      bestVertLen = dy;
      spineX = Number(midX.toFixed(2));
    }
  }
  return { spineY, spineX };
}

export type WallSide = 'north' | 'south' | 'west' | 'east';

export interface RoomWallOpening {
  side: WallSide;
  kind: 'door' | 'window';
  coord: number; // x for north/south walls, y for east/west walls
  width: number;
  isExterior: boolean;
}

export function getRoomBounds(room: Room): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  width: number;
  depth: number;
  cx: number;
  cy: number;
} {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of room.polygon) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  if (!Number.isFinite(minX)) {
    return { minX: 0, maxX: 4, minY: 0, maxY: 4, width: 4, depth: 4, cx: 2, cy: 2 };
  }
  return {
    minX,
    maxX,
    minY,
    maxY,
    width: Math.max(0.5, maxX - minX),
    depth: Math.max(0.5, maxY - minY),
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
  };
}

/** Identifies all doors/windows and interior/exterior walls bounding a room. */
export function findRoomWallOpenings(
  room: Room,
  level: FloorLevel
): {
  openings: RoomWallOpening[];
  sideIsInterior: Record<WallSide, boolean>;
} {
  const b = getRoomBounds(room);
  const openings: RoomWallOpening[] = [];
  const sideHasExteriorWall: Record<WallSide, boolean> = {
    north: false,
    south: false,
    west: false,
    east: false,
  };
  const sideHasInteriorWall: Record<WallSide, boolean> = {
    north: false,
    south: false,
    west: false,
    east: false,
  };

  for (const w of level.walls) {
    const dx = Math.abs(w.end.x - w.start.x);
    const dy = Math.abs(w.end.y - w.start.y);
    const minWX = Math.min(w.start.x, w.end.x);
    const maxWX = Math.max(w.start.x, w.end.x);
    const minWY = Math.min(w.start.y, w.end.y);
    const maxWY = Math.max(w.start.y, w.end.y);

    if (dx > dy * 2) {
      const wallY = (w.start.y + w.end.y) / 2;
      const overlapX = Math.min(maxWX, b.maxX) - Math.max(minWX, b.minX);
      if (overlapX > 0.4) {
        if (Math.abs(wallY - b.minY) < 0.28) {
          if (w.isExterior) sideHasExteriorWall.north = true;
          else sideHasInteriorWall.north = true;
        }
        if (Math.abs(wallY - b.maxY) < 0.28) {
          if (w.isExterior) sideHasExteriorWall.south = true;
          else sideHasInteriorWall.south = true;
        }
      }
    } else if (dy > dx * 2) {
      const wallX = (w.start.x + w.end.x) / 2;
      const overlapY = Math.min(maxWY, b.maxY) - Math.max(minWY, b.minY);
      if (overlapY > 0.4) {
        if (Math.abs(wallX - b.minX) < 0.28) {
          if (w.isExterior) sideHasExteriorWall.west = true;
          else sideHasInteriorWall.west = true;
        }
        if (Math.abs(wallX - b.maxX) < 0.28) {
          if (w.isExterior) sideHasExteriorWall.east = true;
          else sideHasInteriorWall.east = true;
        }
      }
    }
  }

  for (const op of level.openings) {
    const w = level.walls.find((x) => x.id === op.wallId);
    if (!w) continue;
    const c = openingWorldCenter(w, op);
    const isHoriz = Math.abs(w.end.x - w.start.x) >= Math.abs(w.end.y - w.start.y);
    if (isHoriz) {
      if (c.x < b.minX - 0.25 || c.x > b.maxX + 0.25) continue;
      if (Math.abs(c.y - b.minY) < 0.28) {
        openings.push({ side: 'north', kind: op.kind, coord: c.x, width: op.width, isExterior: w.isExterior });
      } else if (Math.abs(c.y - b.maxY) < 0.28) {
        openings.push({ side: 'south', kind: op.kind, coord: c.x, width: op.width, isExterior: w.isExterior });
      }
    } else {
      if (c.y < b.minY - 0.25 || c.y > b.maxY + 0.25) continue;
      if (Math.abs(c.x - b.minX) < 0.28) {
        openings.push({ side: 'west', kind: op.kind, coord: c.y, width: op.width, isExterior: w.isExterior });
      } else if (Math.abs(c.x - b.maxX) < 0.28) {
        openings.push({ side: 'east', kind: op.kind, coord: c.y, width: op.width, isExterior: w.isExterior });
      }
    }
  }

  return {
    openings,
    sideIsInterior: {
      north: sideHasInteriorWall.north || !sideHasExteriorWall.north,
      south: sideHasInteriorWall.south || !sideHasExteriorWall.south,
      west: sideHasInteriorWall.west || !sideHasExteriorWall.west,
      east: sideHasInteriorWall.east || !sideHasExteriorWall.east,
    },
  };
}

function pointOnRoomWallSide(b: ReturnType<typeof getRoomBounds>, side: WallSide, coord: number, inset: number): Point2D {
  if (side === 'north') return { x: Number(coord.toFixed(2)), y: Number((b.minY + inset).toFixed(2)) };
  if (side === 'south') return { x: Number(coord.toFixed(2)), y: Number((b.maxY - inset).toFixed(2)) };
  if (side === 'west') return { x: Number((b.minX + inset).toFixed(2)), y: Number(coord.toFixed(2)) };
  return { x: Number((b.maxX - inset).toFixed(2)), y: Number(coord.toFixed(2)) };
}

/** Picks a flush wall-mounted spot inside a room, avoiding doorways, windows, and existing fixtures. */
export function pickClearRoomWallSpot(
  room: Room,
  level: FloorLevel,
  side: WallSide,
  preferredCoord: number,
  inset = 0.08,
  existingPts: Point2D[] = []
): Point2D {
  const b = getRoomBounds(room);
  const { openings } = findRoomWallOpenings(room, level);
  const sideOpenings = openings.filter((o) => o.side === side);
  const sideDoors = sideOpenings.filter((o) => o.kind === 'door');
  const wallStart = side === 'north' || side === 'south' ? b.minX : b.minY;
  const wallEnd = side === 'north' || side === 'south' ? b.maxX : b.maxY;
  const wallLen = wallEnd - wallStart;
  if (wallLen < 0.72) {
    return pointOnRoomWallSide(b, side, (wallStart + wallEnd) / 2, inset);
  }
  const lo = wallStart + 0.30;
  const hi = wallEnd - 0.30;
  const clampCoord = (c: number) => Math.max(lo, Math.min(hi, c));

  const hitsDoors = (c: number) =>
    sideDoors.some((op) => c >= op.coord - op.width / 2 - 0.18 && c <= op.coord + op.width / 2 + 0.18);
  const hitsAnyOpening = (c: number) =>
    sideOpenings.some((op) => c >= op.coord - op.width / 2 - 0.16 && c <= op.coord + op.width / 2 + 0.16);
  const hitsExisting = (c: number) => {
    const pt = pointOnRoomWallSide(b, side, c, inset);
    return existingPts.some((ex) => Math.hypot(ex.x - pt.x, ex.y - pt.y) < 0.42);
  };

  const offsets = [0, 0.45, -0.45, 0.85, -0.85, 1.25, -1.25, 1.65, -1.65];
  // Pass 1: avoid all openings + existing fixtures
  for (const off of offsets) {
    const cand = clampCoord(preferredCoord + off);
    if (!hitsAnyOpening(cand) && !hitsExisting(cand)) {
      return pointOnRoomWallSide(b, side, cand, inset);
    }
  }
  // Pass 2: strictly avoid doors + existing fixtures (under windows is acceptable)
  for (const off of offsets) {
    const cand = clampCoord(preferredCoord + off);
    if (!hitsDoors(cand) && !hitsExisting(cand)) {
      return pointOnRoomWallSide(b, side, cand, inset);
    }
  }
  // Pass 3: avoid doors even if close to existing fixture
  for (const off of offsets) {
    const cand = clampCoord(preferredCoord + off);
    if (!hitsDoors(cand)) {
      return pointOnRoomWallSide(b, side, cand, inset);
    }
  }
  return pointOnRoomWallSide(b, side, clampCoord(preferredCoord), inset);
}

/** Finds a room's primary entry door & wall (preferring interior doors, else interior spine wall). */
export function findRoomEntryWallAndDoor(
  room: Room,
  level: FloorLevel
): {
  entrySide: WallSide;
  doorCoord: number;
  doorHalfW: number;
  hasDoor: boolean;
  sideIsInterior: Record<WallSide, boolean>;
} {
  const b = getRoomBounds(room);
  const { openings, sideIsInterior } = findRoomWallOpenings(room, level);
  const doors = openings.filter((o) => o.kind === 'door');
  const intDoors = doors.filter((d) => !d.isExterior);
  const chosenDoor = intDoors[0] ?? doors[0];
  if (chosenDoor) {
    return {
      entrySide: chosenDoor.side,
      doorCoord: chosenDoor.coord,
      doorHalfW: chosenDoor.width / 2,
      hasDoor: true,
      sideIsInterior,
    };
  }

  const { spineX, spineY } = findLevelCorridorSpine(level);
  const sides: WallSide[] = ['west', 'east', 'north', 'south'];
  const intSides = sides.filter((s) => sideIsInterior[s]);
  const pool = intSides.length > 0 ? intSides : sides;
  const distToSpine = (s: WallSide) =>
    s === 'north'
      ? Math.abs(b.minY - spineY)
      : s === 'south'
      ? Math.abs(b.maxY - spineY)
      : s === 'west'
      ? Math.abs(b.minX - spineX)
      : Math.abs(b.maxX - spineX);
  pool.sort((a, z) => distToSpine(a) - distToSpine(z));
  const bestSide = pool[0];
  const defaultCoord = bestSide === 'north' || bestSide === 'south' ? b.minX + Math.min(1.0, b.width * 0.3) : b.minY + Math.min(1.0, b.depth * 0.3);
  return {
    entrySide: bestSide,
    doorCoord: defaultCoord,
    doorHalfW: 0.4,
    hasDoor: false,
    sideIsInterior,
  };
}

/** Traces an orthogonal conduit path strictly along the interior wall perimeter of a single room. */
export function routeAlongRoomWalls2D(
  fromRaw: Point2D,
  toRaw: Point2D,
  room: Room,
  inset = 0.06
): Point2D[] {
  const from = roundPt(fromRaw);
  const to = roundPt(toRaw);
  if (Math.hypot(from.x - to.x, from.y - to.y) < 0.08) return [from, to];

  const b = getRoomBounds(room);
  const wX = Number((b.minX + inset).toFixed(2));
  const eX = Number((b.maxX - inset).toFixed(2));
  const nY = Number((b.minY + inset).toFixed(2));
  const sY = Number((b.maxY - inset).toFixed(2));
  const clampX = (x: number) => Math.max(wX, Math.min(eX, x));
  const clampY = (y: number) => Math.max(nY, Math.min(sY, y));

  const projectRoomWall = (p: Point2D): { side: WallSide; pt: Point2D } => {
    const dW = Math.abs(p.x - wX);
    const dE = Math.abs(p.x - eX);
    const dN = Math.abs(p.y - nY);
    const dS = Math.abs(p.y - sY);
    const m = Math.min(dW, dE, dN, dS);
    if (m === dW) return { side: 'west', pt: roundPt({ x: wX, y: clampY(p.y) }) };
    if (m === dE) return { side: 'east', pt: roundPt({ x: eX, y: clampY(p.y) }) };
    if (m === dN) return { side: 'north', pt: roundPt({ x: clampX(p.x), y: nY }) };
    return { side: 'south', pt: roundPt({ x: clampX(p.x), y: sY }) };
  };

  const s1 = projectRoomWall(from);
  const s2 = projectRoomWall(to);
  if (s1.side === s2.side) {
    return pruneOrthoPolyline2D([from, s1.pt, s2.pt, to]);
  }

  const cwSideIdx: Record<WallSide, number> = { north: 0, east: 1, south: 2, west: 3 };
  const cwCorners: Point2D[] = [
    { x: wX, y: nY },
    { x: eX, y: nY },
    { x: eX, y: sY },
    { x: wX, y: sY },
  ];

  const trace = (cw: boolean): Point2D[] => {
    const idx1 = cwSideIdx[s1.side];
    const idx2 = cwSideIdx[s2.side];
    const pts: Point2D[] = [from, s1.pt];
    let cur = idx1;
    for (let step = 0; step < 5; step++) {
      if (cur === idx2 && step > 0) break;
      if (cw) {
        pts.push(cwCorners[(cur + 1) % 4]);
        cur = (cur + 1) % 4;
      } else {
        pts.push(cwCorners[cur]);
        cur = (cur + 3) % 4;
      }
      if (cur === idx2) break;
    }
    pts.push(s2.pt, to);
    return pruneOrthoPolyline2D(pts);
  };

  const cwPts = trace(true);
  const ccwPts = trace(false);
  return polylineLength2D(cwPts) <= polylineLength2D(ccwPts) ? cwPts : ccwPts;
}

/**
 * Building-wide shortest-path orthogonal router that strictly follows actual walls
 * (exterior and interior partitions) rather than cutting across rooms.
 */
export function computeInWallPath2D(
  fromRaw: Point2D,
  toRaw: Point2D,
  level: FloorLevel
): Point2D[] {
  const from = roundPt(fromRaw);
  const to = roundPt(toRaw);
  if (Math.hypot(from.x - to.x, from.y - to.y) < 0.14) return [from, to];

  const wallSegs: Array<{ a: Point2D; b: Point2D }> = [];
  for (const w of level.walls) {
    wallSegs.push({ a: w.start, b: w.end });
  }
  for (const r of level.rooms) {
    for (let i = 0; i < r.polygon.length; i++) {
      wallSegs.push({ a: r.polygon[i], b: r.polygon[(i + 1) % r.polygon.length] });
    }
  }
  if (wallSegs.length === 0) {
    return pruneOrthoPolyline2D([from, { x: to.x, y: from.y }, to]);
  }

  const projectNearestWall = (pt: Point2D): Point2D => {
    let bestPt = pt;
    let bestDist = Infinity;
    for (const s of wallSegs) {
      const p = projectPointOnSegment(pt, s.a, s.b);
      if (p.distance < bestDist) {
        bestDist = p.distance;
        bestPt = p.point;
      }
    }
    return roundPt(bestPt);
  };

  const startW = projectNearestWall(from);
  const endW = projectNearestWall(to);
  if (Math.hypot(startW.x - endW.x, startW.y - endW.y) < 0.12) {
    return pruneOrthoPolyline2D([from, startW, endW, to]);
  }

  const rawXs: number[] = [startW.x, endW.x];
  const rawYs: number[] = [startW.y, endW.y];
  for (const s of wallSegs) {
    rawXs.push(s.a.x, s.b.x);
    rawYs.push(s.a.y, s.b.y);
  }

  const clusterCoords = (vals: number[], snapEndpoints: number[]): number[] => {
    const out: number[] = [...snapEndpoints.map((v) => Number(v.toFixed(2)))];
    const sorted = vals.map((v) => Number(v.toFixed(2))).sort((a, b) => a - b);
    for (const v of sorted) {
      if (!out.some((u) => Math.abs(u - v) < 0.08)) {
        out.push(v);
      }
    }
    return Array.from(new Set(out)).sort((a, b) => a - b);
  };

  const xs = clusterCoords(rawXs, [startW.x, endW.x]);
  const ys = clusterCoords(rawYs, [startW.y, endW.y]);
  const nx = xs.length;
  const ny = ys.length;

  const nearestIdx = (arr: number[], val: number) => {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < arr.length; i++) {
      const d = Math.abs(arr[i] - val);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  };

  const sx = nearestIdx(xs, startW.x);
  const sy = nearestIdx(ys, startW.y);
  const tx = nearestIdx(xs, endW.x);
  const ty = nearestIdx(ys, endW.y);

  const distToAnyWall = (px: number, py: number): number => {
    const pt = { x: px, y: py };
    let minD = Infinity;
    for (const s of wallSegs) {
      const d = projectPointOnSegment(pt, s.a, s.b).distance;
      if (d < minD) minD = d;
      if (minD <= 0.16) return minD;
    }
    return minD;
  };

  const segMultiplier = (x1: number, y1: number, x2: number, y2: number): number => {
    const d1 = distToAnyWall(x1 + (x2 - x1) * 0.2, y1 + (y2 - y1) * 0.2);
    const d2 = distToAnyWall(x1 + (x2 - x1) * 0.5, y1 + (y2 - y1) * 0.5);
    const d3 = distToAnyWall(x1 + (x2 - x1) * 0.8, y1 + (y2 - y1) * 0.8);
    return Math.max(d1, d2, d3) <= 0.30 ? 1.0 : 8.0;
  };

  // Dijkstra over grid states: idx = (yi * nx + xi) * 3 + prevDir (0=start, 1=horiz, 2=vert)
  const totalStates = nx * ny * 3;
  const distArr = new Float64Array(totalStates).fill(Infinity);
  const prevArr = new Int32Array(totalStates).fill(-1);
  const visited = new Uint8Array(totalStates);

  const stateId = (xi: number, yi: number, dir: number) => (yi * nx + xi) * 3 + dir;
  const startState = stateId(sx, sy, 0);
  distArr[startState] = 0;

  // Binary min-heap of [cost, state]
  const heapCost: number[] = [0];
  const heapState: number[] = [startState];
  const swap = (i: number, j: number) => {
    const tc = heapCost[i];
    heapCost[i] = heapCost[j];
    heapCost[j] = tc;
    const ts = heapState[i];
    heapState[i] = heapState[j];
    heapState[j] = ts;
  };
  const pushHeap = (c: number, st: number) => {
    let i = heapCost.length;
    heapCost.push(c);
    heapState.push(st);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heapCost[p] <= heapCost[i]) break;
      swap(p, i);
      i = p;
    }
  };
  const popHeap = (): [number, number] | null => {
    if (heapCost.length === 0) return null;
    const topC = heapCost[0];
    const topS = heapState[0];
    const lastC = heapCost.pop()!;
    const lastS = heapState.pop()!;
    if (heapCost.length > 0) {
      heapCost[0] = lastC;
      heapState[0] = lastS;
      let i = 0;
      const n = heapCost.length;
      while (true) {
        let best = i;
        const l = i * 2 + 1;
        const r = i * 2 + 2;
        if (l < n && heapCost[l] < heapCost[best]) best = l;
        if (r < n && heapCost[r] < heapCost[best]) best = r;
        if (best === i) break;
        swap(i, best);
        i = best;
      }
    }
    return [topC, topS];
  };

  let bestEndState = -1;
  while (heapCost.length > 0) {
    const popped = popHeap();
    if (!popped) break;
    const [curCost, st] = popped;
    if (visited[st]) continue;
    visited[st] = 1;

    const dir = st % 3;
    const cell = (st - dir) / 3;
    const xi = cell % nx;
    const yi = Math.floor(cell / nx);

    if (xi === tx && yi === ty) {
      bestEndState = st;
      break;
    }

    const tryStep = (nxi: number, nyi: number, nDir: number) => {
      if (nxi < 0 || nxi >= nx || nyi < 0 || nyi >= ny) return;
      const nSt = stateId(nxi, nyi, nDir);
      if (visited[nSt]) return;
      const x1 = xs[xi];
      const y1 = ys[yi];
      const x2 = xs[nxi];
      const y2 = ys[nyi];
      const segLen = Math.hypot(x2 - x1, y2 - y1);
      const turnPenalty = dir !== 0 && dir !== nDir ? 0.12 : 0;
      const edgeCost = segLen * segMultiplier(x1, y1, x2, y2) + turnPenalty;
      const nextCost = curCost + edgeCost;
      if (nextCost < distArr[nSt]) {
        distArr[nSt] = nextCost;
        prevArr[nSt] = st;
        pushHeap(nextCost, nSt);
      }
    };

    tryStep(xi - 1, yi, 1);
    tryStep(xi + 1, yi, 1);
    tryStep(xi, yi - 1, 2);
    tryStep(xi, yi + 1, 2);
  }

  if (bestEndState < 0) {
    return pruneOrthoPolyline2D([from, startW, { x: endW.x, y: startW.y }, endW, to]);
  }

  const revPts: Point2D[] = [];
  let cur = bestEndState;
  while (cur >= 0) {
    const dir = cur % 3;
    const cell = (cur - dir) / 3;
    const xi = cell % nx;
    const yi = Math.floor(cell / nx);
    revPts.push({ x: xs[xi], y: ys[yi] });
    cur = prevArr[cur];
  }
  revPts.reverse();

  return pruneOrthoPolyline2D([from, ...revPts, to]);
}

/**
 * Routes 2D conduit/feeder orthogonally along building perimeter or interior walls
 * instead of cutting diagonally across rooms or mid-air space.
 */
export function computeWallHuggingPath2D(
  fromRaw: Point2D,
  toRaw: Point2D,
  level: FloorLevel,
  mode: WiringRouteMode = 'auto',
  customWaypoints?: Point2D[]
): Point2D[] {
  const from = roundPt(fromRaw);
  const to = roundPt(toRaw);
  if (customWaypoints && customWaypoints.length > 0) {
    return [from, ...customWaypoints.map(roundPt), to];
  }

  const bb = levelBoundingBox(level);
  const isInteriorPt = (p: Point2D) =>
    p.x > bb.minX + 0.45 && p.x < bb.maxX - 0.45 && p.y > bb.minY + 0.45 && p.y < bb.maxY - 0.45;

  if ((mode === 'corridor' || (mode === 'auto' && (isInteriorPt(from) || isInteriorPt(to)))) && level.walls.length > 0) {
    return computeInWallPath2D(from, to, level);
  }

  const pad = 0.14;
  const wX = Number((bb.minX - pad).toFixed(2));
  const eX = Number((bb.maxX + pad).toFixed(2));
  const nY = Number((bb.minY - pad).toFixed(2));
  const sY = Number((bb.maxY + pad).toFixed(2));

  if (mode === 'corridor') {
    const { spineY, spineX } = findLevelCorridorSpine(level);
    const useHoriz = Math.abs(from.x - to.x) >= Math.abs(from.y - to.y);
    const fromWallSide = Math.abs(from.x - wX) < 0.7 || Math.abs(from.x - eX) < 0.7;
    if (useHoriz) {
      const entryX = fromWallSide
        ? Math.abs(from.x - wX) < Math.abs(from.x - eX)
          ? wX
          : eX
        : from.x;
      return pruneOrthoPolyline2D([
        from,
        { x: entryX, y: from.y },
        { x: entryX, y: spineY },
        { x: to.x, y: spineY },
        to,
      ]);
    }
    return pruneOrthoPolyline2D([
      from,
      { x: spineX, y: from.y },
      { x: spineX, y: to.y },
      to,
    ]);
  }

  const clampX = (x: number) => Math.max(wX, Math.min(eX, x));
  const clampY = (y: number) => Math.max(nY, Math.min(sY, y));

  const requiredSide: WallSide | null =
    mode === 'north_wall'
      ? 'north'
      : mode === 'south_wall'
      ? 'south'
      : mode === 'west_wall'
      ? 'west'
      : mode === 'east_wall'
      ? 'east'
      : null;

  const projectToWall = (p: Point2D): { side: WallSide; pt: Point2D } => {
    const dW = Math.abs(p.x - wX);
    const dE = Math.abs(p.x - eX);
    const dN = Math.abs(p.y - nY);
    const dS = Math.abs(p.y - sY);
    const isInterior = p.x >= bb.minX && p.x <= bb.maxX && p.y >= bb.minY && p.y <= bb.maxY;
    if (isInterior && requiredSide) {
      if (requiredSide === 'north' && dN <= 3.0) return { side: 'north', pt: { x: clampX(p.x), y: nY } };
      if (requiredSide === 'south' && dS <= 3.0) return { side: 'south', pt: { x: clampX(p.x), y: sY } };
      if (requiredSide === 'west' && dW <= 3.0) return { side: 'west', pt: { x: wX, y: clampY(p.y) } };
      if (requiredSide === 'east' && dE <= 3.0) return { side: 'east', pt: { x: eX, y: clampY(p.y) } };
    }
    const minD = Math.min(dW, dE, dN, dS);
    if (minD === dW) return { side: 'west', pt: { x: wX, y: clampY(p.y) } };
    if (minD === dE) return { side: 'east', pt: { x: eX, y: clampY(p.y) } };
    if (minD === dN) return { side: 'north', pt: { x: clampX(p.x), y: nY } };
    return { side: 'south', pt: { x: clampX(p.x), y: sY } };
  };

  // Perimeter corners clockwise starting NW -> NE -> SE -> SW
  // Sides along CW order: 0: north (NW->NE), 1: east (NE->SE), 2: south (SE->SW), 3: west (SW->NW)
  const cwSideIdx: Record<WallSide, number> = { north: 0, east: 1, south: 2, west: 3 };
  const cwCorners: Point2D[] = [
    { x: wX, y: nY }, // NW (corner entering North going CW, or entering East at index 1)
    { x: eX, y: nY }, // NE
    { x: eX, y: sY }, // SE
    { x: wX, y: sY }, // SW
  ];

  const tracePerimeter = (p1Side: WallSide, p1Pt: Point2D, p2Side: WallSide, p2Pt: Point2D, cw: boolean): { pts: Point2D[]; sidesVisited: Set<WallSide> } => {
    const idx1 = cwSideIdx[p1Side];
    const idx2 = cwSideIdx[p2Side];
    const pts: Point2D[] = [from, p1Pt];
    const sidesVisited = new Set<WallSide>([p1Side, p2Side]);
    const sideOrder: WallSide[] = ['north', 'east', 'south', 'west'];

    if (idx1 === idx2) {
      // Same perimeter side: check whether direct segment vs full loop is needed when forcing a different wall
      const dirMismatch =
        (mode === 'north_wall' && p1Side !== 'north') ||
        (mode === 'south_wall' && p1Side !== 'south') ||
        (mode === 'west_wall' && p1Side !== 'west') ||
        (mode === 'east_wall' && p1Side !== 'east');
      if (!dirMismatch) {
        pts.push(p2Pt, to);
        return { pts: pruneOrthoPolyline2D(pts), sidesVisited };
      }
    }

    let cur = idx1;
    for (let step = 0; step < 5; step++) {
      if (cur === idx2 && (step > 0 || p1Side === p2Side)) {
        if (step > 0) break;
      }
      if (cw) {
        // Leaving cur edge via cwCorners[(cur + 1) % 4]
        pts.push(cwCorners[(cur + 1) % 4]);
        cur = (cur + 1) % 4;
      } else {
        // Leaving cur edge via cwCorners[cur]
        pts.push(cwCorners[cur]);
        cur = (cur + 3) % 4;
      }
      sidesVisited.add(sideOrder[cur]);
      if (cur === idx2) break;
    }

    pts.push(p2Pt, to);
    return { pts: pruneOrthoPolyline2D(pts), sidesVisited };
  };

  const s1 = projectToWall(from);
  const s2 = projectToWall(to);

  // If both points sit very close along same wall interior/exterior without intervening corners
  const cwTrace = tracePerimeter(s1.side, s1.pt, s2.side, s2.pt, true);
  const ccwTrace = tracePerimeter(s1.side, s1.pt, s2.side, s2.pt, false);

  if (requiredSide) {
    const cwHas = cwTrace.sidesVisited.has(requiredSide);
    const ccwHas = ccwTrace.sidesVisited.has(requiredSide);
    if (cwHas && !ccwHas) return cwTrace.pts;
    if (ccwHas && !cwHas) return ccwTrace.pts;
    return polylineLength2D(cwTrace.pts) <= polylineLength2D(ccwTrace.pts) ? cwTrace.pts : ccwTrace.pts;
  }

  // Auto: choose shorter of CW vs CCW perimeter paths (or direct L-bend if both are inside same room/corner)
  const bestPerimeter =
    polylineLength2D(cwTrace.pts) <= polylineLength2D(ccwTrace.pts) ? cwTrace.pts : ccwTrace.pts;
  return bestPerimeter;
}

/**
 * Computes full 2D & 3D roof-sloped, soffit-tucked, wall/corridor-hugging routes for:
 * PV Array -> HYB-INV, HYB-INV -> MDB, Utility Meter -> MDB, and HYB-INV -> BESS.
 */
export function computePVAndEquipmentRoutes(
  project: BuildingProject,
  levelIndex = 0
): PVAndEquipmentRoutes {
  const groundLvl = project.levels[levelIndex] ?? project.levels[0];
  const lastLevel = project.levels[project.levels.length - 1] ?? groundLvl;
  const solar = getSolarConfig(project);
  const dcMode: WiringRouteMode = solar.dcRouteMode ?? 'auto';
  const acMode: WiringRouteMode = solar.acRouteMode ?? 'auto';
  const elevTrim = Math.max(-0.5, Math.min(0.25, solar.conduitElevationOffset ?? 0));

  if (!groundLvl) {
    const z = { x: 0, y: 0 };
    const p3 = { x: 0, y: 1.5, z: 0 };
    const empty: RoutePathResult = {
      points2D: [z, z],
      points3D: [p3, p3],
      waypoints: [],
      lengthM: 0,
      modeUsed: 'auto',
      label: 'N/A',
    };
    return {
      pvCombinerPos: z,
      pvCombinerY3d: 3.5,
      pvToInverter: empty,
      inverterToMdb: empty,
      meterToMdb: empty,
      inverterToBess: empty,
    };
  }

  const core = getCoreElectricalNodes(groundLvl);
  const bb = levelBoundingBox(groundLvl);
  const groundBaseY = groundLvl.elevation;
  const groundTopY = groundLvl.elevation + groundLvl.floorToFloorHeight;
  const roofEaveBaseY = lastLevel.elevation + lastLevel.floorToFloorHeight;
  const pad = 0.14;
  const wX = Number((bb.minX - pad).toFixed(2));
  const eX = Number((bb.maxX + pad).toFixed(2));
  const nY = Number((bb.minY - pad).toFixed(2));
  const sY = Number((bb.maxY + pad).toFixed(2));

  const invPos = roundPt(core.inverter.position);
  const mdbPos = roundPt(core.mdb.position);
  const meterPos = roundPt(core.meter.position);
  const bessPos = roundPt(core.bess.position);

  // 1. Locate rooftop PV Combiner Box (PV-JB) flush on roof array edge
  const solarLayout = computeSolarArrayLayout(project);
  const arrayCenter =
    solarLayout.panels.length > 0
      ? { x: solarLayout.bounds.centerX, y: solarLayout.bounds.centerY }
      : core.pvAnchor?.position ?? { x: (bb.minX + bb.maxX) / 2, y: (bb.minY + bb.maxY) / 2 };

  const resolveDcDropWall = (): WallSide | 'corridor' => {
    if (dcMode === 'north_wall') return 'north';
    if (dcMode === 'south_wall') return 'south';
    if (dcMode === 'west_wall') return 'west';
    if (dcMode === 'east_wall') return 'east';
    if (dcMode === 'corridor') return 'corridor';
    const face = solar.roofFace ?? 'south';
    if (face === 'north' || face === 'south' || face === 'east' || face === 'west') {
      return face;
    }
    const dW = Math.abs(invPos.x - wX);
    const dE = Math.abs(invPos.x - eX);
    const dN = Math.abs(invPos.y - nY);
    const dS = Math.abs(invPos.y - sY);
    const m = Math.min(dW, dE, dN, dS);
    if (m === dW) return 'west';
    if (m === dE) return 'east';
    if (m === dN) return 'north';
    return 'south';
  };

  const dropWall = resolveDcDropWall();
  let pvCombinerPos: Point2D = roundPt(arrayCenter);
  if (solarLayout.panels.length > 0) {
    const b = solarLayout.bounds;
    const edgeOffset = 0.16;
    if (dropWall === 'south') {
      const targetX = Math.max(b.minX + 0.3, Math.min(b.maxX - 0.3, invPos.x));
      pvCombinerPos = roundPt({ x: targetX, y: b.maxY + edgeOffset });
    } else if (dropWall === 'north') {
      const targetX = Math.max(b.minX + 0.3, Math.min(b.maxX - 0.3, invPos.x));
      pvCombinerPos = roundPt({ x: targetX, y: b.minY - edgeOffset });
    } else if (dropWall === 'west') {
      const targetY = Math.max(b.minY + 0.3, Math.min(b.maxY - 0.3, invPos.y));
      pvCombinerPos = roundPt({ x: b.minX - edgeOffset, y: targetY });
    } else if (dropWall === 'east') {
      const targetY = Math.max(b.minY + 0.3, Math.min(b.maxY - 0.3, invPos.y));
      pvCombinerPos = roundPt({ x: b.maxX + edgeOffset, y: targetY });
    } else {
      pvCombinerPos = roundPt({ x: b.minX + 0.35, y: b.minY - edgeOffset });
    }
  }
  const pvCombSurf = computeRoofSurfaceAt(project, pvCombinerPos.x, pvCombinerPos.y);
  const pvCombinerY3d = Number((pvCombSurf.y3d + 0.06).toFixed(3));

  // Build default eave transition junction box + wall-following corners for PV -> INV
  let dcWaypoints: Point2D[];
  if (solar.dcWaypoints && solar.dcWaypoints.length > 0) {
    dcWaypoints = solar.dcWaypoints.map(roundPt);
  } else if (dropWall === 'corridor') {
    const { spineY } = findLevelCorridorSpine(groundLvl);
    const roofDropPt = roundPt({ x: pvCombinerPos.x, y: spineY });
    const wallSideX = Math.abs(invPos.x - wX) <= Math.abs(invPos.x - eX) ? wX : eX;
    dcWaypoints = pruneOrthoPolyline2D([
      roofDropPt,
      roundPt({ x: wallSideX, y: spineY }),
      roundPt({ x: wallSideX, y: invPos.y }),
    ]);
    // Ensure at least roofDropPt stays first
    if (dcWaypoints.length === 0) dcWaypoints = [roofDropPt];
  } else {
    const eavePt: Point2D =
      dropWall === 'south'
        ? { x: Math.max(wX, Math.min(eX, pvCombinerPos.x)), y: sY }
        : dropWall === 'north'
        ? { x: Math.max(wX, Math.min(eX, pvCombinerPos.x)), y: nY }
        : dropWall === 'west'
        ? { x: wX, y: Math.max(nY, Math.min(sY, pvCombinerPos.y)) }
        : { x: eX, y: Math.max(nY, Math.min(sY, pvCombinerPos.y)) };
    const wallPath = computeWallHuggingPath2D(eavePt, invPos, groundLvl, dcMode);
    // wallPath[0] is eavePt, wallPath[last] is invPos
    dcWaypoints = pruneOrthoPolyline2D([roundPt(eavePt), ...wallPath.slice(1, -1)]);
  }

  const pvPoints2D = pruneOrthoPolyline2D([pvCombinerPos, ...dcWaypoints, invPos]);
  // Re-ensure user waypoints stay verbatim when custom set
  const finalPvPoints2D =
    solar.dcWaypoints && solar.dcWaypoints.length > 0
      ? [pvCombinerPos, ...dcWaypoints, invPos]
      : pvPoints2D;

  // Convert PV -> INV into 3D roof-contour-hugging + under-soffit + wall-hugging conduit points
  const dcWallTrunkY = Number((groundTopY - 0.16 + elevTrim).toFixed(3));
  const roofEaveWallTopY = Number((roofEaveBaseY - 0.16 + elevTrim).toFixed(3));
  const invTopY = Number((groundBaseY + 1.45 + 0.31).toFixed(3));

  const pvPoints3D: Point3D[] = [];
  const roofTargetPt = dcWaypoints[0] ?? invPos;
  const roofDist = Math.hypot(roofTargetPt.x - pvCombinerPos.x, roofTargetPt.y - pvCombinerPos.y);
  const roofSamples = Math.max(4, Math.min(20, Math.ceil(roofDist / 0.35)));
  const roofLift = Math.max(0, elevTrim * 0.25);

  for (let i = 0; i <= roofSamples; i++) {
    const t = i / roofSamples;
    const sx = pvCombinerPos.x + (roofTargetPt.x - pvCombinerPos.x) * t;
    const sy = pvCombinerPos.y + (roofTargetPt.y - pvCombinerPos.y) * t;
    const surf = computeRoofSurfaceAt(project, sx, sy);
    pvPoints3D.push({
      x: Number(sx.toFixed(3)),
      y: Number((surf.y3d + 0.055 + roofLift).toFixed(3)),
      z: Number(sy.toFixed(3)),
    });
  }

  // Tuck down from roof eave surface / roof boot to top-of-wall conduit height
  if (dcWaypoints.length > 0) {
    const wp0 = dcWaypoints[0];
    pvPoints3D.push({
      x: wp0.x,
      y: roofEaveWallTopY,
      z: wp0.y,
    });
    if (Math.abs(roofEaveWallTopY - dcWallTrunkY) > 0.15) {
      pvPoints3D.push({
        x: wp0.x,
        y: dcWallTrunkY,
        z: wp0.y,
      });
    }
    for (let i = 1; i < dcWaypoints.length; i++) {
      pvPoints3D.push({
        x: dcWaypoints[i].x,
        y: dcWallTrunkY,
        z: dcWaypoints[i].y,
      });
    }
  } else {
    pvPoints3D.push({ x: invPos.x, y: dcWallTrunkY, z: invPos.y });
  }
  pvPoints3D.push({ x: invPos.x, y: dcWallTrunkY, z: invPos.y });
  pvPoints3D.push({ x: invPos.x, y: invTopY, z: invPos.y });

  const pvToInverter: RoutePathResult = {
    points2D: finalPvPoints2D,
    points3D: pvPoints3D,
    waypoints: dcWaypoints,
    lengthM: Number(polylineLength3D(pvPoints3D).toFixed(1)),
    modeUsed: dcMode,
    label: `PV → HYB-INV (${dcMode.replace('_', ' ')})`,
  };

  // 2. Inverter -> MDB AC Feeder (sits 0.06m below DC trunking height to avoid clash on shared wall)
  const acPoints2D = computeWallHuggingPath2D(invPos, mdbPos, groundLvl, acMode, solar.acWaypoints);
  const acWaypoints = acPoints2D.length > 2 ? acPoints2D.slice(1, -1) : [];
  const acTrunkY = Number((groundTopY - 0.24 + elevTrim).toFixed(3));
  const mdbTopY = Number((groundBaseY + 1.52 + 0.28).toFixed(3));
  const acPoints3D: Point3D[] = [
    { x: invPos.x, y: invTopY, z: invPos.y },
    { x: invPos.x, y: acTrunkY, z: invPos.y },
    ...acWaypoints.map((w) => ({ x: w.x, y: acTrunkY, z: w.y })),
    { x: mdbPos.x, y: acTrunkY, z: mdbPos.y },
    { x: mdbPos.x, y: mdbTopY, z: mdbPos.y },
  ];
  const inverterToMdb: RoutePathResult = {
    points2D: acPoints2D,
    points3D: acPoints3D,
    waypoints: acWaypoints,
    lengthM: Number(polylineLength3D(acPoints3D).toFixed(1)),
    modeUsed: acMode,
    label: `HYB-INV → MDB (${acMode.replace('_', ' ')})`,
  };

  // 3. Utility kWh Meter -> MDB Feeder
  const meterPts2D = computeWallHuggingPath2D(meterPos, mdbPos, groundLvl, 'auto');
  const gridTrunkY = Number((groundTopY - 0.31 + elevTrim).toFixed(3));
  const meterTopY = Number((groundBaseY + 1.42 + 0.23).toFixed(3));
  const meterPoints3D: Point3D[] = [
    { x: meterPos.x, y: meterTopY, z: meterPos.y },
    { x: meterPos.x, y: gridTrunkY, z: meterPos.y },
    ...meterPts2D.slice(1, -1).map((w) => ({ x: w.x, y: gridTrunkY, z: w.y })),
    { x: mdbPos.x, y: gridTrunkY, z: mdbPos.y },
    { x: mdbPos.x, y: mdbTopY, z: mdbPos.y },
  ];
  const meterToMdb: RoutePathResult = {
    points2D: meterPts2D,
    points3D: meterPoints3D,
    waypoints: meterPts2D.slice(1, -1),
    lengthM: Number(polylineLength3D(meterPoints3D).toFixed(1)),
    modeUsed: 'auto',
    label: 'KWH-MTR → MDB',
  };

  // 4. Inverter -> BESS DC Link
  const invBotY = Number((groundBaseY + 1.14).toFixed(3));
  const bessTopY = Number((groundBaseY + 1.07).toFixed(3));
  const bessCorner: Point2D = { x: invPos.x, y: bessPos.y };
  const bessPts2D = pruneOrthoPolyline2D([invPos, bessCorner, bessPos]);
  const bessPoints3D: Point3D[] = [
    { x: invPos.x, y: invBotY, z: invPos.y },
    { x: invPos.x, y: Number((groundBaseY + 1.12).toFixed(3)), z: bessPos.y },
    { x: bessPos.x, y: bessTopY, z: bessPos.y },
  ];
  const inverterToBess: RoutePathResult = {
    points2D: bessPts2D,
    points3D: bessPoints3D,
    waypoints: [],
    lengthM: Number(polylineLength3D(bessPoints3D).toFixed(1)),
    modeUsed: 'auto',
    label: 'HYB-INV ↔ BESS',
  };

  return {
    pvCombinerPos,
    pvCombinerY3d,
    pvToInverter,
    inverterToMdb,
    meterToMdb,
    inverterToBess,
  };
}

function findRoomForNode(node: MEPNode, level: FloorLevel): Room | undefined {
  if (node.roomId) {
    const exact = level.rooms.find((r) => r.id === node.roomId);
    if (exact) return exact;
  }
  for (const r of level.rooms) {
    const b = getRoomBounds(r);
    if (
      node.position.x >= b.minX - 0.25 &&
      node.position.x <= b.maxX + 0.25 &&
      node.position.y >= b.minY - 0.25 &&
      node.position.y <= b.maxY + 0.25
    ) {
      return r;
    }
  }
  return undefined;
}

function getRoomSubDb(room: Room, level: FloorLevel, fallbackMdb: MEPNode): MEPNode {
  const byId = level.mepNodes.find((n) => n.kind === 'sub_db' && n.roomId === room.id);
  if (byId) return byId;
  const b = getRoomBounds(room);
  const byPos = level.mepNodes.find(
    (n) =>
      n.kind === 'sub_db' &&
      n.position.x >= b.minX - 0.25 &&
      n.position.x <= b.maxX + 0.25 &&
      n.position.y >= b.minY - 0.25 &&
      n.position.y <= b.maxY + 0.25
  );
  return byPos ?? fallbackMdb;
}

/** Computes in-wall sub-main feeders from MDB to every room's Sub-Distribution Board (DB-1xx). */
export function computeSubMainRoutes(level: FloorLevel): Point3D[][] {
  const core = getCoreElectricalNodes(level);
  const baseY = level.elevation;
  const mdbY = Number((baseY + 1.52).toFixed(3));
  const subDbY = Number((baseY + 1.65).toFixed(3));
  const subMainY = Number((baseY + Math.max(2.35, level.floorToFloorHeight - 0.20)).toFixed(3));

  const subDbs = level.mepNodes.filter((n) => n.kind === 'sub_db');
  const runs: Point3D[][] = [];

  for (const sdb of subDbs) {
    const pts2D = computeInWallPath2D(core.mdb.position, sdb.position, level);
    runs.push([
      { x: core.mdb.position.x, y: mdbY, z: core.mdb.position.y },
      ...pts2D.map((p) => ({ x: p.x, y: subMainY, z: p.y })),
      { x: sdb.position.x, y: subDbY, z: sdb.position.y },
    ]);
  }
  return runs;
}

/**
 * Computes per-room in-wall switch feeds (from room Sub-DB -> wall switch) and
 * ceiling-slab lighting runs (from top of switch wall -> ceiling luminaire/fan).
 * Zero conduits drop mid-room.
 */
export function computeLightingRoutes(level: FloorLevel): {
  trunkPaths3D: Point3D[][];
  switchDropPaths3D: Point3D[][];
} {
  const core = getCoreElectricalNodes(level);
  const baseY = level.elevation;
  const ceilingVoidY = Number((baseY + level.floorToFloorHeight - 0.12).toFixed(3));
  const switchY = Number((baseY + 1.22).toFixed(3));
  const subDbY = Number((baseY + 1.65).toFixed(3));

  const lights = level.mepNodes.filter(
    (n) => (n.kind === 'light_ceiling' && n.label !== 'SD') || n.kind === 'ceiling_fan'
  );
  const switches = level.mepNodes.filter((n) => n.kind === 'switch_1g');

  const trunkPaths3D: Point3D[][] = [];
  const switchDropPaths3D: Point3D[][] = [];
  const handledSwitches = new Set<string>();
  const handledLights = new Set<string>();

  for (const r of level.rooms) {
    const subDb = getRoomSubDb(r, level, core.mdb);
    const rSwitches = switches.filter((sw) => findRoomForNode(sw, level)?.id === r.id);
    const rLights = lights.filter((lt) => findRoomForNode(lt, level)?.id === r.id);

    for (const sw of rSwitches) {
      handledSwitches.add(sw.id);
      const wallRun2D = routeAlongRoomWalls2D(subDb.position, sw.position, r, 0.06);
      switchDropPaths3D.push([
        { x: subDb.position.x, y: subDb.kind === 'mdb' ? Number((baseY + 1.8).toFixed(3)) : subDbY, z: subDb.position.y },
        ...wallRun2D.map((p) => ({ x: p.x, y: ceilingVoidY, z: p.y })),
        { x: sw.position.x, y: switchY, z: sw.position.y },
      ]);
    }

    for (const lt of rLights) {
      handledLights.add(lt.id);
      const anchor = rSwitches[0] ?? subDb;
      trunkPaths3D.push([
        { x: anchor.position.x, y: ceilingVoidY, z: anchor.position.y },
        { x: anchor.position.x, y: ceilingVoidY, z: lt.position.y },
        { x: lt.position.x, y: ceilingVoidY, z: lt.position.y },
      ]);
    }
  }

  // Fallback for any manually placed switches/lights outside detected rooms
  for (const sw of switches) {
    if (handledSwitches.has(sw.id)) continue;
    const pts = computeInWallPath2D(core.mdb.position, sw.position, level);
    switchDropPaths3D.push([
      { x: core.mdb.position.x, y: Number((baseY + 1.8).toFixed(3)), z: core.mdb.position.y },
      ...pts.map((p) => ({ x: p.x, y: ceilingVoidY, z: p.y })),
      { x: sw.position.x, y: switchY, z: sw.position.y },
    ]);
  }
  for (const lt of lights) {
    if (handledLights.has(lt.id)) continue;
    const anchor = switches[0] ?? core.mdb;
    trunkPaths3D.push([
      { x: anchor.position.x, y: ceilingVoidY, z: anchor.position.y },
      { x: anchor.position.x, y: ceilingVoidY, z: lt.position.y },
      { x: lt.position.x, y: ceilingVoidY, z: lt.position.y },
    ]);
  }

  return { trunkPaths3D, switchDropPaths3D };
}

/** Computes per-room in-wall power conduit runs from each room's Sub-DB to wall-mounted Duplex Sockets. */
export function computePowerSocketRingRoutes(level: FloorLevel): Point3D[][] {
  const core = getCoreElectricalNodes(level);
  const baseY = level.elevation;
  const highY = Number((baseY + Math.max(2.35, level.floorToFloorHeight - 0.30)).toFixed(3));
  const subDbY = Number((baseY + 1.65).toFixed(3));

  const outlets = level.mepNodes.filter((n) => n.kind === 'outlet_duplex');
  if (outlets.length === 0) return [];

  const runs: Point3D[][] = [];
  const handled = new Set<string>();

  for (const r of level.rooms) {
    const rOutlets = outlets.filter((o) => findRoomForNode(o, level)?.id === r.id);
    if (rOutlets.length === 0) continue;
    const subDb = getRoomSubDb(r, level, core.mdb);
    const dadoY = Number((baseY + (r.category === 'kitchen' ? 1.05 : 0.35)).toFixed(3));
    const b = getRoomBounds(r);
    const sorted = [...rOutlets].sort(
      (a, z) => Math.atan2(a.position.y - b.cy, a.position.x - b.cx) - Math.atan2(z.position.y - b.cy, z.position.x - b.cx)
    );

    const ringPath3D: Point3D[] = [
      { x: subDb.position.x, y: subDb.kind === 'mdb' ? Number((baseY + 1.8).toFixed(3)) : subDbY, z: subDb.position.y },
    ];
    let prev = subDb.position;
    for (const out of sorted) {
      handled.add(out.id);
      const seg = routeAlongRoomWalls2D(prev, out.position, r, 0.06);
      for (const p of seg) {
        ringPath3D.push({ x: p.x, y: highY, z: p.y });
      }
      // Straight vertical concealed wall drop directly inside the socket's wall
      runs.push([
        { x: out.position.x, y: highY, z: out.position.y },
        { x: out.position.x, y: dadoY, z: out.position.y },
      ]);
      prev = out.position;
    }
    runs.push(ringPath3D);
  }

  for (const out of outlets) {
    if (handled.has(out.id)) continue;
    const wallPts = computeInWallPath2D(core.mdb.position, out.position, level);
    runs.push([
      { x: core.mdb.position.x, y: Number((baseY + 1.8).toFixed(3)), z: core.mdb.position.y },
      ...wallPts.map((p) => ({ x: p.x, y: highY, z: p.y })),
      { x: out.position.x, y: Number((baseY + 0.35).toFixed(3)), z: out.position.y },
    ]);
  }
  return runs;
}

/** Pairs every room FCU / water heater with its room Sub-DB along room walls, and FCU <-> outdoor CDU via in-wall chases. */
export function computeHVACConduitRoutes(level: FloorLevel): {
  powerFeedRuns3D: Point3D[][];
  refrigerantRuns3D: Point3D[][];
} {
  const core = getCoreElectricalNodes(level);
  const baseY = level.elevation;
  const soffitY = Number((baseY + Math.max(2.38, level.floorToFloorHeight - 0.26)).toFixed(3));
  const fcuY = Number((baseY + 2.42).toFixed(3));
  const whY = Number((baseY + 1.85).toFixed(3));
  const cduY = Number((baseY + 0.62).toFixed(3));
  const subDbY = Number((baseY + 1.65).toFixed(3));

  const indoorFCUs = level.mepNodes.filter((n) => n.kind === 'ac_split' && n.label !== 'EF');
  const heaters = level.mepNodes.filter((n) => n.kind === 'water_heater');
  const outdoorCDUs = level.mepNodes.filter((n) => n.kind === 'ac_condenser');

  const powerFeedRuns3D: Point3D[][] = [];
  const refrigerantRuns3D: Point3D[][] = [];

  for (const unit of [...indoorFCUs, ...heaters]) {
    const room = findRoomForNode(unit, level);
    const subDb = room ? getRoomSubDb(room, level, core.mdb) : core.mdb;
    const pwrPts = room
      ? routeAlongRoomWalls2D(subDb.position, unit.position, room, 0.06)
      : computeInWallPath2D(subDb.position, unit.position, level);
    const termY = unit.kind === 'water_heater' ? whY : fcuY;
    powerFeedRuns3D.push([
      { x: subDb.position.x, y: subDb.kind === 'mdb' ? Number((baseY + 1.8).toFixed(3)) : subDbY, z: subDb.position.y },
      ...pwrPts.map((p) => ({ x: p.x, y: soffitY, z: p.y })),
      { x: unit.position.x, y: termY, z: unit.position.y },
    ]);

    if (unit.kind === 'ac_split' && outdoorCDUs.length > 0) {
      let nearestCdu = outdoorCDUs[0];
      let minDist = Infinity;
      for (const cdu of outdoorCDUs) {
        const d = Math.hypot(cdu.position.x - unit.position.x, cdu.position.y - unit.position.y);
        if (d < minDist) {
          minDist = d;
          nearestCdu = cdu;
        }
      }
      const refPts = computeInWallPath2D(unit.position, nearestCdu.position, level);
      refrigerantRuns3D.push([
        { x: unit.position.x, y: fcuY, z: unit.position.y },
        ...refPts.map((p) => ({ x: p.x, y: Number((soffitY - 0.05).toFixed(3)), z: p.y })),
        { x: nearestCdu.position.x, y: cduY, z: nearestCdu.position.y },
      ]);
    }
  }

  return { powerFeedRuns3D, refrigerantRuns3D };
}

/** Moves a core MEP node (or any MEP node by id/kind) and re-routes all connected feeders & circuits cleanly. */
export function relocateMEPNode(
  level: FloorLevel,
  nodeIdOrKind: string,
  rawPos: Point2D,
  pvOrigin?: Point2D
): void {
  const newPos: Point2D = {
    x: Number(rawPos.x.toFixed(2)),
    y: Number(rawPos.y.toFixed(2)),
  };

  let target = level.mepNodes.find((n) => n.id === nodeIdOrKind || n.kind === nodeIdOrKind);
  if (!target && (nodeIdOrKind === 'mdb' || nodeIdOrKind === 'utility_meter' || nodeIdOrKind === 'solar_inv' || nodeIdOrKind === 'solar_bess')) {
    const labelMap: Record<string, string> = {
      mdb: `MDB-${level.index + 1}`,
      utility_meter: 'KWH-MTR',
      solar_inv: 'HYB-INV',
      solar_bess: 'BESS',
    };
    target = {
      id: uid('mep'),
      kind: nodeIdOrKind as MEPNode['kind'],
      system: 'electrical',
      position: newPos,
      circuitId: nodeIdOrKind === 'utility_meter' ? 'GRID-IN' : nodeIdOrKind === 'mdb' ? undefined : 'PV-DC1',
      label: labelMap[nodeIdOrKind],
    };
    level.mepNodes.push(target);
  }
  if (!target) return;

  const oldPos = { ...target.position };
  target.position = newPos;

  const core = getCoreElectricalNodes(level);
  const ptDist = (a: Point2D, b: Point2D) => Math.hypot(a.x - b.x, a.y - b.y);
  for (const ckt of level.mepCircuits) {
    if (ckt.system === 'electrical_submain') {
      const subDb = level.mepNodes.find((n) => n.kind === 'sub_db' && n.circuitId === ckt.id);
      if (subDb) {
        ckt.points = computeInWallPath2D(core.mdb.position, subDb.position, level);
      }
      continue;
    }
    ckt.points = ckt.points.map((pt) => (ptDist(pt, oldPos) < 0.25 ? { ...newPos } : pt));
    if (target.kind === 'mdb' && (ckt.system === 'electrical_light' || ckt.system === 'electrical_power' || ckt.system === 'electrical_hvac')) {
      if (ckt.points.length > 0 && ptDist(ckt.points[0], oldPos) < 0.5) ckt.points[0] = { ...newPos };
    }
  }

  // Sync Utility Grid Intake -> Meter -> MDB feeder circuit (wall-hugging orthogonal)
  const gridIdx = level.mepCircuits.findIndex((c) => c.system === 'electrical_grid' || c.id === 'GRID-IN');
  const gridEntryPt = { x: Number((core.meter.position.x - 0.95).toFixed(2)), y: core.meter.position.y };
  const meterToMdbPts = computeWallHuggingPath2D(core.meter.position, core.mdb.position, level, 'auto');
  const gridPts = [gridEntryPt, ...meterToMdbPts];
  if (gridIdx >= 0) {
    level.mepCircuits[gridIdx].points = gridPts;
  } else {
    level.mepCircuits.unshift({
      id: 'GRID-IN',
      name: 'Utility Grid Intake → kWh Meter → MDB',
      system: 'electrical_grid',
      points: gridPts,
      spec: '4×16mm² CU/XLPE/SWA Armored + 16mm² Earth',
    });
  }

  // Sync PV String -> Inverter -> BESS -> MDB circuit (wall-hugging orthogonal)
  const pvIdx = level.mepCircuits.findIndex((c) => c.system === 'electrical_pv' || c.id === 'PV-DC1');
  if (pvIdx >= 0) {
    const pvStart = pvOrigin ?? core.pvAnchor?.position ?? level.mepCircuits[pvIdx].points[0] ?? core.inverter.position;
    const dcSeg = computeWallHuggingPath2D(pvStart, core.inverter.position, level, 'auto');
    const acSeg = computeWallHuggingPath2D(core.inverter.position, core.mdb.position, level, 'auto');
    level.mepCircuits[pvIdx].points = [
      ...dcSeg,
      { ...core.bess.position },
      ...acSeg.slice(1),
    ];
  }
}

export interface PlumbingRiserReport {
  occupancyCount: number;
  dailyWaterDemandLiters: number;
  /** Mains pressure direct, or a ground tank with a pressure pump set (no overhead tanks). */
  supplyMode: WaterSupplyMode;
  /** Ground storage tank (L); 0 on mains pressure. */
  storageTankLiters: number;
  /** Pressure pump set; 0 on mains pressure. */
  pumpKW: number;
  pumpFlowLpm: number;
  pumpHeadMeters: number;
  pressureVesselLiters: number;
  /** Working pressure at the highest outlet (bar). */
  outletPressureBar: number;
  totalDFU: number;
  supplyMainPipe: string;
  soilStackPipe: string;
  wasteStackPipe: string;
  totalWSFU: number;
  peakFlowLps: number;
  designVelocityMps: number;
  roofCatchmentM2: number;
  rainfallIntensityMmh: number;
  stormwaterRunoffLps: number;
  rainwaterDownpipesCount: number;
  rainwaterPipeSpec: string;
  rainwaterTankSpec: string;
  gutterEnabled: boolean;
  gutterSpec: string;
  waterCollectionMode: WaterCollectionMode;
  harvestingTankLiters: number;
  firstFlushDiverter: boolean;
  inspectionChambers: { id: string; sizeMm: string; invertLevelM: number; location: string }[];
  fixtureSummary: { label: string; count: number; dfuEach: number; totalDfu: number }[];
}

export function computeHVACReport(project: BuildingProject): HVACEngineeringReport {
  const hvac = getHVACConfig(project);
  const climateTable: Record<
    typeof hvac.climateZone,
    { label: string; sensiblePerM2: number; latentMult: number; shr: number; outdoor: string }
  > = {
    maldives_tropical: {
      label: 'Maldives Equatorial Tropical (MNBC / ASHRAE 55)',
      sensiblePerM2: 118,
      latentMult: 1.38,
      shr: 0.72,
      outdoor: `${hvac.designOutdoorTempC}°C DB / 28°C WB (${hvac.designHumidityPct}% RH)`,
    },
    arid_desert: {
      label: 'Hot Arid Desert (ASHRAE Zone 1B)',
      sensiblePerM2: 145,
      latentMult: 1.08,
      shr: 0.88,
      outdoor: `43°C DB / 22% RH`,
    },
    mediterranean: {
      label: 'Mediterranean Coastal (ASHRAE Zone 3A)',
      sensiblePerM2: 105,
      latentMult: 1.18,
      shr: 0.82,
      outdoor: `32°C DB / 55% RH`,
    },
    temperate: {
      label: 'Temperate Continental (ASHRAE Zone 4A)',
      sensiblePerM2: 92,
      latentMult: 1.15,
      shr: 0.84,
      outdoor: `${hvac.designOutdoorTempC}°C DB / ${hvac.designHumidityPct}% RH`,
    },
  };

  const cli = climateTable[hvac.climateZone] ?? climateTable.temperate;
  const seerCop =
    hvac.refrigerant === 'R32'
      ? hvac.systemType === 'vrf_multi_split'
        ? 4.15
        : 3.65
      : 3.25;

  const cinderCount = project.levels
    .flatMap((l) => l.walls)
    .filter((w) => w.material === 'cinder_block' || w.material === 'coral_stone').length;
  const totalWalls = project.levels.flatMap((l) => l.walls).length || 1;
  const envelopeFactor = cinderCount / totalWalls >= 0.4 ? 0.94 : 1.0;

  const standardRatingsBtu = [9000, 12000, 18000, 24000, 36000];
  const rows: HVACRoomLoadRow[] = [];
  let unitCounter = 1;

  project.levels.forEach((lvl, lvlIdx) => {
    const isTopFloor = lvlIdx === project.levels.length - 1;
    const roofMult = !isTopFloor
      ? 0.92
      : project.roof.material === 'thatch_palm' || project.roof.material === 'green_roof'
      ? 1.02
      : project.roof.material === 'marine_metal'
      ? 1.08
      : 1.14;

    lvl.rooms.forEach((rm, rIdx) => {
      if (rm.category !== 'living' && rm.category !== 'dining' && rm.category !== 'kitchen' && rm.category !== 'bedroom' && rm.category !== 'office') {
        return;
      }
      const areaM2 = Math.max(6, Number(polygonArea(rm.polygon).toFixed(1)));
      const volumeM3 = Number((areaM2 * rm.ceilingHeight).toFixed(1));
      const catMult = rm.category === 'kitchen' ? 1.25 : rm.category === 'living' ? 1.12 : 1.0;
      const sensibleWatts = Math.round(areaM2 * cli.sensiblePerM2 * roofMult * envelopeFactor * catMult);
      const totalCoolingWatts = Math.round(sensibleWatts * cli.latentMult);
      const latentWatts = Math.max(0, totalCoolingWatts - sensibleWatts);

      const reqBtu = totalCoolingWatts * 3.41214;
      let selectedBtu = standardRatingsBtu.find((b) => b >= reqBtu) ?? 36000;
      let unitCount = 1;
      if (reqBtu > 36000) {
        unitCount = Math.ceil(reqBtu / 24000);
        selectedBtu = 24000;
      }
      const totalUnitBtu = selectedBtu * unitCount;
      const selectedKWth = Number((totalUnitBtu / 3412.14).toFixed(2));
      const electricalInputWatts = Math.round((selectedKWth * 1000) / seerCop);

      const refrigerantPipeSpec =
        selectedBtu <= 12000
          ? 'Ø6.35/9.52mm Cu + 19mm EPDM'
          : selectedBtu <= 24000
          ? 'Ø6.35/12.7mm Cu + 19mm EPDM'
          : 'Ø9.52/15.88mm Cu + 19mm EPDM';

      rows.push({
        roomId: rm.id,
        roomCode: `RM-${lvl.index + 1}${String(rIdx + 1).padStart(2, '0')}`,
        roomName: rm.name,
        levelName: lvl.name,
        category: rm.category,
        areaM2,
        volumeM3,
        sensibleWatts,
        latentWatts,
        totalCoolingWatts,
        selectedBtu: totalUnitBtu,
        selectedKWth,
        unitCount,
        unitTag: `FCU-${lvl.index + 1}.${unitCounter++}`,
        electricalInputWatts,
        refrigerantPipeSpec,
        condensatePipeSpec: 'Ø25mm uPVC Drain @ 1:100',
        airflowCfm: Math.round((totalUnitBtu / 12000) * 380),
        hasCeilingFan:
          hvac.ceilingFansEnabled && (rm.category === 'living' || rm.category === 'bedroom' || rm.category === 'dining'),
      });
    });
  });

  const totalCoolingBtu = hvac.enabled ? rows.reduce((s, r) => s + r.selectedBtu, 0) : 0;
  const totalCoolingKWth = Number((totalCoolingBtu / 3412.14).toFixed(2));
  const totalCoolingTons = Number((totalCoolingBtu / 12000).toFixed(2));
  const totalElectricalKW = hvac.enabled
    ? Number((rows.reduce((s, r) => s + r.electricalInputWatts, 0) / 1000).toFixed(2))
    : 0;
  const condenserUnitsCount = !hvac.enabled
    ? 0
    : hvac.systemType === 'vrf_multi_split' || hvac.systemType === 'ducted_central'
    ? Math.max(1, project.levels.length)
    : Math.max(1, Math.ceil(rows.length / 2));

  const coatingMap: Record<typeof hvac.condenserProtection, string> = {
    marine_blue_fin: 'Marine Blue-Fin Anti-Corrosion (1000h Salt Spray)',
    epoxy_gold_fin: 'Hydrophilic Epoxy Gold-Fin Coating',
    standard: 'Standard Factory Aluminum Fin',
  };

  return {
    climateLabel: cli.label,
    outdoorSpec: cli.outdoor,
    indoorSpec: `${hvac.designIndoorTempC}°C DB / 55% RH`,
    totalCoolingKWth,
    totalCoolingBtu,
    totalCoolingTons,
    totalElectricalKW,
    seerCop,
    sensibleHeatRatio: cli.shr,
    condenserUnitsCount,
    refrigerantSpec: `${hvac.refrigerant} Low-GWP Inverter (Class-O 19mm Insulation)`,
    condenserCoatingSpec: coatingMap[hvac.condenserProtection],
    ventilationSpec: hvac.freshAirERV
      ? 'ASHRAE 62.2 Exhaust + ERV Fresh Air + BLDC Fans'
      : 'ASHRAE 62.2 Bath/Kitchen Exhaust + Natural Cross-Vent',
    rows: hvac.enabled ? rows : [],
  };
}

export function autoPopulateMEPForLevel(
  level: FloorLevel,
  solarEnabled = true,
  hvacEnabled = true,
  ceilingFansEnabled = false,
  /** Which rooms get a split AC (default: every habitable room). */
  acRoom?: (room: Room) => boolean
): FloorLevel {
  const bb = levelBoundingBox(level);
  const preserveNode = (kind: MEPNode['kind'], fallback: Point2D, anywhere = false): { id: string; pos: Point2D } => {
    const prev = level.mepNodes.find((n) => n.kind === kind);
    if (prev && anywhere) return { id: prev.id, pos: { x: Number(prev.position.x.toFixed(2)), y: Number(prev.position.y.toFixed(2)) } };
    if (
      prev &&
      prev.position.x >= bb.minX - 2.5 &&
      prev.position.x <= bb.maxX + 2.5 &&
      prev.position.y >= bb.minY - 2.5 &&
      prev.position.y <= bb.maxY + 2.5
    ) {
      return {
        id: prev.id,
        pos: { x: Number(prev.position.x.toFixed(2)), y: Number(prev.position.y.toFixed(2)) },
      };
    }
    return { id: uid('mep'), pos: fallback };
  };

  const oppSide: Record<WallSide, WallSide> = {
    north: 'south',
    south: 'north',
    west: 'east',
    east: 'west',
  };
  const adjSides: Record<WallSide, [WallSide, WallSide]> = {
    north: ['west', 'east'],
    south: ['west', 'east'],
    west: ['north', 'south'],
    east: ['north', 'south'],
  };

  // Default MDB flush on Foyer / Entrance interior wall (or West perimeter utility wall)
  const hallRoom = level.rooms.find(
    (r) => r.category === 'hallway' || /foyer|entrance|entry|lobby|vestibule|hall|gallery/i.test(r.name)
  );
  let defaultMdbPos: Point2D = {
    x: Number((bb.minX + 0.10).toFixed(2)),
    y: Number((bb.minY + 0.85).toFixed(2)),
  };
  let defaultMdbSide: WallSide = 'west';
  if (hallRoom) {
    const hb = getRoomBounds(hallRoom);
    const { sideIsInterior } = findRoomWallOpenings(hallRoom, level);
    const hallSides: WallSide[] = ['west', 'east', 'north', 'south'];
    defaultMdbSide = hallSides.find((s) => sideIsInterior[s]) ?? 'west';
    const pref = defaultMdbSide === 'north' || defaultMdbSide === 'south' ? hb.minX + 0.8 : hb.minY + 0.7;
    defaultMdbPos = pickClearRoomWallSpot(hallRoom, level, defaultMdbSide, pref, 0.08);
  }

  const mdbSaved = preserveNode('mdb', defaultMdbPos);
  const mdbPos: Point2D = mdbSaved.pos;
  // The meter may stand away from the house (on the boundary wall at the gate).
  const meterSaved = preserveNode(
    'utility_meter',
    {
      x: Number((bb.minX - 0.12).toFixed(2)),
      y: Number((bb.minY + 1.35).toFixed(2)),
    },
    true
  );
  const meterPos: Point2D = meterSaved.pos;
  const waterMainPos: Point2D = {
    x: Number((bb.minX + 0.4).toFixed(2)),
    y: Number((bb.maxY - 0.6).toFixed(2)),
  };

  const nodes: MEPNode[] = [
    {
      id: mdbSaved.id,
      kind: 'mdb',
      system: 'electrical',
      position: mdbPos,
      label: `MDB-${level.index + 1}`,
      wallSide: defaultMdbSide,
    },
    ...(level.index === 0
      ? [
          {
            id: meterSaved.id,
            kind: 'utility_meter' as const,
            system: 'electrical' as const,
            position: meterPos,
            circuitId: 'GRID-IN',
            label: 'KWH-MTR',
          },
        ]
      : []),
    {
      id: uid('mep'),
      kind: 'water_main',
      system: 'plumbing',
      position: waterMainPos,
      label: 'WM-IN',
    },
  ];

  const subMainCircuits: MEPCircuit[] = [];
  const roomBranchCircuits: MEPCircuit[] = [];
  const splitPositions: Point2D[] = [];
  const coldPts: Point2D[] = [waterMainPos];
  const drainPts: Point2D[] = [];

  level.rooms.forEach((r, rIdx) => {
    const c = polygonCentroid(r.polygon);
    const rb = getRoomBounds(r);
    const rArea = Math.max(6, polygonArea(r.polygon));
    const roomCode = `${level.index + 1}${String(rIdx + 1).padStart(2, '0')}`;
    const subDbLabel = `DB-${roomCode}`;
    const placedInRoom: Point2D[] = [];
    if (hallRoom && hallRoom.id === r.id) {
      placedInRoom.push(mdbPos);
    }

    const { entrySide, doorCoord, doorHalfW, sideIsInterior } = findRoomEntryWallAndDoor(r, level);

    // 1. Room Sub-Distribution Board (Sub-DB) flush on interior wall near room entry
    const subDbSide: WallSide = sideIsInterior[entrySide]
      ? entrySide
      : adjSides[entrySide].find((s) => sideIsInterior[s]) ?? oppSide[entrySide];
    const subDbPref =
      subDbSide === entrySide
        ? doorCoord - (doorHalfW + 0.52)
        : subDbSide === 'north' || subDbSide === 'south'
        ? rb.minX + 0.75
        : rb.minY + 0.75;

    const existingSubDb = level.mepNodes.find(
      (n) =>
        n.kind === 'sub_db' &&
        (n.roomId === r.id || n.label === subDbLabel) &&
        n.position.x >= rb.minX - 0.3 &&
        n.position.x <= rb.maxX + 0.3 &&
        n.position.y >= rb.minY - 0.3 &&
        n.position.y <= rb.maxY + 0.3
    );
    const subDbPos = existingSubDb
      ? { x: Number(existingSubDb.position.x.toFixed(2)), y: Number(existingSubDb.position.y.toFixed(2)) }
      : pickClearRoomWallSpot(r, level, subDbSide, subDbPref, 0.08, placedInRoom);
    const subDbWallSide = existingSubDb?.wallSide ?? subDbSide;
    placedInRoom.push(subDbPos);

    nodes.push({
      id: existingSubDb?.id ?? uid('mep'),
      kind: 'sub_db',
      system: 'electrical',
      position: subDbPos,
      circuitId: `SM-${roomCode}`,
      label: subDbLabel,
      roomId: r.id,
      wallSide: subDbWallSide,
    });

    subMainCircuits.push({
      id: `SM-${roomCode}`,
      name: `Sub-Main Feeder MDB → ${subDbLabel} (${r.name})`,
      system: 'electrical_submain',
      points: computeInWallPath2D(mdbPos, subDbPos, level),
      spec: '3×4.0mm² CU/XLPE/LSZH in 25mm Concealed Wall Conduit',
    });

    // 2. Wall Switch mounted strictly on entry wall latch side
    const swPos = pickClearRoomWallSpot(
      r,
      level,
      entrySide,
      doorCoord + (doorHalfW + 0.22),
      0.08,
      placedInRoom
    );
    placedInRoom.push(swPos);
    nodes.push({
      id: uid('mep'),
      kind: 'switch_1g',
      system: 'electrical',
      position: swPos,
      circuitId: `L-${roomCode}`,
      wattage: 0,
      roomId: r.id,
      wallSide: entrySide,
    });

    // 3. Ceiling Luminaire & Room Lighting Circuit (Sub-DB -> Switch along walls -> Ceiling Light)
    const lightPos = { x: Number(c.x.toFixed(2)), y: Number(c.y.toFixed(2)) };
    nodes.push({
      id: uid('mep'),
      kind: 'light_ceiling',
      system: 'electrical',
      position: lightPos,
      circuitId: `L-${roomCode}`,
      wattage: r.category === 'living' || r.category === 'kitchen' ? 36 : 18,
      label: 'LED',
      roomId: r.id,
    });
    roomBranchCircuits.push({
      id: `L-${roomCode}`,
      name: `${r.name} Lighting Circuit`,
      system: 'electrical_light',
      points: [...routeAlongRoomWalls2D(subDbPos, swPos, r, 0.06), lightPos],
      spec: '2×1.5mm² + 1.5mm²E CU/PVC in 20mm Conduit',
    });

    // 4. Wall-Mounted Duplex Socket Outlets + In-Wall Power Circuit
    if (r.category !== 'porch' && r.category !== 'balcony') {
      const twoSockets = r.category !== 'hallway' && r.category !== 'bathroom';
      const side1 =
        r.category === 'hallway' || r.category === 'bathroom'
          ? adjSides[entrySide].find((s) => sideIsInterior[s]) ?? adjSides[entrySide][0]
          : oppSide[entrySide];
      const pref1 = side1 === 'north' || side1 === 'south' ? rb.cx : rb.cy;
      const out1Pos = pickClearRoomWallSpot(r, level, side1, pref1, 0.08, placedInRoom);
      placedInRoom.push(out1Pos);

      const outletSpecs: Array<{ pos: Point2D; side: WallSide }> = [{ pos: out1Pos, side: side1 }];
      if (twoSockets) {
        const side2 = adjSides[entrySide][0];
        const pref2 = side2 === 'north' || side2 === 'south' ? rb.cx : rb.cy;
        const out2Pos = pickClearRoomWallSpot(r, level, side2, pref2, 0.08, placedInRoom);
        placedInRoom.push(out2Pos);
        outletSpecs.push({ pos: out2Pos, side: side2 });
      }

      const wattPerOutlet = r.category === 'kitchen' ? 1100 : twoSockets ? 220 : 350;
      const pwrPts: Point2D[] = [];
      let prevP = subDbPos;
      for (const o of outletSpecs) {
        nodes.push({
          id: uid('mep'),
          kind: 'outlet_duplex',
          system: 'electrical',
          position: o.pos,
          circuitId: r.category === 'kitchen' ? `K-${roomCode}` : `P-${roomCode}`,
          wattage: wattPerOutlet,
          roomId: r.id,
          wallSide: o.side,
        });
        const seg = routeAlongRoomWalls2D(prevP, o.pos, r, 0.06);
        pwrPts.push(...(pwrPts.length === 0 ? seg : seg.slice(1)));
        prevP = o.pos;
      }

      roomBranchCircuits.push({
        id: r.category === 'kitchen' ? `K-${roomCode}` : `P-${roomCode}`,
        name: `${r.name} Power Sockets`,
        system: 'electrical_power',
        points: pwrPts,
        spec: '2×2.5mm² + 2.5mm²E CU/PVC in 25mm Wall Conduit',
      });
    }

    // 5. Tropical Ceiling Fan for Living, Bedroom, Dining, Porch
    if (
      ceilingFansEnabled &&
      (r.category === 'living' || r.category === 'bedroom' || r.category === 'dining' || r.category === 'porch')
    ) {
      nodes.push({
        id: uid('mep'),
        kind: 'ceiling_fan',
        system: 'electrical',
        position: { x: Number((c.x + 0.35).toFixed(2)), y: Number((c.y + 0.25).toFixed(2)) },
        circuitId: `L-${roomCode}`,
        wattage: 45,
        label: 'CF',
        roomId: r.id,
      });
    }

    // 6. Inverter Split AC mounted flush on exterior/high wall for conditioned habitable rooms
    const roomHvacPts: Point2D[] = [];
    if (
      hvacEnabled &&
      (acRoom
        ? acRoom(r)
        : r.category === 'living' || r.category === 'dining' || r.category === 'kitchen' || r.category === 'bedroom' || r.category === 'office')
    ) {
      const btuK = rArea > 26 ? 24 : rArea > 18 ? 18 : rArea > 12 ? 12 : 9;
      const acW = Math.round((btuK / 3.412) * 280);
      const acSide: WallSide =
        (['north', 'south', 'east', 'west'] as WallSide[]).find((s) => !sideIsInterior[s] && s !== entrySide) ??
        oppSide[entrySide];
      const acPref = acSide === 'north' || acSide === 'south' ? rb.cx : rb.cy;
      const acPos = pickClearRoomWallSpot(r, level, acSide, acPref, 0.10, placedInRoom);
      placedInRoom.push(acPos);
      nodes.push({
        id: uid('mep'),
        kind: 'ac_split',
        system: 'electrical',
        position: acPos,
        circuitId: `AC-${roomCode}`,
        wattage: acW,
        label: `AC ${btuK}k`,
        roomId: r.id,
        wallSide: acSide,
      });
      splitPositions.push(acPos);
      roomHvacPts.push(...routeAlongRoomWalls2D(subDbPos, acPos, r, 0.06));
    }

    // 7. Smoke detectors per NFPA 72 (Living, Hallway, Bedrooms, Kitchen)
    if (r.category === 'living' || r.category === 'hallway' || r.category === 'bedroom' || r.category === 'kitchen') {
      nodes.push({
        id: uid('mep'),
        kind: 'light_ceiling',
        system: 'electrical',
        position: { x: Number((c.x - 0.5).toFixed(2)), y: Number((c.y - 0.5).toFixed(2)) },
        circuitId: `L-${roomCode}`,
        wattage: 2,
        label: 'SD',
        roomId: r.id,
      });
    }

    // 8. Plumbing fixtures, wall Water Heater & ASHRAE 62.2 Exhaust Fan for bathroom / kitchen / utility
    if (r.category === 'bathroom') {
      const wcPos = { x: Number((c.x - 0.5).toFixed(2)), y: Number((c.y - 0.4).toFixed(2)) };
      const basinPos = { x: Number((c.x + 0.5).toFixed(2)), y: Number((c.y - 0.4).toFixed(2)) };
      const showerPos = { x: Number((c.x + 0.5).toFixed(2)), y: Number((c.y + 0.5).toFixed(2)) };
      const whSide: WallSide = adjSides[entrySide][1];
      const whPref = whSide === 'north' || whSide === 'south' ? rb.cx : rb.cy;
      const whPos = pickClearRoomWallSpot(r, level, whSide, whPref, 0.10, placedInRoom);
      placedInRoom.push(whPos);

      nodes.push(
        { id: uid('mep'), kind: 'plumb_wc', system: 'plumbing', position: wcPos, dfu: 4, label: 'WC', roomId: r.id },
        { id: uid('mep'), kind: 'plumb_basin', system: 'plumbing', position: basinPos, dfu: 1, label: 'WHB', roomId: r.id },
        { id: uid('mep'), kind: 'plumb_shower', system: 'plumbing', position: showerPos, dfu: 2, label: 'SH', roomId: r.id },
        {
          id: uid('mep'),
          kind: 'water_heater',
          system: 'electrical',
          position: whPos,
          wattage: 2000,
          circuitId: `WH-${roomCode}`,
          label: 'WH',
          roomId: r.id,
          wallSide: whSide,
        },
        {
          id: uid('mep'),
          kind: 'ac_split',
          system: 'electrical',
          position: { x: Number(c.x.toFixed(2)), y: Number((c.y + 0.5).toFixed(2)) },
          wattage: 35,
          circuitId: `L-${roomCode}`,
          label: 'EF',
          roomId: r.id,
        }
      );
      roomHvacPts.push(...routeAlongRoomWalls2D(subDbPos, whPos, r, 0.06));
      coldPts.push(wcPos, basinPos, showerPos);
      drainPts.push(wcPos, basinPos, showerPos);
    } else if (r.category === 'kitchen' || r.category === 'utility') {
      const sinkPos = { x: Number((c.x + 0.6).toFixed(2)), y: Number((c.y - 0.5).toFixed(2)) };
      nodes.push(
        { id: uid('mep'), kind: 'plumb_sink', system: 'plumbing', position: sinkPos, dfu: 2, label: 'KS', roomId: r.id },
        {
          id: uid('mep'),
          kind: 'ac_split',
          system: 'electrical',
          position: { x: Number((c.x - 0.6).toFixed(2)), y: Number((c.y - 0.6).toFixed(2)) },
          wattage: 65,
          circuitId: `L-${roomCode}`,
          label: 'EF',
          roomId: r.id,
        }
      );
      coldPts.push(sinkPos);
      drainPts.push(sinkPos);
    }

    if (roomHvacPts.length >= 2) {
      roomBranchCircuits.push({
        id: `AC-${roomCode}`,
        name: `${r.name} AC / Dedicated Feed`,
        system: 'electrical_hvac',
        points: roomHvacPts,
        spec: '2×4.0mm² + 4.0mm²E CU/XLPE Wall Conduit',
      });
    }
  });

  // Outdoor Condenser Units (CDU) — stacked vertically at one clear location on the East exterior wall,
  // mounted parallel to the wall on L-brackets with a 10-inch (0.254 m) wall gap.
  const cduPositions: Point2D[] = [];
  if (hvacEnabled && splitPositions.length > 0 && level.walls.length > 0) {
    const AC_WALL_GAP_M = 0.254; // 10 inches
    const AC_UNIT_W = 0.8;
    const AC_UNIT_D = Number((0.3 + AC_WALL_GAP_M).toFixed(3)); // 0.554 m (0.30 m unit + 0.254 m gap)
    const AC_UNIT_H = 0.96;

    const eastVertWalls = level.walls.filter(
      (w) => w.isExterior && Math.abs(w.start.x - w.end.x) < 0.08
    );
    const eastMaxX = eastVertWalls.length
      ? Math.max(...eastVertWalls.map((w) => (w.start.x + w.end.x) / 2))
      : bb.maxX;
    const eastFaceWalls = eastVertWalls.filter(
      (w) => Math.abs((w.start.x + w.end.x) / 2 - eastMaxX) < 0.15
    );
    const eastThick = eastFaceWalls[0]?.thickness ?? 0.23;
    const eastOuterX = eastMaxX + eastThick / 2;

    // Pick one solid stretch on the East wall clear of windows/doors (needs >= 0.85 m along Y)
    const blockedSpans: [number, number][] = [];
    for (const w of eastFaceWalls) {
      const yMin = Math.min(w.start.y, w.end.y);
      const yMax = Math.max(w.start.y, w.end.y);
      const wLen = yMax - yMin;
      for (const o of level.openings) {
        if (o.wallId !== w.id) continue;
        const cy = w.start.y + (w.end.y - w.start.y) * o.offset;
        const half = o.width / 2 + 0.12;
        if (wLen > 0) blockedSpans.push([cy - half, cy + half]);
      }
    }
    const wallYMin = eastFaceWalls.length
      ? Math.min(...eastFaceWalls.map((w) => Math.min(w.start.y, w.end.y)))
      : bb.minY;
    const wallYMax = eastFaceWalls.length
      ? Math.max(...eastFaceWalls.map((w) => Math.max(w.start.y, w.end.y)))
      : bb.maxY;
    const halfW = AC_UNIT_W / 2 + 0.08;
    const preferredY = wallYMin + Math.min(2.6, (wallYMax - wallYMin) * 0.45);
    let stackY = preferredY;
    let bestDist = Infinity;
    for (let y = wallYMin + halfW; y <= wallYMax - halfW + 1e-6; y += 0.1) {
      const clear = blockedSpans.every(([a, b]) => y + halfW <= a || y - halfW >= b);
      if (clear) {
        const d = Math.abs(y - preferredY);
        if (d < bestDist) {
          bestDist = d;
          stackY = y;
        }
      }
    }

    const cduCount = splitPositions.length >= 3 ? 2 : 1;
    const cduPos: Point2D = {
      x: Number((eastOuterX + AC_UNIT_D / 2).toFixed(3)),
      y: Number(stackY.toFixed(2)),
    };
    for (let idx = 0; idx < cduCount; idx++) {
      cduPositions.push(cduPos);
      nodes.push({
        id: uid('mep'),
        kind: 'ac_condenser',
        model: 'ac_condenser_wall',
        system: 'electrical',
        position: { ...cduPos },
        rotation: 270,
        wallSide: 'east',
        elevation: Number((0.45 + idx * 1.05).toFixed(2)),
        size: { w: AC_UNIT_W, d: AC_UNIT_D, h: AC_UNIT_H },
        circuitId: `AC${level.index + 1}`,
        wattage: 0,
        label: `CDU-${level.index + 1}${String.fromCharCode(65 + idx)}`,
      });
    }
  }

  const circuits: MEPCircuit[] = [
    ...(level.index === 0
      ? [
          {
            id: 'GRID-IN',
            name: 'Utility Grid Intake → kWh Meter → MDB',
            system: 'electrical_grid' as const,
            points: [
              { x: Number((meterPos.x - 0.95).toFixed(2)), y: meterPos.y },
              ...computeWallHuggingPath2D(meterPos, mdbPos, level, 'auto'),
            ],
            spec: '4×16mm² CU/XLPE/SWA Armored + 16mm² Earth',
          },
        ]
      : []),
    ...subMainCircuits,
    ...roomBranchCircuits,
  ];
  if (splitPositions.length > 0 && cduPositions.length > 0) {
    circuits.push({
      id: `REF${level.index + 1}`,
      name: `Refrigerant Twin Copper Lines`,
      system: 'hvac_refrigerant',
      points: [cduPositions[0], ...splitPositions],
      spec: 'Ø6.35/12.7mm R32 Copper + 19mm Class-O EPDM',
    });
    const drainTarget = drainPts[0] ?? { x: bb.maxX + 0.25, y: bb.maxY + 0.25 };
    circuits.push({
      id: `CND${level.index + 1}`,
      name: `AC Condensate uPVC Drain`,
      system: 'hvac_condensate',
      points: [...splitPositions, drainTarget],
      spec: 'Ø25mm uPVC Insulated Drain @ 1:100',
    });
  }
  if (coldPts.length > 1) {
    circuits.push({
      id: `CW${level.index + 1}`,
      name: `Cold Water Supply Header`,
      system: 'plumbing_cold',
      points: coldPts,
      spec: 'Ø25mm PN20 PPR Insulated Pipe',
    });
  }
  if (drainPts.length > 0) {
    circuits.push({
      id: `DR${level.index + 1}`,
      name: `Soil & Waste Drainage Stack`,
      system: 'plumbing_drain',
      points: drainPts,
      spec: 'Ø110mm uPVC Soil / Ø50mm Waste @ 1:60 Slope',
    });
  }

  if (solarEnabled && level.index === 0) {
    const pvArrPos: Point2D = {
      x: Number(Math.max(bb.minX + 3.0, bb.maxX - 1.4).toFixed(2)),
      y: Number((bb.minY + 1.2).toFixed(2)),
    };
    const invSaved = preserveNode('solar_inv', {
      x: Number((bb.minX - 0.12).toFixed(2)),
      y: Number((bb.minY + 2.35).toFixed(2)),
    });
    const invPos: Point2D = invSaved.pos;
    const bessSaved = preserveNode('solar_bess', {
      x: Number((bb.minX - 0.12).toFixed(2)),
      y: Number((bb.minY + 3.15).toFixed(2)),
    });
    const bessPos: Point2D = bessSaved.pos;
    nodes.push(
      { id: uid('mep'), kind: 'solar_pv', system: 'electrical', position: pvArrPos, circuitId: 'PV-DC1', wattage: 5400, label: 'PV-ARRAY' },
      { id: invSaved.id, kind: 'solar_inv', system: 'electrical', position: invPos, circuitId: 'PV-DC1', wattage: 0, label: 'HYB-INV' },
      { id: bessSaved.id, kind: 'solar_bess', system: 'electrical', position: bessPos, circuitId: 'PV-DC1', wattage: 0, label: 'BESS' }
    );
    circuits.push({
      id: 'PV-DC1',
      name: 'Solar PV DC String & AC Coupled Feed',
      system: 'electrical_pv',
      points: [
        ...computeWallHuggingPath2D(pvArrPos, invPos, level, 'auto'),
        bessPos,
        ...computeWallHuggingPath2D(invPos, mdbPos, level, 'auto').slice(1),
      ],
      spec: '2×6.0mm² EN 50618 H1Z2Z2-K 1.5kV DC + 3×6.0mm² AC',
    });
  }

  return {
    ...level,
    mepNodes: nodes,
    mepCircuits: circuits,
  };
}

export function computeElectricalSLD(project: BuildingProject): ElectricalSLDReport {
  const activeLevels = project.levels.filter((l) => !l.decorative);
  const scopeLvls = activeLevels.length ? activeLevels : project.levels;
  const allNodes = scopeLvls.flatMap((l) => l.mepNodes);
  const lights = allNodes.filter((n) => n.kind === 'light_ceiling');
  const outlets = allNodes.filter((n) => n.kind === 'outlet_duplex');
  const acs = allNodes.filter((n) => n.kind === 'ac_split' && n.label !== 'EF');
  const heaters = allNodes.filter((n) => n.kind === 'water_heater');
  const hvacCfg = getHVACConfig(project);
  const hvacReport = computeHVACReport(project);

  const lightWatts = lights.reduce((s, n) => s + (n.wattage ?? 24), 0) || 400;
  const powerWatts = outlets.reduce((s, n) => s + (n.wattage ?? 350), 0) || 2400;
  const kitchenApplianceWatts = 3200;
  const acWatts = hvacCfg.enabled
    ? Math.round(hvacReport.totalElectricalKW * 1000) || acs.reduce((s, n) => s + (n.wattage ?? 1500), 0)
    : 0;
  const heaterWatts = heaters.reduce((s, n) => s + (n.wattage ?? 2000), 0);

  const voltage = 230;
  const pf = 0.88;

  const levelFactor = Math.max(1, project.levels.length);
  const groundBB = project.levels[0] ? levelBoundingBox(project.levels[0]) : { width: 12, depth: 10 };
  const avgRunM = Math.round((groundBB.width + groundBB.depth) * 0.72 + (levelFactor - 1) * 4);

  const makeRow = (
    circuitId: string,
    name: string,
    phase: 'L1' | 'L2' | 'L3' | '1-Ph',
    loadWatts: number,
    demandFactor: number,
    pointCount: number,
    lengthOffset = 0,
    explicitLengthM?: number
  ): ElectricalCircuitScheduleRow => {
    const designAmps = (loadWatts * demandFactor) / (voltage * pf);
    let breakerRating = '10A Type B MCB';
    let cableSpec = '2×1.5mm² + E PVC';
    let areaMm2 = 1.5;
    let zsMaxOhms = 4.37;
    let rcdSensitivitymA = 30;
    const breakingCapacityKA = 6;

    if (designAmps > 24) {
      breakerRating = '32A Type C RCBO (30mA)';
      cableSpec = '2×6.0mm² + E XLPE';
      areaMm2 = 6.0;
      zsMaxOhms = 0.68;
    } else if (designAmps > 14) {
      breakerRating = '20A Type C MCB + 30mA RCD';
      cableSpec = '2×4.0mm² + E PVC';
      areaMm2 = 4.0;
      zsMaxOhms = 1.09;
    } else if (designAmps > 8) {
      breakerRating = '16A Type B MCB + 30mA RCD';
      cableSpec = '2×2.5mm² + E PVC';
      areaMm2 = 2.5;
      zsMaxOhms = 2.73;
    }
    const cableLengthM = explicitLengthM ?? Math.max(12, avgRunM + lengthOffset);
    // 230V 1-ph copper voltage drop: ΔV = 2 * L * Ib * 0.01851 / S
    const voltageDropV = Number(((2 * cableLengthM * designAmps * 0.01851) / areaMm2).toFixed(2));
    const voltageDropPct = Number(((voltageDropV / voltage) * 100).toFixed(2));

    return {
      circuitId,
      name,
      phase,
      loadWatts,
      demandFactor,
      designAmps: Number(designAmps.toFixed(1)),
      breakerRating,
      cableSpec,
      pointCount,
      cableLengthM,
      voltageDropV,
      voltageDropPct,
      breakingCapacityKA,
      rcdSensitivitymA,
      zsMaxOhms,
    };
  };

  const subDbEntries = project.levels.flatMap((lvl) =>
    lvl.mepNodes
      .filter((n) => n.kind === 'sub_db')
      .map((sdb) => ({ lvl, sdb }))
  );

  let circuits: ElectricalCircuitScheduleRow[];
  if (subDbEntries.length > 0) {
    const phases: Array<'L1' | 'L2' | 'L3'> = ['L1', 'L2', 'L3'];
    circuits = subDbEntries.map(({ lvl, sdb }, idx) => {
      const rm = findRoomForNode(sdb, lvl);
      const roomNodes = lvl.mepNodes.filter(
        (n) =>
          n.system === 'electrical' &&
          n.kind !== 'mdb' &&
          n.kind !== 'sub_db' &&
          n.kind !== 'utility_meter' &&
          !n.kind.startsWith('solar_') &&
          (n.roomId ? n.roomId === rm?.id : rm && findRoomForNode(n, lvl)?.id === rm.id)
      );
      const roomLoadWatts =
        roomNodes.reduce((s, n) => s + (n.wattage ?? (n.kind === 'light_ceiling' ? 18 : 0)), 0) +
        (rm?.category === 'kitchen' ? 1800 : 0);
      const smCkt = lvl.mepCircuits.find((c) => c.id === sdb.circuitId);
      const lenM = smCkt
        ? Math.max(4, Math.round(polylineLength2D(smCkt.points) + 2.8))
        : undefined;
      const row = makeRow(
        sdb.label ?? `DB-${idx + 1}`,
        `${sdb.label ?? `DB-${idx + 1}`} — ${rm?.name ?? 'Room Distribution Board'} (L+P${roomNodes.some((n) => n.kind === 'ac_split' && n.label !== 'EF') ? '+AC' : ''}${roomNodes.some((n) => n.kind === 'water_heater') ? '+WH' : ''})`,
        phases[idx % 3],
        Math.max(250, roomLoadWatts),
        0.75,
        roomNodes.length || 4,
        0,
        lenM
      );
      if (row.cableSpec === '2×1.5mm² + E PVC' || row.cableSpec === '2×2.5mm² + E PVC') {
        row.cableSpec = '3×4.0mm² + E XLPE';
        row.breakerRating = '20A Type B RCBO (30mA)';
        row.voltageDropV = Number(((2 * row.cableLengthM * row.designAmps * 0.01851) / 4.0).toFixed(2));
        row.voltageDropPct = Number(((row.voltageDropV / voltage) * 100).toFixed(2));
      } else {
        row.cableSpec = '3×6.0mm² + E XLPE';
        row.breakerRating = '32A Type C RCBO (30mA)';
      }
      return row;
    });
  } else {
    circuits = [
      makeRow('CKT-L1', 'General LED Lighting & SD Loop', 'L1', lightWatts, 0.9, lights.length || 6, 4),
      makeRow('CKT-P1', 'General Socket Outlets Ring', 'L2', powerWatts, 0.5, outlets.length || 8, 2),
      makeRow('CKT-K1', 'Kitchen Heavy Appliances (Oven/DW)', 'L3', kitchenApplianceWatts, 0.7, 3, -2),
    ];
    if (acWatts > 0) {
      circuits.push(makeRow('CKT-AC', 'HVAC Split Air Conditioning', 'L1', acWatts, 0.85, acs.length, 3));
    }
    if (heaterWatts > 0) {
      circuits.push(makeRow('CKT-WH', 'Domestic Hot Water Heaters', 'L2', heaterWatts, 0.8, heaters.length, 0));
    }
  }

  // Water pressure pump set (ground-tank supply): skip when lower floors are decorative (shared building pump).
  const hasDecorativeFloors = project.levels.some((l) => l.decorative);
  if (!hasDecorativeFloors && getWaterSupply(project).mode === 'ground_tank_pump') {
    const pumpKW = computePlumbingRiser(project).pumpKW;
    const row = makeRow('CKT-PUMP', `Water pressure pump set ${pumpKW} kW`, 'L2', Math.round((pumpKW * 1000) / 0.8), 1.0, 1, 0, 10);
    row.breakerRating = '16A Type C RCBO (30mA)';
    row.cableSpec = '3×2.5mm² + E PVC';
    circuits.push(row);
  }
  const totalConnectedWatts = circuits.reduce((s, c) => s + c.loadWatts, 0);
  const diversifiedLoadKW = Number(
    (circuits.reduce((s, c) => s + c.loadWatts * c.demandFactor, 0) / 1000).toFixed(2)
  );
  const phaseKW = (ph: 'L1' | 'L2' | 'L3') =>
    Number(
      (
        circuits
          .filter((c) => c.phase === ph)
          .reduce((s, c) => s + c.loadWatts * c.demandFactor, 0) / 1000
      ).toFixed(2)
    );

  const solar = getSolarConfig(project);
  const stringsCount = solar.strings && solar.strings > 0 ? solar.strings : solar.panelCount >= 8 ? 2 : 1;
  const panelsPerString = solar.panelsPerString && solar.panelsPerString > 0 ? solar.panelsPerString : Math.max(1, Math.ceil(solar.panelCount / stringsCount));
  const arrayKwp = Number(((solar.panelCount * solar.panelWattage) / 1000).toFixed(2));
  const str = pvString(panelsPerString, solar.module);
  const stringVocV = str.vocV;
  const stringIscA = str.iscA;
  const acBreakerAmps = solar.inverterKW > 7 ? 40 : 32;
  const acBreakerSpec = `${acBreakerAmps}A 2P Type B Bi-Dir RCBO (30mA)`;
  const sunHours = hvacCfg.climateZone === 'maldives_tropical' ? 5.3 : 4.4;
  const estimatedDailyKWh = Number((arrayKwp * sunHours * 0.84).toFixed(1));
  const netGridDemandKW = Number(
    Math.max(0.4, diversifiedLoadKW - (solar.enabled ? solar.inverterKW * 0.65 : 0)).toFixed(2)
  );

  if (solar.enabled) {
    const pvRow = makeRow(
      'CKT-PV',
      `Solar PV Hybrid Inverter AC Feed (${arrayKwp} kWp / ${solar.batteryKWh} kWh BESS)`,
      'L1',
      Math.round(solar.inverterKW * 1000),
      1.0,
      solar.panelCount,
      -4
    );
    pvRow.breakerRating = acBreakerSpec;
    pvRow.cableSpec = '3×6.0mm² CU/XLPE (H07RN-F Bi-Dir)';
    circuits.push(pvRow);
  }

  const maxVoltageDropPct = Number(Math.max(...circuits.map((c) => c.voltageDropPct)).toFixed(2));
  const designCurrentAmps = Number(((diversifiedLoadKW * 1000) / (voltage * pf)).toFixed(1));
  const isThreePhase = diversifiedLoadKW > 9.5;
  const mainBreakerSpec = isThreePhase
    ? `63A 4P MCCB (10kA) + 100mA Type-S RCCB (3-Ph 400V)`
    : `${designCurrentAmps > 45 ? 63 : 50}A 2P MCB (10kA) + 30mA RCCB (230V)`;
  const supplyCableSpec = isThreePhase
    ? '4×16mm² CU/XLPE/SWA/PVC Armored'
    : '2×16mm² + 16mm²E CU/XLPE/PVC';

  const groundLvl = project.levels[0];
  const core = groundLvl
    ? getCoreElectricalNodes(groundLvl)
    : {
        mdb: { position: { x: 0.5, y: 0.5 } },
        meter: { position: { x: -0.1, y: 1.35 } },
        inverter: { position: { x: -0.1, y: 2.35 } },
        bess: { position: { x: -0.1, y: 3.15 } },
        pvAnchor: null,
      };
  const routes = computePVAndEquipmentRoutes(project, 0);

  return {
    totalConnectedWatts,
    diversifiedLoadKW,
    designCurrentAmps,
    mainBreakerSpec,
    supplyCableSpec,
    earthingSpec: 'TN-S Copper Rod < 2.0Ω Earth Pit',
    supplySystem: isThreePhase ? 'TN-S 3-Ph+N+PE 230/400V 50Hz' : 'TN-S 1-Ph+N+PE 230V 50Hz',
    powerFactor: pf,
    maxVoltageDropPct,
    phaseBalance: { L1_kW: phaseKW('L1'), L2_kW: phaseKW('L2'), L3_kW: phaseKW('L3') },
    spdSpec: 'Type-2 SPD 40kA 8/20µs',
    solarPV: {
      enabled: solar.enabled,
      panelCount: solar.panelCount,
      panelWattage: solar.panelWattage,
      arrayKwp,
      stringsCount,
      panelsPerString,
      stringVocV,
      stringVocColdV: str.vocColdV,
      stringVmpV: str.vmpV,
      stringIscA,
      module: moduleLabel(solar),
      inverterKW: solar.inverterKW,
      batteryKWh: solar.batteryKWh,
      dcCableSpec: '2×6.0mm² EN 50618 H1Z2Z2-K 1.5kV DC',
      dcIsolatorSpec: '32A 1000V DC 4P + Type-2 DC SPD',
      stringFuseSpec: `${str.fuseA}A gPV 1000V DC string fuse`,
      acBreakerSpec,
      estimatedDailyKWh,
      netGridDemandKW,
    },
    equipmentRouting: {
      mdbPos: core.mdb.position,
      meterPos: core.meter.position,
      inverterPos: core.inverter.position,
      bessPos: core.bess.position,
      meterToMdbM: routes.meterToMdb.lengthM,
      pvToInverterM: routes.pvToInverter.lengthM,
      inverterToMdbM: routes.inverterToMdb.lengthM,
      inverterToBessM: routes.inverterToBess.lengthM,
    },
    circuits,
  };
}

export function computePlumbingRiser(project: BuildingProject): PlumbingRiserReport {
  const bedrooms = project.levels.flatMap((l) => l.rooms).filter((r) => r.category === 'bedroom').length;
  const occupancyCount = Math.max(2, bedrooms * 2);
  const dailyWaterDemandLiters = occupancyCount * 150;
  const supply = getWaterSupply(project);
  const pumped = supply.mode === 'ground_tank_pump';
  // Ground tank: two days' demand (min 1,000 L), in 500 L steps; none on mains pressure.
  const storageTankLiters = pumped ? supply.storageLiters || Math.max(1000, Math.ceil((dailyWaterDemandLiters * 2) / 500) * 500) : 0;

  const nodes = project.levels.flatMap((l) => l.mepNodes);
  const wcCount = nodes.filter((n) => n.kind === 'plumb_wc').length || Math.max(1, project.levels.flatMap((l) => l.rooms).filter((r) => r.category === 'bathroom').length);
  const basinCount = nodes.filter((n) => n.kind === 'plumb_basin').length || wcCount;
  const showerCount = nodes.filter((n) => n.kind === 'plumb_shower').length || wcCount;
  const sinkCount = nodes.filter((n) => n.kind === 'plumb_sink').length || 1;

  const fixtureSummary = [
    { label: 'Water Closet (WC - 6L Flush)', count: wcCount, dfuEach: 4, totalDfu: wcCount * 4 },
    { label: 'Wash Hand Basin (WHB)', count: basinCount, dfuEach: 1, totalDfu: basinCount * 1 },
    { label: 'Shower / Bath Mixer', count: showerCount, dfuEach: 2, totalDfu: showerCount * 2 },
    { label: 'Kitchen Sink (Double Bowl)', count: sinkCount, dfuEach: 2, totalDfu: sinkCount * 2 },
  ];
  const totalDFU = fixtureSummary.reduce((s, f) => s + f.totalDfu, 0);
  // Hunter's Curve WSFU &BS EN 806 simultaneous demand L/s
  const totalWSFU = Number((wcCount * 2.5 + basinCount * 1.0 + showerCount * 2.0 + sinkCount * 1.5).toFixed(1));
  const peakFlowLps = Number((0.28 * Math.sqrt(Math.max(1, totalWSFU))).toFixed(2));
  const pipeInnerDiaM = totalDFU > 20 ? 0.025 : 0.020; // PN20 PPR ID
  const areaM2 = Math.PI * (pipeInnerDiaM / 2) ** 2;
  const designVelocityMps = Number((peakFlowLps / 1000 / areaM2).toFixed(2));
  // Pressure pump: lift to the highest outlet + 1.5 bar there + pipe losses.
  const topOutletM = (project.levels[project.levels.length - 1]?.elevation ?? 0) + 1.2;
  const pumpHeadMeters = pumped ? Math.ceil(topOutletM + 15 + 5) : 0;
  const pumpFlowLpm = pumped ? Math.ceil(peakFlowLps * 60 * 1.2) : 0;
  const hydraulicKW = (9.81 * (pumpFlowLpm / 60000) * pumpHeadMeters) / 0.45;
  const pumpKW = pumped ? [0.37, 0.55, 0.75, 1.1, 1.5, 2.2].find((k) => k >= hydraulicKW) ?? 2.2 : 0;

  // BS EN 12056-3 Roof Stormwater Runoff: Q = C * i * A / 3600 (Maldives monsoon i=140 mm/h vs 75 mm/h)
  const hvacCfg = getHVACConfig(project);
  const drainage = getRoofDrainageConfig(project.roof);
  const gutterMeta = GUTTER_PROFILE_META[drainage.gutterProfile];
  const collectMeta = WATER_COLLECTION_META[drainage.waterCollectionMode];
  const isMaldives = hvacCfg.climateZone === 'maldives_tropical';
  const gBB = project.levels[0] ? levelBoundingBox(project.levels[0]) : { width: 12, depth: 10 };
  const ov = project.roof.overhang;
  const roofCatchmentM2 = Number(((gBB.width + ov * 2) * (gBB.depth + ov * 2)).toFixed(1));
  const rainfallIntensityMmh = isMaldives ? 140 : 75;
  const stormwaterRunoffLps = Number(((0.95 * rainfallIntensityMmh * roofCatchmentM2) / 3600).toFixed(2));
  const rainwaterDownpipesCount = drainage.gutterEnabled
    ? Math.max(2, drainage.downpipeCount)
    : 0;
  const rainwaterTankSpec =
    drainage.waterCollectionMode === 'harvesting_tank' || drainage.waterCollectionMode === 'underground_cistern'
      ? `${drainage.harvestingTankLiters.toLocaleString()}L ${collectMeta.shortLabel}${drainage.firstFlushDiverter ? ' + First-Flush + UV' : ''}`
      : `${collectMeta.label}${drainage.firstFlushDiverter ? ' + Silt/Leaf Trap' : ''}`;

  const inspectionChambers = [
    { id: 'IC-1', sizeMm: '600 × 600', invertLevelM: -0.55, location: 'Soil & Waste Riser Base' },
    { id: 'IC-2', sizeMm: '600 × 600', invertLevelM: -0.78, location: 'Kitchen Grease Trap Outlet' },
    { id: 'MH-MAIN', sizeMm: '900 × 900', invertLevelM: -1.05, location: 'Plot Boundary Municipal Tie-In' },
  ];

  return {
    occupancyCount,
    dailyWaterDemandLiters,
    supplyMode: supply.mode,
    storageTankLiters,
    pumpKW,
    pumpFlowLpm,
    pumpHeadMeters,
    pressureVesselLiters: pumped ? (project.levels.length > 1 ? 50 : 24) : 0,
    outletPressureBar: pumped ? 1.5 : 1.0,
    totalDFU,
    supplyMainPipe: totalDFU > 20 ? 'Ø32mm PPR PN20' : 'Ø25mm PPR PN20',
    soilStackPipe: 'Ø110mm uPVC Class-B Soil + Ø50mm Vent',
    wasteStackPipe: 'Ø50mm / Ø75mm uPVC Greywater w/ Floor Traps',
    totalWSFU,
    peakFlowLps,
    designVelocityMps,
    roofCatchmentM2,
    rainfallIntensityMmh,
    stormwaterRunoffLps,
    rainwaterDownpipesCount,
    rainwaterPipeSpec: drainage.gutterEnabled ? 'Ø100mm uPVC Class-B RWP' : 'Free-drip Eaves (No Gutters)',
    rainwaterTankSpec,
    gutterEnabled: drainage.gutterEnabled,
    gutterSpec: drainage.gutterEnabled ? gutterMeta.spec : 'Gutters Disabled',
    waterCollectionMode: drainage.waterCollectionMode,
    harvestingTankLiters: drainage.harvestingTankLiters,
    firstFlushDiverter: drainage.firstFlushDiverter,
    inspectionChambers,
    fixtureSummary,
  };
}
