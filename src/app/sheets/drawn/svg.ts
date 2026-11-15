/**
 * Small SVG-string toolkit for diagram sheets drawn directly on A3 paper (millimetres):
 * text, lines, boxes, tables, and the electrical / plumbing symbols they use.
 */
import { wrap } from '../../../export/sheet';

export const INK = '#14161A';
export const INK2 = '#4A4F57';
export const INK3 = '#8B9098';
export const RULE = '#C9CDD3';
export const COLD = '#2F6FD4';
export const HOT = '#C9473B';
export const SOIL = '#6B5B4B';
export const RAIN = '#5B9BD5';
export const POWER = '#C2781B';
export const LIGHT = '#B8860B';
export const COOL = '#2A8C8C';
export const SOLAR = '#D1A21F';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export interface TextOpts {
  w?: number;
  c?: string;
  a?: 'start' | 'middle' | 'end';
  rot?: number;
  ls?: number;
}
export const T = (x: number, y: number, s: string | number, size: number, o: TextOpts = {}) =>
  `<text x="${r(x)}" y="${r(y)}" font-size="${size}" font-weight="${o.w ?? 400}" fill="${o.c ?? INK}" text-anchor="${o.a ?? 'start'}"${o.rot ? ` transform="rotate(${o.rot} ${r(x)} ${r(y)})"` : ''}${o.ls ? ` letter-spacing="${o.ls}"` : ''}>${esc(String(s))}</text>`;
/** Wrapped text block; returns the markup and the height used. */
export function TW(x: number, y: number, s: string, size: number, chars: number, o: TextOpts = {}, maxLines = 4) {
  const lines = wrap(s, chars).slice(0, maxLines);
  return { svg: lines.map((ln, i) => T(x, y + i * size * 1.3, ln, size, o)).join(''), h: lines.length * size * 1.3 };
}
export const r = (n: number) => Math.round(n * 100) / 100;
export const L = (x1: number, y1: number, x2: number, y2: number, c = INK, w = 0.3, dash?: string) =>
  `<line x1="${r(x1)}" y1="${r(y1)}" x2="${r(x2)}" y2="${r(y2)}" stroke="${c}" stroke-width="${w}"${dash ? ` stroke-dasharray="${dash}"` : ''} stroke-linecap="round"/>`;
export const PL = (pts: [number, number][], c = INK, w = 0.3, dash?: string) =>
  `<polyline points="${pts.map(([x, y]) => `${r(x)},${r(y)}`).join(' ')}" fill="none" stroke="${c}" stroke-width="${w}" stroke-linejoin="round"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;
export const RECT = (x: number, y: number, w: number, h: number, o: { fill?: string; stroke?: string; sw?: number; dash?: string; rx?: number } = {}) =>
  `<rect x="${r(x)}" y="${r(y)}" width="${r(w)}" height="${r(h)}"${o.rx ? ` rx="${o.rx}"` : ''} fill="${o.fill ?? '#fff'}" stroke="${o.stroke ?? INK}" stroke-width="${o.sw ?? 0.3}"${o.dash ? ` stroke-dasharray="${o.dash}"` : ''}/>`;
export const CIRC = (cx: number, cy: number, rad: number, o: { fill?: string; stroke?: string; sw?: number; dash?: string } = {}) =>
  `<circle cx="${r(cx)}" cy="${r(cy)}" r="${r(rad)}" fill="${o.fill ?? '#fff'}" stroke="${o.stroke ?? INK}" stroke-width="${o.sw ?? 0.3}"${o.dash ? ` stroke-dasharray="${o.dash}"` : ''}/>`;

/* ── Electrical symbols (vertical, top at y, 6 mm long) ─────────────── */

/**
 * IEC 60617 switching devices, vertical, top at y, 6 mm long (× s):
 * - mcb: circuit-breaker, switch with × on the fixed contact (S00287)
 * - rcd: RCBO, circuit-breaker with residual-current element (core + mechanical link)
 * - rccb: residual-current switch (no ×), with the residual-current element
 * - isolator: switch-disconnector, bar and load-break circle on the fixed contact (S00288)
 */
export function breaker(x: number, y: number, kind: 'mcb' | 'rcd' | 'rccb' | 'isolator' = 'mcb', s = 1) {
  const p: string[] = [];
  p.push(L(x, y, x, y + 1.6 * s));
  p.push(L(x, y + 4.4 * s, x - 1.6 * s, y + 1.9 * s));
  p.push(L(x, y + 4.4 * s, x, y + 6 * s));
  if (kind === 'isolator') {
    p.push(L(x - 0.9 * s, y + 1.6 * s, x + 0.9 * s, y + 1.6 * s));
    p.push(CIRC(x, y + 1.6 * s - 0.5 * s, 0.45 * s, { sw: 0.2 }));
  } else if (kind !== 'rccb') {
    p.push(L(x - 0.5 * s, y + 1.1 * s, x + 0.5 * s, y + 2.1 * s, INK, 0.25) + L(x - 0.5 * s, y + 2.1 * s, x + 0.5 * s, y + 1.1 * s, INK, 0.25));
  }
  if (kind === 'rcd' || kind === 'rccb') {
    // Residual-current element: a core round the conductor, linked to the contact.
    p.push(`<ellipse cx="${r(x)}" cy="${r(y + 5.3 * s)}" rx="${r(1.1 * s)}" ry="${r(0.45 * s)}" fill="none" stroke="${INK}" stroke-width="0.22"/>`);
    p.push(PL([[x - 1.1 * s, y + 5.3 * s], [x - 2.3 * s, y + 5.3 * s], [x - 2.3 * s, y + 3.2 * s], [x - 0.9 * s, y + 3.2 * s]], INK, 0.18, '0.5 0.35'));
  }
  return p.join('');
}
export function fuse(x: number, y: number) {
  return L(x, y, x, y + 6) + RECT(x - 0.9, y + 1, 1.8, 4);
}
/** Active-energy meter (IEC 60617 S00932): a box marked kWh, 6 mm tall. */
export function meter(x: number, y: number, tag = 'kWh') {
  return RECT(x - 3, y + 0.6, 6, 4.8) + T(x, y + 3.6, tag, 1.5, { w: 700, a: 'middle' });
}
/** Protective earth (IEC 60417-5019): earth bars in a circle; top at y. */
export function earth(x: number, y: number) {
  return L(x, y, x, y + 1.8) + CIRC(x, y + 3.4, 2, { fill: 'none', sw: 0.25 }) + L(x, y + 1.4, x, y + 3) + L(x - 1.3, y + 3, x + 1.3, y + 3) + L(x - 0.85, y + 3.7, x + 0.85, y + 3.7) + L(x - 0.4, y + 4.4, x + 0.4, y + 4.4);
}
/** Surge protective device: box with the discharge arrow towards earth. */
export function spd(x: number, y: number) {
  return RECT(x - 1.6, y, 3.2, 4.2) + L(x, y + 0.7, x, y + 3) + `<path d="M${r(x - 0.7)} ${r(y + 2.6)} L${r(x)} ${r(y + 3.6)} L${r(x + 0.7)} ${r(y + 2.6)} Z" fill="${INK}"/>`;
}
/** Conductor count on a single line (IEC): oblique strokes and their designation. */
export function ticks(x: number, y: number, n: number, label: string, vertical = true) {
  const p: string[] = [];
  for (let i = 0; i < n; i++) {
    const o = (i - (n - 1) / 2) * 0.7;
    p.push(vertical ? L(x - 0.9, y + o + 0.5, x + 0.9, y + o - 0.5, INK, 0.2) : L(x + o - 0.5, y + 0.9, x + o + 0.5, y - 0.9, INK, 0.2));
  }
  p.push(vertical ? T(x - 1.4, y + 0.5, label, 1.1, { c: INK2, a: 'end' }) : T(x, y - 1.6, label, 1.1, { c: INK2, a: 'middle' }));
  return p.join('');
}
export function inverter(x: number, y: number, w = 14, h = 9) {
  return RECT(x - w / 2, y, w, h) + L(x - w / 2, y + h, x + w / 2, y) + L(x - w / 2 + 1.2, y + 1.8, x - w / 2 + 4, y + 1.8) + L(x - w / 2 + 1.2, y + 2.6, x - w / 2 + 4, y + 2.6, INK, 0.3, '0.5 0.4') + `<path d="M${r(x + w / 2 - 4.2)} ${r(y + h - 2)} q0.7 -1 1.4 0 t1.4 0" fill="none" stroke="${INK}" stroke-width="0.3"/>`;
}
export function battery(x: number, y: number) {
  return L(x - 1.2, y - 2.4, x - 1.2, y + 2.4, INK, 0.35) + L(x + 0.4, y - 1.2, x + 0.4, y + 1.2, INK, 0.8) + L(x + 2, y - 2.4, x + 2, y + 2.4, INK, 0.35) + L(x + 3.6, y - 1.2, x + 3.6, y + 1.2, INK, 0.8);
}
/** PV generator (IEC 60617): module box with the incident-light arrows and the DC sign. */
export function pvArray(x: number, y: number, w = 20, h = 9) {
  let s = RECT(x, y, w, h, { fill: '#DCE4F0', stroke: '#3D5A80' });
  for (let i = 1; i < 4; i++) s += L(x + (w / 4) * i, y, x + (w / 4) * i, y + h, '#3D5A80', 0.15);
  s += L(x, y + h / 2, x + w, y + h / 2, '#3D5A80', 0.15);
  // Light arrows onto the module.
  for (const dx of [-3.2, -1.2]) s += L(x + dx - 1.6, y - 2.2, x + dx + 0.6, y - 0.2, INK, 0.22) + `<path d="M${r(x + dx + 0.9)} ${r(y + 0.1)} l-1.2 -0.4 l0.8 -0.8 Z" fill="${INK}"/>`;
  s += T(x + w + 1, y + h - 1, '=', 2, { w: 700 });
  return s;
}

/* Load points, centred at (x, y). */
export function lightPt(x: number, y: number, rad = 1.1) {
  return CIRC(x, y, rad, { stroke: LIGHT, sw: 0.25 }) + L(x - rad * 0.7, y - rad * 0.7, x + rad * 0.7, y + rad * 0.7, LIGHT, 0.2) + L(x + rad * 0.7, y - rad * 0.7, x - rad * 0.7, y + rad * 0.7, LIGHT, 0.2);
}
/** Socket outlet with protective contact (IEC 60617 S00351): semicircle on a stem, PE bar. */
export function socketPt(x: number, y: number, rad = 1.2, color = POWER) {
  return L(x, y - rad - 0.7, x, y - rad * 0.2, color, 0.25) + `<path d="M${r(x - rad)} ${r(y + rad * 0.4)} A${rad} ${rad} 0 0 1 ${r(x + rad)} ${r(y + rad * 0.4)}" fill="none" stroke="${color}" stroke-width="0.28"/>` + L(x - rad, y + rad * 0.4, x + rad, y + rad * 0.4, color, 0.28) + L(x - rad * 0.55, y + rad * 0.85, x + rad * 0.55, y + rad * 0.85, color, 0.22);
}
/** Lighting switch, one-way (IEC 60617 S00369). */
export function switchPt(x: number, y: number, color = LIGHT) {
  return CIRC(x, y, 0.55, { stroke: color, sw: 0.25 }) + L(x + 0.4, y - 0.4, x + 1.5, y - 1.5, color, 0.25) + L(x + 1.5, y - 1.5, x + 1.95, y - 1.05, color, 0.25);
}
/** Fan: motor (IEC: circle with M). */
export function fanPt(x: number, y: number, color = COOL) {
  return CIRC(x, y, 1.15, { stroke: color, sw: 0.25 }) + T(x, y + 0.45, 'M', 1.25, { w: 700, a: 'middle', c: color });
}
/** Equipment box with its designation (AC indoor / outdoor unit). */
export function equipPt(x: number, y: number, tag: string, color = COOL) {
  return RECT(x - 1.6, y - 1, 3.2, 2, { stroke: color, sw: 0.28 }) + T(x, y + 0.45, tag, 1.05, { w: 700, a: 'middle', c: color });
}
/** Water heater: box with the heating element (IEC 60617 S00616). */
export function heaterPt(x: number, y: number, color = HOT) {
  return RECT(x - 1.6, y - 1, 3.2, 2, { stroke: color, sw: 0.28 }) + PL([[x - 1.1, y + 0.5], [x - 0.6, y - 0.5], [x - 0.1, y + 0.5], [x + 0.4, y - 0.5], [x + 0.9, y + 0.5]], color, 0.22);
}
export function chip(x: number, y: number, tag: string, color: string, w = 3.6, h = 2) {
  return RECT(x - w / 2, y - h / 2, w, h, { fill: color, stroke: color, sw: 0.1, rx: 0.4 }) + T(x, y + h * 0.28, tag, tag.length > 2 ? h * 0.55 : h * 0.7, { w: 700, c: '#fff', a: 'middle' });
}

/* ── Plumbing symbols (on a horizontal run at y unless noted) ──────── */

export function valve(x: number, y: number, vertical = false) {
  return vertical
    ? `<path d="M${r(x - 1.2)} ${r(y - 1.5)} L${r(x + 1.2)} ${r(y + 1.5)} L${r(x - 1.2)} ${r(y + 1.5)} L${r(x + 1.2)} ${r(y - 1.5)} Z" fill="#fff" stroke="${INK}" stroke-width="0.25"/>`
    : `<path d="M${r(x - 1.5)} ${r(y - 1.2)} L${r(x + 1.5)} ${r(y + 1.2)} L${r(x + 1.5)} ${r(y - 1.2)} L${r(x - 1.5)} ${r(y + 1.2)} Z" fill="#fff" stroke="${INK}" stroke-width="0.25"/>`;
}
export function pump(x: number, y: number) {
  return CIRC(x, y, 2.4) + `<path d="M${r(x - 1.2)} ${r(y - 1.7)} L${r(x + 2)} ${r(y)} L${r(x - 1.2)} ${r(y + 1.7)} Z" fill="${INK}"/>`;
}
/** Float valve inside a tank: inlet at (x, y), arm and ball hanging down-right. */
export function floatValve(x: number, y: number) {
  return L(x, y - 1, x, y + 1) + L(x, y, x + 3, y + 1.8, INK, 0.2) + CIRC(x + 3.6, y + 2.2, 0.8);
}
export function cowl(x: number, y: number) {
  return `<path d="M${r(x - 1.6)} ${r(y)} h3.2 l-1.6 -1.4 Z" fill="none" stroke="${INK}" stroke-width="0.25"/>`;
}
export function chamber(x: number, y: number, s = 2.2) {
  return RECT(x - s, y - s, s * 2, s * 2) + L(x - s, y - s, x + s, y + s, INK, 0.18);
}
export function tank(x: number, y: number, w: number, h: number, waterAt = 0.35, fill = '#EAF1FB') {
  return RECT(x, y, w, h, { fill, sw: 0.4 }) + L(x + 0.6, y + h * waterAt, x + w - 0.6, y + h * waterAt, COLD, 0.2, '0.8 0.5');
}

/* ── Tables ─────────────────────────────────────────────────────────── */

export interface Col<R> {
  label: string;
  w: number;
  get: (row: R) => string;
  align?: 'start' | 'end' | 'middle';
  bold?: boolean;
}
/** A ruled table; text is cut to fit each column. Returns markup and height. */
export function table<R>(x: number, y: number, title: string, cols: Col<R>[], rows: R[], o: { rowH?: number; size?: number; total?: R } = {}) {
  const rowH = o.rowH ?? 4.2;
  const size = o.size ?? Math.min(1.75, rowH * 0.42);
  const W = cols.reduce((s, c) => s + c.w, 0);
  const p: string[] = [];
  p.push(T(x, y + 2.6, title.toUpperCase(), 2.0, { w: 700, ls: 0.2 }));
  let yy = y + 4.2;
  p.push(RECT(x, yy, W, rowH + 0.4, { fill: '#F1F2F4', sw: 0.25 }));
  let cx = x;
  for (const c of cols) {
    const tx = c.align === 'end' ? cx + c.w - 1 : c.align === 'middle' ? cx + c.w / 2 : cx + 1;
    p.push(T(tx, yy + rowH * 0.68, c.label.toUpperCase(), Math.min(1.45, size * 0.85), { w: 700, c: INK2, a: c.align ?? 'start' }));
    cx += c.w;
  }
  yy += rowH + 0.4;
  const all = o.total ? [...rows, o.total] : rows;
  all.forEach((row, i) => {
    const isTotal = !!o.total && i === all.length - 1;
    if (isTotal) p.push(RECT(x, yy, W, rowH, { fill: '#F7F7F5', sw: 0.25 }));
    else p.push(L(x, yy + rowH, x + W, yy + rowH, RULE, 0.15));
    let cx2 = x;
    for (const c of cols) {
      const raw = c.get(row);
      const max = Math.max(2, Math.floor((c.w - 1.6) / (size * 0.56)));
      const txt = raw.length > max ? raw.slice(0, max - 1) + '…' : raw;
      const tx = c.align === 'end' ? cx2 + c.w - 1 : c.align === 'middle' ? cx2 + c.w / 2 : cx2 + 1;
      p.push(T(tx, yy + rowH * 0.68, txt, size, { w: c.bold || isTotal ? 700 : 400, c: INK, a: c.align ?? 'start' }));
      cx2 += c.w;
    }
    yy += rowH;
  });
  p.push(RECT(x, y + 4.2, W, yy - y - 4.2, { fill: 'none', sw: 0.3 }));
  // Column rules.
  let vx = x;
  for (const c of cols.slice(0, -1)) {
    vx += c.w;
    p.push(L(vx, y + 4.2, vx, yy, RULE, 0.15));
  }
  return { svg: p.join(''), h: yy - y };
}

/** A titled list of key/value lines in a box. */
export function dataBox(x: number, y: number, w: number, title: string, rows: [string, string][], size = 1.7) {
  const p: string[] = [];
  const lh = size * 1.55;
  let yy = y + 6;
  const body: string[] = [];
  for (const [k, v] of rows) {
    if (!k) {
      yy += lh * 0.5;
      body.push(T(x + 2, yy + lh * 0.6, v.toUpperCase(), size * 0.9, { w: 700, c: INK2, ls: 0.15 }));
      yy += lh;
      continue;
    }
    body.push(T(x + 2, yy + lh * 0.7, k, size, { c: INK2 }));
    const lines = wrap(v, Math.floor((w * 0.56) / (size * 0.55)));
    lines.slice(0, 3).forEach((ln, i) => body.push(T(x + w - 2, yy + lh * 0.7 + i * lh, ln, size, { w: 600, a: 'end' })));
    yy += lh * Math.min(3, lines.length);
  }
  p.push(RECT(x, y, w, yy - y + 2, { sw: 0.3 }));
  p.push(RECT(x, y, w, 5, { fill: '#F1F2F4', sw: 0.3 }));
  p.push(T(x + 2, y + 3.5, title.toUpperCase(), 1.9, { w: 700, ls: 0.2 }));
  return { svg: p.join('') + body.join(''), h: yy - y + 2 };
}
