/**
 * Placing a library item at a point picked in 3D (walk mode): on a wall face, on the floor, or
 * under the ceiling, the right way round.
 */
import type { BuildingProject, SelectableElementKind } from '../../../model/types';
import { uid } from '../../../engine/geometry';
import { along, nearestWall, wallFrame } from '../plan/kernel';
import type { AssetDef } from './catalog';

export type Surface = 'wall' | 'floor' | 'ceiling';

/** Which library items can go on a surface. */
export function fitsSurface(def: AssetDef, s: Surface) {
  if (s === 'wall') return def.mount === 'wall' || !!def.opening;
  if (s === 'ceiling') return def.mount === 'ceiling';
  return !def.opening && (def.mount ?? 'floor') === 'floor';
}

export function placeAssetAt(
  model: BuildingProject,
  levelIndex: number,
  def: AssetDef,
  at: { x: number; y: number },
  surface: Surface,
  viewer: { x: number; y: number }
): { next: BuildingProject; id: string; kind: SelectableElementKind } | null {
  const next = structuredClone(model);
  const lvl = next.levels[levelIndex] ?? next.levels[0];
  const r2 = (v: number) => Math.round(v * 100) / 100;
  let pos = { x: r2(at.x), y: r2(at.y) };
  let rot = 0;

  if (surface === 'wall' || def.opening || def.mount === 'wall') {
    const hit = nearestWall(lvl, at, 1.0);
    if (!hit) return null;
    const f = wallFrame(hit.wall);
    if (def.opening) {
      const half = def.w / 2;
      if (f.length < def.w + 0.1) return null;
      const s = Math.min(f.length - half, Math.max(half, hit.t * f.length));
      const o = def.opening;
      const id = uid('op');
      lvl.openings.push({
        id,
        wallId: hit.wall.id,
        kind: o.kind,
        style: o.style,
        offset: s / f.length,
        width: def.w,
        height: o.height,
        sillHeight: o.sill,
        swingDirection: 1,
        label: `${o.kind === 'door' ? 'D' : 'W'}${lvl.openings.filter((x) => x.kind === o.kind).length + 1}`,
      });
      return { next, id, kind: 'opening' };
    }
    // Back against the face the viewer is looking at.
    const s = Math.min(f.length - def.w / 2, Math.max(def.w / 2, hit.t * f.length));
    const rel = { x: viewer.x - hit.wall.start.x, y: viewer.y - hit.wall.start.y };
    const side = rel.x * f.n.x + rel.y * f.n.y >= 0 ? 1 : -1;
    pos = along(f, s, side * (hit.wall.thickness / 2 + def.d / 2 + 0.005));
    pos = { x: r2(pos.x), y: r2(pos.y) };
    rot = Math.round((Math.atan2(-f.n.x * side, f.n.y * side) * 180) / Math.PI + 360) % 360;
  } else if (surface === 'floor') {
    // Facing the viewer.
    const dx = viewer.x - at.x;
    const dy = viewer.y - at.y;
    rot = Math.round(((Math.atan2(-dx, dy) * 180) / Math.PI + 360) / 15) * 15 % 360;
  }

  if (def.custom) next.customAssets = { ...(next.customAssets ?? {}), [def.id]: def.custom as never };
  if (def.mep) {
    const id = uid('mep');
    lvl.mepNodes.push({ id, kind: def.mep.kind, system: def.mep.system, position: pos, wattage: def.mep.wattage, model: def.id, rotation: rot, label: def.name });
    return { next, id, kind: 'mep_node' };
  }
  const id = uid('f');
  lvl.furniture.push({ id, type: def.id, position: pos, rotation: rot, width: def.w, depth: def.d });
  return { next, id, kind: 'furniture' };
}
