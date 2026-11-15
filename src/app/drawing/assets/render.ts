/** Turning library items placed in a project into 3D objects and plan symbols. */
import * as THREE from 'three';
import type { FloorLevel, FurnitureItem, MEPNode } from '../../../model/types';
import { ASSET_BY_ID, assetFor, MEP_DEFAULT_ASSET, type AssetDef } from './catalog';
import { AssetMaterials, buildParts, partsToPlan, renderThumb, type Prim } from './kit';

export const WALL_SIDE_ROT: Record<string, number> = { north: 0, east: 90, south: 180, west: 270 };

/** True for things seen from below in plan (drawn dashed): ceiling items and high wall units. */
export const isOverhead = (def: AssetDef, elevation = def.elevation ?? 0) => def.mount === 'ceiling' || (def.mount === 'wall' && elevation >= 1.2);

export function assetModel(def: AssetDef, w: number, d: number, h: number, mats: AssetMaterials, shadows = true) {
  return buildParts(def.parts ? def.parts(w, d, h) : [], mats, shadows);
}

/** Plan symbol in item-local metres (origin at the centre, back edge at -d/2). */
export function assetPlan(def: AssetDef, w: number, d: number, h = def.h, overhead = isOverhead(def)): Prim[] {
  const prims = def.parts ? partsToPlan(def.parts(w, d, h), overhead) : [];
  if (def.symbol) prims.push(...def.symbol(w, d).map((p) => (overhead ? { ...p, style: 'dash' as const } : p)));
  if (!prims.length) prims.push({ k: 'rect', x: -w / 2, y: -d / 2, w, h: d, style: overhead ? 'dash' : 'fill' });
  return prims;
}

const OUTSIDE = new Set(['outdoor', 'trees', 'boundary']);

/**
 * `groundY` is where outdoor things (trees, gates, cars) stand when placed on the ground floor:
 * the site, not the raised floor slab.
 */
export function furnitureObject(f: FurnitureItem, levelElevation: number, mats: AssetMaterials, groundY: number | null = null): THREE.Object3D {
  const def = assetFor(f.type);
  if (groundY !== null && (OUTSIDE.has(def?.category ?? '') || f.type === 'car')) levelElevation = groundY;
  const h = f.height ?? def?.h ?? 0.75;
  let obj: THREE.Object3D;
  if (def?.parts) obj = assetModel(def, f.width, f.depth, h, mats);
  else {
    obj = new THREE.Mesh(new THREE.BoxGeometry(f.width, h, f.depth), mats.get('offwhite'));
    obj.position.y = h / 2;
    const g = new THREE.Group();
    g.add(obj);
    obj = g;
  }
  const lift = def?.mount === 'wall' ? (f.elevation ?? def.elevation ?? 0) : (f.elevation ?? 0);
  obj.position.set(f.position.x, levelElevation + lift, f.position.y);
  obj.rotation.y = (-f.rotation * Math.PI) / 180;
  obj.userData = { kind: 'furniture', id: f.id };
  obj.traverse((o) => {
    o.userData.solid = true;
    o.userData.pick = { kind: 'furniture', id: f.id };
  });
  return obj;
}

/** The library model shown for a service point (AC, fan, light), or null if it has none. */
export function mepAsset(n: MEPNode): AssetDef | undefined {
  const id = n.model ?? MEP_DEFAULT_ASSET[n.kind];
  return id ? ASSET_BY_ID.get(id) : undefined;
}

export function mepObject(n: MEPNode, lvl: FloorLevel, ceilingY: number, mats: AssetMaterials): THREE.Object3D | null {
  const def = mepAsset(n);
  if (!def?.parts) return null;
  const obj = assetModel(def, def.w, def.d, def.h, mats, def.mount !== 'ceiling');
  const y = def.mount === 'ceiling' ? ceilingY - def.h : def.mount === 'wall' ? lvl.elevation + (def.elevation ?? 2) : lvl.elevation;
  obj.position.set(n.position.x, y, n.position.y);
  const rot = n.rotation ?? (n.wallSide ? WALL_SIDE_ROT[n.wallSide] : 0);
  obj.rotation.y = (-rot * Math.PI) / 180;
  obj.traverse((o) => {
    o.userData.solid = true;
    o.userData.pick = { kind: 'mep_node', id: n.id };
  });
  return obj;
}

export function assetThumb(def: AssetDef): string | null {
  return renderThumb(def.id, (mats) => assetModel(def, def.w, def.d, def.h, mats, false));
}
