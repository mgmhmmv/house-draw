/**
 * A small drawn plan for project cards. Deterministic from the project id, so a card
 * keeps its picture without loading the model.
 */
export function PlanGlyph({ seed, rooms = 5, levels = 1 }: { seed: string; rooms?: number; levels?: number }) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  const rnd = () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };

  const W = 200;
  const H = 130;
  // Split a rectangle into rooms with alternating guillotine cuts.
  const cells: { x: number; y: number; w: number; h: number }[] = [{ x: 0, y: 0, w: W, h: H }];
  const target = Math.max(3, Math.min(9, rooms || 5));
  while (cells.length < target) {
    cells.sort((a, b) => b.w * b.h - a.w * a.h);
    const c = cells.shift()!;
    const t = 0.35 + rnd() * 0.3;
    if (c.w >= c.h) {
      const w1 = Math.round(c.w * t);
      cells.push({ ...c, w: w1 }, { ...c, x: c.x + w1, w: c.w - w1 });
    } else {
      const h1 = Math.round(c.h * t);
      cells.push({ ...c, h: h1 }, { ...c, y: c.y + h1, h: c.h - h1 });
    }
  }
  const highlight = Math.floor(rnd() * cells.length);

  return (
    <svg viewBox={`-14 -14 ${W + 28} ${H + 28}`} className="h-full w-full" aria-hidden>
      {levels > 1 && <rect x={8} y={-8} width={W} height={H} fill="none" className="stroke-line-strong" strokeWidth={1.5} strokeDasharray="4 4" />}
      {cells.map((c, i) => (
        <rect
          key={i}
          x={c.x}
          y={c.y}
          width={c.w}
          height={c.h}
          className={i === highlight ? 'fill-accent/10 stroke-ink-2' : 'fill-surface stroke-ink-2'}
          strokeWidth={1.6}
        />
      ))}
      <rect x={0} y={0} width={W} height={H} fill="none" className="stroke-ink" strokeWidth={4} />
    </svg>
  );
}
