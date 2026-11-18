/**
 * Turns the AI architect's layout (rooms as rectangles on each floor) into a full project:
 * walls on every room edge (thick outside, thin inside; open between living, dining and hall;
 * none round a verandah or balcony), a door into every room from the circulation, the front
 * door, windows on the outside walls, stairs, furniture, columns, grid, services and the roof.
 */
import { uid } from '../../engine/geometry';
import { autoGenerateStructuralGrid, autoPlaceStructuralColumns } from '../../engine/geometry';
import { autoPopulateMEPForLevel } from '../../engine/mepEngine';
import { DEFAULT_BOQ_RATES } from '../../model/presets';
import { DEFAULT_SOLAR_CONFIG, type BuildingProject, type FloorLevel, type FurnitureItem, type GateKind, type MEPNode, type Opening, type PlotSide, type Room, type RoomCategory, type RoofType, type Wall } from '../../model/types';
import { siteLayout } from '../drawing/model3d/site';
import { withRailings } from '../../engine/railings';

export interface AiRoom {
  name: string;
  category: RoomCategory;
  x: number;
  y: number;
  w: number;
  d: number;
}
export interface AiDesign {
  reasoning: string;
  name: string;
  summary: string;
  plot: { width: number; depth: number };
  offset: { x: number; y: number };
  floors: { name: string; rooms: AiRoom[] }[];
  roof: { type: RoofType; pitchDeg: number };
  assumptions?: string[];
  /** The plot's boundary wall and entrance. */
  site?: {
    boundary_wall?: boolean;
    wall_height?: number;
    gate?: { side?: PlotSide; centre?: number; width?: number; kind?: GateKind; canopy?: 'gable' | 'flat' | 'none'; pedestrian_width?: number };
    meter_at_gate?: boolean;
  };
  /** Services the brief asked for. */
  services?: { ac_rooms?: string[]; solar?: boolean; mdb_room?: string; inverter_room?: string };
  /** Finishes the brief asked for. */
  finishes?: { floor_tile?: { size_mm?: number; colour?: string; hex?: string }; wet_area_tile?: { size_mm?: number; colour?: string; hex?: string } };
}

const S = (v: number) => Math.round(v * 20) / 20; // 0.05 m
const OPEN = new Set<RoomCategory>(['living', 'dining', 'hallway']);
const OUTDOOR = new Set<RoomCategory>(['porch', 'balcony']);
const CIRC = new Set<RoomCategory>(['hallway', 'living', 'dining', 'porch']);
const EXT_T = 0.23;
const INT_T = 0.12;
const WALL_H = 3.05;
const PLINTH = 0.45;
const F2F = 3.2;

interface Seg {
  /** Fixed coordinate of the line (y for horizontal, x for vertical). */
  c: number;
  a: number;
  b: number;
  horizontal: boolean;
  rooms: number[];
}

/** Elementary pieces of every room edge, each knowing which rooms it bounds. */
function edgePieces(rooms: AiRoom[]): Seg[] {
  const lines = new Map<string, { c: number; horizontal: boolean; spans: { a: number; b: number; room: number }[] }>();
  const add = (horizontal: boolean, c: number, a: number, b: number, room: number) => {
    const key = `${horizontal ? 'h' : 'v'}${c.toFixed(2)}`;
    const l = lines.get(key) ?? { c, horizontal, spans: [] };
    l.spans.push({ a, b, room });
    lines.set(key, l);
  };
  rooms.forEach((r, i) => {
    add(true, r.y, r.x, r.x + r.w, i);
    add(true, r.y + r.d, r.x, r.x + r.w, i);
    add(false, r.x, r.y, r.y + r.d, i);
    add(false, r.x + r.w, r.y, r.y + r.d, i);
  });
  const out: Seg[] = [];
  for (const l of lines.values()) {
    const cuts = [...new Set(l.spans.flatMap((s) => [s.a, s.b]))].sort((p, q) => p - q);
    for (let i = 0; i < cuts.length - 1; i++) {
      const a = cuts[i];
      const b = cuts[i + 1];
      if (b - a < 0.02) continue;
      const m = (a + b) / 2;
      const owners = [...new Set(l.spans.filter((s) => s.a <= m && s.b >= m).map((s) => s.room))];
      if (owners.length) out.push({ c: l.c, a, b, horizontal: l.horizontal, rooms: owners });
    }
  }
  return out;
}

interface Built {
  walls: Wall[];
  /** Which wall carries each elementary piece. */
  pieceWall: Map<Seg, Wall>;
  pieces: Seg[];
}

function buildWalls(rooms: AiRoom[], prefix: string): Built {
  const pieces = edgePieces(rooms);
  const kind = (s: Seg): 'none' | 'ext' | 'int' => {
    const cats = s.rooms.map((i) => rooms[i].category);
    if (s.rooms.length === 1) return OUTDOOR.has(cats[0]) ? 'none' : 'ext';
    const [a, b] = cats;
    if (OUTDOOR.has(a) && OUTDOOR.has(b)) return 'none';
    if (OUTDOOR.has(a) || OUTDOOR.has(b)) return 'ext'; // the facade behind a verandah
    if (OPEN.has(a) && OPEN.has(b)) return 'none'; // open plan
    return 'int';
  };
  // Merge consecutive pieces on a line with the same kind into one wall.
  const byLine = new Map<string, Seg[]>();
  for (const p of pieces) {
    const key = `${p.horizontal ? 'h' : 'v'}${p.c.toFixed(2)}`;
    byLine.set(key, [...(byLine.get(key) ?? []), p]);
  }
  const walls: Wall[] = [];
  const pieceWall = new Map<Seg, Wall>();
  let n = 0;
  for (const segs of byLine.values()) {
    segs.sort((p, q) => p.a - q.a);
    let run: Seg[] = [];
    const flush = () => {
      if (!run.length) return;
      const k = kind(run[0]);
      if (k !== 'none') {
        const s0 = run[0];
        const a = run[0].a;
        const b = run[run.length - 1].b;
        const ext = k === 'ext';
        const w: Wall = {
          id: `${prefix}w${++n}`,
          start: s0.horizontal ? { x: a, y: s0.c } : { x: s0.c, y: a },
          end: s0.horizontal ? { x: b, y: s0.c } : { x: s0.c, y: b },
          thickness: ext ? EXT_T : INT_T,
          height: WALL_H,
          isExterior: ext,
          isLoadBearing: ext,
          material: ext ? 'brick' : 'cmu',
        };
        walls.push(w);
        for (const p of run) pieceWall.set(p, w);
      }
      run = [];
    };
    for (const p of segs) {
      const prev = run[run.length - 1];
      if (prev && (Math.abs(prev.b - p.a) > 0.02 || kind(prev) !== kind(p))) flush();
      run.push(p);
    }
    flush();
  }
  return { walls, pieceWall, pieces };
}

const wallLen = (w: Wall) => Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y);
/** Fraction along the wall of a point on its line. */
const along = (w: Wall, p: { x: number; y: number }) => {
  const L = wallLen(w) || 1;
  return ((p.x - w.start.x) * (w.end.x - w.start.x) + (p.y - w.start.y) * (w.end.y - w.start.y)) / (L * L);
};

function shared(a: AiRoom, b: AiRoom): { horizontal: boolean; c: number; s0: number; s1: number } | null {
  const e = 0.02;
  if (Math.abs(a.x + a.w - b.x) < e || Math.abs(b.x + b.w - a.x) < e) {
    const s0 = Math.max(a.y, b.y);
    const s1 = Math.min(a.y + a.d, b.y + b.d);
    if (s1 - s0 > 0.05) return { horizontal: false, c: Math.abs(a.x + a.w - b.x) < e ? b.x : a.x, s0, s1 };
  }
  if (Math.abs(a.y + a.d - b.y) < e || Math.abs(b.y + b.d - a.y) < e) {
    const s0 = Math.max(a.x, b.x);
    const s1 = Math.min(a.x + a.w, b.x + b.w);
    if (s1 - s0 > 0.05) return { horizontal: true, c: Math.abs(a.y + a.d - b.y) < e ? b.y : a.y, s0, s1 };
  }
  return null;
}

function wallOn(built: Built, horizontal: boolean, c: number, at: number): Wall | undefined {
  const piece = built.pieces.find((p) => p.horizontal === horizontal && Math.abs(p.c - c) < 0.02 && p.a <= at + 1e-6 && p.b >= at - 1e-6 && built.pieceWall.has(p));
  return piece ? built.pieceWall.get(piece) : undefined;
}

function door(w: Wall, center: { x: number; y: number }, width: number, label: string, swing: 1 | -1 = 1): Opening {
  return { id: uid('op'), wallId: w.id, kind: 'door', style: 'single', offset: along(w, center), width, height: 2.15, sillHeight: 0, swingDirection: swing, label };
}
function windowOn(w: Wall, center: { x: number; y: number }, width: number, small: boolean, label: string): Opening {
  return { id: uid('op'), wallId: w.id, kind: 'window', style: 'casement', offset: along(w, center), width, height: small ? 0.6 : 1.35, sillHeight: small ? 1.6 : 0.9, swingDirection: 1, label };
}

function furnish(r: AiRoom): FurnitureItem[] {
  const cx = r.x + r.w / 2;
  const area = r.w * r.d;
  const item = (type: string, x: number, y: number, w: number, d: number, rotation = 0): FurnitureItem => ({ id: uid('f'), type, position: { x, y }, rotation, width: w, depth: d });
  switch (r.category) {
    case 'bedroom': {
      const dbl = area >= 10;
      const bw = dbl ? 1.6 : 1.0;
      if (r.w < bw + 0.6 || r.d < 2.6) return [];
      return [item(dbl ? 'bed_double' : 'bed_single', cx, r.y + 0.12 + 1.05, bw, 2.1)];
    }
    case 'living':
      return r.w >= 3 && r.d >= 3 ? [item('sofa', cx, r.y + 0.6, Math.min(2.2, r.w - 1), 0.9)] : [];
    case 'dining':
      return r.w >= 2.6 && r.d >= 2.6 ? [item('dining_table', cx, r.y + r.d / 2, 1.6, 0.9)] : [];
    default:
      return [];
  }
}

function buildLevel(rooms0: AiRoom[], index: number, name: string, below: FloorLevel | null): FloorLevel {
  const rooms = rooms0.filter((r) => r.w > 0.3 && r.d > 0.3).map((r) => ({ ...r, x: S(r.x), y: S(r.y), w: S(r.w), d: S(r.d) }));
  const built = buildWalls(rooms, `l${index}`);
  const openings: Opening[] = [];
  const doored = new Set<number>();

  // Doors: grow outwards from the entrance through shared walls, circulation first.
  const entry = rooms.findIndex((r) => r.category === 'porch') >= 0 ? rooms.findIndex((r) => r.category === 'porch') : rooms.findIndex((r) => r.category === 'hallway') >= 0 ? rooms.findIndex((r) => r.category === 'hallway') : Math.max(0, rooms.findIndex((r) => r.category === 'living'));
  const reached = new Set<number>([entry]);
  // Open-plan neighbours (no wall between them) are reached together.
  const openLink = (i: number, j: number) => {
    const sh = shared(rooms[i], rooms[j]);
    if (!sh) return false;
    const mid = (sh.s0 + sh.s1) / 2;
    return !wallOn(built, sh.horizontal, sh.c, mid);
  };
  // A verandah or balcony only ever gets the front door into the house, never doors to rooms.
  const priority = (from: AiRoom, to: AiRoom) =>
    OUTDOOR.has(from.category) ? (index === 0 && OPEN.has(to.category) ? -1 : 9) : /stair/i.test(from.name) ? 2.5 : CIRC.has(from.category) ? 0 : to.category === 'bathroom' && from.category === 'bedroom' ? 1 : 2;
  let frontDone = false;
  for (let guard = 0; guard < rooms.length * 2; guard++) {
    let best: { i: number; j: number; sh: NonNullable<ReturnType<typeof shared>>; p: number } | null = null;
    for (const i of reached)
      rooms.forEach((r, j) => {
        if (reached.has(j)) return;
        if (openLink(i, j)) {
          reached.add(j);
          return;
        }
        const sh = shared(rooms[i], r);
        if (!sh || sh.s1 - sh.s0 < 0.8) return;
        const base = priority(rooms[i], r);
        if (base >= 9 || (base < 0 && frontDone)) return;
        const p = base - Math.min(0.5, (sh.s1 - sh.s0) / 10);
        if (!best || p < best.p) best = { i, j, sh, p };
      });
    if (!best) break;
    const { i: from, j, sh } = best as { i: number; j: number; sh: NonNullable<ReturnType<typeof shared>>; p: number };
    const len = sh.s1 - sh.s0;
    const front = OUTDOOR.has(rooms[from].category) && index === 0;
    const width = front ? Math.min(1.0, len - 0.2) : Math.min(rooms[j].category === 'bathroom' ? 0.75 : 0.9, len - 0.2);
    // Front door centred on the verandah; others near one end of the wall (room for furniture).
    const at = front || len <= 2.4 ? (sh.s0 + sh.s1) / 2 : sh.s0 + 0.15 + width / 2;
    const w = wallOn(built, sh.horizontal, sh.c, at);
    if (w && width >= 0.6) {
      openings.push(door(w, sh.horizontal ? { x: at, y: sh.c } : { x: sh.c, y: at }, width, front ? 'D0' : width < 0.8 ? 'D2' : 'D1'));
      doored.add(j);
      if (front) frontDone = true;
    }
    reached.add(j);
  }

  // Front door: on the ground floor, the south face of the entrance room (or behind the verandah).
  if (index === 0 && rooms.length && !frontDone) {
    const e = rooms[entry];
    let placed = false;
    if (e.category === 'porch') {
      // From the verandah into the house through the shared facade wall.
      const inner = rooms.map((r, j) => ({ j, sh: shared(e, r) })).filter((x) => x.sh && !OUTDOOR.has(rooms[x.j].category)).sort((p, q) => q.sh!.s1 - q.sh!.s0 - (p.sh!.s1 - p.sh!.s0))[0];
      if (inner?.sh) {
        const m = (inner.sh.s0 + inner.sh.s1) / 2;
        const w = wallOn(built, inner.sh.horizontal, inner.sh.c, m);
        if (w) {
          openings.push(door(w, inner.sh.horizontal ? { x: m, y: inner.sh.c } : { x: inner.sh.c, y: m }, 1.0, 'D0'));
          placed = true;
        }
      }
    }
    if (!placed) {
      const maxY = Math.max(...rooms.map((r) => r.y + r.d));
      const south = rooms.filter((r) => Math.abs(r.y + r.d - maxY) < 0.05 && !OUTDOOR.has(r.category));
      const host = south.find((r) => CIRC.has(r.category)) ?? south[0] ?? e;
      const m = host.x + host.w / 2;
      const w = wallOn(built, true, host.y + host.d, m);
      if (w) openings.push(door(w, { x: m, y: host.y + host.d }, 1.0, 'D0'));
    }
  }

  // Windows: on each enclosed room's outside walls, the best one or two.
  for (const r of rooms) {
    if (OUTDOOR.has(r.category) || r.category === 'garage') continue;
    const edges = [
      { horizontal: true, c: r.y, s0: r.x, s1: r.x + r.w },
      { horizontal: true, c: r.y + r.d, s0: r.x, s1: r.x + r.w },
      { horizontal: false, c: r.x, s0: r.y, s1: r.y + r.d },
      { horizontal: false, c: r.x + r.w, s0: r.y, s1: r.y + r.d },
    ];
    const runs = edges
      .map((e) => {
        // Exterior stretch of this edge (longest contiguous).
        const ps = built.pieces.filter((p) => p.horizontal === e.horizontal && Math.abs(p.c - e.c) < 0.02 && p.a >= e.s0 - 1e-6 && p.b <= e.s1 + 1e-6 && built.pieceWall.get(p)?.isExterior && p.rooms.length === 1);
        if (!ps.length) return null;
        ps.sort((p, q) => q.b - q.a - (p.b - p.a));
        return { ...e, a: ps[0].a, b: ps[0].b, wall: built.pieceWall.get(ps[0])! };
      })
      .filter((x): x is NonNullable<typeof x> => !!x && x.b - x.a >= 1.0)
      .sort((p, q) => q.b - q.a - (p.b - p.a));
    const small = r.category === 'bathroom' || r.category === 'utility';
    const count = small || r.category === 'hallway' ? 1 : Math.min(2, runs.length);
    for (const run of runs.slice(0, count)) {
      const len = run.b - run.a;
      const width = small ? 0.6 : r.category === 'hallway' ? Math.min(0.9, len - 0.6) : Math.max(0.9, Math.min(1.5, len - 0.8));
      const m = (run.a + run.b) / 2;
      // Not on top of a door in the same wall.
      const clash = openings.some((o) => o.wallId === run.wall.id && Math.abs(o.offset * wallLen(run.wall) - along(run.wall, run.horizontal ? { x: m, y: run.c } : { x: run.c, y: m }) * wallLen(run.wall)) < (o.width + width) / 2 + 0.2);
      if (clash) continue;
      openings.push(windowOn(run.wall, run.horizontal ? { x: m, y: run.c } : { x: run.c, y: m }, width, small, small ? 'W2' : width >= 1.4 ? 'W1' : 'W3'));
    }
  }

  const roomObjs: Room[] = rooms.map((r) => ({
    id: uid('rm'),
    name: r.name,
    category: r.category,
    polygon: [
      { x: r.x, y: r.y },
      { x: r.x + r.w, y: r.y },
      { x: r.x + r.w, y: r.y + r.d },
      { x: r.x, y: r.y + r.d },
    ],
    finish: r.category === 'bathroom' ? 'ceramic_antiskid' : 'porcelain',
    ceilingHeight: 3.0,
  }));

  let lvl: FloorLevel = {
    id: `lvl_${index}`,
    index,
    name,
    elevation: below ? below.elevation + F2F : PLINTH,
    floorToFloorHeight: F2F,
    slabThickness: 0.15,
    walls: built.walls,
    openings,
    rooms: roomObjs,
    columns: [],
    stairs: [],
    furniture: rooms.flatMap(furnish),
    mepNodes: [],
    mepCircuits: [],
  };
  lvl.columns = autoPlaceStructuralColumns(lvl);
  return lvl;
}

export function buildFromDesign(d: AiDesign, meta: { title: string; client: string; clientPhone?: string; location: string }): BuildingProject {
  const levels: FloorLevel[] = [];
  d.floors.forEach((f, i) => {
    const name = f.name || (i === 0 ? 'Ground Floor' : `Level ${i}`);
    levels.push(buildLevel(f.rooms, i, i === 0 ? `${name} (FGL +${PLINTH.toFixed(2)}m)` : name, levels[i - 1] ?? null));
  });
  // Railings round every balcony and roof terrace above the ground floor.
  levels.forEach((l, i) => (levels[i] = withRailings(l)));
  // Stairs: a room named "Stair" on a floor and the floor above.
  for (let i = 0; i < levels.length - 1; i++) {
    const st = d.floors[i].rooms.find((r) => /stair/i.test(r.name));
    if (!st) continue;
    const alongY = st.d >= st.w;
    levels[i].stairs.push({
      id: uid('st'),
      origin: { x: S(st.x) + 0.1, y: S(st.y) + 0.1 },
      width: Math.max(0.9, (alongY ? st.w : st.d) - 0.2),
      length: Math.max(2, (alongY ? st.d : st.w) - 0.2),
      direction: alongY ? 'N' : 'E',
      shape: (alongY ? st.w : st.d) >= 2.2 ? 'u_shape' : 'straight',
      risers: Math.ceil(F2F / 0.175),
    });
  }
  const today = new Date().toISOString().slice(0, 10);

  // Finishes: floor tiles everywhere as specified; anti-slip in wet rooms and outside.
  const tile = d.finishes?.floor_tile;
  const wet = d.finishes?.wet_area_tile ?? tile;
  const spec = (t?: { size_mm?: number; colour?: string }, wetRoom = false) =>
    t ? `${t.size_mm ? `${t.size_mm}×${t.size_mm} ` : ''}${t.colour ?? ''} ${wetRoom && !/slip/i.test(t.colour ?? '') ? 'anti-slip ' : ''}porcelain tiles`.replace(/\s+/g, ' ').trim() : undefined;
  for (const lvl of levels)
    for (const r of lvl.rooms) {
      const wetRoom = r.category === 'bathroom' || r.category === 'utility' || r.category === 'porch' || r.category === 'balcony';
      const t = wetRoom ? wet : tile;
      if (!t) continue;
      r.finish = wetRoom ? 'ceramic_antiskid' : 'porcelain';
      r.floorSpec = spec(t, wetRoom);
      if (t.hex && /^#[0-9a-f]{6}$/i.test(t.hex)) r.floorColor = t.hex;
    }

  const project: BuildingProject = {
    id: uid('proj'),
    meta: {
      title: meta.title,
      projectCode: '',
      client: meta.client,
      clientPhone: meta.clientPhone,
      architect: '',
      location: meta.location,
      revision: 'P1',
      date: today,
      scale: '1:100 @ A3',
      plotWidth: d.plot.width,
      plotDepth: d.plot.depth,
      currency: '$',
    },
    grid: autoGenerateStructuralGrid(levels[0]),
    levels,
    roof: { type: d.roof.type, pitchDeg: d.roof.type === 'flat' ? 2 : Math.min(35, Math.max(12, d.roof.pitchDeg || 22)), overhang: d.roof.type === 'flat' ? 0.3 : 0.9, material: d.roof.type === 'flat' ? 'concrete_slab' : 'marine_metal', parapetHeight: d.roof.type === 'flat' ? 1.0 : 0.5 },
    sections: [],
    rates: { ...DEFAULT_BOQ_RATES },
  };

  // Site: the plot round the building (the design's origin is the building's north-west corner).
  const st = d.site;
  if (st || d.plot) {
    const g = st?.gate;
    project.site = {
      plot: { x: -(d.offset?.x ?? 0), y: -(d.offset?.y ?? 0), w: d.plot.width, d: d.plot.depth },
      boundary: !!st?.boundary_wall,
      boundaryHeight: Math.min(3, Math.max(0.9, st?.wall_height ?? 1.8)),
      boundaryThickness: 0.15,
      gates:
        st?.boundary_wall || g
          ? [
              {
                id: uid('gate'),
                side: g?.side ?? 'S',
                at: g?.centre ?? d.plot.width / 2,
                width: Math.min(6, Math.max(0.9, g?.width ?? 3.0)),
                kind: g?.kind ?? 'sliding',
                canopy: g?.canopy ?? 'none',
                pedestrianWidth: Math.max(0, Math.min(1.5, g?.pedestrian_width ?? 0.9)),
              },
            ]
          : [],
      meterAtGate: !!st?.meter_at_gate,
    };
  }

  // Services: solar, which rooms get AC, and where the boards go.
  const sv = d.services ?? {};
  project.solar = { ...DEFAULT_SOLAR_CONFIG, enabled: sv.solar ?? true };
  const acNames = sv.ac_rooms?.map((n) => n.trim().toLowerCase()).filter(Boolean);
  const acRoom = acNames ? (r: Room) => acNames.some((n) => r.name.toLowerCase() === n || r.name.toLowerCase().includes(n) || n.includes(r.name.toLowerCase())) : undefined;
  const sl = project.site ? siteLayout(project) : null;
  project.levels = project.levels.map((lvl, i) => {
    const pre: MEPNode[] = [];
    const inRoom = (name?: string) => (name ? lvl.rooms.find((r) => r.name.toLowerCase() === name.toLowerCase()) ?? lvl.rooms.find((r) => r.name.toLowerCase().includes(name.toLowerCase())) : undefined);
    const spot = (r: Room, k: number) => {
      const xs = r.polygon.map((q) => q.x);
      const ys = r.polygon.map((q) => q.y);
      return { x: Math.min(...xs) + 0.4 + k * 0.7, y: Math.min(...ys) + 0.15 };
    };
    if (i === 0) {
      const mdbRoom = inRoom(sv.mdb_room);
      if (mdbRoom) pre.push({ id: uid('mep'), kind: 'mdb', system: 'electrical', position: spot(mdbRoom, 0), label: 'MDB', roomId: mdbRoom.id });
      const invRoom = inRoom(sv.inverter_room) ?? mdbRoom;
      if (invRoom && project.solar?.enabled) {
        pre.push({ id: uid('mep'), kind: 'solar_inv', system: 'electrical', position: spot(invRoom, 1), label: 'INV', roomId: invRoom.id });
        pre.push({ id: uid('mep'), kind: 'solar_bess', system: 'electrical', position: spot(invRoom, 2), label: 'BAT', roomId: invRoom.id });
      }
      if (sl?.meter) pre.push({ id: uid('mep'), kind: 'utility_meter', system: 'electrical', position: { x: Number(sl.meter.at.x.toFixed(2)), y: Number(sl.meter.at.y.toFixed(2)) }, label: 'M' });
    }
    return autoPopulateMEPForLevel({ ...lvl, mepNodes: pre, mepCircuits: [] }, i === 0 && !!project.solar?.enabled, true, false, acRoom);
  });
  return project;
}
