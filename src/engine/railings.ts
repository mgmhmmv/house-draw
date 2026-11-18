/**
 * Railings round balconies and roof terraces: every open edge of an outdoor room above the
 * ground floor — one with no wall on it and no room beyond it — gets a steel railing
 * (library asset `fence_railing`, 1.1 m high), set just inside the slab edge.
 */
import type { FloorLevel, FurnitureItem, Room } from '../model/types';

const OUTDOOR = new Set(['balcony', 'porch']);
const EPS = 0.02;
const INSET = 0.06;

type Span = [number, number];

function bounds(r: Room) {
  const xs = r.polygon.map((p) => p.x);
  const ys = r.polygon.map((p) => p.y);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}

/** `spans` minus `cut`. */
function subtract(spans: Span[], cut: Span): Span[] {
  const out: Span[] = [];
  for (const [a, b] of spans) {
    if (cut[1] <= a + EPS || cut[0] >= b - EPS) {
      out.push([a, b]);
      continue;
    }
    if (cut[0] > a + EPS) out.push([a, cut[0]]);
    if (cut[1] < b - EPS) out.push([cut[1], b]);
  }
  return out;
}

export const isRailing = (f: FurnitureItem) => f.id.startsWith('rail-');

/** Railings for one level's balconies and terraces; none on the ground floor. */
export function balconyRailings(level: FloorLevel): FurnitureItem[] {
  if (level.index === 0) return [];
  const rooms = level.rooms.map((r) => ({ r, b: bounds(r) }));
  const out: FurnitureItem[] = [];
  for (const { r, b } of rooms) {
    if (!OUTDOOR.has(r.category)) continue;
    const edges: { horizontal: boolean; c: number; span: Span; inward: number }[] = [
      { horizontal: true, c: b.y0, span: [b.x0, b.x1], inward: 1 },
      { horizontal: true, c: b.y1, span: [b.x0, b.x1], inward: -1 },
      { horizontal: false, c: b.x0, span: [b.y0, b.y1], inward: 1 },
      { horizontal: false, c: b.x1, span: [b.y0, b.y1], inward: -1 },
    ];
    for (const e of edges) {
      let spans: Span[] = [e.span];
      // Walls on this edge.
      for (const w of level.walls) {
        const horiz = Math.abs(w.start.y - w.end.y) < EPS;
        const vert = Math.abs(w.start.x - w.end.x) < EPS;
        if (e.horizontal ? !horiz : !vert) continue;
        const c = e.horizontal ? w.start.y : w.start.x;
        if (Math.abs(c - e.c) > w.thickness / 2 + EPS) continue;
        const a = e.horizontal ? Math.min(w.start.x, w.end.x) : Math.min(w.start.y, w.end.y);
        const z = e.horizontal ? Math.max(w.start.x, w.end.x) : Math.max(w.start.y, w.end.y);
        spans = subtract(spans, [a - w.thickness / 2, z + w.thickness / 2]);
      }
      // Rooms beyond this edge (another balcony, a walkway, an open stair hall).
      for (const o of rooms) {
        if (o.r === r) continue;
        const ob = o.b;
        if (e.horizontal) {
          if (Math.abs(ob.y0 - e.c) < EPS || Math.abs(ob.y1 - e.c) < EPS) spans = subtract(spans, [ob.x0, ob.x1]);
        } else if (Math.abs(ob.x0 - e.c) < EPS || Math.abs(ob.x1 - e.c) < EPS) spans = subtract(spans, [ob.y0, ob.y1]);
      }
      for (const [a, z] of spans) {
        if (z - a < 0.3) continue;
        const m = (a + z) / 2;
        const c = e.c + e.inward * INSET;
        out.push({
          id: `rail-${r.id}-${out.length}`,
          type: 'fence_railing',
          position: e.horizontal ? { x: m, y: c } : { x: c, y: m },
          rotation: e.horizontal ? 0 : 90,
          width: Number((z - a).toFixed(3)),
          depth: 0.1,
        });
      }
    }
  }
  return out;
}

/** The level with its railings regenerated (railings added by hand under other ids are kept). */
export function withRailings(level: FloorLevel): FloorLevel {
  return { ...level, furniture: [...level.furniture.filter((f) => !isRailing(f)), ...balconyRailings(level)] };
}
