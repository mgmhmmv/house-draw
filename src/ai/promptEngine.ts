import {
  BuildingProject,
  ClimateZone,
  DoorFinishMaterial,
  ExteriorFacadeMaterial,
  FloorFinish,
  FloorLevel,
  getDesignConfig,
  getHVACConfig,
  getSolarConfig,
  HVACConfig,
  InteriorWallMaterial,
  MALDIVES_HVAC_CONFIG,
  MaterialDesignConfig,
  Opening,
  RoofMaterial,
  RoofType,
  Room,
  RoomCategory,
  SolarPVConfig,
  Wall,
  WallMaterial,
  WindowFrameFinish,
  WiringRouteMode,
} from '../model/types';
import {
  autoGenerateStructuralGrid,
  autoPlaceStructuralColumns,
  levelBoundingBox,
  uid,
  wallLength,
} from '../engine/geometry';
import {
  autoPopulateMEPForLevel,
  computePVAndEquipmentRoutes,
  getCoreElectricalNodes,
  relocateMEPNode,
} from '../engine/mepEngine';
import { DEFAULT_BOQ_RATES } from '../model/presets';

export interface AILLMConfig {
  provider: 'claude' | 'local' | 'gemini' | 'openai';
  apiKey?: string;
  model?: string;
}

export interface PromptResult {
  project: BuildingProject;
  summary: string;
  changes: string[];
  reasoning?: string;
  engineUsed?: 'claude' | 'local' | 'gemini';
}

export interface PlacedRoomRect {
  name: string;
  category: RoomCategory;
  x: number;
  y: number;
  w: number;
  h: number;
  finish?: FloorFinish;
}

interface ClaudePlanLevel {
  name?: string;
  rooms?: PlacedRoomRect[];
}

interface ClaudeArchitecturalPlan {
  action?: 'new_building' | 'modify_building';
  reasoning?: string;
  title?: string;
  width?: number;
  depth?: number;
  stories?: number;
  bedrooms?: number;
  hasGarage?: boolean;
  hasOffice?: boolean;
  roofType?: RoofType;
  pitchDeg?: number;
  roofMaterial?: RoofMaterial;
  wallMaterial?: WallMaterial;
  exteriorFacade?: ExteriorFacadeMaterial;
  interiorWalls?: InteriorWallMaterial;
  windowFrame?: WindowFrameFinish;
  doorMaterial?: DoorFinishMaterial;
  floorFinish?: FloorFinish;
  climateZone?: ClimateZone;
  solar?: Partial<SolarPVConfig>;
  hvac?: Partial<HVACConfig>;
  equipment?: {
    mdb?: { x: number; y: number };
    utility_meter?: { x: number; y: number };
    solar_inv?: { x: number; y: number };
    solar_bess?: { x: number; y: number };
    dcRouteMode?: WiringRouteMode;
    acRouteMode?: WiringRouteMode;
  };
  levels?: ClaudePlanLevel[];
}

function snapCoord(v: number): number {
  return Number((Math.round(v * 20) / 20).toFixed(2));
}

function createWall(x1: number, y1: number, x2: number, y2: number, ext: boolean, h = 3.05): Wall {
  return {
    id: uid('w'),
    start: { x: Number(x1.toFixed(2)), y: Number(y1.toFixed(2)) },
    end: { x: Number(x2.toFixed(2)), y: Number(y2.toFixed(2)) },
    thickness: ext ? 0.23 : 0.12,
    height: h,
    isExterior: ext,
    isLoadBearing: ext,
    material: ext ? 'brick' : 'cmu',
  };
}

function addRoomObj(
  name: string,
  category: RoomCategory,
  x: number,
  y: number,
  w: number,
  h: number,
  preferredFinish?: FloorFinish
): Room {
  const finish: FloorFinish =
    category === 'bathroom'
      ? 'ceramic_antiskid'
      : category === 'garage'
      ? 'concrete'
      : preferredFinish && preferredFinish !== 'concrete'
      ? preferredFinish
      : category === 'bedroom' || category === 'office'
      ? 'hardwood'
      : 'porcelain';
  return {
    id: uid('rm'),
    name,
    category,
    polygon: [
      { x: Number(x.toFixed(2)), y: Number(y.toFixed(2)) },
      { x: Number((x + w).toFixed(2)), y: Number(y.toFixed(2)) },
      { x: Number((x + w).toFixed(2)), y: Number((y + h).toFixed(2)) },
      { x: Number(x.toFixed(2)), y: Number((y + h).toFixed(2)) },
    ],
    finish,
    ceilingHeight: 3.0,
  };
}

function mergeGridValues(values: number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const out: number[] = [];
  for (const v of sorted) {
    if (out.length === 0 || Math.abs(v - out[out.length - 1]) > 0.08) {
      out.push(Number(v.toFixed(2)));
    }
  }
  return out;
}

function snapToGridList(v: number, grid: number[]): number {
  let best = grid[0];
  let minD = Infinity;
  for (const g of grid) {
    const d = Math.abs(v - g);
    if (d < minD) {
      minD = d;
      best = g;
    }
  }
  return best;
}

interface WallMeta {
  wall: Wall;
  roomA: number; // -1 if exterior
  roomB: number; // -1 if exterior
  dir: 'H' | 'V';
  pos: number; // y if H, x if V
  len: number;
}

/**
 * Compiles non-overlapping rectilinear room placements into an architecturally sound FloorLevel:
 * - Walls follow true room boundaries with zero wall crossings inside rooms.
 * - Every room has sensible doors connecting to the hallway/living spine (BFS connectivity verified).
 * - Every exterior habitable room gets properly sized windows centered on its facade walls.
 */
export function buildLevelFromRoomRects(
  rawRects: PlacedRoomRect[],
  width: number,
  depth: number,
  lvlIdx: number,
  stories: number,
  solarEnabled: boolean,
  preferredDryFinish?: FloorFinish
): FloorLevel {
  const rawXs: number[] = [0, width];
  const rawYs: number[] = [0, depth];
  for (const r of rawRects) {
    rawXs.push(snapCoord(r.x), snapCoord(r.x + r.w));
    rawYs.push(snapCoord(r.y), snapCoord(r.y + r.h));
  }
  const xs = mergeGridValues(rawXs);
  const ys = mergeGridValues(rawYs);

  interface Box {
    idx: number;
    name: string;
    category: RoomCategory;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  }

  const boxes: Box[] = rawRects.map((r, idx) => {
    const x1 = snapToGridList(r.x, xs);
    const y1 = snapToGridList(r.y, ys);
    const x2 = snapToGridList(r.x + r.w, xs);
    const y2 = snapToGridList(r.y + r.h, ys);
    return {
      idx,
      name: r.name,
      category: r.category,
      x1: Math.min(x1, x2),
      y1: Math.min(y1, y2),
      x2: Math.max(x1, x2),
      y2: Math.max(y1, y2),
    };
  });

  const rooms: Room[] = boxes.map((b, i) =>
    addRoomObj(
      b.name,
      b.category,
      b.x1,
      b.y1,
      b.x2 - b.x1,
      b.y2 - b.y1,
      rawRects[i].finish || preferredDryFinish
    )
  );

  const findRoomAtPoint = (px: number, py: number): number => {
    for (const b of boxes) {
      if (px > b.x1 + 0.01 && px < b.x2 - 0.01 && py > b.y1 + 0.01 && py < b.y2 - 0.01) {
        return b.idx;
      }
    }
    return -1;
  };

  const wallMetas: WallMeta[] = [];

  // 1. Horizontal walls along each Y line
  for (const y of ys) {
    let runStart: number | null = null;
    let runPair: [number, number] | null = null;

    const flushH = (endX: number) => {
      if (runStart !== null && runPair !== null && endX - runStart >= 0.25) {
        const [rA, rB] = runPair;
        const isExt = rA === -1 || rB === -1;
        const w = createWall(runStart, y, endX, y, isExt);
        if (!isExt && (boxes[rA]?.category === 'hallway' || boxes[rB]?.category === 'hallway')) {
          w.isLoadBearing = true;
          w.thickness = 0.15;
        }
        wallMetas.push({ wall: w, roomA: rA, roomB: rB, dir: 'H', pos: y, len: endX - runStart });
      }
      runStart = null;
      runPair = null;
    };

    for (let i = 0; i < xs.length - 1; i++) {
      const xA = xs[i];
      const xB = xs[i + 1];
      const mx = (xA + xB) / 2;
      const above = findRoomAtPoint(mx, y - 0.05);
      const below = findRoomAtPoint(mx, y + 0.05);

      if ((above === -1 && below === -1) || above === below) {
        flushH(xA);
        continue;
      }
      // Keep open passage between two hallway segments if split
      if (
        above !== -1 &&
        below !== -1 &&
        boxes[above].category === 'hallway' &&
        boxes[below].category === 'hallway'
      ) {
        flushH(xA);
        continue;
      }

      if (runPair && runPair[0] === above && runPair[1] === below) {
        // extend current contiguous wall
      } else {
        flushH(xA);
        runStart = xA;
        runPair = [above, below];
      }
    }
    flushH(xs[xs.length - 1]);
  }

  // 2. Vertical walls along each X line
  for (const x of xs) {
    let runStart: number | null = null;
    let runPair: [number, number] | null = null;

    const flushV = (endY: number) => {
      if (runStart !== null && runPair !== null && endY - runStart >= 0.25) {
        const [rA, rB] = runPair;
        const isExt = rA === -1 || rB === -1;
        const w = createWall(x, runStart, x, endY, isExt);
        wallMetas.push({ wall: w, roomA: rA, roomB: rB, dir: 'V', pos: x, len: endY - runStart });
      }
      runStart = null;
      runPair = null;
    };

    for (let j = 0; j < ys.length - 1; j++) {
      const yA = ys[j];
      const yB = ys[j + 1];
      const my = (yA + yB) / 2;
      const left = findRoomAtPoint(x - 0.05, my);
      const right = findRoomAtPoint(x + 0.05, my);

      if ((left === -1 && right === -1) || left === right) {
        flushV(yA);
        continue;
      }
      if (
        left !== -1 &&
        right !== -1 &&
        boxes[left].category === 'hallway' &&
        boxes[right].category === 'hallway'
      ) {
        flushV(yA);
        continue;
      }

      if (runPair && runPair[0] === left && runPair[1] === right) {
        // extend
      } else {
        flushV(yA);
        runStart = yA;
        runPair = [left, right];
      }
    }
    flushV(ys[ys.length - 1]);
  }

  const walls = wallMetas.map((m) => m.wall);
  const openings: Opening[] = [];
  const wallsWithDoor = new Set<string>();
  const adj = new Map<number, Set<number>>();
  for (let i = 0; i < boxes.length; i++) adj.set(i, new Set());

  const addDoorOnMeta = (
    wm: WallMeta,
    style: Opening['style'],
    targetWidth: number,
    label: string,
    swing: 1 | -1 = 1
  ) => {
    const wLen = Math.max(0.4, wallLength(wm.wall));
    const clampedW = Number(Math.min(targetWidth, Math.max(0.68, wLen - 0.3)).toFixed(2));
    openings.push({
      id: uid('op'),
      wallId: wm.wall.id,
      kind: 'door',
      style,
      offset: 0.5,
      width: clampedW,
      height: style === 'garage' ? 2.25 : 2.15,
      sillHeight: 0,
      swingDirection: swing,
      label,
    });
    wallsWithDoor.add(wm.wall.id);
    if (wm.roomA !== -1 && wm.roomB !== -1) {
      adj.get(wm.roomA)?.add(wm.roomB);
      adj.get(wm.roomB)?.add(wm.roomA);
    }
  };

  // 3. Place Main Front Entry Door (South y == depth preferred) & Garage Door on Ground Floor
  const maxY = ys[ys.length - 1];
  if (lvlIdx === 0) {
    const entryCandidates = wallMetas
      .filter((wm) => {
        if (wm.roomA !== -1 && wm.roomB !== -1) return false;
        const roomIdx = wm.roomA !== -1 ? wm.roomA : wm.roomB;
        if (roomIdx === -1) return false;
        const cat = boxes[roomIdx].category;
        const nm = boxes[roomIdx].name.toLowerCase();
        return (cat === 'hallway' || cat === 'living' || nm.includes('foyer')) && wm.len >= 1.3;
      })
      .sort((a, b) => {
        const aSouth = a.dir === 'H' && Math.abs(a.pos - maxY) < 0.15 ? 1 : 0;
        const bSouth = b.dir === 'H' && Math.abs(b.pos - maxY) < 0.15 ? 1 : 0;
        if (aSouth !== bSouth) return bSouth - aSouth;
        const rA = boxes[a.roomA !== -1 ? a.roomA : a.roomB];
        const rB = boxes[b.roomA !== -1 ? b.roomA : b.roomB];
        const aFoyer = rA.name.toLowerCase().includes('foyer') || rA.category === 'hallway' ? 1 : 0;
        const bFoyer = rB.name.toLowerCase().includes('foyer') || rB.category === 'hallway' ? 1 : 0;
        if (aFoyer !== bFoyer) return bFoyer - aFoyer;
        return b.len - a.len;
      });

    if (entryCandidates.length > 0) {
      addDoorOnMeta(entryCandidates[0], 'double', 1.2, 'D0', -1);
    }

    const garageWalls = wallMetas
      .filter((wm) => {
        if (wm.roomA !== -1 && wm.roomB !== -1) return false;
        const rIdx = wm.roomA !== -1 ? wm.roomA : wm.roomB;
        return rIdx !== -1 && boxes[rIdx].category === 'garage' && wm.len >= 2.6;
      })
      .sort((a, b) => {
        const aSouth = a.dir === 'H' && Math.abs(a.pos - maxY) < 0.15 ? 1 : 0;
        const bSouth = b.dir === 'H' && Math.abs(b.pos - maxY) < 0.15 ? 1 : 0;
        if (aSouth !== bSouth) return bSouth - aSouth;
        return b.len - a.len;
      });
    if (garageWalls.length > 0) {
      addDoorOnMeta(garageWalls[0], 'garage', Math.min(3.0, garageWalls[0].len * 0.72), 'DG1', -1);
    }
  }

  // 4. Interior Doors: connect every room to hallway / circulation spine
  const interiorEdges = wallMetas.filter((wm) => wm.roomA !== -1 && wm.roomB !== -1 && wm.len >= 0.9);
  for (let rIdx = 0; rIdx < boxes.length; rIdx++) {
    const r = boxes[rIdx];
    if (r.category === 'hallway') continue;

    const touching = interiorEdges
      .filter((wm) => wm.roomA === rIdx || wm.roomB === rIdx)
      .sort((a, b) => {
        const oA = boxes[a.roomA === rIdx ? a.roomB : a.roomA];
        const oB = boxes[b.roomA === rIdx ? b.roomB : b.roomA];
        const score = (other: Box) => {
          if (r.category === 'bathroom' && r.name.toLowerCase().includes('en-suite') && other.category === 'bedroom') {
            return 5;
          }
          if (other.category === 'hallway') return 4;
          if (other.category === 'living' || other.category === 'dining') return 3;
          if (r.category === 'bathroom' && other.category === 'bedroom') return 2;
          return 1;
        };
        const dScore = score(oB) - score(oA);
        if (dScore !== 0) return dScore;
        return b.len - a.len;
      });

    if (touching.length > 0) {
      const pick = touching[0];
      const otherIdx = pick.roomA === rIdx ? pick.roomB : pick.roomA;
      if (!adj.get(rIdx)?.has(otherIdx) && !wallsWithDoor.has(pick.wall.id)) {
        const isBath = r.category === 'bathroom';
        const isWide = r.category === 'living' || r.category === 'dining' || r.category === 'kitchen';
        addDoorOnMeta(
          pick,
          isWide && pick.len >= 2.2 ? 'double' : 'single',
          isBath ? 0.8 : isWide ? 1.2 : 0.95,
          isBath ? 'D2' : 'D1',
          1
        );
      }
    }
  }

  // Open flow archway between Living and Kitchen/Dining if they share a wall
  for (const wm of interiorEdges) {
    if (wallsWithDoor.has(wm.wall.id)) continue;
    const cA = boxes[wm.roomA].category;
    const cB = boxes[wm.roomB].category;
    if (
      ((cA === 'living' && (cB === 'kitchen' || cB === 'dining')) ||
        (cB === 'living' && (cA === 'kitchen' || cA === 'dining'))) &&
      wm.len >= 2.0
    ) {
      addDoorOnMeta(wm, 'double', Math.min(1.6, wm.len * 0.45), 'D1', 1);
    }
  }

  // BFS Connectivity Guarantee from Hallway (or room 0)
  const rootIdx = boxes.findIndex((b) => b.category === 'hallway');
  const startNode = rootIdx >= 0 ? rootIdx : 0;
  let safety = 0;
  while (boxes.length > 0 && safety++ < boxes.length + 2) {
    const visited = new Set<number>([startNode]);
    const queue: number[] = [startNode];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const nxt of adj.get(cur) || []) {
        if (!visited.has(nxt)) {
          visited.add(nxt);
          queue.push(nxt);
        }
      }
    }
    if (visited.size >= boxes.length) break;

    const bridge = interiorEdges
      .filter((wm) => visited.has(wm.roomA) !== visited.has(wm.roomB) && !wallsWithDoor.has(wm.wall.id))
      .sort((a, b) => b.len - a.len)[0];
    if (!bridge) break;
    addDoorOnMeta(bridge, 'single', 0.9, 'D1', 1);
  }

  // 5. Exterior Windows for natural daylighting
  for (let rIdx = 0; rIdx < boxes.length; rIdx++) {
    const r = boxes[rIdx];
    if (r.category === 'hallway' || r.category === 'garage') continue;

    const extWalls = wallMetas
      .filter((wm) => {
        if (wm.roomA !== -1 && wm.roomB !== -1) return false;
        const owner = wm.roomA !== -1 ? wm.roomA : wm.roomB;
        return owner === rIdx && wm.len >= 1.25 && !wallsWithDoor.has(wm.wall.id);
      })
      .sort((a, b) => b.len - a.len);

    const maxWins = r.category === 'living' || r.name.toLowerCase().includes('master') ? 2 : 1;
    for (let wIdx = 0; wIdx < Math.min(maxWins, extWalls.length); wIdx++) {
      const wm = extWalls[wIdx];
      if (wIdx > 0 && wm.len < 2.5) continue;
      let style: Opening['style'] = 'casement';
      let targetW = 1.5;
      let height = 1.4;
      let sill = 0.85;
      let label = 'W1';

      if (r.category === 'living' || r.category === 'dining') {
        style = 'picture';
        targetW = 2.1;
        height = 1.6;
        sill = 0.65;
      } else if (r.category === 'kitchen') {
        style = 'sliding';
        targetW = 1.6;
        height = 1.25;
        sill = 0.95;
        label = 'W2';
      } else if (r.category === 'bathroom') {
        style = 'casement';
        targetW = 0.85;
        height = 0.75;
        sill = 1.35;
        label = 'W3';
      }

      openings.push({
        id: uid('op'),
        wallId: wm.wall.id,
        kind: 'window',
        style,
        offset: 0.5,
        width: Number(Math.min(targetW, Math.max(0.65, wm.len - 0.55)).toFixed(2)),
        height,
        sillHeight: sill,
        swingDirection: 1,
        label,
      });
    }
  }

  // Place stairs neatly inside the central hallway spine when multi-story
  const hallBox = boxes.find((b) => b.category === 'hallway');
  const stairs =
    stories > 1
      ? [
          {
            id: `st_${lvlIdx}`,
            origin: {
              x: Number(((hallBox?.x1 ?? 0.6) + 0.5).toFixed(2)),
              y: Number((hallBox?.y1 ?? depth * 0.45).toFixed(2)),
            },
            width: 2.2,
            length: Number(Math.min(2.2, Math.max(1.4, (hallBox ? hallBox.y2 - hallBox.y1 : 1.7) - 0.05)).toFixed(2)),
            direction: 'E' as const,
            shape: 'l_shape' as const,
            risers: 18,
          },
        ]
      : [];

  let lvl: FloorLevel = {
    id: `lvl_${lvlIdx}`,
    index: lvlIdx,
    name: lvlIdx === 0 ? 'Ground Floor' : `Floor ${lvlIdx + 1}`,
    elevation: lvlIdx === 0 ? 0.45 : Number((0.45 + lvlIdx * 3.2).toFixed(2)),
    floorToFloorHeight: 3.2,
    slabThickness: 0.15,
    walls,
    openings,
    rooms,
    columns: [],
    stairs,
    furniture: [],
    mepNodes: [],
    mepCircuits: [],
  };
  lvl.columns = autoPlaceStructuralColumns(lvl);
  lvl = autoPopulateMEPForLevel(lvl, solarEnabled);
  return lvl;
}

function tileStrip(
  slots: { name: string; category: RoomCategory; weight: number }[],
  xStart: number,
  yStart: number,
  totalW: number,
  h: number
): PlacedRoomRect[] {
  if (slots.length === 0 || totalW <= 0.5) return [];
  const totalWeight = slots.reduce((s, x) => s + x.weight, 0);
  const out: PlacedRoomRect[] = [];
  let curX = snapCoord(xStart);
  const endX = snapCoord(xStart + totalW);
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    const isLast = i === slots.length - 1;
    const w = isLast ? snapCoord(endX - curX) : snapCoord((totalW * s.weight) / totalWeight);
    out.push({ name: s.name, category: s.category, x: curX, y: yStart, w, h });
    curX = snapCoord(curX + w);
  }
  return out;
}

/**
 * Generates an architecturally sound, gap-free, overlap-free central-spine room layout
 * for any 1-to-3 story residential program (1–6 bedrooms, optional garage & office).
 */
export function generateArchitecturalFloorRects(
  width: number,
  depth: number,
  stories: number,
  bedrooms: number,
  hasGarage: boolean,
  hasOffice: boolean,
  lvlIdx: number
): PlacedRoomRect[] {
  const rooms: PlacedRoomRect[] = [];
  const hasEastGarage = hasGarage && lvlIdx === 0;
  const mainW = hasEastGarage ? snapCoord(Math.min(width - 3.2, Math.max(8.5, width * 0.74))) : snapCoord(width);
  const spineH = Math.max(1.5, Math.min(1.9, snapCoord(depth * 0.16)));
  const y1 = snapCoord((depth - spineH) * 0.48);
  const y2 = snapCoord(y1 + spineH);
  const southH = snapCoord(depth - y2);

  if (hasEastGarage) {
    rooms.push({
      name: 'Garage Bay',
      category: 'garage',
      x: mainW,
      y: 0,
      w: snapCoord(width - mainW),
      h: snapCoord(depth),
    });
  }

  if (lvlIdx === 0) {
    // Central circulation spine
    rooms.push({
      name: 'Central Hall & Foyer',
      category: 'hallway',
      x: 0,
      y: y1,
      w: mainW,
      h: spineH,
    });

    const foyerW = snapCoord(Math.min(2.6, Math.max(1.9, mainW * 0.18)));

    if (stories === 1) {
      const privQueue: { name: string; category: RoomCategory; weight: number }[] = [
        { name: 'Master Bedroom', category: 'bedroom', weight: 1.3 },
        { name: 'Shared Bath', category: 'bathroom', weight: 0.78 },
      ];
      for (let b = 2; b <= bedrooms; b++) {
        privQueue.push({ name: `Bedroom ${b}`, category: 'bedroom', weight: 1.05 });
      }
      if (hasOffice) {
        privQueue.push({ name: 'Home Office / Study', category: 'office', weight: 0.95 });
      }
      if (bedrooms >= 3) {
        privQueue.splice(1, 0, { name: 'Master En-Suite', category: 'bathroom', weight: 0.72 });
      }

      // If more than 3 private slots, move first 1–2 private slots onto the North-East strip
      const southTarget = Math.min(3, privQueue.length);
      const northOverflow = privQueue.length > 3 ? privQueue.slice(0, privQueue.length - southTarget) : [];
      const southSlots: { name: string; category: RoomCategory; weight: number }[] = [
        { name: 'Entrance Foyer', category: 'hallway', weight: foyerW },
        ...privQueue.slice(privQueue.length - southTarget),
      ];

      const northSlots: { name: string; category: RoomCategory; weight: number }[] = [
        { name: 'Living & Lounge', category: 'living', weight: 1.5 },
        { name: 'Kitchen & Dining', category: 'kitchen', weight: 1.25 },
        ...northOverflow,
      ];

      rooms.push(...tileStrip(northSlots, 0, 0, mainW, y1));
      // Keep Entrance Foyer fixed width at left of South strip, tile remaining slots cleanly
      rooms.push({ name: 'Entrance Foyer', category: 'hallway', x: 0, y: y2, w: foyerW, h: southH });
      rooms.push(...tileStrip(southSlots.slice(1), foyerW, y2, snapCoord(mainW - foyerW), southH));
    } else {
      // Multi-story ground floor: generous public day zones + study/guest suite
      const northSlots = [
        { name: 'Living & Lounge', category: 'living' as RoomCategory, weight: 1.45 },
        { name: 'Kitchen & Dining', category: 'kitchen' as RoomCategory, weight: 1.25 },
      ];
      rooms.push(...tileStrip(northSlots, 0, 0, mainW, y1));

      rooms.push({ name: 'Entrance Foyer', category: 'hallway', x: 0, y: y2, w: foyerW, h: southH });
      const southRight: { name: string; category: RoomCategory; weight: number }[] = [
        {
          name: hasOffice ? 'Home Office / Study' : 'Family Dining / Lounge',
          category: hasOffice ? 'office' : 'dining',
          weight: 1.15,
        },
        { name: 'Guest Powder & Bath', category: 'bathroom', weight: 0.72 },
        {
          name: bedrooms >= 4 ? 'Guest Bedroom' : 'Utility / Mudroom',
          category: bedrooms >= 4 ? 'bedroom' : 'utility',
          weight: 1.15,
        },
      ];
      rooms.push(...tileStrip(southRight, foyerW, y2, snapCoord(mainW - foyerW), southH));
    }
  } else {
    // Upper floor: central gallery hall separating North master/bedrooms from South bedrooms/bath
    rooms.push({
      name: lvlIdx === 1 ? 'Upper Gallery Hall' : `Level ${lvlIdx + 1} Hall`,
      category: 'hallway',
      x: 0,
      y: y1,
      w: snapCoord(width),
      h: spineH,
    });

    const groundGuestBeds = stories > 1 && bedrooms >= 4 ? 1 : 0;
    const upperBeds = Math.max(2, bedrooms - groundGuestBeds);

    const northSlots: { name: string; category: RoomCategory; weight: number }[] = [
      { name: lvlIdx === 1 ? 'Master Suite' : `Suite ${lvlIdx + 1}`, category: 'bedroom', weight: 1.35 },
      { name: 'Master En-Suite', category: 'bathroom', weight: 0.75 },
    ];
    const southSlots: { name: string; category: RoomCategory; weight: number }[] = [
      { name: 'Family Bath', category: 'bathroom', weight: 0.75 },
    ];

    let placedBeds = 1;
    while (placedBeds < upperBeds) {
      placedBeds++;
      const bedSlot = { name: `Bedroom ${placedBeds}`, category: 'bedroom' as RoomCategory, weight: 1.1 };
      if (northSlots.length <= southSlots.length) northSlots.push(bedSlot);
      else southSlots.push(bedSlot);
    }

    if (southSlots.length < 2) {
      southSlots.push({
        name: hasOffice ? 'Upper Study / Lounge' : 'Upper Lounge',
        category: hasOffice ? 'office' : 'living',
        weight: 1.15,
      });
    } else if (northSlots.length < 3 && width >= 13) {
      northSlots.push({ name: 'Upper Terrace Lounge', category: 'living', weight: 1.0 });
    }

    rooms.push(...tileStrip(northSlots, 0, 0, snapCoord(width), y1));
    rooms.push(...tileStrip(southSlots, 0, y2, snapCoord(width), southH));
  }

  return rooms;
}

function validateClaudeRoomTiling(rawRooms: PlacedRoomRect[], width: number, depth: number): boolean {
  if (!Array.isArray(rawRooms) || rawRooms.length < 3) return false;
  let totalArea = 0;
  let hasCirculation = false;

  for (let i = 0; i < rawRooms.length; i++) {
    const a = rawRooms[i];
    if (
      !Number.isFinite(a.x) ||
      !Number.isFinite(a.y) ||
      !Number.isFinite(a.w) ||
      !Number.isFinite(a.h) ||
      a.w < 1.2 ||
      a.h < 1.2 ||
      a.x < -0.1 ||
      a.y < -0.1 ||
      a.x + a.w > width + 0.15 ||
      a.y + a.h > depth + 0.15
    ) {
      return false;
    }
    if (a.category === 'hallway' || a.category === 'living') hasCirculation = true;
    totalArea += a.w * a.h;

    for (let j = i + 1; j < rawRooms.length; j++) {
      const b = rawRooms[j];
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (ox > 0.12 && oy > 0.12) return false;
    }
  }

  const plateArea = width * depth;
  return hasCirculation && totalArea >= plateArea * 0.85 && totalArea <= plateArea * 1.05;
}

function extractMaterialAndSolarFromPrompt(prompt: string): {
  roofMaterial?: RoofMaterial;
  wallMaterial?: WallMaterial;
  exteriorFacade?: ExteriorFacadeMaterial;
  interiorWalls?: InteriorWallMaterial;
  floorFinish?: FloorFinish;
  solar?: Partial<SolarPVConfig>;
  hvac?: Partial<HVACConfig>;
} {
  const lower = prompt.toLowerCase();
  const out: ReturnType<typeof extractMaterialAndSolarFromPrompt> = {};

  const roofMatRules: [RegExp, RoofMaterial][] = [
    [/(marine metal|pvdf|alu[- ]?zinc)/i, 'marine_metal'],
    [/(thatch|fangi|palm roof)/i, 'thatch_palm'],
    [/(slate)/i, 'natural_slate'],
    [/(clay|terracotta)/i, 'clay_tile'],
    [/(shingle|asphalt)/i, 'asphalt_shingle'],
    [/(cedar|shake)/i, 'cedar_shake'],
    [/(green roof|sedum|living roof)/i, 'green_roof'],
    [/(corrugated|zinc|galvalume)/i, 'corrugated_metal'],
    [/(standing seam|metal roof|zinc seam)/i, 'standing_seam'],
    [/(concrete roof|concrete slab)/i, 'concrete_slab'],
  ];
  for (const [rx, mat] of roofMatRules) {
    if (rx.test(prompt)) {
      out.roofMaterial = mat;
      break;
    }
  }

  const facadeRules: [RegExp, ExteriorFacadeMaterial][] = [
    [/(cement plaster|sand[- ]?cement|plastering)/i, 'cement_plaster'],
    [/(coral[- ]?(?:lime|render)|whitewash)/i, 'coral_render'],
    [/(tropical louvre|teak louvre|monsoon louvre)/i, 'tropical_louvres'],
    [/(exposed brick|brick facade|red brick)/i, 'exposed_brick'],
    [/(stone veneer|ashlar|limestone)/i, 'stone_veneer'],
    [/(timber slat|wood facade|cedar cladding)/i, 'timber_slats'],
    [/(travertine)/i, 'travertine_stone'],
    [/(charcoal cladding|zinc facade|dark cladding)/i, 'charcoal_cladding'],
    [/(white render|stucco|plaster facade)/i, 'white_render'],
  ];
  for (const [rx, mat] of facadeRules) {
    if (rx.test(prompt)) {
      out.exteriorFacade = mat;
      break;
    }
  }

  const intRules: [RegExp, InteriorWallMaterial][] = [
    [/(smooth cement|skim[- ]?coat)/i, 'smooth_cement_plaster'],
    [/(teak panel|maldivian teak)/i, 'teak_paneling'],
    [/(oak panel|wood panel|fluted oak)/i, 'oak_paneling'],
    [/(sage green|sage wall)/i, 'sage_green'],
    [/(venetian|limewash)/i, 'venetian_plaster'],
    [/(warm beige|greige)/i, 'warm_beige'],
    [/(exposed concrete|board[- ]formed)/i, 'exposed_concrete'],
    [/(matte white|white interior)/i, 'matte_white'],
  ];
  for (const [rx, mat] of intRules) {
    if (rx.test(prompt)) {
      out.interiorWalls = mat;
      break;
    }
  }

  const floorRules: [RegExp, FloorFinish][] = [
    [/(carrara|marble floor)/i, 'carrara_marble'],
    [/(herringbone)/i, 'herringbone_oak'],
    [/(terrazzo)/i, 'terrazzo'],
    [/(hardwood|oak floor|wood floor)/i, 'hardwood'],
    [/(porcelain)/i, 'porcelain'],
  ];
  for (const [rx, fin] of floorRules) {
    if (rx.test(prompt)) {
      out.floorFinish = fin;
      break;
    }
  }

  if (/(maldives|maldivian|tropical|island|atoll|monsoon|hulhumal)/i.test(prompt)) {
    out.wallMaterial = 'cinder_block';
    out.hvac = { ...MALDIVES_HVAC_CONFIG };
    if (!out.roofMaterial) out.roofMaterial = 'marine_metal';
    if (!out.exteriorFacade) out.exteriorFacade = 'cement_plaster';
    if (!out.interiorWalls) out.interiorWalls = 'smooth_cement_plaster';
  } else if (/(cinder[- ]?block|hollow block)/i.test(prompt)) {
    out.wallMaterial = 'cinder_block';
  } else if (/(coral stone)/i.test(prompt)) {
    out.wallMaterial = 'coral_stone';
  }

  if (/(no ac|no hvac|remove ac|disable hvac)/i.test(prompt)) {
    out.hvac = { ...(out.hvac ?? {}), enabled: false };
  } else if (/(air condition|\bac\b|hvac|inverter split|split ac|ceiling fan|marine blue)/i.test(prompt)) {
    out.hvac = {
      ...(out.hvac ?? {}),
      enabled: true,
      ceilingFansEnabled: /(ceiling fan|tropical|maldives)/i.test(prompt)
        ? true
        : (out.hvac?.ceilingFansEnabled ?? false),
    };
  }

  if (/(no solar|remove solar|disable solar|solar off)/i.test(prompt)) {
    out.solar = { enabled: false };
  } else if (/(solar|pv\b|photovoltaic|inverter|bess|battery)/i.test(prompt)) {
    const kwMatch = lower.match(/(\d+(?:\.\d+)?)\s*kwp?\b/);
    const panelMatch = lower.match(/(\d+)\s*(?:panel|panels|module|modules)/);
    const kwhMatch = lower.match(/(\d+)\s*kwh\b/);
    const panelCount = panelMatch
      ? Math.max(4, Math.min(24, parseInt(panelMatch[1], 10)))
      : kwMatch
      ? Math.max(4, Math.min(24, Math.round((parseFloat(kwMatch[1]) * 1000) / 450)))
      : 12;
    const batteryKWh = kwhMatch ? Math.max(0, Math.min(20, parseInt(kwhMatch[1], 10))) : 10;
    const inverterKW = Math.max(5, Math.min(10, Math.ceil((panelCount * 450) / 1000)));
    out.solar = { enabled: true, panelCount, inverterKW, batteryKWh };
  }

  return out;
}

function buildProjectFromSpec(
  spec: {
    title: string;
    prompt: string;
    width: number;
    depth: number;
    stories: number;
    bedrooms: number;
    hasGarage: boolean;
    hasOffice: boolean;
    roofType: RoofType;
    pitchDeg: number;
    roofMaterial: RoofMaterial;
    wallMaterial?: WallMaterial;
    design: MaterialDesignConfig;
    solar: SolarPVConfig;
    hvac?: HVACConfig;
    floorFinish?: FloorFinish;
    customLevels?: ClaudePlanLevel[];
    reasoning?: string;
    engineUsed: 'claude' | 'local' | 'gemini';
  },
  baseRates = DEFAULT_BOQ_RATES
): PromptResult {
  const levels: FloorLevel[] = [];
  let usedClaudeFloorGeometry = false;
  const hvacCfg = spec.hvac ?? getHVACConfig({} as BuildingProject);

  for (let lvlIdx = 0; lvlIdx < spec.stories; lvlIdx++) {
    const customLevel = spec.customLevels?.[lvlIdx];
    const customRects = customLevel?.rooms;
    const canUseCustom =
      Array.isArray(customRects) && validateClaudeRoomTiling(customRects, spec.width, spec.depth);
    if (canUseCustom) usedClaudeFloorGeometry = true;

    const rects = canUseCustom
      ? customRects!
      : generateArchitecturalFloorRects(
          spec.width,
          spec.depth,
          spec.stories,
          spec.bedrooms,
          spec.hasGarage,
          spec.hasOffice,
          lvlIdx
        );

    let lvl = buildLevelFromRoomRects(
      rects,
      spec.width,
      spec.depth,
      lvlIdx,
      spec.stories,
      spec.solar.enabled,
      spec.floorFinish
    );
    if (spec.wallMaterial) {
      const mat = spec.wallMaterial;
      lvl = {
        ...lvl,
        walls: lvl.walls.map((w) => ({
          ...w,
          material: mat,
          thickness: mat === 'cinder_block' ? (w.isExterior ? 0.2 : 0.15) : w.thickness,
        })),
      };
    }
    lvl = autoPopulateMEPForLevel(lvl, spec.solar.enabled, hvacCfg.enabled, hvacCfg.ceilingFansEnabled);
    if (canUseCustom && customLevel?.name) {
      lvl.name = customLevel.name;
    }
    levels.push(lvl);
  }

  const changes: string[] = [
    `Designed ${spec.stories}-story layout (${spec.width.toFixed(1)}m × ${spec.depth.toFixed(1)}m) using ${
      usedClaudeFloorGeometry ? 'Claude Spatial Reasoning Layout' : 'Central-Spine Architectural Zoning'
    }`,
    `${spec.bedrooms} bedroom program${spec.hasGarage ? ' + Garage Bay' : ''}${spec.hasOffice ? ' + Home Office' : ''} with hallway-connected doors & exterior windows`,
    `Roof: ${spec.roofType.toUpperCase()} (${spec.pitchDeg}°) with ${spec.roofMaterial.replace(/_/g, ' ')}`,
    `Materials: ${spec.wallMaterial ? `${spec.wallMaterial.replace(/_/g, ' ')} walls / ` : ''}${spec.design.exteriorFacade.replace(/_/g, ' ')} facade / ${spec.design.interiorWalls.replace(/_/g, ' ')} interior`,
  ];
  if (hvacCfg.enabled) {
    changes.push(
      `HVAC: ${hvacCfg.climateZone.replace(/_/g, ' ')} (${hvacCfg.designOutdoorTempC}°C/${hvacCfg.designHumidityPct}% RH), ${hvacCfg.condenserProtection.replace(/_/g, ' ')}${hvacCfg.ceilingFansEnabled ? ' + BLDC Ceiling Fans' : ''}`
    );
  }
  if (spec.solar.enabled) {
    changes.push(
      `Solar PV: ${spec.solar.panelCount}×${spec.solar.panelWattage}Wp (${((spec.solar.panelCount * spec.solar.panelWattage) / 1000).toFixed(1)}kWp) + ${spec.solar.inverterKW}kW Hybrid + ${spec.solar.batteryKWh}kWh BESS`
    );
  }

  return {
    project: {
      id: uid('proj'),
      meta: {
        title: spec.title.slice(0, 60),
        projectCode: 'ARC-AI-' + String(Math.floor(100 + Math.random() * 899)),
        client: 'AI Architect Specification',
        architect:
          spec.engineUsed === 'claude' ? 'ArchStudio BIM × Claude Architect' : 'ArchStudio BIM Spine Solver',
        location: 'Parametric Lot',
        revision: 'R01 - AI Engineered BIM',
        date: '2026-11-15',
        scale: '1:100 @ A1',
        plotWidth: Math.ceil(spec.width + 6),
        plotDepth: Math.ceil(spec.depth + 6),
        currency: '$',
      },
      grid: autoGenerateStructuralGrid(levels[0]),
      levels,
      roof: {
        type: spec.roofType,
        pitchDeg: spec.pitchDeg,
        overhang: 0.65,
        material: spec.roofMaterial,
        parapetHeight: 0.65,
      },
      solar: spec.solar,
      hvac: hvacCfg,
      design: spec.design,
      sections: [
        { id: 'sec_a', label: 'A-A', start: { x: -1.5, y: spec.depth * 0.45 }, end: { x: spec.width + 1.5, y: spec.depth * 0.45 } },
        { id: 'sec_b', label: 'B-B', start: { x: spec.width * 0.5, y: -1.5 }, end: { x: spec.width * 0.5, y: spec.depth + 1.5 } },
      ],
      rates: { ...baseRates },
    },
    summary: spec.reasoning
      ? spec.reasoning
      : `Generated a zoned ${spec.stories}-story ${spec.width.toFixed(1)}m × ${spec.depth.toFixed(1)}m BIM model with central circulation hallway, proper doors/windows, structural columns, MEP schematics, and live BOQ.`,
    changes,
    reasoning: spec.reasoning,
    engineUsed: spec.engineUsed,
  };
}

function synthesizeParametricHouse(prompt: string, baseRates = DEFAULT_BOQ_RATES, note?: string): PromptResult {
  const lower = prompt.toLowerCase();

  const bedMatch = lower.match(/(\d+)\s*(?:bed|bedroom|br|bhk)/);
  const bedrooms = Math.max(1, Math.min(6, bedMatch ? parseInt(bedMatch[1], 10) : 3));

  const storyMatch = lower.match(/(\d+)\s*(?:story|stories|storey|floor|floors|level)/);
  const stories =
    lower.includes('two story') || lower.includes('2 story') || lower.includes('two-story') || lower.includes('duplex')
      ? 2
      : storyMatch
      ? Math.max(1, Math.min(3, parseInt(storyMatch[1], 10)))
      : bedrooms >= 4
      ? 2
      : 1;

  const hasGarage = lower.includes('garage') || lower.includes('carport');
  const hasOffice = lower.includes('office') || lower.includes('study') || lower.includes('studio');
  const dimMatch = lower.match(/(\d+(?:\.\d+)?)\s*(?:m|meter|meters)?\s*[x×by]+\s*(\d+(?:\.\d+)?)/);

  const width = dimMatch
    ? Math.max(9.5, Math.min(28, parseFloat(dimMatch[1])))
    : Number((12 + Math.min(3, bedrooms) * 1.1 + (hasGarage ? 3.8 : 0)).toFixed(1));
  const depth = dimMatch ? Math.max(8.5, Math.min(22, parseFloat(dimMatch[2]))) : bedrooms >= 3 ? 10.8 : 9.6;

  let roofType: RoofType = 'hip';
  if (lower.includes('flat')) roofType = 'flat';
  else if (lower.includes('gable')) roofType = 'gable';
  else if (lower.includes('shed') || lower.includes('mono')) roofType = 'shed';

  const pitchMatch = lower.match(/(\d+(?:\.\d+)?)\s*(?:deg|degree|degrees|°)/);
  const pitchDeg = pitchMatch
    ? Math.max(2, Math.min(45, parseFloat(pitchMatch[1])))
    : roofType === 'flat'
    ? 2
    : roofType === 'shed'
    ? 14
    : 24;

  const extracted = extractMaterialAndSolarFromPrompt(prompt);
  const solar: SolarPVConfig = {
    ...getSolarConfig({ solar: undefined } as BuildingProject),
    ...(extracted.solar || {}),
  };
  const hvac: HVACConfig = {
    ...getHVACConfig({ hvac: undefined } as BuildingProject),
    ...(extracted.hvac || {}),
  };
  const design: MaterialDesignConfig = {
    ...getDesignConfig({ design: undefined } as BuildingProject),
    ...(extracted.exteriorFacade ? { exteriorFacade: extracted.exteriorFacade } : {}),
    ...(extracted.interiorWalls ? { interiorWalls: extracted.interiorWalls } : {}),
  };

  const res = buildProjectFromSpec(
    {
      title: `AI Generated: ${prompt.slice(0, 48)}${prompt.length > 48 ? '...' : ''}`,
      prompt,
      width,
      depth,
      stories,
      bedrooms,
      hasGarage,
      hasOffice,
      roofType,
      pitchDeg,
      roofMaterial: extracted.roofMaterial || 'standing_seam',
      wallMaterial: extracted.wallMaterial,
      design,
      solar,
      hvac,
      floorFinish: extracted.floorFinish,
      engineUsed: 'local',
    },
    baseRates
  );

  if (note) {
    res.summary = `${res.summary} ${note}`;
  }
  return res;
}

const CLAUDE_DIRECT_SYSTEM_PROMPT = `You are a Senior Licensed Architect & Structural/MEP BIM Engineer for ArchStudio BIM.
Respond with JSON ONLY matching:
{"action":"new_building"|"modify_building","reasoning":string,"title":string,"width":number,"depth":number,"stories":1|2|3,"bedrooms":number,"hasGarage":boolean,"hasOffice":boolean,"roofType":"hip"|"gable"|"flat"|"shed","pitchDeg":number,"roofMaterial":"standing_seam"|"clay_tile"|"natural_slate"|"asphalt_shingle"|"cedar_shake"|"green_roof"|"corrugated_metal"|"marine_metal"|"thatch_palm"|"concrete_slab","wallMaterial":"brick"|"cmu"|"cinder_block"|"coral_stone"|"concrete"|"timber","exteriorFacade":"white_render"|"cement_plaster"|"coral_render"|"tropical_louvres"|"exposed_brick"|"charcoal_cladding"|"stone_veneer"|"timber_slats"|"travertine_stone","interiorWalls":"matte_white"|"smooth_cement_plaster"|"teak_paneling"|"warm_beige"|"sage_green"|"venetian_plaster"|"exposed_concrete"|"oak_paneling","windowFrame":"anthracite"|"matte_black"|"bronze"|"silver_anodized"|"timber_oak","doorMaterial":"walnut"|"oak"|"matte_black"|"white_lacquer"|"frosted_glass","floorFinish":"porcelain"|"hardwood"|"herringbone_oak"|"carrara_marble"|"terrazzo","climateZone":"maldives_tropical"|"temperate"|"arid_desert"|"mediterranean","solar":{"enabled":boolean,"panelCount":number,"inverterKW":number,"batteryKWh":number},"hvac":{"enabled":boolean,"ceilingFansEnabled":boolean},"equipment":{"mdb":{"x":number,"y":number},"utility_meter":{"x":number,"y":number},"solar_inv":{"x":number,"y":number},"solar_bess":{"x":number,"y":number},"dcRouteMode":"auto"|"north_wall"|"south_wall"|"west_wall"|"east_wall"|"corridor","acRouteMode":"auto"|"north_wall"|"south_wall"|"west_wall"|"east_wall"|"corridor"},"levels":[{"name":string,"rooms":[{"name":string,"category":"living"|"kitchen"|"dining"|"bedroom"|"bathroom"|"hallway"|"garage"|"office"|"utility"|"porch","x":number,"y":number,"w":number,"h":number}]}]}
Rules: When moving electrical items (MDB, inverter, battery, meter) into an interior room or entrance/foyer, use "action":"modify_building", omit "levels", and set "equipment" coordinates inside that room's bounds. Every room inside [0,width]x[0,depth], ZERO overlaps, contiguous tiling, always include a "hallway" spine. For Maldives/tropical requests use "cinder_block", "cement_plaster", "marine_metal", and "maldives_tropical".`;

async function requestClaudePlan(
  prompt: string,
  currentProject: BuildingProject,
  llmConfig: AILLMConfig
): Promise<{ plan: ClaudeArchitecturalPlan; modelUsed: string }> {
  const g0 = currentProject.levels[0];
  const bb = g0 ? levelBoundingBox(g0) : { minX: 0, minY: 0, maxX: 14, maxY: 10, width: 14, depth: 10 };
  const roomBounds = (g0?.rooms || []).map((r) => {
    const xs = r.polygon.map((p) => p.x);
    const ys = r.polygon.map((p) => p.y);
    return {
      name: r.name,
      category: r.category,
      bounds: {
        minX: Number(Math.min(...xs).toFixed(2)),
        minY: Number(Math.min(...ys).toFixed(2)),
        maxX: Number(Math.max(...xs).toFixed(2)),
        maxY: Number(Math.max(...ys).toFixed(2)),
      },
    };
  });
  const entranceRoom =
    roomBounds.find((r) => /foyer|entrance|entry|gallery|hall/i.test(r.name) || r.category === 'hallway') ?? null;
  const coreEquip = g0 ? getCoreElectricalNodes(g0) : null;

  const projectContext = {
    title: currentProject.meta.title,
    footprintMeters: {
      minX: Number(bb.minX.toFixed(2)),
      minY: Number(bb.minY.toFixed(2)),
      maxX: Number(bb.maxX.toFixed(2)),
      maxY: Number(bb.maxY.toFixed(2)),
      width: Number(bb.width.toFixed(1)),
      depth: Number(bb.depth.toFixed(1)),
    },
    stories: currentProject.levels.length,
    roof: currentProject.roof,
    solar: getSolarConfig(currentProject),
    design: getDesignConfig(currentProject),
    entranceRoom,
    currentEquipment: coreEquip
      ? {
          mdb: coreEquip.mdb.position,
          utility_meter: coreEquip.meter.position,
          solar_inv: coreEquip.inverter.position,
          solar_bess: coreEquip.bess.position,
        }
      : null,
    levels: currentProject.levels.map((l, idx) => ({
      name: l.name,
      rooms: idx === 0 ? roomBounds : l.rooms.map((r) => r.name),
    })),
  };

  // 1. Try local Vite server middleware proxy (/api/ai/claude) so .env.local keys work without exposing to client
  const proxyResp = await fetch('/api/ai/claude', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      projectContext,
      apiKey: llmConfig.apiKey || undefined,
      model: llmConfig.model || 'claude-sonnet-4-6',
    }),
  });

  if (proxyResp.ok) {
    const payload = (await proxyResp.json()) as {
      ok: boolean;
      modelUsed: string;
      plan: ClaudeArchitecturalPlan;
    };
    return { plan: payload.plan, modelUsed: payload.modelUsed };
  }

  // Fallback for deployed static hosting where /api/ai/claude isn't mounted (requires client apiKey)
  if (proxyResp.status === 404 && llmConfig.apiKey) {
    const directResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': llmConfig.apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: llmConfig.model || 'claude-sonnet-4-6',
        max_tokens: 4096,
        system: CLAUDE_DIRECT_SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: `Current BIM:\n${JSON.stringify(projectContext)}\n\nRequest:\n"${prompt}"`,
          },
        ],
      }),
    });
    if (!directResp.ok) {
      throw new Error(`Anthropic HTTP ${directResp.status}: ${await directResp.text()}`);
    }
    const data = (await directResp.json()) as { content?: { type?: string; text?: string }[] };
    const text = (data.content || []).map((c) => c.text || '').join('\n');
    const clean = text.replace(/^```json\s*|^```\s*|```$/gm, '').trim();
    const m = clean.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('Claude response did not contain JSON.');
    return { plan: JSON.parse(m[0]) as ClaudeArchitecturalPlan, modelUsed: llmConfig.model || 'claude' };
  }

  const errJson = (await proxyResp.json().catch(() => ({}))) as { error?: string };
  throw new Error(errJson.error || `HTTP_${proxyResp.status}`);
}

function applyIncrementalBIMEdits(currentProject: BuildingProject, prompt: string): {
  next: BuildingProject;
  changes: string[];
} {
  const lower = prompt.toLowerCase().trim();
  const next: BuildingProject = structuredClone(currentProject);
  const changes: string[] = [];

  // 1. Roof changes
  if (lower.includes('gable')) {
    next.roof.type = 'gable';
    changes.push('Changed roof geometry to Gable Roof');
  } else if (lower.includes('hip')) {
    next.roof.type = 'hip';
    changes.push('Changed roof geometry to Hip Roof');
  } else if (lower.includes('flat')) {
    next.roof.type = 'flat';
    changes.push('Changed roof geometry to Flat Parapet Roof');
  } else if (lower.includes('shed')) {
    next.roof.type = 'shed';
    changes.push('Changed roof geometry to Shed / Mono-pitch Roof');
  }

  const pitchMatch = lower.match(/(\d+(?:\.\d+)?)\s*(?:deg|degree|degrees|°)/);
  if (pitchMatch) {
    next.roof.pitchDeg = Math.max(2, Math.min(45, parseFloat(pitchMatch[1])));
    changes.push(`Updated roof pitch to ${next.roof.pitchDeg}°`);
  }

  // 1b. Roofing material selection
  const roofMatRules: [RegExp, RoofMaterial, string][] = [
    [/(marine metal|pvdf|alu[- ]?zinc)/i, 'marine_metal', 'Maldives Marine PVDF Alu-Zinc'],
    [/(thatch|fangi|palm roof)/i, 'thatch_palm', 'Coconut Palm Thatch (Fangi)'],
    [/(slate)/i, 'natural_slate', 'Natural Blue-Grey Slate'],
    [/(clay|terracotta)/i, 'clay_tile', 'Terracotta Clay Tiles'],
    [/(shingle|asphalt)/i, 'asphalt_shingle', 'Architectural Shingles'],
    [/(cedar|shake)/i, 'cedar_shake', 'Cedar Wood Shakes'],
    [/(green roof|sedum|living roof)/i, 'green_roof', 'Extensive Sedum Green Roof'],
    [/(corrugated|zinc|galvalume)/i, 'corrugated_metal', 'Corrugated Zinc Profile'],
    [/(standing seam|metal roof|zinc seam)/i, 'standing_seam', 'Standing Seam Metal'],
    [/(concrete roof|concrete slab)/i, 'concrete_slab', 'RC Concrete Slab'],
  ];
  for (const [rx, mat, label] of roofMatRules) {
    if (rx.test(prompt)) {
      next.roof.material = mat;
      changes.push(`Applied roof cladding: ${label}`);
      break;
    }
  }

  // 1c. Electrical Equipment Relocation (MDB, Hybrid Inverter, BESS Battery, Utility Meter) & Wiring Routes
  const isRelocateVerb =
    /\b(move|relocate|shift|put|place|bring|install|reposition|transfer|keep|inside|interior|indoors)\b/i.test(prompt);
  const mentionsCoreEquip =
    /(electrical\s*(?:item|items|panel|panels|gear|equipment|box|boxes|board)?|mdb|main\s*db|distribution\s*board|breaker|inverter|inv\b|battery|bess|utility\s*meter|kwh\s*meter|meter)/i.test(
      prompt
    );
  const isEquipMoveRequest = isRelocateVerb && mentionsCoreEquip;

  if (isEquipMoveRequest && next.levels[0]) {
    const g0 = next.levels[0];
    const bb = levelBoundingBox(g0);
    const hasGroupWords =
      /(electrical\s*(?:item|items|equipment|gear|stuff|panel|panels|box|boxes)|all\b|everything|\betc\b)/i.test(prompt);
    const moveTargets: Array<'mdb' | 'solar_inv' | 'solar_bess' | 'utility_meter'> = [];
    if (hasGroupWords || /\b(mdb|main\s*db|distribution|breaker)\b/i.test(prompt)) moveTargets.push('mdb');
    if (hasGroupWords || /\b(inverter|inv)\b/i.test(prompt)) moveTargets.push('solar_inv');
    if (hasGroupWords || /\b(bess|battery)\b/i.test(prompt)) moveTargets.push('solar_bess');
    if (hasGroupWords || /\b(meter|kwh)\b/i.test(prompt)) moveTargets.push('utility_meter');
    if (moveTargets.length === 0) moveTargets.push('mdb', 'solar_inv', 'solar_bess', 'utility_meter');

    // Resolve target room on Ground Floor
    const wantsEntrance = /enterance|entrance|entry|foyer|lobby|vestibule|front\s*door|gallery|hall/i.test(prompt);
    const wantsInside = /inside|interior|in\s+the\s+house|indoors/i.test(prompt) || wantsEntrance;

    const findTargetRoom = (): Room | undefined => {
      const rooms = g0.rooms;
      if (wantsEntrance) {
        const foyerMatch = rooms.find(
          (r) =>
            /foyer|entrance|entry|gallery/i.test(r.name) ||
            (r.category === 'hallway' && Math.max(...r.polygon.map((p) => p.y)) >= bb.maxY - 1.5)
        );
        if (foyerMatch) return foyerMatch;
        const anyHall = rooms.find((r) => r.category === 'hallway' || /hall|corridor/i.test(r.name));
        if (anyHall) return anyHall;
      }
      const roomPatterns: [RegExp, RegExp, RoomCategory?][] = [
        [/kitchen/i, /kitchen/i, 'kitchen'],
        [/living|lounge/i, /living|lounge/i, 'living'],
        [/dining/i, /dining/i, 'dining'],
        [/study|office|flex/i, /study|office|flex/i, 'office'],
        [/utility|laundry|service|plant/i, /utility|laundry|plant/i, 'utility'],
        [/garage|carport/i, /garage|carport/i, 'garage'],
        [/master/i, /master/i, 'bedroom'],
        [/bedroom/i, /bedroom/i, 'bedroom'],
        [/bath/i, /bath/i, 'bathroom'],
        [/porch|veranda/i, /porch|veranda/i, 'porch'],
      ];
      for (const [promptRx, nameRx, cat] of roomPatterns) {
        if (promptRx.test(prompt)) {
          const hit = rooms.find((r) => nameRx.test(r.name) || (cat ? r.category === cat : false));
          if (hit) return hit;
        }
      }
      if (wantsInside) {
        return (
          rooms.find((r) => /foyer|entrance|gallery/i.test(r.name) || r.category === 'hallway') ?? rooms[0]
        );
      }
      return undefined;
    };

    const targetRoom = findTargetRoom();
    const pvRoutes = computePVAndEquipmentRoutes(next, 0);
    const pvOrigin = pvRoutes.pvCombinerPos;
    const movedLabels: string[] = [];

    if (targetRoom && targetRoom.polygon.length >= 3) {
      const xs = targetRoom.polygon.map((p) => p.x);
      const ys = targetRoom.polygon.map((p) => p.y);
      const rMinX = Math.min(...xs);
      const rMaxX = Math.max(...xs);
      const rMinY = Math.min(...ys);
      const rMaxY = Math.max(...ys);
      const rW = rMaxX - rMinX;
      const rD = rMaxY - rMinY;
      const wallInset = 0.28;

      const preferNorth = /\bnorth|back|rear\b/i.test(prompt);
      const preferSouth = /\bsouth|front\b/i.test(prompt);
      const preferEast = /\beast|right\b/i.test(prompt);
      const preferWest = /\bwest|left\b/i.test(prompt);

      const useHorizWall = preferNorth || preferSouth || (!preferEast && !preferWest && rW > rD + 0.6);
      const count = moveTargets.length;

      moveTargets.forEach((kind, idx) => {
        let px: number;
        let py: number;
        if (useHorizWall) {
          const usableW = Math.max(0.4, rW - 0.8);
          const spacing = Math.min(0.65, usableW / Math.max(1, count));
          const startX = rMinX + Math.max(0.42, (rW - spacing * (count - 1)) / 2);
          px = Math.min(rMaxX - 0.3, Math.max(rMinX + 0.3, startX + idx * spacing));
          py = preferSouth ? rMaxY - wallInset : rMinY + wallInset;
        } else {
          // Place along the room's clear interior side wall away from South front entry door
          const usableD = Math.max(0.4, rD - 1.25);
          const spacing = Math.min(0.65, usableD / Math.max(1, count));
          const startY = rMinY + 0.55;
          px = preferEast ? rMaxX - wallInset : rMinX + wallInset;
          py = Math.min(rMaxY - 0.55, Math.max(rMinY + 0.35, startY + idx * spacing));
        }
        relocateMEPNode(g0, kind, { x: Number(px.toFixed(2)), y: Number(py.toFixed(2)) }, pvOrigin);
        movedLabels.push(`${kind === 'mdb' ? 'MDB-1' : kind === 'solar_inv' ? 'HYB-INV' : kind === 'solar_bess' ? 'BESS' : 'KWH-MTR'} (${px.toFixed(2)}m, ${py.toFixed(2)}m)`);
      });

      const curSolar = getSolarConfig(next);
      next.solar = {
        ...curSolar,
        dcWaypoints: undefined,
        acWaypoints: undefined,
      };
      changes.push(`Moved ${movedLabels.join(', ')} inside ${targetRoom.name}`);
    } else {
      // Cardinal exterior/interior wall fallback when no specific room matched
      const side: 'west' | 'north' | 'east' | 'south' = /\bnorth\b/i.test(prompt)
        ? 'north'
        : /\beast\b/i.test(prompt)
        ? 'east'
        : /\bsouth\b/i.test(prompt)
        ? 'south'
        : 'west';
      const insetSign = wantsInside ? 0.32 : -0.14;
      moveTargets.forEach((kind, idx) => {
        const slot = 0.65 + idx * 0.72;
        const pos =
          side === 'west'
            ? { x: bb.minX + insetSign, y: bb.minY + slot }
            : side === 'east'
            ? { x: bb.maxX - insetSign, y: bb.minY + slot }
            : side === 'north'
            ? { x: bb.minX + slot, y: bb.minY + insetSign }
            : { x: (bb.minX + bb.maxX) / 2 - 1.1 + idx * 0.65, y: bb.maxY - insetSign };
        relocateMEPNode(g0, kind, pos, pvOrigin);
        movedLabels.push(kind);
      });
      const curSolar = getSolarConfig(next);
      next.solar = { ...curSolar, dcWaypoints: undefined, acWaypoints: undefined };
      changes.push(`Moved ${movedLabels.join(', ')} to ${wantsInside ? 'interior ' : ''}${side} wall`);
    }
  }

  // 1d. Solar PV & Battery Storage configuration (skip sizing overwrite when prompt only relocates equipment)
  const hvacState = getHVACConfig(next);
  if (/(no solar|remove solar|disable solar|solar off)/i.test(prompt)) {
    const cur = getSolarConfig(next);
    next.solar = { ...cur, enabled: false };
    next.levels = next.levels.map((l) =>
      autoPopulateMEPForLevel(l, false, hvacState.enabled, hvacState.ceilingFansEnabled)
    );
    changes.push('Disabled Solar PV array & BESS circuits');
  } else if (
    /(solar|pv\b|photovoltaic|inverter|bess|battery)/i.test(prompt) &&
    (!isEquipMoveRequest || /\d+\s*(?:panel|panels|module|modules|kwp?|kwh)/i.test(prompt))
  ) {
    const cur = getSolarConfig(next);
    const panelMatch = lower.match(/(\d+)\s*(?:panel|panels|module|modules)/);
    const kwMatch = lower.match(/(\d+(?:\.\d+)?)\s*kwp?\b/);
    const kwhMatch = lower.match(/(\d+)\s*kwh\b/);
    let panelCount = cur.panelCount;
    if (panelMatch) {
      panelCount = Math.max(4, Math.min(24, parseInt(panelMatch[1], 10)));
    } else if (kwMatch) {
      panelCount = Math.max(4, Math.min(24, Math.round((parseFloat(kwMatch[1]) * 1000) / cur.panelWattage)));
    }
    const batteryKWh = kwhMatch ? Math.max(0, Math.min(20, parseInt(kwhMatch[1], 10))) : Math.max(10, cur.batteryKWh);
    const inverterKW = Math.max(5, Math.min(10, Math.ceil((panelCount * cur.panelWattage) / 1000)));
    next.solar = { ...cur, enabled: true, panelCount, inverterKW, batteryKWh };
    next.levels = next.levels.map((l) =>
      autoPopulateMEPForLevel(l, true, hvacState.enabled, hvacState.ceilingFansEnabled)
    );
    changes.push(
      `Configured Solar PV System (${panelCount}×${cur.panelWattage}Wp = ${((panelCount * cur.panelWattage) / 1000).toFixed(1)}kWp, ${inverterKW}kW Hybrid Inverter, ${batteryKWh}kWh BESS) in SLD & Wiring`
    );
  }

  // 1d. Exterior facade, Maldives cinder block masonry & interior finishes
  const curDesign = getDesignConfig(next);
  let designChanged = false;
  const facadeRules: [RegExp, ExteriorFacadeMaterial, string][] = [
    [/(cement plaster|sand[- ]?cement|plastering)/i, 'cement_plaster', 'Sand-Cement Trowel Plaster'],
    [/(coral[- ]?(?:lime|render)|whitewash)/i, 'coral_render', 'Maldivian Coral-Lime Whitewash'],
    [/(tropical louvre|teak louvre|monsoon louvre)/i, 'tropical_louvres', 'Tropical Monsoon Teak Louvres'],
    [/(exposed brick|brick facade|red brick)/i, 'exposed_brick', 'Exposed Kiln Brick'],
    [/(stone veneer|ashlar|limestone)/i, 'stone_veneer', 'Stacked Ashlar Stone Veneer'],
    [/(timber slat|wood facade|cedar cladding)/i, 'timber_slats', 'Vertical Cedar Timber Slats'],
    [/(travertine)/i, 'travertine_stone', 'Honed Roman Travertine'],
    [/(charcoal cladding|zinc facade|dark cladding)/i, 'charcoal_cladding', 'Charcoal Metal Rainscreen'],
    [/(white render|stucco|plaster facade)/i, 'white_render', 'Architectural White Render'],
  ];
  for (const [rx, mat, label] of facadeRules) {
    if (rx.test(prompt)) {
      curDesign.exteriorFacade = mat;
      designChanged = true;
      changes.push(`Applied exterior facade material: ${label}`);
      break;
    }
  }
  const intWallRules: [RegExp, InteriorWallMaterial, string][] = [
    [/(smooth cement|skim[- ]?coat)/i, 'smooth_cement_plaster', 'Smooth Skim-Coat Cement Plaster'],
    [/(teak panel|maldivian teak)/i, 'teak_paneling', 'Maldivian Teak & Breeze Slat'],
    [/(oak panel|wood panel|fluted oak)/i, 'oak_paneling', 'Fluted Acoustic Oak Panelling'],
    [/(sage green|sage wall)/i, 'sage_green', 'Architectural Sage Matte'],
    [/(venetian|limewash)/i, 'venetian_plaster', 'Venetian Limewash Plaster'],
    [/(warm beige|greige)/i, 'warm_beige', 'Warm Greige Satin'],
    [/(exposed concrete|board[- ]formed)/i, 'exposed_concrete', 'Board-Formed Concrete'],
    [/(matte white|white interior)/i, 'matte_white', 'Gallery Matte White'],
  ];
  for (const [rx, mat, label] of intWallRules) {
    if (rx.test(prompt)) {
      curDesign.interiorWalls = mat;
      designChanged = true;
      changes.push(`Applied interior wall finish: ${label}`);
      break;
    }
  }
  if (designChanged) {
    next.design = curDesign;
  }

  // 1e. Wall Masonry & Maldives Climate / HVAC Standards
  const extractedMore = extractMaterialAndSolarFromPrompt(prompt);
  if (extractedMore.wallMaterial) {
    const wm = extractedMore.wallMaterial;
    next.levels = next.levels.map((l) => ({
      ...l,
      walls: l.walls.map((w) => ({
        ...w,
        material: wm,
        thickness: wm === 'cinder_block' ? (w.isExterior ? 0.2 : 0.15) : w.thickness,
      })),
    }));
    changes.push(`Updated structural wall masonry to ${wm.replace(/_/g, ' ')}`);
  }
  if (extractedMore.hvac) {
    const mergedHvac: HVACConfig = { ...getHVACConfig(next), ...extractedMore.hvac };
    next.hvac = mergedHvac;
    const solOn = getSolarConfig(next).enabled;
    next.levels = next.levels.map((l) =>
      autoPopulateMEPForLevel(l, solOn, mergedHvac.enabled, mergedHvac.ceilingFansEnabled)
    );
    changes.push(
      `Configured HVAC (${mergedHvac.climateZone.replace(/_/g, ' ')} · ${mergedHvac.condenserProtection.replace(/_/g, ' ')}${mergedHvac.ceilingFansEnabled ? ' + BLDC Ceiling Fans' : ''})`
    );
  }

  const floorRules: [RegExp, FloorFinish, string][] = [
    [/(carrara|marble floor)/i, 'carrara_marble', 'Carrara Honed Marble'],
    [/(herringbone)/i, 'herringbone_oak', 'Herringbone Parquet Oak'],
    [/(terrazzo)/i, 'terrazzo', 'Venetian Terrazzo'],
    [/(hardwood|oak floor|wood floor)/i, 'hardwood', 'Wide-Plank European Oak'],
    [/(porcelain)/i, 'porcelain', 'Large-Format Porcelain'],
  ];
  for (const [rx, fin, label] of floorRules) {
    if (rx.test(prompt)) {
      next.levels = next.levels.map((l) => ({
        ...l,
        rooms: l.rooms.map((rm) =>
          rm.category !== 'bathroom' && rm.category !== 'garage' ? { ...rm, finish: fin } : rm
        ),
      }));
      changes.push(`Updated dry-room floor finish to ${label}`);
      break;
    }
  }

  // 2. Wall thickness / height adjustments
  const thickMatch = lower.match(/(\d+)\s*mm\s*(?:wall|thick|exterior)/);
  if (thickMatch) {
    const t = Math.max(0.1, Math.min(0.45, parseInt(thickMatch[1], 10) / 1000));
    next.levels = next.levels.map((l) => ({
      ...l,
      walls: l.walls.map((w) => (w.isExterior ? { ...w, thickness: t } : w)),
    }));
    changes.push(`Set exterior masonry wall thickness to ${Math.round(t * 1000)}mm`);
  }

  const ceilingMatch = lower.match(/(?:ceiling|wall height|floor height)\s*(?:to)?\s*(\d+(?:\.\d+)?)\s*m/);
  if (ceilingMatch) {
    const h = Math.max(2.4, Math.min(4.8, parseFloat(ceilingMatch[1])));
    next.levels = next.levels.map((l) => ({
      ...l,
      floorToFloorHeight: Number((h + l.slabThickness).toFixed(2)),
      walls: l.walls.map((w) => ({ ...w, height: h })),
    }));
    changes.push(`Updated clear floor-to-ceiling height to ${h.toFixed(2)}m`);
  }

  // 3. Scale building footprint
  const scaleMatch = lower.match(/scale\s*(?:by)?\s*(\d+(?:\.\d+)?)/);
  if (scaleMatch) {
    const factor = Math.max(0.6, Math.min(2.0, parseFloat(scaleMatch[1])));
    next.levels = next.levels.map((l) => ({
      ...l,
      walls: l.walls.map((w) => ({
        ...w,
        start: { x: Number((w.start.x * factor).toFixed(2)), y: Number((w.start.y * factor).toFixed(2)) },
        end: { x: Number((w.end.x * factor).toFixed(2)), y: Number((w.end.y * factor).toFixed(2)) },
      })),
      rooms: l.rooms.map((r) => ({
        ...r,
        polygon: r.polygon.map((p) => ({
          x: Number((p.x * factor).toFixed(2)),
          y: Number((p.y * factor).toFixed(2)),
        })),
      })),
      columns: l.columns.map((c) => ({
        ...c,
        position: { x: Number((c.position.x * factor).toFixed(2)), y: Number((c.position.y * factor).toFixed(2)) },
      })),
    }));
    changes.push(`Scaled structural footprint and rooms by ${factor}×`);
  }

  // 4. Add a room extension on East/South
  if (
    lower.includes('add') &&
    (lower.includes('room') ||
      lower.includes('study') ||
      lower.includes('office') ||
      lower.includes('garage') ||
      lower.includes('porch') ||
      lower.includes('bedroom') ||
      lower.includes('bath'))
  ) {
    const g = next.levels[0];
    const bb = levelBoundingBox(g);
    const dim = lower.match(/(\d+(?:\.\d+)?)\s*[x×by]+\s*(\d+(?:\.\d+)?)/);
    const rw = dim ? parseFloat(dim[1]) : 4.0;
    const rd = dim ? parseFloat(dim[2]) : 3.8;

    let cat: RoomCategory = 'office';
    let rName = 'Study Extension';
    if (lower.includes('garage')) {
      cat = 'garage';
      rName = 'Garage Bay';
    } else if (lower.includes('bedroom')) {
      cat = 'bedroom';
      rName = 'Bedroom Extension';
    } else if (lower.includes('bath')) {
      cat = 'bathroom';
      rName = 'New Bathroom';
    } else if (lower.includes('porch')) {
      cat = 'porch';
      rName = 'Covered Porch';
    }

    const onSouth = lower.includes('south') || lower.includes('front');
    const x0 = onSouth ? bb.minX : bb.maxX;
    const y0 = onSouth ? bb.maxY : bb.minY;
    const extWalls = onSouth
      ? [
          createWall(x0, y0, x0, y0 + rd, true),
          createWall(x0, y0 + rd, x0 + rw, y0 + rd, true),
          createWall(x0 + rw, y0 + rd, x0 + rw, y0, true),
        ]
      : [
          createWall(x0, y0, x0 + rw, y0, true),
          createWall(x0 + rw, y0, x0 + rw, y0 + rd, true),
          createWall(x0 + rw, y0 + rd, x0, y0 + rd, true),
        ];

    g.walls.push(...extWalls);
    g.openings.push({
      id: uid('op'),
      wallId: extWalls[1].id,
      kind: cat === 'garage' ? 'door' : 'window',
      style: cat === 'garage' ? 'garage' : 'casement',
      offset: 0.5,
      width: cat === 'garage' ? Math.min(3.0, rw * 0.75) : 1.5,
      height: cat === 'garage' ? 2.2 : 1.4,
      sillHeight: cat === 'garage' ? 0 : 0.85,
      swingDirection: 1,
      label: cat === 'garage' ? 'DG' : 'W2',
    });
    g.rooms.push(addRoomObj(rName, cat, x0, y0, rw, rd));
    g.columns = autoPlaceStructuralColumns(g);
    next.levels[0] = autoPopulateMEPForLevel(g, getSolarConfig(next).enabled);
    next.grid = autoGenerateStructuralGrid(next.levels[0]);
    changes.push(`Added ${rName} (${rw.toFixed(1)}m × ${rd.toFixed(1)}m) on ${onSouth ? 'South' : 'East'} facade`);
  }

  // 5. Add a second floor
  if (lower.includes('second floor') || lower.includes('add floor') || lower.includes('add another story')) {
    if (next.levels.length < 3) {
      const top = next.levels[next.levels.length - 1];
      let cloned: FloorLevel = structuredClone(top);
      cloned.id = `lvl_${next.levels.length}`;
      cloned.index = next.levels.length;
      cloned.name = next.levels.length === 1 ? 'First Floor' : `Floor ${next.levels.length + 1}`;
      cloned.elevation = Number((top.elevation + top.floorToFloorHeight).toFixed(2));
      cloned.rooms = cloned.rooms.map((r, i) => ({
        ...r,
        id: uid('rm'),
        name: r.category === 'living' ? 'Upper Lounge' : `Upper Room ${i + 1}`,
        category: r.category === 'kitchen' || r.category === 'living' ? 'bedroom' : r.category,
      }));
      cloned = autoPopulateMEPForLevel(cloned, getSolarConfig(next).enabled);
      next.levels.push(cloned);
      changes.push(`Added ${cloned.name} at elevation +${cloned.elevation.toFixed(2)}m`);
    }
  }

  // 6. Auto MEP or structural column refresh (never overwrite explicitly relocated equipment)
  if (!isEquipMoveRequest && (lower.includes('mep') || lower.includes('electrical') || lower.includes('plumbing') || lower.includes('schematic'))) {
    next.levels = next.levels.map((l) => autoPopulateMEPForLevel(l, getSolarConfig(next).enabled));
    changes.push('Regenerated Electrical circuits, Solar PV and Plumbing fixture routing across all floors');
  }

  return { next, changes };
}

export async function runPromptArchitect(
  currentProject: BuildingProject,
  prompt: string,
  llmConfig?: AILLMConfig
): Promise<PromptResult> {
  const lower = prompt.toLowerCase().trim();

  const wantsNewHouse =
    (lower.includes('create') ||
      lower.includes('design') ||
      lower.includes('generate') ||
      lower.includes('build a') ||
      lower.includes('new house') ||
      lower.includes('villa') ||
      lower.includes('bungalow') ||
      lower.includes('bhk') ||
      lower.includes('bedroom house')) &&
    !lower.includes('add a room') &&
    !lower.includes('add room') &&
    !lower.includes('add second floor') &&
    !lower.includes('add a second floor');

  // 1. Anthropic Claude Architectural Reasoning Engine
  if (!llmConfig || llmConfig.provider === 'claude') {
    try {
      const { plan, modelUsed } = await requestClaudePlan(prompt, currentProject, llmConfig || { provider: 'claude' });
      const isModifyVerb = /\b(move|relocate|shift|put|place|bring|reposition|change|update|modify|route|add)\b/i.test(
        prompt
      );
      const action =
        !wantsNewHouse && isModifyVerb && currentProject.levels[0].walls.length > 0
          ? 'modify_building'
          : plan.action || (wantsNewHouse ? 'new_building' : 'modify_building');

      if (action === 'new_building' || currentProject.levels[0].walls.length === 0) {
        const width = Math.max(9.5, Math.min(30, Number(plan.width) || 14));
        const depth = Math.max(8.5, Math.min(24, Number(plan.depth) || 10.8));
        const stories = Math.max(1, Math.min(3, Math.round(Number(plan.stories) || 1)));
        const bedrooms = Math.max(1, Math.min(6, Math.round(Number(plan.bedrooms) || 3)));
        const roofType: RoofType = plan.roofType || 'hip';
        const pitchDeg = Math.max(
          2,
          Math.min(45, Number(plan.pitchDeg) || (roofType === 'flat' ? 2 : roofType === 'shed' ? 14 : 24))
        );

        const defaultSolar = getSolarConfig(currentProject);
        const solar: SolarPVConfig = {
          ...defaultSolar,
          enabled: plan.solar?.enabled ?? defaultSolar.enabled,
          panelCount: Math.max(4, Math.min(24, Number(plan.solar?.panelCount) || defaultSolar.panelCount)),
          inverterKW: Math.max(5, Math.min(10, Number(plan.solar?.inverterKW) || defaultSolar.inverterKW)),
          batteryKWh: Math.max(0, Math.min(20, Number(plan.solar?.batteryKWh ?? defaultSolar.batteryKWh))),
        };
        const defaultDesign = getDesignConfig(currentProject);
        const design: MaterialDesignConfig = {
          exteriorFacade: plan.exteriorFacade || defaultDesign.exteriorFacade,
          interiorWalls: plan.interiorWalls || defaultDesign.interiorWalls,
          windowFrame: plan.windowFrame || defaultDesign.windowFrame,
          doorMaterial: plan.doorMaterial || defaultDesign.doorMaterial,
        };
        const isMaldivesPlan = plan.climateZone === 'maldives_tropical' || /maldives|tropical|island/i.test(prompt);
        const hvac: HVACConfig = isMaldivesPlan
          ? {
              ...MALDIVES_HVAC_CONFIG,
              enabled: plan.hvac?.enabled ?? true,
              ceilingFansEnabled: plan.hvac?.ceilingFansEnabled ?? true,
            }
          : {
              ...getHVACConfig(currentProject),
              ...(plan.climateZone ? { climateZone: plan.climateZone } : {}),
              ...(plan.hvac || {}),
            };

        const built = buildProjectFromSpec(
          {
            title: plan.title || `Claude BIM: ${prompt.slice(0, 44)}`,
            prompt,
            width,
            depth,
            stories,
            bedrooms,
            hasGarage: Boolean(plan.hasGarage),
            hasOffice: Boolean(plan.hasOffice),
            roofType,
            pitchDeg,
            roofMaterial: plan.roofMaterial || (isMaldivesPlan ? 'marine_metal' : 'standing_seam'),
            wallMaterial: plan.wallMaterial || (isMaldivesPlan ? 'cinder_block' : undefined),
            design,
            solar,
            hvac,
            floorFinish: plan.floorFinish,
            customLevels: plan.levels,
            reasoning: plan.reasoning,
            engineUsed: 'claude',
          },
          currentProject.rates
        );
        built.changes.unshift(`Reasoned by ${modelUsed}`);
        return built;
      }

      // Modify existing project guided by Claude reasoning + incremental solver
      const { next, changes } = applyIncrementalBIMEdits(currentProject, prompt);
      if (plan.roofType) next.roof.type = plan.roofType;
      if (plan.pitchDeg) next.roof.pitchDeg = Math.max(2, Math.min(45, plan.pitchDeg));
      if (plan.roofMaterial) next.roof.material = plan.roofMaterial;

      const curDesign = getDesignConfig(next);
      next.design = {
        exteriorFacade: plan.exteriorFacade || curDesign.exteriorFacade,
        interiorWalls: plan.interiorWalls || curDesign.interiorWalls,
        windowFrame: plan.windowFrame || curDesign.windowFrame,
        doorMaterial: plan.doorMaterial || curDesign.doorMaterial,
      };
      if (plan.solar) {
        const curSolar = getSolarConfig(next);
        const solarToggleChanged = plan.solar.enabled !== undefined && plan.solar.enabled !== curSolar.enabled;
        next.solar = {
          ...curSolar,
          enabled: plan.solar.enabled ?? curSolar.enabled,
          panelCount: plan.solar.panelCount ?? curSolar.panelCount,
          inverterKW: plan.solar.inverterKW ?? curSolar.inverterKW,
          batteryKWh: plan.solar.batteryKWh ?? curSolar.batteryKWh,
        };
        if (solarToggleChanged) {
          next.levels = next.levels.map((l) => autoPopulateMEPForLevel(l, next.solar!.enabled));
        }
      }
      if (plan.equipment && next.levels[0]) {
        const g0 = next.levels[0];
        const bb0 = levelBoundingBox(g0);
        const pvOrigin = computePVAndEquipmentRoutes(next, 0).pvCombinerPos;
        const alreadyMovedLocally = changes.some((c) => c.startsWith('Moved '));
        const mustBeInside = /inside|interior|enterance|entrance|entry|foyer|in\s+the\s+house|indoors/i.test(prompt);
        const clampIfInside = (pt: { x: number; y: number }) =>
          mustBeInside
            ? {
                x: Math.min(bb0.maxX - 0.3, Math.max(bb0.minX + 0.3, pt.x)),
                y: Math.min(bb0.maxY - 0.3, Math.max(bb0.minY + 0.3, pt.y)),
              }
            : pt;
        if (!alreadyMovedLocally) {
          const eqEntries: Array<['mdb' | 'utility_meter' | 'solar_inv' | 'solar_bess', { x: number; y: number } | undefined]> = [
            ['mdb', plan.equipment.mdb],
            ['utility_meter', plan.equipment.utility_meter],
            ['solar_inv', plan.equipment.solar_inv],
            ['solar_bess', plan.equipment.solar_bess],
          ];
          const applied: string[] = [];
          for (const [k, pos] of eqEntries) {
            if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
              const finalPos = clampIfInside(pos);
              relocateMEPNode(g0, k, finalPos, pvOrigin);
              applied.push(`${k}(${finalPos.x.toFixed(1)},${finalPos.y.toFixed(1)})`);
            }
          }
          if (applied.length > 0) {
            next.solar = { ...getSolarConfig(next), dcWaypoints: undefined, acWaypoints: undefined };
            changes.push(`Claude positioned equipment: ${applied.join(', ')}`);
          }
        }
        if (plan.equipment.dcRouteMode || plan.equipment.acRouteMode) {
          next.solar = {
            ...getSolarConfig(next),
            ...(plan.equipment.dcRouteMode ? { dcRouteMode: plan.equipment.dcRouteMode, dcWaypoints: undefined } : {}),
            ...(plan.equipment.acRouteMode ? { acRouteMode: plan.equipment.acRouteMode, acWaypoints: undefined } : {}),
          };
          changes.push('Updated AI conduit route presets');
        }
      }
      if (plan.floorFinish) {
        next.levels = next.levels.map((l) => ({
          ...l,
          rooms: l.rooms.map((rm) =>
            rm.category !== 'bathroom' && rm.category !== 'garage' ? { ...rm, finish: plan.floorFinish! } : rm
          ),
        }));
      }

      if (changes.length === 0) {
        changes.push(`Applied Claude architectural reasoning (${modelUsed})`);
      }

      return {
        project: next,
        summary:
          changes.length > 0 ? changes.join('. ') + '.' : plan.reasoning || `Applied architectural modifications (${modelUsed}).`,
        changes,
        reasoning: plan.reasoning,
        engineUsed: 'claude',
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isNoKey = msg.includes('NO_CLAUDE_KEY');
      const fallbackNote = isNoKey
        ? '(Local Architectural Spine Solver active — add your Claude API key in Config for LLM reasoning.)'
        : `(Claude API fallback to Local Solver: ${msg.slice(0, 120)})`;

      if (wantsNewHouse || currentProject.levels[0].walls.length === 0) {
        return synthesizeParametricHouse(prompt, currentProject.rates, fallbackNote);
      }
      const { next, changes } = applyIncrementalBIMEdits(currentProject, prompt);
      if (changes.length === 0) {
        next.levels = next.levels.map((l) => {
          const withCols = { ...l, columns: autoPlaceStructuralColumns(l) };
          return autoPopulateMEPForLevel(withCols, getSolarConfig(next).enabled);
        });
        next.grid = autoGenerateStructuralGrid(next.levels[0]);
        changes.push(`Synchronized structural grid, columns, and MEP routing for "${prompt}"`);
      }
      return {
        project: next,
        summary: `${changes.join('. ')}. ${fallbackNote}`,
        changes,
        engineUsed: 'local',
      };
    }
  }

  // 2. Optional Gemini engine
  if (llmConfig && llmConfig.provider === 'gemini' && llmConfig.apiKey) {
    try {
      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${llmConfig.model || 'gemini-2.0-flash'}:generateContent?key=${llmConfig.apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  {
                    text: `Extract architectural parameters as JSON ONLY (no markdown) for prompt: "${prompt}". Fields: {"action":"new"|"edit","bedrooms":number,"stories":number,"width":number,"depth":number,"roof":"gable"|"hip"|"flat"|"shed","pitchDeg":number,"hasGarage":boolean,"hasOffice":boolean}`,
                  },
                ],
              },
            ],
          }),
        }
      );
      if (resp.ok) {
        const json = await resp.json();
        const text = json?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const cleaned = text.replace(/```json|```/g, '').trim();
        const parsed = JSON.parse(cleaned);
        if (parsed.action === 'new') {
          const synthPrompt = `${parsed.bedrooms || 3} bedroom ${parsed.stories || 1} story ${parsed.width || 13}x${parsed.depth || 10}m house with ${parsed.roof || 'hip'} roof ${parsed.hasGarage ? 'garage' : ''} ${parsed.hasOffice ? 'office' : ''}`;
          return synthesizeParametricHouse(synthPrompt, currentProject.rates);
        }
      }
    } catch {
      // Fallback cleanly to deterministic local BIM engine
    }
  }

  if (wantsNewHouse || currentProject.levels[0].walls.length === 0) {
    return synthesizeParametricHouse(prompt, currentProject.rates);
  }

  const { next, changes } = applyIncrementalBIMEdits(currentProject, prompt);
  if (changes.length === 0) {
    next.levels = next.levels.map((l) => {
      const withCols = { ...l, columns: autoPlaceStructuralColumns(l) };
      return autoPopulateMEPForLevel(withCols, getSolarConfig(next).enabled);
    });
    next.grid = autoGenerateStructuralGrid(next.levels[0]);
    changes.push(`Synchronized structural grid, columns, and MEP routing for "${prompt}"`);
  }

  return {
    project: next,
    summary: changes.join('. ') + '.',
    changes,
    engineUsed: 'local',
  };
}
