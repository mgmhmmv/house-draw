import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Footprints, Maximize2, MessageSquarePlus, MousePointer2, Plus, Scissors, Search, Sparkles, Sun, X } from 'lucide-react';
import type { BuildingProject, SelectableElementKind } from '../../../model/types';
import { resolveHit, resolvePick, selectionOutline, type WalkHit } from './pick';
import { ASSETS, type AssetDef } from '../assets/catalog';
import { fitsSurface } from '../assets/placement';
import { cx } from '../../ui';
import { buildScene, type SceneParts } from './buildScene';
import { buildFrame } from '../model3d/faces';
import { getSolarConfig } from '../../../model/types';
import { WalkController, type Move } from './walk';
import { buildServices, type ServiceSystem } from './services';

type Style = 'rendered' | 'clay' | 'xray';
type Cut = 'all' | 'frame' | number; // everything; the roof structure with the covering off; or levels up to N with the roof off
type Preset = 'iso' | 'front' | 'side' | 'top';

const PAPER = new THREE.Color('#F6F5F2');

/**
 * The 3D model. Built from the same face model as the elevations and sections, lit like a
 * physical study model: soft sky light, one sun with shadows, a quiet ground.
 */
export interface ModelViewSelect {
  /** Select tool on: clicks pick elements. */
  active: boolean;
  onActive: (on: boolean) => void;
  selected: { id: string; kind: SelectableElementKind } | null;
  onPick: (id: string | null, kind?: SelectableElementKind) => void;
  /** Ask the AI about the selected element. */
  onAsk: () => void;
  /** Walk mode: place a library item where the user clicked. */
  onPlaceAt?: (def: AssetDef, hit: WalkHit, viewer: { x: number; y: number }) => void;
  /** Walk mode: ask the AI about a spot (e.g. to make a custom object for it). */
  onAskAt?: (hit: WalkHit, viewer: { x: number; y: number }) => void;
  /** Solar panels dragged along the roof (plan metres, east and south positive). */
  onSolarMove?: (target: { kind: 'array' } | { kind: 'panel'; index: number }, dx: number, dy: number) => void;
}

export function ModelView({ model, select }: { model: BuildingProject; select?: ModelViewSelect }) {
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
    ground.userData.kind = 'ground';
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
    c.scene.add(parts.roof, parts.roofFrame, parts.boundary, parts.site);
    if (!c.fitted) {
      applyPreset(c, 'iso');
      c.fitted = true;
    }
    return () => {
      // Disposal happens when the next parts replace these (or on unmount).
    };
  }, [parts]);

  // Select tool: a click (not a drag) picks the element under the pointer.
  const selectRef = useRef(select);
  selectRef.current = select;
  const modelRef = useRef(model);
  modelRef.current = model;
  useEffect(() => {
    const c = ctx.current;
    if (!c) return;
    const el = c.renderer.domElement;
    let down: { x: number; y: number } | null = null;
    // Dragging a selected solar panel (or the whole array) slides it along the roof.
    type SolarTarget = { kind: 'array' } | { kind: 'panel'; index: number };
    let drag: { target: SolarTarget; start: THREE.Vector3; dx: number; dy: number; moved: boolean; controls: boolean } | null = null;
    const ghostMat = new THREE.MeshBasicMaterial({ color: '#2F55D4', transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthTest: false });
    const ghost = new THREE.Mesh(new THREE.BufferGeometry(), ghostMat);
    ghost.renderOrder = 10;
    ghost.visible = false;
    c.scene.add(ghost);
    let ghostFrame = 0;
    const rayAt = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const ray = new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), c.camera);
      return ray;
    };
    const roofHits = (e: PointerEvent) =>
      c.parts?.roof.visible ? rayAt(e).intersectObjects([c.parts.roof], true).filter((h) => (h.object as THREE.Mesh).isMesh && h.object.visible) : [];
    const showGhost = () => {
      ghostFrame = 0;
      if (!drag) return;
      const m = modelRef.current;
      const s = getSolarConfig(m);
      const t = drag.target;
      const temp: BuildingProject = {
        ...m,
        solar:
          t.kind === 'array'
            ? { ...s, offsetX: (s.offsetX ?? 0) + drag.dx, offsetY: (s.offsetY ?? 0) + drag.dy }
            : { ...s, panelOffsets: { ...(s.panelOffsets ?? {}), [t.index]: { x: (s.panelOffsets?.[t.index]?.x ?? 0) + drag.dx, y: (s.panelOffsets?.[t.index]?.y ?? 0) + drag.dy } } },
      };
      const faces = buildFrame(temp).faces.filter((f) => f.kind === 'solar');
      const pos: number[] = [];
      faces.forEach((f, i) => {
        if (t.kind === 'panel' && i !== t.index) return;
        const q = f.pts.map((p) => new THREE.Vector3(p.x + f.n.x * 0.03, p.z + f.n.z * 0.03, p.y + f.n.y * 0.03));
        for (const [a, b, d] of [[0, 1, 2], [0, 2, 3]]) pos.push(q[a].x, q[a].y, q[a].z, q[b].x, q[b].y, q[b].z, q[d].x, q[d].y, q[d].z);
      });
      ghost.geometry.dispose();
      ghost.geometry = new THREE.BufferGeometry();
      ghost.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      ghost.visible = true;
    };
    const onDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY };
      const sel = selectRef.current;
      const s = sel?.selected;
      if (!sel?.active || walkRef.current?.active || e.button !== 0 || !s || (s.kind !== 'solar_panel' && s.kind !== 'solar_array') || !sel.onSolarMove) return;
      const h = roofHits(e)[0];
      const p = h && resolvePick(modelRef.current, h);
      if (!h || !p || p.kind !== 'solar_panel') return;
      const index = Number(p.id.replace('solar_panel_', ''));
      drag = { target: s.kind === 'solar_array' ? { kind: 'array' } : { kind: 'panel', index }, start: h.point.clone(), dx: 0, dy: 0, moved: false, controls: c.controls.enabled };
      c.controls.enabled = false;
      el.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!drag) return;
      // Follow the roof under the pointer (the panels themselves sit on it).
      const h = roofHits(e).find((x) => x.object.userData.kind !== 'solar') ?? roofHits(e)[0];
      if (!h) return;
      drag.dx = Math.round((h.point.x - drag.start.x) * 100) / 100;
      drag.dy = Math.round((h.point.z - drag.start.z) * 100) / 100;
      if (Math.hypot(drag.dx, drag.dy) > 0.03) drag.moved = true;
      if (!ghostFrame) ghostFrame = requestAnimationFrame(showGhost);
    };
    const onUp = (e: PointerEvent) => {
      const sel = selectRef.current;
      if (drag) {
        const d = drag;
        drag = null;
        down = null;
        c.controls.enabled = d.controls;
        cancelAnimationFrame(ghostFrame);
        ghostFrame = 0;
        ghost.visible = false;
        if (d.moved && sel?.onSolarMove) {
          sel.onSolarMove(d.target, d.dx, d.dy);
          if (d.target.kind === 'panel' && sel.selected?.id !== `solar_panel_${d.target.index}`) sel.onPick(`solar_panel_${d.target.index}`, 'solar_panel');
          return;
        }
      }
      const walkingNow = !!walkRef.current?.active;
      if (!down || !sel || (!sel.active && !walkingNow)) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      down = null;
      if (moved > 4 || e.button !== 0) return;
      const r = el.getBoundingClientRect();
      const ray = new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), c.camera);
      const targets: THREE.Object3D[] = [];
      c.parts?.levels.forEach((g) => g.visible && targets.push(g));
      if (c.parts?.roof.visible && !walkingNow) targets.push(c.parts.roof);
      if (c.parts?.boundary.visible) targets.push(c.parts.boundary);
      if (walkingNow) targets.push(c.ground);
      const hits = ray.intersectObjects(targets, true).filter((h) => (h.object as THREE.Mesh).isMesh && h.object.visible && isShown(h, c.renderer));
      if (walkingNow) {
        // Walk mode: pick what you look at, and remember the spot for placing things there.
        const h = hits.find((x) => x.object.userData.kind !== 'glass') ?? hits[0];
        if (!h) return setWalkHit(null);
        const wh = resolveHit(modelRef.current, h);
        setWalkHit(wh);
        sel.onPick(wh.pick?.id ?? null, wh.pick?.kind);
        return;
      }
      for (const h of hits) {
        const p = resolvePick(modelRef.current, h);
        if (p) return sel.onPick(p.id, p.kind);
        // Roof faces: keep looking underneath only if the roof is see-through.
        if (h.object.userData.kind === 'roof' || h.object.userData.kind === 'fascia') break;
      }
      sel.onPick(null);
    };
    el.addEventListener('pointerdown', onDown, true);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    return () => {
      el.removeEventListener('pointerdown', onDown, true);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      cancelAnimationFrame(ghostFrame);
      c.scene.remove(ghost);
      ghost.geometry.dispose();
      ghostMat.dispose();
    };
  }, []);

  const [walkHit, setWalkHit] = useState<WalkHit | null>(null);
  const [placeOpen, setPlaceOpen] = useState(false);
  useEffect(() => {
    if (!walking) {
      setWalkHit(null);
      setPlaceOpen(false);
    }
  }, [walking]);
  const viewer = () => {
    const p = ctx.current?.camera.position;
    return p ? { x: p.x, y: p.z } : { x: 0, y: 0 };
  };

  // Outline the selection.
  const selId = select?.selected?.id;
  const selKind = select?.selected?.kind;
  useEffect(() => {
    const c = ctx.current;
    if (!c || !selId) return;
    const o = selectionOutline(model, selId, selKind);
    if (!o) return;
    c.scene.add(o);
    return () => {
      c.scene.remove(o);
      o.traverse((x) => {
        if (x instanceof THREE.LineSegments || x instanceof THREE.Line) {
          x.geometry.dispose();
          (x.material as THREE.Material).dispose();
        }
      });
    };
  }, [model, selId, selKind]);

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
      const li = typeof cut === 'number' ? Math.min(cut, model.levels.length - 1) : 0;
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
      o.visible = (services === 'all' || services === system) && (typeof cut !== 'number' || level <= cut);
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
    c.parts.levels.forEach((g, i) => (g.visible = typeof cut !== 'number' || i <= cut));
    c.parts.roof.visible = cut === 'all';
    // The structure stays under the covering; "Roof frame" lifts the covering off to show it.
    c.parts.roofFrame.visible = typeof cut !== 'number';
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
          onChange={(v) => setCut(v === 'all' || v === 'frame' ? v : Number(v))}
          options={[{ id: 'all', label: 'Whole building' }, ...(model.roof.type !== 'flat' ? [{ id: 'frame', label: 'Roof frame' }] : []), ...levelNames.map((n, i) => ({ id: String(i), label: n }))]}
        />
      </div>

      {walking && (
        <>
          <div className="pointer-events-none absolute left-1/2 top-16 hidden -translate-x-1/2 rounded-full bg-ink/85 px-3.5 py-1.5 text-2xs font-medium text-page backdrop-blur lg:block">
            W A S D to walk · double-click to step there · drag to look · Shift to hurry · Esc to leave
          </div>
          <WalkPad onPress={(m, d) => walkRef.current?.press(m, d)} />
          {walkHit && select && (
            <WalkActions
              hit={walkHit}
              open={placeOpen}
              onOpen={setPlaceOpen}
              onAsk={() => {
                if (walkHit.pick) select.onAsk();
                else select.onAskAt?.(walkHit, viewer());
              }}
              onCustom={() => {
                setPlaceOpen(false);
                select.onAskAt?.(walkHit, viewer());
              }}
              onPlace={(def) => {
                setPlaceOpen(false);
                select.onPlaceAt?.(def, walkHit, viewer());
              }}
              onClose={() => {
                setWalkHit(null);
                setPlaceOpen(false);
                select.onPick(null);
              }}
            />
          )}
        </>
      )}

      <button
        onClick={() => ctx.current && faceNorth(ctx.current)}
        title="North · click to face north"
        aria-label="Compass. Click to face north."
        className={cx(
          'absolute bottom-[60px] flex h-12 w-12 items-center justify-center rounded-full border border-line bg-surface/95 shadow-float backdrop-blur transition-[left] hover:border-line-strong lg:bottom-4 lg:h-14 lg:w-14',
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

      <div className="absolute bottom-3 left-3 right-3 flex flex-col items-end gap-2 lg:bottom-4 lg:left-auto">
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
        <div className="flex max-w-full items-center gap-2">
        {select?.active && select.selected && (
          <button
            onClick={select.onAsk}
            title="Ask the AI about this"
            className="flex h-9 items-center gap-1.5 rounded-[12px] border border-line bg-surface/95 px-3 text-[13px] font-medium text-accent shadow-float backdrop-blur hover:border-accent/40 animate-fade-up"
          >
            <MessageSquarePlus className="h-4 w-4" /> Ask AI about this
          </button>
        )}
        <div className="flex min-w-0 max-w-full overflow-x-auto rounded-[12px] border border-line bg-surface/95 shadow-float backdrop-blur no-scrollbar [&>button]:shrink-0">
          {select && (
            <button
              onClick={() => select.onActive(!select.active)}
              title="Select and edit (changes wait for Save)"
              aria-pressed={select.active}
              className={cx('flex h-9 w-9 items-center justify-center border-r border-line', select.active ? 'bg-ink text-page' : 'text-ink-2 hover:bg-sunken hover:text-ink')}
            >
              <MousePointer2 className="h-4 w-4" />
            </button>
          )}
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
  for (const g of [...p.levels, p.roof, p.roofFrame, p.boundary, p.site]) {
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
    <div className="absolute bottom-16 left-4 h-[156px] w-[156px] select-none lg:bottom-6" style={{ touchAction: 'none' }}>
      {btn('forward', <ChevronUp className="h-5 w-5" />, 'left-[54px] top-0')}
      {btn('left', <ChevronLeft className="h-5 w-5" />, 'left-0 top-[54px]')}
      {btn('right', <ChevronRight className="h-5 w-5" />, 'left-[108px] top-[54px]')}
      {btn('back', <ChevronDown className="h-5 w-5" />, 'left-[54px] top-[108px]')}
    </div>
  );
}

/** Ignore hits on geometry hidden by the section cut. */
function isShown(h: THREE.Intersection, renderer: THREE.WebGLRenderer) {
  const mat = (h.object as THREE.Mesh).material as THREE.Material | THREE.Material[];
  const planes = (Array.isArray(mat) ? mat[0] : mat)?.clippingPlanes ?? renderer.clippingPlanes;
  return !planes?.length || planes.every((p) => p.distanceToPoint(h.point) >= -1e-3);
}

const SURFACE_LABEL = { wall: 'Wall', floor: 'Floor', ceiling: 'Ceiling', object: 'Object' } as const;
const KIND_LABEL: Record<string, string> = { wall: 'Wall', opening: 'Door / window', room: 'Floor', furniture: 'Object', mep_node: 'Fixture', solar_panel: 'Solar panel' };

/** Walk mode: what you clicked, with Ask AI and Place here (items that fit that surface). */
function WalkActions({
  hit,
  open,
  onOpen,
  onAsk,
  onPlace,
  onCustom,
  onClose,
}: {
  hit: WalkHit;
  open: boolean;
  onOpen: (v: boolean) => void;
  onAsk: () => void;
  onPlace: (def: AssetDef) => void;
  onCustom: () => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const surface = hit.surface === 'object' ? null : hit.surface;
  const items = useMemo(() => {
    if (!surface) return [];
    const t = q.trim().toLowerCase();
    return ASSETS.filter((a) => fitsSurface(a, surface) && (!t || `${a.name} ${a.keywords ?? ''} ${a.category}`.toLowerCase().includes(t))).slice(0, 80);
  }, [surface, q, open]);
  const label = hit.pick ? KIND_LABEL[hit.pick.kind] ?? SURFACE_LABEL[hit.surface] : hit.surface === 'floor' && hit.levelIndex === 0 ? 'Ground' : SURFACE_LABEL[hit.surface];
  return (
    <div className="absolute bottom-16 left-1/2 z-20 w-[min(420px,calc(100%-24px))] -translate-x-1/2 lg:bottom-16">
      {open && surface && (
        <div className="mb-2 overflow-hidden rounded-[14px] border border-line bg-surface shadow-float animate-fade-up">
          <div className="relative border-b border-line p-2">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-3" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={`Items for the ${surface}…`}
              className="h-8 w-full rounded-[9px] bg-raised pl-7 pr-2 text-[13px] focus:outline-none"
            />
          </div>
          <div className="max-h-64 overflow-y-auto p-1">
            {items.map((a) => (
              <button key={a.id} onClick={() => onPlace(a)} className="flex w-full items-center gap-2 rounded-[9px] px-2.5 py-1.5 text-left text-[13px] hover:bg-sunken">
                <span className="min-w-0 flex-1 truncate">{a.name}</span>
                <span className="font-mono text-[10.5px] text-ink-3">
                  {a.w.toFixed(2)}×{a.d.toFixed(2)}
                </span>
              </button>
            ))}
            {!items.length && <p className="px-2.5 py-2 text-[13px] text-ink-3">Nothing in the library fits.</p>}
            <button onClick={onCustom} className="mt-0.5 flex w-full items-center gap-2 rounded-[9px] border-t border-line px-2.5 py-2 text-left text-[13px] font-medium text-accent hover:bg-accent-soft">
              <Sparkles className="h-3.5 w-3.5" /> Make a custom one with AI…
            </button>
          </div>
        </div>
      )}
      <div className="flex items-center gap-1.5 rounded-[14px] border border-line bg-surface/95 p-1.5 pl-3 shadow-float backdrop-blur">
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{label}</span>
        <button onClick={onAsk} className="flex h-8 items-center gap-1.5 rounded-[9px] px-2.5 text-[13px] font-medium text-accent hover:bg-accent-soft">
          <MessageSquarePlus className="h-4 w-4" /> Ask AI
        </button>
        {surface && (
          <button onClick={() => onOpen(!open)} className={cx('flex h-8 items-center gap-1.5 rounded-[9px] px-2.5 text-[13px] font-medium', open ? 'bg-ink text-page' : 'text-ink-2 hover:bg-sunken hover:text-ink')}>
            <Plus className="h-4 w-4" /> Place here
          </button>
        )}
        <button onClick={onClose} aria-label="Clear" className="flex h-8 w-8 items-center justify-center rounded-[9px] text-ink-3 hover:bg-sunken hover:text-ink">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
