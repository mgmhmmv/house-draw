/**
 * Printed drawing sheets: A3 landscape with the drawing on the left and a title-block sidebar on
 * the right, the way drawings are issued in the Maldives (notes, revisions, studio, client,
 * project, title, design stage, drawn/checked, references, drawing number, status).
 * Everything is in millimetres on the paper; drawings are placed at a true scale where they
 * are measured in metres.
 */

export const PAPER = { w: 420, h: 297, name: 'A3' } as const;
const M = 10; // outer margin
const SIDE = 80; // sidebar width
const SX = PAPER.w - M - SIDE; // sidebar left edge
const HEAD = 11; // title strip
const FOOT = 13; // scale + legend strip
const INK = '#14161A';
const INK2 = '#4A4F57';
const INK3 = '#8B9098';
const RULE = '#C9CDD3';
const FONT = 'Inter, Helvetica, Arial, sans-serif';

export type Stage = 'concept' | 'approval' | 'construction' | 'asbuilt';
export const STAGES: { id: Stage; label: string }[] = [
  { id: 'concept', label: 'CONCEPT / QUOTATION' },
  { id: 'approval', label: 'PLANNING APPROVAL' },
  { id: 'construction', label: 'CONSTRUCTION' },
  { id: 'asbuilt', label: 'AS-BUILT' },
];

/** A symbol in a sheet's key; most draw like the thing on the drawing. */
export type LegendSym =
  | 'wall' | 'wallGrey' | 'door' | 'window' | 'room' | 'mark' | 'dim' | 'section' | 'bubble' | 'dashed' | 'column' | 'footing'
  | 'line' | 'chip' | 'ring' | 'light' | 'outlet' | 'chamber' | 'septic' | 'soak' | 'tank' | 'arrow' | 'ridge' | 'solar'
  | 'datum' | 'note' | 'block' | 'conc' | 'hardcore' | 'earth' | 'truss' | 'text';

/** One line of a sheet's legend: the symbol as drawn, and what it means. */
export interface LegendEntry {
  sym: LegendSym;
  label: string;
  /** Letters drawn in the symbol (D1, WC, IC, A). */
  tag?: string;
  color?: string;
  /** Dashed line style for `line`. */
  dash?: string;
  /** Line weight (mm) for `line`. */
  weight?: number;
}

export interface SheetInfo {
  title: string; // FLOOR PLAN
  subtitle?: string; // Ground floor
  discipline: string; // Architectural
  sheetCode: string; // A-101
  drawingNumber: string;
  revision: string;
  revisions: { rev: string; desc: string; date: string }[];
  stage: Stage;
  notes: string[];
  studio: { name: string; lines: string[] };
  client: { name: string; lines: string[] };
  project: { name: string; lines: string[] };
  drawn: string;
  checked: string;
  date: string;
  projectRef: string;
  quotation: string;
  sheetOf: string; // 1 of 9
  legend: LegendEntry[];
  north: boolean;
}

/** The drawing to place: markup in its own units, its extent, and how to scale it. */
export interface SheetContent {
  inner: string;
  defs?: string;
  vb: [number, number, number, number];
  /** Drawing units are metres: place at the best true scale. Otherwise fit to the area. */
  metres: boolean;
  /** Line weights are fixed widths (as on screen), not scaled with the drawing. */
  fixedStrokes?: boolean;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Rough line wrap by character count (sidebar text is small and short). */
function wrap(text: string, chars: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      if ((line + ' ' + word).trim().length > chars && line) {
        out.push(line);
        line = word;
      } else line = (line + ' ' + word).trim();
    }
    if (line) out.push(line);
  }
  return out;
}

const t = (x: number, y: number, s: string, size: number, o: { w?: number; c?: string; a?: 'start' | 'middle' | 'end'; ls?: number } = {}) =>
  `<text x="${x}" y="${y}" font-size="${size}" font-weight="${o.w ?? 400}" fill="${o.c ?? INK}" text-anchor="${o.a ?? 'start'}"${o.ls ? ` letter-spacing="${o.ls}"` : ''}>${esc(s)}</text>`;
const label = (x: number, y: number, s: string) => t(x, y, s.toUpperCase(), 1.75, { w: 700, c: INK3, ls: 0.25 });
const hline = (y: number, x0 = SX, x1 = PAPER.w - M) => `<line x1="${x0}" y1="${y}" x2="${x1}" y2="${y}" stroke="${INK}" stroke-width="0.35"/>`;

/** Scales a sheet can be printed at. */
const SCALES = [20, 25, 50, 75, 100, 125, 150, 200, 250, 500, 1000];

export function chooseScale(widthM: number, heightM: number, areaW: number, areaH: number) {
  const need = Math.max((widthM * 1000) / areaW, (heightM * 1000) / areaH);
  return SCALES.find((s) => s >= need) ?? 1000;
}

/** Where the drawing goes on the sheet (mm). */
export const DRAWING_AREA = { x: M + 4, y: M + HEAD + 4, w: SX - M - 8, h: PAPER.h - 2 * M - HEAD - FOOT - 8 };

const KEY_ROW = 4.4;
const KEY_W = 74;
const keyLines = (e: LegendEntry) => wrap(e.label, 44).length;
/** Size of the legend box for these entries (mm), or null if there are none. */
export function keySize(entries: LegendEntry[]) {
  if (!entries.length) return null;
  const rows = entries.reduce((n, e) => n + Math.max(1, keyLines(e) * 0.72), 0);
  return { w: KEY_W, h: 8 + rows * KEY_ROW + 1.5 };
}

export interface Placement {
  scale: number;
  /** mm per drawing unit (metre). */
  m: number;
  /** Translation that puts the drawing (in metres) on the sheet. */
  x0: number;
  y0: number;
  key: { x: number; y: number; w: number; h: number } | null;
}

/**
 * Place a drawing (extent in metres) at a true scale with its legend beside it, never over it:
 * centred with the key in a free corner, or shifted aside to make room, or the next scale down.
 */
export function placeDrawing(e: { minX: number; minY: number; maxX: number; maxY: number }, entries: LegendEntry[], minScale = 1): Placement {
  const A = DRAWING_AREA;
  const k = keySize(entries);
  const W = e.maxX - e.minX;
  const H = e.maxY - e.minY;
  const gap = 5;
  for (const scale of SCALES) {
    if (scale < minScale) continue;
    const m = 1000 / scale;
    const dw = W * m;
    const dh = H * m;
    if (dw > A.w || dh > A.h) continue;
    const at = (x: number, y: number, key: Placement['key']): Placement => ({ scale, m, x0: x - e.minX * m, y0: y - e.minY * m, key });
    const cx = A.x + (A.w - dw) / 2;
    const cy = A.y + (A.h - dh) / 2;
    if (!k) return at(cx, cy, null);
    if (k.h > A.h) continue;
    // Centred, key in a corner clear of the drawing.
    const corners = [
      { x: A.x + A.w - k.w, y: A.y + A.h - k.h },
      { x: A.x + A.w - k.w, y: A.y },
      { x: A.x, y: A.y + A.h - k.h },
      { x: A.x, y: A.y },
    ];
    const clear = (c: { x: number; y: number }, x: number, y: number) => c.x >= x + dw + gap || c.x + k.w <= x - gap || c.y >= y + dh + gap || c.y + k.h <= y - gap;
    const free = corners.find((c) => clear(c, cx, cy));
    if (free) return at(cx, cy, { ...free, ...k });
    // Drawing to the left, key on the right.
    if (A.w - dw >= k.w + gap) return at(A.x + (A.w - k.w - gap - dw) / 2, cy, { x: A.x + A.w - k.w, y: A.y + A.h - k.h, ...k });
    // Drawing above, key below.
    if (A.h - dh >= k.h + gap) return at(cx, A.y + (A.h - k.h - gap - dh) / 2, { x: A.x + A.w - k.w, y: A.y + A.h - k.h, ...k });
  }
  const scale = SCALES[SCALES.length - 1];
  return { scale, m: 1000 / scale, x0: A.x - e.minX * (1000 / scale), y0: A.y - e.minY * (1000 / scale), key: null };
}

/** The legend box: every symbol on the sheet and what it refers to. */
export function drawKey(entries: LegendEntry[], box: { x: number; y: number; w: number; h: number }) {
  const parts: string[] = [];
  parts.push(`<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" fill="#fff" stroke="${INK}" stroke-width="0.3"/>`);
  parts.push(`<rect x="${box.x}" y="${box.y}" width="${box.w}" height="6" fill="#F1F2F4" stroke="${INK}" stroke-width="0.3"/>`);
  parts.push(t(box.x + 3, box.y + 4.1, 'LEGEND & REFERENCES', 2.1, { w: 700, ls: 0.2 }));
  let y = box.y + 8;
  for (const e of entries) {
    const lines = wrap(e.label, 44);
    const h = Math.max(1, lines.length * 0.72) * KEY_ROW;
    const cy = y + h / 2;
    parts.push(legendSymbol(e, box.x + 3, cy));
    lines.forEach((ln, i) => parts.push(t(box.x + 17, cy + 0.7 - ((lines.length - 1) * 3.1) / 2 + i * 3.1, ln, 2.0, { c: INK2 })));
    y += h;
  }
  return parts.join('');
}

/**
 * Compose one A3 sheet as an SVG document (mm units). With no content, `opts.scale` still sets
 * the scale bar and title block (the live paper view draws the drawing itself).
 */
export function composeSheet(content: SheetContent | null, info: SheetInfo, opts: { scale?: number; footerBar?: boolean; key?: Placement['key'] } = {}): { svg: string; scale: number | null } {
  const parts: string[] = [];
  const area = DRAWING_AREA;

  // Frame, drawing area rules.
  parts.push(`<rect x="0" y="0" width="${PAPER.w}" height="${PAPER.h}" fill="#FFFFFF"/>`);
  parts.push(`<rect x="${M}" y="${M}" width="${PAPER.w - 2 * M}" height="${PAPER.h - 2 * M}" fill="none" stroke="${INK}" stroke-width="0.5"/>`);
  parts.push(`<line x1="${SX}" y1="${M}" x2="${SX}" y2="${PAPER.h - M}" stroke="${INK}" stroke-width="0.5"/>`);
  parts.push(`<line x1="${M}" y1="${M + HEAD}" x2="${SX}" y2="${M + HEAD}" stroke="${RULE}" stroke-width="0.25"/>`);
  parts.push(`<line x1="${M}" y1="${PAPER.h - M - FOOT}" x2="${SX}" y2="${PAPER.h - M - FOOT}" stroke="${RULE}" stroke-width="0.25"/>`);

  // Title strip.
  parts.push(t(M + 5, M + 7.4, info.title.toUpperCase(), 4.2, { w: 700, ls: 0.15 }));
  if (info.subtitle) parts.push(t(M + 5 + info.title.length * 2.75 + 4, M + 7.2, info.subtitle, 2.6, { c: INK2 }));

  // The drawing.
  let scale: number | null = opts.scale ?? null;
  let key = opts.key ?? null;
  if (content) {
    const [vx, vy, vw, vh] = content.vb;
    let w = area.w;
    let h = area.h;
    let x: number;
    let y: number;
    if (content.metres) {
      const pl = placeDrawing({ minX: vx, minY: vy, maxX: vx + vw, maxY: vy + vh }, info.legend);
      scale = pl.scale;
      w = vw * pl.m;
      h = vh * pl.m;
      x = pl.x0 + vx * pl.m;
      y = pl.y0 + vy * pl.m;
      key = pl.key;
    } else {
      // Diagrams fit the area beside the key.
      const ks = keySize(info.legend);
      const aw = ks ? area.w - ks.w - 5 : area.w;
      const k = Math.min(aw / vw, area.h / vh);
      w = vw * k;
      h = vh * k;
      x = area.x + (aw - w) / 2;
      y = area.y + (area.h - h) / 2;
      if (ks) key = { x: area.x + area.w - ks.w, y: area.y + area.h - ks.h, ...ks };
    }
    parts.push(
      `<svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="${vx} ${vy} ${vw} ${vh}" overflow="visible" preserveAspectRatio="xMidYMid meet">${content.fixedStrokes ? '<style>.as-w * { vector-effect: non-scaling-stroke; }</style>' : ''}${content.defs ? `<defs>${content.defs}</defs>` : ''}<g class="as-w">${content.inner}</g></svg>`
    );
  }

  if (key) parts.push(drawKey(info.legend, key));

  // North arrow (plans).
  if (info.north) {
    const cx = SX - 14;
    const cy = M + HEAD + 13;
    parts.push(`<circle cx="${cx}" cy="${cy}" r="6.5" fill="#fff" stroke="${INK}" stroke-width="0.35"/>`);
    parts.push(`<path d="M ${cx} ${cy - 5.2} L ${cx + 2.3} ${cy + 3.6} L ${cx} ${cy + 2.2} L ${cx - 2.3} ${cy + 3.6} Z" fill="${INK}"/>`);
    parts.push(t(cx, cy - 7.6, 'N', 2.8, { w: 700, a: 'middle' }));
  }

  // Footer: scale bar + legend.
  const fy = PAPER.h - M - FOOT / 2 + 1;
  let fx = M + 5;
  if (scale && opts.footerBar === false) {
    // The drawings carry their own scale bars under their titles.
    parts.push(t(fx, fy + 0.4, `Scale 1:${scale} at ${PAPER.name}`, 2.3, { w: 600 }));
    fx += 40;
  } else if (scale) {
    const nice = [1, 2, 5, 10, 20, 50, 100].find((m) => (m * 1000) / scale! >= 30) ?? 100;
    const len = (nice * 1000) / scale;
    for (let i = 0; i < 4; i++) parts.push(`<rect x="${fx + (len / 4) * i}" y="${fy - 1}" width="${len / 4}" height="1.4" fill="${i % 2 ? '#fff' : INK}" stroke="${INK}" stroke-width="0.2"/>`);
    parts.push(t(fx, fy - 2.2, '0', 1.8, { c: INK2 }));
    parts.push(t(fx + len, fy - 2.2, `${nice} m`, 1.8, { c: INK2, a: 'end' }));
    parts.push(t(fx + len + 4, fy + 0.4, `Scale 1:${scale} at ${PAPER.name}`, 2.3, { w: 600 }));
    fx += len + 36;
  } else {
    parts.push(t(fx, fy + 0.4, 'Not to scale', 2.3, { w: 600 }));
    fx += 26;
  }
  parts.push(t(fx, fy + 0.4, 'Dimensions in millimetres · levels in metres above natural ground · do not scale; use figured dimensions', 2.0, { c: INK2 }));

  // ── Sidebar ─────────────────────────────────────────────────────────
  const L = SX + 4;
  const R = PAPER.w - M - 4;
  let y = M;

  // General notes
  y += 5.5;
  parts.push(label(L, y, 'General notes'));
  y += 3.6;
  info.notes.slice(0, 6).forEach((n, i) => {
    const lines = wrap(n, 58);
    parts.push(t(L, y, `${i + 1}.`, 1.95, { w: 700 }));
    lines.forEach((ln, j) => parts.push(t(L + 3.5, y + j * 2.6, ln, 1.95, { c: INK2 })));
    y += lines.length * 2.6 + 0.8;
  });
  y += 1.6;
  parts.push(hline(y));

  // Revisions
  y += 3;
  const cols = [L, L + 9, R - 18];
  parts.push(`<rect x="${L - 1}" y="${y - 0.4}" width="${R - L + 2}" height="3.8" fill="#F1F2F4" stroke="${RULE}" stroke-width="0.2"/>`);
  parts.push(label(cols[0], y + 2.5, 'Rev') + label(cols[1], y + 2.5, 'Description') + label(cols[2], y + 2.5, 'Date'));
  y += 3.4;
  const revs = [...info.revisions.slice(-3)];
  while (revs.length < 3) revs.push({ rev: '', desc: '', date: '' });
  for (const r of revs) {
    parts.push(`<rect x="${L - 1}" y="${y}" width="${R - L + 2}" height="3.8" fill="none" stroke="${RULE}" stroke-width="0.2"/>`);
    parts.push(t(cols[0], y + 2.7, r.rev, 2.0) + t(cols[1], y + 2.7, r.desc.slice(0, 40), 2.0) + t(cols[2], y + 2.7, r.date, 2.0));
    y += 3.8;
  }
  y += 2.4;
  parts.push(hline(y));

  // Studio
  const studioTop = y;
  y += 9;
  parts.push(t((L + R) / 2, y, info.studio.name || 'Your studio', 3.2, { w: 700, a: 'middle' }));
  info.studio.lines.slice(0, 4).forEach((ln) => {
    y += 2.6;
    parts.push(t((L + R) / 2, y, ln, 1.85, { c: INK2, a: 'middle' }));
  });
  y = Math.max(y + 4, studioTop + 24);
  parts.push(hline(y));

  // Client
  y += 4;
  parts.push(label(L, y, 'Client'));
  y += 3.6;
  parts.push(t(L, y, info.client.name || '—', 2.8, { w: 600 }));
  info.client.lines.slice(0, 2).forEach((ln) => {
    y += 2.7;
    parts.push(t(L, y, ln, 2.0, { c: INK2 }));
  });
  y += 3.4;
  parts.push(hline(y));

  // Project
  y += 4;
  parts.push(label(L, y, 'Project'));
  y += 3.8;
  wrap(info.project.name.toUpperCase(), 34).slice(0, 2).forEach((ln, i) => parts.push(t(L, y + i * 3.4, ln, 2.9, { w: 700 })));
  y += wrap(info.project.name, 34).slice(0, 2).length * 3.4 - 0.6;
  info.project.lines.slice(0, 2).forEach((ln) => {
    y += 2.7;
    parts.push(t(L, y, ln, 2.0, { c: INK2 }));
  });
  y += 3.4;
  parts.push(hline(y));

  // Title
  y += 4;
  parts.push(label(L, y, 'Title'));
  y += 5.2;
  parts.push(t(L, y, info.title.toUpperCase(), 4.4, { w: 700 }));
  if (info.subtitle) {
    y += 3.2;
    parts.push(t(L, y, info.subtitle, 2.2, { c: INK2 }));
  }
  y += 3.4;
  parts.push(hline(y));

  // Design stage
  y += 4;
  parts.push(label(L, y, 'Design stage'));
  for (const s of STAGES) {
    y += 3.1;
    const on = s.id === info.stage;
    parts.push(`<circle cx="${L + 1.1}" cy="${y - 0.75}" r="1" fill="${on ? INK : '#fff'}" stroke="${INK}" stroke-width="0.25"/>`);
    parts.push(t(L + 3.2, y, s.label, 2.0, { w: on ? 700 : 400, c: on ? INK : INK2 }));
  }
  y += 2.6;
  parts.push(hline(y));

  // Reference grid (3 rows × 3 cells), then drawing number, then status.
  const bottom = PAPER.h - M;
  const status = info.stage === 'construction' ? { text: 'ISSUED FOR CONSTRUCTION', fill: '#E7F5EC', ink: '#1E7A43' } : info.stage === 'asbuilt' ? { text: 'AS-BUILT RECORD', fill: '#EEF1F6', ink: '#33415C' } : { text: 'PRELIMINARY — NOT FOR CONSTRUCTION', fill: '#FDF0E7', ink: '#C2410C' };
  const statusH = 7;
  const numberH = 13;
  const cellH = 7.2;
  const gridTop = bottom - statusH - numberH - cellH * 3;
  // Fill any slack above the grid (sidebar grows with long notes; it never overlaps).
  const gy = Math.max(gridTop, y);
  const cw = (PAPER.w - M - SX) / 3;
  const cells: [string, string][] = [
    ['Drawn', info.drawn || '—'],
    ['Checked', info.checked || '—'],
    ['Date', info.date],
    ['Project ref', info.projectRef || '—'],
    ['Quotation', info.quotation || '—'],
    ['Sheet size', PAPER.name],
    ['Scale', scale ? `1:${scale}` : 'NTS'],
    ['Sheet', info.sheetOf || '—'],
    ['Discipline', info.discipline],
  ];
  cells.forEach(([k, v], i) => {
    const cx = SX + (i % 3) * cw;
    const cy = gy + Math.floor(i / 3) * cellH;
    parts.push(`<rect x="${cx}" y="${cy}" width="${cw}" height="${cellH}" fill="none" stroke="${INK}" stroke-width="0.25"/>`);
    parts.push(label(cx + 2, cy + 2.6, k));
    parts.push(t(cx + 2, cy + 5.8, v.slice(0, 18), 2.4, { w: 700 }));
  });
  const ny = gy + cellH * 3;
  parts.push(`<rect x="${SX}" y="${ny}" width="${SIDE}" height="${numberH}" fill="none" stroke="${INK}" stroke-width="0.35"/>`);
  parts.push(`<line x1="${PAPER.w - M - 18}" y1="${ny}" x2="${PAPER.w - M - 18}" y2="${ny + numberH}" stroke="${INK}" stroke-width="0.25"/>`);
  parts.push(label(L, ny + 3, 'Drawing number'));
  parts.push(t(L, ny + 10.4, info.drawingNumber, info.drawingNumber.length > 16 ? 4.2 : 5.4, { w: 800 }));
  parts.push(label(PAPER.w - M - 16, ny + 3, 'Revision'));
  parts.push(t(PAPER.w - M - 9, ny + 10.4, info.revision, 5.4, { w: 800, a: 'middle' }));
  const sy = ny + numberH;
  parts.push(`<rect x="${SX}" y="${sy}" width="${SIDE}" height="${bottom - sy}" fill="${status.fill}" stroke="${INK}" stroke-width="0.35"/>`);
  parts.push(t(SX + SIDE / 2, sy + (bottom - sy) / 2 + 0.9, status.text, 2.5, { w: 800, c: status.ink, a: 'middle', ls: 0.15 }));

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${PAPER.w}mm" height="${PAPER.h}mm" viewBox="0 0 ${PAPER.w} ${PAPER.h}" font-family="${FONT}">${parts.join('')}</svg>`;
  return { svg, scale };
}

function legendSymbol(e: LegendEntry, x: number, y: number) {
  const c = e.color ?? INK;
  const tag = (tx: number, size = 1.8, col = INK, w = 700) => (e.tag ? t(tx, y + size * 0.36, e.tag, size, { w, c: col, a: 'middle' }) : '');
  const mid = x + 6;
  switch (e.sym) {
    case 'wall':
      return `<rect x="${x}" y="${y - 0.9}" width="12" height="1.8" fill="${INK}"/>`;
    case 'wallGrey':
      return `<rect x="${x}" y="${y - 0.9}" width="12" height="1.8" fill="#E4E1DA" stroke="${INK2}" stroke-width="0.2"/>`;
    case 'door':
      return `<rect x="${x}" y="${y + 0.6}" width="2" height="1.2" fill="${INK}"/><rect x="${x + 10}" y="${y + 0.6}" width="2" height="1.2" fill="${INK}"/><line x1="${x + 2}" y1="${y + 1.2}" x2="${x + 2}" y2="${y - 6.8 + 6}" stroke="${INK}" stroke-width="0.35"/><path d="M${x + 2} ${y - 0.8} A8 8 0 0 1 ${x + 10} ${y + 1.2}" fill="none" stroke="${INK2}" stroke-width="0.15"/>`;
    case 'window':
      return `<rect x="${x}" y="${y - 0.9}" width="2" height="1.8" fill="${INK}"/><rect x="${x + 10}" y="${y - 0.9}" width="2" height="1.8" fill="${INK}"/><rect x="${x + 2}" y="${y - 0.9}" width="8" height="1.8" fill="#fff" stroke="${INK}" stroke-width="0.2"/><line x1="${x + 2}" y1="${y}" x2="${x + 10}" y2="${y}" stroke="${INK}" stroke-width="0.15"/>`;
    case 'room':
      return `<rect x="${x}" y="${y - 1.8}" width="12" height="3.6" fill="#F4EEE3"/>${t(mid, y - 0.1, 'Bedroom', 1.3, { w: 700, a: 'middle' })}${t(mid, y + 1.3, '12.5 m²', 1.0, { c: INK3, a: 'middle' })}`;
    case 'mark':
      return `<rect x="${mid - 2.6}" y="${y - 1.3}" width="5.2" height="2.6" rx="0.5" fill="#fff" stroke="${INK}" stroke-width="0.2"/>${tag(mid, 1.5)}`;
    case 'dim':
      return `<line x1="${x}" y1="${y + 0.6}" x2="${x + 12}" y2="${y + 0.6}" stroke="${INK2}" stroke-width="0.15"/><line x1="${x - 0.5}" y1="${y + 1.1}" x2="${x + 0.5}" y2="${y + 0.1}" stroke="${INK}" stroke-width="0.3"/><line x1="${x + 11.5}" y1="${y + 1.1}" x2="${x + 12.5}" y2="${y + 0.1}" stroke="${INK}" stroke-width="0.3"/>${t(mid, y - 0.2, e.tag ?? '3 600', 1.4, { a: 'middle' })}`;
    case 'section':
      return `<line x1="${x}" y1="${y}" x2="${x + 9}" y2="${y}" stroke="${INK}" stroke-width="0.35" stroke-dasharray="2.4 0.8 0.4 0.8"/><circle cx="${x + 10.5}" cy="${y}" r="1.6" fill="#fff" stroke="${INK}" stroke-width="0.25"/>${t(x + 10.5, y + 0.55, e.tag ?? 'A', 1.5, { w: 700, a: 'middle' })}`;
    case 'bubble':
      return `<line x1="${x}" y1="${y}" x2="${x + 8.6}" y2="${y}" stroke="${INK2}" stroke-width="0.15" stroke-dasharray="2 0.6 0.4 0.6"/><circle cx="${x + 10.4}" cy="${y}" r="1.8" fill="#fff" stroke="${INK}" stroke-width="0.25"/>${t(x + 10.4, y + 0.6, e.tag ?? 'A', 1.6, { w: 700, a: 'middle' })}`;
    case 'dashed':
      return `<rect x="${x + 1}" y="${y - 1.5}" width="10" height="3" fill="none" stroke="${c}" stroke-width="0.2" stroke-dasharray="1 0.6"/>`;
    case 'column':
      return `<rect x="${mid - 1.3}" y="${y - 1.3}" width="2.6" height="2.6" fill="${INK}"/>${e.tag ? t(mid + 2.2, y - 1.2, e.tag, 1.4, { w: 600, c: INK2 }) : ''}`;
    case 'footing':
      return `<rect x="${mid - 2.6}" y="${y - 2.2}" width="5.2" height="4.4" fill="none" stroke="${INK3}" stroke-width="0.2" stroke-dasharray="0.8 0.5"/><rect x="${mid - 0.8}" y="${y - 0.8}" width="1.6" height="1.6" fill="${INK}"/>`;
    case 'line':
      return `<line x1="${x}" y1="${y}" x2="${x + 12}" y2="${y}" stroke="${c}" stroke-width="${e.weight ?? 0.45}"${e.dash ? ` stroke-dasharray="${e.dash}"` : ''}/>`;
    case 'chip':
      return `<rect x="${mid - 2.9}" y="${y - 1.5}" width="5.8" height="3" rx="0.6" fill="${c}"/>${tag(mid, (e.tag?.length ?? 0) > 2 ? 1.25 : 1.55, '#fff')}`;
    case 'ring':
      return `<circle cx="${x + 2}" cy="${y}" r="1.1" fill="#fff" stroke="${c}" stroke-width="0.3"/>${e.tag ? t(x + 4, y + 0.55, e.tag, 1.5, { w: 700, c: INK2 }) : ''}`;
    case 'light':
      return `<circle cx="${mid}" cy="${y}" r="1.4" fill="#fff" stroke="${c}" stroke-width="0.3"/><line x1="${mid - 1}" y1="${y - 1}" x2="${mid + 1}" y2="${y + 1}" stroke="${c}" stroke-width="0.25"/><line x1="${mid + 1}" y1="${y - 1}" x2="${mid - 1}" y2="${y + 1}" stroke="${c}" stroke-width="0.25"/>`;
    case 'outlet':
      return `<path d="M${mid - 1.5} ${y + 0.7} A1.5 1.5 0 0 1 ${mid + 1.5} ${y + 0.7} Z" fill="#fff" stroke="${c}" stroke-width="0.3"/>`;
    case 'chamber':
      return `<rect x="${mid - 1.5}" y="${y - 1.5}" width="3" height="3" fill="#fff" stroke="${INK}" stroke-width="0.3"/><line x1="${mid - 1.5}" y1="${y - 1.5}" x2="${mid + 1.5}" y2="${y + 1.5}" stroke="${INK}" stroke-width="0.15"/>`;
    case 'septic':
      return `<rect x="${x + 1}" y="${y - 1.5}" width="10" height="3" fill="#F4F1EA" stroke="${INK}" stroke-width="0.35"/><line x1="${x + 7.5}" y1="${y - 1.5}" x2="${x + 7.5}" y2="${y + 1.5}" stroke="${INK}" stroke-width="0.2"/>`;
    case 'soak':
      return `<circle cx="${mid}" cy="${y}" r="2" fill="#F4F1EA" stroke="${INK}" stroke-width="0.35"/><circle cx="${mid}" cy="${y}" r="1.3" fill="none" stroke="${INK3}" stroke-width="0.15" stroke-dasharray="0.6 0.4"/>`;
    case 'tank':
      return `<circle cx="${mid}" cy="${y}" r="2" fill="none" stroke="${INK2}" stroke-width="0.25" stroke-dasharray="1 0.5"/>`;
    case 'arrow':
      return `<line x1="${x}" y1="${y}" x2="${x + 10.5}" y2="${y}" stroke="${INK}" stroke-width="0.25"/><path d="M${x + 12} ${y} l-1.8 -0.8 v1.6 Z" fill="${INK}"/>${t(x + 4, y - 0.8, e.tag ?? '22°', 1.4, { w: 600, c: INK2 })}`;
    case 'ridge':
      return `<line x1="${x}" y1="${y + 1.2}" x2="${x + 6}" y2="${y - 1.2}" stroke="${INK}" stroke-width="0.45"/><line x1="${x + 6}" y1="${y - 1.2}" x2="${x + 12}" y2="${y - 1.2}" stroke="${INK}" stroke-width="0.45"/>`;
    case 'solar':
      return `<rect x="${x + 1}" y="${y - 1.4}" width="10" height="2.8" fill="#DCE4F0" stroke="#3D5A80" stroke-width="0.25"/><line x1="${x + 4.33}" y1="${y - 1.4}" x2="${x + 4.33}" y2="${y + 1.4}" stroke="#3D5A80" stroke-width="0.12"/><line x1="${x + 7.66}" y1="${y - 1.4}" x2="${x + 7.66}" y2="${y + 1.4}" stroke="#3D5A80" stroke-width="0.12"/>`;
    case 'datum':
      return `<line x1="${x}" y1="${y + 0.9}" x2="${x + 12}" y2="${y + 0.9}" stroke="${INK3}" stroke-width="0.15" stroke-dasharray="1.2 0.6"/><path d="M${x + 3} ${y + 0.9} l-0.8 -1.2 h1.6 Z" fill="${INK}"/>${t(x + 4.4, y + 0.1, e.tag ?? '+3.000', 1.3, { w: 600, c: INK2 })}`;
    case 'note':
      return `<line x1="${x}" y1="${y + 1}" x2="${x + 4}" y2="${y - 0.6}" stroke="${INK2}" stroke-width="0.15"/><circle cx="${x}" cy="${y + 1}" r="0.35" fill="${INK2}"/><line x1="${x + 4}" y1="${y - 0.6}" x2="${x + 12}" y2="${y - 0.6}" stroke="${INK2}" stroke-width="0.15"/>${t(x + 4.3, y - 1, e.tag ?? 'Note', 1.2, { c: INK2 })}`;
    case 'block': {
      const h = [0, 2, 4, 6, 8].map((d) => `<line x1="${x + 1 + d}" y1="${y + 1.5}" x2="${x + 1 + d + 2}" y2="${y - 1.5}" stroke="${INK2}" stroke-width="0.12"/>`).join('');
      return `<rect x="${x + 1}" y="${y - 1.5}" width="10" height="3" fill="#D8D5CE" stroke="${INK}" stroke-width="0.3"/>${h}`;
    }
    case 'conc':
      return `<rect x="${x + 1}" y="${y - 1.5}" width="10" height="3" fill="#EEEDE9" stroke="${INK}" stroke-width="0.25"/>${[[2.5, -0.6], [5, 0.7], [7.5, -0.4], [9.4, 0.8], [3.8, 0.9]].map(([dx, dy]) => `<circle cx="${x + dx}" cy="${y + dy}" r="0.2" fill="${INK3}"/>`).join('')}<path d="M${x + 6} ${y - 0.9} l0.5 0.8 h-1 Z" fill="none" stroke="${INK3}" stroke-width="0.1"/>`;
    case 'hardcore':
      return `<rect x="${x + 1}" y="${y - 1.5}" width="10" height="3" fill="#fff" stroke="${INK}" stroke-width="0.25"/>${[[3, 0], [6, -0.4], [9, 0.4]].map(([dx, dy]) => `<ellipse cx="${x + dx}" cy="${y + dy}" rx="1" ry="0.6" fill="none" stroke="${INK3}" stroke-width="0.15"/>`).join('')}`;
    case 'earth':
      return `<line x1="${x + 1}" y1="${y - 1.5}" x2="${x + 11}" y2="${y - 1.5}" stroke="${INK}" stroke-width="0.3"/>${[0, 2, 4, 6, 8].map((d) => `<line x1="${x + 1 + d}" y1="${y + 1.5}" x2="${x + 3 + d}" y2="${y - 1.4}" stroke="${INK3}" stroke-width="0.15"/>`).join('')}`;
    case 'truss':
      return `<path d="M${x} ${y + 1.4} L${mid} ${y - 1.6} L${x + 12} ${y + 1.4} Z M${mid} ${y - 1.6} L${mid} ${y + 1.4} M${x + 3} ${y + 1.4} L${mid} ${y - 0.4} M${x + 9} ${y + 1.4} L${mid} ${y - 0.4}" fill="none" stroke="${INK}" stroke-width="0.22"/>`;
    case 'text':
    default:
      return t(mid, y + 0.6, e.tag ?? '', 1.7, { w: 700, a: 'middle' });
  }
}

/** A print-ready HTML document of one or more sheets (A3 landscape, no margins). */
export function sheetsHTML(title: string, svgs: string[]) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
@page { size: 420mm 297mm; margin: 0; }
html, body { margin: 0; padding: 0; background: #e9eaec; }
.page { width: 420mm; height: 297mm; margin: 12px auto; background: #fff; box-shadow: 0 2px 12px rgba(0,0,0,.12); page-break-after: always; break-after: page; overflow: hidden; }
.page:last-child { page-break-after: auto; break-after: auto; }
.page svg { display: block; width: 420mm; height: 297mm; }
.bar { position: sticky; top: 0; display: flex; gap: 12px; align-items: center; justify-content: space-between; padding: 10px 16px; background: #14161a; color: #fff; font: 13px Inter, system-ui, sans-serif; z-index: 2; }
.bar button { background: #fff; color: #14161a; border: 0; border-radius: 8px; padding: 7px 14px; font-weight: 600; cursor: pointer; }
@media print { html, body { background: #fff; } .bar { display: none; } .page { margin: 0; box-shadow: none; } }
</style></head><body>
<div class="bar"><span>${esc(title)} · ${svgs.length} sheet${svgs.length === 1 ? '' : 's'} · A3 landscape</span><button onclick="window.print()">Print / Save as PDF</button></div>
${svgs.map((s) => `<div class="page">${s}</div>`).join('\n')}
<script>window.addEventListener('load', () => setTimeout(() => window.print(), 400));</script>
</body></html>`;
}
