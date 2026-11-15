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
import polygonClipping, { type Polygon } from 'polygon-clipping';
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
export function vectorElevation(roots: THREE.Object3D[], view: View, opts: { pxPerM?: number; clip?: boolean } = {}): VectorDrawing | null {
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
  const edgeParts: string[] = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const n = new THREE.Vector3();
  const f = (v: number) => v.toFixed(3);
  let zMax = 0;

  type P = { u: number; h: number; z: number };
  /** Every front-facing triangle (sections: only the part beyond the cut), before visibility. */
  const raw: { a: P; b: P; c: P; fill: string; opacity: number }[] = [];

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
        if (opts.clip) {
          // Sections: only what lies beyond the cutting plane (z >= 0).
          const poly = clipZ([pa, pb, pc]);
          for (let k = 1; k + 1 < poly.length; k++) raw.push({ a: poly[0], b: poly[k], c: poly[k + 1], ...sh });
        } else raw.push({ a: pa, b: pb, c: pc, ...sh });
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
        let p0 = proj(a);
        let p1 = proj(b);
        if (opts.clip) {
          if (p0.z < 0 && p1.z < 0) continue;
          if (p0.z < 0 || p1.z < 0) {
            const t = p0.z / (p0.z - p1.z);
            const q = { u: p0.u + (p1.u - p0.u) * t, h: p0.h + (p1.h - p0.h) * t, z: 0 };
            if (p0.z < 0) p0 = q;
            else p1 = q;
          }
        }
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

  const fills = exactFills(raw, renderer, { uMin, uMax, hMin, hMax, W, H });
  for (const t of raw) zMax = Math.max(zMax, t.a.h, t.b.h, t.c.h);
  return { fills, edges: edgeParts.join(''), uMin, uMax, zMax };
}

/** Clip a polygon to the far side of the section plane (z >= 0). */
function clipZ(poly: { u: number; h: number; z: number }[]) {
  const out: { u: number; h: number; z: number }[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    if (a.z >= 0) out.push(a);
    if ((a.z >= 0) !== (b.z >= 0)) {
      const t = a.z / (a.z - b.z);
      out.push({ u: a.u + (b.u - a.u) * t, h: a.h + (b.h - a.h) * t, z: 0 });
    }
  }
  return out;
}

const ID_VS = `attribute vec3 aId; varying vec3 vId; void main() { vId = aId; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const ID_FS = `varying vec3 vId; void main() { gl_FragColor = vec4(vId, 1.0); }`;

/**
 * Exact visible surfaces. The GPU draws every triangle in its own ID colour, so each pixel
 * says which triangle is in front there. A triangle with no pixels of its own is hidden; for
 * the rest, any other triangle that wins a pixel inside it (and really is nearer there) is an
 * occluder, and the visible shape is the triangle minus its occluders, by polygon clipping.
 * Edges therefore stay geometrically straight; no sampling guesses.
 */
function exactFills(
  raw: { a: { u: number; h: number; z: number }; b: { u: number; h: number; z: number }; c: { u: number; h: number; z: number }; fill: string; opacity: number }[],
  renderer: THREE.WebGLRenderer,
  box: { uMin: number; uMax: number; hMin: number; hMax: number; W: number; H: number }
): VectorDrawing['fills'] {
  const { uMin, uMax, hMin, hMax, W, H } = box;
  const N = raw.length;
  if (!N) return [];

  // ID pass in picture-plane coordinates: (u, h, -z), so nearer = larger z = drawn on top.
  const pos = new Float32Array(N * 9);
  const ids = new Float32Array(N * 9);
  raw.forEach((t, i) => {
    const id = i + 1;
    const r = (id & 255) / 255;
    const g = ((id >> 8) & 255) / 255;
    const b = ((id >> 16) & 255) / 255;
    [t.a, t.b, t.c].forEach((p, k) => {
      pos.set([p.u, p.h, -p.z], i * 9 + k * 3);
      ids.set([r, g, b], i * 9 + k * 3);
    });
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aId', new THREE.BufferAttribute(ids, 3));
  const mat = new THREE.ShaderMaterial({ vertexShader: ID_VS, fragmentShader: ID_FS, side: THREE.DoubleSide });
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(geo, mat));
  const cam = new THREE.OrthographicCamera(uMin, uMax, hMax, hMin, -1, 1000);
  cam.position.set(0, 0, 0);
  cam.lookAt(0, 0, -1);
  cam.updateMatrixWorld(true);
  const target = new THREE.WebGLRenderTarget(W, H, { depthBuffer: true });
  renderer.setRenderTarget(target);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  renderer.render(scene, cam);
  const px = new Uint8Array(W * H * 4);
  renderer.readRenderTargetPixels(target, 0, 0, W, H, px);
  renderer.setRenderTarget(null);
  target.dispose();
  geo.dispose();
  mat.dispose();

  // Depth plane of each triangle: z = A·u + B·h + C.
  const planes = raw.map((t) => {
    const { a, b, c } = t;
    const det = (b.u - a.u) * (c.h - a.h) - (c.u - a.u) * (b.h - a.h);
    if (Math.abs(det) < 1e-12) return null;
    const A = ((b.z - a.z) * (c.h - a.h) - (c.z - a.z) * (b.h - a.h)) / det;
    const B = ((c.z - a.z) * (b.u - a.u) - (b.z - a.z) * (c.u - a.u)) / det;
    return { A, B, C: a.z - A * a.u - B * a.h };
  });
  const sx = (uMax - uMin) / W;
  const sy = (hMax - hMin) / H;
  const EPS = 0.004;

  const out: { d: string; fill: string; opacity: number; z: number }[] = [];
  const f = (v: number) => v.toFixed(3);
  for (let i = 0; i < N; i++) {
    const t = raw[i];
    const pl = planes[i];
    if (!pl) continue;
    const { a, b, c } = t;
    const x0 = Math.max(0, Math.floor((Math.min(a.u, b.u, c.u) - uMin) / sx));
    const x1 = Math.min(W - 1, Math.ceil((Math.max(a.u, b.u, c.u) - uMin) / sx));
    const y0 = Math.max(0, Math.floor((Math.min(a.h, b.h, c.h) - hMin) / sy));
    const y1 = Math.min(H - 1, Math.ceil((Math.max(a.h, b.h, c.h) - hMin) / sy));
    const det = (b.u - a.u) * (c.h - a.h) - (c.u - a.u) * (b.h - a.h);
    let own = 0;
    const occ = new Set<number>();
    for (let y = y0; y <= y1; y++) {
      const hh = hMin + (y + 0.5) * sy;
      for (let x = x0; x <= x1; x++) {
        const u = uMin + (x + 0.5) * sx;
        // Inside the triangle? (barycentric signs)
        const w1 = ((u - a.u) * (c.h - a.h) - (c.u - a.u) * (hh - a.h)) / det;
        const w2 = ((b.u - a.u) * (hh - a.h) - (u - a.u) * (b.h - a.h)) / det;
        if (w1 < 0 || w2 < 0 || w1 + w2 > 1) continue;
        const k = (y * W + x) * 4;
        const id = px[k] | (px[k + 1] << 8) | (px[k + 2] << 16);
        if (id === i + 1) {
          own++;
          continue;
        }
        if (!id) continue;
        const j = id - 1;
        const pj = planes[j];
        if (!pj || occ.has(j)) continue;
        // Really nearer here (not just a neighbour on the same surface)?
        if (pj.A * u + pj.B * hh + pj.C < pl.A * u + pl.B * hh + pl.C - EPS) occ.add(j);
      }
    }
    if (!own) {
      // No pixel of its own: hidden, or just thinner than a pixel (hip caps, edges seen at a
      // grazing angle). Look at its centre and corners: keep it unless something nearer is
      // there at every one of them.
      const cu = (a.u + b.u + c.u) / 3;
      const ch = (a.h + b.h + c.h) / 3;
      let seen = false;
      for (const [u, hh] of [[cu, ch], ...[a, b, c].map((p) => [p.u + (cu - p.u) * 0.1, p.h + (ch - p.h) * 0.1])]) {
        const x = Math.floor((u - uMin) / sx);
        const y = Math.floor((hh - hMin) / sy);
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const k = (y * W + x) * 4;
        const id = px[k] | (px[k + 1] << 8) | (px[k + 2] << 16);
        const pj = id ? planes[id - 1] : null;
        if (!pj || pj.A * u + pj.B * hh + pj.C >= pl.A * u + pl.B * hh + pl.C - EPS) seen = true;
        else occ.add(id - 1);
      }
      if (!seen) continue;
    }
    const tri: Polygon = [[[a.u, -a.h], [b.u, -b.h], [c.u, -c.h], [a.u, -a.h]]];
    let vis: [number, number][][][] = [tri as [number, number][][]];
    if (occ.size) {
      try {
        // Subtract each occluder only where it really is in front: two planes' depth difference
        // is linear on the picture plane, so that region is a half-plane. (Crossing surfaces —
        // caps bedded into a roof, a wall through a slab — would otherwise cut holes.)
        const cut: Polygon[] = [];
        for (const j of occ) {
          const o = raw[j];
          const pj = planes[j]!;
          const dA = pj.A - pl.A;
          const dB = pj.B - pl.B;
          const dC = pj.C - pl.C + EPS;
          const inFront = (p: { u: number; h: number }) => dA * p.u + dB * p.h + dC < 0;
          const ring: { u: number; h: number }[] = [];
          const pts = [o.a, o.b, o.c];
          for (let q = 0; q < 3; q++) {
            const p0 = pts[q];
            const p1 = pts[(q + 1) % 3];
            const f0 = dA * p0.u + dB * p0.h + dC;
            const f1 = dA * p1.u + dB * p1.h + dC;
            if (f0 < 0) ring.push(p0);
            if ((f0 < 0) !== (f1 < 0)) {
              const tt = f0 / (f0 - f1);
              ring.push({ u: p0.u + (p1.u - p0.u) * tt, h: p0.h + (p1.h - p0.h) * tt });
            }
          }
          if (ring.length >= 3 && ring.some(inFront)) cut.push([[...ring.map((p) => [p.u, -p.h] as [number, number]), [ring[0].u, -ring[0].h]]]);
        }
        if (cut.length) vis = polygonClipping.difference(tri, ...cut) as [number, number][][][];
      } catch {
        /* keep the whole triangle */
      }
    }
    let d = '';
    for (const poly of vis) for (const ring of poly) if (ring.length >= 3) d += 'M' + ring.map(([x, yv]) => `${f(x)} ${f(yv)}`).join('L') + 'Z';
    if (d) out.push({ d, fill: t.fill, opacity: t.opacity, z: (a.z + b.z + c.z) / 3 });
  }
  // Pieces no longer overlap; far-to-near order only matters for see-through ones.
  out.sort((x, y) => y.z - x.z);
  const fills: VectorDrawing['fills'] = [];
  for (const t of out) {
    const last = fills[fills.length - 1];
    if (last && last.fill === t.fill && last.opacity === t.opacity) last.d += t.d;
    else fills.push({ d: t.d, fill: t.fill, opacity: t.opacity });
  }
  return fills;
}
