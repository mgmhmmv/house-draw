import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Footprints, Maximize2, Scissors, Sun, X } from 'lucide-react';
import type { BuildingProject } from '../../../model/types';
import { cx } from '../../ui';
import { buildScene, type SceneParts } from './buildScene';
import { WalkController, type Move } from './walk';
import { buildServices, type ServiceSystem } from './services';

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
  const compassRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<Style>('rendered');
  const [cut, setCut] = useState<Cut>('all');
  const [hour, setHour] = useState(15);
  const [showSun, setShowSun] = useState(false);
  const [showCut, setShowCut] = useState(false);
  const [cutZ, setCutZ] = useState<number | null>(null); // horizontal section height (m), null = off
  const [walking, setWalking] = useState(false);
  const [services, setServices] = useState<'off' | 'all' | ServiceSystem>('off');
  const walkRef = useRef<WalkController | null>(null);
  const fillRef = useRef<THREE.AmbientLight | null>(null);

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
    controls.screenSpacePanning = true;

    // Hold Space and drag to slide the view without turning it.
    const typing = () => {
      const el = document.activeElement as HTMLElement | null;
      return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
    };
    const setPan = (on: boolean) => {
      controls.mouseButtons.LEFT = on ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
      renderer.domElement.style.cursor = on ? 'grab' : '';
    };
    const onSpaceDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || typing() || walkRef.current?.active) return;
      e.preventDefault(); // no page scroll
      if (!e.repeat) setPan(true);
    };
    const onSpaceUp = (e: KeyboardEvent) => e.code === 'Space' && setPan(false);
    const onBlur = () => setPan(false);
    window.addEventListener('keydown', onSpaceDown);
    window.addEventListener('keyup', onSpaceUp);
    window.addEventListener('blur', onBlur);

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

    // Extra soft light indoors while walking, so rooms under the roof are not in gloom.
    const fill = new THREE.AmbientLight('#FFFFFF', 0);
    scene.add(fill);
    fillRef.current = fill;
    walkRef.current = new WalkController(camera, renderer.domElement);

    const c = { renderer, scene, camera, controls, sun, ground, parts: null as SceneParts | null, frame: 0, fitted: false };
    ctx.current = c;
    const clock = new THREE.Clock();
    const fwd = new THREE.Vector3();
    let lastDeg = NaN;
    const loop = () => {
      c.frame = requestAnimationFrame(loop);
      const dt = clock.getDelta();
      if (walkRef.current?.active) walkRef.current.update(dt);
      else controls.update();
      renderer.render(scene, camera);
      // Compass: plan north is -z. Turn the dial so N points where north is on screen.
      camera.getWorldDirection(fwd);
      if (Math.hypot(fwd.x, fwd.z) > 1e-3) {
        const deg = Math.round((Math.atan2(-fwd.x, -fwd.z) * 180) / Math.PI * 10) / 10;
        if (deg !== lastDeg && compassRef.current) {
          compassRef.current.style.transform = `rotate(${deg}deg)`;
          lastDeg = deg;
        }
      } else if (compassRef.current) {
        // Looking straight down: use the camera's up vector instead.
        const up = camera.up.clone().applyQuaternion(camera.quaternion);
        const deg = Math.round((Math.atan2(-up.x, -up.z) * 180) / Math.PI * 10) / 10;
        if (deg !== lastDeg) {
          compassRef.current.style.transform = `rotate(${deg}deg)`;
          lastDeg = deg;
        }
      }
    };
    loop();

    return () => {
      cancelAnimationFrame(c.frame);
      walkRef.current?.stop();
      ro.disconnect();
      controls.dispose();
      window.removeEventListener('keydown', onSpaceDown);
      window.removeEventListener('keyup', onSpaceUp);
      window.removeEventListener('blur', onBlur);
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

  // Walk mode on/off.
  useEffect(() => {
    const c = ctx.current;
    const w = walkRef.current;
    if (!c || !w) return;
    if (walking) {
      const li = cut === 'all' ? 0 : Math.min(cut, model.levels.length - 1);
      c.controls.enabled = false;
      w.start(model.levels[li]);
      if (fillRef.current) fillRef.current.intensity = 0.9;
      const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && setWalking(false);
      window.addEventListener('keydown', onEsc);
      return () => window.removeEventListener('keydown', onEsc);
    }
    if (w.active) {
      w.stop();
      c.controls.enabled = true;
      if (fillRef.current) fillRef.current.intensity = 0;
      applyPreset(c, 'iso');
    }
    // Re-enter only when toggled; level changes while walking are ignored on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walking]);

  // Building services: built on demand, filtered by system and by the level cutaway.
  const svc = useMemo(() => (services === 'off' ? null : buildServices(model)), [model, services === 'off']);
  useEffect(() => {
    const c = ctx.current;
    if (!c || !svc) return;
    c.scene.add(svc.group);
    return () => {
      c.scene.remove(svc.group);
      svc.group.traverse((o) => o instanceof THREE.Mesh && o.geometry.dispose());
      svc.materials.forEach((m) => m.dispose());
    };
  }, [svc]);
  useEffect(() => {
    if (!svc) return;
    for (const o of svc.group.children) {
      const { system, level } = o.userData as { system: ServiceSystem; level: number };
      o.visible = (services === 'all' || services === system) && (cut === 'all' || level <= cut);
    }
  }, [svc, services, cut]);
  useEffect(() => {
    if (!svc) return;
    const plane = cutZ === null ? null : [new THREE.Plane(new THREE.Vector3(0, -1, 0), cutZ)];
    for (const m of svc.materials) {
      m.clippingPlanes = plane;
      m.needsUpdate = true;
    }
  }, [svc, cutZ]);

  // Doors stand open while walking, so you can see and step through them.
  useEffect(() => {
    for (const g of parts.levels) g.traverse((o) => o.userData.kind === 'door' && (o.visible = !walking));
  }, [walking, parts]);

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
          value={services}
          onChange={(v) => {
            setServices(v as typeof services);
            // Services sit inside walls and ceilings: switch to X-ray so they can be seen.
            if (v !== 'off' && style === 'rendered') setStyle('xray');
          }}
          options={[
            { id: 'off', label: 'No services' },
            { id: 'all', label: 'All services' },
            { id: 'electrical', label: 'Electrical' },
            { id: 'plumbing', label: 'Plumbing' },
            { id: 'hvac', label: 'HVAC' },
            ...(model.solar?.enabled !== false ? [{ id: 'solar', label: 'Solar' }] : []),
          ]}
        />
        <Chips
          value={String(cut)}
          onChange={(v) => setCut(v === 'all' ? 'all' : Number(v))}
          options={[{ id: 'all', label: 'Whole building' }, ...levelNames.map((n, i) => ({ id: String(i), label: n }))]}
        />
      </div>

      {walking && (
        <>
          <div className="pointer-events-none absolute left-1/2 top-16 hidden -translate-x-1/2 rounded-full bg-ink/85 px-3.5 py-1.5 text-2xs font-medium text-page backdrop-blur lg:block">
            W A S D to walk · drag to look · Shift to hurry · Esc to leave
          </div>
          <WalkPad onPress={(m, d) => walkRef.current?.press(m, d)} />
        </>
      )}

      <button
        onClick={() => ctx.current && faceNorth(ctx.current)}
        title="North · click to face north"
        aria-label="Compass. Click to face north."
        className={cx(
          'absolute bottom-[84px] flex h-14 w-14 items-center justify-center rounded-full border border-line bg-surface/95 shadow-float backdrop-blur transition-[left] hover:border-line-strong lg:bottom-4',
          walking ? 'left-[188px]' : 'left-3'
        )}
      >
        <div ref={compassRef} className="relative h-12 w-12">
          <svg viewBox="-24 -24 48 48" className="absolute inset-0 h-full w-full">
            {[0, 90, 180, 270].map((a) => (
              <line key={a} x1="0" y1="-21" x2="0" y2="-18" transform={`rotate(${a})`} stroke="rgb(var(--ink-3))" strokeWidth="1.2" strokeLinecap="round" />
            ))}
            <path d="M0 -13 L4 0 L-4 0 Z" fill="rgb(var(--accent))" />
            <path d="M0 13 L4 0 L-4 0 Z" fill="rgb(var(--ink-3) / 0.45)" />
            <circle r="1.6" fill="rgb(var(--surface))" stroke="rgb(var(--ink-2))" strokeWidth="0.8" />
          </svg>
          <span className="absolute left-1/2 top-[-1px] -translate-x-1/2 text-[9px] font-bold leading-none text-accent">N</span>
        </div>
      </button>

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
        {walking ? (
          <button onClick={() => setWalking(false)} className="flex h-10 items-center gap-2 rounded-[12px] bg-ink px-4 text-[13px] font-medium text-page shadow-float">
            <X className="h-4 w-4" /> Leave walk
          </button>
        ) : (
        <div className="flex overflow-hidden rounded-[12px] border border-line bg-surface/95 shadow-float backdrop-blur">
          <button onClick={() => setWalking(true)} className="flex h-9 items-center gap-1.5 border-r border-line px-3 text-[13px] font-medium text-ink-2 hover:bg-sunken hover:text-ink" title="Walk through">
            <Footprints className="h-4 w-4" /> Walk
          </button>
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
        )}
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

/** Turn the orbit camera so north is straight up the screen, keeping its height and distance. */
function faceNorth(c: { camera: THREE.PerspectiveCamera; controls: OrbitControls }) {
  const off = c.camera.position.clone().sub(c.controls.target);
  // Camera to the south (+z) of the target, looking north (a hair off vertical when looking down).
  const flat = Math.max(Math.hypot(off.x, off.z), 0.01);
  c.camera.position.set(c.controls.target.x, c.camera.position.y, c.controls.target.z + flat);
  c.camera.lookAt(c.controls.target);
  c.controls.update();
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

/** Touch pad for walking on phones and tablets (also usable with a mouse). */
function WalkPad({ onPress }: { onPress: (m: Move, down: boolean) => void }) {
  const btn = (m: Move, icon: React.ReactNode, cls: string) => (
    <button
      aria-label={m}
      className={cx('absolute flex h-12 w-12 items-center justify-center rounded-full bg-surface/90 text-ink shadow-float backdrop-blur active:bg-ink active:text-page', cls)}
      onPointerDown={(e) => {
        e.stopPropagation();
        (e.currentTarget as Element).setPointerCapture(e.pointerId);
        onPress(m, true);
      }}
      onPointerUp={() => onPress(m, false)}
      onPointerCancel={() => onPress(m, false)}
      onPointerLeave={() => onPress(m, false)}
    >
      {icon}
    </button>
  );
  return (
    <div className="absolute bottom-[84px] left-4 h-[156px] w-[156px] select-none lg:bottom-6" style={{ touchAction: 'none' }}>
      {btn('forward', <ChevronUp className="h-5 w-5" />, 'left-[54px] top-0')}
      {btn('left', <ChevronLeft className="h-5 w-5" />, 'left-0 top-[54px]')}
      {btn('right', <ChevronRight className="h-5 w-5" />, 'left-[108px] top-[54px]')}
      {btn('back', <ChevronDown className="h-5 w-5" />, 'left-[54px] top-[108px]')}
    </div>
  );
}
