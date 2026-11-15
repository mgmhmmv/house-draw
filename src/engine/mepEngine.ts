import {
  BuildingProject,
  FloorLevel,
  getHVACConfig,
  getSolarConfig,
  MEPCircuit,
  MEPNode,
  Point2D,
} from '../model/types';
import { levelBoundingBox, polygonArea, polygonCentroid, uid } from './geometry';

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
  stringIscA: number;
  inverterKW: number;
  batteryKWh: number;
  dcCableSpec: string;
  dcIsolatorSpec: string;
  acBreakerSpec: string;
  estimatedDailyKWh: number;
  netGridDemandKW: number;
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
  circuits: ElectricalCircuitScheduleRow[];
}

export interface PlumbingRiserReport {
  occupancyCount: number;
  dailyWaterDemandLiters: number;
  overheadTankLiters: number;
  undergroundTankLiters: number;
  boosterPumpKW: number;
  totalDFU: number;
  supplyMainPipe: string;
  soilStackPipe: string;
  wasteStackPipe: string;
  totalWSFU: number;
  peakFlowLps: number;
  designVelocityMps: number;
  pumpHeadMeters: number;
  roofCatchmentM2: number;
  rainfallIntensityMmh: number;
  stormwaterRunoffLps: number;
  rainwaterDownpipesCount: number;
  rainwaterPipeSpec: string;
  rainwaterTankSpec: string;
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
  ceilingFansEnabled = false
): FloorLevel {
  const bb = levelBoundingBox(level);
  const mdbPos: Point2D = {
    x: Number((bb.minX + 0.5).toFixed(2)),
    y: Number((bb.minY + 0.5).toFixed(2)),
  };

  const nodes: MEPNode[] = [
    {
      id: uid('mep'),
      kind: 'mdb',
      system: 'electrical',
      position: mdbPos,
      label: `MDB-${level.index + 1}`,
    },
    {
      id: uid('mep'),
      kind: 'water_main',
      system: 'plumbing',
      position: { x: Number((bb.minX + 0.4).toFixed(2)), y: Number((bb.maxY - 0.6).toFixed(2)) },
      label: 'WM-IN',
    },
  ];

  const lightPts: Point2D[] = [mdbPos];
  const powerPts: Point2D[] = [mdbPos];
  const hvacPts: Point2D[] = [mdbPos];
  const splitPositions: Point2D[] = [];
  const coldPts: Point2D[] = [nodes[1].position];
  const drainPts: Point2D[] = [];

  for (const r of level.rooms) {
    const c = polygonCentroid(r.polygon);
    const ys = r.polygon.map((p) => p.y);
    const rMinY = Math.min(...ys);
    const rArea = Math.max(6, polygonArea(r.polygon));

    const lightId = uid('mep');
    nodes.push({
      id: lightId,
      kind: 'light_ceiling',
      system: 'electrical',
      position: { x: Number(c.x.toFixed(2)), y: Number(c.y.toFixed(2)) },
      circuitId: `L${level.index + 1}`,
      wattage: r.category === 'living' || r.category === 'kitchen' ? 36 : 18,
      label: 'LED',
    });
    lightPts.push({ x: Number(c.x.toFixed(2)), y: Number(c.y.toFixed(2)) });

    // Switch near centroid offset
    nodes.push({
      id: uid('mep'),
      kind: 'switch_1g',
      system: 'electrical',
      position: { x: Number((c.x - 0.8).toFixed(2)), y: Number((c.y + 0.6).toFixed(2)) },
      circuitId: `L${level.index + 1}`,
      wattage: 0,
    });

    // Power outlet
    if (r.category !== 'porch' && r.category !== 'balcony') {
      const outletPos = { x: Number((c.x + 0.9).toFixed(2)), y: Number((c.y - 0.6).toFixed(2)) };
      nodes.push({
        id: uid('mep'),
        kind: 'outlet_duplex',
        system: 'electrical',
        position: outletPos,
        circuitId: r.category === 'kitchen' ? `K${level.index + 1}` : `P${level.index + 1}`,
        wattage: r.category === 'kitchen' ? 1800 : 350,
      });
      powerPts.push(outletPos);
    }

    // Tropical Ceiling Fan for Living, Bedroom, Dining, Porch
    if (
      ceilingFansEnabled &&
      (r.category === 'living' || r.category === 'bedroom' || r.category === 'dining' || r.category === 'porch')
    ) {
      nodes.push({
        id: uid('mep'),
        kind: 'ceiling_fan',
        system: 'electrical',
        position: { x: Number((c.x + 0.35).toFixed(2)), y: Number((c.y + 0.25).toFixed(2)) },
        circuitId: `L${level.index + 1}`,
        wattage: 45,
        label: 'CF',
      });
    }

    // Inverter Split AC for conditioned habitable rooms
    if (
      hvacEnabled &&
      (r.category === 'living' ||
        r.category === 'dining' ||
        r.category === 'kitchen' ||
        r.category === 'bedroom' ||
        r.category === 'office')
    ) {
      const btuK = rArea > 26 ? 24 : rArea > 18 ? 18 : rArea > 12 ? 12 : 9;
      const acW = Math.round((btuK / 3.412) * 280);
      const wallInsetY = Number((rMinY + 0.32).toFixed(2));
      const acPos = { x: Number(c.x.toFixed(2)), y: wallInsetY };
      nodes.push({
        id: uid('mep'),
        kind: 'ac_split',
        system: 'electrical',
        position: acPos,
        circuitId: `AC${level.index + 1}`,
        wattage: acW,
        label: `AC ${btuK}k`,
      });
      hvacPts.push(acPos);
      splitPositions.push(acPos);
    }

    // Smoke detectors per NFPA 72 (Living, Hallway, Bedrooms, Kitchen)
    if (r.category === 'living' || r.category === 'hallway' || r.category === 'bedroom' || r.category === 'kitchen') {
      nodes.push({
        id: uid('mep'),
        kind: 'light_ceiling',
        system: 'electrical',
        position: { x: Number((c.x - 0.5).toFixed(2)), y: Number((c.y - 0.5).toFixed(2)) },
        circuitId: `L${level.index + 1}`,
        wattage: 2,
        label: 'SD',
      });
    }

    // Plumbing fixtures & ASHRAE 62.2 Exhaust Fan for bathroom / kitchen / utility
    if (r.category === 'bathroom') {
      const wcPos = { x: Number((c.x - 0.5).toFixed(2)), y: Number((c.y - 0.4).toFixed(2)) };
      const basinPos = { x: Number((c.x + 0.5).toFixed(2)), y: Number((c.y - 0.4).toFixed(2)) };
      const showerPos = { x: Number((c.x + 0.5).toFixed(2)), y: Number((c.y + 0.5).toFixed(2)) };
      const whPos = { x: Number((c.x - 0.5).toFixed(2)), y: Number((c.y + 0.5).toFixed(2)) };

      nodes.push(
        { id: uid('mep'), kind: 'plumb_wc', system: 'plumbing', position: wcPos, dfu: 4, label: 'WC' },
        { id: uid('mep'), kind: 'plumb_basin', system: 'plumbing', position: basinPos, dfu: 1, label: 'WHB' },
        { id: uid('mep'), kind: 'plumb_shower', system: 'plumbing', position: showerPos, dfu: 2, label: 'SH' },
        { id: uid('mep'), kind: 'water_heater', system: 'electrical', position: whPos, wattage: 2000, circuitId: `WH${level.index + 1}`, label: 'WH' },
        { id: uid('mep'), kind: 'ac_split', system: 'electrical', position: { x: Number(c.x.toFixed(2)), y: Number((c.y + 0.7).toFixed(2)) }, wattage: 35, circuitId: `L${level.index + 1}`, label: 'EF' }
      );
      coldPts.push(wcPos, basinPos, showerPos);
      drainPts.push(wcPos, basinPos, showerPos);
    } else if (r.category === 'kitchen' || r.category === 'utility') {
      const sinkPos = { x: Number((c.x + 0.6).toFixed(2)), y: Number((c.y - 0.5).toFixed(2)) };
      nodes.push(
        { id: uid('mep'), kind: 'plumb_sink', system: 'plumbing', position: sinkPos, dfu: 2, label: 'KS' },
        { id: uid('mep'), kind: 'ac_split', system: 'electrical', position: { x: Number((c.x - 0.6).toFixed(2)), y: Number((c.y - 0.6).toFixed(2)) }, wattage: 65, circuitId: `L${level.index + 1}`, label: 'EF' }
      );
      coldPts.push(sinkPos);
      drainPts.push(sinkPos);
    }
  }

  // Outdoor Condenser Units (CDU) + Copper Refrigerant & Condensate Lines
  const cduPositions: Point2D[] = [];
  if (hvacEnabled && splitPositions.length > 0 && level.walls.length > 0) {
    const cdu1: Point2D = {
      x: Number((bb.maxX + 0.35).toFixed(2)),
      y: Number((bb.minY + Math.min(2.2, bb.depth * 0.3)).toFixed(2)),
    };
    cduPositions.push(cdu1);
    nodes.push({
      id: uid('mep'),
      kind: 'ac_condenser',
      system: 'electrical',
      position: cdu1,
      circuitId: `AC${level.index + 1}`,
      wattage: 0,
      label: `CDU-${level.index + 1}A`,
    });

    if (splitPositions.length >= 3) {
      const cdu2: Point2D = {
        x: Number((bb.maxX + 0.35).toFixed(2)),
        y: Number((bb.maxY - Math.min(2.2, bb.depth * 0.3)).toFixed(2)),
      };
      cduPositions.push(cdu2);
      nodes.push({
        id: uid('mep'),
        kind: 'ac_condenser',
        system: 'electrical',
        position: cdu2,
        circuitId: `AC${level.index + 1}`,
        wattage: 0,
        label: `CDU-${level.index + 1}B`,
      });
    }
  }

  const circuits: MEPCircuit[] = [
    {
      id: `L${level.index + 1}`,
      name: `Lighting & Fans Circuit L${level.index + 1}`,
      system: 'electrical_light',
      points: lightPts,
      spec: '2×1.5mm² + 1.5mm²E CU/PVC in 20mm Conduit',
    },
    {
      id: `P${level.index + 1}`,
      name: `General Power Ring P${level.index + 1}`,
      system: 'electrical_power',
      points: powerPts,
      spec: '2×2.5mm² + 2.5mm²E CU/PVC in 25mm Conduit',
    },
  ];
  if (hvacPts.length > 1) {
    circuits.push({
      id: `AC${level.index + 1}`,
      name: `HVAC Split Units AC${level.index + 1}`,
      system: 'electrical_hvac',
      points: [...hvacPts, ...cduPositions],
      spec: '2×4.0mm² + 4.0mm²E CU/XLPE Marine',
    });
  }
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
    const invPos: Point2D = {
      x: Number((bb.minX + 1.3).toFixed(2)),
      y: Number((bb.minY + 0.5).toFixed(2)),
    };
    const bessPos: Point2D = {
      x: Number((bb.minX + 2.1).toFixed(2)),
      y: Number((bb.minY + 0.5).toFixed(2)),
    };
    nodes.push(
      { id: uid('mep'), kind: 'solar_pv', system: 'electrical', position: pvArrPos, circuitId: 'PV-DC1', wattage: 5400, label: 'PV-ARRAY' },
      { id: uid('mep'), kind: 'solar_inv', system: 'electrical', position: invPos, circuitId: 'PV-DC1', wattage: 0, label: 'HYB-INV' },
      { id: uid('mep'), kind: 'solar_bess', system: 'electrical', position: bessPos, circuitId: 'PV-DC1', wattage: 0, label: 'BESS' }
    );
    circuits.push({
      id: 'PV-DC1',
      name: 'Solar PV DC String & AC Coupled Feed',
      system: 'electrical_pv',
      points: [pvArrPos, invPos, bessPos, mdbPos],
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
  const allNodes = project.levels.flatMap((l) => l.mepNodes);
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
    lengthOffset = 0
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
    const cableLengthM = Math.max(12, avgRunM + lengthOffset);
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

  const circuits: ElectricalCircuitScheduleRow[] = [
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
  const stringsCount = solar.panelCount >= 8 ? 2 : 1;
  const panelsPerString = Math.max(1, Math.ceil(solar.panelCount / stringsCount));
  const arrayKwp = Number(((solar.panelCount * solar.panelWattage) / 1000).toFixed(2));
  const stringVocV = Number((panelsPerString * 41.5).toFixed(1));
  const stringIscA = 13.8;
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
      stringIscA,
      inverterKW: solar.inverterKW,
      batteryKWh: solar.batteryKWh,
      dcCableSpec: '2×6.0mm² EN 50618 H1Z2Z2-K 1.5kV DC',
      dcIsolatorSpec: '32A 1000V DC 4P + Type-2 DC SPD',
      acBreakerSpec,
      estimatedDailyKWh,
      netGridDemandKW,
    },
    circuits,
  };
}

export function computePlumbingRiser(project: BuildingProject): PlumbingRiserReport {
  const bedrooms = project.levels.flatMap((l) => l.rooms).filter((r) => r.category === 'bedroom').length;
  const occupancyCount = Math.max(2, bedrooms * 2);
  const dailyWaterDemandLiters = occupancyCount * 150;
  const overheadTankLiters = Math.ceil((dailyWaterDemandLiters * 1.0) / 500) * 500;
  const undergroundTankLiters = Math.ceil((dailyWaterDemandLiters * 2.0) / 1000) * 1000;

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
  const pumpHeadMeters = Math.round(project.levels.length * 3.4 + 9);

  // BS EN 12056-3 Roof Stormwater Runoff: Q = C * i * A / 3600 (Maldives monsoon i=140 mm/h vs 75 mm/h)
  const hvacCfg = getHVACConfig(project);
  const isMaldives = hvacCfg.climateZone === 'maldives_tropical';
  const gBB = project.levels[0] ? levelBoundingBox(project.levels[0]) : { width: 12, depth: 10 };
  const ov = project.roof.overhang;
  const roofCatchmentM2 = Number(((gBB.width + ov * 2) * (gBB.depth + ov * 2)).toFixed(1));
  const rainfallIntensityMmh = isMaldives ? 140 : 75;
  const stormwaterRunoffLps = Number(((0.95 * rainfallIntensityMmh * roofCatchmentM2) / 3600).toFixed(2));
  const rainwaterDownpipesCount = Math.max(isMaldives ? 4 : 2, Math.ceil(roofCatchmentM2 / (isMaldives ? 32 : 45)));
  const rainwaterTankSpec = isMaldives
    ? '3,500L HDPE Rainwater Harvesting + First-Flush + UV Filter (MNBC)'
    : 'Stormwater Soakaway Pit';

  const inspectionChambers = [
    { id: 'IC-1', sizeMm: '600 × 600', invertLevelM: -0.55, location: 'Soil & Waste Riser Base' },
    { id: 'IC-2', sizeMm: '600 × 600', invertLevelM: -0.78, location: 'Kitchen Grease Trap Outlet' },
    { id: 'MH-MAIN', sizeMm: '900 × 900', invertLevelM: -1.05, location: 'Plot Boundary Municipal Tie-In' },
  ];

  return {
    occupancyCount,
    dailyWaterDemandLiters,
    overheadTankLiters,
    undergroundTankLiters,
    boosterPumpKW: project.levels.length > 1 ? 1.1 : 0.75,
    totalDFU,
    supplyMainPipe: totalDFU > 20 ? 'Ø32mm PPR PN20' : 'Ø25mm PPR PN20',
    soilStackPipe: 'Ø110mm uPVC Class-B Soil + Ø50mm Vent',
    wasteStackPipe: 'Ø50mm / Ø75mm uPVC Greywater w/ Floor Traps',
    totalWSFU,
    peakFlowLps,
    designVelocityMps,
    pumpHeadMeters,
    roofCatchmentM2,
    rainfallIntensityMmh,
    stormwaterRunoffLps,
    rainwaterDownpipesCount,
    rainwaterPipeSpec: 'Ø100mm uPVC Class-B RWP',
    rainwaterTankSpec,
    inspectionChambers,
    fixtureSummary,
  };
}
