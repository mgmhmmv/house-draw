/**
 * Printing sheets with the title-block sidebar: capture what a sheet draws, fill in the title
 * block from the project, studio and billing, and compose A3 pages.
 */
import type { BuildingProject } from '../../model/types';
import type { Project } from '../lib/api';
import { billing } from '../lib/islepos';
import { getStudio, DEFAULT_NOTES } from '../lib/studio';
import { nextPaint, setPrintMode } from '../drawing/printMode';
import { composeSheet, type LegendKind, type SheetContent, type SheetInfo, type Stage } from '../../export/sheet';

const SHEET_META: Record<string, { title: string; discipline: string; legend: LegendKind[]; north: boolean }> = {
  'A-101': { title: 'Floor plan', discipline: 'Architectural', legend: ['wall', 'door', 'window', 'room'], north: true },
  '3D-VIEW': { title: '3D view', discipline: 'Architectural', legend: [], north: false },
  'A-201': { title: 'Elevations', discipline: 'Architectural', legend: [], north: false },
  'A-301': { title: 'Sections', discipline: 'Architectural', legend: ['wall'], north: false },
  'S-101': { title: 'Structural plan', discipline: 'Structural', legend: ['wall', 'column', 'grid'], north: true },
  'M-101': { title: 'Services layout', discipline: 'MEP', legend: ['wall', 'power', 'lighting', 'water', 'drain', 'hvac'], north: true },
  'H-101': { title: 'HVAC & cooling', discipline: 'Mechanical', legend: ['hvac'], north: false },
  'E-101': { title: 'Electrical single-line', discipline: 'Electrical', legend: ['power', 'lighting', 'solar'], north: false },
  'P-101': { title: 'Plumbing riser', discipline: 'Plumbing', legend: ['water', 'drain'], north: false },
};

/** Sheets that have a drawing worth printing, in set order. */
export const PRINTABLE = ['A-101', 'A-201', 'A-301', 'S-101', 'M-101', 'E-101', 'P-101', '3D-VIEW'];

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
  const meta = SHEET_META[c.sheetId] ?? { title: c.sheetCode, discipline: 'Architectural', legend: [], north: false };
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
    subtitle: c.sheetId === 'A-101' || c.sheetId === 'S-101' || c.sheetId === 'M-101' ? c.levelName : undefined,
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
    legend: meta.legend,
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

/** All sheets for the current view: the paper view's pages, or one composed sheet. */
export async function composePages(c: SheetContext): Promise<string[]> {
  if (c.sheetId === 'A-201' || c.sheetId === 'A-301') {
    const shown = paperSheets();
    if (shown.length) return shown;
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
