/**
 * The Maavadiyaa mark (an old claw hammer on a dark tile) as SVG markup for drawings and PDFs.
 * Drawn on a 64-unit square; `logoMark` places it at (x, y), `size` wide, in the sheet's units.
 */
export const BRAND = {
  name: 'Maavadiyaa',
  tagline: 'Design · drawings · costing',
};

export function logoMark(x: number, y: number, size: number, id = 'mvlogo'): string {
  const k = size / 64;
  return `<g transform="translate(${x} ${y}) scale(${k})">
<defs>
<linearGradient id="${id}w" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="#8F5C33"/><stop offset="0.42" stop-color="#C99460"/><stop offset="1" stop-color="#875630"/></linearGradient>
<linearGradient id="${id}i" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#A9AFB5"/><stop offset="0.38" stop-color="#6C737A"/><stop offset="1" stop-color="#363A3F"/></linearGradient>
<linearGradient id="${id}t" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#2A2722"/><stop offset="1" stop-color="#151412"/></linearGradient>
</defs>
<rect width="64" height="64" rx="14" fill="url(#${id}t)"/>
<g transform="translate(32 32) rotate(-40) scale(0.86) translate(-32 -31)">
<path d="M29.4 22 H34.6 L35.8 52.8 Q35.9 57 32 57 Q28.1 57 28.2 52.8 Z" fill="url(#${id}w)"/>
<path d="M30.7 24.5 L30.3 54.5 M33.3 24.5 L33.7 54" stroke="#6F4422" stroke-width="0.4" opacity="0.55" fill="none"/>
<path d="M28.5 46.2 H35.5 M28.4 48.4 H35.6 M28.3 50.6 H35.7" stroke="#5E391C" stroke-width="0.55" opacity="0.55"/>
<path d="M10.6 14.6 Q10.6 12.4 12.8 12.4 H16.6 V24 H12.8 Q10.6 24 10.6 21.8 Z" fill="url(#${id}i)"/>
<path d="M16.6 14.8 L18 14.2 H26.2 V22.2 H18 L16.6 21.6 Z" fill="url(#${id}i)"/>
<path d="M26.2 12.6 Q26.2 12 26.8 12 H37.4 V24.4 H26.8 Q26.2 24.4 26.2 23.8 Z" fill="url(#${id}i)"/>
<path d="M37.4 13 Q46.4 12.2 53.2 18.9 Q54.1 19.9 52.9 20.5 Q46.8 17.7 37.4 21.6 Z" fill="url(#${id}i)"/>
<path d="M42.6 15.9 Q47.4 16.6 51.6 19.4" stroke="#24272B" stroke-width="0.85" fill="none" stroke-linecap="round"/>
<path d="M12.2 12.9 H16.4 M18.2 14.7 H26 M27 12.5 H37.2 Q45.6 12.9 51.8 18.4" stroke="#D6DADE" stroke-width="0.5" opacity="0.6" fill="none"/>
</g>
</g>`;
}
