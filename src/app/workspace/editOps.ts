/**
 * Precise design edits the AI Architect proposes: change, move, resize or delete a specific
 * element by its id, or place items from the asset library. They are applied here, in code,
 * so the result is exactly what was proposed, and every edit is reported back.
 */
import type { BuildingProject, FloorLevel, Point2D } from '../../model/types';
import { getSolarConfig } from '../../model/types';
import { uid } from '../../engine/geometry';
import { ASSET_BY_ID, ASSETS } from '../drawing/assets/catalog';

export type EditOp =
  | { op: 'add_item'; asset: string; x: number; y: number; rotation?: number; width?: number; depth?: number; height?: number; level?: number }
  | { op: 'add_opening'; asset: string; wall_id: string; at?: number; width?: number; height?: number; sill?: number }
  | { op: 'add_wall'; x1: number; y1: number; x2: number; y2: number; thickness?: number; height?: number; exterior?: boolean; material?: string; level?: number }
  | { op: 'move'; id: string; x?: number; y?: number; dx?: number; dy?: number; rotation?: number }
  | { op: 'resize'; id: string; width?: number; depth?: number; height?: number }
  | { op: 'set'; id: string; props: Record<string, unknown> }
  | { op: 'delete'; id: string }
  | { op: 'set_roof'; props: Record<string, unknown> }
  | { op: 'set_solar'; props: Record<string, unknown> };

type Found =
  | { kind: 'wall'; lvl: FloorLevel; i: number }
  | { kind: 'opening'; lvl: FloorLevel; i: number }
  | { kind: 'room'; lvl: FloorLevel; i: number }
  | { kind: 'furniture'; lvl: FloorLevel; i: number }
  | { kind: 'mep'; lvl: FloorLevel; i: number }
  | { kind: 'column'; lvl: FloorLevel; i: number };

function find(m: BuildingProject, id: string): Found | null {
  for (const lvl of m.levels) {
    const tries: [Found['kind'], { id: string }[]][] = [
      ['wall', lvl.walls],
      ['opening', lvl.openings],
      ['room', lvl.rooms],
      ['furniture', lvl.furniture],
      ['mep', lvl.mepNodes],
      ['column', lvl.columns],
    ];
    for (const [kind, arr] of tries) {
      const i = arr.findIndex((x) => x.id === id);
      if (i >= 0) return { kind, lvl, i } as Found;
    }
  }
  return null;
}

const num = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : undefined);
const r2 = (v: number) => Math.round(v * 100) / 100;

/** Allowed property changes per element kind, with limits. Anything else is ignored. */
const SETTABLE: Record<string, Record<string, (v: unknown) => unknown>> = {
  wall: {
    thickness: (v) => num(v, 0.075, 0.6),
    height: (v) => num(v, 0.5, 8),
    isExterior: (v) => (typeof v === 'boolean' ? v : undefined),
    isLoadBearing: (v) => (typeof v === 'boolean' ? v : undefined),
    material: (v) => (['brick', 'cmu', 'cinder_block', 'coral_stone', 'concrete', 'timber', 'drywall'].includes(v as string) ? v : undefined),
  },
  opening: {
    style: (v) => (['single', 'double', 'sliding', 'garage', 'casement', 'picture', 'bay'].includes(v as string) ? v : undefined),
    width: (v) => num(v, 0.3, 6),
    height: (v) => num(v, 0.3, 3.5),
    sillHeight: (v) => num(v, 0, 2.4),
    offset: (v) => num(v, 0.02, 0.98),
    swingDirection: (v) => (v === 1 || v === -1 ? v : undefined),
    label: (v) => (typeof v === 'string' ? v.slice(0, 12) : undefined),
    frameColor: (v) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : undefined),
    finish: (v) => (typeof v === 'string' ? v.slice(0, 40) : undefined),
  },
  room: {
    name: (v) => (typeof v === 'string' ? v.slice(0, 60) : undefined),
    category: (v) => (typeof v === 'string' ? v : undefined),
    finish: (v) => (typeof v === 'string' ? v : undefined),
    ceilingHeight: (v) => num(v, 2.1, 6),
  },
  furniture: {
    elevation: (v) => num(v, 0, 4),
    height: (v) => num(v, 0.01, 12),
  },
  mep: {
    label: (v) => (typeof v === 'string' ? v.slice(0, 40) : undefined),
    wattage: (v) => num(v, 0, 20000),
    model: (v) => (typeof v === 'string' && ASSET_BY_ID.has(v) ? v : undefined),
  },
};

export interface EditResult {
  next: BuildingProject;
  applied: string[];
  failed: string[];
}

export function applyEdits(model: BuildingProject, ops: EditOp[]): EditResult {
  const next = structuredClone(model);
  const applied: string[] = [];
  const failed: string[] = [];
  const level = (i?: number) => next.levels[Math.max(0, Math.min(next.levels.length - 1, Math.round(i ?? 0)))];
  const nameOf = (f: Found) => {
    if (f.kind === 'room') return f.lvl.rooms[f.i].name;
    if (f.kind === 'opening') return f.lvl.openings[f.i].label ?? f.lvl.openings[f.i].kind;
    if (f.kind === 'furniture') return ASSET_BY_ID.get(f.lvl.furniture[f.i].type)?.name ?? f.lvl.furniture[f.i].type;
    if (f.kind === 'mep') return f.lvl.mepNodes[f.i].label ?? f.lvl.mepNodes[f.i].kind;
    return f.kind;
  };

  for (const e of ops.slice(0, 60)) {
    try {
      switch (e.op) {
        case 'add_item': {
          const def = ASSET_BY_ID.get(e.asset);
          if (!def || def.opening) throw new Error(`unknown library item "${e.asset}"`);
          const lvl = level(e.level);
          const pos: Point2D = { x: r2(e.x), y: r2(e.y) };
          const rot = (((e.rotation ?? 0) % 360) + 360) % 360;
          if (def.mep) lvl.mepNodes.push({ id: uid('mep'), kind: def.mep.kind, system: def.mep.system, position: pos, wattage: def.mep.wattage, model: def.id, rotation: rot, label: def.name });
          else lvl.furniture.push({ id: uid('f'), type: def.id, position: pos, rotation: rot, width: num(e.width, 0.1, 60) ?? def.w, depth: num(e.depth, 0.05, 60) ?? def.d, ...(e.height ? { height: num(e.height, 0.01, 20) } : {}) });
          applied.push(`Added ${def.name}`);
          break;
        }
        case 'add_opening': {
          const def = ASSET_BY_ID.get(e.asset);
          const f = find(next, e.wall_id);
          if (!def?.opening) throw new Error(`"${e.asset}" is not a door or window`);
          if (!f || f.kind !== 'wall') throw new Error(`no wall ${e.wall_id}`);
          const w = f.lvl.walls[f.i];
          const len = Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y);
          const width = num(e.width, 0.3, len - 0.1) ?? def.w;
          const at = num(e.at, width / 2, len - width / 2) ?? len / 2;
          const o = def.opening;
          f.lvl.openings.push({
            id: uid('op'),
            wallId: w.id,
            kind: o.kind,
            style: o.style,
            offset: at / len,
            width,
            height: num(e.height, 0.3, 3.5) ?? o.height,
            sillHeight: num(e.sill, 0, 2.4) ?? o.sill,
            swingDirection: 1,
            label: `${o.kind === 'door' ? 'D' : 'W'}${f.lvl.openings.filter((x) => x.kind === o.kind).length + 1}`,
          });
          applied.push(`Added ${def.name}`);
          break;
        }
        case 'add_wall': {
          const lvl = level(e.level);
          const ext = e.exterior ?? true;
          lvl.walls.push({
            id: uid('w'),
            start: { x: r2(e.x1), y: r2(e.y1) },
            end: { x: r2(e.x2), y: r2(e.y2) },
            thickness: num(e.thickness, 0.075, 0.6) ?? (ext ? 0.23 : 0.15),
            height: num(e.height, 0.5, 8) ?? lvl.floorToFloorHeight - lvl.slabThickness,
            isExterior: ext,
            isLoadBearing: ext,
            material: (SETTABLE.wall.material(e.material) as never) ?? 'cinder_block',
          });
          applied.push(`Added a wall`);
          break;
        }
        case 'move': {
          const f = find(next, e.id);
          if (!f) throw new Error(`no element ${e.id}`);
          const shift = (p: Point2D) => ({ x: r2(e.x ?? p.x + (e.dx ?? 0)), y: r2(e.y ?? p.y + (e.dy ?? 0)) });
          if (f.kind === 'furniture') {
            const it = f.lvl.furniture[f.i];
            it.position = shift(it.position);
            if (e.rotation !== undefined) it.rotation = ((e.rotation % 360) + 360) % 360;
          } else if (f.kind === 'mep') {
            const n = f.lvl.mepNodes[f.i];
            n.position = shift(n.position);
            if (e.rotation !== undefined) n.rotation = ((e.rotation % 360) + 360) % 360;
          } else if (f.kind === 'column') {
            f.lvl.columns[f.i].position = shift(f.lvl.columns[f.i].position);
          } else if (f.kind === 'opening') {
            // Along its wall: x/dx are metres along the wall.
            const o = f.lvl.openings[f.i];
            const w = f.lvl.walls.find((x) => x.id === o.wallId)!;
            const len = Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y);
            const s = e.x ?? o.offset * len + (e.dx ?? 0);
            o.offset = Math.min(1 - o.width / 2 / len, Math.max(o.width / 2 / len, s / len));
          } else throw new Error(`${f.kind}s can't be moved this way`);
          applied.push(`Moved ${nameOf(f)}`);
          break;
        }
        case 'resize': {
          const f = find(next, e.id);
          if (!f) throw new Error(`no element ${e.id}`);
          if (f.kind === 'furniture') {
            const it = f.lvl.furniture[f.i];
            it.width = num(e.width, 0.1, 60) ?? it.width;
            it.depth = num(e.depth, 0.05, 60) ?? it.depth;
            if (e.height) it.height = num(e.height, 0.01, 20);
          } else if (f.kind === 'opening') {
            const o = f.lvl.openings[f.i];
            o.width = num(e.width, 0.3, 6) ?? o.width;
            o.height = num(e.height, 0.3, 3.5) ?? o.height;
          } else if (f.kind === 'column') {
            const c = f.lvl.columns[f.i];
            c.width = num(e.width, 0.15, 1.2) ?? c.width;
            c.depth = num(e.depth, 0.15, 1.2) ?? c.depth;
          } else throw new Error(`${f.kind}s can't be resized this way`);
          applied.push(`Resized ${nameOf(f)}`);
          break;
        }
        case 'set': {
          const f = find(next, e.id);
          if (!f) throw new Error(`no element ${e.id}`);
          const rules = SETTABLE[f.kind];
          if (!rules) throw new Error(`${f.kind}s have no settable properties`);
          const target = (f.kind === 'wall' ? f.lvl.walls : f.kind === 'opening' ? f.lvl.openings : f.kind === 'room' ? f.lvl.rooms : f.kind === 'furniture' ? f.lvl.furniture : f.lvl.mepNodes)[f.i] as unknown as Record<string, unknown>;
          const changed: string[] = [];
          for (const [k, v] of Object.entries(e.props ?? {})) {
            const ok = rules[k]?.(v);
            if (ok !== undefined) {
              target[k] = ok;
              changed.push(k);
            }
          }
          if (!changed.length) throw new Error(`nothing valid to change on ${nameOf(f)}`);
          applied.push(`Changed ${nameOf(f)} (${changed.join(', ')})`);
          break;
        }
        case 'delete': {
          const f = find(next, e.id);
          if (!f) throw new Error(`no element ${e.id}`);
          const label = nameOf(f);
          if (f.kind === 'wall') {
            const id = f.lvl.walls[f.i].id;
            f.lvl.walls.splice(f.i, 1);
            f.lvl.openings = f.lvl.openings.filter((o) => o.wallId !== id);
          } else (f.kind === 'opening' ? f.lvl.openings : f.kind === 'room' ? f.lvl.rooms : f.kind === 'furniture' ? f.lvl.furniture : f.kind === 'mep' ? f.lvl.mepNodes : f.lvl.columns).splice(f.i, 1);
          applied.push(`Removed ${label}`);
          break;
        }
        case 'set_roof': {
          const p = e.props ?? {};
          const r = next.roof;
          if (['gable', 'hip', 'flat', 'shed'].includes(p.type as string)) r.type = p.type as never;
          if (num(p.pitchDeg, 1, 60) !== undefined) r.pitchDeg = num(p.pitchDeg, 1, 60)!;
          if (num(p.overhang, 0, 2) !== undefined) r.overhang = num(p.overhang, 0, 2)!;
          if (typeof p.material === 'string') r.material = p.material as never;
          if (num(p.parapetHeight, 0, 2) !== undefined) r.parapetHeight = num(p.parapetHeight, 0, 2)!;
          applied.push('Changed the roof');
          break;
        }
        case 'set_solar': {
          const p = e.props ?? {};
          const s = getSolarConfig(next);
          next.solar = {
            ...s,
            ...(typeof p.enabled === 'boolean' ? { enabled: p.enabled } : {}),
            ...(num(p.panelCount, 0, 80) !== undefined ? { panelCount: Math.round(num(p.panelCount, 0, 80)!) } : {}),
            ...(num(p.panelWattage, 100, 800) !== undefined ? { panelWattage: num(p.panelWattage, 100, 800)! } : {}),
            ...(num(p.inverterKW, 1, 30) !== undefined ? { inverterKW: num(p.inverterKW, 1, 30)! } : {}),
            ...(num(p.batteryKWh, 0, 60) !== undefined ? { batteryKWh: num(p.batteryKWh, 0, 60)! } : {}),
            ...(num(p.offsetX, -30, 30) !== undefined ? { offsetX: num(p.offsetX, -30, 30)! } : {}),
            ...(num(p.offsetY, -30, 30) !== undefined ? { offsetY: num(p.offsetY, -30, 30)! } : {}),
            ...([0, 90, 180, 270].includes(p.rotationDeg as number) ? { rotationDeg: p.rotationDeg as number } : {}),
            ...(['south', 'north', 'east', 'west'].includes(p.roofFace as string) ? { roofFace: p.roofFace as never } : {}),
          };
          applied.push('Changed the solar array');
          break;
        }
        default:
          throw new Error(`unknown edit "${(e as { op?: string }).op}"`);
      }
    } catch (err) {
      failed.push(err instanceof Error ? err.message : String(err));
    }
  }
  return { next, applied, failed };
}

/** Compact list of the library for the AI: id, name, category and default size. */
export function libraryForAI() {
  return ASSETS.map((a) => `${a.id}: ${a.name} [${a.category}] ${a.w}×${a.d}×${a.h}m${a.mount && a.mount !== 'floor' ? ` (${a.mount})` : ''}${a.opening ? ' (door/window: use add_opening)' : ''}`);
}
