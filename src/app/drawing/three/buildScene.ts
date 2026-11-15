/**
 * Turns the shared face model into three.js meshes, so the 3D view, elevations and sections
 * are all drawn from exactly the same building.
 *
 * Plan axes (x east, y south, z up) map to three.js as (x, z, y): y is up in three.js.
 */
import * as THREE from 'three';
import type { BuildingProject } from '../../../model/types';
import { buildFrame, tint, type Face, type FaceKind, type V3 } from '../model3d/faces';
import { ROOF_MATERIAL_OPTIONS } from '../../../components/Viewport3D';
import { ROOM_TINT } from '../style';

const T = (p: V3) => new THREE.Vector3(p.x, p.z, p.y);

export interface SceneParts {
  /** One group per level (walls, openings, floors, furniture), plus the roof and site items. */
  levels: THREE.Group[];
  roof: THREE.Group;
  /** Downpipes, rainwater tank: always shown. */
  site: THREE.Group;
  roofTopZ: number;
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
  const doorEdges = model.levels.map(() => [] as number[]);
  const roofEdges: number[] = [];
  const bucket = (map: Map<string, Bucket>, kind: Bucket['kind'], color: string) => {
    const key = `${kind}|${color}`;
    if (!map.has(key)) map.set(key, { kind, color, pos: [], nrm: [] });
    return map.get(key)!;
  };

  for (const f of frame.faces) {
    // Rainwater goods are rebuilt below as round geometry; the boxes are for the 2D drawings.
    if (f.kind === 'gutter' || f.kind === 'downpipe' || f.kind === 'tank') continue;
    const isRoof = f.kind === 'roof' || f.kind === 'fascia' || f.kind === 'solar' || (f.kind === 'wall' && f.order === 1);
    if (isRoof) {
      triangulate(f, bucket(roofBuckets, f.kind, f.fill));
      // Roof texture comes from real ribs, so only outline edges are drawn for roof planes.
      edgesOf(f.kind === 'roof' ? { pts: f.pts } : f, roofEdges);
    } else {
      const li = levelOf(f, elevations);
      triangulate(f, bucket(levelBuckets[li], f.kind, f.fill));
      // Door leaves keep their own edges so walk mode can swing them open (hide) together.
      if (f.kind === 'door') edgesOf(f, doorEdges[li]);
      else if (f.kind !== 'reveal') edgesOf(f, levelEdges[li]);
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
      mesh.userData.kind = b.kind;
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
    if (doorEdges[i].length) {
      const de = toEdges(doorEdges[i]);
      de.userData.kind = 'door';
      g.add(de);
      edges.push(de);
    }
  });
  const roof = toGroup(roofBuckets);
  const re = toEdges(roofEdges);
  roof.add(re);
  edges.push(re);

  const ribColor = new THREE.Color(roofRibColor(model, clay));
  const metalMat = (color: string | THREE.Color, rough = 0.45, metal = 0.35) => {
    const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: clay ? 0 : metal });
    materials.push(m);
    return m;
  };

  // Roof ribs (standing seams, corrugations, tile rolls) as real raised geometry.
  const ribGeo: THREE.BufferGeometry[] = [];
  for (const f of frame.faces) {
    if (f.kind !== 'roof' || !f.ribs) continue;
    const n = new THREE.Vector3(f.n.x, f.n.z, f.n.y);
    for (const r of f.ribs) ribGeo.push(barBetween(T(r.a), T(r.b), n, r.width, r.height));
  }
  if (ribGeo.length) {
    const m = new THREE.Mesh(mergeGeos(ribGeo), metalMat(clay ? '#ECE9E3' : ribColor, 0.5, 0.3));
    m.castShadow = true;
    m.receiveShadow = true;
    roof.add(m);
  }

  // Ridge and hip caps.
  const capGeo = frame.ridgeEdges.map(([a, b]) => barBetween(T(a), T(b), new THREE.Vector3(0, 1, 0), 0.16, 0.06));
  if (capGeo.length) {
    const m = new THREE.Mesh(mergeGeos(capGeo), metalMat(clay ? '#E2DED7' : ribColor.clone().multiplyScalar(0.85)));
    m.castShadow = true;
    roof.add(m);
  }

  // Rainwater goods: gutters with the roof, downpipes and collection on the site.
  const site = new THREE.Group();
  const d = frame.drainage;
  if (d) {
    const gm = metalMat(clay ? '#E7E4DE' : d.color, 0.4, d.color === '#B26A2E' ? 0.7 : 0.2);
    for (const g of d.gutters) {
      const a = T(g.a);
      const b = T(g.b);
      const len = a.distanceTo(b);
      const geo = d.halfRound ? new THREE.CylinderGeometry(0.075, 0.075, len, 16, 1, true, 0, Math.PI) : new THREE.BoxGeometry(0.13, len, 0.12);
      const mesh = new THREE.Mesh(geo, gm);
      (gm as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
      mesh.position.copy(a).add(b).multiplyScalar(0.5);
      // Cylinder axis (local Y) along the run; the half shell (local +X) hangs downward, open side up.
      const dir = new THREE.Vector3().subVectors(b, a).normalize();
      const down = new THREE.Vector3(0, -1, 0);
      const zAxis = new THREE.Vector3().crossVectors(down, dir).normalize();
      mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(down, dir, zAxis));
      mesh.castShadow = true;
      roof.add(mesh);
    }
    for (const p of d.downpipes) {
      const top = T(p.top);
      const wall = new THREE.Vector3(p.wall.x, top.y - 0.29, p.wall.y);
      const r = 0.045;
      const v1 = cylinderBetween(new THREE.Vector3(wall.x, 0.15, wall.z), new THREE.Vector3(wall.x, wall.y, wall.z), r, gm);
      const v2 = cylinderBetween(new THREE.Vector3(wall.x, wall.y, wall.z), new THREE.Vector3(top.x, wall.y, top.z), r, gm);
      const v3 = cylinderBetween(new THREE.Vector3(top.x, wall.y, top.z), new THREE.Vector3(top.x, top.y, top.z), r, gm);
      const shoe = cylinderBetween(new THREE.Vector3(wall.x, 0.16, wall.z), new THREE.Vector3(wall.x + p.out.x * 0.18, 0.05, wall.z + p.out.y * 0.18), r, gm);
      site.add(v1, v2, v3, shoe);
    }
    const c = d.collection;
    if (c && c.mode === 'harvesting_tank') {
      const tm = metalMat(clay ? '#E9E6E0' : '#5F7A6A', 0.8, 0);
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(c.radius, c.radius, c.height, 32), tm);
      tank.position.set(c.x, c.height / 2, c.y);
      tank.castShadow = true;
      tank.receiveShadow = true;
      const lid = new THREE.Mesh(new THREE.CylinderGeometry(c.radius * 0.35, c.radius * 0.35, 0.08, 24), tm);
      lid.position.set(c.x, c.height + 0.04, c.y);
      site.add(tank, lid);
    } else if (c) {
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(c.radius, c.radius, 0.06, 28), metalMat(clay ? '#E2DED7' : '#9A968C', 1, 0));
      pad.position.set(c.x, 0.03, c.y);
      pad.receiveShadow = true;
      site.add(pad);
    }
  }

  // Ceilings: one per room at its ceiling height, facing down only, so they close the room
  // when you walk inside but vanish when you look into a cutaway from above.
  const ceilMat = new THREE.MeshStandardMaterial({ color: clay ? '#F4F2EE' : '#F7F6F2', roughness: 0.95, side: THREE.FrontSide });
  materials.push(ceilMat);
  model.levels.forEach((lvl, i) => {
    const wallTop = Math.max(...lvl.walls.map((w) => w.height), 2.4);
    for (const r of lvl.rooms) {
      if (r.polygon.length < 3) continue;
      const shape = new THREE.Shape(r.polygon.map((p) => new THREE.Vector2(p.x, p.y)));
      const geo = new THREE.ShapeGeometry(shape);
      geo.rotateX(Math.PI / 2); // plan (x, y) → (x, ·, y), normal pointing down
      const m = new THREE.Mesh(geo, ceilMat);
      m.position.y = lvl.elevation + Math.min(r.ceilingHeight || wallTop, wallTop) - 0.002;
      m.receiveShadow = true;
      m.userData.kind = 'ceiling';
      levels[i].add(m);
    }
  });

  // Furniture and AC units, so cutaway and X-ray views read as rooms.
  model.levels.forEach((lvl, i) => {
    const fm = metalMat(clay ? '#E6E2DA' : '#D8CFC2', 0.9, 0);
    for (const f of lvl.furniture) {
      const h = FURNITURE_H[f.type] ?? 0.75;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(f.width, h, f.depth), fm);
      mesh.position.set(f.position.x, lvl.elevation + h / 2, f.position.y);
      mesh.rotation.y = (-f.rotation * Math.PI) / 180;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.solid = true;
      levels[i].add(mesh);
    }
    const am = metalMat('#F3F3F1', 0.6, 0.1);
    for (const n of lvl.mepNodes) {
      if (n.kind === 'ac_split') {
        const m = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.28, 0.22), am);
        m.position.set(n.position.x, lvl.elevation + 2.35, n.position.y);
        m.userData.solid = true;
        levels[i].add(m);
      } else if (n.kind === 'ac_condenser') {
        const m = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.55, 0.3), am);
        m.position.set(n.position.x, lvl.elevation + 0.3, n.position.y);
        m.userData.solid = true;
        m.castShadow = true;
        levels[i].add(m);
      }
    }
  });

  const box = new THREE.Box3();
  levels.forEach((g) => box.expandByObject(g));
  box.expandByObject(roof);
  box.expandByObject(site);

  return { levels, roof, site, roofTopZ: frame.ridgeZ, edges, materials, box, levelElevations: elevations };
}

const FURNITURE_H: Record<string, number> = {
  bed_double: 0.55,
  bed_single: 0.55,
  sofa: 0.8,
  dining_table: 0.75,
  kitchen_counter: 0.9,
  desk: 0.75,
  wc: 0.42,
  sink: 0.85,
  shower: 0.04,
  car: 1.45,
};

function roofRibColor(model: BuildingProject, clay: boolean): string {
  if (clay) return '#ECE9E3';
  const base = ROOF_MATERIAL_OPTIONS.find((o) => o.id === model.roof.material)?.base ?? '#64748b';
  return tint(base, 0.45);
}

/** A thin bar of the given width and height lying along a→b, raised off the surface along n. */
function barBetween(a: THREE.Vector3, b: THREE.Vector3, n: THREE.Vector3, width: number, height: number): THREE.BufferGeometry {
  const len = a.distanceTo(b);
  const geo = new THREE.BoxGeometry(width, height, len);
  const z = new THREE.Vector3().subVectors(b, a).normalize();
  const y = n.clone().sub(z.clone().multiplyScalar(n.dot(z))).normalize();
  const x = new THREE.Vector3().crossVectors(y, z).normalize();
  const m = new THREE.Matrix4().makeBasis(x, y, z);
  m.setPosition(a.clone().add(b).multiplyScalar(0.5).addScaledVector(y, height / 2));
  geo.applyMatrix4(m);
  return geo;
}

function cylinderBetween(a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material): THREE.Mesh {
  const len = Math.max(0.001, a.distanceTo(b));
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 12), mat);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3().subVectors(b, a).normalize());
  mesh.castShadow = true;
  return mesh;
}

/** Merge non-indexed position/normal geometries into one (keeps draw calls low). */
function mergeGeos(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const nrm: number[] = [];
  for (const g0 of geos) {
    const g = g0.index ? g0.toNonIndexed() : g0;
    pos.push(...(g.getAttribute('position').array as Float32Array));
    nrm.push(...(g.getAttribute('normal').array as Float32Array));
    g0.dispose();
    if (g !== g0) g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  return out;
}
