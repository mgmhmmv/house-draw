/**
 * Turning a click in the 3D view into a model element. Library objects carry their id; the
 * building shell is merged by material, so walls, openings, rooms and solar panels are found
 * from where the ray hit.
 */
import { siteLayout } from '../model3d/site';
import * as THREE from 'three';
import type { BuildingProject, FloorLevel, SelectableElementKind } from '../../../model/types';
import { computeSolarArrayLayout } from '../../../engine/geometry';
import { wallFrame } from '../plan/kernel';
import { assetFor } from '../assets/catalog';
import { mepAsset, mepSize, WALL_SIDE_ROT } from '../assets/render';

export interface Picked {
  id: string;
  kind: SelectableElementKind;
}

const inPoly = (pts: { x: number; y: number }[], x: number, y: number) => {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++)
    if (pts[i].y > y !== pts[j].y > y && x < ((pts[j].x - pts[i].x) * (y - pts[i].y)) / (pts[j].y - pts[i].y) + pts[i].x) inside = !inside;
  return inside;
};

function levelAt(model: BuildingProject, h: number): FloorLevel {
  let best = model.levels[0];
  for (const l of model.levels) if (l.elevation <= h + 0.05) best = l;
  return best;
}

function nearestWall(lvl: FloorLevel, x: number, y: number) {
  let best: { id: string; d: number; s: number; len: number } | null = null;
  for (const w of lvl.walls) {
    const f = wallFrame(w);
    if (f.length < 0.05) continue;
    const rx = x - w.start.x;
    const ry = y - w.start.y;
    const s = Math.max(0, Math.min(f.length, rx * f.dir.x + ry * f.dir.y));
    const d = Math.abs(rx * f.n.x + ry * f.n.y) - w.thickness / 2;
    const off = Math.max(0, Math.max(-(rx * f.dir.x + ry * f.dir.y), rx * f.dir.x + ry * f.dir.y - f.length));
    const dd = Math.max(d, 0) + off;
    if (!best || dd < best.d) best = { id: w.id, d: dd, s, len: f.length };
  }
  return best;
}

export function resolvePick(model: BuildingProject, hit: THREE.Intersection): Picked | null {
  // Library objects and fixtures know who they are.
  let o: THREE.Object3D | null = hit.object;
  while (o) {
    if (o.userData.pick) return o.userData.pick as Picked;
    o = o.parent;
  }
  const kind = hit.object.userData.kind as string | undefined;
  const { x, y: h, z: y } = hit.point; // three (x, up, z) → plan (x, y)
  const lvl = levelAt(model, h);

  if (kind === 'solar') {
    const layout = computeSolarArrayLayout(model);
    let best: { i: number; d: number } | null = null;
    for (const p of layout.panels) {
      const d = Math.hypot(p.x - x, p.y - y);
      if (!best || d < best.d) best = { i: p.index, d };
    }
    return best ? { id: `solar_panel_${best.i}`, kind: 'solar_panel' } : null;
  }

  if (kind === 'glass' || kind === 'frame' || kind === 'sill' || kind === 'door' || kind === 'reveal' || kind === 'wall') {
    const w = nearestWall(lvl, x, y);
    if (!w || w.d > 0.6) return null;
    // On an opening of that wall?
    const openings = lvl.openings.filter((op) => op.wallId === w.id);
    const local = h - lvl.elevation;
    for (const op of openings) {
      const c = op.offset * w.len;
      if (Math.abs(w.s - c) <= op.width / 2 + 0.06 && local >= op.sillHeight - 0.1 && local <= op.sillHeight + op.height + 0.12) return { id: op.id, kind: 'opening' };
    }
    if (kind !== 'wall' && kind !== 'reveal') {
      // Hit glass/frame but outside the rough box: nearest opening along the wall.
      let best: { id: string; d: number } | null = null;
      for (const op of openings) {
        const d = Math.abs(w.s - op.offset * w.len);
        if (!best || d < best.d) best = { id: op.id, d };
      }
      if (best) return { id: best.id, kind: 'opening' };
    }
    return { id: w.id, kind: 'wall' };
  }

  if (kind === 'floor' || kind === 'ceiling' || kind === 'slab') {
    const r = lvl.rooms.find((rm) => inPoly(rm.polygon, x, y));
    if (r) return { id: r.id, kind: 'room' };
  }
  return null;
}

/** A click in walk mode: what was hit, which kind of surface, and where (plan metres). */
export interface WalkHit {
  pick: Picked | null;
  surface: 'wall' | 'floor' | 'ceiling' | 'object';
  at: { x: number; y: number };
  levelIndex: number;
}

export function resolveHit(model: BuildingProject, hit: THREE.Intersection): WalkHit {
  const kind = (hit.object.userData.kind as string | undefined) ?? '';
  const lvl = levelAt(model, hit.point.y);
  const levelIndex = Math.max(0, model.levels.indexOf(lvl));
  const at = { x: hit.point.x, y: hit.point.z };
  if (kind === 'ground') return { pick: null, surface: 'floor', at, levelIndex: 0 };
  const pick = resolvePick(model, hit);
  let o: THREE.Object3D | null = hit.object;
  while (o) {
    if (o.userData.pick) return { pick, surface: 'object', at, levelIndex };
    o = o.parent;
  }
  const surface = kind === 'ceiling' ? 'ceiling' : kind === 'floor' || kind === 'slab' ? 'floor' : 'wall';
  return { pick, surface, at, levelIndex };
}

/** An outline box around the selected element, in world space. */
export function selectionOutline(model: BuildingProject, id: string, kind: SelectableElementKind | undefined, color = '#2F55D4'): THREE.Object3D | null {
  const mat = new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.95 });
  const boxAt = (cx: number, cy: number, cz: number, w: number, hh: number, d: number, yaw: number) => {
    const g = new THREE.EdgesGeometry(new THREE.BoxGeometry(w, hh, d));
    const ls = new THREE.LineSegments(g, mat);
    ls.position.set(cx, cy, cz);
    ls.rotation.y = yaw;
    ls.renderOrder = 10;
    return ls;
  };
  for (const lvl of model.levels) {
    const top = Math.max(...lvl.walls.map((w) => w.height), 2.4);
    if (kind === 'wall') {
      const w = lvl.walls.find((x) => x.id === id);
      if (w) {
        const f = wallFrame(w);
        return boxAt((w.start.x + w.end.x) / 2, lvl.elevation + w.height / 2, (w.start.y + w.end.y) / 2, f.length + 0.02, w.height + 0.02, w.thickness + 0.04, -Math.atan2(f.dir.y, f.dir.x));
      }
    }
    if (kind === 'opening') {
      const op = lvl.openings.find((x) => x.id === id);
      const w = op && lvl.walls.find((x) => x.id === op.wallId);
      if (op && w) {
        const f = wallFrame(w);
        const s = op.offset * f.length;
        return boxAt(w.start.x + f.dir.x * s, lvl.elevation + op.sillHeight + op.height / 2, w.start.y + f.dir.y * s, op.width + 0.04, op.height + 0.04, w.thickness + 0.1, -Math.atan2(f.dir.y, f.dir.x));
      }
    }
    if (kind === 'room') {
      const r = lvl.rooms.find((x) => x.id === id);
      if (r) {
        const pts = r.polygon.map((p) => new THREE.Vector3(p.x, lvl.elevation + 0.03, p.y));
        const g = new THREE.BufferGeometry().setFromPoints([...pts, pts[0]]);
        const l = new THREE.Line(g, mat);
        l.renderOrder = 10;
        return l;
      }
    }
    if (kind === 'furniture') {
      const f = lvl.furniture.find((x) => x.id === id);
      if (f) {
        const def = assetFor(f.type);
        const hh = f.height ?? def?.h ?? 0.75;
        const lift = def?.mount === 'wall' ? (f.elevation ?? def.elevation ?? 0) : 0;
        return boxAt(f.position.x, lvl.elevation + lift + hh / 2, f.position.y, f.width + 0.04, hh + 0.04, f.depth + 0.04, (-f.rotation * Math.PI) / 180);
      }
    }
    if (kind === 'mep_node') {
      const n = lvl.mepNodes.find((x) => x.id === id);
      const def = n && mepAsset(n);
      if (n && def) {
        const sz = mepSize(n, def);
        const y = def.mount === 'ceiling' ? lvl.elevation + top - sz.h / 2 : def.mount === 'wall' ? lvl.elevation + (n.elevation ?? def.elevation ?? 2) + sz.h / 2 : lvl.elevation + (n.elevation ?? 0) + sz.h / 2;
        const rot = n.rotation ?? (n.wallSide ? WALL_SIDE_ROT[n.wallSide] : 0);
        return boxAt(n.position.x, y, n.position.y, sz.w + 0.04, sz.h + 0.04, sz.d + 0.04, (-rot * Math.PI) / 180);
      }
    }
  }
  if (kind === 'boundary' || kind === 'gate') {
    const sl = siteLayout(model);
    if (kind === 'boundary') {
      const p = sl.plot;
      return boxAt(p.x + p.w / 2, sl.height / 2, p.y + p.d / 2, p.w + 0.3, sl.height + 0.2, p.d + 0.3, 0);
    }
    const g = sl.gates.find((x) => `gate:${x.gate.id}` === id);
    if (g) {
      const len = Math.hypot(g.span.b.x - g.span.a.x, g.span.b.y - g.span.a.y) + 0.6;
      const across = g.gate.canopy !== 'none' ? 1.7 : 0.6;
      const horiz = Math.abs(g.span.a.y - g.span.b.y) < 1e-6;
      return boxAt((g.span.a.x + g.span.b.x) / 2, 1.4, (g.span.a.y + g.span.b.y) / 2, horiz ? len : across, 2.9, horiz ? across : len, 0);
    }
  }
  if (kind === 'solar_panel') {
    const i = Number(id.replace('solar_panel_', ''));
    const p = computeSolarArrayLayout(model).panels.find((q) => q.index === i);
    if (p) {
      const roofTop = Math.max(...model.levels.map((l) => l.elevation + Math.max(...l.walls.map((w) => w.height), 2.4)));
      return boxAt(p.x, roofTop + 1.2, p.y, p.width + 0.04, 2.6, p.depth + 0.04, (-p.rotationDeg * Math.PI) / 180);
    }
  }
  return null;
}
