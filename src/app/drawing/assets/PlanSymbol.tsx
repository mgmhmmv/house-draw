import type { Prim } from './kit';

/**
 * Draws plan primitives (item-local metres). `ink` is the line colour; strokes don't scale with
 * zoom inside the plan (vector-effect), so symbols stay crisp at any scale.
 */
export function PlanPrims({ prims, ink = 'currentColor', fill = '#FFFFFF', width = 1, nonScaling = true }: { prims: Prim[]; ink?: string; fill?: string; width?: number; nonScaling?: boolean }) {
  const ve = nonScaling ? 'non-scaling-stroke' : undefined;
  const st = (style: Prim['style']) => ({
    fill: style === 'fill' ? fill : 'none',
    stroke: ink,
    strokeWidth: style === 'thin' ? width * 0.6 : width,
    strokeDasharray: style === 'dash' ? (nonScaling ? '5 3' : '0.08 0.05') : undefined,
    vectorEffect: ve,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  });
  return (
    <>
      {prims.map((p, i) => {
        switch (p.k) {
          case 'rect':
            return <rect key={i} x={p.x} y={p.y} width={p.w} height={p.h} rx={p.rx || undefined} transform={p.rot ? `rotate(${p.rot} ${p.cx} ${p.cy})` : undefined} {...st(p.style)} />;
          case 'ellipse':
            return <ellipse key={i} cx={p.cx} cy={p.cy} rx={p.rx} ry={p.ry} {...st(p.style)} />;
          case 'line':
            return <line key={i} x1={p.x1} y1={p.y1} x2={p.x2} y2={p.y2} {...st(p.style)} />;
          case 'path':
            return <path key={i} d={p.d} {...st(p.style)} fill="none" />;
        }
      })}
    </>
  );
}

/** A standalone plan symbol, fitted into a box (library cards). */
export function PlanSymbolSvg({ prims, w, d, className }: { prims: Prim[]; w: number; d: number; className?: string }) {
  const pad = Math.max(w, d) * 0.08;
  return (
    <svg viewBox={`${-w / 2 - pad} ${-d / 2 - pad} ${w + pad * 2} ${d + pad * 2}`} className={className} preserveAspectRatio="xMidYMid meet">
      <PlanPrims prims={prims} ink="rgb(var(--ink))" fill="rgb(var(--surface))" width={1.1} />
    </svg>
  );
}
