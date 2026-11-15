/**
 * Printing sheets with the title-block sidebar: capture what a sheet draws, fill in the title
 * block from the project, studio and billing, and compose A3 pages.
 */
import type { BuildingProject } from '../../model/types';
import type { Project } from '../lib/api';
import { billing } from '../lib/islepos';
import { getStudio, DEFAULT_NOTES } from '../lib/studio';
import { nextPaint, setPrintMode } from '../drawing/printMode';
import { composeSheet, type LegendEntry, type SheetContent, type SheetInfo, type Stage } from '../../export/sheet';
import { MEP_COLOR } from '../drawing/style';
import { sewerLayout } from '../drawing/plan/sheetPlans';
import { getSolarConfig, getRoofDrainageConfig } from '../../model/types';

const SHEET_META: Record<string, { title: string; discipline: string; north: boolean }> = {
  'A-101': { title: 'Floor plan', discipline: 'Architectural', north: true },
  '3D-VIEW': { title: '3D view', discipline: 'Architectural', north: false },
  'A-201': { title: 'Elevations', discipline: 'Architectural', north: false },
  'A-301': { title: 'Sections', discipline: 'Architectural', north: false },
  'S-101': { title: 'Structural plan', discipline: 'Structural', north: true },
  'R-101': { title: 'Roof plan', discipline: 'Architectural', north: true },
  'M-101': { title: 'Water & electrical plan', discipline: 'MEP', north: true },
  'D-101': { title: 'Sewage plan', discipline: 'Plumbing', north: true },
  'H-101': { title: 'HVAC & cooling', discipline: 'Mechanical', north: false },
  'E-101': { title: 'Electrical single-line', discipline: 'Electrical', north: false },
  'P-101': { title: 'Plumbing riser', discipline: 'Plumbing', north: false },
};

/** What each services symbol on the water & electrical plan stands for. */
const MEP_KEY: Record<string, { tag?: string; sym?: LegendEntry['sym']; color: string; label: string }> = {
  mdb: { tag: 'DB', color: MEP_COLOR.power, label: 'Main distribution board' },
  sub_db: { tag: 'SDB', color: MEP_COLOR.power, label: 'Sub-distribution board' },
  utility_meter: { tag: 'M', color: MEP_COLOR.power, label: 'Utility electricity meter' },
  light_ceiling: { sym: 'light', color: MEP_COLOR.lighting, label: 'Ceiling light point' },
  switch_1g: { tag: 'S', color: MEP_COLOR.lighting, label: 'Light switch' },
  outlet_duplex: { sym: 'outlet', color: MEP_COLOR.power, label: 'Twin power socket outlet' },
  ac_split: { tag: 'AC', color: MEP_COLOR.hvac, label: 'Split air-conditioner, indoor unit' },
  ac_condenser: { tag: 'CU', color: MEP_COLOR.hvac, label: 'Air-conditioner condenser (outdoor unit)' },
  ceiling_fan: { tag: 'F', color: MEP_COLOR.hvac, label: 'Ceiling fan' },
  water_main: { tag: 'WM', color: MEP_COLOR.plumbingCold, label: 'Water main / meter connection' },
  water_heater: { tag: 'WH', color: MEP_COLOR.plumbingHot, label: 'Water heater' },
  plumb_wc: { tag: 'WC', color: MEP_COLOR.drain, label: 'WC, cold water supply' },
  plumb_basin: { tag: 'B', color: MEP_COLOR.plumbingCold, label: 'Wash basin' },
  plumb_sink: { tag: 'K', color: MEP_COLOR.plumbingCold, label: 'Kitchen sink' },
  plumb_shower: { tag: 'SH', color: MEP_COLOR.plumbingCold, label: 'Shower' },
  solar_pv: { tag: 'PV', color: MEP_COLOR.solar, label: 'Solar PV array (on roof)' },
  solar_inv: { tag: 'INV', color: MEP_COLOR.solar, label: 'Solar inverter' },
  solar_bess: { tag: 'BAT', color: MEP_COLOR.solar, label: 'Battery storage' },
};
const CIRCUIT_KEY: Record<string, LegendEntry> = {
  electrical_submain: { sym: 'line', color: MEP_COLOR.power, label: 'Sub-main cable', weight: 0.5 },
  electrical_power: { sym: 'line', color: MEP_COLOR.power, label: 'Power circuit (concealed, routed on site)' },
  electrical_light: { sym: 'line', color: MEP_COLOR.lighting, dash: '1.4 0.8', label: 'Lighting circuit' },
  electrical_hvac: { sym: 'line', color: MEP_COLOR.hvac, dash: '0.6 0.8', label: 'Air-conditioning power circuit' },
  plumbing_cold: { sym: 'line', color: MEP_COLOR.plumbingCold, label: 'Cold water pipe, Ø25 PPR PN20' },
  plumbing_hot: { sym: 'line', color: MEP_COLOR.plumbingHot, label: 'Hot water pipe, PPR PN20 insulated' },
};

/** The legend for a sheet: every symbol and reference on it, and what it means. */
export function legendFor(sheetId: string, model: BuildingProject, levelIndex = 0): LegendEntry[] {
  const level = model.levels[levelIndex] ?? model.levels[0];
  const dims: LegendEntry = { sym: 'dim', label: 'Dimension in millimetres, between wall faces / grid' };
  switch (sheetId) {
    case 'A-101': {
      const out: LegendEntry[] = [
        { sym: 'wall', label: 'Wall, cut at window height (poché)' },
        { sym: 'door', label: 'Door and its swing' },
        { sym: 'window', label: 'Window' },
        { sym: 'ring', color: '#1A1917', tag: 'D1', label: 'Door mark (see door schedule)' },
        { sym: 'mark', tag: 'W1', label: 'Window mark (see window schedule)' },
        { sym: 'room', label: 'Room name and floor area (m²)' },
        dims,
      ];
      if (level.columns.length) out.push({ sym: 'column', label: 'Reinforced concrete column' });
      if (level.mepNodes.some((n) => n.model || n.kind === 'ac_split' || n.kind === 'ceiling_fan')) out.push({ sym: 'dashed', color: '#8A857D', label: 'Overhead fitting (AC unit, fan, light), dashed' });
      if (model.sections.length) out.push({ sym: 'section', tag: model.sections[0].label?.[0] ?? 'A', label: 'Section line and mark, see sections sheet A-301' });
      return out;
    }
    case 'S-101':
      return [
        { sym: 'wallGrey', label: 'Wall (structure shown in outline)' },
        { sym: 'column', tag: 'C1', label: 'RC column with its mark (see column schedule)' },
        { sym: 'footing', label: 'Pad footing below column, dashed' },
        { sym: 'bubble', tag: 'A', label: 'Structural grid line: letters one way, numbers the other' },
        dims,
      ];
    case 'R-101': {
      const out: LegendEntry[] = [
        { sym: 'ridge', label: 'Ridge and hip lines (capped)' },
        { sym: 'arrow', tag: `${model.roof.pitchDeg}°`, label: 'Roof falls in the direction of the arrow, at the pitch shown' },
        { sym: 'dashed', color: '#8A857D', label: 'External walls below the roof, dashed' },
        { sym: 'datum', tag: 'RIDGE', label: 'Levels in metres above natural ground' },
      ];
      if (getRoofDrainageConfig(model.roof).gutterEnabled && model.roof.type !== 'flat') {
        out.push({ sym: 'line', color: '#57534E', weight: 0.7, label: 'Gutter along the eaves' });
        out.push({ sym: 'ring', color: INK_HEX, tag: 'RWP', label: 'Rainwater pipe Ø100 uPVC, numbered RWP1, RWP2…' });
        out.push({ sym: 'tank', label: 'Rainwater tank / soakaway at the foot of RWP1' });
      }
      if (getSolarConfig(model).enabled) out.push({ sym: 'solar', label: 'Solar PV panel' });
      out.push(dims);
      return out;
    }
    case 'M-101': {
      const out: LegendEntry[] = [];
      const kinds = new Set(level.mepNodes.map((n) => n.kind));
      for (const [k, v] of Object.entries(MEP_KEY)) if (kinds.has(k as never)) out.push(v.sym ? { sym: v.sym, color: v.color, label: v.label } : { sym: 'chip', tag: v.tag, color: v.color, label: v.label });
      const systems = new Set(level.mepCircuits.map((c) => c.system));
      for (const [k, v] of Object.entries(CIRCUIT_KEY)) if (systems.has(k as never)) out.push(v);
      if (!out.length) out.push({ sym: 'text', tag: '—', label: 'No services on this level yet' });
      return out;
    }
    case 'D-101': {
      const lay = sewerLayout(model, level);
      const out: LegendEntry[] = [
        { sym: 'line', color: MEP_COLOR.drain, weight: 0.55, label: 'Soil pipe Ø110 uPVC Class-B, 1:60 min. fall' },
        { sym: 'line', color: MEP_COLOR.drain, weight: 0.35, dash: '1.4 0.8', label: 'Waste pipe Ø50 uPVC from basins, sinks, showers, traps' },
      ];
      const tags: Record<string, string> = { WC: 'WC (water closet)', WHB: 'Wash hand basin', KS: 'Kitchen sink', SHR: 'Shower', FT: 'Floor trap', BATH: 'Bath' };
      for (const tg of [...new Set(lay.fittings.map((f) => f.tag))]) out.push({ sym: 'ring', color: MEP_COLOR.drain, tag: tg, label: tags[tg] ?? tg });
      if (lay.chambers.length) {
        out.push({ sym: 'chamber', label: 'IC: inspection chamber 600×600 (main 900×900), numbered IC1, IC2…' });
        out.push({ sym: 'text', tag: 'IL', label: 'Invert level: depth of pipe bottom below ground (m)' });
      }
      if (lay.stacks.length) out.push({ sym: 'ring', color: MEP_COLOR.drain, tag: 'SVP', label: 'Soil and vent pipe Ø110 down the outside wall to an IC' });
      if (lay.septic) out.push({ sym: 'septic', label: 'Septic tank, two chambers (position indicative)' });
      if (lay.soak) out.push({ sym: 'soak', label: 'Soakaway pit, perforated rings (position indicative)' });
      return out;
    }
    case 'A-201':
      return [
        { sym: 'datum', tag: '+3.000', label: 'Level datum: metres above natural ground' },
        { sym: 'bubble', tag: 'A', label: 'Grid line, matches the plans' },
        { sym: 'mark', tag: 'W1', label: 'Window / door mark (see schedule)' },
        { sym: 'note', tag: 'Finish', label: 'Material and finish callout' },
        { sym: 'dim', tag: '2 700', label: 'Height in millimetres' },
        { sym: 'text', tag: '1:100', label: 'People shown for scale (adult approx. 1.7 m)' },
      ];
    case 'A-301':
      return [
        { sym: 'wall', label: 'Wall cut by the section (solid)' },
        { sym: 'conc', label: 'Reinforced concrete: slab, footing, beam' },
        { sym: 'hardcore', label: 'Compacted hardcore fill under slab' },
        { sym: 'earth', label: 'Natural ground / compacted earth' },
        ...(model.roof.type !== 'flat' ? [{ sym: 'truss', label: 'Roof truss (timber or light-gauge steel)' } as LegendEntry] : []),
        { sym: 'datum', tag: '+0.450', label: 'Level datum: metres above natural ground' },
        { sym: 'note', tag: 'Build-up', label: 'Construction build-up note, top to bottom' },
        { sym: 'dim', tag: '2 700', label: 'Height in millimetres' },
      ];
    case 'E-101':
      return [
        { sym: 'line', color: MEP_COLOR.power, label: 'Power' },
        { sym: 'line', color: MEP_COLOR.lighting, dash: '1.4 0.8', label: 'Lighting' },
        ...(getSolarConfig(model).enabled ? [{ sym: 'line', color: MEP_COLOR.solar, label: 'Solar PV' } as LegendEntry] : []),
      ];
    case 'P-101':
      return [
        { sym: 'line', color: MEP_COLOR.plumbingCold, label: 'Cold water' },
        { sym: 'line', color: MEP_COLOR.plumbingHot, label: 'Hot water' },
        { sym: 'line', color: MEP_COLOR.drain, weight: 0.55, label: 'Soil and waste' },
      ];
    default:
      return [];
  }
}
const INK_HEX = '#1A1917';

/** Sheets that have a drawing worth printing, in set order. */
export const PRINTABLE = ['A-101', 'S-101', 'R-101', 'M-101', 'D-101', 'A-201', 'A-301', 'E-101', 'P-101', '3D-VIEW'];
/** Sheets drawn on paper in the app (plans at true scale, elevations and sections). */
export const PAPER_SHEETS = ['A-101', 'S-101', 'R-101', 'M-101', 'D-101', 'A-201', 'A-301'];
/** Plans with one sheet per level. */
export const PER_LEVEL = ['A-101', 'S-101', 'M-101', 'D-101'];

export const stageFor = (status: string): Stage =>
  status === 'done' ? 'asbuilt' : status === 'handover' ? 'construction' : status === 'drawings' || status === 'review' ? 'approval' : 'concept';

const STAGE_REV: Record<Stage, string> = { concept: 'Preliminary issue', approval: 'Issued for planning approval', construction: 'Issued for construction', asbuilt: 'As-built record' };

const today = () => {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
};

/**
 * What the current sheet draws, taken from the page: plans, elevations and sections are in
 * metres (so they print to scale), diagrams are fitted, and the 3D view is a picture.
 */
export function captureSheet(): SheetContent | null {
  const main = document.querySelector('main');
  if (!main) return null;
  const canvas = main.querySelector('canvas') as HTMLCanvasElement | null;
  const svg = main.querySelector('svg.as-plan') as SVGSVGElement | null;
  if (svg) {
    const world = [...svg.children].find((c) => c.tagName.toLowerCase() === 'g' && /scale\(/.test(c.getAttribute('transform') ?? '')) as SVGGElement | undefined;
    if (world) {
      const b = world.getBBox();
      const pad = Math.max(b.width, b.height) * 0.03;
      const clone = world.cloneNode(true) as SVGGElement;
      // Things hidden by the app's CSS (hover states and the like) stay hidden on paper.
      const src = [world, ...world.querySelectorAll('*')];
      const dst = [clone, ...clone.querySelectorAll('*')];
      src.forEach((el, i) => {
        const cs = getComputedStyle(el);
        if (i && (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0')) dst[i].setAttribute('display', 'none');
      });
      clone.querySelectorAll('[data-rotate]').forEach((el) => el.parentElement?.remove());
      return {
        inner: clone.innerHTML,
        defs: svg.querySelector('defs')?.innerHTML,
        vb: [b.x - pad, b.y - pad, b.width + pad * 2, b.height + pad * 2],
        metres: true,
        fixedStrokes: true,
      };
    }
  }
  const diagram = main.querySelector('svg[role="img"]') as SVGSVGElement | null;
  if (diagram) {
    const vb = diagram.viewBox.baseVal;
    return { inner: diagram.innerHTML, vb: [vb.x, vb.y, vb.width || diagram.clientWidth, vb.height || diagram.clientHeight], metres: false };
  }
  if (canvas) {
    const url = canvas.toDataURL('image/png');
    return { inner: `<image href="${url}" x="0" y="0" width="${canvas.width}" height="${canvas.height}"/>`, vb: [0, 0, canvas.width, canvas.height], metres: false };
  }
  return null;
}

export interface SheetContext {
  project: Project;
  model: BuildingProject;
  sheetId: string;
  sheetCode: string;
  levelName?: string;
  levelIndex?: number;
  sheetOf?: string;
}

/** Everything the title block needs, from the project, the studio profile and billing. */
export async function sheetInfo(c: SheetContext): Promise<SheetInfo> {
  const studio = await getStudio();
  const meta = SHEET_META[c.sheetId] ?? { title: c.sheetCode, discipline: 'Architectural', north: false };
  let quotation = '';
  try {
    const b = await billing.get(c.project.id);
    quotation = b.documents.filter((d) => d.kind === 'quote').sort((a, z) => z.created_at - a.created_at)[0]?.number ?? '';
  } catch {
    /* billing not connected */
  }
  const stage = stageFor(c.project.status);
  const code = c.model.meta.projectCode && !/^archstudio$/i.test(c.model.meta.projectCode) ? c.model.meta.projectCode : c.project.id.replace(/\D/g, '').slice(0, 5) || c.project.id.slice(0, 5).toUpperCase();
  const prefix = (studio.prefix || studio.studioName.split(/\s+/).map((w) => w[0]).join('') || 'AS').toUpperCase().slice(0, 4);
  const lvl = c.levelIndex !== undefined && c.levelIndex > 0 ? `.${c.levelIndex}` : '';
  const rev = /^[A-Z]?\d+$/i.test(c.model.meta.revision ?? '') ? c.model.meta.revision.toUpperCase() : stage === 'concept' || stage === 'approval' ? 'P1' : 'C1';
  const studioLines = [
    [studio.legalName, studio.regNo && `Reg. ${studio.regNo}`, studio.tin && `GST TIN ${studio.tin}`].filter(Boolean).join(' · '),
    studio.address,
    [studio.phone, studio.email].filter(Boolean).join(' · '),
  ].filter(Boolean);
  return {
    title: meta.title,
    subtitle: PER_LEVEL.includes(c.sheetId) ? c.levelName : undefined,
    discipline: meta.discipline,
    sheetCode: c.sheetCode,
    drawingNumber: `${prefix}-${code}-${c.sheetCode.replace('-', '')}${lvl}`,
    revision: rev,
    revisions: [{ rev, desc: STAGE_REV[stage], date: today() }],
    stage,
    notes: (studio.notes || DEFAULT_NOTES).split('\n').map((s) => s.trim()).filter(Boolean),
    studio: { name: studio.studioName, lines: studioLines },
    client: { name: c.project.client || c.model.meta.client, lines: [c.model.meta.clientPhone ?? ''].filter(Boolean) },
    project: { name: c.project.name, lines: [c.project.location || c.model.meta.location].filter(Boolean) },
    drawn: studio.drawnBy,
    checked: studio.checkedBy,
    date: today(),
    projectRef: code,
    quotation,
    sheetOf: c.sheetOf ?? '',
    legend: legendFor(c.sheetId, c.model, c.levelIndex ?? 0),
    north: meta.north,
  };
}

/** The sheets shown in the paper view (each already A3 with its title block), if showing. */
export function paperSheets(): string[] {
  const svg = document.querySelector('main svg[data-paper]') as SVGSVGElement | null;
  if (!svg) return [];
  const defs = svg.querySelector('defs')?.innerHTML ?? '';
  return [...svg.querySelectorAll('[data-paper-page]')].map(
    (pg) =>
      `<svg xmlns="http://www.w3.org/2000/svg" width="420mm" height="297mm" viewBox="0 0 420 297" font-family="Inter, Helvetica, Arial, sans-serif"><style>.as-w * { vector-effect: non-scaling-stroke; }</style><defs>${defs}</defs>${pg.innerHTML}</svg>`
  );
}

/** Number a set of composed sheets "1 of n" in the title block's Sheet box. */
export function numberSheets(svgs: string[]) {
  return svgs.map((svg, i) => svg.replace(/(>SHEET<\/text><text[^>]*>)[^<]*(<\/text>)/, `$1${i + 1} of ${svgs.length}$2`));
}

/** All sheets for the current view: the paper view's pages, or one composed sheet. */
export async function composePages(c: SheetContext): Promise<string[]> {
  if (PAPER_SHEETS.includes(c.sheetId)) {
    // Print mode lays every drawing out on paper (each elevation/section on its own sheet);
    // read the sheets, then go back. The title block loads with the sheet, so allow it a moment.
    const want = (await sheetInfo(c)).drawingNumber;
    setPrintMode(true);
    try {
      for (let i = 0; i < 40; i++) {
        await nextPaint();
        if (document.querySelector('main svg[data-paper]')?.getAttribute('data-paper') === want) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      await nextPaint();
      const shown = paperSheets();
      if (shown.length) return shown;
    } finally {
      setPrintMode(false);
    }
  }
  return [await composeCurrent(c)];
}

export async function composeCurrent(c: SheetContext) {
  setPrintMode(true);
  await nextPaint();
  let content: SheetContent | null;
  try {
    content = captureSheet();
  } finally {
    setPrintMode(false);
  }
  const info = await sheetInfo(c);
  return composeSheet(content, info).svg;
}
