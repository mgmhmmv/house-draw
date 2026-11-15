/**
 * A3 sheets (SVG, millimetres) to one vector PDF file.
 *
 * The sheets are drawn for the browser: line weights are screen-pixel "non-scaling" strokes,
 * text halos use paint-order, fonts come from CSS. PDF has none of that, so each sheet is first
 * mounted at print size and baked: every stroke gets its real printed width in its own units,
 * halos become an outlined copy behind the text, fonts become Helvetica, and anything hidden
 * or invisible is dropped. Then svg2pdf writes it as vectors.
 */

const PX_MM = 25.4 / 96; // one CSS pixel on paper
const GEOMETRY = new Set(['path', 'line', 'rect', 'circle', 'ellipse', 'polygon', 'polyline', 'text']);

// Helvetica in a PDF covers Latin-1; swap the few typographic characters that fall outside it.
const CHARS: [RegExp, string][] = [
  [/[    ]/g, ' '],
  [/[–—−]/g, '-'],
  [/[‘’]/g, "'"],
  [/[“”]/g, '"'],
  [/…/g, '...'],
  [/≈/g, '~'],
  [/→/g, '->'],
  [/≥/g, '>='],
  [/≤/g, '<='],
];
const latin = (s: string) => CHARS.reduce((a, [re, to]) => a.replace(re, to), s).replace(/[^\x00-\xFF]/g, '');

const transparent = (c: string) => c === 'none' || c === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(c);

function bake(svg: SVGSVGElement) {
  const root = svg.getScreenCTM();
  if (!root) return;
  const rootScale = Math.hypot(root.a, root.b); // screen px per mm
  const els = [...svg.querySelectorAll('*')] as SVGElement[];
  const drop: Element[] = [];
  const halos: [SVGElement, string][] = [];
  for (const el of els) {
    if (el.closest('defs, pattern, clipPath, mask')) continue;
    const tag = el.tagName.toLowerCase();
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0' || el.getAttribute('display') === 'none') {
      drop.push(el);
      continue;
    }
    if (!GEOMETRY.has(tag)) continue;
    const stroke = cs.stroke;
    const fill = cs.fill;
    if (transparent(fill) && transparent(stroke) && tag !== 'text') {
      drop.push(el);
      continue;
    }
    if (tag === 'text') {
      el.setAttribute('font-family', 'helvetica');
      el.setAttribute('font-weight', Number(cs.fontWeight) >= 600 || cs.fontWeight === 'bold' ? 'bold' : 'normal');
      el.setAttribute('font-size', String(parseFloat(cs.fontSize)));
      el.setAttribute('fill', fill);
      for (const n of [...el.childNodes]) if (n.nodeType === Node.TEXT_NODE) n.textContent = latin(n.textContent ?? '');
      el.querySelectorAll('tspan').forEach((ts) => (ts.textContent = latin(ts.textContent ?? '')));
    }
    if (transparent(stroke)) {
      el.setAttribute('stroke', 'none');
      continue;
    }
    // Printed stroke width: non-scaling strokes are screen pixels on the printed page.
    const nonScaling = cs.getPropertyValue('vector-effect') === 'non-scaling-stroke';
    const w = parseFloat(cs.strokeWidth) || 1;
    const ctm = (el as SVGGraphicsElement).getScreenCTM();
    const s = ctm ? Math.sqrt(Math.abs(ctm.a * ctm.d - ctm.b * ctm.c)) / rootScale : 1; // mm per user unit
    const k = nonScaling && s > 0 ? PX_MM / s : 1;
    el.setAttribute('stroke', stroke);
    el.setAttribute('stroke-width', String(w * k));
    const dash = cs.strokeDasharray;
    if (dash && dash !== 'none') el.setAttribute('stroke-dasharray', dash.split(/[\s,]+/).map((d) => parseFloat(d) * k).join(' '));
    if (cs.strokeLinecap) el.setAttribute('stroke-linecap', cs.strokeLinecap);
    if (cs.strokeLinejoin) el.setAttribute('stroke-linejoin', cs.strokeLinejoin);
    el.removeAttribute('vector-effect');
    el.style.removeProperty('vector-effect');
    el.style.removeProperty('stroke-width');
    // Text halo (stroke painted under the fill): an outlined copy behind, then the plain text.
    if (tag === 'text' && cs.paintOrder.startsWith('stroke')) halos.push([el, stroke]);
  }
  for (const el of drop) el.remove();
  for (const [el, stroke] of halos) {
    const halo = el.cloneNode(true) as SVGElement;
    halo.setAttribute('fill', stroke);
    el.parentNode?.insertBefore(halo, el);
    el.setAttribute('stroke', 'none');
  }
  svg.querySelectorAll('style').forEach((st) => st.remove());
  // Every element now carries its own vector-effect-free attributes.
  svg.querySelectorAll('[vector-effect]').forEach((el) => el.removeAttribute('vector-effect'));
}

/** Write the sheets as one A3 landscape PDF and download it. */
export async function downloadSheetsPDF(svgs: string[], filename: string, onPage?: (i: number, n: number) => void) {
  const [{ jsPDF }, { svg2pdf }] = await Promise.all([import('jspdf'), import('svg2pdf.js')]);
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3', compress: true });
  const host = document.createElement('div');
  // At 96 px per inch a 420 mm sheet is 1587 px: one CSS pixel is then what it is on paper.
  host.style.cssText = 'position:fixed;left:-20000px;top:0;width:1588px;height:1123px;overflow:hidden;pointer-events:none;';
  document.body.appendChild(host);
  try {
    for (const [i, src] of svgs.entries()) {
      onPage?.(i, svgs.length);
      if (i) doc.addPage('a3', 'landscape');
      host.innerHTML = src;
      const svg = host.querySelector('svg') as SVGSVGElement | null;
      if (!svg) continue;
      svg.setAttribute('width', '1587.4');
      svg.setAttribute('height', '1122.5');
      bake(svg);
      await svg2pdf(svg, doc, { x: 0, y: 0, width: 420, height: 297 });
      host.innerHTML = '';
      await new Promise((r) => setTimeout(r, 0));
    }
    doc.save(filename);
  } finally {
    host.remove();
  }
}
