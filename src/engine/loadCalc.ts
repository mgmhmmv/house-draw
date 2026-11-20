/**
 * Standard Electrical Load Calculation Engine (IEC 60364 / BS 7671 / MNBC / STELCO & FENAKA).
 * Computes level-by-level and category-by-category connected load, diversity factors,
 * maximum demand (kW & kVA), design current, main switchgear & incoming feeder sizing,
 * estimated daily energy consumption, and solar PV offset for any BuildingProject.
 */
import { getRoofDrainageConfig, getSolarConfig, scopeLevels, type BuildingProject, type FloorLevel, type Room } from '../model/types';

export interface LoadCategoryRow {
  id: string;
  category: string;
  basis: string;
  connectedKW: number;
  diversityFactor: number;
  demandKW: number;
  powerFactor: number;
  apparentKVA: number;
  designAmps: number;
  dailyKWh: number;
}

export interface LoadLevelRow {
  levelId: string;
  levelName: string;
  areaM2: number;
  source: 'Measured' | 'Estimated';
  lightingKW: number;
  powerKW: number;
  hvacKW: number;
  waterKitchenKW: number;
  connectedKW: number;
  demandKW: number;
  dailyKWh: number;
}

export interface LoadApplianceRow {
  id: string;
  item: string;
  category: 'Lighting' | 'Fans' | 'HVAC' | 'Appliances' | 'Electronics' | 'Sockets' | 'Water Heater' | 'Common';
  qty: number;
  unitWatts: number;
  connectedKW: number;
  diversityFactor: number;
  demandKW: number;
  hoursPerDay: number;
  dailyKWh: number;
}

export interface LoadCalculationReport {
  levels: LoadLevelRow[];
  categories: LoadCategoryRow[];
  appliances: LoadApplianceRow[];
  totalAreaM2: number;
  totalConnectedKW: number;
  totalDemandKW: number;
  overallDiversity: number;
  powerFactor: number;
  totalApparentKVA: number;
  supplySystem: string;
  isThreePhase: boolean;
  nominalVoltageV: number;
  designCurrentA: number;
  recommendedBreakerA: number;
  mainBreakerSpec: string;
  incomingCableSpec: string;
  earthingSpec: string;
  spdSpec: string;
  totalDailyKWh: number;
  estMonthlyKWh: number;
  solar: {
    enabled: boolean;
    panelCount: number;
    panelWattage: number;
    arrayKwp: number;
    inverterKW: number;
    batteryKWh: number;
    estDailyKWh: number;
    estAnnualKWh: number;
    offsetPct: number;
    recommendedInverterKW: number;
    recommendedBatteryKWh: number;
  };
  methodologyNote: string;
}

const STANDARD_BREAKERS = [32, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630];

function nextBreaker(amps: number): number {
  const target = amps * 1.25;
  return STANDARD_BREAKERS.find((b) => b >= target) ?? Math.ceil(target / 100) * 100;
}

function feederCableSpec(breakerA: number, threePhase: boolean): string {
  const cores = threePhase ? '4C' : '2C';
  if (breakerA <= 40) return `${cores} × 10 mm² Cu XLPE/SWA + 10 mm² PE`;
  if (breakerA <= 63) return `${cores} × 16 mm² Cu XLPE/SWA + 16 mm² PE`;
  if (breakerA <= 80) return `${cores} × 25 mm² Cu XLPE/SWA + 16 mm² PE`;
  if (breakerA <= 100) return `${cores} × 35 mm² Cu XLPE/SWA + 16 mm² PE`;
  if (breakerA <= 125) return `${cores} × 50 mm² Cu XLPE/SWA + 25 mm² PE`;
  if (breakerA <= 160) return `${cores} × 70 mm² Cu XLPE/SWA + 35 mm² PE`;
  if (breakerA <= 200) return `${cores} × 95 mm² Cu XLPE/SWA + 50 mm² PE`;
  if (breakerA <= 250) return `${cores} × 120 mm² Cu XLPE/SWA + 70 mm² PE`;
  if (breakerA <= 315) return `${cores} × 150 mm² Cu XLPE/SWA + 70 mm² PE`;
  return `${cores} × 185 mm² Cu XLPE/SWA + 95 mm² PE`;
}

function roomArea(r: Room): number {
  const poly = r.polygon;
  if (!poly || poly.length < 3) return 0;
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

function roomKind(r: Room): string {
  const c = (r.category as string | undefined) || '';
  if (c) return c.toLowerCase();
  const n = (r.name || '').toLowerCase();
  if (/terrace|balcony|verandah|porch|deck/.test(n)) return 'balcony';
  if (/bath|toilet|wc|restroom|ensuite/.test(n)) return 'bathroom';
  if (/kitchen|pantry/.test(n)) return 'kitchen';
  if (/bed|suite|kids|master/.test(n)) return 'bedroom';
  if (/living|lounge|cafe|shop|retail/.test(n)) return 'living';
  if (/dining/.test(n)) return 'dining';
  if (/office|study/.test(n)) return 'office';
  return 'hallway';
}

function isOutdoorRoom(r: Room): boolean {
  const t = roomKind(r);
  return t === 'terrace' || t === 'balcony' || t === 'porch' || t === 'garage' || t === 'outdoor';
}

function isConditionedRoom(r: Room): boolean {
  const t = roomKind(r);
  return t === 'bedroom' || t === 'living' || t === 'dining' || t === 'office' || t === 'study';
}

function estimateRoomAcKW(r: Room): number {
  if (!isConditionedRoom(r)) return 0;
  const a = roomArea(r);
  if (a < 5) return 0;
  if (a <= 15) return 1.1; // 12,000 BTU inverter split
  if (a <= 26) return 1.6; // 18,000 BTU inverter split
  if (a <= 45) return 2.2; // 24,000 BTU inverter split
  return 3.0; // 36,000 BTU / twin split
}

function computeLevelLoad(lvl: FloorLevel): LoadLevelRow {
  const enclosedRooms = lvl.rooms.filter((r) => !isOutdoorRoom(r));
  const areaM2 = Number(lvl.rooms.reduce((s, r) => s + roomArea(r), 0).toFixed(1));
  const enclosedArea = enclosedRooms.reduce((s, r) => s + roomArea(r), 0);

  // Check if the level has placed MEP fixture nodes (beyond DB/meter/solar)
  const fixtureNodes = lvl.mepNodes.filter(
    (n) =>
      n.kind === 'light_ceiling' ||
      n.kind === 'ceiling_fan' ||
      n.kind === 'outlet_duplex' ||
      n.kind === 'ac_split' ||
      n.kind === 'water_heater'
  );
  const measured = fixtureNodes.length >= 3;

  let lightingKW = 0;
  let powerKW = 0;
  let hvacKW = 0;
  let waterKitchenKW = 0;

  if (measured) {
    for (const n of fixtureNodes) {
      if (n.kind === 'light_ceiling') lightingKW += (n.wattage ?? 18) / 1000;
      else if (n.kind === 'ceiling_fan') lightingKW += (n.wattage ?? 60) / 1000;
      else if (n.kind === 'outlet_duplex') powerKW += (n.wattage ?? 350) / 1000;
      else if (n.kind === 'ac_split') {
        if (n.label === 'EF') lightingKW += (n.wattage ?? 40) / 1000;
        else hvacKW += (n.wattage ?? 1500) / 1000;
      } else if (n.kind === 'water_heater') waterKitchenKW += (n.wattage ?? 1800) / 1000;
    }
    const kitchens = enclosedRooms.filter((r) => roomKind(r) === 'kitchen').length;
    waterKitchenKW += kitchens * 3.5;
  } else {
    // Standard MNBC / IEC 60364 room-based electrical allowance
    const fanRooms = enclosedRooms.filter((r) => isConditionedRoom(r) || roomKind(r) === 'kitchen').length;
    lightingKW = (areaM2 * 9) / 1000 + fanRooms * 0.06;
    powerKW = Math.max(1.0, (enclosedArea * 18) / 1000);
    hvacKW = enclosedRooms.reduce((s, r) => s + estimateRoomAcKW(r), 0);
    const baths = enclosedRooms.filter((r) => roomKind(r) === 'bathroom').length;
    const kitchens = enclosedRooms.filter((r) => roomKind(r) === 'kitchen').length;
    waterKitchenKW = baths * 1.5 + kitchens * 3.5;
  }

  const connectedKW = lightingKW + powerKW + hvacKW + waterKitchenKW;
  // Diversified demand per level using standard IEC 60364 / Maldives tropical factors
  const demandKW = lightingKW * 0.66 + powerKW * 0.45 + hvacKW * 0.70 + waterKitchenKW * 0.50;
  // Daily kWh estimate (inverter AC avg ~38% of peak over 9 hrs, lighting 5 hrs, sockets 4 hrs, WH/kitchen 1.8 hrs)
  const dailyKWh = lightingKW * 0.66 * 5.0 + powerKW * 0.35 * 4.0 + hvacKW * 0.38 * 9.0 + waterKitchenKW * 0.45 * 1.8;

  return {
    levelId: lvl.id,
    levelName: lvl.name.replace(/\s*\(.*\)/, ''),
    areaM2,
    source: measured ? 'Measured' : 'Estimated',
    lightingKW: Number(lightingKW.toFixed(2)),
    powerKW: Number(powerKW.toFixed(2)),
    hvacKW: Number(hvacKW.toFixed(2)),
    waterKitchenKW: Number(waterKitchenKW.toFixed(2)),
    connectedKW: Number(connectedKW.toFixed(2)),
    demandKW: Number(demandKW.toFixed(2)),
    dailyKWh: Number(dailyKWh.toFixed(1)),
  };
}

export function computeLoadCalculation(model: BuildingProject): LoadCalculationReport {
  const activeLevels = scopeLevels(model);
  const decorativeCount = model.levels.length - activeLevels.length;
  const levels = activeLevels.map(computeLevelLoad);
  const totalAreaM2 = Number(levels.reduce((s, l) => s + l.areaM2, 0).toFixed(1));

  // Common building mechanical loads (only when Ground/whole building is in scope, not upper-floor-only renovations)
  const isPartialRenovation = decorativeCount > 0;
  const hasPump = !isPartialRenovation && (model.waterSupply?.mode as string | undefined) !== 'mains';
  const hasLift = !isPartialRenovation && activeLevels.length >= 5;
  const commonConnectedKW = (hasPump ? 0.75 : 0) + (hasLift ? 4.5 : 0);
  const commonDemandKW = (hasPump ? 0.75 * 0.8 : 0) + (hasLift ? 4.5 * 0.5 : 0);
  const commonDailyKWh = (hasPump ? 1.5 : 0) + (hasLift ? 8.5 : 0);

  if (commonConnectedKW > 0) {
    levels.push({
      levelId: 'common_mep',
      levelName: hasLift ? 'Common (Lift & Pump)' : 'Common (Pump)',
      areaM2: 0,
      source: 'Estimated',
      lightingKW: 0,
      powerKW: Number(commonConnectedKW.toFixed(2)),
      hvacKW: 0,
      waterKitchenKW: 0,
      connectedKW: Number(commonConnectedKW.toFixed(2)),
      demandKW: Number(commonDemandKW.toFixed(2)),
      dailyKWh: Number(commonDailyKWh.toFixed(1)),
    });
  }

  const sumLight = levels.reduce((s, l) => s + l.lightingKW, 0);
  const sumPower = levels.filter((l) => l.levelId !== 'common_mep').reduce((s, l) => s + l.powerKW, 0);
  const sumHvac = levels.reduce((s, l) => s + l.hvacKW, 0);
  const sumWHK = levels.reduce((s, l) => s + l.waterKitchenKW, 0);

  // Inter-floor diversity scales slightly down for multi-storey buildings (BS 7671 / IEC 60364 coincidence)
  const multiFloorFactor = activeLevels.length >= 6 ? 0.82 : activeLevels.length >= 3 ? 0.90 : 1.0;

  const rawCats: {
    id: string;
    category: string;
    basis: string;
    connectedKW: number;
    df: number;
    pf: number;
    dailyKWh: number;
  }[] = [
    {
      id: 'L',
      category: 'Lighting & Ceiling Fans',
      basis: 'LED 9–10 W/m² + 60 W fans (IEC 60364)',
      connectedKW: sumLight,
      df: Number((0.66 * multiFloorFactor).toFixed(2)),
      pf: 0.92,
      dailyKWh: sumLight * 0.66 * 5.0 * multiFloorFactor,
    },
    {
      id: 'P',
      category: 'General Power & Sockets',
      basis: '13A twin outlets / 18 W/m² allowance',
      connectedKW: sumPower,
      df: Number((0.45 * multiFloorFactor).toFixed(2)),
      pf: 0.90,
      dailyKWh: sumPower * 0.35 * 4.0 * multiFloorFactor,
    },
    {
      id: 'AC',
      category: 'Air Conditioning (Inverter)',
      basis: 'Tropical split units (12k–24k BTU)',
      connectedKW: sumHvac,
      df: Number((0.70 * multiFloorFactor).toFixed(2)),
      pf: 0.85,
      dailyKWh: sumHvac * 0.38 * 9.0 * multiFloorFactor,
    },
    {
      id: 'WH',
      category: 'Water Heaters & Kitchens',
      basis: '1.5 kW/bath + 3.5 kW/kitchen',
      connectedKW: sumWHK,
      df: Number((0.50 * multiFloorFactor).toFixed(2)),
      pf: 0.95,
      dailyKWh: sumWHK * 0.45 * 1.8 * multiFloorFactor,
    },
  ];

  if (commonConnectedKW > 0) {
    rawCats.push({
      id: 'CM',
      category: hasLift ? 'Lift & Booster Pump' : 'Water Pressure Pump',
      basis: hasLift ? '4.5 kW traction lift + 0.75 kW pump' : '0.75 kW pressure booster pump',
      connectedKW: commonConnectedKW,
      df: Number((commonDemandKW / commonConnectedKW).toFixed(2)),
      pf: 0.85,
      dailyKWh: commonDailyKWh,
    });
  }

  const prelimDemand = rawCats.reduce((s, c) => s + c.connectedKW * c.df, 0);
  const isThreePhase = prelimDemand > 10 || activeLevels.length >= 2;
  const nominalVoltageV = isThreePhase ? 400 : 230;
  const denom = isThreePhase ? Math.sqrt(3) * 400 : 230;

  const categories: LoadCategoryRow[] = rawCats
    .filter((c) => c.connectedKW > 0.01)
    .map((c) => {
      const demandKW = c.connectedKW * c.df;
      const apparentKVA = demandKW / c.pf;
      const designAmps = (apparentKVA * 1000) / denom;
      return {
        id: c.id,
        category: c.category,
        basis: c.basis,
        connectedKW: Number(c.connectedKW.toFixed(2)),
        diversityFactor: c.df,
        demandKW: Number(demandKW.toFixed(2)),
        powerFactor: c.pf,
        apparentKVA: Number(apparentKVA.toFixed(2)),
        designAmps: Number(designAmps.toFixed(1)),
        dailyKWh: Number(c.dailyKWh.toFixed(1)),
      };
    });

  const totalConnectedKW = Number(categories.reduce((s, c) => s + c.connectedKW, 0).toFixed(2));
  const totalDemandKW = Number(categories.reduce((s, c) => s + c.demandKW, 0).toFixed(2));
  const totalApparentKVA = Number(categories.reduce((s, c) => s + c.apparentKVA, 0).toFixed(2));
  const overallDiversity = totalConnectedKW > 0 ? Number((totalDemandKW / totalConnectedKW).toFixed(2)) : 0;
  const powerFactor = totalApparentKVA > 0 ? Number((totalDemandKW / totalApparentKVA).toFixed(2)) : 0.88;
  const designCurrentA = Number(((totalApparentKVA * 1000) / denom).toFixed(1));
  const recommendedBreakerA = nextBreaker(designCurrentA);
  const totalDailyKWh = Number(categories.reduce((s, c) => s + c.dailyKWh, 0).toFixed(1));
  const estMonthlyKWh = Math.round(totalDailyKWh * 30);

  // Itemized equipment & appliance schedule derived from in-scope rooms, furniture & MEP nodes
  const inScopeRooms = activeLevels.flatMap((l) => l.rooms);
  const enclosedAll = inScopeRooms.filter((r) => !isOutdoorRoom(r));
  const inScopeFurn = activeLevels.flatMap((l) => l.furniture);
  const inScopeNodes = activeLevels.flatMap((l) => l.mepNodes);

  const ac12 = enclosedAll.filter((r) => estimateRoomAcKW(r) === 1.1).length;
  const ac18 = enclosedAll.filter((r) => estimateRoomAcKW(r) === 1.6).length;
  const ac24 = enclosedAll.filter((r) => estimateRoomAcKW(r) >= 2.2).length;
  const fanQty = Math.max(
    inScopeNodes.filter((n) => n.kind === 'ceiling_fan').length,
    enclosedAll.filter((r) => isConditionedRoom(r) || roomKind(r) === 'kitchen').length
  );
  const bathQty = enclosedAll.filter((r) => roomKind(r) === 'bathroom').length;
  const kitchenQty = enclosedAll.filter((r) => roomKind(r) === 'kitchen').length;
  const tvQty = Math.max(
    inScopeFurn.filter((f) => /tv/i.test(f.type)).length,
    enclosedAll.filter((r) => roomKind(r) === 'living' || roomKind(r) === 'bedroom').length > 0 ? Math.min(3, Math.max(1, Math.ceil(enclosedAll.filter((r) => roomKind(r) === 'bedroom' || roomKind(r) === 'living').length / 2))) : 0
  );
  const pcQty = Math.max(1, inScopeFurn.filter((f) => /desk/i.test(f.type)).length);
  const ledQty = Math.max(
    inScopeNodes.filter((n) => n.kind === 'light_ceiling').length,
    Math.max(4, Math.round((totalAreaM2 * 9) / 18))
  );
  const fridgeQty = Math.max(inScopeFurn.filter((f) => /fridge/i.test(f.type)).length, kitchenQty > 0 ? kitchenQty : 1);
  const washerQty = Math.max(1, Math.floor(activeLevels.length / 2));

  const appliances: LoadApplianceRow[] = [];
  const pushApp = (
    id: string,
    item: string,
    category: LoadApplianceRow['category'],
    qty: number,
    unitWatts: number,
    df: number,
    hoursPerDay: number,
    dutyFactor = 1.0
  ) => {
    if (qty <= 0) return;
    const connectedKW = (qty * unitWatts) / 1000;
    const demandKW = connectedKW * df * multiFloorFactor;
    const dailyKWh = connectedKW * dutyFactor * hoursPerDay * multiFloorFactor;
    appliances.push({
      id,
      item,
      category,
      qty,
      unitWatts,
      connectedKW: Number(connectedKW.toFixed(2)),
      diversityFactor: Number((df * multiFloorFactor).toFixed(2)),
      demandKW: Number(demandKW.toFixed(2)),
      hoursPerDay,
      dailyKWh: Number(dailyKWh.toFixed(1)),
    });
  };

  pushApp('A01', 'LED Downlights & General Luminaires', 'Lighting', ledQty, 18, 0.70, 5.0, 0.65);
  pushApp('A02', 'Ceiling Fans (DC / Standard)', 'Fans', fanQty, 60, 0.70, 8.0, 0.70);
  pushApp('A03', 'Bathroom Exhaust Fans', 'Fans', bathQty, 40, 0.50, 3.0, 0.50);
  pushApp('A04', '12,000 BTU Inverter Split AC (1.0 TR)', 'HVAC', ac12, 1100, 0.70, 9.0, 0.38);
  pushApp('A05', '18,000 BTU Inverter Split AC (1.5 TR)', 'HVAC', ac18, 1600, 0.70, 9.0, 0.38);
  pushApp('A06', '24,000 BTU Inverter Split AC (2.0 TR)', 'HVAC', ac24, 2200, 0.70, 7.0, 0.40);
  pushApp('A07', 'Storage Water Heaters (Bathrooms)', 'Water Heater', bathQty, 1500, 0.50, 1.5, 0.50);
  pushApp('A08', 'Smart TVs & Media Entertainment', 'Electronics', tvQty, 140, 0.70, 5.0, 0.70);
  pushApp('A09', 'Study Workstations, Wi-Fi & Chargers', 'Electronics', pcQty, 180, 0.65, 6.0, 0.65);
  pushApp('A10', 'Refrigerator / Mini-Bar (24h Cycling)', 'Appliances', fridgeQty, 220, 0.80, 24.0, 0.35);
  pushApp('A11', 'Kitchen Kettle / Microwave / Small Appl.', 'Appliances', Math.max(1, kitchenQty), 1800, 0.40, 0.8, 0.45);
  pushApp('A12', 'Washing Machine / Laundry', 'Appliances', washerQty, 1200, 0.40, 1.2, 0.50);
  if (kitchenQty > 0) pushApp('A13', 'Induction Hob / Oven (Kitchen)', 'Appliances', kitchenQty, 2500, 0.50, 1.2, 0.45);
  if (hasPump) pushApp('A14', 'Water Pressure Booster Pump', 'Common', 1, 750, 0.80, 2.0, 0.65);
  if (hasLift) pushApp('A15', 'Passenger Lift (Traction Motor)', 'Common', 1, 4500, 0.50, 3.0, 0.45);

  const supplySystem = isThreePhase ? '3-Phase 400/230 V, 50 Hz (TN-S)' : '1-Phase 230 V, 50 Hz (TN-S)';
  const poles = isThreePhase ? '4P' : '2P';
  const ka = recommendedBreakerA >= 160 ? '25 kA' : recommendedBreakerA >= 100 ? '18 kA' : '10 kA';
  const mainBreakerSpec = `${recommendedBreakerA}A ${poles} MCCB (${ka}) + 100 mA Type-S RCCB`;
  const incomingCableSpec = feederCableSpec(recommendedBreakerA, isThreePhase);

  const sol = getSolarConfig(model);
  const arrayKwp = Number(((sol.panelCount * sol.panelWattage) / 1000).toFixed(2));
  // Maldives effective specific yield ~4.9 kWh/kWp/day (1,788 kWh/kWp/yr)
  const estDailyKWh = sol.enabled ? Number((arrayKwp * 4.9).toFixed(1)) : 0;
  const estAnnualKWh = Math.round(estDailyKWh * 365);
  const offsetPct = totalDailyKWh > 0 ? Math.round((estDailyKWh / totalDailyKWh) * 100) : 0;
  const recommendedInverterKW = Math.max(5, Math.ceil(Math.min(totalDemandKW, Math.max(arrayKwp, 6)) / 2) * 2);
  const recommendedBatteryKWh = Math.max(10, Math.ceil((totalDailyKWh * 0.45) / 5) * 5);

  const measuredCount = levels.filter((l) => l.levelId !== 'common_mep' && l.source === 'Measured').length;
  const floorCount = activeLevels.length;
  const exclSuffix = decorativeCount > 0 ? ` Excludes ${decorativeCount} decorative/context floor(s) outside project scope.` : '';
  const methodologyNote =
    (measuredCount === floorCount
      ? 'Loads computed directly from placed electrical & HVAC fixtures across all in-scope floors, diversified to IEC 60364 / BS 7671.'
      : measuredCount > 0
        ? `Hybrid calculation: ${measuredCount}/${floorCount} floor(s) from placed MEP fixtures; remaining floors estimated from room areas to MNBC / IEC 60364 tropical allowances.`
        : 'Room-area load assessment to MNBC / IEC 60364 Maldives tropical allowances (inverter split ACs, LED lighting, 13A sockets, storage water heaters).') + exclSuffix;

  // Touch drainage config to keep import cleanly used if needed in future
  void getRoofDrainageConfig;

  return {
    levels,
    categories,
    appliances,
    totalAreaM2,
    totalConnectedKW,
    totalDemandKW,
    overallDiversity,
    powerFactor,
    totalApparentKVA,
    supplySystem,
    isThreePhase,
    nominalVoltageV,
    designCurrentA,
    recommendedBreakerA,
    mainBreakerSpec,
    incomingCableSpec,
    earthingSpec: 'Copper earth rod (16 mm × 2.4 m), Ra ≤ 10 Ω, 16 mm² Cu earth lead',
    spdSpec: isThreePhase ? 'Type 1+2 SPD (4P, 40 kA, Up ≤ 1.5 kV)' : 'Type 1+2 SPD (2P, 40 kA, Up ≤ 1.5 kV)',
    totalDailyKWh,
    estMonthlyKWh,
    solar: {
      enabled: sol.enabled,
      panelCount: sol.panelCount,
      panelWattage: sol.panelWattage,
      arrayKwp,
      inverterKW: sol.inverterKW,
      batteryKWh: sol.batteryKWh,
      estDailyKWh,
      estAnnualKWh,
      offsetPct,
      recommendedInverterKW,
      recommendedBatteryKWh,
    },
    methodologyNote,
  };
}
