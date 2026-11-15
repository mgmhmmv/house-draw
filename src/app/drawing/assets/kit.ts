/**
 * A tiny modelling kit for furniture, fixtures and equipment. Each asset is described once as a
 * list of simple parts (boxes, rounded boxes, cylinders, spheres, tori, lathes); the same parts
 * build the three.js model and, seen from above, the 2D plan symbol, so the two always match.
 *
 * Local axes (metres): x across the width, y up from the floor, z through the depth with the
 * back at -d/2 and the front at +d/2. In plan, z is the plan's y.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

export type V3 = [number, number, number];

export type MatKey =
  | 'fabric'
  | 'cushion'
  | 'accent'
  | 'wood'
  | 'woodDark'
  | 'white'
  | 'offwhite'
  | 'metal'
  | 'chrome'
  | 'black'
  | 'glass'
  | 'ceramic'
  | 'stone'
  | 'leaf'
  | 'soil'
  | 'terracotta'
  | 'linen'
  | 'duvet'
  | 'mattress'
  | 'screen'
  | 'lamp'
  | 'paint'
  | 'rubber'
  | 'steel'
  | 'water'
  | 'trunk'
  | 'book1'
  | 'book2'
  | 'book3';

export interface Part {
  g: 'box' | 'rbox' | 'cyl' | 'sph' | 'tor' | 'lathe';
  /** Centre of the part. */
  p: V3;
  /** box/rbox: [w, h, d] · cyl: [rTop, h, rBottom] · sph: [r] · tor: [R, tube] · lathe: unused */
  s: V3;
  m: MatKey;
  /** Rotation in radians (x, y, z). */
  rot?: V3;
  /** Non-uniform scale, e.g. to squash a sphere into a bowl. */
  sc?: V3;
  /** rbox corner radius. */
  r?: number;
  /** Lathe profile: [radius, y] pairs from the bottom up, relative to p. */
  pts?: [number, number][];
  /** Radial segments for round parts. */
  seg?: number;
  /** How the part shows in plan: outline and fill (default), outline only, dashed, or hidden. */
  plan?: 'fill' | 'line' | 'dash' | false;
}

/* ── Part helpers (bottom-based, which is how furniture is measured) ───────────── */

type Opt = Partial<Pick<Part, 'rot' | 'sc' | 'r' | 'seg' | 'plan'>>;
/** Box: centre (x, z), bottom y0, size w × h × d. */
export const B = (x: number, z: number, y0: number, w: number, d: number, h: number, m: MatKey, o: Opt = {}): Part => ({ g: 'box', p: [x, y0 + h / 2, z], s: [w, h, d], m, ...o });
/** Rounded box. */
export const R = (x: number, z: number, y0: number, w: number, d: number, h: number, m: MatKey, r = 0.03, o: Opt = {}): Part => ({
  g: 'rbox',
  p: [x, y0 + h / 2, z],
  s: [w, h, d],
  m,
  r: Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001),
  ...o,
});
/** Vertical cylinder (or cone frustum with r2). */
export const C = (x: number, z: number, y0: number, r: number, h: number, m: MatKey, o: Opt & { r2?: number } = {}): Part => ({
  g: 'cyl',
  p: [x, y0 + h / 2, z],
  s: [r, h, o.r2 ?? r],
  m,
  ...o,
});
/** Horizontal cylinder along x (axis = 'x') or z. */
export const H = (x: number, y: number, z: number, r: number, len: number, axis: 'x' | 'z', m: MatKey, o: Opt = {}): Part => ({
  g: 'cyl',
  p: [x, y, z],
  s: [r, len, r],
  m,
  rot: axis === 'x' ? [0, 0, Math.PI / 2] : [Math.PI / 2, 0, 0],
  ...o,
});
export const S = (x: number, y: number, z: number, r: number, m: MatKey, o: Opt = {}): Part => ({ g: 'sph', p: [x, y, z], s: [r, 0, 0], m, ...o });
/** Flat ring lying in the floor plane. */
export const T = (x: number, y: number, z: number, R: number, tube: number, m: MatKey, o: Opt = {}): Part => ({
  g: 'tor',
  p: [x, y, z],
  s: [R, tube, 0],
  m,
  rot: [Math.PI / 2, 0, 0],
  plan: 'line',
  ...o,
});
export const L = (x: number, z: number, y0: number, pts: [number, number][], m: MatKey, o: Opt = {}): Part => ({ g: 'lathe', p: [x, y0, z], s: [0, 0, 0], m, pts, ...o });

/** Four legs inset from the corners of a w × d footprint. */
export const legs = (w: number, d: number, h: number, m: MatKey, inset = 0.05, r = 0.022, round = true): Part[] =>
  [-1, 1].flatMap((sx) =>
    [-1, 1].map((sz) =>
      round ? C(sx * (w / 2 - inset), sz * (d / 2 - inset), 0, r, h, m, { plan: false }) : B(sx * (w / 2 - inset), sz * (d / 2 - inset), 0, r * 2, r * 2, h, m, { plan: false })
    )
  );

/** An open-topped vessel (tub, sink, planter) made of a floor and four walls, so it is really hollow. */
export const vessel = (x: number, z: number, y0: number, w: number, d: number, h: number, t: number, m: MatKey, r = 0.03): Part[] => [
  R(x, z, y0, w, d, t, m, r),
  R(x, z - d / 2 + t / 2, y0, w, t, h, m, Math.min(r, t / 2)),
  R(x, z + d / 2 - t / 2, y0, w, t, h, m, Math.min(r, t / 2)),
  R(x - w / 2 + t / 2, z, y0, t, d, h, m, Math.min(r, t / 2)),
  R(x + w / 2 - t / 2, z, y0, t, d, h, m, Math.min(r, t / 2)),
];

/* ── Materials ─────────────────────────────────────────────────────────────── */

const MAT: Record<MatKey, { color: string; rough?: number; metal?: number; opacity?: number; emissive?: string }> = {
  fabric: { color: '#B7AFA2', rough: 0.95 },
  cushion: { color: '#C9C2B6', rough: 0.95 },
  accent: { color: '#7E8F7A', rough: 0.9 },
  wood: { color: '#B88A5E', rough: 0.65 },
  woodDark: { color: '#6A4A33', rough: 0.6 },
  white: { color: '#F3F1EC', rough: 0.55 },
  offwhite: { color: '#E4DED3', rough: 0.6 },
  metal: { color: '#9EA2A6', rough: 0.4, metal: 0.7 },
  chrome: { color: '#D8DADC', rough: 0.15, metal: 0.95 },
  black: { color: '#2A2A2A', rough: 0.5 },
  glass: { color: '#BFD9DF', rough: 0.05, metal: 0.1, opacity: 0.32 },
  ceramic: { color: '#FBFBF9', rough: 0.12 },
  stone: { color: '#D8D2C6', rough: 0.35 },
  leaf: { color: '#4E7A48', rough: 0.85 },
  soil: { color: '#4F3E30', rough: 1 },
  terracotta: { color: '#B56A47', rough: 0.85 },
  linen: { color: '#EEE9DF', rough: 0.95 },
  duvet: { color: '#DCD5C8', rough: 0.95 },
  mattress: { color: '#F5F2EB', rough: 0.9 },
  screen: { color: '#121518', rough: 0.15, metal: 0.3 },
  lamp: { color: '#FFF4D6', rough: 0.4, emissive: '#FFE6A8' },
  paint: { color: '#6F8796', rough: 0.35, metal: 0.4 },
  rubber: { color: '#1C1C1C', rough: 0.9 },
  steel: { color: '#C4C7CA', rough: 0.3, metal: 0.8 },
  water: { color: '#9CC7D2', rough: 0.05, opacity: 0.55 },
  trunk: { color: '#8A6F52', rough: 0.95 },
  book1: { color: '#8C4B3F', rough: 0.8 },
  book2: { color: '#3F5E73', rough: 0.8 },
  book3: { color: '#C9A75B', rough: 0.8 },
};

const CLAY = '#E8E4DC';

/** Materials are shared across all assets in a scene; call dispose() on the set when done. */
export class AssetMaterials {
  private cache = new Map<string, THREE.MeshStandardMaterial>();
  constructor(private clay = false) {}
  get(k: MatKey) {
    const key = `${k}${this.clay ? ':clay' : ''}`;
    let m = this.cache.get(key);
    if (!m) {
      const d = MAT[k];
      const see = d.opacity !== undefined;
      m = new THREE.MeshStandardMaterial({
        color: this.clay && !see ? CLAY : d.color,
        roughness: this.clay ? 0.9 : (d.rough ?? 0.6),
        metalness: this.clay ? 0 : (d.metal ?? 0),
        transparent: see,
        opacity: d.opacity ?? 1,
        depthWrite: !see,
        emissive: !this.clay && d.emissive ? new THREE.Color(d.emissive) : undefined,
        emissiveIntensity: d.emissive ? 0.6 : 0,
        side: k === 'lamp' || k === 'glass' ? THREE.DoubleSide : THREE.FrontSide,
      });
      this.cache.set(key, m);
    }
    return m;
  }
  all() {
    return [...this.cache.values()];
  }
  dispose() {
    this.cache.forEach((m) => m.dispose());
    this.cache.clear();
  }
}

function geometry(part: Part): THREE.BufferGeometry {
  const [a, b, c] = part.s;
  const seg = part.seg ?? 24;
  switch (part.g) {
    case 'box':
      return new THREE.BoxGeometry(a, b, c);
    case 'rbox':
      return new RoundedBoxGeometry(a, b, c, 3, part.r ?? 0.02);
    case 'cyl':
      return new THREE.CylinderGeometry(a, c, b, seg);
    case 'sph':
      return new THREE.SphereGeometry(a, seg, Math.max(8, Math.round(seg * 0.66)));
    case 'tor':
      return new THREE.TorusGeometry(a, b, 8, seg);
    case 'lathe':
      return new THREE.LatheGeometry((part.pts ?? []).map(([r, y]) => new THREE.Vector2(Math.max(0.0005, r), y)), seg);
  }
}

/** Build the 3D model: a group with its origin at the centre of the footprint, on the floor. */
export function buildParts(parts: Part[], mats: AssetMaterials, shadows = true): THREE.Group {
  const g = new THREE.Group();
  for (const part of parts) {
    const mesh = new THREE.Mesh(geometry(part), mats.get(part.m));
    mesh.position.set(...part.p);
    if (part.rot) mesh.rotation.set(...part.rot);
    if (part.sc) mesh.scale.set(...part.sc);
    const see = part.m === 'glass' || part.m === 'water';
    mesh.castShadow = shadows && !see;
    mesh.receiveShadow = shadows;
    g.add(mesh);
  }
  return g;
}

/* ── Plan symbols ────────────────────────────────────────────────────────────── */

export type Prim =
  | { k: 'rect'; x: number; y: number; w: number; h: number; rx?: number; rot?: number; cx?: number; cy?: number; style: PrimStyle }
  | { k: 'ellipse'; cx: number; cy: number; rx: number; ry: number; style: PrimStyle }
  | { k: 'line'; x1: number; y1: number; x2: number; y2: number; style: PrimStyle }
  | { k: 'path'; d: string; style: PrimStyle };
export type PrimStyle = 'fill' | 'line' | 'dash' | 'thin';

/**
 * The plan symbol, as seen from above: parts are drawn lowest first with a white fill, so higher
 * parts cover what is under them, just like a top view.
 */
export function partsToPlan(parts: Part[], overhead = false): Prim[] {
  const top = (pt: Part) => {
    if (pt.g === 'lathe') return pt.p[1] + Math.max(...(pt.pts ?? [[0, 0]]).map((q) => q[1]));
    if (pt.g === 'sph') return pt.p[1] + pt.s[0] * (pt.sc?.[1] ?? 1);
    if (pt.g === 'tor') return pt.p[1] + pt.s[1];
    const h = pt.g === 'cyl' && pt.rot ? Math.max(pt.s[0], pt.s[2]) * 2 : pt.s[1];
    return pt.p[1] + h / 2;
  };
  const out: Prim[] = [];
  const shown = parts.filter((pt) => pt.plan !== false).sort((a, b) => top(a) - top(b));
  for (const pt of shown) {
    const style: PrimStyle = overhead ? 'dash' : pt.plan === 'line' ? 'line' : pt.plan === 'dash' ? 'dash' : pt.m === 'glass' ? 'line' : 'fill';
    const [x, , z] = pt.p;
    const sx = pt.sc?.[0] ?? 1;
    const sz = pt.sc?.[2] ?? 1;
    const ry = pt.rot?.[1] ?? 0;
    if (pt.g === 'box' || pt.g === 'rbox') {
      // Tilted about x or z: use the projected depth/width.
      const tx = pt.rot?.[0] ?? 0;
      const tz = pt.rot?.[2] ?? 0;
      const w = pt.s[0] * sx * Math.abs(Math.cos(tz)) + pt.s[1] * Math.abs(Math.sin(tz));
      const d = pt.s[2] * sz * Math.abs(Math.cos(tx)) + pt.s[1] * Math.abs(Math.sin(tx));
      out.push({ k: 'rect', x: x - w / 2, y: z - d / 2, w, h: d, rx: pt.g === 'rbox' ? Math.min(pt.r ?? 0, w / 2, d / 2) : 0, rot: ry ? (-ry * 180) / Math.PI : 0, cx: x, cy: z, style });
    } else if (pt.g === 'cyl') {
      if (pt.rot && (Math.abs(pt.rot[0]) > 0.1 || Math.abs(pt.rot[2]) > 0.1)) {
        // Lying down: a rectangle the length of the cylinder.
        const r = Math.max(pt.s[0], pt.s[2]);
        const alongX = Math.abs(pt.rot[2]) > 0.1;
        const w = alongX ? pt.s[1] : r * 2;
        const d = alongX ? r * 2 : pt.s[1];
        out.push({ k: 'rect', x: x - w / 2, y: z - d / 2, w, h: d, rx: Math.min(r, 0.02), rot: ry ? (-ry * 180) / Math.PI : 0, cx: x, cy: z, style });
      } else {
        const r = Math.max(pt.s[0], pt.s[2]);
        out.push({ k: 'ellipse', cx: x, cy: z, rx: r * sx, ry: r * sz, style });
      }
    } else if (pt.g === 'sph') {
      out.push({ k: 'ellipse', cx: x, cy: z, rx: pt.s[0] * sx, ry: pt.s[0] * sz, style });
    } else if (pt.g === 'tor') {
      out.push({ k: 'ellipse', cx: x, cy: z, rx: (pt.s[0] + pt.s[1]) * sx, ry: (pt.s[0] + pt.s[1]) * sz, style: overhead ? 'dash' : 'line' });
    } else if (pt.g === 'lathe') {
      const r = Math.max(...(pt.pts ?? [[0, 0]]).map((q) => q[0]));
      out.push({ k: 'ellipse', cx: x, cy: z, rx: r * sx, ry: r * sz, style });
    }
  }
  return out;
}

/* ── Thumbnails ──────────────────────────────────────────────────────────────── */

let thumbRenderer: THREE.WebGLRenderer | null = null;
const thumbCache = new Map<string, string>();

/** Render a small product shot of an asset (cached as a data URL). */
export function renderThumb(key: string, build: (mats: AssetMaterials) => THREE.Object3D, size = 220): string | null {
  const hit = thumbCache.get(key);
  if (hit) return hit;
  try {
    thumbRenderer ??= new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  } catch {
    return null;
  }
  const r = thumbRenderer;
  r.setPixelRatio(1);
  r.setSize(size, size * 0.75, false);
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.toneMapping = THREE.ACESFilmicToneMapping;
  r.setClearColor(0x000000, 0);
  const mats = new AssetMaterials(false);
  const scene = new THREE.Scene();
  const obj = build(mats);
  scene.add(obj);
  scene.add(new THREE.HemisphereLight('#FFFFFF', '#CFC8BA', 1.6));
  const sun = new THREE.DirectionalLight('#FFF6E8', 2.2);
  sun.position.set(-2, 4, 3);
  scene.add(sun);
  const box = new THREE.Box3().setFromObject(obj);
  const c = box.getCenter(new THREE.Vector3());
  const s = box.getSize(new THREE.Vector3());
  const cam = new THREE.PerspectiveCamera(28, 4 / 3, 0.01, 100);
  const dir = new THREE.Vector3(0.75, 0.62, 1).normalize();
  const radius = Math.max(s.x, s.y, s.z) * 0.62 + 0.02;
  cam.position.copy(c).addScaledVector(dir, radius / Math.tan((14 * Math.PI) / 180));
  cam.lookAt(c);
  r.render(scene, cam);
  const url = r.domElement.toDataURL('image/png');
  scene.traverse((o) => o instanceof THREE.Mesh && o.geometry.dispose());
  mats.dispose();
  thumbCache.set(key, url);
  return url;
}
