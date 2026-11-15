/**
 * Elevations from the 3D model: the same three.js scene as the 3D view, looked at square-on
 * from a fixed direction with an orthographic camera, turned into vector drawing.
 *
 * - Visibility comes from a real depth buffer (the scene rendered once on the GPU), so what is
 *   drawn is exactly what the 3D model shows from that side.
 * - Surfaces become filled polygons (painter's order, triangles hidden by the depth buffer are
 *   dropped), shaded by one light like a study model.
 * - Edges (creases sharper than ~20°) are tested along their length against the depth buffer,
 *   so hidden lines are removed and only visible linework is drawn.
 *
 * Output is in metres: u along the picture plane (viewer's right), y = -height.
 */
import * as THREE from 'three';
import type { View } from '../model3d/project';

export interface VectorDrawing {
  fills: { d: string; fill: string; opacity: number }[];
  /** Visible edges, one path. */
  edges: string;
  uMin: number;
  uMax: number;
  zMax: number;
}

const DEPTH_VS = `varying float vDepth; void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vDepth = -mv.z; gl_Position = projectionMatrix * mv; }`;
const DEPTH_FS = `varying float vDepth; void main() { gl_FragColor = vec4(vDepth, 0.0, 0.0, 1.0); }`;

let renderer: THREE.WebGLRenderer | null = null;
const edgeCache = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();

function shadeOf(mat: THREE.Material, n: THREE.Vector3, light: THREE.Vector3): { fill: string; opacity: number } | null {
  const m = mat as THREE.MeshStandardMaterial;
  if (!m.color) return null;
  const opacity = m.transparent ? Math.max(0.15, m.opacity) : 1;
  if (opacity < 0.08) return null;
  const lambert = 0.68 + 0.32 * Math.max(0, n.dot(light));
  const c = m.color.clone().multiplyScalar(lambert);
  if (m.emissive && m.emissiveIntensity > 0) c.add(m.emissive.clone().multiplyScalar(0.3 * m.emissiveIntensity));
  return { fill: `#${c.getHexString()}`, opacity };
}

/**
 * Draw `roots` as seen along `view.look`. Objects are added to a temporary scene for the depth
 * render; callers pass objects made for this purpose.
 */
export function vectorElevation(roots: THREE.Object3D[], view: View, opts: { pxPerM?: number } = {}): VectorDrawing | null {
  const look = new THREE.Vector3(view.look.x, 0, view.look.y).normalize();
  const right = new THREE.Vector3(-view.look.y, 0, view.look.x);
  const camPos = new THREE.Vector3(view.origin.x, 0, view.origin.y);
  const proj = (p: THREE.Vector3) => ({ u: p.clone().sub(camPos).dot(right), h: p.y, z: p.clone().sub(camPos).dot(look) });

  // Extent on the picture plane.
  const box = new THREE.Box3();
  roots.forEach((r) => {
    r.updateMatrixWorld(true);
    box.expandByObject(r);
  });
  if (box.isEmpty()) return null;
  const corners = [0, 1].flatMap((i) => [0, 1].flatMap((j) => [0, 1].map((k) => new THREE.Vector3(i ? box.max.x : box.min.x, j ? box.max.y : box.min.y, k ? box.max.z : box.min.z))));
  const us = corners.map((c) => proj(c).u);
  const uMin = Math.min(...us) - 0.2;
  const uMax = Math.max(...us) + 0.2;
  const hMin = Math.min(box.min.y, 0) - 0.2;
  const hMax = box.max.y + 0.2;

  // Depth buffer from an orthographic camera at the picture plane.
  const pxPerM = Math.min(opts.pxPerM ?? 90, 4096 / (uMax - uMin), 4096 / (hMax - hMin));
  const W = Math.max(64, Math.round((uMax - uMin) * pxPerM));
  const H = Math.max(64, Math.round((hMax - hMin) * pxPerM));
  try {
    renderer ??= new THREE.WebGLRenderer({ antialias: false });
  } catch {
    return null;
  }
  const cam = new THREE.OrthographicCamera(uMin, uMax, hMax, hMin, 0.05, 500);
  cam.position.copy(camPos);
  cam.up.set(0, 1, 0);
  cam.lookAt(camPos.clone().add(look));
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  const target = new THREE.WebGLRenderTarget(W, H, { type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: true });
  const depthMat = new THREE.ShaderMaterial({ vertexShader: DEPTH_VS, fragmentShader: DEPTH_FS, side: THREE.DoubleSide });
  const scene = new THREE.Scene();
  const parents = roots.map((r) => r.parent);
  roots.forEach((r) => scene.add(r));
  // Transparent things (glass) still hide what is behind them in an elevation.
  scene.overrideMaterial = depthMat;
  renderer.setRenderTarget(target);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  renderer.render(scene, cam);
  const buf = new Float32Array(W * H * 4);
  renderer.readRenderTargetPixels(target, 0, 0, W, H, buf);
  renderer.setRenderTarget(null);
  scene.overrideMaterial = null;
  roots.forEach((r, i) => (parents[i] ? parents[i]!.add(r) : scene.remove(r)));
  target.dispose();
  depthMat.dispose();

  const depthAt = (u: number, h: number) => {
    const x = Math.floor(((u - uMin) / (uMax - uMin)) * W);
    const y = Math.floor(((h - hMin) / (hMax - hMin)) * H);
    if (x < 0 || y < 0 || x >= W || y >= H) return Infinity;
    const i = (y * W + x) * 4;
    return buf[i + 3] > 0 ? buf[i] : Infinity;
  };
  const px = 1 / pxPerM;
  const tol = 0.035 + px * 1.5;
  const visible = (u: number, h: number, z: number) => {
    // Look at the pixel and its neighbours: thin parts and edges sit on pixel boundaries.
    let best = Infinity;
    for (const [du, dh] of [[0, 0], [px, 0], [-px, 0], [0, px], [0, -px]]) best = Math.min(best, depthAt(u + du, h + dh));
    return z <= best + tol;
  };

  // Surfaces.
  const light = new THREE.Vector3().addScaledVector(look, -0.55).addScaledVector(right, -0.35).add(new THREE.Vector3(0, 0.75, 0)).normalize();
  type Tri = { d: string; fill: string; opacity: number; z: number };
  const tris: Tri[] = [];
  const edgeParts: string[] = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const n = new THREE.Vector3();
  const f = (v: number) => v.toFixed(3);
  let zMax = 0;

  type P = { u: number; h: number; z: number };
  const mid = (p: P, q: P): P => ({ u: (p.u + q.u) / 2, h: (p.h + q.h) / 2, z: (p.z + q.z) / 2 });
  // Fills: one pixel is enough (edges use the neighbourhood test above).
  const seen = (u: number, h: number, z: number) => z <= depthAt(u, h) + tol;
  let budget = 120000; // pieces; a safety net for very detailed scenes
  const emit = (pa: P, pb: P, pc: P, sh: { fill: string; opacity: number }, depth: number) => {
    const lab = Math.hypot(pa.u - pb.u, pa.h - pb.h);
    const lbc = Math.hypot(pb.u - pc.u, pb.h - pc.h);
    const lca = Math.hypot(pc.u - pa.u, pc.h - pa.h);
    const size = Math.max(lab, lbc, lca);
    // Sample the triangle on a grid fine enough not to miss thin visible strips.
    const n = Math.max(2, Math.min(8, Math.ceil(size / (px * 5))));
    let vis = 0;
    let all = 0;
    for (let i = 0; i <= n; i++)
      for (let j = 0; j <= n - i; j++) {
        const wa = (i + 0.15) / (n + 0.45);
        const wb = (j + 0.15) / (n + 0.45);
        const wc = 1 - wa - wb;
        all++;
        if (seen(pa.u * wa + pb.u * wb + pc.u * wc, pa.h * wa + pb.h * wb + pc.h * wc, pa.z * wa + pb.z * wb + pc.z * wc)) vis++;
      }
    if (vis === 0) return;
    if (vis < all && depth < 16 && size > px * 3 && budget > 0) {
      // Split across the longest edge: two pieces, so long thin parts don't explode.
      budget--;
      if (lab >= lbc && lab >= lca) {
        const m = mid(pa, pb);
        emit(pa, m, pc, sh, depth + 1);
        emit(m, pb, pc, sh, depth + 1);
      } else if (lbc >= lca) {
        const m = mid(pb, pc);
        emit(pa, pb, m, sh, depth + 1);
        emit(pa, m, pc, sh, depth + 1);
      } else {
        const m = mid(pc, pa);
        emit(pa, pb, m, sh, depth + 1);
        emit(m, pb, pc, sh, depth + 1);
      }
      return;
    }
    zMax = Math.max(zMax, pa.h, pb.h, pc.h);
    tris.push({ d: `M${f(pa.u)} ${f(-pa.h)}L${f(pb.u)} ${f(-pb.h)}L${f(pc.u)} ${f(-pc.h)}Z`, ...sh, z: (pa.z + pb.z + pc.z) / 3 });
  };

  for (const root of roots)
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !mesh.visible) return;
      let hidden = false;
      for (let p: THREE.Object3D | null = mesh; p; p = p.parent) if (!p.visible) hidden = true;
      if (hidden) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const mat = mats[0];
      const g = mesh.geometry as THREE.BufferGeometry;
      const pos = g.getAttribute('position') as THREE.BufferAttribute | undefined;
      if (!pos) return;
      const idx = g.getIndex();
      const count = idx ? idx.count : pos.count;
      const mw = mesh.matrixWorld;
      const doubleSide = mat.side === THREE.DoubleSide;
      for (let t = 0; t < count; t += 3) {
        const i0 = idx ? idx.getX(t) : t;
        const i1 = idx ? idx.getX(t + 1) : t + 1;
        const i2 = idx ? idx.getX(t + 2) : t + 2;
        a.fromBufferAttribute(pos, i0).applyMatrix4(mw);
        b.fromBufferAttribute(pos, i1).applyMatrix4(mw);
        c.fromBufferAttribute(pos, i2).applyMatrix4(mw);
        n.subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
        const len = n.length();
        if (len < 1e-9) continue;
        n.divideScalar(len);
        const facing = n.dot(look);
        if (facing > 0 && !doubleSide) continue; // back face
        if (Math.abs(facing) < 0.02) continue; // edge-on
        if (facing > 0) n.negate();
        const pa = proj(a);
        const pb = proj(b);
        const pc = proj(c);
        const area2 = Math.abs((pb.u - pa.u) * (pc.h - pa.h) - (pc.u - pa.u) * (pb.h - pa.h));
        if (area2 < 1e-6) continue;
        const sh = shadeOf(mat, n, light);
        if (!sh) continue;
        // Keep only the visible parts: wholly visible triangles stay whole, wholly hidden ones
        // go, and partly hidden ones are split until each piece is one or the other.
        emit(pa, pb, pc, sh, 0);
      }

      // Visible edges.
      if (mat.transparent && (mat as THREE.MeshStandardMaterial).opacity < 0.5 && !doubleSide) return;
      let eg = edgeCache.get(g);
      if (!eg) {
        eg = new THREE.EdgesGeometry(g, 20);
        edgeCache.set(g, eg);
      }
      const ep = eg.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < ep.count; i += 2) {
        a.fromBufferAttribute(ep, i).applyMatrix4(mw);
        b.fromBufferAttribute(ep, i + 1).applyMatrix4(mw);
        const p0 = proj(a);
        const p1 = proj(b);
        const L = Math.hypot(p1.u - p0.u, p1.h - p0.h);
        if (L < px * 0.5) continue;
        const steps = Math.max(1, Math.ceil(L / (px * 1.5)));
        let run: { u: number; h: number } | null = null;
        let last = { u: p0.u, h: p0.h };
        for (let s = 0; s <= steps; s++) {
          const tt = s / steps;
          const u = p0.u + (p1.u - p0.u) * tt;
          const hh = p0.h + (p1.h - p0.h) * tt;
          const z = p0.z + (p1.z - p0.z) * tt;
          const vis = visible(u, hh, z);
          if (vis && !run) run = { u, h: hh };
          if (!vis && run) {
            edgeParts.push(`M${f(run.u)} ${f(-run.h)}L${f(last.u)} ${f(-last.h)}`);
            run = null;
          }
          last = { u, h: hh };
        }
        if (run) edgeParts.push(`M${f(run.u)} ${f(-run.h)}L${f(p1.u)} ${f(-p1.h)}`);
      }
    });

  // Far to near (boundary pieces can still overlap a little, so order matters); neighbouring
  // pieces of one colour share a path.
  tris.sort((x, y) => y.z - x.z);
  const fills: VectorDrawing['fills'] = [];
  for (const t of tris) {
    const last = fills[fills.length - 1];
    if (last && last.fill === t.fill && last.opacity === t.opacity) last.d += t.d;
    else fills.push({ d: t.d, fill: t.fill, opacity: t.opacity });
  }
  return { fills, edges: edgeParts.join(''), uMin, uMax, zMax };
}
