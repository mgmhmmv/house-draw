import {
  BOQRateConfig,
  BuildingProject,
  FloorLevel,
  FurnitureItem,
  MALDIVES_HVAC_CONFIG,
  Opening,
  Point2D,
  Room,
  RoomCategory,
  Wall,
} from './types';
import {
  autoGenerateStructuralGrid,
  autoPlaceStructuralColumns,
  snapPoint,
  uid,
} from '../engine/geometry';
import { autoPopulateMEPForLevel } from '../engine/mepEngine';

export const DEFAULT_BOQ_RATES: BOQRateConfig = {
  siteClearingPerM2: 4.5,
  excavationPerM3: 18,
  pccBlindingPerM3: 95,
  footingConcretePerM3: 145,
  superConcretePerM3: 165,
  rebarPerKg: 1.45,
  formworkPerM2: 28,
  brickWallPerM3: 155,
  partitionWallPerM2: 42,
  plasterPerM2: 14,
  paintPerM2: 11,
  tileFloorPerM2: 48,
  hardwoodFloorPerM2: 75,
  roofStructurePerM2: 52,
  roofCladdingPerM2: 44,
  doorUnit: 420,
  windowPerM2: 265,
  electricalPoint: 95,
  plumbingPoint: 210,
};

function makeWall(
  id: string,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  isExterior: boolean,
  height = 3.05
): Wall {
  return {
    id,
    start: { x: x1, y: y1 },
    end: { x: x2, y: y2 },
    thickness: isExterior ? 0.23 : 0.12,
    height,
    isExterior,
    isLoadBearing: isExterior,
    material: isExterior ? 'brick' : 'cmu',
  };
}

function makeDoor(
  wallId: string,
  offset: number,
  width = 0.9,
  style: Opening['style'] = 'single',
  swing: 1 | -1 = 1,
  label = 'D1'
): Opening {
  return {
    id: uid('op'),
    wallId,
    kind: 'door',
    style,
    offset,
    width,
    height: 2.15,
    sillHeight: 0,
    swingDirection: swing,
    label,
  };
}

function makeWindow(
  wallId: string,
  offset: number,
  width = 1.6,
  style: Opening['style'] = 'casement',
  sill = 0.9,
  height = 1.35,
  label = 'W1'
): Opening {
  return {
    id: uid('op'),
    wallId,
    kind: 'window',
    style,
    offset,
    width,
    height,
    sillHeight: sill,
    swingDirection: 1,
    label,
  };
}

function rectPoly(x: number, y: number, w: number, h: number): Point2D[] {
  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];
}

function makeRoom(
  name: string,
  category: RoomCategory,
  x: number,
  y: number,
  w: number,
  h: number,
  finish: Room['finish'] = 'porcelain',
  ceilingHeight = 3.0
): Room {
  return {
    id: uid('rm'),
    name,
    category,
    polygon: rectPoly(x, y, w, h),
    finish,
    ceilingHeight,
  };
}

export function createModernCourtyardHouse(): BuildingProject {
  // 14.0m x 11.0m Single-Story Modern 3-Bedroom Courtyard Residence
  const wNorth = makeWall('w_n', 0, 0, 14, 0, true);
  const wEast = makeWall('w_e', 14, 0, 14, 11, true);
  const wSouth = makeWall('w_s', 14, 11, 0, 11, true);
  const wWest = makeWall('w_w', 0, 11, 0, 0, true);

  // Interior walls
  const wMidY = makeWall('w_mid_y', 0, 5.5, 14, 5.5, false);
  wMidY.isLoadBearing = true;
  wMidY.thickness = 0.15;

  const wKitDiv = makeWall('w_kit', 5.5, 0, 5.5, 5.5, false);
  const wMasterDiv = makeWall('w_mstr', 9.5, 0, 9.5, 5.5, false);
  const wEnsDiv = makeWall('w_ens', 9.5, 3.3, 14, 3.3, false);

  const wBed2Div = makeWall('w_bed2', 4.5, 5.5, 4.5, 11, false);
  const wHallDiv = makeWall('w_hall', 7.5, 5.5, 7.5, 11, false);
  const wBath2Div = makeWall('w_bath2', 7.5, 8.2, 10.5, 8.2, false);
  const wBed3Div = makeWall('w_bed3', 10.5, 5.5, 10.5, 11, false);

  const walls = [
    wNorth,
    wEast,
    wSouth,
    wWest,
    wMidY,
    wKitDiv,
    wMasterDiv,
    wEnsDiv,
    wBed2Div,
    wHallDiv,
    wBath2Div,
    wBed3Div,
  ];

  const openings: Opening[] = [
    // Front main entrance on South wall (foyer)
    makeDoor(wSouth.id, 0.56, 1.3, 'double', -1, 'D0'),
    // Living windows
    makeWindow(wNorth.id, 0.18, 2.4, 'picture', 0.45, 1.9, 'W1'),
    makeWindow(wWest.id, 0.72, 2.2, 'sliding', 0.55, 1.8, 'W1'),
    // Kitchen window
    makeWindow(wNorth.id, 0.52, 1.6, 'sliding', 1.05, 1.2, 'W2'),
    // Master bedroom windows
    makeWindow(wNorth.id, 0.84, 2.0, 'casement', 0.75, 1.5, 'W1'),
    makeWindow(wEast.id, 0.16, 1.4, 'casement', 0.85, 1.4, 'W2'),
    // Ensuite small window
    makeWindow(wEast.id, 0.4, 0.8, 'casement', 1.4, 0.7, 'W3'),
    // Bed 2 & Bed 3 windows
    makeWindow(wSouth.id, 0.84, 1.8, 'casement', 0.85, 1.4, 'W2'),
    makeWindow(wSouth.id, 0.13, 1.8, 'casement', 0.85, 1.4, 'W2'),
    makeWindow(wEast.id, 0.78, 1.5, 'casement', 0.85, 1.4, 'W2'),
    // Interior doors
    makeDoor(wKitDiv.id, 0.72, 1.0, 'single', 1, 'D1'),
    makeDoor(wMidY.id, 0.62, 1.0, 'single', 1, 'D1'),
    makeDoor(wMasterDiv.id, 0.78, 0.9, 'single', 1, 'D1'),
    makeDoor(wEnsDiv.id, 0.3, 0.8, 'single', -1, 'D2'),
    makeDoor(wBed2Div.id, 0.25, 0.9, 'single', 1, 'D1'),
    makeDoor(wHallDiv.id, 0.25, 0.9, 'single', -1, 'D1'),
    makeDoor(wBath2Div.id, 0.45, 0.8, 'single', 1, 'D2'),
    makeDoor(wBed3Div.id, 0.25, 0.9, 'single', 1, 'D1'),
  ];

  const rooms: Room[] = [
    makeRoom('Living & Dining', 'living', 0, 0, 5.5, 5.5, 'porcelain'),
    makeRoom('Kitchen', 'kitchen', 5.5, 0, 4.0, 5.5, 'porcelain'),
    makeRoom('Master Suite', 'bedroom', 9.5, 0, 4.5, 3.3, 'hardwood'),
    makeRoom('En-Suite Bath', 'bathroom', 9.5, 3.3, 4.5, 2.2, 'ceramic_antiskid'),
    makeRoom('Bedroom 02', 'bedroom', 0, 5.5, 4.5, 5.5, 'hardwood'),
    makeRoom('Foyer & Gallery', 'hallway', 4.5, 5.5, 3.0, 5.5, 'porcelain'),
    makeRoom('Shared Bath', 'bathroom', 7.5, 8.2, 3.0, 2.8, 'ceramic_antiskid'),
    makeRoom('Study / Flex', 'office', 7.5, 5.5, 3.0, 2.7, 'hardwood'),
    makeRoom('Bedroom 03', 'bedroom', 10.5, 5.5, 3.5, 5.5, 'hardwood'),
  ];

  const furniture: FurnitureItem[] = [
    { id: uid('f'), type: 'sofa', position: { x: 2.3, y: 2.0 }, rotation: 0, width: 2.6, depth: 1.0 },
    { id: uid('f'), type: 'dining_table', position: { x: 2.6, y: 4.1 }, rotation: 0, width: 2.0, depth: 1.1 },
    { id: uid('f'), type: 'kitchen_counter', position: { x: 7.5, y: 0.7 }, rotation: 0, width: 3.4, depth: 0.7 },
    { id: uid('f'), type: 'bed_double', position: { x: 11.8, y: 1.5 }, rotation: 90, width: 1.8, depth: 2.1 },
    { id: uid('f'), type: 'bed_double', position: { x: 2.1, y: 8.6 }, rotation: 0, width: 1.6, depth: 2.0 },
    { id: uid('f'), type: 'bed_single', position: { x: 12.2, y: 8.5 }, rotation: 0, width: 1.2, depth: 2.0 },
    { id: uid('f'), type: 'desk', position: { x: 9.0, y: 6.6 }, rotation: 0, width: 1.5, depth: 0.7 },
  ];

  let ground: FloorLevel = {
    id: 'lvl_0',
    index: 0,
    name: 'Ground Floor Plan',
    elevation: 0.45,
    floorToFloorHeight: 3.2,
    slabThickness: 0.15,
    walls,
    openings,
    rooms,
    columns: [],
    stairs: [],
    furniture,
    mepNodes: [],
    mepCircuits: [],
  };

  ground.columns = autoPlaceStructuralColumns(ground);
  ground = autoPopulateMEPForLevel(ground);

  return {
    id: uid('proj'),
    meta: {
      title: 'Modern 3-Bedroom Courtyard Residence',
      projectCode: 'ARC-2026-01',
      client: 'Private Residential Client',
      architect: 'Maavadiyaa',
      location: 'Site Lot 14, Sector B',
      revision: 'R01 - Permit & Tender Set',
      date: '2026-11-15',
      scale: '1:100 @ A1',
      plotWidth: 20,
      plotDepth: 17,
      currency: '$',
    },
    grid: autoGenerateStructuralGrid(ground),
    levels: [ground],
    roof: {
      type: 'hip',
      pitchDeg: 24,
      overhang: 0.65,
      material: 'standing_seam',
      parapetHeight: 0.6,
    },
    sections: [
      {
        id: 'sec_a',
        label: 'A-A',
        start: { x: -1.5, y: 4.5 },
        end: { x: 15.5, y: 4.5 },
      },
      {
        id: 'sec_b',
        label: 'B-B',
        start: { x: 6.5, y: -1.5 },
        end: { x: 6.5, y: 12.5 },
      },
    ],
    rates: { ...DEFAULT_BOQ_RATES },
  };
}

export function createTwoStoryVilla(): BuildingProject {
  // Ground Floor: 15m x 11m with Living, Kitchen/Dining, Garage, Foyer, Bath, Staircase
  const gN = makeWall('gw_n', 0, 0, 15, 0, true);
  const gE = makeWall('gw_e', 15, 0, 15, 11, true);
  const gS = makeWall('gw_s', 15, 11, 0, 11, true);
  const gW = makeWall('gw_w', 0, 11, 0, 0, true);

  const gDiv1 = makeWall('gw_d1', 5.0, 0, 5.0, 11, false);
  gDiv1.isLoadBearing = true;
  gDiv1.thickness = 0.18;
  const gDiv2 = makeWall('gw_d2', 10.0, 0, 10.0, 11, false);
  gDiv2.isLoadBearing = true;
  gDiv2.thickness = 0.18;
  const gMid = makeWall('gw_m', 0, 5.5, 10.0, 5.5, false);
  const gBath = makeWall('gw_b', 5.0, 8.2, 8.0, 8.2, false);
  const gBathV = makeWall('gw_bv', 8.0, 5.5, 8.0, 11, false);

  let ground: FloorLevel = {
    id: 'lvl_0',
    index: 0,
    name: 'Ground Floor',
    elevation: 0.45,
    floorToFloorHeight: 3.3,
    slabThickness: 0.16,
    walls: [gN, gE, gS, gW, gDiv1, gDiv2, gMid, gBath, gBathV],
    openings: [
      makeDoor(gS.id, 0.48, 1.4, 'double', -1, 'D0'),
      makeDoor(gS.id, 0.15, 3.2, 'garage', -1, 'DG1'),
      makeWindow(gN.id, 0.17, 2.4, 'picture', 0.45, 2.0, 'W1'),
      makeWindow(gN.id, 0.5, 2.0, 'sliding', 0.9, 1.4, 'W2'),
      makeWindow(gW.id, 0.25, 2.0, 'picture', 0.45, 2.0, 'W1'),
      makeWindow(gW.id, 0.75, 1.8, 'casement', 0.9, 1.4, 'W2'),
      makeDoor(gDiv1.id, 0.25, 1.1, 'double', 1, 'D1'),
      makeDoor(gDiv1.id, 0.75, 1.0, 'single', 1, 'D1'),
      makeDoor(gDiv2.id, 0.75, 0.9, 'single', 1, 'D2'),
      makeDoor(gBath.id, 0.5, 0.8, 'single', -1, 'D3'),
    ],
    rooms: [
      makeRoom('Great Living Room', 'living', 0, 0, 5.0, 5.5, 'porcelain'),
      makeRoom('Dining Lounge', 'dining', 0, 5.5, 5.0, 5.5, 'porcelain'),
      makeRoom('Chef Kitchen', 'kitchen', 5.0, 0, 5.0, 5.5, 'porcelain'),
      makeRoom('Grand Foyer & Stair', 'hallway', 5.0, 5.5, 3.0, 5.5, 'porcelain'),
      makeRoom('Guest Powder Rm', 'bathroom', 5.0, 8.2, 3.0, 2.8, 'ceramic_antiskid'),
      makeRoom('Guest Suite', 'bedroom', 8.0, 5.5, 2.0, 5.5, 'hardwood'),
      makeRoom('2-Car Garage', 'garage', 10.0, 0, 5.0, 11.0, 'concrete'),
    ],
    columns: [],
    stairs: [
      {
        id: 'st_0',
        origin: { x: 5.3, y: 5.8 },
        width: 2.4,
        length: 2.2,
        direction: 'N',
        shape: 'l_shape',
        risers: 18,
      },
    ],
    furniture: [
      { id: uid('f'), type: 'sofa', position: { x: 2.4, y: 2.2 }, rotation: 0, width: 2.8, depth: 1.0 },
      { id: uid('f'), type: 'dining_table', position: { x: 2.4, y: 8.2 }, rotation: 0, width: 2.2, depth: 1.2 },
      { id: uid('f'), type: 'kitchen_counter', position: { x: 7.5, y: 0.7 }, rotation: 0, width: 3.8, depth: 0.7 },
      { id: uid('f'), type: 'car', position: { x: 12.5, y: 6.0 }, rotation: 0, width: 2.1, depth: 4.5 },
    ],
    mepNodes: [],
    mepCircuits: [],
  };
  ground.columns = autoPlaceStructuralColumns(ground);
  ground = autoPopulateMEPForLevel(ground);

  // First Floor (10m x 11m over main living block + balcony deck)
  const fN = makeWall('fw_n', 0, 0, 15, 0, true, 2.95);
  const fE = makeWall('fw_e', 15, 0, 15, 11, true, 2.95);
  const fS = makeWall('fw_s', 15, 11, 0, 11, true, 2.95);
  const fW = makeWall('fw_w', 0, 11, 0, 0, true, 2.95);
  const fDiv1 = makeWall('fw_d1', 5.0, 0, 5.0, 11, false, 2.95);
  const fDiv2 = makeWall('fw_d2', 10.0, 0, 10.0, 11, false, 2.95);
  const fMid1 = makeWall('fw_m1', 0, 5.5, 15, 5.5, false, 2.95);
  const fEns = makeWall('fw_ens', 10, 3.0, 15, 3.0, false, 2.95);

  let first: FloorLevel = {
    id: 'lvl_1',
    index: 1,
    name: 'First Floor',
    elevation: 3.75,
    floorToFloorHeight: 3.1,
    slabThickness: 0.16,
    walls: [fN, fE, fS, fW, fDiv1, fDiv2, fMid1, fEns],
    openings: [
      makeWindow(fN.id, 0.18, 2.0, 'casement', 0.85, 1.4, 'W1'),
      makeWindow(fN.id, 0.82, 2.2, 'casement', 0.85, 1.4, 'W1'),
      makeWindow(fS.id, 0.18, 2.0, 'casement', 0.85, 1.4, 'W1'),
      makeWindow(fS.id, 0.82, 2.0, 'casement', 0.85, 1.4, 'W1'),
      makeWindow(fE.id, 0.72, 2.2, 'sliding', 0.45, 1.9, 'W4'),
      makeDoor(fDiv1.id, 0.25, 0.9, 'single', 1, 'D1'),
      makeDoor(fDiv1.id, 0.75, 0.9, 'single', 1, 'D1'),
      makeDoor(fDiv2.id, 0.25, 0.9, 'single', -1, 'D1'),
      makeDoor(fDiv2.id, 0.75, 0.9, 'single', -1, 'D1'),
      makeDoor(fEns.id, 0.4, 0.8, 'single', 1, 'D2'),
    ],
    rooms: [
      makeRoom('Bedroom 02', 'bedroom', 0, 0, 5.0, 5.5, 'hardwood', 2.9),
      makeRoom('Bedroom 03', 'bedroom', 0, 5.5, 5.0, 5.5, 'hardwood', 2.9),
      makeRoom('Upper Lounge', 'hallway', 5.0, 0, 5.0, 5.5, 'hardwood', 2.9),
      makeRoom('Stair Hall & Study', 'office', 5.0, 5.5, 5.0, 5.5, 'hardwood', 2.9),
      makeRoom('Master Bath', 'bathroom', 10.0, 0, 5.0, 3.0, 'ceramic_antiskid', 2.9),
      makeRoom('Master Suite', 'bedroom', 10.0, 3.0, 5.0, 8.0, 'hardwood', 2.9),
    ],
    columns: ground.columns.map((c) => ({ ...c, id: uid('col') })),
    stairs: [
      {
        id: 'st_1',
        origin: { x: 5.3, y: 5.8 },
        width: 2.4,
        length: 2.2,
        direction: 'N',
        shape: 'l_shape',
        risers: 18,
      },
    ],
    furniture: [
      { id: uid('f'), type: 'bed_double', position: { x: 12.6, y: 7.0 }, rotation: 0, width: 1.9, depth: 2.1 },
      { id: uid('f'), type: 'bed_double', position: { x: 2.2, y: 2.4 }, rotation: 0, width: 1.6, depth: 2.0 },
      { id: uid('f'), type: 'bed_double', position: { x: 2.2, y: 8.2 }, rotation: 0, width: 1.6, depth: 2.0 },
    ],
    mepNodes: [],
    mepCircuits: [],
  };
  first = autoPopulateMEPForLevel(first);

  return {
    id: uid('proj'),
    meta: {
      title: 'Two-Story Contemporary Family Villa',
      projectCode: 'ARC-2026-02',
      client: 'Villa Horizon Development',
      architect: 'Maavadiyaa',
      location: 'Hillside Plot 08',
      revision: 'R02 - Structural & MEP Coordinated',
      date: '2026-11-15',
      scale: '1:100 @ A1',
      plotWidth: 22,
      plotDepth: 18,
      currency: '$',
    },
    grid: autoGenerateStructuralGrid(ground),
    levels: [ground, first],
    roof: {
      type: 'gable',
      pitchDeg: 22,
      overhang: 0.75,
      material: 'standing_seam',
      parapetHeight: 0.8,
    },
    sections: [
      { id: 'sec_a', label: 'A-A', start: { x: -1.5, y: 4.5 }, end: { x: 16.5, y: 4.5 } },
      { id: 'sec_b', label: 'B-B', start: { x: 7.0, y: -1.5 }, end: { x: 7.0, y: 12.5 } },
    ],
    rates: { ...DEFAULT_BOQ_RATES },
  };
}

export function createCompactEcoBungalow(): BuildingProject {
  const wN = makeWall('bw_n', 0, 0, 10, 0, true);
  const wE = makeWall('bw_e', 10, 0, 10, 8, true);
  const wS = makeWall('bw_s', 10, 8, 0, 8, true);
  const wW = makeWall('bw_w', 0, 8, 0, 0, true);

  const wDiv = makeWall('bw_d', 5.5, 0, 5.5, 8, false);
  wDiv.isLoadBearing = true;
  const wB1 = makeWall('bw_b1', 5.5, 3.5, 10, 3.5, false);
  const wB2 = makeWall('bw_b2', 5.5, 5.5, 10, 5.5, false);
  const wKit = makeWall('bw_k', 0, 4.5, 5.5, 4.5, false);

  let lvl: FloorLevel = {
    id: 'lvl_0',
    index: 0,
    name: 'Ground Floor Plan',
    elevation: 0.4,
    floorToFloorHeight: 3.1,
    slabThickness: 0.15,
    walls: [wN, wE, wS, wW, wDiv, wB1, wB2, wKit],
    openings: [
      makeDoor(wS.id, 0.72, 1.0, 'single', -1, 'D0'),
      makeWindow(wN.id, 0.25, 2.2, 'picture', 0.5, 1.8, 'W1'),
      makeWindow(wW.id, 0.3, 1.8, 'casement', 0.8, 1.4, 'W1'),
      makeWindow(wE.id, 0.2, 1.4, 'casement', 0.85, 1.3, 'W2'),
      makeWindow(wE.id, 0.8, 1.4, 'casement', 0.85, 1.3, 'W2'),
      makeDoor(wDiv.id, 0.22, 0.85, 'single', 1, 'D1'),
      makeDoor(wDiv.id, 0.56, 0.8, 'single', 1, 'D2'),
      makeDoor(wDiv.id, 0.84, 0.85, 'single', 1, 'D1'),
    ],
    rooms: [
      makeRoom('Living Studio', 'living', 0, 0, 5.5, 4.5, 'hardwood'),
      makeRoom('Eco Kitchen & Dining', 'kitchen', 0, 4.5, 5.5, 3.5, 'porcelain'),
      makeRoom('Bedroom 01', 'bedroom', 5.5, 0, 4.5, 3.5, 'hardwood'),
      makeRoom('Bath & Utility', 'bathroom', 5.5, 3.5, 4.5, 2.0, 'ceramic_antiskid'),
      makeRoom('Bedroom 02', 'bedroom', 5.5, 5.5, 4.5, 2.5, 'hardwood'),
    ],
    columns: [],
    stairs: [],
    furniture: [
      { id: uid('f'), type: 'sofa', position: { x: 2.2, y: 1.6 }, rotation: 0, width: 2.2, depth: 0.9 },
      { id: uid('f'), type: 'kitchen_counter', position: { x: 2.5, y: 7.3 }, rotation: 0, width: 3.0, depth: 0.65 },
      { id: uid('f'), type: 'bed_double', position: { x: 7.8, y: 1.6 }, rotation: 90, width: 1.6, depth: 2.0 },
    ],
    mepNodes: [],
    mepCircuits: [],
  };
  lvl.columns = autoPlaceStructuralColumns(lvl);
  lvl = autoPopulateMEPForLevel(lvl);

  return {
    id: uid('proj'),
    meta: {
      title: 'Compact Eco Solar Bungalow (ADU)',
      projectCode: 'ARC-2026-03',
      client: 'EcoMod Living',
      architect: 'Maavadiyaa',
      location: 'Garden Lot A',
      revision: 'R01 - Schematic Design',
      date: '2026-11-15',
      scale: '1:75 @ A2',
      plotWidth: 15,
      plotDepth: 13,
      currency: '$',
    },
    grid: autoGenerateStructuralGrid(lvl),
    levels: [lvl],
    roof: {
      type: 'shed',
      pitchDeg: 14,
      overhang: 0.6,
      material: 'standing_seam',
      parapetHeight: 0.5,
    },
    sections: [{ id: 'sec_a', label: 'A-A', start: { x: -1, y: 3.8 }, end: { x: 11, y: 3.8 } }],
    rates: { ...DEFAULT_BOQ_RATES },
  };
}

export function createBlankEngineeringLot(): BuildingProject {
  const ground: FloorLevel = {
    id: 'lvl_0',
    index: 0,
    name: 'Ground Floor Plan',
    elevation: 0.45,
    floorToFloorHeight: 3.2,
    slabThickness: 0.15,
    walls: [],
    openings: [],
    rooms: [],
    columns: [],
    stairs: [],
    furniture: [],
    mepNodes: [],
    mepCircuits: [],
  };
  return {
    id: uid('proj'),
    meta: {
      title: 'Untitled Hand-Sketch / Prompt Project',
      projectCode: 'ARC-NEW-01',
      client: 'Client Name',
      architect: 'Maavadiyaa',
      location: 'Site Lot',
      revision: 'R00 - Concept Draft',
      date: '2026-11-15',
      scale: '1:100 @ A1',
      plotWidth: 18,
      plotDepth: 15,
      currency: '$',
    },
    grid: { xAxes: [], yAxes: [] },
    levels: [ground],
    roof: {
      type: 'hip',
      pitchDeg: 22,
      overhang: 0.6,
      material: 'standing_seam',
      parapetHeight: 0.6,
    },
    sections: [{ id: 'sec_a', label: 'A-A', start: { x: -1, y: 5 }, end: { x: 15, y: 5 } }],
    rates: { ...DEFAULT_BOQ_RATES },
  };
}

export function createMaldivesTropicalVilla(): BuildingProject {
  const cbWall = (
    id: string,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    isExterior: boolean,
    height = 3.2
  ): Wall => ({
    ...makeWall(id, x1, y1, x2, y2, isExterior, height),
    thickness: isExterior ? 0.2 : 0.15,
    material: 'cinder_block',
  });

  const walls: Wall[] = [
    // Perimeter (200mm hollow cinder block masonry + verandah low balustrade)
    cbWall('mw_ver_s', 0, 0, 5.5, 0, true, 1.05),
    cbWall('mw_ver_w', 0, 0, 0, 2.2, true, 1.05),
    cbWall('mw_s2', 5.5, 0, 9.5, 0, true, 3.2),
    cbWall('mw_s3', 9.5, 0, 14.5, 0, true, 3.2),
    cbWall('mw_e', 14.5, 0, 14.5, 11.2, true, 3.2),
    cbWall('mw_n', 14.5, 11.2, 0, 11.2, true, 3.2),
    cbWall('mw_w', 0, 11.2, 0, 2.2, true, 3.2),
    // Interior partitions (150mm hollow cement-sand blockwork)
    cbWall('mw_living_s', 0, 2.2, 5.5, 2.2, true, 3.2),
    cbWall('mw_v1_bot', 5.5, 0, 5.5, 4.5, false, 3.2),
    cbWall('mw_v1_mid', 5.5, 4.5, 5.5, 6.8, false, 3.2),
    cbWall('mw_v1_top', 5.5, 6.8, 5.5, 11.2, false, 3.2),
    cbWall('mw_kit_div', 0, 6.8, 5.5, 6.8, false, 3.2),
    cbWall('mw_hall_s1', 5.5, 4.5, 9.5, 4.5, false, 3.2),
    cbWall('mw_hall_s2', 9.5, 4.5, 14.5, 4.5, false, 3.2),
    cbWall('mw_v2_bot', 9.5, 0, 9.5, 4.5, false, 3.2),
    cbWall('mw_hall_n1', 5.5, 6.8, 7.5, 6.8, false, 3.2),
    cbWall('mw_hall_n2', 7.5, 6.8, 9.5, 6.8, false, 3.2),
    cbWall('mw_hall_n3', 9.5, 6.8, 14.5, 6.8, false, 3.2),
    cbWall('mw_bath_div', 7.5, 6.8, 7.5, 11.2, false, 3.2),
    cbWall('mw_master_w', 9.5, 6.8, 9.5, 11.2, false, 3.2),
    cbWall('mw_ensuite_w', 11.5, 4.5, 11.5, 6.8, false, 3.2),
  ];

  const openings: Opening[] = [
    // Front verandah & living sliding doors
    makeDoor('mw_living_s', 0.42, 2.2, 'sliding', 1, 'SD1'),
    makeWindow('mw_living_s', 0.82, 1.1, 'casement', 0.65, 1.55, 'W1'),
    // West elevation cross-ventilation
    makeWindow('mw_w', 0.25, 1.8, 'sliding', 0.85, 1.45, 'W2'),
    makeWindow('mw_w', 0.72, 2.0, 'sliding', 0.65, 1.55, 'W1'),
    // North elevation windows
    makeWindow('mw_n', 0.17, 1.8, 'sliding', 0.85, 1.45, 'W2'),
    makeWindow('mw_n', 0.41, 1.1, 'casement', 0.9, 1.4, 'W3'),
    makeWindow('mw_n', 0.55, 0.9, 'picture', 1.5, 0.7, 'W4'),
    makeWindow('mw_n', 0.81, 1.8, 'sliding', 1.0, 1.3, 'W2'),
    // South elevation bedroom windows
    makeWindow('mw_s2', 0.5, 1.8, 'sliding', 0.85, 1.45, 'W2'),
    makeWindow('mw_s3', 0.5, 1.8, 'sliding', 0.85, 1.45, 'W2'),
    // East elevation windows
    makeWindow('mw_e', 0.2, 1.6, 'casement', 0.85, 1.45, 'W2'),
    makeWindow('mw_e', 0.5, 0.8, 'picture', 1.5, 0.7, 'W4'),
    makeWindow('mw_e', 0.8, 1.8, 'sliding', 0.85, 1.45, 'W2'),
    // Interior doors
    makeDoor('mw_kit_div', 0.72, 1.1, 'double', 1, 'D2'),
    makeDoor('mw_v1_mid', 0.5, 1.0, 'single', 1, 'D1'),
    makeDoor('mw_hall_s1', 0.35, 0.9, 'single', 1, 'D1'),
    makeDoor('mw_hall_s2', 0.2, 0.9, 'single', -1, 'D1'),
    makeDoor('mw_hall_n1', 0.5, 0.8, 'single', 1, 'D3'),
    makeDoor('mw_hall_n2', 0.5, 0.9, 'single', 1, 'D1'),
    makeDoor('mw_hall_n3', 0.2, 0.95, 'single', 1, 'D1'),
    makeDoor('mw_hall_n3', 0.7, 0.8, 'single', -1, 'D3'),
  ];

  const rooms: Room[] = [
    makeRoom('Front Verandah (Fenda)', 'porch', 0, 0, 5.5, 2.2, 'terrazzo', 3.2),
    makeRoom('Breezeway Living', 'living', 0, 2.2, 5.5, 4.6, 'porcelain', 3.2),
    makeRoom('Kitchen & Dining', 'kitchen', 0, 6.8, 5.5, 4.4, 'porcelain', 3.2),
    makeRoom('Bedroom 2', 'bedroom', 5.5, 0, 4.0, 4.5, 'hardwood', 3.2),
    makeRoom('Central Breeze Hall', 'hallway', 5.5, 4.5, 6.0, 2.3, 'porcelain', 3.2),
    makeRoom('Common Bath', 'bathroom', 5.5, 6.8, 2.0, 4.4, 'ceramic_antiskid', 3.0),
    makeRoom('Prayer & Study', 'office', 7.5, 6.8, 2.0, 4.4, 'porcelain', 3.2),
    makeRoom('Bedroom 3', 'bedroom', 9.5, 0, 5.0, 4.5, 'hardwood', 3.2),
    makeRoom('En-Suite Bath', 'bathroom', 11.5, 4.5, 3.0, 2.3, 'ceramic_antiskid', 3.0),
    makeRoom('Master Bedroom', 'bedroom', 9.5, 6.8, 5.0, 4.4, 'hardwood', 3.2),
  ];

  const furniture: FurnitureItem[] = [
    { id: uid('f'), type: 'sofa', position: { x: 2.3, y: 4.5 }, rotation: 0, width: 2.4, depth: 0.95 },
    { id: uid('f'), type: 'dining_table', position: { x: 2.8, y: 9.0 }, rotation: 0, width: 2.0, depth: 1.0 },
    { id: uid('f'), type: 'kitchen_counter', position: { x: 2.4, y: 10.7 }, rotation: 0, width: 3.4, depth: 0.65 },
    { id: uid('f'), type: 'bed_double', position: { x: 12.2, y: 9.4 }, rotation: 0, width: 1.9, depth: 2.05 },
    { id: uid('f'), type: 'bed_double', position: { x: 7.5, y: 1.7 }, rotation: 0, width: 1.6, depth: 2.0 },
    { id: uid('f'), type: 'bed_double', position: { x: 12.2, y: 1.7 }, rotation: 0, width: 1.6, depth: 2.0 },
    { id: uid('f'), type: 'wc', position: { x: 6.1, y: 10.6 }, rotation: 0, width: 0.42, depth: 0.68 },
    { id: uid('f'), type: 'sink', position: { x: 6.9, y: 10.7 }, rotation: 0, width: 0.85, depth: 0.5 },
    { id: uid('f'), type: 'wc', position: { x: 13.8, y: 5.0 }, rotation: 0, width: 0.42, depth: 0.68 },
    { id: uid('f'), type: 'sink', position: { x: 13.5, y: 6.2 }, rotation: 0, width: 0.85, depth: 0.5 },
  ];

  let ground: FloorLevel = {
    id: 'lvl_0',
    index: 0,
    name: 'Ground Floor (FGL +0.45m)',
    elevation: 0.45,
    floorToFloorHeight: 3.2,
    slabThickness: 0.15,
    walls,
    openings,
    rooms,
    columns: [],
    stairs: [],
    furniture,
    mepNodes: [],
    mepCircuits: [],
  };

  ground.columns = autoPlaceStructuralColumns(ground);
  ground = autoPopulateMEPForLevel(ground, true, true, true);

  return {
    id: uid('proj'),
    meta: {
      title: 'Maldives Tropical Island Residence (MNBC / ASHRAE)',
      projectCode: 'MV-2026-301',
      client: 'Island Coral Sanctuary Developments',
      architect: 'Maavadiyaa',
      location: 'Hulhumalé Phase II, Kaafu Atoll, Maldives',
      revision: 'R1',
      date: new Date().toISOString().slice(0, 10),
      scale: '1:100 @ A3',
      plotWidth: 18.5,
      plotDepth: 14.5,
      currency: 'USD',
    },
    grid: autoGenerateStructuralGrid(ground),
    levels: [ground],
    roof: {
      type: 'hip',
      pitchDeg: 22,
      overhang: 0.95,
      material: 'marine_metal',
      parapetHeight: 0.6,
    },
    solar: {
      enabled: true,
      panelCount: 16,
      panelWattage: 450,
      inverterKW: 6.0,
      batteryKWh: 15.0,
    },
    hvac: { ...MALDIVES_HVAC_CONFIG },
    design: {
      exteriorFacade: 'cement_plaster',
      interiorWalls: 'smooth_cement_plaster',
      windowFrame: 'silver_anodized',
      doorMaterial: 'oak',
    },
    sections: [{ id: 'sec_a', label: 'A-A', start: { x: -1, y: 5.5 }, end: { x: 15.5, y: 5.5 } }],
    rates: { ...DEFAULT_BOQ_RATES },
  };
}

export function snapProjectToGrid(proj: BuildingProject): BuildingProject {
  return {
    ...proj,
    levels: proj.levels.map((l) => ({
      ...l,
      walls: l.walls.map((w) => ({
        ...w,
        start: snapPoint(w.start, 0.05),
        end: snapPoint(w.end, 0.05),
      })),
    })),
  };
}
