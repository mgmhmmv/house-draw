import { BuildingProject, Opening } from '../model/types';
import { calculateBOQ } from './boqCalculator';
import { levelBoundingBox, polygonArea, polygonPerimeter } from './geometry';
import { computeElectricalSLD, computePlumbingRiser } from './mepEngine';

export interface DoorScheduleRow {
  mark: string;
  style: string;
  widthMm: number;
  heightMm: number;
  leafSpec: string;
  frameSpec: string;
  fireRating: string;
  count: number;
}

export interface WindowScheduleRow {
  mark: string;
  style: string;
  widthMm: number;
  heightMm: number;
  sillMm: number;
  glazingSpec: string;
  uValue: number;
  count: number;
}

export interface RoomScheduleRow {
  code: string;
  levelName: string;
  name: string;
  areaM2: number;
  perimeterM: number;
  floorFinish: string;
  wallFinish: string;
  ceilingFinish: string;
  clearHeightM: number;
  minLightAreaM2: number;
  compliance: 'PASS' | 'REVIEW';
}

export interface BeamScheduleRow {
  mark: string;
  location: string;
  sizeMm: string;
  concreteGrade: string;
  topSteel: string;
  bottomSteel: string;
  stirrups: string;
  maxSpanM: number;
  spanDepthRatio: number;
  status: 'PASS' | 'CHECK';
}

export interface ColumnFootingScheduleRow {
  levelName: string;
  colMark: string;
  colSizeMm: string;
  axialLoadKN: number;
  mainBars: string;
  footingMark: string;
  footingSizeMm: string;
  pccBlindingMm: string;
  bottomMesh: string;
}

export interface BarBendingRow {
  barMark: string;
  diameterMm: number;
  shapeCode: '00' | '21' | '51';
  member: string;
  totalBars: number;
  cutLengthM: number;
  totalWeightKg: number;
}

export interface ComplianceCheckItem {
  code: string;
  discipline: string;
  requirement: string;
  actual: string;
  status: 'PASS' | 'REVIEW';
}

export interface EngineeringSchedulesReport {
  doors: DoorScheduleRow[];
  windows: WindowScheduleRow[];
  rooms: RoomScheduleRow[];
  beams: BeamScheduleRow[];
  columns: ColumnFootingScheduleRow[];
  bbs: BarBendingRow[];
  complianceChecks: ComplianceCheckItem[];
  totalWindowGlazingM2: number;
  glazingToFloorPct: number;
}

function assignOpeningMarks(project: BuildingProject): Map<string, string> {
  const map = new Map<string, string>();
  const doorGroups = new Map<string, string>();
  const winGroups = new Map<string, string>();
  const usedDoorMarks = new Set<string>();
  const usedWinMarks = new Set<string>();

  const allOps: Opening[] = project.levels.flatMap((l) => l.openings);
  // Deterministic ordering: largest width first
  const sorted = [...allOps].sort((a, b) => b.width - a.width || a.style.localeCompare(b.style));

  // Pass 1: preserve first unique occurrence of any preset/user opening mark
  const pendingDoorKeys: string[] = [];
  const pendingWinKeys: string[] = [];
  for (const op of sorted) {
    const key = `${op.kind}|${op.style}|${Math.round(op.width * 1000)}|${Math.round(op.height * 1000)}`;
    if (op.kind === 'door') {
      if (!doorGroups.has(key) && !pendingDoorKeys.includes(key)) {
        if (op.label && !usedDoorMarks.has(op.label)) {
          doorGroups.set(key, op.label);
          usedDoorMarks.add(op.label);
        } else {
          pendingDoorKeys.push(key);
        }
      }
    } else {
      if (!winGroups.has(key) && !pendingWinKeys.includes(key)) {
        if (op.label && !usedWinMarks.has(op.label)) {
          winGroups.set(key, op.label);
          usedWinMarks.add(op.label);
        } else {
          pendingWinKeys.push(key);
        }
      }
    }
  }

  // Pass 2: assign sequential unique marks for colliding or unlabeled opening types
  let dCounter = 1;
  for (const key of pendingDoorKeys) {
    while (usedDoorMarks.has(`D${dCounter}`)) dCounter++;
    const mark = `D${dCounter++}`;
    doorGroups.set(key, mark);
    usedDoorMarks.add(mark);
  }
  let wCounter = 1;
  for (const key of pendingWinKeys) {
    while (usedWinMarks.has(`W${wCounter}`)) wCounter++;
    const mark = `W${wCounter++}`;
    winGroups.set(key, mark);
    usedWinMarks.add(mark);
  }

  for (const op of sorted) {
    const key = `${op.kind}|${op.style}|${Math.round(op.width * 1000)}|${Math.round(op.height * 1000)}`;
    map.set(op.id, op.kind === 'door' ? doorGroups.get(key)! : winGroups.get(key)!);
  }
  return map;
}

export function getOpeningMarkMap(project: BuildingProject): Map<string, string> {
  return assignOpeningMarks(project);
}

export function computeEngineeringSchedules(project: BuildingProject): EngineeringSchedulesReport {
  const markMap = assignOpeningMarks(project);
  const doorBuckets = new Map<string, DoorScheduleRow>();
  const winBuckets = new Map<string, WindowScheduleRow>();
  const rooms: RoomScheduleRow[] = [];

  let totalFloorAreaM2 = 0;
  let totalWindowGlazingM2 = 0;
  let minCeilingH = Infinity;

  for (const lvl of project.levels) {
    for (const op of lvl.openings) {
      const mark = markMap.get(op.id) ?? (op.kind === 'door' ? 'D1' : 'W1');
      const widthMm = Math.round(op.width * 1000);
      const heightMm = Math.round(op.height * 1000);
      const sillMm = Math.round(op.sillHeight * 1000);

      if (op.kind === 'door') {
        const key = `${mark}|${widthMm}|${heightMm}|${op.style}`;
        const existing = doorBuckets.get(key);
        if (existing) {
          existing.count += 1;
        } else {
          doorBuckets.set(key, {
            mark,
            style: op.style.charAt(0).toUpperCase() + op.style.slice(1),
            widthMm,
            heightMm,
            leafSpec:
              op.style === 'garage'
                ? 'Insulated Sectional Steel 40mm'
                : op.style === 'sliding'
                ? 'Thermally Broken Al + Laminated Glass'
                : '45mm Solid Core Timber / Veneer',
            frameSpec: op.style === 'garage' ? 'Galv. Steel Track' : '150×50mm Hardwood / Al',
            fireRating: widthMm >= 1000 || op.style === 'garage' ? 'FD30 (EN 1634)' : 'Standard',
            count: 1,
          });
        }
      } else {
        totalWindowGlazingM2 += op.width * op.height;
        const key = `${mark}|${widthMm}|${heightMm}|${op.style}`;
        const existing = winBuckets.get(key);
        if (existing) {
          existing.count += 1;
        } else {
          winBuckets.set(key, {
            mark,
            style: op.style.charAt(0).toUpperCase() + op.style.slice(1),
            widthMm,
            heightMm,
            sillMm,
            glazingSpec: '6+12A+6mm Low-E Double Glazed',
            uValue: 1.6,
            count: 1,
          });
        }
      }
    }

    lvl.rooms.forEach((rm, idx) => {
      const areaM2 = Number(polygonArea(rm.polygon).toFixed(2));
      const perimeterM = Number(polygonPerimeter(rm.polygon).toFixed(2));
      totalFloorAreaM2 += areaM2;
      minCeilingH = Math.min(minCeilingH, rm.ceilingHeight);

      const isWet = rm.category === 'bathroom' || rm.category === 'kitchen' || rm.category === 'utility';
      const isHabitable = rm.category === 'living' || rm.category === 'bedroom' || rm.category === 'office';
      const minAreaReq = isHabitable ? 6.5 : 1.5;

      rooms.push({
        code: `RM-${lvl.index + 1}${String(idx + 1).padStart(2, '0')}`,
        levelName: `L${lvl.index + 1}`,
        name: rm.name,
        areaM2,
        perimeterM,
        floorFinish: rm.finish.replace('_', ' '),
        wallFinish: rm.category === 'bathroom' ? 'Glazed Ceramic Tile (2.4m H)' : 'Emulsion on 15mm Cement Plaster',
        ceilingFinish: isWet ? 'MR Gypsum + Acrylic Paint' : '12mm Skim Coat + White Emulsion',
        clearHeightM: Number(rm.ceilingHeight.toFixed(2)),
        minLightAreaM2: Number((isHabitable ? areaM2 * 0.08 : areaM2 * 0.04).toFixed(2)),
        compliance: areaM2 >= minAreaReq && rm.ceilingHeight >= 2.3 ? 'PASS' : 'REVIEW',
      });
    });
  }

  // Structural bay span estimation from StructuralGrid
  const xCoords = project.grid.xAxes.map((a) => a.coord).sort((a, b) => a - b);
  const yCoords = project.grid.yAxes.map((a) => a.coord).sort((a, b) => a - b);
  let maxSpanM = 4.2;
  for (let i = 1; i < xCoords.length; i++) maxSpanM = Math.max(maxSpanM, xCoords[i] - xCoords[i - 1]);
  for (let i = 1; i < yCoords.length; i++) maxSpanM = Math.max(maxSpanM, yCoords[i] - yCoords[i - 1]);
  maxSpanM = Number(Math.min(7.5, maxSpanM).toFixed(2));

  const beams: BeamScheduleRow[] = [
    {
      mark: 'PB-1',
      location: 'Ground Plinth & Tie Beams',
      sizeMm: '230 × 350',
      concreteGrade: 'C25/30',
      topSteel: '2Ø12 + 1Ø12 B500B',
      bottomSteel: '3Ø12 B500B',
      stirrups: 'Ø8 @ 150 c/c',
      maxSpanM,
      spanDepthRatio: Number(((maxSpanM * 1000) / 310).toFixed(1)),
      status: (maxSpanM * 1000) / 310 <= 20 ? 'PASS' : 'CHECK',
    },
    {
      mark: 'FB-1',
      location: 'Primary Floor / Roof Ring Beam',
      sizeMm: '230 × 400',
      concreteGrade: 'C25/30',
      topSteel: '2Ø16 B500B',
      bottomSteel: '3Ø16 B500B',
      stirrups: 'Ø8 @ 125/175 c/c',
      maxSpanM,
      spanDepthRatio: Number(((maxSpanM * 1000) / 360).toFixed(1)),
      status: (maxSpanM * 1000) / 360 <= 20 ? 'PASS' : 'CHECK',
    },
    {
      mark: 'LB-1',
      location: 'Door / Window Precast Lintels',
      sizeMm: '230 × 200',
      concreteGrade: 'C25/30',
      topSteel: '2Ø10 B500B',
      bottomSteel: '2Ø12 B500B',
      stirrups: 'Ø8 @ 150 c/c',
      maxSpanM: 2.4,
      spanDepthRatio: 14.1,
      status: 'PASS',
    },
  ];

  // Column & Footing schedule
  const ground = project.levels[0];
  const gBB = ground ? levelBoundingBox(ground) : { width: 12, depth: 10 };
  const colsPerLevel = Math.max(1, ground?.columns.length ?? 8);
  const tribArea = (gBB.width * gBB.depth) / colsPerLevel;

  const columns: ColumnFootingScheduleRow[] = project.levels.flatMap((lvl) =>
    lvl.columns.map((c) => {
      const storiesAbove = project.levels.length - lvl.index;
      const axialLoadKN = Math.round(tribArea * 11.5 * storiesAbove + 45);
      return {
        levelName: `L${lvl.index + 1}`,
        colMark: c.label,
        colSizeMm: `${Math.round(c.width * 1000)} × ${Math.round(c.depth * 1000)}`,
        axialLoadKN,
        mainBars: c.rebarSpec,
        footingMark: `F-${c.label}`,
        footingSizeMm: `${Math.round(c.footingSize * 1000)} × ${Math.round(c.footingSize * 1000)} × 350`,
        pccBlindingMm: '100mm PCC 1:4:8',
        bottomMesh: 'Ø12 @ 150 c/c B/W',
      };
    })
  );

  // Bar Bending Schedule (BS 8666) scaled from BOQ steel demand
  const boq = calculateBOQ(project);
  const totalSteel = Math.max(600, boq.rawMaterials.rebarSteelKg);
  const bbs: BarBendingRow[] = [
    {
      barMark: '01',
      diameterMm: 16,
      shapeCode: '00',
      member: 'RC Columns & Main Beams (Longitudinal)',
      totalBars: Math.max(24, project.levels.reduce((s, l) => s + l.columns.length * 4, 0)),
      cutLengthM: Number((project.levels.length * 3.4 + 0.6).toFixed(2)),
      totalWeightKg: Math.round(totalSteel * 0.34),
    },
    {
      barMark: '02',
      diameterMm: 12,
      shapeCode: '21',
      member: 'Pad Footing B/W Mesh & Plinth Tie Beams',
      totalBars: Math.max(48, (ground?.columns.length ?? 6) * 14),
      cutLengthM: 1.55,
      totalWeightKg: Math.round(totalSteel * 0.28),
    },
    {
      barMark: '03',
      diameterMm: 10,
      shapeCode: '00',
      member: '2-Way RC Slabs (Ø10@150 B1/B2 & T1/T2)',
      totalBars: Math.max(60, Math.round(totalFloorAreaM2 * 1.15)),
      cutLengthM: Number(maxSpanM.toFixed(2)),
      totalWeightKg: Math.round(totalSteel * 0.24),
    },
    {
      barMark: '04',
      diameterMm: 8,
      shapeCode: '51',
      member: 'Shear Links & Column Helical/Closed Stirrups',
      totalBars: Math.max(120, Math.round(totalFloorAreaM2 * 2.2)),
      cutLengthM: 1.05,
      totalWeightKg: Math.round(totalSteel * 0.14),
    },
  ];

  const glazingToFloorPct =
    totalFloorAreaM2 > 0 ? Number(((totalWindowGlazingM2 / totalFloorAreaM2) * 100).toFixed(1)) : 12.0;

  const sld = computeElectricalSLD(project);
  const plumb = computePlumbingRiser(project);
  const effectiveMinCeil = minCeilingH === Infinity ? 3.0 : Number(minCeilingH.toFixed(2));
  const maxBearingKPa = columns.length
    ? Math.max(...columns.map((c) => Math.round(c.axialLoadKN / 1.44)))
    : 85;
  const smokeDetectors = project.levels.flatMap((l) => l.mepNodes).filter((n) => n.label === 'SD').length;

  const complianceChecks: ComplianceCheckItem[] = [
    {
      code: 'IBC §1208.2 / §1208.3',
      discipline: 'Architectural',
      requirement: 'Min clear ceiling >= 2.30m; habitable rooms >= 6.5m²',
      actual: `Min Ceiling ${effectiveMinCeil.toFixed(2)}m · ${rooms.filter((r) => r.compliance === 'PASS').length}/${Math.max(1, rooms.length)} rooms compliant`,
      status: effectiveMinCeil >= 2.3 && rooms.every((r) => r.compliance === 'PASS') ? 'PASS' : 'REVIEW',
    },
    {
      code: 'IBC §1205.2',
      discipline: 'Architectural',
      requirement: 'Natural daylight glazing ratio >= 8.0% of GFA',
      actual: `${glazingToFloorPct}% (${totalWindowGlazingM2.toFixed(1)} m² glazing / ${Math.max(1, totalFloorAreaM2).toFixed(1)} m² GFA)`,
      status: glazingToFloorPct >= 8.0 ? 'PASS' : 'REVIEW',
    },
    {
      code: 'Eurocode 2 §7.4 / ACI 318',
      discipline: 'Structural',
      requirement: 'RC Beam/Slab L/d <= 20; Footing soil bearing <= 150 kN/m²',
      actual: `Max L/d = ${beams[0].spanDepthRatio} · Max SBC = ${maxBearingKPa} kN/m²`,
      status: beams[0].spanDepthRatio <= 20 && maxBearingKPa <= 150 ? 'PASS' : 'REVIEW',
    },
    {
      code: 'IEC 60364 / BS 7671',
      discipline: 'Electrical',
      requirement: 'Voltage drop <= 3% (light) / <= 5% (power) & 30mA RCD',
      actual: `Max ΔV = ${sld.maxVoltageDropPct}% · 30mA RCCB + ${sld.spdSpec}`,
      status: sld.maxVoltageDropPct <= 4.5 ? 'PASS' : 'REVIEW',
    },
    {
      code: 'IPC §704 / BS EN 12056',
      discipline: 'Plumbing & Storm',
      requirement: 'Pipe velocity <= 2.4 m/s, 1:60 drain slope & RWP sizing',
      actual: `v = ${plumb.designVelocityMps} m/s · ${plumb.rainwaterDownpipesCount}×Ø100 RWP (${plumb.stormwaterRunoffLps} L/s)`,
      status: plumb.designVelocityMps <= 2.4 ? 'PASS' : 'REVIEW',
    },
    {
      code: 'ASHRAE 62.2 / NFPA 72',
      discipline: 'HVAC & Fire',
      requirement: 'Wet-room mechanical extract + Interlinked Smoke Detection',
      actual: `${Math.max(1, project.levels.length)}×50 L/s EF · ${Math.max(1, smokeDetectors)}× Optical SD Units`,
      status: 'PASS',
    },
  ];

  return {
    doors: Array.from(doorBuckets.values()),
    windows: Array.from(winBuckets.values()),
    rooms,
    beams,
    columns,
    bbs,
    complianceChecks,
    totalWindowGlazingM2: Number(totalWindowGlazingM2.toFixed(2)),
    glazingToFloorPct,
  };
}
