/**
 * Building services in 3D: conduits, pipes and fixtures, taken from the MEP engine's own
 * routing (the same runs the schematics and BOQ use). Everything is tagged by system and
 * level so the view can filter it.
 */
import * as THREE from 'three';
import type { BuildingProject, MEPNode, Point2D } from '../../../model/types';
import {
  computeHVACConduitRoutes,
  computeLightingRoutes,
  computePowerSocketRingRoutes,
  computePVAndEquipmentRoutes,
  computeSubMainRoutes,
  type Point3D,
} from '../../../engine/mepEngine';
import { getSolarConfig } from '../../../model/types';
import { MEP_COLOR } from '../style';

export type ServiceSystem = 'electrical' | 'plumbing' | 'hvac' | 'solar';

export interface Services {
  group: THREE.Group;
  materials: THREE.Material[];
  /** Count of runs and fixtures per system, for the filter chips. */
  counts: Record<ServiceSystem, number>;
}

interface Run {
  system: ServiceSystem;
  level: number;
  color: string;
  radius: number;
  pts: THREE.Vector3[];
}

const v3 = (p: Point3D) => new THREE.Vector3(p.x, p.y, p.z);

function tube(run: Run): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  for (let i = 1; i < run.pts.length; i++) {
    const a = run.pts[i - 1];
    const b = run.pts[i];
    const len = a.distanceTo(b);
    if (len < 0.005) continue;
    const g = new THREE.CylinderGeometry(run.radius, run.radius, len, 8, 1, false);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3().subVectors(b, a).normalize());
    g.applyQuaternion(q);
    g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    out.push(g.toNonIndexed());
    g.dispose();
    // Elbow ball so bends read as continuous pipe.
    if (i < run.pts.length - 1) {
      const s = new THREE.SphereGeometry(run.radius * 1.05, 8, 6);
      s.translate(b.x, b.y, b.z);
      out.push(s.toNonIndexed());
      s.dispose();
    }
  }
  return out;
}

function merge(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const nrm: number[] = [];
  for (const g of geos) {
    pos.push(...(g.getAttribute('position').array as Float32Array));
    nrm.push(...(g.getAttribute('normal').array as Float32Array));
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  return out;
}

/** Pipework is drawn along its real orthogonal run at a fixed height. */
function orthogonal(points: Point2D[], y: number): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  points.forEach((p, i) => {
    if (i > 0) {
      const a = points[i - 1];
      if (Math.abs(p.x - a.x) > 0.02 && Math.abs(p.y - a.y) > 0.02) out.push(new THREE.Vector3(p.x, y, a.y));
    }
    out.push(new THREE.Vector3(p.x, y, p.y));
  });
  return out;
}

const FIXTURE: Partial<Record<MEPNode['kind'], { system: ServiceSystem; color: string; size: [number, number, number]; y: number | 'ceiling' | 'floor'; round?: boolean }>> = {
  light_ceiling: { system: 'electrical', color: '#F2D27A', size: [0.24, 0.03, 0.24], y: 'ceiling', round: true },
  ceiling_fan: { system: 'hvac', color: '#E8E6E1', size: [1.1, 0.04, 0.14], y: 'ceiling' },
  switch_1g: { system: 'electrical', color: '#FFFFFF', size: [0.09, 0.09, 0.09], y: 1.2 },
  outlet_duplex: { system: 'electrical', color: '#FFFFFF', size: [0.15, 0.09, 0.09], y: 0.35 },
  mdb: { system: 'electrical', color: '#D9DCE0', size: [0.5, 0.65, 0.16], y: 1.8 },
  sub_db: { system: 'electrical', color: '#D9DCE0', size: [0.3, 0.4, 0.12], y: 1.65 },
  utility_meter: { system: 'electrical', color: '#C7CBD1', size: [0.32, 0.45, 0.16], y: 1.6 },
  solar_inv: { system: 'solar', color: '#E7E9EC', size: [0.48, 0.7, 0.2], y: 1.5 },
  solar_bess: { system: 'solar', color: '#F1F2F4', size: [0.62, 1.0, 0.25], y: 'floor' },
  water_heater: { system: 'plumbing', color: '#F4F4F2', size: [0.5, 0.8, 0.5], y: 1.9, round: true },
  water_main: { system: 'plumbing', color: MEP_COLOR.plumbingCold, size: [0.14, 0.14, 0.14], y: 0.3 },
  floor_trap: { system: 'plumbing', color: '#9A9488', size: [0.15, 0.01, 0.15], y: 'floor', round: true },
  plumb_basin: { system: 'plumbing', color: MEP_COLOR.plumbingCold, size: [0.06, 0.06, 0.06], y: 0.55 },
  plumb_sink: { system: 'plumbing', color: MEP_COLOR.plumbingCold, size: [0.06, 0.06, 0.06], y: 0.55 },
  plumb_shower: { system: 'plumbing', color: MEP_COLOR.plumbingCold, size: [0.06, 0.06, 0.06], y: 1.0 },
  plumb_wc: { system: 'plumbing', color: MEP_COLOR.drain, size: [0.11, 0.11, 0.11], y: 0.2 },
};

export function buildServices(model: BuildingProject): Services {
  const group = new THREE.Group();
  const materials: THREE.Material[] = [];
  const counts: Record<ServiceSystem, number> = { electrical: 0, plumbing: 0, hvac: 0, solar: 0 };
  const runs: Run[] = [];
  const add = (system: ServiceSystem, level: number, color: string, radius: number, paths: Point3D[][]) => {
    for (const p of paths) if (p.length >= 2) runs.push({ system, level, color, radius, pts: p.map(v3) });
  };

  model.levels.forEach((lvl, li) => {
    add('electrical', li, MEP_COLOR.power, 0.024, computeSubMainRoutes(lvl));
    const light = computeLightingRoutes(lvl);
    add('electrical', li, MEP_COLOR.lighting, 0.014, light.trunkPaths3D);
    add('electrical', li, MEP_COLOR.lighting, 0.014, light.switchDropPaths3D);
    add('electrical', li, MEP_COLOR.power, 0.016, computePowerSocketRingRoutes(lvl));
    const hvac = computeHVACConduitRoutes(lvl);
    add('hvac', li, MEP_COLOR.hvac, 0.014, hvac.powerFeedRuns3D);
    add('hvac', li, '#6FB3B3', 0.022, hvac.refrigerantRuns3D);

    // Pipework from the plan circuits: supply at skirting height, drainage just under the slab.
    for (const c of lvl.mepCircuits) {
      if (c.points.length < 2) continue;
      if (c.system === 'plumbing_cold') runs.push({ system: 'plumbing', level: li, color: MEP_COLOR.plumbingCold, radius: 0.016, pts: orthogonal(c.points, lvl.elevation + 0.3) });
      else if (c.system === 'plumbing_hot') runs.push({ system: 'plumbing', level: li, color: MEP_COLOR.plumbingHot, radius: 0.016, pts: orthogonal(c.points, lvl.elevation + 0.38) });
      else if (c.system === 'plumbing_drain') runs.push({ system: 'plumbing', level: li, color: MEP_COLOR.drain, radius: 0.045, pts: orthogonal(c.points, lvl.elevation - 0.12) });
      else if (c.system === 'hvac_condensate') runs.push({ system: 'hvac', level: li, color: '#7FB0B0', radius: 0.012, pts: orthogonal(c.points, lvl.elevation + 2.2) });
    }
  });

  if (getSolarConfig(model).enabled) {
    const eq = computePVAndEquipmentRoutes(model, 0);
    for (const r of [eq.pvToInverter, eq.inverterToMdb, eq.inverterToBess]) add('solar', 0, MEP_COLOR.solar, 0.022, [r.points3D]);
    add('electrical', 0, MEP_COLOR.power, 0.024, [eq.meterToMdb.points3D]);
  }

  // Merge runs by system, level and colour: a handful of meshes for the whole house.
  const buckets = new Map<string, { run: Run; geos: THREE.BufferGeometry[] }>();
  for (const r of runs) {
    const key = `${r.system}|${r.level}|${r.color}`;
    if (!buckets.has(key)) buckets.set(key, { run: r, geos: [] });
    buckets.get(key)!.geos.push(...tube(r));
    counts[r.system]++;
  }
  const matCache = new Map<string, THREE.MeshStandardMaterial>();
  const mat = (color: string) => {
    if (!matCache.has(color)) {
      const m = new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.1, emissive: color, emissiveIntensity: 0.32 });
      matCache.set(color, m);
      materials.push(m);
    }
    return matCache.get(color)!;
  };
  for (const { run, geos } of buckets.values()) {
    if (!geos.length) continue;
    const mesh = new THREE.Mesh(merge(geos), mat(run.color));
    mesh.userData = { system: run.system, level: run.level, solid: true };
    group.add(mesh);
  }

  // Fixtures.
  model.levels.forEach((lvl, li) => {
    const ceiling = lvl.elevation + Math.min(...(lvl.rooms.length ? lvl.rooms.map((r) => r.ceilingHeight) : [2.9]), lvl.floorToFloorHeight - lvl.slabThickness);
    for (const n of lvl.mepNodes) {
      const f = FIXTURE[n.kind];
      if (!f) continue;
      const [w, h, d] = f.size;
      const geo = f.round ? new THREE.CylinderGeometry(w / 2, w / 2, h, 20) : new THREE.BoxGeometry(w, h, d);
      const y = f.y === 'ceiling' ? ceiling - h / 2 - 0.01 : f.y === 'floor' ? lvl.elevation + h / 2 + 0.005 : lvl.elevation + f.y;
      const mesh = new THREE.Mesh(geo, mat(f.color));
      mesh.position.set(n.position.x, y, n.position.y);
      if (n.kind === 'ceiling_fan') {
        const blade2 = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(f.color));
        blade2.rotation.y = Math.PI / 2;
        mesh.add(blade2);
      }
      mesh.castShadow = true;
      mesh.userData = { system: f.system, level: li, solid: true };
      group.add(mesh);
      counts[f.system]++;
    }
  });

  return { group, materials, counts };
}
