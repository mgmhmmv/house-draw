import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Maximize2, Scissors, Sun } from 'lucide-react';
import type { BuildingProject } from '../../../model/types';
import { cx } from '../../ui';
import { buildScene, type SceneParts } from './buildScene';

type Style = 'rendered' | 'clay' | 'xray';
type Cut = 'all' | number; // show everything, or levels up to N with the roof off
type Preset = 'iso' | 'front' | 'side' | 'top';

const PAPER = new THREE.Color('#F6F5F2');

/**
 * The 3D model. Built from the same face model as the elevations and sections, lit like a
 * physical study model: soft sky light, one sun with shadows, a quiet ground.
 */
export function ModelView({ model }: { model: BuildingProject }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<Style>('rendered');
  const [cut, setCut] = useState<Cut>('all');
  const [hour, setHour] = useState(15);
  const [showSun, setShowSun] = useState(false);
  const [showCut, setShowCut] = useState(false);
  const [cutZ, setCutZ] = useState<number | null>(null); // horizontal section height (m), null = off

  // Long-lived three.js objects.
  const ctx = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    sun: THREE.DirectionalLight;
    ground: THREE.Mesh;
    parts: SceneParts | null;
    frame: number;
    fitted: boolean;
  } | null>(null);

  useEffect(() => {
    const host = hostRef.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.localClippingEnabled = true;
    host.appendChild(renderer.domElement);
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.touchAction = 'none';

    const scene = new THREE.Scene();
    scene.background = PAPER;
    scene.fog = new THREE.Fog(PAPER, 80, 220);

    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 1000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI * 0.495;
    controls.minDistance = 3;
    controls.maxDistance = 160;

    scene.add(new THREE.HemisphereLight('#FFFFFF', '#D9D2C3', 1.35));
    const sun = new THREE.DirectionalLight('#FFF4E2', 2.4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    scene.add(sun, sun.target);

    const ground = new THREE.Mesh(new THREE.CircleGeometry(120, 64), new THREE.MeshStandardMaterial({ color: '#ECE8DF', roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.002;
    ground.receiveShadow = true;
    scene.add(ground);
    const grid = new THREE.GridHelper(120, 120, '#DCD7CC', '#E4E0D6');
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.6;
    scene.add(grid);

    const resize = () => {
      const r = host.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return;
      renderer.setSize(r.width, r.height, false);
      renderer.domElement.style.width = `${r.width}px`;
      renderer.domElement.style.height = `${r.height}px`;
      camera.aspect = r.width / r.height;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    resize();

    const c = { renderer, scene, camera, controls, sun, ground, parts: null as SceneParts | null, frame: 0, fitted: false };
    ctx.current = c;
    const loop = () => {
      c.frame = requestAnimationFrame(loop);
      controls.update();
      renderer.render(scene, camera);
    };
    loop();

    return () => {
      cancelAnimationFrame(c.frame);
      ro.disconnect();
      controls.dispose();
      disposeParts(c);
      ground.geometry.dispose();
      (ground.material as THREE.Material).dispose();
      grid.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      ctx.current = null;
    };
  }, []);

  // Rebuild the building whenever the model or style changes.
  const parts = useMemo(() => buildScene(model, style !== 'rendered'), [model, style]);
  useEffect(() => {
    const c = ctx.current;
    if (!c) return;
    disposeParts(c);
    c.parts = parts;
    parts.levels.forEach((g) => c.scene.add(g));
    c.scene.add(parts.roof, parts.site);
    if (!c.fitted) {
      applyPreset(c, 'iso');
      c.fitted = true;
    }
    return () => {
      // Disposal happens when the next parts replace these (or on unmount).
    };
  }, [parts]);

  // X-ray: the building shell turns to glass so rooms, furniture and services show through.
  useEffect(() => {
    if (style !== 'xray') return;
    for (const g of [...parts.levels, parts.roof]) {
      g.traverse((o) => {
        if (!(o instanceof THREE.Mesh) || o.userData.solid) return;
        const m = o.material as THREE.MeshStandardMaterial;
        m.transparent = true;
        m.opacity = 0.16;
        m.depthWrite = false;
        o.castShadow = false;
      });
    }
    parts.edges.forEach((e) => ((e.material as THREE.LineBasicMaterial).opacity = 0.75));
  }, [style, parts]);

  // Horizontal section: clip everything above the cut height.
  useEffect(() => {
    const plane = cutZ === null ? null : [new THREE.Plane(new THREE.Vector3(0, -1, 0), cutZ)];
    for (const m of parts.materials) {
      m.clippingPlanes = plane;
      m.needsUpdate = true;
    }
  }, [cutZ, parts]);

  // Cutaway: hide the roof and levels above the chosen one.
  useEffect(() => {
    const c = ctx.current;
    if (!c?.parts) return;
    c.parts.levels.forEach((g, i) => (g.visible = cut === 'all' || i <= cut));
    c.parts.roof.visible = cut === 'all';
  }, [cut, parts]);

  // Sun: sweep east to west through the day; shadow camera hugs the building.
  useEffect(() => {
    const c = ctx.current;
    if (!c?.parts) return;
    const box = c.parts.box;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3()).length();
    const t = (hour - 6) / 12; // 0 at sunrise (east), 0.5 at noon (south), 1 at sunset (west)
    const alt = Math.min(1.35, Math.max(0.15, Math.sin(Math.PI * t) * 1.25));
    const dir = new THREE.Vector3(Math.cos(Math.PI * t) * Math.cos(alt), Math.sin(alt), Math.sin(Math.PI * t) * Math.cos(alt) + 0.25).normalize();
    c.sun.position.copy(center).addScaledVector(dir, size * 1.6);
    c.sun.target.position.copy(center);
    const cam = c.sun.shadow.camera;
    cam.left = cam.bottom = -size;
    cam.right = cam.top = size;
    cam.near = 0.5;
    cam.far = size * 4;
    cam.updateProjectionMatrix();
    c.sun.intensity = 1.2 + 1.4 * Math.sin(Math.PI * t);
  }, [hour, parts]);

  const levelNames = model.levels.map((l) => l.name.replace(/\s*\(.*\)/, ''));

  return (
    <div className="relative h-full w-full overflow-hidden" style={{ background: '#F6F5F2' }}>
      <div ref={hostRef} className="absolute inset-0" />

      <div className="absolute left-3 right-3 top-3 flex flex-wrap items-start gap-2">
        <Chips
          value={style}
          onChange={(v) => setStyle(v as Style)}
          options={[
            { id: 'rendered', label: 'Rendered' },
            { id: 'clay', label: 'Clay' },
            { id: 'xray', label: 'X-ray' },
          ]}
        />
        <Chips
          value={String(cut)}
          onChange={(v) => setCut(v === 'all' ? 'all' : Number(v))}
          options={[{ id: 'all', label: 'Whole building' }, ...levelNames.map((n, i) => ({ id: String(i), label: n }))]}
        />
      </div>

      <div className="absolute bottom-[84px] right-3 flex flex-col items-end gap-2 lg:bottom-4">
        {showCut && (
          <div className="flex items-center gap-3 rounded-[12px] border border-line bg-surface/95 px-3 py-2 shadow-float backdrop-blur animate-fade-up">
            <span className="w-16 text-[13px] font-medium tabular-nums">{cutZ === null ? 'No cut' : `${cutZ.toFixed(1)} m`}</span>
            <input
              type="range"
              min={0.2}
              max={Math.ceil(parts.roofTopZ + 0.5)}
              step={0.1}
              value={cutZ ?? Math.ceil(parts.roofTopZ + 0.5)}
              onChange={(e) => {
                const v = Number(e.target.value);
                setCutZ(v >= parts.roofTopZ + 0.4 ? null : v);
              }}
              className="w-36 accent-[rgb(var(--accent))]"
              aria-label="Section height"
            />
          </div>
        )}
        {showSun && (
          <div className="flex items-center gap-3 rounded-[12px] border border-line bg-surface/95 px-3 py-2 shadow-float backdrop-blur animate-fade-up">
            <span className="w-11 text-[13px] font-medium tabular-nums">{fmtHour(hour)}</span>
            <input type="range" min={6.5} max={17.5} step={0.25} value={hour} onChange={(e) => setHour(Number(e.target.value))} className="w-36 accent-[rgb(var(--accent))]" aria-label="Time of day" />
          </div>
        )}
        <div className="flex overflow-hidden rounded-[12px] border border-line bg-surface/95 shadow-float backdrop-blur">
          {(['iso', 'front', 'side', 'top'] as Preset[]).map((p) => (
            <button
              key={p}
              onClick={() => ctx.current && applyPreset(ctx.current, p)}
              className="h-9 px-3 text-[13px] font-medium capitalize text-ink-2 hover:bg-sunken hover:text-ink"
            >
              {p === 'iso' ? '3D' : p}
            </button>
          ))}
          <button aria-label="Section height" title="Section height" onClick={() => setShowCut((s) => !s)} className={cx('flex h-9 w-9 items-center justify-center border-l border-line hover:bg-sunken', showCut || cutZ !== null ? 'text-accent' : 'text-ink-2')}>
            <Scissors className="h-4 w-4" />
          </button>
          <button aria-label="Sun position" title="Sun position" onClick={() => setShowSun((s) => !s)} className={cx('flex h-9 w-9 items-center justify-center border-l border-line hover:bg-sunken', showSun ? 'text-accent' : 'text-ink-2')}>
            <Sun className="h-4 w-4" />
          </button>
          <button aria-label="Fit model" title="Fit model" onClick={() => ctx.current && applyPreset(ctx.current, 'iso')} className="flex h-9 w-9 items-center justify-center border-l border-line text-ink-2 hover:bg-sunken hover:text-ink">
            <Maximize2 className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function Chips({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { id: string; label: string }[] }) {
  return (
    <div className="flex max-w-full gap-1 overflow-x-auto rounded-[12px] border border-line bg-surface/95 p-1 shadow-float backdrop-blur no-scrollbar">
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          className={cx('h-7 shrink-0 rounded-[8px] px-3 text-[13px] font-medium', value === o.id ? 'bg-ink text-page' : 'text-ink-2 hover:bg-sunken')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const fmtHour = (h: number) => `${Math.floor(h)}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;

function disposeParts(c: { scene: THREE.Scene; parts: SceneParts | null }) {
  const p = c.parts;
  if (!p) return;
  for (const g of [...p.levels, p.roof, p.site]) {
    c.scene.remove(g);
    g.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) o.geometry.dispose();
    });
  }
  p.materials.forEach((m) => m.dispose());
  c.parts = null;
}

function applyPreset(c: { camera: THREE.PerspectiveCamera; controls: OrbitControls; parts: SceneParts | null }, preset: Preset) {
  if (!c.parts) return;
  const box = c.parts.box;
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const radius = Math.max(size.x, size.y, size.z) * 0.52 + 0.5;
  const fov = (c.camera.fov * Math.PI) / 180;
  const dist = (radius / Math.sin(fov / 2)) * (c.camera.aspect < 1 ? 1.35 / c.camera.aspect : 1);
  const dirs: Record<Preset, THREE.Vector3> = {
    iso: new THREE.Vector3(0.75, 0.55, 1),
    front: new THREE.Vector3(0, 0.12, 1),
    side: new THREE.Vector3(1, 0.12, 0),
    top: new THREE.Vector3(0, 1, 0.001),
  };
  c.camera.position.copy(center).addScaledVector(dirs[preset].normalize(), dist);
  c.controls.target.copy(center);
  c.controls.update();
}
