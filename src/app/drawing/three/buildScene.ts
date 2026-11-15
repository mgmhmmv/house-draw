/**
 * Turns the shared face model into three.js meshes, so the 3D view, elevations and sections
 * are all drawn from exactly the same building.
 *
 * Plan axes (x east, y south, z up) map to three.js as (x, z, y): y is up in three.js.
 */
import * as THREE from 'three';
import type { BuildingProject } from '../../../model/types';
import { buildFrame, type Face, type FaceKind, type V3 } from '../model3d/faces';
import { ROOM_TINT } from '../style';

const T = (p: V3) => new THREE.Vector3(p.x, p.z, p.y);

export interface SceneParts {
  /** One group per level (walls, openings, floors), plus the roof. */
  levels: THREE.Group[];
  roof: THREE.Group;
  edges: THREE.LineSegments[];
  materials: THREE.Material[];
  box: THREE.Box3;
  levelElevations: number[];
}

interface Bucket {
  kind: FaceKind | 'floor';
  color: string;
  pos: number[];
  nrm: number[];
}

/** Triangulate a planar polygon (with holes) in its own 2D basis. */
function triangulate(face: { pts: V3[]; holes?: V3[][]; n: V3 }, out: Bucket) {
  const pts = face.pts.map(T);
  if (pts.length < 3) return;
  const n = new THREE.Vector3(face.n.x, face.n.z, face.n.y).normalize();
  const u = new THREE.Vector3().subVectors(pts[1], pts[0]);
  if (u.lengthSq() < 1e-10) return;
  u.normalize();
  const v = new THREE.Vector3().crossVectors(n, u).normalize();
  const to2 = (p: THREE.Vector3) => new THREE.Vector2(p.dot(u), p.dot(v));
  const contour = pts.map(to2);
  const holes = (face.holes ?? []).map((h) => h.map(T).map(to2));
  const all = [...pts, ...(face.holes ?? []).flatMap((h) => h.map(T))];
  const tris = THREE.ShapeUtils.triangulateShape(contour, holes);
  for (const [a, b, c] of tris) {
    for (const i of [a, b, c]) {
      out.pos.push(all[i].x, all[i].y, all[i].z);
      out.nrm.push(n.x, n.y, n.z);
    }
  }
}

function edgesOf(face: { pts: V3[]; holes?: V3[][]; lines?: [V3, V3][]; sash?: [V3, V3][] }, out: number[]) {
  for (const ring of [face.pts, ...(face.holes ?? [])]) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      out.push(a.x, a.z, a.y, b.x, b.z, b.y);
    }
  }
  for (const [a, b] of [...(face.lines ?? []), ...(face.sash ?? [])]) out.push(a.x, a.z, a.y, b.x, b.z, b.y);
}

export function materialFor(kind: Bucket['kind'], color: string, clay: boolean): THREE.Material {
  if (kind === 'glass') {
    return new THREE.MeshPhysicalMaterial({
      color: clay ? '#C9D6DE' : '#8FA9B8',
      roughness: 0.08,
      metalness: 0,
      transparent: true,
      opacity: clay ? 0.55 : 0.42,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
  }
  const base = clay ? (kind === 'floor' ? '#EAE7E0' : kind === 'frame' ? '#B9B4AB' : '#F4F2EE') : color;
  return new THREE.MeshStandardMaterial({
    color: base,
    roughness: kind === 'roof' && !clay ? 0.55 : kind === 'frame' ? 0.4 : 0.9,
    metalness: kind === 'roof' && !clay ? 0.25 : kind === 'frame' && !clay ? 0.3 : 0,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
}

/** Which level a face belongs to, from its lowest point. */
function levelOf(face: Face, elevations: number[]): number {
  const z = Math.min(...face.pts.map((p) => p.z)) + 0.01;
  let idx = 0;
  elevations.forEach((e, i) => {
    if (z >= e - 0.2) idx = i;
  });
  return idx;
}

export function buildScene(model: BuildingProject, clay: boolean): SceneParts {
  const frame = buildFrame(model);
  const elevations = model.levels.map((l) => l.elevation);
  const levelBuckets = model.levels.map(() => new Map<string, Bucket>());
  const roofBuckets = new Map<string, Bucket>();
  const levelEdges = model.levels.map(() => [] as number[]);
  const roofEdges: number[] = [];
  const bucket = (map: Map<string, Bucket>, kind: Bucket['kind'], color: string) => {
    const key = `${kind}|${color}`;
    if (!map.has(key)) map.set(key, { kind, color, pos: [], nrm: [] });
    return map.get(key)!;
  };

  for (const f of frame.faces) {
    const isRoof = f.kind === 'roof' || f.kind === 'fascia' || (f.kind === 'wall' && f.order === 1);
    if (isRoof) {
      triangulate(f, bucket(roofBuckets, f.kind, f.fill));
      edgesOf(f, roofEdges);
    } else {
      const li = levelOf(f, elevations);
      triangulate(f, bucket(levelBuckets[li], f.kind, f.fill));
      if (f.kind !== 'reveal') edgesOf(f, levelEdges[li]);
    }
  }

  // Floors: each room as a tinted slab top, visible when the roof or upper floors are hidden.
  model.levels.forEach((lvl, i) => {
    for (const r of lvl.rooms) {
      if (r.polygon.length < 3) continue;
      const pts = r.polygon.map((p) => ({ x: p.x, y: p.y, z: lvl.elevation + 0.005 }));
      triangulate({ pts, n: { x: 0, y: 0, z: 1 } }, bucket(levelBuckets[i], 'floor', ROOM_TINT[r.category] ?? '#EEEDE8'));
    }
  });

  const materials: THREE.Material[] = [];
  const toGroup = (map: Map<string, Bucket>) => {
    const g = new THREE.Group();
    for (const b of map.values()) {
      if (!b.pos.length) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(b.nrm, 3));
      const mat = materialFor(b.kind, b.color, clay);
      materials.push(mat);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = b.kind !== 'glass' && b.kind !== 'floor';
      mesh.receiveShadow = b.kind !== 'glass';
      mesh.renderOrder = b.kind === 'glass' ? 2 : 0;
      g.add(mesh);
    }
    return g;
  };

  const edgeMat = new THREE.LineBasicMaterial({ color: clay ? '#4A4741' : '#3A3833', transparent: true, opacity: clay ? 0.55 : 0.28 });
  materials.push(edgeMat);
  const toEdges = (arr: number[]) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    return new THREE.LineSegments(geo, edgeMat);
  };

  const levels = levelBuckets.map(toGroup);
  const edges: THREE.LineSegments[] = [];
  levels.forEach((g, i) => {
    const e = toEdges(levelEdges[i]);
    g.add(e);
    edges.push(e);
  });
  const roof = toGroup(roofBuckets);
  const re = toEdges(roofEdges);
  roof.add(re);
  edges.push(re);

  const box = new THREE.Box3();
  levels.forEach((g) => box.expandByObject(g));
  box.expandByObject(roof);

  return { levels, roof, edges, materials, box, levelElevations: elevations };
}
