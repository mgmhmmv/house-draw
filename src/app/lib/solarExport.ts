/**
 * The solar design as the IslePOS Solar Suite takes it (payload version 1): the module, the
 * strings, cable runs measured on the 3D model, the array/roof/cable geometry, and (added by the
 * caller) the drawings. Units are metres; plan axes are Maavadiyaa's: x east, y south, z up.
 *
 * Cable runs are measured, not guessed. Each string pole is followed from its end module along
 * the array to the drop point (the array edge nearest the inverter), down the mounting (canopy
 * post or roof), across the roof to the riser above the inverter, and down the riser to the
 * inverter (1.5 m above its floor). The AC run is the routed inverter → main board path; the
 * earth (array bonding) follows the longest DC route and then the AC route.
 */
import type { BuildingProject } from '../../model/types';
import { getSolarConfig } from '../../model/types';
import { PV_MODULE } from '../../model/pvModule';
import { computeSolarArrayLayout } from '../../engine/geometry';
import { computeElectricalSLD, computePVAndEquipmentRoutes } from '../../engine/mepEngine';
import { buildFrame, levelOutline } from '../drawing/model3d/faces';

type P3 = [number, number, number];
const r2 = (n: number) => Math.round(n * 100) / 100;
const pathLen = (pts: P3[]) => pts.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1], p[2] - pts[i][2]), 0);

export interface SolarRuns {
  method: '3d-route';
  dcRunM: number;
  acRunM: number;
  earthRunM: number;
  perString: { stringId: string; positiveM: number; negativeM: number }[];
}

export interface SolarExport {
  version: 1;
  source: { app: 'maavadiyaa'; projectId: string; projectName: string; modelVersion: number; viewUrl: string | null; exportedAt: string };
  panel: Record<string, number | string>;
  system: { inverterKw: number; batteryKwh: number; phase: 1 | 3; strings: { id: string; panelsInSeries: number; parallelRuns: number; mppt: number }[] };
  runs: SolarRuns;
  geometry: {
    roofs: { name: string; heightM: number; polygon: [number, number][] }[];
    panels: { stringId: string; index: number; x: number; y: number; w: number; d: number; rotationDeg: number; zM: number }[];
    cables: { role: 'dc' | 'ac' | 'earth'; stringId?: string; polarity?: '+' | '-'; points: P3[] }[];
    fixtures: { kind: 'inverter' | 'battery' | 'mdb' | 'meter'; x: number; y: number; zM: number; label: string; floor: number }[];
    /** Floor plans of the floors holding the meter, inverter or main board (each once). */
    floors: {
      index: number;
      name: string;
      elevationM: number;
      walls: { id: string; a: [number, number]; b: [number, number]; thicknessM: number }[];
      openings: { wallId: string; kind: 'door' | 'window'; t: number; widthM: number; hinge: 'start' | 'end'; swing: 'left' | 'right' }[];
      rooms: { name: string; polygon: [number, number][] }[];
    }[];
  };
  drawings: { slot: string; name: string; mime: 'image/svg+xml' | 'image/png'; data: string }[];
}

/** Everything but the drawings. Throws with a plain message when the design can't be exported. */
export function solarExport(model: BuildingProject, meta: { projectId: string; projectName: string; modelVersion: number; viewUrl: string | null }): SolarExport {
  const solar = getSolarConfig(model);
  if (!solar.enabled) throw new Error('This project has no solar. Turn solar on first.');
  const layout = computeSolarArrayLayout(model);
  if (!layout.panels.length) throw new Error('The solar array has no panels.');
  const per = solar.panelsPerString && solar.panelsPerString > 0 ? solar.panelsPerString : Math.max(1, Math.ceil(solar.panelCount / (solar.strings || 1)));
  const nStrings = Math.ceil(layout.panels.length / per);

  // Panel heights from the 3D frame itself (canopy, low frame or pitched roof).
  const frame = buildFrame(model);
  const solarFaces = frame.faces.filter((f) => f.kind === 'solar');
  const faceAt = (x: number, y: number) => {
    let best = Infinity;
    let face: (typeof solarFaces)[number] | null = null;
    for (const f of solarFaces) {
      const cx = f.pts.reduce((s, p) => s + p.x, 0) / f.pts.length;
      const cy = f.pts.reduce((s, p) => s + p.y, 0) / f.pts.length;
      const d = Math.hypot(cx - x, cy - y);
      if (d < best) {
        best = d;
        face = f;
      }
    }
    return face;
  };
  const zOf = (x: number, y: number) => {
    const f = faceAt(x, y);
    return f ? f.pts.reduce((s, p) => s + p.z, 0) / f.pts.length : frame.eaveZ;
  };
  // Panels: centre, size as seen from above (a tilted module looks shorter up the slope),
  // clockwise rotation seen from above, and `index` = place in its string's series, 0 = the + end.
  const byString = new Map<number, typeof layout.panels>();
  for (const p of layout.panels) byString.set(Math.floor(p.index / per), [...(byString.get(Math.floor(p.index / per)) ?? []), p]);
  const panels: SolarExport['geometry']['panels'] = [];
  for (const [s, list] of [...byString.entries()].sort((a, b) => a[0] - b[0])) {
    list.sort((a, b) => a.index - b.index).forEach((p, k) => {
      const f = faceAt(p.x, p.y);
      const plan = f
        ? { w: Math.max(...f.pts.map((q) => q.x)) - Math.min(...f.pts.map((q) => q.x)), d: Math.max(...f.pts.map((q) => q.y)) - Math.min(...f.pts.map((q) => q.y)) }
        : { w: p.width, d: p.depth };
      panels.push({ stringId: `S${s + 1}`, index: k, x: r2(p.x), y: r2(p.y), w: r2(plan.w), d: r2(plan.d), rotationDeg: p.rotationDeg, zM: r2(zOf(p.x, p.y)) });
    });
  }

  // Equipment: inverter, battery, the main board and the meter, wherever they are. Upper floors'
  // distribution boards (MDB-2…) are not the main board.
  const fixtures: SolarExport['geometry']['fixtures'] = [];
  let inv: { x: number; y: number; z: number } | null = null;
  const isMain = (label: string | undefined, li: number) => !label || /^MDB(-1)?$/i.test(label.trim()) || li === 0;
  model.levels.forEach((l, li) => {
    for (const n of l.mepNodes) {
      const kind = n.kind === 'solar_inv' ? 'inverter' : n.kind === 'solar_bess' ? 'battery' : n.kind === 'mdb' && isMain(n.label, li) ? 'mdb' : n.kind === 'utility_meter' ? 'meter' : null;
      if (!kind) continue;
      const zM = r2(l.elevation + 1.5);
      fixtures.push({ kind, x: r2(n.position.x), y: r2(n.position.y), zM, label: n.label ?? kind.toUpperCase(), floor: l.index ?? li });
      if (kind === 'inverter' && !inv) inv = { x: n.position.x, y: n.position.y, z: zM };
    }
  });
  // Floor plans: every floor holding the meter, the inverter or the main board.
  const floorIdx = [...new Set(fixtures.filter((f) => f.kind !== 'battery').map((f) => f.floor))].sort((a, b) => a - b);
  const floors: SolarExport['geometry']['floors'] = floorIdx.map((fi) => {
    const l = model.levels.find((x, i) => (x.index ?? i) === fi)!;
    const walls = l.walls.map((w) => ({ id: w.id, a: [r2(w.start.x), r2(w.start.y)] as [number, number], b: [r2(w.end.x), r2(w.end.y)] as [number, number], thicknessM: r2(w.thickness) }));
    const ids = new Set(walls.map((w) => w.id));
    const openings = l.openings
      .filter((o) => ids.has(o.wallId))
      .map((o) => ({
        wallId: o.wallId,
        kind: o.kind,
        t: Math.round(o.offset * 1000) / 1000,
        widthM: r2(o.width),
        // As drawn on the plan: a leaf hangs on the opening's start jamb and opens to the wall's
        // right (looking from its start to its end, y south) when swingDirection ≥ 0.
        hinge: 'start' as const,
        swing: (o.swingDirection >= 0 ? 'right' : 'left') as 'left' | 'right',
      }));
    const rooms = l.rooms.map((rm) => ({ name: rm.name, polygon: rm.polygon.map((p) => [r2(p.x), r2(p.y)] as [number, number]) }));
    return { index: fi, name: l.name.replace(/\s*\(.*\)/, ''), elevationM: r2(l.elevation), walls, openings, rooms };
  });
  if (!inv) throw new Error('Place the inverter in the model first (Electrical): the cable runs are measured to it.');
  const I = inv as { x: number; y: number; z: number };

  // Roof surface the DC cables cross: the flat roof (deck) top, or the eave of a pitched roof.
  const top = model.levels[model.levels.length - 1];
  const roofZ = model.roof.type === 'flat' ? frame.eaveZ + 0.2 + Math.max(0, model.roof.parapetHeight) : frame.eaveZ;

  // Drop point: on the main block of panels, the edge point nearest the inverter's riser.
  const main = panels.filter((p) => Math.abs(p.zM - Math.max(...panels.map((q) => q.zM))) < 1.5);
  const bx0 = Math.min(...main.map((p) => p.x - p.w / 2)), bx1 = Math.max(...main.map((p) => p.x + p.w / 2));
  const by0 = Math.min(...main.map((p) => p.y - p.d / 2)), by1 = Math.max(...main.map((p) => p.y + p.d / 2));
  const D = { x: Math.min(bx1, Math.max(bx0, I.x)), y: Math.min(by1, Math.max(by0, I.y)) };
  const Dz = zOf(D.x, D.y);
  const trunk: P3[] = [
    [D.x, D.y, Dz],
    [D.x, D.y, roofZ],
    [I.x, D.y, roofZ],
    [I.x, I.y, roofZ],
    [I.x, I.y, I.z],
  ];

  const cables: SolarExport['geometry']['cables'] = [];
  const perString: SolarRuns['perString'] = [];
  for (let s = 0; s < nStrings; s++) {
    const sp = panels.filter((p) => p.stringId === `S${s + 1}`).sort((a, b) => a.index - b.index);
    if (!sp.length) continue;
    const id = `S${s + 1}`;
    // + at the first module's outer end, − at the last module's outer end (along the row).
    const first = sp[0];
    const last = sp[sp.length - 1];
    const ends: { pol: '+' | '-'; p: P3 }[] = [
      { pol: '+', p: [first.x - first.w / 2, first.y, first.zM] },
      { pol: '-', p: [last.x + last.w / 2, last.y, last.zM] },
    ];
    const lens: Record<string, number> = {};
    for (const e of ends) {
      // Along the rails to the drop line, then along the drop edge, then the trunk.
      const pts: P3[] = [e.p, [D.x, e.p[1], e.p[2]], [D.x, D.y, Dz], ...trunk.slice(1)];
      cables.push({ role: 'dc', stringId: id, polarity: e.pol, points: pts.map((q) => q.map(r2) as P3) });
      lens[e.pol] = pathLen(pts) + 0.5; // + terminations
    }
    perString.push({ stringId: id, positiveM: r2(lens['+']), negativeM: r2(lens['-']) });
  }

  // AC: inverter → main board along the routed path (same floor), else straight runs.
  const mdb = fixtures.find((f) => f.kind === 'mdb');
  let acPts: P3[] = [];
  const invLevel = model.levels.findIndex((l) => l.mepNodes.some((n) => n.kind === 'solar_inv'));
  try {
    const routes = computePVAndEquipmentRoutes(model, Math.max(0, invLevel));
    acPts = routes.inverterToMdb.points3D.map((p) => [r2(p.x), r2(p.z), r2(p.y)] as P3);
  } catch {
    /* fall back below */
  }
  if (acPts.length < 2 && mdb) acPts = [[I.x, I.y, I.z], [mdb.x, I.y, I.z], [mdb.x, mdb.y, mdb.zM]];
  if (acPts.length >= 2) cables.push({ role: 'ac', points: acPts });
  const acRunM = acPts.length >= 2 ? pathLen(acPts) + 1.0 : 0;

  const dcAll = perString.flatMap((p) => [p.positiveM, p.negativeM]);
  const dcRunM = dcAll.reduce((s, n) => s + n, 0) / Math.max(1, dcAll.length);
  const longest = Math.max(...dcAll);
  const earthRunM = longest + acRunM;

  // Roofs: the covered roof, and any open terrace below it that carries panels.
  const roofs: SolarExport['geometry']['roofs'] = [];
  const covered = levelOutline(top, (r) => r.category !== 'balcony');
  covered.forEach((poly, i) => roofs.push({ name: i ? `Roof ${i + 1}` : 'Roof', heightM: r2(roofZ), polygon: poly[0].map(([x, y]) => [r2(x), r2(y)] as [number, number]) }));
  const terrace = levelOutline(top, (r) => r.category === 'balcony');
  terrace.forEach((poly, i) => roofs.push({ name: i ? `Terrace ${i + 1}` : 'Terrace', heightM: r2(top.elevation), polygon: poly[0].map(([x, y]) => [r2(x), r2(y)] as [number, number]) }));

  const sld = computeElectricalSLD(model);
  const phase: 1 | 3 = /3-Ph/.test(sld.supplySystem) ? 3 : 1;

  return {
    version: 1,
    source: { app: 'maavadiyaa', projectId: meta.projectId, projectName: meta.projectName, modelVersion: meta.modelVersion, viewUrl: meta.viewUrl, exportedAt: new Date().toISOString() },
    panel: {
      maker: PV_MODULE.maker,
      model: PV_MODULE.model,
      wp: solar.panelWattage,
      voc: PV_MODULE.vocV,
      isc: PV_MODULE.iscA,
      vmp: PV_MODULE.vmpV,
      imp: PV_MODULE.impA,
      length_mm: PV_MODULE.length * 1000,
      width_mm: PV_MODULE.width * 1000,
      thickness_mm: PV_MODULE.thickness * 1000,
      weight_kg: PV_MODULE.weightKg,
      temp_coeff_voc: PV_MODULE.tempCoeffVocPct,
      temp_coeff_pmax: PV_MODULE.tempCoeffPmaxPct,
      temp_coeff_isc: PV_MODULE.tempCoeffIscPct,
      max_system_v: PV_MODULE.maxSystemV,
      max_series_fuse_a: PV_MODULE.maxSeriesFuseA,
    },
    system: {
      inverterKw: solar.inverterKW,
      batteryKwh: solar.batteryKWh,
      phase,
      strings: perString.map((p, i) => ({ id: p.stringId, panelsInSeries: panels.filter((q) => q.stringId === p.stringId).length, parallelRuns: 1, mppt: i + 1 })),
    },
    runs: { method: '3d-route', dcRunM: r2(dcRunM), acRunM: r2(acRunM), earthRunM: r2(earthRunM), perString },
    geometry: { roofs, panels, cables, fixtures, floors },
    drawings: [],
  };
}

/** An A3 sheet (SVG text) as a PNG, `width` pixels across (2480 ≈ 150 dpi on A3), base64. */
export async function svgToPngBase64(svg: string, width: number): Promise<string> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.decoding = 'async';
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error('Could not draw a sheet for sharing.'));
      img.src = url;
    });
    const ratio = img.naturalHeight && img.naturalWidth ? img.naturalHeight / img.naturalWidth : 297 / 420;
    const cv = document.createElement('canvas');
    cv.width = width;
    cv.height = Math.round(width * ratio);
    const g = cv.getContext('2d')!;
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, cv.width, cv.height);
    g.drawImage(img, 0, 0, cv.width, cv.height);
    const blob: Blob = await new Promise((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error('Could not encode a sheet.'))), 'image/png'));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  } finally {
    URL.revokeObjectURL(url);
  }
}
