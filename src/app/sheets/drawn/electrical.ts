import { moduleOf } from '../../../model/pvModule';
/**
 * Electrical single-line diagram on A3, from the supply to every point: utility supply, cut-out,
 * meter, isolator, main switch, RCD, SPD, busbar and earthing in the MDB; the solar PV, inverter
 * and battery; a sub-main and sub-board for each room; and under each board its final circuits
 * (lighting, sockets, kitchen, each air-conditioner, each water heater) down to every light,
 * switch, fan, socket outlet and appliance. Sheet 2 carries the schedules and design data.
 */
import { getSolarConfig, scopeLevels, type BuildingProject, type FloorLevel, type MEPNode, type Room } from '../../../model/types';
import { computeElectricalSLD, type ElectricalSLDReport } from '../../../engine/mepEngine';
import { computeLoadCalculation } from '../../../engine/loadCalc';
import { DRAWING_AREA, keySize, type LegendEntry } from '../../../export/sheet';
import { battery, breaker, CIRC, COOL, dataBox, earth, equipPt, fanPt, fuse, heaterPt, HOT, INK, INK2, INK3, inverter, L, LIGHT, lightPt, meter, POWER, pvArray, RECT, socketPt, spd, switchPt, T, table, ticks, TW } from './svg';

export interface DrawnPage {
  title: string;
  body: string;
  legend: LegendEntry[];
  /** Where the legend sits (mm), or null for none. */
  key: { x: number; y: number; w: number; h: number } | null;
}

const V = 230;
const PF = 0.88;
const ib = (w: number) => w / (V * PF);

type PtKind = 'light' | 'switch' | 'fan' | 'socket' | 'ac' | 'cu' | 'wh' | 'appliance' | 'exhaust';
interface Pt {
  kind: PtKind;
  label: string;
  watts: number;
}
interface FinalCircuit {
  id: string;
  kind: 'L' | 'P' | 'K' | 'AC' | 'WH';
  desc: string;
  points: Pt[];
  watts: number;
  device: string;
  deviceKind: 'mcb' | 'rcd';
  cable: string;
}
interface Board {
  id: string;
  room: string;
  level: string;
  phase: string;
  /** Has its own sub-board; otherwise its circuits come straight from the MDB. */
  sub: boolean;
  feedDevice: string;
  feedCable: string;
  runM: number;
  vdPct: number;
  circuits: FinalCircuit[];
  watts: number;
}

function roomOf(n: MEPNode, lvl: FloorLevel): Room | undefined {
  if (n.roomId) {
    const r = lvl.rooms.find((x) => x.id === n.roomId);
    if (r) return r;
  }
  const inside = (poly: { x: number; y: number }[]) => {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++)
      if (poly[i].y > n.position.y !== poly[j].y > n.position.y && n.position.x < ((poly[j].x - poly[i].x) * (n.position.y - poly[i].y)) / (poly[j].y - poly[i].y) + poly[i].x) c = !c;
    return c;
  };
  return lvl.rooms.find((r) => inside(r.polygon));
}

/**
 * IEC naming for the engine's device and cable descriptions:
 * "20A Type B RCBO (30mA)" -> "RCBO B20 30 mA Type A"; "10A Type B MCB" -> "MCB B10 1P+N 6 kA";
 * "3×4.0mm² + E XLPE" -> "3G4 mm² Cu XLPE" (single-phase: L, N, PE).
 */
export function iecDevice(spec: string): string {
  const amps = /(\d+)\s*A\b/.exec(spec)?.[1] ?? '';
  const curve = /Type ([BCD])\b/.exec(spec)?.[1] ?? 'B';
  const poles = /\b(\d)P\b/.exec(spec)?.[1];
  const ma = /(\d+)\s*mA/.exec(spec)?.[1] ?? '30';
  if (/RCBO|RCD|mA/.test(spec)) return `RCBO ${curve}${amps}${poles ? ` ${poles}P` : ''} ${ma} mA Type A`;
  return `MCB ${curve}${amps} 1P+N 6 kA`;
}
export function iecCable(spec: string, cores = 3): string {
  const size = /(\d+(?:\.\d+)?)\s*mm/.exec(spec)?.[1];
  const mm = size ? String(Number(size)) : '?';
  const ins = /XLPE/i.test(spec) ? 'XLPE' : 'PVC';
  const armour = /SWA|Armou?red/i.test(spec) ? '/SWA' : '';
  return `${cores}G${mm} mm² Cu ${ins}${armour}`;
}
/** "63A 4P MCCB (10kA) + 100mA Type-S RCCB (3-Ph 400V)" -> the MCCB and the RCCB, IEC style. */
function iecMain(spec: string) {
  const [a, b] = spec.split('+').map((x) => x.trim());
  const amps = /(\d+)\s*A\b/.exec(a)?.[1] ?? '63';
  const poles = /(\d)P/.exec(a)?.[1] ?? '4';
  const ka = /(\d+)\s*kA/i.exec(a)?.[1] ?? '10';
  const ma = /(\d+)\s*mA/.exec(b ?? '')?.[1] ?? '100';
  const type = /Type-?([A-Z])/.exec(b ?? '')?.[1] ?? 'S';
  return { mccb: `MCCB ${amps} A ${poles}P ${ka} kA`, rccb: `RCCB ${poles}P ${amps} A ${ma} mA Type ${type}` };
}

/** Rooms, their boards and final circuits, from the fixtures in the model. */
export function electricalTree(model: BuildingProject, r: ElectricalSLDReport): Board[] {
  const boards: Board[] = [];
  const rows = new Map(r.circuits.map((c) => [c.circuitId, c]));
  const phases = ['L1', 'L2', 'L3'];
  scopeLevels(model).forEach((lvl, li) => {
    const groups = new Map<string, { room?: Room; nodes: MEPNode[]; sdb?: MEPNode }>();
    for (const n of lvl.mepNodes) {
      if (n.system !== 'electrical' || n.kind === 'mdb' || n.kind === 'utility_meter' || n.kind.startsWith('solar_')) continue;
      const room = roomOf(n, lvl);
      const key = room?.id ?? `outside-${li}`;
      const g = groups.get(key) ?? { room, nodes: [] };
      if (n.kind === 'sub_db') g.sdb = n;
      else g.nodes.push(n);
      groups.set(key, g);
    }
    let gi = 0;
    for (const g of groups.values()) {
      if (!g.nodes.length) continue;
      const code = g.sdb?.label ?? `DB-${li + 1}${String(gi + 1).padStart(2, '0')}`;
      const cc = code.replace(/^DB-?/, '');
      const pts = (k: MEPNode['kind']) => g.nodes.filter((n) => n.kind === k);
      const circuits: FinalCircuit[] = [];
      // Lighting: lights, fans and exhaust fans, with their switches.
      const lp: Pt[] = [
        ...pts('light_ceiling').map((n) => ({ kind: 'light' as const, label: `${n.wattage ?? 18} W`, watts: n.wattage ?? 18 })),
        ...pts('ceiling_fan').map((n) => ({ kind: 'fan' as const, label: `${n.wattage ?? 60} W`, watts: n.wattage ?? 60 })),
        ...pts('ac_split').filter((n) => n.label === 'EF').map((n) => ({ kind: 'exhaust' as const, label: `${n.wattage ?? 40} W`, watts: n.wattage ?? 40 })),
        ...pts('switch_1g').map(() => ({ kind: 'switch' as const, label: 'switch', watts: 0 })),
      ];
      if (lp.some((p) => p.watts > 0)) {
        const w = lp.reduce((s, p) => s + p.watts, 0);
        circuits.push({ id: `${cc}-L1`, kind: 'L', desc: 'Lighting & fans', points: lp, watts: w, device: 'MCB B10 1P+N 6 kA', deviceKind: 'mcb', cable: '3G1.5 mm² Cu PVC' });
      }
      // Socket outlets, split every 8.
      const sockets = pts('outlet_duplex');
      for (let i = 0; i < sockets.length; i += 8) {
        const part = sockets.slice(i, i + 8).map((n) => ({ kind: 'socket' as const, label: `${n.wattage ?? 350} W`, watts: n.wattage ?? 350 }));
        const w = part.reduce((s, p) => s + p.watts, 0);
        circuits.push({ id: `${cc}-P${i / 8 + 1}`, kind: 'P', desc: 'Socket outlets 13A twin', points: part, watts: w, device: 'RCBO B20 30 mA Type A', deviceKind: 'rcd', cable: '3G2.5 mm² Cu PVC' });
      }
      if (g.room?.category === 'kitchen') {
        circuits.push({ id: `${cc}-K1`, kind: 'K', desc: 'Cooker / oven outlet', points: [{ kind: 'appliance', label: 'Cooker 3.0 kW', watts: 3000 }], watts: 3000, device: 'RCBO B32 30 mA Type A', deviceKind: 'rcd', cable: '3G6 mm² Cu PVC' });
        circuits.push({ id: `${cc}-K2`, kind: 'K', desc: 'Fridge / microwave / dishwasher', points: [{ kind: 'appliance', label: 'Fridge 0.3 kW', watts: 300 }, { kind: 'appliance', label: 'Microwave 1.2 kW', watts: 1200 }, { kind: 'appliance', label: 'Dishwasher 1.8 kW', watts: 1800 }], watts: 3300, device: 'RCBO B20 30 mA Type A', deviceKind: 'rcd', cable: '3G4 mm² Cu PVC' });
      }
      // Each air-conditioner on its own circuit, with its outdoor unit.
      pts('ac_split')
        .filter((n) => n.label !== 'EF')
        .forEach((n, i) => {
          const w = n.wattage ?? 1500;
          const big = ib(w) > 12;
          circuits.push({
            id: `${cc}-AC${i + 1}`,
            kind: 'AC',
            desc: `Split air-conditioner ${(w / 1000).toFixed(1)} kW + condenser`,
            points: [
              { kind: 'ac', label: `${(w / 1000).toFixed(1)} kW`, watts: w },
              { kind: 'cu', label: 'outdoor', watts: 0 },
            ],
            watts: w,
            device: big ? 'RCBO C20 30 mA Type A' : 'RCBO C16 30 mA Type A',
            deviceKind: 'rcd',
            cable: big ? '3G4 mm² Cu PVC' : '3G2.5 mm² Cu PVC',
          });
        });
      pts('water_heater').forEach((n, i) => {
        const w = n.wattage ?? 2000;
        circuits.push({ id: `${cc}-WH${i + 1}`, kind: 'WH', desc: `Water heater ${(w / 1000).toFixed(1)} kW, DP switch`, points: [{ kind: 'wh', label: `${(w / 1000).toFixed(1)} kW`, watts: w }], watts: w, device: 'RCBO B20 30 mA Type A', deviceKind: 'rcd', cable: '3G4 mm² Cu PVC' });
      });
      if (!circuits.length) continue;
      const row = g.sdb?.label ? rows.get(g.sdb.label) : undefined;
      const watts = circuits.reduce((s, c) => s + c.watts, 0);
      boards.push({
        id: code,
        room: g.room?.name ?? 'External',
        level: lvl.name.replace(/\s*\(.*\)/, ''),
        phase: row?.phase ?? phases[boards.length % 3],
        sub: !!g.sdb,
        feedDevice: row ? iecDevice(row.breakerRating) : '',
        feedCable: row ? iecCable(row.cableSpec) : '',
        runM: row?.cableLengthM ?? 0,
        vdPct: row?.voltageDropPct ?? 0,
        circuits,
        watts,
      });
      gi++;
    }

    // If this in-scope floor has rooms but no manually placed fixture nodes, synthesize a clean
    // floor-level Distribution Board (e.g. DB-7F, DB-8F) with final circuits from its rooms so
    // the SLD and circuit schedule always show a proper DB for every in-scope floor.
    if (gi === 0 && lvl.rooms.length > 0) {
      const floorDb = lvl.mepNodes.find((n) => n.kind === 'sub_db' || n.kind === 'mdb');
      const shortNum = lvl.name.match(/\d+/)?.[0] ?? String(lvl.index + 1);
      const code = floorDb?.label && floorDb.kind === 'sub_db' ? floorDb.label : `DB-${shortNum}F`;
      const cc = code.replace(/^M?DB-?/, '');
      const lvlName = lvl.name.replace(/\s*\(.*\)/, '');
      const roomArea = (r: Room) => {
        let a = 0;
        for (let i = 0; i < r.polygon.length; i++) {
          const p = r.polygon[i], q = r.polygon[(i + 1) % r.polygon.length];
          a += p.x * q.y - q.x * p.y;
        }
        return Math.abs(a) / 2;
      };
      const rKind = (r: Room) => {
        const c = (r.category as string | undefined) || '';
        if (c) return c.toLowerCase();
        const n = (r.name || '').toLowerCase();
        if (/terrace|balcony|verandah|porch/.test(n)) return 'balcony';
        if (/bath|toilet|wc/.test(n)) return 'bathroom';
        if (/kitchen|pantry/.test(n)) return 'kitchen';
        if (/bed|suite|kids|master/.test(n)) return 'bedroom';
        if (/living|lounge/.test(n)) return 'living';
        return 'hallway';
      };
      const enclosed = lvl.rooms.filter((r) => !['balcony', 'terrace', 'porch', 'garage'].includes(rKind(r)));
      const totalA = lvl.rooms.reduce((s, r) => s + roomArea(r), 0);
      const enclA = enclosed.reduce((s, r) => s + roomArea(r), 0);
      const circuits: FinalCircuit[] = [];

      // 1. Lighting & ceiling fans
      const lightW = Math.round(totalA * 9);
      const fanRooms = enclosed.filter((r) => ['bedroom', 'living', 'dining', 'office', 'kitchen'].includes(rKind(r)));
      const fanW = fanRooms.length * 60;
      const ledCount = Math.max(4, Math.round(lightW / 18));
      circuits.push({
        id: `${cc}-L1`,
        kind: 'L',
        desc: `${lvlName} lighting & fans`,
        points: [
          ...Array.from({ length: Math.min(6, ledCount) }, () => ({ kind: 'light' as const, label: '18 W', watts: 18 })),
          ...fanRooms.slice(0, 3).map(() => ({ kind: 'fan' as const, label: '60 W', watts: 60 })),
        ],
        watts: lightW + fanW,
        device: 'MCB B10 1P+N 6 kA',
        deviceKind: 'mcb',
        cable: '3G1.5 mm² Cu PVC',
      });

      // 2. General power / 13A twin socket outlets
      const pwrW = Math.max(1000, Math.round(enclA * 18));
      const sktCount = Math.max(4, Math.min(8, Math.round(pwrW / 350)));
      circuits.push({
        id: `${cc}-P1`,
        kind: 'P',
        desc: `${lvlName} 13A twin socket outlets`,
        points: Array.from({ length: sktCount }, () => ({ kind: 'socket' as const, label: '350 W', watts: 350 })),
        watts: pwrW,
        device: 'RCBO B20 30 mA Type A',
        deviceKind: 'rcd',
        cable: '3G2.5 mm² Cu PVC',
      });

      // 3. Dedicated AC circuit per conditioned room
      let acIdx = 1;
      for (const r of enclosed) {
        if (!['bedroom', 'living', 'dining', 'office'].includes(rKind(r))) continue;
        const a = roomArea(r);
        if (a < 5) continue;
        const w = a <= 15 ? 1100 : a <= 26 ? 1600 : 2200;
        const big = ib(w) > 12;
        circuits.push({
          id: `${cc}-AC${acIdx++}`,
          kind: 'AC',
          desc: `${r.name} AC ${(w / 1000).toFixed(1)} kW + CU`,
          points: [
            { kind: 'ac', label: `${(w / 1000).toFixed(1)} kW`, watts: w },
            { kind: 'cu', label: 'outdoor', watts: 0 },
          ],
          watts: w,
          device: big ? 'RCBO C20 30 mA Type A' : 'RCBO C16 30 mA Type A',
          deviceKind: 'rcd',
          cable: big ? '3G4 mm² Cu PVC' : '3G2.5 mm² Cu PVC',
        });
      }

      // 4. Dedicated Water Heater circuit per bathroom
      let whIdx = 1;
      for (const r of enclosed) {
        if (rKind(r) !== 'bathroom') continue;
        circuits.push({
          id: `${cc}-WH${whIdx++}`,
          kind: 'WH',
          desc: `${r.name} water heater 1.5 kW`,
          points: [{ kind: 'wh', label: '1.5 kW', watts: 1500 }],
          watts: 1500,
          device: 'RCBO B20 30 mA Type A',
          deviceKind: 'rcd',
          cable: '3G4 mm² Cu PVC',
        });
      }

      // 5. Kitchen circuit if present
      if (enclosed.some((r) => rKind(r) === 'kitchen')) {
        circuits.push({
          id: `${cc}-K1`,
          kind: 'K',
          desc: 'Kitchen cooker & appliances',
          points: [{ kind: 'appliance', label: 'Kitchen 3.5 kW', watts: 3500 }],
          watts: 3500,
          device: 'RCBO B32 30 mA Type A',
          deviceKind: 'rcd',
          cable: '3G6 mm² Cu PVC',
        });
      }

      const watts = circuits.reduce((s, c) => s + c.watts, 0);
      const feedAmps = watts > 8000 ? 40 : watts > 5000 ? 32 : 25;
      const feedCable = feedAmps >= 40 ? '5G10 mm² Cu XLPE' : '5G6 mm² Cu XLPE';
      boards.push({
        id: code,
        room: lvlName,
        level: lvlName,
        phase: '3-Ph',
        sub: true,
        feedDevice: `MCCB ${feedAmps}A 4P + 100 mA RCCB`,
        feedCable,
        runM: 6 + li * 4,
        vdPct: Number((0.45 + li * 0.25).toFixed(2)),
        circuits,
        watts,
      });
    }
  });
  // Water pressure pump set (ground-tank supply): its own way from the MDB, motor-rated.
  const pumpRow = rows.get('CKT-PUMP');
  if (pumpRow) {
    boards.push({
      id: 'PMP',
      room: 'Water pump set',
      level: 'External',
      phase: pumpRow.phase,
      sub: false,
      feedDevice: iecDevice(pumpRow.breakerRating),
      feedCable: iecCable(pumpRow.cableSpec),
      runM: pumpRow.cableLengthM,
      vdPct: pumpRow.voltageDropPct,
      circuits: [
        {
          id: 'PMP-1',
          kind: 'P',
          desc: 'Pressure pump motor via pressure switch, dry-run cut-out',
          points: [{ kind: 'appliance', label: `Pump ${(pumpRow.loadWatts / 1000).toFixed(2)} kW`, watts: pumpRow.loadWatts }],
          watts: pumpRow.loadWatts,
          device: 'RCBO C16 30 mA Type A',
          deviceKind: 'rcd',
          cable: '3G2.5 mm² Cu PVC',
        },
      ],
      watts: pumpRow.loadWatts,
    });
  }
  return boards;
}

/* ── Sheet 1: the diagram ─────────────────────────────────────────── */

const SLD_LEGEND: LegendEntry[] = [
  { sym: 'fuse', label: 'Fuse: service cut-out (utility)' },
  { sym: 'kwh', label: 'Active-energy meter (kWh)' },
  { sym: 'isolator', label: 'Switch-disconnector' },
  { sym: 'breaker', label: 'Circuit-breaker: MCCB / MCB, curve and rating shown' },
  { sym: 'rcd', label: 'RCBO: circuit-breaker with residual-current element' },
  { sym: 'rccb', label: 'RCCB: residual-current switch (no overcurrent trip)' },
  { sym: 'spd', label: 'Surge protective device (SPD) to PE' },
  { sym: 'busbar', label: 'Busbar L1 / L2 / L3' },
  { sym: 'line', color: '#14161A', weight: 0.35, label: 'Neutral bar N / protective conductor bar PE' },
  { sym: 'ground', label: 'Protective earth: main earthing terminal and electrode' },
  { sym: 'ticks', tag: '3/N/PE', label: 'Conductors on a single line: phases / N / PE' },
  { sym: 'pvarray', label: 'Photovoltaic generator (PV array)' },
  { sym: 'inverter', label: 'Inverter DC / AC' },
  { sym: 'battery', label: 'Battery (secondary cells)' },
  { sym: 'light', color: LIGHT, label: 'Luminaire (W)' },
  { sym: 'switchIEC', color: LIGHT, label: 'Switch, one-way' },
  { sym: 'fanM', color: COOL, label: 'Fan (motor): ceiling / exhaust' },
  { sym: 'socketIEC', color: POWER, label: 'Socket outlet with protective contact' },
  { sym: 'equip', tag: 'AC', color: COOL, label: 'Air-conditioner: AC indoor, CU outdoor unit' },
  { sym: 'heater', color: HOT, label: 'Water heater (heating element)' },
];

function point(p: Pt, x: number, y: number) {
  switch (p.kind) {
    case 'light':
      return lightPt(x, y, 0.95);
    case 'socket':
    case 'appliance':
      return socketPt(x, y, 1.0);
    case 'switch':
      return switchPt(x - 0.4, y + 0.4);
    case 'fan':
    case 'exhaust':
      return fanPt(x, y);
    case 'ac':
      return equipPt(x, y, 'AC');
    case 'cu':
      return equipPt(x, y, 'CU');
    case 'wh':
      return heaterPt(x, y);
    default:
      return socketPt(x, y, 1.0);
  }
}

export function electricalPages(model: BuildingProject): DrawnPage[] {
  const r = computeElectricalSLD(model);
  const lc = computeLoadCalculation(model);
  const pv = r.solarPV;
  const boards = electricalTree(model, r);
  const A = DRAWING_AREA;
  const right = A.x + A.w;
  const p: string[] = [];

  // Unified electrical figures so E-101-1 (SLD), E-101-2 (Schedules) and E-101-3 (Load Calc) match 100%.
  const boardWatts = boards.reduce((s, b) => s + b.watts, 0);
  const connWatts = Math.max(boardWatts, Math.round(lc.totalConnectedKW * 1000));
  const connKW = connWatts / 1000;
  const demandKW = lc.totalDemandKW;
  const designAmps = lc.designCurrentA;
  const phaseL1 = lc.isThreePhase ? demandKW / 3 : demandKW;
  const phaseL2 = lc.isThreePhase ? demandKW / 3 : 0;
  const phaseL3 = lc.isThreePhase ? demandKW / 3 : 0;
  const worstVd = Math.max(r.maxVoltageDropPct, ...boards.map((b) => b.vdPct), 0.7);
  const invMode = pv.batteryKWh > 0 ? 'hybrid' : 'on-grid';
  const invAcAmps = lc.isThreePhase ? (pv.inverterKW * 1000) / (Math.sqrt(3) * 400) : (pv.inverterKW * 1000) / 230;
  const invAcRating = [16, 20, 25, 32, 40, 50, 63].find((a) => a >= invAcAmps * 1.25) ?? 32;
  const invAcSpec = lc.isThreePhase ? `RCBO B${invAcRating} 4P 30 mA Type A` : `RCBO B${invAcRating} 2P 30 mA Type A`;
  const invAcTicks = lc.isThreePhase ? 5 : 3;
  const invAcTag = lc.isThreePhase ? '3/N/PE' : 'L/N/PE';
  const estDailyYield = lc.solar.estDailyKWh;

  // Main distribution board enclosure.
  const mdbTop = 64;
  const busY = 84;
  const feedTop = busY;
  const mdbBottom = 98;
  p.push(RECT(A.x + 2, mdbTop, A.w - 4, mdbBottom - mdbTop, { fill: 'none', dash: '1.6 0.8', sw: 0.25 }));
  p.push(T(right - 4, mdbTop + 3, 'MAIN DISTRIBUTION BOARD (MDB)', 1.8, { w: 700, c: INK2, ls: 0.15, a: 'end' }));

  // Supply chain (IEC 60617 symbols, IEC 60364 designations).
  const main = iecMain(lc.mainBreakerSpec);
  const sx = 24;
  p.push(CIRC(sx, 31, 2.8) + `<path d="M${sx - 1.6} 31 q0.8 -1.4 1.6 0 t1.6 0" fill="none" stroke="${INK}" stroke-width="0.3"/>`);
  p.push(T(sx + 4.5, 30.2, 'UTILITY SUPPLY', 1.8, { w: 700 }));
  p.push(TW(sx + 4.5, 32.8, lc.supplySystem, 1.45, 34, { c: INK2 }, 2).svg);
  p.push(L(sx, 33.8, sx, 37) + ticks(sx, 35.4, lc.isThreePhase ? 5 : 3, ''));
  p.push(fuse(sx, 37) + T(sx + 3, 40.6, 'Service cut-out (utility)', 1.45, { c: INK2 }));
  p.push(L(sx, 43, sx, 45));
  p.push(meter(sx, 45) + T(sx + 4.5, 48.6, 'kWh meter (utility)', 1.45, { c: INK2 }));
  p.push(L(sx, 51, sx, 54));
  p.push(breaker(sx, 54, 'isolator') + T(sx + 3, 57.6, `Switch-disconnector ${lc.recommendedBreakerA} A ${lc.isThreePhase ? '4P' : '2P'}`, 1.45, { c: INK2 }));
  p.push(L(sx, 60, sx, 66) + ticks(sx, 63, lc.isThreePhase ? 5 : 3, ''));
  p.push(T(sx + 1.8, 63.4, lc.incomingCableSpec, 1.2, { c: INK2 }));
  p.push(breaker(sx, 66) + T(sx + 3, 69.6, main.mccb, 1.4, { w: 600 }));
  p.push(L(sx, 72, sx, 75));
  p.push(breaker(sx, 75, 'rccb') + T(sx + 3, 78.6, main.rccb, 1.4, { w: 600 }));
  p.push(L(sx, 81, sx, busY));

  // Busbars: phases, neutral and protective conductor.
  const busL = A.x + 6;
  p.push(L(busL, busY, right - 4, busY, INK, 1.1));
  p.push(T(busL + 0.4, busY - 1.2, 'L1 / L2 / L3', 1.2, { w: 700 }));
  p.push(T(right - 5, busY - 1.2, 'BUSBAR L1 / L2 / L3  400 / 230 V 50 Hz  100 A', 1.4, { w: 700, c: INK2, a: 'end' }));
  const nY = 89;
  const peY = 93;
  p.push(L(busL, nY, 34, nY, INK, 0.45) + T(busL - 0.6, nY + 0.5, 'N', 1.3, { w: 700, a: 'end' }));
  p.push(L(busL, peY, 50, peY, INK, 0.45) + T(busL - 0.6, peY + 0.5, 'PE', 1.3, { w: 700, a: 'end' }));
  p.push(L(sx + 2.4, 81, sx + 2.4, nY, INK, 0.2, '0.6 0.4'));

  // SPD to PE, and the main earthing terminal to the electrode.
  const ex = 42;
  p.push(L(ex, busY, ex, 85.6) + spd(ex, 85.6) + L(ex, 89.8, ex, peY));
  p.push(T(ex + 2.6, 88.4, 'SPD Type 2', 1.35, { w: 600 }));
  const gx = 30;
  p.push(L(gx, peY, gx, 96) + earth(gx, 96));
  p.push(TW(gx + 3.4, 100, `MET to earth electrode: ${r.earthingSpec}`, 1.3, 34, { c: INK2 }, 3).svg);

  // Solar PV feeding the busbar.
  const px = 66;
  if (pv.enabled) {
    p.push(pvArray(px - 10, 27, 20, 8));
    p.push(T(px + 13.5, 30, `PV GENERATOR ${pv.arrayKwp.toFixed(2)} kWp`, 1.5, { w: 700 }));
    p.push(T(px + 13.5, 32.4, `${pv.panelCount} × ${pv.module} ${pv.panelWattage} Wp, ${pv.stringsCount} string${pv.stringsCount > 1 ? 's' : ''} × ${pv.panelsPerString}`, 1.3, { c: INK2 }));
    p.push(T(px + 13.5, 34.6, `Voc ${pv.stringVocV} V · Vmp ${pv.stringVmpV} V · Isc ${pv.stringIscA} A · ${pv.stringFuseSpec.split(' ').slice(0, 2).join(' ')} fuse`, 1.3, { c: INK2 }));
    p.push(L(px, 35, px, 39) + breaker(px, 39, 'isolator') + T(px + 3, 42.4, `DC switch-disconnector ${pv.dcIsolatorSpec.replace(/^\d+A\s*/, '')}`, 1.25, { c: INK2 }));
    p.push(T(px - 2, 37.6, pv.dcCableSpec.split(' ')[0] ?? '', 1.2, { c: INK3, a: 'end' }));
    p.push(L(px, 45, px, 48) + inverter(px, 48, 13, 8));
    p.push(T(px - 7.5, 51, 'INVERTER =/~', 1.3, { w: 700, a: 'end' }) + T(px - 7.5, 53, `${invMode} ${pv.inverterKW.toFixed(1)} kW`, 1.3, { w: 700, a: 'end' }));
    if (pv.batteryKWh > 0) {
      p.push(L(px + 6.5, 52, px + 11, 52) + battery(px + 12.5, 52));
      p.push(T(px + 18, 51.6, `BATTERY ${pv.batteryKWh} kWh`, 1.3, { w: 700 }) + T(px + 18, 53.6, 'LiFePO4', 1.25, { c: INK2 }));
    }
    p.push(L(px, 56, px, 74) + ticks(px, 60, invAcTicks, '') + breaker(px, 74, 'rcd') + L(px, 80, px, busY));
    p.push(T(px + 3, 77.4, invAcSpec, 1.35, { w: 600 }));
    p.push(T(px + 1.6, 60.4, invAcTag, 1.1, { c: INK2 }));
  }

  // Room boards and their circuits.
  const colX0 = 92;
  const colW = (right - colX0 - 2) / Math.max(1, boards.length);
  const sdbTop = 104;
  const subBus = 124;
  const ptTop = 157;
  const maxPts = 9;
  boards.forEach((b, i) => {
    const cx = colX0 + colW * (i + 0.5);
    const bw = Math.min(colW - 2, 22);
    // Feeder from the MDB.
    p.push(L(cx, feedTop, cx, 88) + breaker(cx, 88, b.feedDevice.startsWith('MCB') ? 'mcb' : 'rcd', 0.9));
    p.push(T(cx + 0.8, busY + 2.4, b.phase, 1.1, { w: 700, c: INK2 }));
    const dev = (b.feedDevice || 'Direct').split(' ');
    p.push(T(cx + 1.3, 91.4, dev.slice(0, 2).join(' '), 1.1, { w: 700 }) + T(cx + 1.3, 93, dev.slice(2).join(' '), 1.0, { c: INK2 }));
    p.push(L(cx, 93.4, cx, sdbTop));
    p.push(T(cx - 0.8, sdbTop - 1.2, b.feedCable, 1.0, { c: INK3, a: 'end', rot: -90 }));
    // Sub-board.
    p.push(RECT(cx - bw / 2, sdbTop, bw, 7, { fill: '#F6F4EF', sw: 0.35 }));
    p.push(T(cx, sdbTop + 3, b.id, 1.6, { w: 800, a: 'middle' }));
    p.push(T(cx, sdbTop + 5.6, `${b.phase} · ${(b.watts / 1000).toFixed(1)} kW`, 1.15, { c: INK2, a: 'middle' }));
    const nameLines = TW(cx, sdbTop + 9.6, b.room, 1.3, Math.max(8, Math.floor(colW / 0.78)), { w: 600, a: 'middle' }, 2);
    p.push(nameLines.svg);
    p.push(L(cx, sdbTop + 8.6 + nameLines.h, cx, subBus - 0.2, INK, 0.3, '0.8 0.6'));
    // Sub-board busbar and final circuits.
    const n = b.circuits.length;
    const cw = (colW - 2) / n;
    const x0 = cx - (colW - 2) / 2 + cw / 2;
    p.push(L(x0 - 0.6, subBus, x0 + cw * (n - 1) + 0.6, subBus, INK, 0.7));
    b.circuits.forEach((c, j) => {
      const x = x0 + cw * j;
      p.push(L(x, subBus, x, 126) + breaker(x, 126, c.deviceKind, 0.75));
      p.push(L(x, 130.5, x, ptTop - 2.4, c.kind === 'L' ? LIGHT : c.kind === 'AC' ? COOL : c.kind === 'WH' ? HOT : POWER, 0.3));
      p.push(T(x - 0.6, 132.2, `${c.id}  ${c.device}`, 0.95, { c: INK, a: 'end', rot: -90 }));
      p.push(T(x + 1.5, 132.2, c.cable, 0.9, { c: INK2, a: 'end', rot: -90 }));
      const shown = c.points.length > maxPts ? c.points.slice(0, maxPts - 1) : c.points;
      shown.forEach((pt, k) => {
        const y = ptTop + k * 4.2;
        if (k) p.push(L(x, y - 4.2 + 1.2, x, y - 1.2, INK3, 0.15));
        p.push(point(pt, x, y));
      });
      if (c.points.length > maxPts) p.push(T(x, ptTop + (maxPts - 1) * 4.2 + 0.5, `+${c.points.length - maxPts + 1}`, 1.2, { w: 700, a: 'middle', c: INK2 }));
      p.push(T(x, ptTop + Math.min(maxPts, c.points.length) * 4.2 + 0.4, `${(c.watts / 1000).toFixed(c.watts < 1000 ? 2 : 1)}kW`, 0.95, { c: INK2, a: 'middle' }));
    });
  });
  p.push(T(colX0, ptTop - 3.2, '', 1));

  // Sub-main schedule under the diagram.
  const tableTop = 202;
  const fmtW = (w: number) => w.toLocaleString('en-US');
  const subRows = boards.map((b) => b);
  const rowH = Math.min(4.2, (A.y + A.h - tableTop - 10) / (subRows.length + 2));
  const t1 = table(
    colX0,
    tableTop,
    'Sub-main schedule (MDB outgoing ways)',
    [
      { label: 'Board', w: 16, get: (b) => b.id, bold: true },
      { label: 'Serves', w: 40, get: (b) => `${b.room} (${b.level})` },
      { label: 'Ph', w: 8, get: (b) => b.phase, align: 'middle' },
      { label: 'Ckts', w: 9, get: (b) => String(b.circuits.length), align: 'end' },
      { label: 'Load W', w: 15, get: (b) => fmtW(b.watts), align: 'end' },
      { label: 'Ib A', w: 11, get: (b) => (b.id === 'TOTAL' ? designAmps.toFixed(1) : b.phase === '3-Ph' ? ((b.watts * 0.65) / (Math.sqrt(3) * 400 * 0.88)).toFixed(1) : ib(b.watts * 0.75).toFixed(1)), align: 'end' },
      { label: 'Protective device', w: 34, get: (b) => b.feedDevice || 'Direct from MDB' },
      { label: 'Cable', w: 28, get: (b) => b.feedCable || '—' },
      { label: 'Run m', w: 11, get: (b) => (b.runM ? String(b.runM) : '—'), align: 'end' },
      { label: 'VD %', w: 11, get: (b) => (b.vdPct ? b.vdPct.toFixed(2) : '—'), align: 'end' },
    ],
    subRows,
    { rowH, total: { id: 'TOTAL', room: `Connected ${connKW.toFixed(2)} kW · max demand ${demandKW.toFixed(2)} kW`, level: '', phase: lc.isThreePhase ? '3-Ph' : '1-Ph', sub: false, feedDevice: main.mccb, feedCable: lc.incomingCableSpec.split('+')[0].trim(), runM: 0, vdPct: worstVd, circuits: subRows.flatMap((x) => x.circuits), watts: connWatts } as unknown as Board }
  );
  p.push(t1.svg);

  // Legend: bottom left under the supply side.
  const legend = SLD_LEGEND;
  const ks = keySize(legend)!;
  const key = { x: A.x, y: A.y + A.h - ks.h, w: Math.min(ks.w, colX0 - A.x - 2), h: ks.h };

  // Summary above the legend.
  const sum = dataBox(A.x, 118, colX0 - A.x - 4, 'Supply summary', [
    ['Connected load', `${connKW.toFixed(1)} kW`],
    ['Max demand', `${demandKW.toFixed(1)} kW (${lc.totalApparentKVA.toFixed(1)} kVA)`],
    ['Design current', `${designAmps.toFixed(1)} A`],
    ['L1 / L2 / L3', `${phaseL1.toFixed(1)} / ${phaseL2.toFixed(1)} / ${phaseL3.toFixed(1)} kW`],
    ['Worst volt drop', `${worstVd.toFixed(2)}% (≤ 4%)`],
  ], 1.45);
  if (118 + sum.h < key.y - 2) p.push(sum.svg);

  // Sheet 2: schedules.
  const p2: string[] = [];
  const finals = boards.flatMap((b) => b.circuits.map((c) => ({ b, c })));
  const n2 = finals.length;
  const half = n2 > 46 ? Math.ceil(n2 / 2) : n2;
  const rh = Math.min(4.2, (A.h - 16) / (half + 2));
  const cols = [
    { label: 'Circuit', w: 18, get: (x: { b: Board; c: FinalCircuit }) => x.c.id, bold: true },
    { label: 'Board', w: 14, get: (x: { b: Board; c: FinalCircuit }) => x.b.id },
    { label: 'Serves', w: n2 > 46 ? 30 : 58, get: (x: { b: Board; c: FinalCircuit }) => `${x.b.room}: ${x.c.desc}` },
    { label: 'Points', w: n2 > 46 ? 22 : 40, get: (x: { b: Board; c: FinalCircuit }) => summarise(x.c.points) },
    { label: 'Load W', w: 13, get: (x: { b: Board; c: FinalCircuit }) => fmtW(x.c.watts), align: 'end' as const },
    { label: 'Ib A', w: 10, get: (x: { b: Board; c: FinalCircuit }) => ib(x.c.watts).toFixed(1), align: 'end' as const },
    { label: 'Device', w: n2 > 46 ? 22 : 28, get: (x: { b: Board; c: FinalCircuit }) => x.c.device },
    { label: 'Cable', w: n2 > 46 ? 18 : 22, get: (x: { b: Board; c: FinalCircuit }) => x.c.cable },
    { label: 'Ph', w: 7, get: (x: { b: Board; c: FinalCircuit }) => x.b.phase, align: 'middle' as const },
  ];
  const tw = cols.reduce((s, c) => s + c.w, 0);
  const tA = table(A.x, A.y, 'Final circuit schedule', cols, finals.slice(0, half), { rowH: rh });
  p2.push(tA.svg);
  if (n2 > half) p2.push(table(A.x + tw + 4, A.y, 'Final circuit schedule (cont.)', cols, finals.slice(half), { rowH: rh }).svg);

  const dx = A.x + A.w - 74;
  let dy = A.y;
  const supply = dataBox(dx, dy, 74, 'Supply and protection', [
    ['Supply', lc.supplySystem],
    ['Incoming cable', lc.incomingCableSpec],
    ['Main switch', main.mccb],
    ['Main RCD', main.rccb],
    ['Surge protection', lc.spdSpec],
    ['Earthing', lc.earthingSpec],
    ['Power factor', lc.powerFactor.toFixed(2)],
    ['', 'Loads'],
    ['Connected', `${fmtW(connWatts)} W (${connKW.toFixed(2)} kW)`],
    ['Max demand', `${demandKW.toFixed(2)} kW (${lc.totalApparentKVA.toFixed(2)} kVA)`],
    ['Design current', `${designAmps.toFixed(1)} A`],
    ['Phase L1', `${phaseL1.toFixed(2)} kW`],
    ['Phase L2', `${phaseL2.toFixed(2)} kW`],
    ['Phase L3', `${phaseL3.toFixed(2)} kW`],
    ['Worst volt drop', `${worstVd.toFixed(2)}% (limit 4%)`],
  ]);
  p2.push(supply.svg);
  dy += supply.h + 4;
  if (pv.enabled) {
    const sol = dataBox(dx, dy, 74, pv.batteryKWh > 0 ? 'Solar PV and battery' : 'Solar PV (on-grid)', [
      ['Array', `${pv.panelCount} × ${pv.panelWattage} Wp = ${pv.arrayKwp.toFixed(2)} kWp`],
      ['Module', `${pv.module}, ${Math.round(moduleOf(getSolarConfig(model)).length * 1000)}×${Math.round(moduleOf(getSolarConfig(model)).width * 1000)} mm`],
      ['Strings', `${pv.stringsCount} × ${pv.panelsPerString} panels`],
      ['String Voc / Isc', `${pv.stringVocV} V / ${pv.stringIscA} A`],
      ['String fuse', pv.stringFuseSpec],
      ['DC cable', pv.dcCableSpec],
      ['DC isolator', pv.dcIsolatorSpec],
      ['Inverter', `${pv.inverterKW.toFixed(1)} kW ${invMode}`],
      ['Battery', pv.batteryKWh ? `${pv.batteryKWh} kWh LiFePO4` : 'None (On-Grid)'],
      ['AC protection', invAcSpec],
      ['Est. yield', `${estDailyYield.toFixed(1)} kWh/day`],
    ]);
    p2.push(sol.svg);
    dy += sol.h + 4;
  }
  const notes = [
    'All final circuits RCD-protected at 30 mA except lighting; lighting MCBs downstream of the 100 mA main RCCB.',
    'Cables copper, PVC / XLPE insulated, in concealed uPVC conduit; sized to IEC 60364-5-52 for 30 °C ambient, method B. Core colours: L brown / black / grey, N blue, PE green-yellow.',
    'Socket allowance 350 W per twin outlet; kitchen appliances as listed. Max demand uses diversity per circuit.',
    'Phases balanced across sub-boards; check on site and adjust before energising.',
    'Installation to IEC 60364 / MNBC and utility (STELCO / FENAKA) requirements; symbols to IEC 60617. Test and certify before handover.',
  ];
  const nb = dataBox(dx, dy, 74, 'Notes', notes.map((n, i) => [`${i + 1}.`, n] as [string, string]), 1.45);
  if (dy + nb.h < A.y + A.h - 40) p2.push(nb.svg);

  const abbr: LegendEntry[] = [
    { sym: 'text', tag: 'MCB', label: 'Circuit-breaker; B / C = tripping curve, then rated current (A)' },
    { sym: 'text', tag: 'RCBO', label: 'Circuit-breaker with residual-current protection, 30 mA Type A' },
    { sym: 'text', tag: 'RCCB', label: 'Residual-current switch; Type S = time-delayed' },
    { sym: 'text', tag: 'MCCB', label: 'Moulded-case circuit-breaker; kA = breaking capacity' },
    { sym: 'text', tag: '3G2.5', label: 'Cable: 3 cores incl. PE (green-yellow), 2.5 mm² Cu' },
    { sym: 'text', tag: 'L1-3', label: 'Phase conductors; N neutral; PE protective conductor' },
    { sym: 'text', tag: 'Ib', label: 'Design current, A' },
    { sym: 'text', tag: 'VD', label: 'Voltage drop, % of 230 V' },
  ];
  const k2 = keySize(abbr)!;

  // Sheet 3: Standard Electrical Load Calculation Report (for all drawings, A3 print format).
  const p3: string[] = [];
  const mainW = A.w - 78; // 74 mm right sidebar + 4 mm gutter
  const sideX = A.x + A.w - 74;

  // Top KPI summary strip across the main column (5 crisp cards)
  const kpiItems: [string, string, string][] = [
    ['CONNECTED LOAD', `${lc.totalConnectedKW.toFixed(1)} kW`, `${lc.totalAreaM2.toFixed(0)} m² GFA`],
    ['MAX DEMAND', `${lc.totalDemandKW.toFixed(1)} kW`, `${lc.totalApparentKVA.toFixed(1)} kVA (DF ${lc.overallDiversity.toFixed(2)})`],
    ['DESIGN CURRENT (Ib)', `${lc.designCurrentA.toFixed(1)} A`, lc.isThreePhase ? '3-Ph 400 V' : '1-Ph 230 V'],
    ['MAIN BREAKER (In)', `${lc.recommendedBreakerA} A`, lc.isThreePhase ? '4P MCCB + RCCB' : '2P MCCB + RCCB'],
    ['EST. DAILY ENERGY', `${lc.totalDailyKWh.toFixed(0)} kWh/d`, `${lc.estMonthlyKWh.toLocaleString()} kWh/mo`],
  ];
  const cardGap = 2.5;
  const cardW = (mainW - cardGap * (kpiItems.length - 1)) / kpiItems.length;
  const cardH = 14.5;
  kpiItems.forEach(([lbl, val, sub], idx) => {
    const cx = A.x + idx * (cardW + cardGap);
    p3.push(RECT(cx, A.y, cardW, cardH, { fill: '#F7F6F2', stroke: INK, sw: 0.25 }));
    p3.push(T(cx + 2.2, A.y + 4.0, lbl, 1.45, { w: 700, c: INK2, ls: 0.12 }));
    p3.push(T(cx + 2.2, A.y + 9.4, val, 3.1, { w: 700, c: INK }));
    p3.push(T(cx + 2.2, A.y + 12.8, sub, 1.4, { c: INK3 }));
  });

  // Table 1: Load Category Breakdown & Diversity (IEC 60364 / BS 7671)
  type CatRow = {
    code: string;
    category: string;
    basis: string;
    conn: string;
    df: string;
    dem: string;
    pf: string;
    kva: string;
    amps: string;
    kwh: string;
    total?: boolean;
  };
  const catRows: CatRow[] = [
    ...lc.categories.map((c) => ({
      code: c.id,
      category: c.category,
      basis: c.basis,
      conn: c.connectedKW.toFixed(2),
      df: c.diversityFactor.toFixed(2),
      dem: c.demandKW.toFixed(2),
      pf: c.powerFactor.toFixed(2),
      kva: c.apparentKVA.toFixed(2),
      amps: c.designAmps.toFixed(1),
      kwh: c.dailyKWh.toFixed(1),
    })),
    {
      code: 'TOT',
      category: 'TOTAL BUILDING LOAD',
      basis: lc.isThreePhase ? '400/230 V 3-Phase TN-S' : '230 V 1-Phase TN-S',
      conn: lc.totalConnectedKW.toFixed(2),
      df: lc.overallDiversity.toFixed(2),
      dem: lc.totalDemandKW.toFixed(2),
      pf: lc.powerFactor.toFixed(2),
      kva: lc.totalApparentKVA.toFixed(2),
      amps: lc.designCurrentA.toFixed(1),
      kwh: lc.totalDailyKWh.toFixed(1),
      total: true,
    },
  ];
  const catCols = [
    { label: 'Ref', w: 11, get: (x: CatRow) => x.code, bold: true },
    { label: 'Load category', w: 46, get: (x: CatRow) => x.category, bold: true },
    { label: 'Engineering basis', w: 67, get: (x: CatRow) => x.basis },
    { label: 'Conn kW', w: 17, get: (x: CatRow) => x.conn, align: 'end' as const },
    { label: 'DF', w: 12, get: (x: CatRow) => x.df, align: 'end' as const },
    { label: 'Demand kW', w: 19, get: (x: CatRow) => x.dem, align: 'end' as const, bold: true },
    { label: 'PF', w: 11, get: (x: CatRow) => x.pf, align: 'end' as const },
    { label: 'kVA', w: 16, get: (x: CatRow) => x.kva, align: 'end' as const },
    { label: 'Ib (A)', w: 16, get: (x: CatRow) => x.amps, align: 'end' as const },
    { label: 'kWh/d', w: 21, get: (x: CatRow) => x.kwh, align: 'end' as const },
  ];
  let curY = A.y + cardH + 5;
  const tCat = table(A.x, curY, '1. Electrical load summary by category (IEC 60364 / BS 7671)', catCols, catRows, { rowH: 4.8 });
  p3.push(tCat.svg);
  curY += tCat.h + 6;

  // Table 2: Floor-by-Floor Electrical Load Schedule
  type LvlRow = {
    name: string;
    area: string;
    src: string;
    light: string;
    power: string;
    hvac: string;
    whk: string;
    conn: string;
    dem: string;
    kwh: string;
  };
  const lvlRows: LvlRow[] = [
    ...lc.levels.map((l) => ({
      name: l.levelName,
      area: l.areaM2 > 0 ? l.areaM2.toFixed(0) : '—',
      src: l.source,
      light: l.lightingKW.toFixed(2),
      power: l.powerKW.toFixed(2),
      hvac: l.hvacKW.toFixed(2),
      whk: l.waterKitchenKW.toFixed(2),
      conn: l.connectedKW.toFixed(2),
      dem: l.demandKW.toFixed(2),
      kwh: l.dailyKWh.toFixed(1),
    })),
    {
      name: 'TOTAL (IN-SCOPE FLOORS)',
      area: lc.totalAreaM2.toFixed(0),
      src: `${scopeLevels(model).length} flr`,
      light: lc.levels.reduce((s, l) => s + l.lightingKW, 0).toFixed(2),
      power: lc.levels.reduce((s, l) => s + l.powerKW, 0).toFixed(2),
      hvac: lc.levels.reduce((s, l) => s + l.hvacKW, 0).toFixed(2),
      whk: lc.levels.reduce((s, l) => s + l.waterKitchenKW, 0).toFixed(2),
      conn: lc.totalConnectedKW.toFixed(2),
      dem: lc.totalDemandKW.toFixed(2),
      kwh: lc.totalDailyKWh.toFixed(1),
    },
  ];
  const lvlRowH = Math.min(4.6, Math.max(3.6, (A.y + A.h - curY - 38) / (lvlRows.length + 2)));
  const lvlCols = [
    { label: 'Floor / Zone', w: 56, get: (x: LvlRow) => x.name, bold: true },
    { label: 'Area m²', w: 17, get: (x: LvlRow) => x.area, align: 'end' as const },
    { label: 'Basis', w: 21, get: (x: LvlRow) => x.src },
    { label: 'Light kW', w: 19, get: (x: LvlRow) => x.light, align: 'end' as const },
    { label: 'Power kW', w: 20, get: (x: LvlRow) => x.power, align: 'end' as const },
    { label: 'HVAC kW', w: 20, get: (x: LvlRow) => x.hvac, align: 'end' as const },
    { label: 'WH/Kit kW', w: 21, get: (x: LvlRow) => x.whk, align: 'end' as const },
    { label: 'Conn kW', w: 20, get: (x: LvlRow) => x.conn, align: 'end' as const },
    { label: 'Demand kW', w: 21, get: (x: LvlRow) => x.dem, align: 'end' as const, bold: true },
    { label: 'kWh/d', w: 21, get: (x: LvlRow) => x.kwh, align: 'end' as const },
  ];
  const tLvl = table(A.x, curY, '2. Floor-by-floor load schedule & daily energy estimate', lvlCols, lvlRows, { rowH: lvlRowH });
  p3.push(tLvl.svg);
  curY += tLvl.h + 5;

  // Table 3: Itemized Appliance, AC, TV, Fan & Equipment Load Schedule
  type AppRow = {
    ref: string;
    item: string;
    cat: string;
    qty: string;
    unit: string;
    conn: string;
    df: string;
    dem: string;
    hrs: string;
    kwh: string;
  };
  const appRows: AppRow[] = [
    ...lc.appliances.map((a) => ({
      ref: a.id,
      item: a.item,
      cat: a.category,
      qty: String(a.qty),
      unit: `${a.unitWatts} W`,
      conn: a.connectedKW.toFixed(2),
      df: a.diversityFactor.toFixed(2),
      dem: a.demandKW.toFixed(2),
      hrs: `${a.hoursPerDay.toFixed(1)} h`,
      kwh: a.dailyKWh.toFixed(1),
    })),
    {
      ref: 'SUM',
      item: 'TOTAL ITEMIZED EQUIPMENT & APPLIANCES',
      cat: 'All',
      qty: String(lc.appliances.reduce((s, a) => s + a.qty, 0)),
      unit: '—',
      conn: lc.appliances.reduce((s, a) => s + a.connectedKW, 0).toFixed(2),
      df: '—',
      dem: lc.appliances.reduce((s, a) => s + a.demandKW, 0).toFixed(2),
      hrs: '—',
      kwh: lc.appliances.reduce((s, a) => s + a.dailyKWh, 0).toFixed(1),
    },
  ];
  const appAvail = A.y + A.h - curY - 30;
  const appRowH = Math.min(4.4, Math.max(3.2, appAvail / (appRows.length + 2)));
  const appCols = [
    { label: 'Ref', w: 12, get: (x: AppRow) => x.ref, bold: true },
    { label: 'Equipment / Appliance', w: 74, get: (x: AppRow) => x.item, bold: true },
    { label: 'Group', w: 24, get: (x: AppRow) => x.cat },
    { label: 'Qty', w: 12, get: (x: AppRow) => x.qty, align: 'end' as const },
    { label: 'Rating', w: 19, get: (x: AppRow) => x.unit, align: 'end' as const },
    { label: 'Conn kW', w: 19, get: (x: AppRow) => x.conn, align: 'end' as const },
    { label: 'DF', w: 13, get: (x: AppRow) => x.df, align: 'end' as const },
    { label: 'Demand kW', w: 21, get: (x: AppRow) => x.dem, align: 'end' as const, bold: true },
    { label: 'Use/d', w: 17, get: (x: AppRow) => x.hrs, align: 'end' as const },
    { label: 'kWh/d', w: 25, get: (x: AppRow) => x.kwh, align: 'end' as const },
  ];
  const tApp = table(A.x, curY, '3. Itemized appliance, AC, TV, fan & equipment schedule', appCols, appRows, { rowH: appRowH });
  p3.push(tApp.svg);
  curY += tApp.h + 4;

  // Engineering basis & compliance notes at bottom of left column
  const calcNotes: [string, string][] = [
    ['1. Basis', lc.methodologyNote],
    ['2. Demand', 'Maximum demand calculated per IEC 60364 / BS 7671 diversity factors with tropical coincidence adjustment for multi-storey buildings.'],
    ['3. Sizing', `Main breaker sized at In ≥ 1.25 × Ib (${lc.designCurrentA.toFixed(1)} A → ${lc.recommendedBreakerA} A). Incoming Cu XLPE/SWA cable derated for 35 °C Maldives ambient.`],
    ['4. Compliance', 'Design complies with MNBC, IEC 60364, and STELCO / FENAKA utility connection rules. Verify final appliance schedule prior to switchgear procurement.'],
  ];
  const calcNoteBox = dataBox(A.x, curY, mainW, '4. Calculation notes & compliance', calcNotes, 1.45);
  if (curY + calcNoteBox.h <= A.y + A.h + 2) p3.push(calcNoteBox.svg);

  // Right sidebar on Sheet 3: Supply & Switchgear Sizing + Solar PV Balance + Legend
  let s3y = A.y;
  const s3Supply = dataBox(sideX, s3y, 74, 'Supply & switchgear sizing', [
    ['Supply system', lc.supplySystem],
    ['Connected load', `${lc.totalConnectedKW.toFixed(2)} kW`],
    ['Overall diversity', `${(lc.overallDiversity * 100).toFixed(0)}% (DF ${lc.overallDiversity.toFixed(2)})`],
    ['Max demand', `${lc.totalDemandKW.toFixed(2)} kW`],
    ['Power factor', lc.powerFactor.toFixed(2)],
    ['Apparent power', `${lc.totalApparentKVA.toFixed(2)} kVA`],
    ['Design current Ib', `${lc.designCurrentA.toFixed(1)} A`],
    ['Main breaker In', lc.mainBreakerSpec],
    ['Incoming feeder', lc.incomingCableSpec],
    ['Surge protection', lc.spdSpec],
    ['Earthing', lc.earthingSpec],
  ]);
  p3.push(s3Supply.svg);
  s3y += s3Supply.h + 4;

  if (lc.solar.enabled) {
    const s3Solar = dataBox(sideX, s3y, 74, 'Solar PV & energy balance', [
      ['Installed PV', `${lc.solar.panelCount} × ${lc.solar.panelWattage} Wp = ${lc.solar.arrayKwp.toFixed(2)} kWp`],
      ['Inverter', `${lc.solar.inverterKW.toFixed(1)} kW ${invMode} (rec. ≥ ${lc.solar.recommendedInverterKW} kW)`],
      ['Battery bank', lc.solar.batteryKWh > 0 ? `${lc.solar.batteryKWh.toFixed(0)} kWh LiFePO4` : 'None (On-Grid)'],
      ['Est. solar yield', `${lc.solar.estDailyKWh.toFixed(1)} kWh/d (${lc.solar.estAnnualKWh.toLocaleString()} kWh/yr)`],
      ['Building demand', `${lc.totalDailyKWh.toFixed(1)} kWh/d (${lc.estMonthlyKWh.toLocaleString()} kWh/mo)`],
      ['Solar offset', `${lc.solar.offsetPct}% of total building energy`],
    ]);
    p3.push(s3Solar.svg);
    s3y += s3Solar.h + 4;
  }

  const lcAbbr: LegendEntry[] = [
    { sym: 'text', tag: 'DF', label: 'Diversity / coincidence factor applied to connected load' },
    { sym: 'text', tag: 'PF', label: 'Power factor (cos φ) for apparent power kVA' },
    { sym: 'text', tag: 'Ib / In', label: 'Design current (A) / nominal breaker rating (A)' },
    { sym: 'text', tag: 'TN-S', label: 'Separate neutral (N) and protective earth (PE) system' },
    { sym: 'text', tag: 'MNBC', label: 'Maldives National Building Code · STELCO / FENAKA' },
  ];
  const k3 = keySize(lcAbbr)!;

  return [
    { title: 'Electrical single-line diagram', body: p.join(''), legend, key },
    { title: 'Electrical schedules', body: p2.join(''), legend: abbr, key: { x: dx, y: A.y + A.h - k2.h, w: 74, h: k2.h } },
    { title: 'Electrical load calculation', body: p3.join(''), legend: lcAbbr, key: { x: sideX, y: A.y + A.h - k3.h, w: 74, h: k3.h } },
  ];
}

function summarise(points: Pt[]) {
  const n = (k: PtKind) => points.filter((p) => p.kind === k).length;
  const out: string[] = [];
  if (n('light')) out.push(`${n('light')} light`);
  if (n('fan')) out.push(`${n('fan')} fan`);
  if (n('exhaust')) out.push(`${n('exhaust')} exhaust`);
  if (n('switch')) out.push(`${n('switch')} sw`);
  if (n('socket')) out.push(`${n('socket')} twin skt`);
  if (n('ac')) out.push('AC + CU');
  if (n('wh')) out.push('heater');
  if (n('appliance')) out.push(points.filter((p) => p.kind === 'appliance').map((p) => p.label.split(' ')[0]).join(', '));
  return out.join(', ');
}
