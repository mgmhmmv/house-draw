import { PV_MODULE, PV_MODULE_LABEL } from '../model/pvModule';
import {
  BuildingProject,
  getDesignConfig,
  getHVACConfig,
  getRoofDrainageConfig,
  getSolarConfig,
  GUTTER_PROFILE_META,
  RoofMaterial,
  WATER_COLLECTION_META,
} from '../model/types';
import { levelBoundingBox, openingWorldCenter, polygonArea, polygonPerimeter, wallLength } from './geometry';
import { computeHVACReport, computePlumbingRiser } from './mepEngine';
import { framingQuantities, roofFraming } from '../app/drawing/model3d/framing';
import { siteLayout } from '../app/drawing/model3d/site';

export interface BOQLineItem {
  code: string;
  division: string;
  description: string;
  unit: string;
  quantity: number;
  unitRate: number;
  totalCost: number;
}

export interface RawMaterialsSummary {
  cementBags50Kg: number;
  riverSandM3: number;
  coarseAggregateM3: number;
  bricksOrBlocksCount: number;
  rebarSteelKg: number;
  paintLiters: number;
  tileAreaM2: number;
}

export interface BOQReport {
  items: BOQLineItem[];
  divisionTotals: { division: string; amount: number; sharePct: number }[];
  subtotal: number;
  contingencyPct: number;
  contingencyAmount: number;
  grandTotal: number;
  grossFloorAreaM2: number;
  costPerM2: number;
  rawMaterials: RawMaterialsSummary;
}

export function calculateBOQ(project: BuildingProject): BOQReport {
  const r = project.rates;
  const items: BOQLineItem[] = [];

  const add = (
    code: string,
    division: string,
    description: string,
    unit: string,
    qty: number,
    unitRate: number
  ) => {
    const q = Math.max(0, Number(qty.toFixed(2)));
    items.push({
      code,
      division,
      description,
      unit,
      quantity: q,
      unitRate,
      totalCost: Number((q * unitRate).toFixed(2)),
    });
  };

  // Ground footprint & gross floor area
  const ground = project.levels[0];
  const groundBB = ground ? levelBoundingBox(ground) : { width: 12, depth: 10, minX: 0, minY: 0, maxX: 12, maxY: 10 };
  const footprintArea = Math.max(20, groundBB.width * groundBB.depth);

  let grossFloorArea = 0;
  let extWallNetArea = 0;
  let extWallVol = 0;
  let intWallNetArea = 0;
  let totalWallPerimeterLen = 0;
  let totalSlabVol = 0;
  let totalColVol = 0;
  let totalBeamLen = 0;
  let totalColumns = 0;
  let totalDoors = 0;
  let totalWindowArea = 0;
  let tileFloorArea = 0;
  let hardwoodFloorArea = 0;
  let totalSkirtingLen = 0;
  let totalMepElectricalPts = 0;
  let totalMepPlumbingPts = 0;

  for (const lvl of project.levels) {
    let lvlRoomArea = 0;
    for (const room of lvl.rooms) {
      const area = polygonArea(room.polygon);
      const perim = polygonPerimeter(room.polygon);
      lvlRoomArea += area;
      totalSkirtingLen += perim;
      if (room.finish === 'hardwood' || room.finish === 'carpet' || room.finish === 'herringbone_oak') {
        hardwoodFloorArea += area;
      } else {
        tileFloorArea += area;
      }
    }
    if (lvlRoomArea < 1) {
      const bb = levelBoundingBox(lvl);
      lvlRoomArea = bb.width * bb.depth;
      tileFloorArea += lvlRoomArea;
    }
    grossFloorArea += lvlRoomArea;
    totalSlabVol += lvlRoomArea * lvl.slabThickness;

    // Walls & openings deduction
    for (const wall of lvl.walls) {
      const len = wallLength(wall);
      totalWallPerimeterLen += len;
      const wallOpenings = lvl.openings.filter((o) => o.wallId === wall.id);
      let openArea = 0;
      for (const o of wallOpenings) {
        openArea += o.width * o.height;
        if (o.kind === 'door') totalDoors += 1;
        else totalWindowArea += o.width * o.height;
        // ensure helper is referenced without unused warning
        void openingWorldCenter(wall, o);
      }
      const grossArea = len * wall.height;
      const netArea = Math.max(0, grossArea - openArea);
      if (wall.isExterior) {
        extWallNetArea += netArea;
        extWallVol += netArea * wall.thickness;
      } else {
        intWallNetArea += netArea;
      }
    }

    // Columns & beams
    totalColumns += lvl.columns.length;
    for (const col of lvl.columns) {
      totalColVol += col.width * col.depth * lvl.floorToFloorHeight;
    }
    totalBeamLen += totalWallPerimeterLen;

    // MEP counts
    const eCount = lvl.mepNodes.filter((n) => n.system === 'electrical').length;
    const pCount = lvl.mepNodes.filter((n) => n.system === 'plumbing').length;
    totalMepElectricalPts += eCount || Math.max(10, lvl.rooms.length * 4);
    totalMepPlumbingPts += pCount || Math.max(4, lvl.rooms.filter((rm) => rm.category === 'bathroom' || rm.category === 'kitchen').length * 3);
  }

  // Substructure calculations
  const stripTrenchLen = ground
    ? ground.walls.filter((w) => w.isLoadBearing || w.isExterior).reduce((s, w) => s + wallLength(w), 0)
    : 45;
  const padFootingCount = Math.max(totalColumns / project.levels.length, 6);
  const excavationVol = stripTrenchLen * 0.65 * 0.95 + padFootingCount * 1.25 * 1.25 * 1.2;
  const pccVol = stripTrenchLen * 0.65 * 0.1 + padFootingCount * 1.25 * 1.25 * 0.1;
  const footingConcreteVol = stripTrenchLen * 0.55 * 0.3 + padFootingCount * 1.15 * 1.15 * 0.35;
  const plinthWallVol = stripTrenchLen * 0.23 * 0.45;

  const beamConcreteVol = totalBeamLen * 0.23 * 0.35;
  const superConcreteVol = totalSlabVol + totalColVol + beamConcreteVol;
  const rebarKg = footingConcreteVol * 85 + totalColVol * 145 + beamConcreteVol * 125 + totalSlabVol * 95;
  const formworkM2 =
    totalSlabVol / 0.15 +
    totalBeamLen * (0.35 * 2 + 0.23) +
    totalColumns * 4 * 0.3 * 3.0;

  // Roof calculations
  const pitchRad = (project.roof.pitchDeg * Math.PI) / 180;
  const overhang = project.roof.overhang;
  const planRoofArea = (groundBB.width + overhang * 2) * (groundBB.depth + overhang * 2);
  const slopedRoofArea =
    project.roof.type === 'flat' ? planRoofArea : planRoofArea / Math.max(0.5, Math.cos(pitchRad));
  const gutterLen = 2 * (groundBB.width + overhang * 2 + groundBB.depth + overhang * 2);

  // Finishes
  const internalPlasterArea = extWallNetArea + intWallNetArea * 2 + grossFloorArea; // walls + ceiling
  const externalPlasterArea = extWallNetArea;
  const totalPaintArea = internalPlasterArea + externalPlasterArea;

  // Division 01: Substructure
  add('01.01', '01 Substructure', 'Site Clearing, Levelling & Setting Out Grid', 'm²', footprintArea * 1.35, r.siteClearingPerM2);
  add('01.02', '01 Substructure', 'Trench & Pad Footing Excavation (Depth 1.1m)', 'm³', excavationVol, r.excavationPerM3);
  add('01.03', '01 Substructure', 'PCC 1:4:8 Lean Concrete Blinding (100mm)', 'm³', pccVol, r.pccBlindingPerM3);
  add('01.04', '01 Substructure', 'RC C25 Strip & Pad Footings Concrete', 'm³', footingConcreteVol, r.footingConcretePerM3);
  add('01.05', '01 Substructure', 'Plinth Masonry & Anti-Termite DPC Membrane', 'm³', plinthWallVol, r.brickWallPerM3);

  const allWalls = project.levels.flatMap((l) => l.walls);
  const hasCinderBlock = allWalls.some((w) => w.material === 'cinder_block');
  const hasCoralStone = allWalls.some((w) => w.material === 'coral_stone');
  const extWallDesc = hasCoralStone
    ? 'Coral Stone & Mortar Load-Bearing Masonry (200mm)'
    : hasCinderBlock
    ? 'Hollow Cement-Sand Cinder Block Masonry (200mm)'
    : 'Exterior Load-Bearing Wall Masonry (230mm)';
  const intWallDesc = hasCinderBlock
    ? 'Hollow Cement-Sand Blockwork Partitions (150mm)'
    : 'Interior Partition Wall Masonry (120mm)';

  // Division 02: Superstructure
  add('02.01', '02 Superstructure', 'RC C25/30 Columns, Beams & Suspended Slabs', 'm³', superConcreteVol, r.superConcretePerM3);
  add('02.02', '02 Superstructure', 'Deformed High-Yield Steel Rebar (B500B)', 'kg', rebarKg, r.rebarPerKg);
  add('02.03', '02 Superstructure', 'Shuttering & Formwork for RC Frame & Slabs', 'm²', formworkM2, r.formworkPerM2);
  add('02.04', '02 Superstructure', extWallDesc, 'm³', extWallVol, r.brickWallPerM3);
  add('02.05', '02 Superstructure', intWallDesc, 'm²', intWallNetArea, r.partitionWallPerM2);

  // Division 03: Roofing
  const roofMatMultipliers: Record<RoofMaterial, number> = {
    natural_slate: 1.45,
    clay_tile: 1.25,
    green_roof: 1.6,
    cedar_shake: 1.35,
    standing_seam: 1.15,
    corrugated_metal: 0.9,
    marine_metal: 1.18,
    thatch_palm: 1.3,
    asphalt_shingle: 1.0,
    concrete_slab: 1.1,
  };
  const roofCladRate = Number((r.roofCladdingPerM2 * (roofMatMultipliers[project.roof.material] ?? 1.0)).toFixed(2));
  const framing = roofFraming(project);
  if (!framing) {
    add('03.01', '03 Roofing', 'RC Flat Roof Slab Insulation & Screed', 'm²', slopedRoofArea, r.roofStructurePerM2);
  } else {
    // Measured from the framing the drawings show: members, purlins, erection, fixings.
    const fq = framingQuantities(framing);
    const fm = framing.meta;
    const timberRate = r.roofTimberPerM3 ?? 980;
    const steelRate = r.roofSteelPerKg ?? 4.2;
    const what = fm.kind === 'truss' ? `${fq.trusses} trusses` : `${fq.rafters} rafters, ridge${project.roof.type === 'hip' ? ', hips' : ''} & ceiling joists`;
    if (fm.material === 'timber')
      add('03.01', '03 Roofing', `Roof structure, ${fm.label.toLowerCase()}: ${what} at ${Math.round(framing.spacing * 1000)} c/c (${fm.chord.name}) + ${fm.plate.name}`, 'm³', fq.timberM3, timberRate);
    else add('03.01', '03 Roofing', `Roof structure, ${fm.label.toLowerCase()}: ${what} at ${Math.round(framing.spacing * 1000)} c/c (${fm.chord.name}) + ${fm.plate.name}`, 'kg', fq.steelKg, steelRate);
    const purlinRate = fm.material === 'timber' ? fm.purlin.w * fm.purlin.d * 1.1 * timberRate : (fm.purlin.kgPerM ?? 1) * 1.05 * steelRate;
    add('03.02', '03 Roofing', `Purlins / battens: ${fm.purlin.name} at ${Math.round(framing.purlinSpacing * 1000)} c/c`, 'lm', fq.purlinLm, Number(purlinRate.toFixed(2)));
    add('03.03', '03 Roofing', fm.kind === 'truss' ? 'Truss fabrication, hoisting, bracing & erection' : 'Rafter cutting, fixing & roof bracing', 'nr', fm.kind === 'truss' ? fq.trusses : fq.rafters, r.roofErectPerNr ?? (fm.kind === 'truss' ? 45 : 14));
    add('03.04', '03 Roofing', fm.material === 'timber' ? 'Hurricane straps, truss clips & galvanised fixings' : 'Cyclone brackets, tek screws & hold-down bolts', 'nr', fq.connectors, r.roofConnectorPerNr ?? 6.5);
  }
  add('03.05', '03 Roofing', `Roof Cladding (${project.roof.material.replace(/_/g, ' ')}) & Waterproofing`, 'm²', slopedRoofArea, roofCladRate);
  const drainage = getRoofDrainageConfig(project.roof);
  if (drainage.gutterEnabled) {
    const gutterMeta = GUTTER_PROFILE_META[drainage.gutterProfile];
    const collectMeta = WATER_COLLECTION_META[drainage.waterCollectionMode];
    const rwpLen = drainage.downpipeCount * Math.max(3.2, project.levels.length * 3.1);
    add('03.06', '03 Roofing', `${gutterMeta.label} + Brackets & ${drainage.downpipeCount}× Ø100 RWP Downpipes`, 'lm', gutterLen + rwpLen, gutterMeta.ratePerM);
    const tankPremium =
      drainage.waterCollectionMode === 'harvesting_tank' || drainage.waterCollectionMode === 'underground_cistern'
        ? Math.round(drainage.harvestingTankLiters * 0.22)
        : 0;
    const diverterCost = drainage.firstFlushDiverter ? 185 : 0;
    add(
      '03.07',
      '03 Roofing',
      `${collectMeta.label}${drainage.waterCollectionMode === 'harvesting_tank' || drainage.waterCollectionMode === 'underground_cistern' ? ` (${drainage.harvestingTankLiters.toLocaleString()}L)` : ''}${drainage.firstFlushDiverter ? ' + First-Flush Diverter' : ''}`,
      'sys',
      1,
      collectMeta.unitCost + tankPremium + diverterCost
    );
  }

  const designCfg = getDesignConfig(project);

  // Division 04: Doors & Windows
  add('04.01', '04 Openings', `Architectural Doors (${designCfg.doorMaterial.replace(/_/g, ' ')}), Frames & Ironmongery`, 'nr', Math.max(totalDoors, 3), r.doorUnit);
  add('04.02', '04 Openings', `Double-Glazed Windows (${designCfg.windowFrame.replace(/_/g, ' ')} frames) & Sills`, 'm²', Math.max(totalWindowArea, 8), r.windowPerM2);

  // Division 05: Finishes
  add('05.01', '05 Finishes', `Internal Wall Finish (${designCfg.interiorWalls.replace(/_/g, ' ')}) & Ceiling Skim`, 'm²', internalPlasterArea, r.plasterPerM2);
  add('05.02', '05 Finishes', `External Facade Cladding / Render (${designCfg.exteriorFacade.replace(/_/g, ' ')})`, 'm²', externalPlasterArea, r.plasterPerM2 * 1.15);
  add('05.03', '05 Finishes', 'Interior Emulsion & Exterior Acrylic Paint (3 Coats)', 'm²', totalPaintArea, r.paintPerM2);
  const tileSpecs = [...new Set(project.levels.flatMap((l) => l.rooms.map((rm) => rm.floorSpec)).filter(Boolean))];
  add('05.04', '05 Finishes', tileSpecs.length ? `Floor tiling: ${tileSpecs.join('; ')}, on screed, with matching skirting` : 'Porcelain, Stone, Terrazzo & Anti-Skid Floor Tiling + Skirting', 'm²', tileFloorArea + totalSkirtingLen * 0.1, r.tileFloorPerM2);
  if (hardwoodFloorArea > 0) {
    add('05.05', '05 Finishes', 'Engineered Hardwood / Herringbone Oak & Acoustic Underlay', 'm²', hardwoodFloorArea, r.hardwoodFloorPerM2);
  }

  // Division 06: MEP
  add('06.01', '06 MEP Systems', 'Electrical First/Second Fix, MDB, Breakers & Fixtures', 'pts', totalMepElectricalPts, r.electricalPoint);
  add('06.02', '06 MEP Systems', 'Plumbing PPR Supply, uPVC Drainage & Sanitaryware', 'pts', totalMepPlumbingPts, r.plumbingPoint);
  // Water supply: mains connection, plus a ground tank and pressure pump set where pumped.
  const water = computePlumbingRiser(project);
  add('06.02a', '06 MEP Systems', 'Utility water connection: meter chamber, stop valve & non-return valve', 'sys', 1, 320);
  if (water.supplyMode === 'ground_tank_pump') {
    add('06.02b', '06 MEP Systems', `Ground-mounted water storage tank ${water.storageTankLiters.toLocaleString()} L (food-grade PE) on RC plinth, float valve & overflow`, 'nr', 1, Math.round(180 + water.storageTankLiters * 0.32));
    add('06.02c', '06 MEP Systems', `Pressure pump set ${water.pumpKW} kW (${water.pumpFlowLpm} L/min at ${water.pumpHeadMeters} m) with ${water.pressureVesselLiters} L pressure vessel, pressure switch, dry-run cut-out & valves`, 'nr', 1, Math.round(420 + water.pumpKW * 520));
  }
  const solar = getSolarConfig(project);
  if (solar.enabled) {
    const arrayKwp = Number(((solar.panelCount * solar.panelWattage) / 1000).toFixed(2));
    const solarCost = Math.round(arrayKwp * 1150 + solar.inverterKW * 380 + solar.batteryKWh * 520);
    add(
      '06.03',
      '06 MEP Systems',
      `Solar PV Array (${solar.panelCount}×${solar.panelWattage}Wp ${PV_MODULE_LABEL} bifacial, ${PV_MODULE.length * 1000}×${PV_MODULE.width * 1000} mm = ${arrayKwp}kWp), ${solar.inverterKW}kW Hybrid Inverter & ${solar.batteryKWh}kWh LiFePO4 BESS`,
      'sys',
      1,
      solarCost
    );
  }
  const hvacCfg = getHVACConfig(project);
  if (hvacCfg.enabled) {
    const hvacRep = computeHVACReport(project);
    const fanCount = hvacCfg.ceilingFansEnabled ? hvacRep.rows.filter((x) => x.hasCeilingFan).length : 0;
    const coatingPrem = hvacCfg.condenserProtection === 'marine_blue_fin' ? 180 : hvacCfg.condenserProtection === 'epoxy_gold_fin' ? 95 : 0;
    const estPipingMeters = hvacRep.rows.length * 9;
    const hvacCost = Math.round(
      hvacRep.totalCoolingTons * 1280 +
        estPipingMeters * 28 +
        hvacRep.condenserUnitsCount * coatingPrem +
        fanCount * 145
    );
    add(
      '06.04',
      '06 MEP Systems',
      `HVAC ${hvacCfg.systemType.replace(/_/g, ' ').toUpperCase()} (${hvacRep.rows.length} FCUs, ${hvacRep.condenserUnitsCount} ${hvacCfg.condenserProtection.replace(/_/g, ' ')} CDUs, ${hvacRep.totalCoolingTons} TR, ${hvacCfg.refrigerant} Twin Pipe${fanCount > 0 ? `, ${fanCount} BLDC Fans` : ''})`,
      'sys',
      1,
      Math.max(950, hvacCost)
    );
  }

  const divMap = new Map<string, number>();
  for (const item of items) {
    divMap.set(item.division, (divMap.get(item.division) ?? 0) + item.totalCost);
  }
  // Division 07: External works (boundary wall, gates, entrance canopy, meter box).
  const site = siteLayout(project);
  if (project.site && site.boundary && site.wallLength > 0) {
    add('07.01', '07 External Works', `Boundary wall ${Math.round(site.thickness * 1000)} mm blockwork, ${site.height.toFixed(1)} m high, piers at 3 m, rendered & painted both sides, coping`, 'm²', site.wallLength * site.height, Number((r.partitionWallPerM2 * 1.55).toFixed(2)));
    add('07.02', '07 External Works', 'Boundary wall strip footing & plinth beam (excavation, PCC, RC)', 'lm', site.wallLength, 38);
  }
  const gateRate: Record<string, number> = { sliding: 1450, swing_double: 1100, timber: 1300, pedestrian: 380 };
  for (const [i, g] of site.gates.entries()) {
    add(`07.1${i}`, '07 External Works', `${g.gate.kind === 'sliding' ? 'Sliding' : g.gate.kind === 'swing_double' ? 'Double swing' : g.gate.kind === 'timber' ? 'Timber' : 'Pedestrian'} gate ${g.gate.width.toFixed(1)} m, galvanised & powder-coated, with track/hinges and lock`, 'nr', 1, gateRate[g.gate.kind] ?? 1100);
    if (g.ped) add(`07.1${i}p`, '07 External Works', `Pedestrian door ${g.gate.pedestrianWidth.toFixed(1)} m beside the gate, with lock`, 'nr', 1, gateRate.pedestrian);
    if (g.gate.canopy !== 'none') add(`07.1${i}c`, '07 External Works', `${g.gate.canopy === 'gable' ? 'Gable (two-slope)' : 'Flat'} canopy over the entrance: piers, steel frame, roof sheeting to match the house`, 'nr', 1, g.gate.canopy === 'gable' ? 680 : 520);
  }
  if (site.meter) add('07.20', '07 External Works', 'Utility meter enclosure built into the boundary pier, with cable duct to the MDB', 'nr', 1, 180);

  const subtotal = items.reduce((s, i) => s + i.totalCost, 0);
  const divisionTotals = Array.from(divMap.entries()).map(([division, amount]) => ({
    division,
    amount: Number(amount.toFixed(2)),
    sharePct: subtotal > 0 ? Number(((amount / subtotal) * 100).toFixed(1)) : 0,
  }));

  const contingencyPct = 8;
  const contingencyAmount = Number((subtotal * (contingencyPct / 100)).toFixed(2));
  const grandTotal = Number((subtotal + contingencyAmount).toFixed(2));

  // Raw Material Estimates using standard civil mix factors (C25 1:1.5:3, 1:4 mortar)
  const totalConcrete = pccVol + footingConcreteVol + superConcreteVol;
  const cementBags50Kg = Math.ceil(totalConcrete * 7.2 + (extWallVol + intWallNetArea * 0.12) * 1.6 + (internalPlasterArea + externalPlasterArea) * 0.16);
  const riverSandM3 = Number((totalConcrete * 0.45 + (extWallVol + intWallNetArea * 0.12) * 0.25 + (internalPlasterArea + externalPlasterArea) * 0.022).toFixed(1));
  const coarseAggregateM3 = Number((totalConcrete * 0.88).toFixed(1));
  const bricksOrBlocksCount = Math.ceil(extWallVol * 460 + intWallNetArea * 52);

  return {
    items,
    divisionTotals,
    subtotal: Number(subtotal.toFixed(2)),
    contingencyPct,
    contingencyAmount,
    grandTotal,
    grossFloorAreaM2: Number(grossFloorArea.toFixed(2)),
    costPerM2: grossFloorArea > 0 ? Number((grandTotal / grossFloorArea).toFixed(2)) : 0,
    rawMaterials: {
      cementBags50Kg,
      riverSandM3,
      coarseAggregateM3,
      bricksOrBlocksCount,
      rebarSteelKg: Math.ceil(rebarKg),
      paintLiters: Math.ceil(totalPaintArea * 0.24),
      tileAreaM2: Number((tileFloorArea * 1.08).toFixed(1)),
    },
  };
}
