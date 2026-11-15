/**
 * Plumbing schematic on A3: water supply, drainage and rainwater drawn against the building's
 * real levels, from the utility main to every fixture and from every fixture to the soakaway,
 * with the fixture, chamber and design schedules beneath.
 */
import type { BuildingProject } from '../../../model/types';
import { computePlumbingRiser } from '../../../engine/mepEngine';
import { buildFrame } from '../../drawing/model3d/faces';
import { sewerLayout } from '../../drawing/plan/sheetPlans';
import { DRAWING_AREA, keySize, type LegendEntry } from '../../../export/sheet';
import { chamber, CIRC, COLD, cowl, dataBox, floatValve, HOT, INK, INK2, INK3, L, PL, pump, RAIN, RECT, SOIL, T, table, tank, valve } from './svg';
import type { DrawnPage } from './electrical';

const FIX: Record<string, { name: string; cold: string; hot: string; waste: string; dfu: number; soil?: boolean }> = {
  WC: { name: 'WC, 6 L dual flush', cold: 'Ø15', hot: '—', waste: 'Ø110', dfu: 4, soil: true },
  WHB: { name: 'Wash hand basin', cold: 'Ø15', hot: 'Ø15', waste: 'Ø40', dfu: 1 },
  SHR: { name: 'Shower mixer', cold: 'Ø20', hot: 'Ø20', waste: 'Ø50', dfu: 2 },
  KS: { name: 'Kitchen sink', cold: 'Ø15', hot: 'Ø15', waste: 'Ø50', dfu: 2 },
  BATH: { name: 'Bath', cold: 'Ø20', hot: 'Ø20', waste: 'Ø50', dfu: 3 },
  FT: { name: 'Floor trap / gully', cold: '—', hot: '—', waste: 'Ø75', dfu: 1 },
};
const ORDER = ['WC', 'WHB', 'SHR', 'BATH', 'KS', 'FT'];
const HOT_FIX = new Set(['WHB', 'SHR', 'KS', 'BATH']);

const LEGEND: LegendEntry[] = [
  { sym: 'line', color: COLD, weight: 0.45, label: 'Cold water, PPR PN20' },
  { sym: 'line', color: HOT, weight: 0.45, label: 'Hot water, PPR PN20 insulated' },
  { sym: 'line', color: SOIL, weight: 0.6, label: 'Soil pipe Ø110 uPVC' },
  { sym: 'line', color: SOIL, weight: 0.35, dash: '1.4 0.8', label: 'Waste pipe Ø40-75 uPVC' },
  { sym: 'line', color: SOIL, weight: 0.25, dash: '0.5 0.6', label: 'Vent pipe' },
  { sym: 'line', color: RAIN, weight: 0.45, label: 'Rainwater pipe Ø100 uPVC' },
  { sym: 'meter', tag: 'M', label: 'Water meter (utility)' },
  { sym: 'valve', color: COLD, label: 'Stop / isolating valve; NRV = non-return valve' },
  { sym: 'float', color: COLD, label: 'Float valve (ball valve) at tank inlet' },
  { sym: 'pump', color: COLD, label: 'Pressure pump set: pump, pressure switch, vessel' },
  { sym: 'vessel', label: 'Ground-mounted water tank on plinth' },
  { sym: 'ring', color: COLD, tag: 'WC', label: 'Fixture, tagged as in the fixture schedule' },
  { sym: 'cowl', color: SOIL, label: 'Vent cowl, 900 mm above roof' },
  { sym: 'chamber', label: 'IC: inspection chamber; IL = invert level (m)' },
  { sym: 'septic', label: 'Septic tank, two chambers' },
  { sym: 'soak', label: 'Soakaway pit' },
  { sym: 'datum', tag: '+0.450', label: 'Floor level, m above natural ground' },
];

export function plumbingPages(model: BuildingProject): DrawnPage[] {
  const rep = computePlumbingRiser(model);
  const frame = buildFrame(model);
  const A = DRAWING_AREA;
  const p: string[] = [];
  const levels = model.levels;
  const top = levels[levels.length - 1];
  const groundY = 126;
  const topZ = Math.max(frame.ridgeZ, top.elevation + 3) + 1.6;
  const s = Math.min(9, (groundY - 40) / topZ);
  const yOf = (z: number) => groundY - z * s;
  const yEave = yOf(frame.eaveZ);
  const yRidge = yOf(frame.ridgeZ);

  // Fittings per level, by tag.
  const perLevel = levels.map((lvl) => {
    const lay = sewerLayout(model, lvl);
    const counts = new Map<string, number>();
    for (const f of lay.fittings) counts.set(f.tag, (counts.get(f.tag) ?? 0) + 1);
    const tags = ORDER.filter((t) => counts.has(t)).concat([...counts.keys()].filter((t) => !ORDER.includes(t)));
    return { lvl, lay, counts, tags, heaters: lvl.mepNodes.filter((n) => n.kind === 'water_heater').length };
  });
  const ground = perLevel[0];

  // Panels and shared level lines.
  const panels = [
    { x0: A.x + 2, x1: 142, title: 'Water supply' },
    { x0: 148, x1: 252, title: 'Soil, waste and vent' },
    { x0: 258, x1: A.x + A.w - 2, title: 'Rainwater' },
  ];
  for (const pn of panels) {
    p.push(T(pn.x0, 31, pn.title.toUpperCase(), 2.2, { w: 700, ls: 0.2 }));
    p.push(L(pn.x0, 32.6, pn.x0 + pn.title.length * 1.45, 32.6, INK, 0.35));
  }
  // Natural ground.
  p.push(L(A.x + 2, groundY, A.x + A.w - 2, groundY, INK, 0.45));
  for (let x = A.x + 4; x < A.x + A.w - 2; x += 2.2) p.push(L(x, groundY + 0.4, x - 1.4, groundY + 1.8, INK3, 0.15));
  p.push(T(A.x + 2, groundY - 0.8, 'NATURAL GROUND ±0.000', 1.4, { w: 700, c: INK2 }));
  // Floor and roof levels.
  const datums = [
    ...levels.map((l) => ({ z: l.elevation, name: `${l.name.replace(/\s*\(.*\)/, '').toUpperCase()} FFL` })),
    { z: frame.eaveZ, name: 'EAVE' },
    { z: frame.ridgeZ, name: 'RIDGE' },
  ];
  for (const d of datums) {
    const y = yOf(d.z);
    p.push(L(A.x + 2, y, A.x + A.w - 2, y, INK3, 0.15, '1.6 0.9'));
    p.push(T(A.x + 2, y - 0.7, `${d.name} ${d.z > 0 ? '+' : '±'}${d.z.toFixed(3)}`, 1.3, { c: INK2 }));
  }

  /* ── Water supply: utility main, then either straight up on mains pressure or through a
     ground tank and a pressure pump set. No overhead tanks (Maldives practice). ── */
  const pumped = rep.supplyMode === 'ground_tank_pump';
  const mainY = groundY + 8;
  const dx = 80;
  const branchY = (z: number) => yOf(z + 0.8);
  const highest = branchY(top.elevation);
  p.push(T(A.x + 2, mainY - 3, 'UTILITY MAIN (MWSC / FENAKA)', 1.3, { w: 700, c: INK2 }));
  p.push(T(A.x + 2, mainY + 3, rep.supplyMainPipe, 1.2, { c: INK2 }));
  p.push(L(A.x + 2, mainY, 36, mainY, COLD, 0.5));
  p.push(CIRC(20, mainY, 2) + T(20, mainY + 0.55, 'M', 1.4, { w: 700, a: 'middle' }));
  p.push(valve(26, mainY) + valve(32, mainY) + T(32, mainY + 3, 'NRV', 1.0, { c: INK2, a: 'middle' }));
  if (pumped) {
    const tk = { x: 38, w: 22, h: 14, y: groundY - 15 };
    p.push(RECT(tk.x - 1, groundY - 1, tk.w + 2, 1, { fill: '#E4E1DA', sw: 0.2 }));
    p.push(tank(tk.x, tk.y, tk.w, tk.h));
    p.push(PL([[36, mainY], [36, tk.y + 2], [tk.x + 1, tk.y + 2]], COLD, 0.45));
    p.push(floatValve(tk.x + 1, tk.y + 2));
    p.push(T(tk.x + tk.w / 2, tk.y - 4.2, 'GROUND TANK', 1.3, { w: 700, a: 'middle' }));
    p.push(T(tk.x + tk.w / 2, tk.y - 2, `${rep.storageTankLiters.toLocaleString('en-US')} L on plinth`, 1.15, { c: INK2, a: 'middle' }));
    const pumpY = tk.y + tk.h - 2.5;
    const px = 68;
    p.push(L(tk.x + tk.w, pumpY, px - 2.4, pumpY, COLD, 0.45) + valve(63, pumpY));
    p.push(pump(px, pumpY));
    // Pressure vessel and switch on the outlet.
    p.push(L(px + 2.4, pumpY, dx, pumpY, COLD, 0.45) + L(73, pumpY, 73, pumpY - 4, COLD, 0.35));
    p.push(RECT(71, pumpY - 9, 4, 5, { fill: '#EAF1FB', rx: 1.6 }) + T(77.6, pumpY - 6.4, `${rep.pressureVesselLiters} L`, 1.0, { c: INK2, a: 'end', rot: -90 }));
    p.push(valve(76.5, pumpY) + T(76.5, pumpY + 3, 'NRV', 1.0, { c: INK2, a: 'middle' }));
    p.push(T(px - 6, groundY + 3.4, 'PRESSURE PUMP SET', 1.3, { w: 700 }));
    p.push(T(px - 6, groundY + 5.6, `${rep.pumpKW} kW · ${rep.pumpFlowLpm} L/min at ${rep.pumpHeadMeters} m`, 1.15, { c: INK2 }));
    p.push(T(px - 6, groundY + 7.6, 'pressure switch + vessel, dry-run cut-out', 1.15, { c: INK2 }));
    p.push(L(dx, pumpY, dx, highest, COLD, 0.5));
  } else {
    p.push(PL([[36, mainY], [dx, mainY], [dx, highest]], COLD, 0.5));
    p.push(T(40, mainY - 1.4, 'MAINS PRESSURE, DIRECT TO THE FITTINGS', 1.2, { w: 700, c: INK2 }));
    p.push(T(40, mainY + 3, 'no storage tank, no pump', 1.15, { c: INK2 }));
  }
  p.push(T(dx - 1.2, highest + 1.6, 'RISER Ø25', 1.1, { c: INK2, a: 'end' }));
  for (const pl of perLevel) {
    const by = branchY(pl.lvl.elevation);
    const fx0 = 92;
    const fx1 = 140;
    const tags = pl.tags.filter((t) => t !== 'FT');
    if (!tags.length) continue;
    const step = Math.min(12, (fx1 - fx0) / Math.max(1, tags.length));
    const xs = tags.map((_, i) => fx0 + step * (i + 0.5));
    p.push(L(dx, by, xs[xs.length - 1], by, COLD, 0.45));
    p.push(valve(dx + 4, by));
    const fy = by - 11;
    const hotY = by - 5;
    const hotTags = tags.filter((t) => HOT_FIX.has(t));
    const heaterAt = dx + 7.5;
    if (pl.heaters && hotTags.length) {
      // Cold feed to the heater, hot out along its own line.
      p.push(L(heaterAt, by, heaterAt, hotY + 1.2, COLD, 0.35));
      p.push(RECT(heaterAt - 2.2, hotY - 1.4, 4.4, 2.8, { fill: HOT, stroke: HOT, rx: 0.4 }) + T(heaterAt, hotY + 0.55, 'WH', 1.25, { w: 700, c: '#fff', a: 'middle' }));
      const lastHot = Math.max(...tags.map((t, i) => (HOT_FIX.has(t) ? xs[i] + 1.2 : 0)));
      p.push(L(heaterAt + 2.2, hotY, lastHot, hotY, HOT, 0.45));
    }
    tags.forEach((t, i) => {
      const x = xs[i];
      p.push(L(x, by, x, fy + 1.6, COLD, 0.35));
      p.push(valve(x, by - 2.6, true));
      if (pl.heaters && HOT_FIX.has(t)) p.push(L(x + 1.2, hotY, x + 1.2, fy + 1.2, HOT, 0.35));
      p.push(CIRC(x, fy, 1.6, { stroke: COLD, sw: 0.3 }));
      p.push(T(x, fy - 2.4, t, 1.3, { w: 700, a: 'middle' }));
      p.push(T(x, fy + 0.5, `×${pl.counts.get(t)}`, 1.0, { c: INK2, a: 'middle' }));
    });
  }

  /* ── Soil, waste and vent ── */
  const sx = 160;
  const stackBase = groundY + 6;
  const topBranch = yOf(top.elevation) + 1.6;
  const ventTop = yRidge - 7;
  p.push(L(sx, stackBase, sx, topBranch, SOIL, 0.65));
  p.push(L(sx, topBranch, sx, ventTop, SOIL, 0.3, '0.5 0.6'));
  p.push(cowl(sx, ventTop));
  p.push(T(sx - 1.4, ventTop + 3, 'VENT Ø50 TO ATMOSPHERE', 1.15, { c: INK2, rot: -90, a: 'end' }));
  p.push(T(sx - 1.4, stackBase - 1.4, `SOIL STACK ${rep.soilStackPipe.split(' ')[0]}`, 1.15, { c: INK2, a: 'end' }));
  for (const pl of perLevel) {
    if (!pl.tags.length) continue;
    const by = yOf(pl.lvl.elevation) + 1.6;
    const fx0 = sx + 6;
    const fx1 = 250;
    const step = Math.min(14, (fx1 - fx0) / Math.max(1, pl.tags.length));
    const xs = pl.tags.map((_, i) => fx0 + step * (i + 0.5));
    p.push(PL([[xs[xs.length - 1], by - 0.6], [sx, by]], SOIL, 0.55));
    const fy = by - 8;
    pl.tags.forEach((t, i) => {
      const x = xs[i];
      const soil = FIX[t]?.soil;
      p.push(L(x, fy + 1.6, x, by - 0.6, SOIL, soil ? 0.55 : 0.35, soil ? undefined : '1.4 0.8'));
      p.push(CIRC(x, fy, 1.6, { stroke: SOIL, sw: 0.3 }));
      p.push(T(x, fy - 2.4, t, 1.3, { w: 700, a: 'middle' }));
      p.push(T(x, fy + 0.5, `×${pl.counts.get(t)}`, 1.0, { c: INK2, a: 'middle' }));
      p.push(T(x + 1.2, by + 2.6, FIX[t]?.waste ?? '', 1.0, { c: INK3, a: 'middle' }));
    });
  }
  // Below ground: chambers, septic tank, soakaway.
  const chambers = ground.lay.chambers.slice(0, 5);
  const cy = stackBase;
  const c0 = sx + 10;
  const septicX = 212;
  const cStep = Math.min(14, (septicX - c0 - 4) / Math.max(1, chambers.length));
  const cxs = chambers.map((_, i) => c0 + cStep * i);
  p.push(L(sx, stackBase, septicX, stackBase, SOIL, 0.65));
  chambers
    .slice()
    .sort((a, b) => b.il - a.il)
    .forEach((c, i) => {
      const x = cxs[i];
      p.push(chamber(x, cy, 2));
      p.push(T(x, cy - 3, c.id, 1.25, { w: 700, a: 'middle' }));
      p.push(T(x, cy + 4.4, `IL ${c.il.toFixed(2)}`, 1.05, { c: INK2, a: 'middle' }));
    });
  if (ground.lay.chambers.length > 5) p.push(T(cxs[cxs.length - 1] + 4, cy - 3, `+${ground.lay.chambers.length - 5} more`, 1.1, { c: INK2 }));
  p.push(RECT(septicX, cy - 4, 20, 9, { fill: '#F4F1EA', sw: 0.4 }) + L(septicX + 13, cy - 4, septicX + 13, cy + 5, INK, 0.25));
  p.push(T(septicX + 10, cy + 8, 'SEPTIC TANK', 1.25, { w: 700, a: 'middle' }));
  p.push(L(septicX + 20, cy, 238, cy, SOIL, 0.55));
  p.push(CIRC(242, cy + 1, 4, { fill: '#F4F1EA', sw: 0.4 }) + CIRC(242, cy + 1, 2.7, { fill: 'none', stroke: INK3, sw: 0.15, dash: '0.8 0.5' }));
  p.push(T(242, cy + 8, 'SOAKAWAY', 1.25, { w: 700, a: 'middle' }));

  /* ── Rainwater ── */
  const rx0 = 262;
  if (frame.drainage) {
    const n = frame.drainage.downpipes.length;
    const shown = Math.min(3, n);
    p.push(PL([[rx0 - 2, yEave - 1.8], [rx0 + 22, yRidge]], INK, 0.5));
    p.push(T(rx0 + 13, (yEave + yRidge) / 2 + 3, 'ROOF', 1.3, { w: 700, c: INK2 }));
    p.push(`<path d="M${rx0 - 3} ${yEave - 1} v1.6 h${8 + shown * 5} v-1.6" fill="none" stroke="${RAIN}" stroke-width="0.45"/>`);
    p.push(T(rx0 + 8 + shown * 5, yEave - 1.6, 'GUTTER', 1.2, { w: 700, c: INK2 }));
    for (let i = 0; i < shown; i++) {
      const x = rx0 + i * 5;
      p.push(L(x, yEave + 0.6, x, groundY - 2, RAIN, 0.45));
      p.push(T(x - 0.8, groundY - 4, `RWP${i + 1}`, 1.05, { c: INK2, rot: -90 }));
    }
    if (n > shown) p.push(T(rx0 + shown * 5, (yEave + groundY) / 2, `+${n - shown} more RWP`, 1.1, { c: INK2 }));
    const lastX = rx0 + (shown - 1) * 5;
    p.push(L(rx0, groundY - 2, rx0 + 22, groundY - 2, RAIN, 0.45));
    const col = frame.drainage.collection;
    if (rep.firstFlushDiverter) {
      p.push(RECT(rx0 + 13, groundY - 9, 3, 7, { fill: '#fff', stroke: RAIN }) + T(rx0 + 14.5, groundY - 10, 'FIRST FLUSH', 1.0, { w: 700, c: INK2, a: 'middle' }));
    }
    if (col && col.mode === 'harvesting_tank') {
      p.push(tank(rx0 + 24, groundY - 16, 26, 16, 0.3));
      p.push(T(rx0 + 37, groundY - 8, 'RAINWATER TANK', 1.2, { w: 700, a: 'middle' }));
      p.push(T(rx0 + 37, groundY - 5.6, `${rep.harvestingTankLiters.toLocaleString('en-US')} L`, 1.2, { c: INK2, a: 'middle' }));
      p.push(L(rx0 + 50, groundY - 4, rx0 + 56, groundY - 4, RAIN, 0.35, '1 0.6') + T(rx0 + 56.5, groundY - 3.6, 'overflow', 1.0, { c: INK3 }));
    } else if (col && col.mode === 'underground_cistern') {
      p.push(L(rx0 + 22, groundY - 2, rx0 + 26, groundY - 2, RAIN, 0.45) + L(rx0 + 26, groundY - 2, rx0 + 26, groundY + 3, RAIN, 0.45));
      p.push(tank(rx0 + 24, groundY + 3, 26, 11, 0.3));
      p.push(T(rx0 + 37, groundY + 9, 'CISTERN', 1.2, { w: 700, a: 'middle' }) + T(rx0 + 37, groundY + 11.4, `${rep.harvestingTankLiters.toLocaleString('en-US')} L`, 1.2, { c: INK2, a: 'middle' }));
    } else if (col && col.mode === 'municipal_storm') {
      // Silt trap, then to the public storm drain.
      p.push(L(rx0 + 22, groundY - 2, rx0 + 30, groundY - 2, RAIN, 0.45) + L(rx0 + 30, groundY - 2, rx0 + 30, groundY + 3, RAIN, 0.45));
      p.push(chamber(rx0 + 30, groundY + 5.4, 2.4) + T(rx0 + 30, groundY + 10.6, 'SILT TRAP', 1.2, { w: 700, a: 'middle' }));
      p.push(L(rx0 + 32.4, groundY + 5.4, rx0 + 52, groundY + 5.4, RAIN, 0.45) + T(rx0 + 52, groundY + 4.4, 'TO STORM DRAIN', 1.1, { w: 700, c: INK2, a: 'end' }));
    } else if (col && col.mode === 'garden_redirect') {
      p.push(L(rx0 + 22, groundY - 2, rx0 + 40, groundY - 2, RAIN, 0.45) + T(rx0 + 41, groundY - 1.5, 'TO GARDEN / SPLASH PAD', 1.1, { w: 700, c: INK2 }));
    } else {
      p.push(L(rx0 + 22, groundY - 2, rx0 + 30, groundY - 2, RAIN, 0.45) + L(rx0 + 30, groundY - 2, rx0 + 30, groundY + 3, RAIN, 0.45));
      p.push(CIRC(rx0 + 30, groundY + 7, 4, { fill: '#F4F1EA', sw: 0.4 }));
      p.push(T(rx0 + 30, groundY + 14, 'SOAKAWAY', 1.2, { w: 700, a: 'middle' }));
    }
    p.push(T(rx0 + 9 + shown * 5, yEave + 2.6, `${n} × ${rep.rainwaterPipeSpec}`, 1.15, { c: INK2 }));
    void lastX;
  } else {
    p.push(T(rx0, (yEave + groundY) / 2, 'Free-drip eaves: no gutters or RWPs.', 1.4, { c: INK2 }));
    p.push(T(rx0, (yEave + groundY) / 2 + 2.4, 'Splash strip at ground.', 1.4, { c: INK2 }));
  }

  /* ── Schedules ── */
  const counts = new Map<string, number>();
  for (const pl of perLevel) for (const [t, c] of pl.counts) counts.set(t, (counts.get(t) ?? 0) + c);
  const tags = ORDER.filter((t) => counts.has(t));
  type FR = { tag: string; name: string; qty: number; cold: string; hot: string; waste: string; dfu: number };
  const frows: FR[] = tags.map((t) => ({ tag: t, name: FIX[t].name, qty: counts.get(t)!, cold: FIX[t].cold, hot: FIX[t].hot, waste: FIX[t].waste, dfu: FIX[t].dfu * counts.get(t)! }));
  const tTop = 156;
  const fixT = table(
    A.x,
    tTop,
    'Fixture schedule',
    [
      { label: 'Tag', w: 10, get: (f: FR) => f.tag, bold: true },
      { label: 'Fixture', w: 30, get: (f: FR) => f.name },
      { label: 'Qty', w: 8, get: (f: FR) => String(f.qty), align: 'end' },
      { label: 'Cold', w: 10, get: (f: FR) => f.cold, align: 'middle' },
      { label: 'Hot', w: 10, get: (f: FR) => f.hot, align: 'middle' },
      { label: 'Waste', w: 11, get: (f: FR) => f.waste, align: 'middle' },
      { label: 'DFU', w: 9, get: (f: FR) => String(f.dfu), align: 'end' },
    ],
    frows,
    { total: { tag: '', name: 'Total', qty: frows.reduce((s, f) => s + f.qty, 0), cold: '', hot: '', waste: '', dfu: frows.reduce((s, f) => s + f.dfu, 0) } }
  );
  p.push(fixT.svg);

  type CR = { id: string; size: string; il: string; note: string };
  const crows: CR[] = [
    ...ground.lay.chambers.map((c) => ({ id: c.id, size: c.main ? '900×900' : '600×600', il: c.il.toFixed(2), note: c.main ? 'Main, to septic tank' : 'Branch' })),
    ...(ground.lay.septic ? [{ id: 'ST', size: '2400×1200', il: '—', note: 'Septic tank, 2 chambers' }] : []),
    ...(ground.lay.soak ? [{ id: 'SA', size: `Ø${Math.round(ground.lay.soak.r * 2000)}`, il: '—', note: 'Soakaway, perforated rings' }] : []),
  ];
  const chT = table(
    A.x + 92,
    tTop,
    'Chambers, tank and soakaway',
    [
      { label: 'Ref', w: 10, get: (c: CR) => c.id, bold: true },
      { label: 'Size mm', w: 18, get: (c: CR) => c.size },
      { label: 'IL m', w: 10, get: (c: CR) => c.il, align: 'end' },
      { label: 'Note', w: 32, get: (c: CR) => c.note },
    ],
    crows
  );
  p.push(chT.svg);

  const db = dataBox(A.x + 166, tTop, 70, 'Design data', [
    ['Occupancy', `${rep.occupancyCount} persons`],
    ['Daily demand', `${rep.dailyWaterDemandLiters.toLocaleString('en-US')} L (150 L/p/d)`],
    ['Water supply', pumped ? 'Ground tank + pressure pump' : 'Pressurised city water'],
    ...(pumped
      ? ([
          ['Ground tank', `${rep.storageTankLiters.toLocaleString('en-US')} L (2 days)`],
          ['Pressure pump', `${rep.pumpKW} kW, ${rep.pumpFlowLpm} L/min, ${rep.pumpHeadMeters} m head`],
          ['Pressure vessel', `${rep.pressureVesselLiters} L, cut-in 1.5 bar`],
        ] as [string, string][])
      : ([['Mains pressure', 'min. 1.0 bar at highest outlet']] as [string, string][])),
    ['Supply main', rep.supplyMainPipe],
    ['Peak flow', `${rep.peakFlowLps} L/s at ${rep.designVelocityMps} m/s`],
    ['Soil stack', rep.soilStackPipe],
    ['Waste', rep.wasteStackPipe],
    ['', 'Rainwater'],
    ['Roof catchment', `${rep.roofCatchmentM2} m² at ${rep.rainfallIntensityMmh} mm/h`],
    ['Peak runoff', `${rep.stormwaterRunoffLps} L/s`],
    ['Gutter', rep.gutterEnabled ? rep.gutterSpec : 'None'],
    ['Storage', rep.rainwaterTankSpec],
  ], 1.4);
  p.push(db.svg);

  // Mains-pressure houses have no tank, float valve or pump to explain.
  const legend = pumped ? LEGEND : LEGEND.filter((e) => e.sym !== 'float' && e.sym !== 'pump' && e.sym !== 'vessel');
  const ks = keySize(legend)!;
  const key = { x: A.x + A.w - ks.w, y: A.y + A.h - ks.h, w: ks.w, h: ks.h };
  return [{ title: 'Plumbing & drainage schematic', body: p.join(''), legend, key }];
}
