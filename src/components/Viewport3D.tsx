import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  BuildingProject,
  DoorFinishMaterial,
  ExteriorFacadeMaterial,
  FloorFinish,
  getDesignConfig,
  getHVACConfig,
  getSolarConfig,
  InteriorWallMaterial,
  Render3DMode,
  RoofMaterial,
  WindowFrameFinish,
} from '../model/types';
import { levelBoundingBox, polygonCentroid, wallAngleRad, wallLength } from '../engine/geometry';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Box,
  Camera,
  Compass,
  Footprints,
  Palette,
  RotateCcw,
  RotateCw,
  Sun,
} from 'lucide-react';

interface Viewport3DProps {
  project: BuildingProject;
  onUpdateProject?: (proj: BuildingProject) => void;
  isLight?: boolean;
}

type TexturePattern =
  | 'seam'
  | 'tile'
  | 'shingle'
  | 'slab'
  | 'slate'
  | 'shake'
  | 'green'
  | 'corrugated'
  | 'brick'
  | 'stone'
  | 'travertine'
  | 'slats'
  | 'render'
  | 'cladding'
  | 'oak_panel'
  | 'herringbone'
  | 'marble'
  | 'terrazzo'
  | 'wood_plank'
  | 'solar';

export const ROOF_MATERIAL_OPTIONS: {
  id: RoofMaterial;
  label: string;
  base: string;
  accent: string;
  roughness: number;
  metalness: number;
  pattern: TexturePattern;
}[] = [
  { id: 'standing_seam', label: 'Standing Seam Metal', base: '#334155', accent: '#1e293b', roughness: 0.42, metalness: 0.55, pattern: 'seam' },
  { id: 'clay_tile', label: 'Terracotta Clay Tiles', base: '#b45309', accent: '#7c2d12', roughness: 0.72, metalness: 0.05, pattern: 'tile' },
  { id: 'natural_slate', label: 'Natural Blue-Grey Slate', base: '#3f4b5b', accent: '#1f2937', roughness: 0.68, metalness: 0.12, pattern: 'slate' },
  { id: 'asphalt_shingle', label: 'Architectural Shingles', base: '#475569', accent: '#1e293b', roughness: 0.85, metalness: 0.04, pattern: 'shingle' },
  { id: 'cedar_shake', label: 'Cedar Wood Shake', base: '#854d0e', accent: '#451a03', roughness: 0.84, metalness: 0.02, pattern: 'shake' },
  { id: 'green_roof', label: 'Living Green Roof (Sedum)', base: '#3f7d3a', accent: '#275923', roughness: 0.94, metalness: 0.0, pattern: 'green' },
  { id: 'corrugated_metal', label: 'Corrugated Zinc Sheet', base: '#64748b', accent: '#94a3b8', roughness: 0.36, metalness: 0.65, pattern: 'corrugated' },
  { id: 'marine_metal', label: 'Maldives Marine PVDF Alu-Zinc', base: '#0e7490', accent: '#06b6d4', roughness: 0.34, metalness: 0.68, pattern: 'corrugated' },
  { id: 'thatch_palm', label: 'Coconut Palm Thatch (Fangi)', base: '#a16207', accent: '#713f12', roughness: 0.92, metalness: 0.0, pattern: 'shake' },
  { id: 'concrete_slab', label: 'Architectural Concrete Slab', base: '#94a3b8', accent: '#64748b', roughness: 0.88, metalness: 0.04, pattern: 'slab' },
];

export const FACADE_MATERIAL_OPTIONS: {
  id: ExteriorFacadeMaterial;
  label: string;
  base: string;
  accent: string;
  roughness: number;
  pattern: TexturePattern;
}[] = [
  { id: 'white_render', label: 'Stucco White Render', base: '#eef2f6', accent: '#cbd5e1', roughness: 0.82, pattern: 'render' },
  { id: 'cement_plaster', label: 'Sand-Cement Trowel Plaster', base: '#f1f5f9', accent: '#cbd5e1', roughness: 0.84, pattern: 'render' },
  { id: 'coral_render', label: 'Maldivian Coral-Lime Whitewash', base: '#faf8f5', accent: '#d6d3d1', roughness: 0.9, pattern: 'stone' },
  { id: 'tropical_louvres', label: 'Tropical Monsoon Teak Louvres', base: '#854d0e', accent: '#422006', roughness: 0.72, pattern: 'slats' },
  { id: 'exposed_brick', label: 'Exposed Kiln Brick', base: '#9f3f2c', accent: '#d6ccc2', roughness: 0.86, pattern: 'brick' },
  { id: 'stone_veneer', label: 'Natural Ashlar Stone', base: '#9ca3af', accent: '#4b5563', roughness: 0.88, pattern: 'stone' },
  { id: 'timber_slats', label: 'Cedar Timber Cladding', base: '#9a5b32', accent: '#4a2810', roughness: 0.76, pattern: 'slats' },
  { id: 'travertine_stone', label: 'Warm Travertine Limestone', base: '#dfd3c3', accent: '#b8a99a', roughness: 0.78, pattern: 'travertine' },
  { id: 'charcoal_cladding', label: 'Charcoal Fiber Panels', base: '#27303f', accent: '#111827', roughness: 0.58, pattern: 'cladding' },
];

export const INTERIOR_WALL_OPTIONS: {
  id: InteriorWallMaterial;
  label: string;
  base: string;
  accent: string;
  roughness: number;
  pattern: TexturePattern;
}[] = [
  { id: 'matte_white', label: 'Gallery Matte White', base: '#f8fafc', accent: '#e2e8f0', roughness: 0.88, pattern: 'render' },
  { id: 'smooth_cement_plaster', label: 'Smooth Skim-Coat Cement Plaster', base: '#f1f5f9', accent: '#d1d5db', roughness: 0.8, pattern: 'render' },
  { id: 'teak_paneling', label: 'Maldivian Teak & Breeze Slat', base: '#9a5b32', accent: '#451a03', roughness: 0.72, pattern: 'oak_panel' },
  { id: 'warm_beige', label: 'Warm Sand Plaster', base: '#ede0d4', accent: '#d6c3b1', roughness: 0.84, pattern: 'render' },
  { id: 'sage_green', label: 'Muted Sage Mineral', base: '#cad2c5', accent: '#a3b18a', roughness: 0.85, pattern: 'render' },
  { id: 'venetian_plaster', label: 'Venetian Lime Plaster', base: '#e5e7eb', accent: '#cbd5e1', roughness: 0.55, pattern: 'marble' },
  { id: 'exposed_concrete', label: 'Board-Formed Concrete', base: '#9ca3af', accent: '#6b7280', roughness: 0.8, pattern: 'slab' },
  { id: 'oak_paneling', label: 'Acoustic Oak Fluted Slat', base: '#b07d4f', accent: '#5e3c1e', roughness: 0.72, pattern: 'oak_panel' },
];

export const FLOOR_FINISH_OPTIONS: {
  id: FloorFinish;
  label: string;
  base: string;
  accent: string;
  roughness: number;
  pattern: TexturePattern;
}[] = [
  { id: 'porcelain', label: 'Large-Format Porcelain', base: '#e5e7eb', accent: '#cbd5e1', roughness: 0.35, pattern: 'slab' },
  { id: 'hardwood', label: 'Engineered White Oak', base: '#9c6644', accent: '#6f4518', roughness: 0.58, pattern: 'wood_plank' },
  { id: 'herringbone_oak', label: 'Herringbone Parquet', base: '#b07d4f', accent: '#7f4f24', roughness: 0.5, pattern: 'herringbone' },
  { id: 'carrara_marble', label: 'Carrara Marble Slab', base: '#f3f4f6', accent: '#94a3b8', roughness: 0.2, pattern: 'marble' },
  { id: 'terrazzo', label: 'Venetian Terrazzo', base: '#e2e8f0', accent: '#64748b', roughness: 0.32, pattern: 'terrazzo' },
  { id: 'ceramic_antiskid', label: 'Anti-Skid Ceramic', base: '#64748b', accent: '#475569', roughness: 0.72, pattern: 'slab' },
  { id: 'concrete', label: 'Troweled Microcement', base: '#71717a', accent: '#52525b', roughness: 0.65, pattern: 'render' },
  { id: 'carpet', label: 'Woven Wool Carpet', base: '#cbd5e1', accent: '#94a3b8', roughness: 0.95, pattern: 'green' },
];

const WINDOW_FRAME_COLORS: Record<WindowFrameFinish, number> = {
  anthracite: 0x1e293b,
  bronze: 0x5c4033,
  silver_anodized: 0x94a3b8,
  timber_oak: 0x9a6b42,
  matte_black: 0x0f172a,
};

const DOOR_MATERIAL_COLORS: Record<DoorFinishMaterial, number> = {
  walnut: 0x5c3a21,
  oak: 0xb6895b,
  matte_black: 0x18181b,
  frosted_glass: 0xdbeafe,
  white_lacquer: 0xf1f5f9,
};

function createPatternTexture(
  pattern: TexturePattern,
  baseHex: string,
  accentHex: string,
  repeatX = 3,
  repeatY = 3
): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = baseHex;
    ctx.fillRect(0, 0, size, size);

    if (pattern === 'seam' || pattern === 'corrugated' || pattern === 'slats' || pattern === 'oak_panel') {
      const step = pattern === 'corrugated' ? 16 : pattern === 'seam' ? 42 : 20;
      const lineW = pattern === 'seam' ? 5 : pattern === 'corrugated' ? 6 : 4;
      ctx.fillStyle = accentHex;
      for (let x = 0; x < size; x += step) {
        ctx.fillRect(x, 0, lineW, size);
      }
    } else if (pattern === 'tile') {
      ctx.strokeStyle = accentHex;
      ctx.lineWidth = 3;
      const rows = 8;
      const cols = 6;
      const rh = size / rows;
      const cw = size / cols;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          ctx.beginPath();
          ctx.arc(c * cw + cw / 2, r * rh + rh * 0.45, cw * 0.48, 0, Math.PI, false);
          ctx.stroke();
        }
      }
    } else if (pattern === 'brick' || pattern === 'slate' || pattern === 'shingle' || pattern === 'shake' || pattern === 'stone' || pattern === 'travertine') {
      const rows = pattern === 'brick' ? 10 : pattern === 'stone' || pattern === 'travertine' ? 6 : 8;
      const cols = pattern === 'brick' ? 4 : pattern === 'travertine' ? 3 : 5;
      const rh = size / rows;
      const cw = size / cols;
      ctx.strokeStyle = accentHex;
      ctx.lineWidth = pattern === 'brick' ? 3 : 2.2;
      for (let r = 0; r < rows; r++) {
        const y = r * rh;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(size, y);
        ctx.stroke();
        const offset = r % 2 === 0 ? 0 : cw / 2;
        for (let c = 0; c <= cols; c++) {
          const x = (c * cw + offset) % size;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x, y + rh);
          ctx.stroke();
          if ((r + c) % 3 === 0) {
            ctx.fillStyle = 'rgba(0,0,0,0.08)';
            ctx.fillRect(x + 2, y + 2, cw - 4, rh - 4);
          }
        }
      }
    } else if (pattern === 'cladding' || pattern === 'slab') {
      ctx.strokeStyle = accentHex;
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, size - 2, size - 2);
      ctx.beginPath();
      ctx.moveTo(0, size / 2);
      ctx.lineTo(size, size / 2);
      ctx.moveTo(size / 2, 0);
      ctx.lineTo(size / 2, size);
      ctx.stroke();
    } else if (pattern === 'green') {
      for (let i = 0; i < 420; i++) {
        const x = (i * 73) % size;
        const y = (i * 137) % size;
        ctx.fillStyle = i % 2 === 0 ? accentHex : 'rgba(134,239,172,0.28)';
        ctx.fillRect(x, y, 5, 5);
      }
    } else if (pattern === 'wood_plank' || pattern === 'herringbone') {
      ctx.strokeStyle = accentHex;
      ctx.lineWidth = 2;
      const step = 32;
      for (let i = -size; i < size * 2; i += step) {
        if (pattern === 'herringbone') {
          ctx.beginPath();
          ctx.moveTo(i, 0);
          ctx.lineTo(i + size / 2, size / 2);
          ctx.lineTo(i, size);
          ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.moveTo(0, i);
          ctx.lineTo(size, i);
          ctx.stroke();
        }
      }
    } else if (pattern === 'marble') {
      ctx.strokeStyle = accentHex;
      ctx.lineWidth = 1.6;
      for (let v = 0; v < 5; v++) {
        ctx.beginPath();
        ctx.moveTo(0, v * 52 + 10);
        ctx.bezierCurveTo(85, v * 52 - 14, 170, v * 52 + 34, size, v * 52 + 12);
        ctx.stroke();
      }
    } else if (pattern === 'terrazzo') {
      const chipColors = ['#475569', '#9a5b32', '#0284c7', '#cbd5e1'];
      for (let i = 0; i < 160; i++) {
        ctx.fillStyle = chipColors[i % chipColors.length];
        ctx.fillRect((i * 59) % size, (i * 101) % size, 4 + (i % 5), 4 + ((i * 3) % 5));
      }
    } else if (pattern === 'solar') {
      ctx.fillStyle = '#0f2557';
      ctx.fillRect(0, 0, size, size);
      ctx.strokeStyle = '#93c5fd';
      ctx.lineWidth = 2;
      const cols = 6;
      const rows = 10;
      for (let c = 0; c <= cols; c++) {
        ctx.beginPath();
        ctx.moveTo((c * size) / cols, 0);
        ctx.lineTo((c * size) / cols, size);
        ctx.stroke();
      }
      for (let r = 0; r <= rows; r++) {
        ctx.beginPath();
        ctx.moveTo(0, (r * size) / rows);
        ctx.lineTo(size, (r * size) / rows);
        ctx.stroke();
      }
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 6;
      ctx.strokeRect(3, 3, size - 6, size - 6);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.needsUpdate = true;
  return tex;
}

export const Viewport3D: React.FC<Viewport3DProps> = ({ project, onUpdateProject, isLight = true }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [renderMode, setRenderMode] = useState<Render3DMode>('pbr');
  const [cutawayHeight, setCutawayHeight] = useState<number>(12.0);
  const [sunHour, setSunHour] = useState<number>(14);
  const [showRoof, setShowRoof] = useState<boolean>(true);
  const [cameraPreset, setCameraPreset] = useState<'iso' | 'top' | 'front'>('iso');
  const [exploreMode, setExploreMode] = useState<boolean>(false);
  const [activeRoomLabel, setActiveRoomLabel] = useState<string>('Exterior Walk');
  const [showStudioDrawer, setShowStudioDrawer] = useState<boolean>(false);

  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sunLightRef = useRef<THREE.DirectionalLight | null>(null);
  const buildingGroupRef = useRef<THREE.Group | null>(null);

  // Walkthrough / Explore refs used inside the 60fps animation frame
  const exploreActiveRef = useRef<boolean>(false);
  const explorePosRef = useRef<THREE.Vector3>(new THREE.Vector3(6, 2.1, 14));
  const exploreYawRef = useRef<number>(0);
  const explorePitchRef = useRef<number>(-0.05);
  const keysRef = useRef<Set<string>>(new Set());
  const isLookingRef = useRef<boolean>(false);
  const lastMouseRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const solar = getSolarConfig(project);
  const design = getDesignConfig(project);

  const lastLevel = project.levels[project.levels.length - 1];
  const maxBldgH = lastLevel ? lastLevel.elevation + lastLevel.floorToFloorHeight + 3.5 : 8;

  const viewpoints = useMemo(() => {
    const ground = project.levels[0];
    const gBB = ground ? levelBoundingBox(ground) : { minX: 0, maxX: 12, minY: 0, maxY: 10, width: 12, depth: 10 };
    const cx = (gBB.minX + gBB.maxX) / 2;
    const pts: { id: string; label: string; x: number; y: number; z: number; yaw: number; pitch: number }[] = [
      {
        id: 'ext_front',
        label: 'Exterior Front',
        x: cx,
        y: 2.1,
        z: gBB.maxY + 6.5,
        yaw: 0,
        pitch: -0.04,
      },
      {
        id: 'solar_roof',
        label: 'Solar Roof Deck',
        x: cx,
        y: (lastLevel ? lastLevel.elevation + lastLevel.floorToFloorHeight : 3.6) + 3.2,
        z: gBB.maxY + 4.5,
        yaw: 0,
        pitch: -0.38,
      },
    ];
    for (const lvl of project.levels) {
      for (const rm of lvl.rooms) {
        if (rm.polygon.length < 3) continue;
        const c = polygonCentroid(rm.polygon);
        pts.push({
          id: rm.id,
          label: project.levels.length > 1 ? `L${lvl.index + 1} ${rm.name}` : rm.name,
          x: c.x,
          y: lvl.elevation + 1.65,
          z: c.y + 0.7,
          yaw: 0,
          pitch: -0.05,
        });
      }
    }
    return pts;
  }, [project.levels, lastLevel]);

  const teleportTo = (vpId: string) => {
    const vp = viewpoints.find((v) => v.id === vpId) ?? viewpoints[0];
    if (!vp) return;
    explorePosRef.current.set(vp.x, vp.y, vp.z);
    exploreYawRef.current = vp.yaw;
    explorePitchRef.current = vp.pitch;
    setActiveRoomLabel(vp.label);
  };

  const stepExplore = (forward: number, strafe: number, turnYaw = 0) => {
    exploreYawRef.current += turnYaw;
    const yaw = exploreYawRef.current;
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);
    explorePosRef.current.x += fx * forward + rx * strafe;
    explorePosRef.current.z += fz * forward + rz * strafe;
  };

  // Initialize Three.js WebGL context
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(isLight ? '#eef2f6' : '#090f1d');
    scene.fog = new THREE.Fog(isLight ? '#eef2f6' : '#090f1d', 45, 110);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(48, Math.max(1, container.clientWidth) / Math.max(1, container.clientHeight), 0.08, 220);
    camera.position.set(18, 15, 22);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.localClippingEnabled = true;
    container.innerHTML = '';
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI / 2 - 0.02;
    controlsRef.current = controls;

    // Scene lighting
    const hemi = new THREE.HemisphereLight(0xdbeafe, 0x334155, 0.9);
    scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfffbeb, 1.55);
    sun.position.set(18, 25, 14);
    sun.castShadow = true;
    sun.shadow.mapSize.width = 2048;
    sun.shadow.mapSize.height = 2048;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 90;
    const d = 25;
    sun.shadow.camera.left = -d;
    sun.shadow.camera.right = d;
    sun.shadow.camera.top = d;
    sun.shadow.camera.bottom = -d;
    scene.add(sun);
    sunLightRef.current = sun;

    const gridHelper = new THREE.GridHelper(60, 60, isLight ? 0x94a3b8 : 0x334155, isLight ? 0xcbd5e1 : 0x1e293b);
    gridHelper.position.y = -0.01;
    scene.add(gridHelper);

    const group = new THREE.Group();
    scene.add(group);
    buildingGroupRef.current = group;

    const dom = renderer.domElement;
    const onPointerDown = (e: PointerEvent) => {
      if (!exploreActiveRef.current) return;
      isLookingRef.current = true;
      lastMouseRef.current = { x: e.clientX, y: e.clientY };
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!exploreActiveRef.current || !isLookingRef.current) return;
      const dx = e.clientX - lastMouseRef.current.x;
      const dy = e.clientY - lastMouseRef.current.y;
      lastMouseRef.current = { x: e.clientX, y: e.clientY };
      exploreYawRef.current -= dx * 0.0055;
      explorePitchRef.current = Math.max(-1.1, Math.min(1.1, explorePitchRef.current - dy * 0.0045));
    };
    const onPointerUp = () => {
      isLookingRef.current = false;
    };
    dom.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);

    let animId = 0;
    const animate = () => {
      animId = requestAnimationFrame(animate);
      if (exploreActiveRef.current) {
        const keys = keysRef.current;
        const moveStep = 0.14;
        const turnStep = 0.032;
        let fwd = 0;
        let str = 0;
        if (keys.has('w') || keys.has('arrowup')) fwd += moveStep;
        if (keys.has('s') || keys.has('arrowdown')) fwd -= moveStep;
        if (keys.has('a') || keys.has('arrowleft')) str -= moveStep;
        if (keys.has('d') || keys.has('arrowright')) str += moveStep;
        if (keys.has('q')) exploreYawRef.current += turnStep;
        if (keys.has('e')) exploreYawRef.current -= turnStep;
        if (keys.has('pageup')) explorePosRef.current.y += 0.1;
        if (keys.has('pagedown')) explorePosRef.current.y = Math.max(0.6, explorePosRef.current.y - 0.1);

        const yaw = exploreYawRef.current;
        const fx = -Math.sin(yaw);
        const fz = -Math.cos(yaw);
        const rx = Math.cos(yaw);
        const rz = -Math.sin(yaw);
        explorePosRef.current.x += fx * fwd + rx * str;
        explorePosRef.current.z += fz * fwd + rz * str;

        camera.position.copy(explorePosRef.current);
        const pitch = explorePitchRef.current;
        const lookAt = new THREE.Vector3(
          explorePosRef.current.x + fx * Math.cos(pitch),
          explorePosRef.current.y + Math.sin(pitch),
          explorePosRef.current.z + fz * Math.cos(pitch)
        );
        camera.lookAt(lookAt);
      } else {
        controls.update();
      }
      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      if (!container || !rendererRef.current || !cameraRef.current) return;
      cameraRef.current.aspect = container.clientWidth / container.clientHeight;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(container.clientWidth, container.clientHeight);
    };
    window.addEventListener('resize', handleResize);
    const resizeObs = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(handleResize) : null;
    resizeObs?.observe(container);

    return () => {
      cancelAnimationFrame(animId);
      resizeObs?.disconnect();
      dom.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('resize', handleResize);
      controls.dispose();
      renderer.dispose();
    };
  }, []);

  // Keyboard listener when Explore mode is active
  useEffect(() => {
    exploreActiveRef.current = exploreMode;
    if (controlsRef.current) {
      controlsRef.current.enabled = !exploreMode;
    }
    if (!exploreMode) {
      keysRef.current.clear();
      return;
    }
    teleportTo(viewpoints[2]?.id ?? viewpoints[0]?.id ?? 'ext_front');

    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA' || (e.target as HTMLElement)?.tagName === 'SELECT') {
        return;
      }
      keysRef.current.add(e.key.toLowerCase());
    };
    const onKeyUp = (e: KeyboardEvent) => {
      keysRef.current.delete(e.key.toLowerCase());
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [exploreMode]);

  // Update sun angle when sunHour changes
  useEffect(() => {
    const sun = sunLightRef.current;
    if (!sun) return;
    const angle = ((sunHour - 6) / 12) * Math.PI;
    const radius = 28;
    sun.position.set(Math.cos(angle) * radius, Math.max(4, Math.sin(angle) * radius), 14);
  }, [sunHour]);

  // Camera preset moves (when not in explore mode)
  useEffect(() => {
    if (exploreMode) return;
    const cam = cameraRef.current;
    const ctrl = controlsRef.current;
    if (!cam || !ctrl) return;
    const ground = project.levels[0];
    const bb = ground ? levelBoundingBox(ground) : { minX: 0, maxX: 12, minY: 0, maxY: 10, width: 12, depth: 10 };
    const cx = (bb.minX + bb.maxX) / 2;
    const cz = (bb.minY + bb.maxY) / 2;
    ctrl.target.set(cx, 1.5, cz);
    if (cameraPreset === 'iso') {
      cam.position.set(cx + 16, 13, cz + 17);
    } else if (cameraPreset === 'top') {
      cam.position.set(cx, 26, cz + 0.01);
    } else if (cameraPreset === 'front') {
      cam.position.set(cx, 4.5, cz + 20);
    }
    ctrl.update();
  }, [cameraPreset, project.id, exploreMode]);

  // Rebuild 3D BIM Geometry & PBR Textures
  useEffect(() => {
    const group = buildingGroupRef.current;
    const scene = sceneRef.current;
    if (!group || !scene) return;

    const createdTextures: THREE.Texture[] = [];
    const registerTex = (t: THREE.CanvasTexture) => {
      createdTextures.push(t);
      return t;
    };

    while (group.children.length > 0) {
      const obj = group.children[0];
      group.remove(obj);
      obj.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        if (mesh.material) {
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          mats.forEach((m) => m.dispose());
        }
      });
    }

    const isClay = renderMode === 'clay';
    const isXray = renderMode === 'xray';
    const isBlueprint = renderMode === 'blueprint';
    const isPBR = renderMode === 'pbr';

    const defaultBg = isLight ? '#eef2f6' : '#090f1d';
    const bg = isClay ? '#e2e8f0' : isBlueprint ? '#07152e' : defaultBg;
    scene.background = new THREE.Color(bg);
    if (scene.fog) {
      scene.fog = new THREE.Fog(bg, 45, 115);
    }

    const clipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), cutawayHeight);

    const facadeSpec = FACADE_MATERIAL_OPTIONS.find((f) => f.id === design.exteriorFacade) ?? FACADE_MATERIAL_OPTIONS[0];
    const intWallSpec = INTERIOR_WALL_OPTIONS.find((f) => f.id === design.interiorWalls) ?? INTERIOR_WALL_OPTIONS[0];
    const roofSpec = ROOF_MATERIAL_OPTIONS.find((r) => r.id === project.roof.material) ?? ROOF_MATERIAL_OPTIONS[0];

    const extTex = isPBR ? registerTex(createPatternTexture(facadeSpec.pattern, facadeSpec.base, facadeSpec.accent, 3, 2)) : null;
    const intTex = isPBR ? registerTex(createPatternTexture(intWallSpec.pattern, intWallSpec.base, intWallSpec.accent, 2, 2)) : null;
    const roofTex = isPBR ? registerTex(createPatternTexture(roofSpec.pattern, roofSpec.base, roofSpec.accent, 4, 4)) : null;
    const pvTex = isPBR ? registerTex(createPatternTexture('solar', '#0f2557', '#93c5fd', 1, 1)) : null;

    const extWallMat = new THREE.MeshStandardMaterial({
      color: isClay ? 0xf8fafc : isBlueprint ? 0x1d4ed8 : isPBR ? 0xffffff : 0xe2e8f0,
      map: extTex,
      roughness: facadeSpec.roughness,
      metalness: design.exteriorFacade === 'charcoal_cladding' ? 0.25 : 0.04,
      transparent: isXray || isBlueprint,
      opacity: isXray ? 0.22 : isBlueprint ? 0.35 : 1,
      wireframe: isBlueprint,
      clippingPlanes: [clipPlane],
      side: THREE.DoubleSide,
    });

    const intWallMat = new THREE.MeshStandardMaterial({
      color: isClay ? 0xf1f5f9 : isPBR ? 0xffffff : 0xcbd5e1,
      map: intTex,
      roughness: intWallSpec.roughness,
      transparent: isXray || isBlueprint,
      opacity: isXray ? 0.15 : isBlueprint ? 0.25 : 1,
      wireframe: isBlueprint,
      clippingPlanes: [clipPlane],
      side: THREE.DoubleSide,
    });

    const slabMat = new THREE.MeshStandardMaterial({
      color: isClay ? 0xcbd5e1 : 0x64748b,
      roughness: 0.85,
      transparent: isXray,
      opacity: isXray ? 0.35 : 1,
      wireframe: isBlueprint,
      clippingPlanes: [clipPlane],
    });

    const glassMat = new THREE.MeshPhysicalMaterial({
      color: isClay ? 0x94a3b8 : design.doorMaterial === 'frosted_glass' ? 0xe0f2fe : 0x38bdf8,
      transparent: true,
      opacity: 0.38,
      roughness: 0.1,
      metalness: 0.15,
      clippingPlanes: [clipPlane],
    });

    const frameMat = new THREE.MeshStandardMaterial({
      color: isClay ? 0x64748b : WINDOW_FRAME_COLORS[design.windowFrame] ?? 0x1e293b,
      roughness: 0.45,
      metalness: design.windowFrame === 'timber_oak' ? 0.05 : 0.45,
      clippingPlanes: [clipPlane],
    });

    const doorMat = new THREE.MeshStandardMaterial({
      color: isClay ? 0xdbeafe : DOOR_MATERIAL_COLORS[design.doorMaterial] ?? 0x5c3a21,
      roughness: design.doorMaterial === 'white_lacquer' ? 0.25 : 0.58,
      transparent: design.doorMaterial === 'frosted_glass',
      opacity: design.doorMaterial === 'frosted_glass' ? 0.65 : 1,
      clippingPlanes: [clipPlane],
    });

    const colMat = new THREE.MeshStandardMaterial({
      color: isXray ? 0xf43f5e : isClay ? 0x94a3b8 : 0x475569,
      roughness: 0.7,
      clippingPlanes: [clipPlane],
    });

    const ground = project.levels[0];
    const gBB = ground ? levelBoundingBox(ground) : { minX: 0, maxX: 12, minY: 0, maxY: 10, width: 12, depth: 10 };
    const bCenterX = (gBB.minX + gBB.maxX) / 2;
    const bCenterZ = (gBB.minY + gBB.maxY) / 2;

    // Site Lot Terrain Pad
    const lotW = Math.max(project.meta.plotWidth, gBB.width + 8);
    const lotD = Math.max(project.meta.plotDepth, gBB.depth + 8);
    const lotMesh = new THREE.Mesh(
      new THREE.BoxGeometry(lotW, 0.12, lotD),
      new THREE.MeshStandardMaterial({
        color: isClay ? 0xd1d5db : isBlueprint ? 0x0f172a : isLight ? 0xbfd9c5 : 0x1e3a2f,
        roughness: 0.95,
      })
    );
    lotMesh.position.set(bCenterX, -0.06, bCenterZ);
    lotMesh.receiveShadow = true;
    group.add(lotMesh);

    // Plinth Base
    if (ground && ground.walls.length > 0) {
      const plinth = new THREE.Mesh(
        new THREE.BoxGeometry(gBB.width + 0.4, ground.elevation, gBB.depth + 0.4),
        new THREE.MeshStandardMaterial({
          color: isClay ? 0x94a3b8 : 0x334155,
          roughness: 0.9,
        })
      );
      plinth.position.set(bCenterX, ground.elevation / 2, bCenterZ);
      plinth.receiveShadow = true;
      plinth.castShadow = true;
      group.add(plinth);
    }

    // Build Each Floor Level
    for (const lvl of project.levels) {
      const bb = levelBoundingBox(lvl);
      const baseY = lvl.elevation;

      if (lvl.walls.length > 0) {
        const sMesh = new THREE.Mesh(
          new THREE.BoxGeometry(bb.width + 0.2, lvl.slabThickness, bb.depth + 0.2),
          slabMat
        );
        sMesh.position.set((bb.minX + bb.maxX) / 2, baseY - lvl.slabThickness / 2, (bb.minY + bb.maxY) / 2);
        sMesh.receiveShadow = true;
        sMesh.castShadow = true;
        group.add(sMesh);
      }

      // Room Floor Finish Plates (with PBR Textures) & Interior Ceiling Illumination
      for (const r of lvl.rooms) {
        if (r.polygon.length < 3) continue;
        const xs = r.polygon.map((p) => p.x);
        const ys = r.polygon.map((p) => p.y);
        const rw = Math.max(...xs) - Math.min(...xs);
        const rd = Math.max(...ys) - Math.min(...ys);
        const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
        const cz = (Math.min(...ys) + Math.max(...ys)) / 2;

        const floorSpec = FLOOR_FINISH_OPTIONS.find((f) => f.id === r.finish) ?? FLOOR_FINISH_OPTIONS[0];
        const flTex = isPBR ? registerTex(createPatternTexture(floorSpec.pattern, floorSpec.base, floorSpec.accent, 2, 2)) : null;
        const fMesh = new THREE.Mesh(
          new THREE.BoxGeometry(Math.max(0.2, rw - 0.08), 0.024, Math.max(0.2, rd - 0.08)),
          new THREE.MeshStandardMaterial({
            color: isClay ? 0xe2e8f0 : isPBR ? 0xffffff : floorSpec.base,
            map: flTex,
            roughness: floorSpec.roughness,
            transparent: isXray,
            opacity: isXray ? 0.25 : 1,
            clippingPlanes: [clipPlane],
          })
        );
        fMesh.position.set(cx, baseY + 0.012, cz);
        fMesh.receiveShadow = true;
        group.add(fMesh);

        if (isPBR) {
          const roomLight = new THREE.PointLight(0xfff5e4, 0.35, 8);
          roomLight.position.set(cx, baseY + r.ceilingHeight - 0.2, cz);
          group.add(roomLight);
        }
      }

      // Interior 3D Furniture Primitives (visible in Walk/Explore & PBR cutaways)
      if (!isXray && !isBlueprint) {
        const furnWood = new THREE.MeshStandardMaterial({ color: isClay ? 0xcbd5e1 : 0x7c4a2d, roughness: 0.65, clippingPlanes: [clipPlane] });
        const furnFabric = new THREE.MeshStandardMaterial({ color: isClay ? 0xe2e8f0 : 0x64748b, roughness: 0.88, clippingPlanes: [clipPlane] });
        const furnPorcelain = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.22, clippingPlanes: [clipPlane] });

        for (const f of lvl.furniture) {
          const fGrp = new THREE.Group();
          fGrp.position.set(f.position.x, baseY + 0.02, f.position.y);
          fGrp.rotation.y = -(f.rotation * Math.PI) / 180;

          if (f.type === 'sofa') {
            const seat = new THREE.Mesh(new THREE.BoxGeometry(f.width, 0.42, f.depth), furnFabric);
            seat.position.y = 0.21;
            const back = new THREE.Mesh(new THREE.BoxGeometry(f.width, 0.4, 0.2), furnFabric);
            back.position.set(0, 0.55, -f.depth / 2 + 0.1);
            fGrp.add(seat, back);
          } else if (f.type === 'bed_double' || f.type === 'bed_single') {
            const base = new THREE.Mesh(new THREE.BoxGeometry(f.width, 0.3, f.depth), furnWood);
            base.position.y = 0.15;
            const mattress = new THREE.Mesh(new THREE.BoxGeometry(f.width - 0.1, 0.22, f.depth - 0.1), furnPorcelain);
            mattress.position.y = 0.41;
            fGrp.add(base, mattress);
          } else if (f.type === 'dining_table' || f.type === 'desk') {
            const top = new THREE.Mesh(new THREE.BoxGeometry(f.width, 0.06, f.depth), furnWood);
            top.position.y = 0.74;
            const leg = new THREE.Mesh(new THREE.BoxGeometry(f.width * 0.6, 0.72, f.depth * 0.4), frameMat);
            leg.position.y = 0.36;
            fGrp.add(top, leg);
          } else if (f.type === 'kitchen_counter') {
            const cab = new THREE.Mesh(new THREE.BoxGeometry(f.width, 0.88, f.depth), furnPorcelain);
            cab.position.y = 0.44;
            fGrp.add(cab);
          } else if (f.type === 'wc' || f.type === 'sink') {
            const fixt = new THREE.Mesh(new THREE.BoxGeometry(f.width, 0.55, f.depth), furnPorcelain);
            fixt.position.y = 0.28;
            fGrp.add(fixt);
          } else if (f.type === 'car') {
            const body = new THREE.Mesh(new THREE.BoxGeometry(f.width, 0.7, f.depth), frameMat);
            body.position.y = 0.45;
            fGrp.add(body);
          } else {
            const mesh = new THREE.Mesh(new THREE.BoxGeometry(f.width, 0.15, f.depth), furnPorcelain);
            mesh.position.y = 0.08;
            fGrp.add(mesh);
          }
          group.add(fGrp);
        }
      }

      // Structural Columns
      for (const col of lvl.columns) {
        const cMesh = new THREE.Mesh(new THREE.BoxGeometry(col.width, lvl.floorToFloorHeight, col.depth), colMat);
        cMesh.position.set(col.position.x, baseY + lvl.floorToFloorHeight / 2, col.position.y);
        cMesh.castShadow = true;
        cMesh.receiveShadow = true;
        group.add(cMesh);

        if (lvl.index === 0 && isXray) {
          const fMesh = new THREE.Mesh(
            new THREE.BoxGeometry(col.footingSize, 0.35, col.footingSize),
            new THREE.MeshStandardMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.5 })
          );
          fMesh.position.set(col.position.x, -0.5, col.position.y);
          group.add(fMesh);
        }
      }

      // Segmented Walls with Openings + Interior Liner Face on Exterior Walls
      for (const wall of lvl.walls) {
        const len = wallLength(wall);
        if (len < 0.05) continue;
        const angle = wallAngleRad(wall);
        const wallGroup = new THREE.Group();
        wallGroup.position.set(wall.start.x, baseY, wall.start.y);
        wallGroup.rotation.y = -angle;

        // Determine which local Z side faces inward toward building center
        const midWorldX = wall.start.x + Math.cos(angle) * (len / 2);
        const midWorldZ = wall.start.y + Math.sin(angle) * (len / 2);
        const dPlus = Math.hypot(midWorldX - Math.sin(angle) - bCenterX, midWorldZ + Math.cos(angle) - bCenterZ);
        const dMinus = Math.hypot(midWorldX + Math.sin(angle) - bCenterX, midWorldZ - Math.cos(angle) - bCenterZ);
        const innerSign = dPlus < dMinus ? 1 : -1;

        const mat = wall.isExterior ? extWallMat : intWallMat;
        const ops = lvl.openings
          .filter((o) => o.wallId === wall.id)
          .sort((a, b) => a.offset - b.offset);

        let cur = 0;
        const addBox = (x1: number, x2: number, y1: number, y2: number, customMat = mat) => {
          const w = x2 - x1;
          const h = y2 - y1;
          if (w < 0.02 || h < 0.02) return;
          const geo = new THREE.BoxGeometry(w, h, wall.thickness);
          const mesh = new THREE.Mesh(geo, customMat);
          mesh.position.set(x1 + w / 2, y1 + h / 2, 0);
          mesh.castShadow = !isXray;
          mesh.receiveShadow = true;
          wallGroup.add(mesh);

          if (wall.isExterior && isPBR) {
            const innerFace = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.015), intWallMat);
            innerFace.position.set(x1 + w / 2, y1 + h / 2, innerSign * (wall.thickness / 2 + 0.005));
            innerFace.receiveShadow = true;
            wallGroup.add(innerFace);
          }

          if (isClay) {
            const edges = new THREE.EdgesGeometry(geo);
            const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x64748b }));
            line.position.copy(mesh.position);
            wallGroup.add(line);
          }
        };

        for (const op of ops) {
          const center = op.offset * len;
          const startOp = Math.max(cur, center - op.width / 2);
          const endOp = Math.min(len, center + op.width / 2);

          addBox(cur, startOp, 0, wall.height);
          if (op.sillHeight > 0.05) addBox(startOp, endOp, 0, op.sillHeight);
          const topOp = Math.min(wall.height, op.sillHeight + op.height);
          if (wall.height - topOp > 0.05) addBox(startOp, endOp, topOp, wall.height);

          const opW = endOp - startOp;
          const opH = topOp - op.sillHeight;
          if (opW > 0.1 && opH > 0.1) {
            const fThick = 0.055;
            const fTop = new THREE.Mesh(new THREE.BoxGeometry(opW, fThick, wall.thickness + 0.03), frameMat);
            fTop.position.set(startOp + opW / 2, topOp - fThick / 2, 0);
            const fLeft = new THREE.Mesh(new THREE.BoxGeometry(fThick, opH, wall.thickness + 0.02), frameMat);
            fLeft.position.set(startOp + fThick / 2, op.sillHeight + opH / 2, 0);
            const fRight = new THREE.Mesh(new THREE.BoxGeometry(fThick, opH, wall.thickness + 0.02), frameMat);
            fRight.position.set(endOp - fThick / 2, op.sillHeight + opH / 2, 0);
            wallGroup.add(fTop, fLeft, fRight);

            if (op.kind === 'window') {
              const glass = new THREE.Mesh(new THREE.BoxGeometry(opW - 0.08, opH - 0.08, 0.025), glassMat);
              glass.position.set(startOp + opW / 2, op.sillHeight + opH / 2, 0);
              wallGroup.add(glass);
            } else {
              const doorLeaf = new THREE.Mesh(
                new THREE.BoxGeometry(opW - 0.08, opH - 0.04, 0.05),
                op.style === 'garage' ? frameMat : doorMat
              );
              doorLeaf.position.set(startOp + opW / 2, op.sillHeight + opH / 2, 0);
              doorLeaf.castShadow = true;
              wallGroup.add(doorLeaf);
            }
          }
          cur = endOp;
        }
        addBox(cur, len, 0, wall.height);
        group.add(wallGroup);
      }

      // Staircase 3D treads
      for (const st of lvl.stairs) {
        const steps = 12;
        const stepH = lvl.floorToFloorHeight / steps;
        const stepD = st.length / steps;
        for (let i = 0; i < steps; i++) {
          const stepMesh = new THREE.Mesh(new THREE.BoxGeometry(st.width * 0.45, stepH * (i + 1), stepD), doorMat);
          stepMesh.position.set(st.origin.x + st.width * 0.25, baseY + (stepH * (i + 1)) / 2, st.origin.y + i * stepD + stepD / 2);
          stepMesh.castShadow = true;
          group.add(stepMesh);
        }
      }

      // 3D Air Conditioning Indoor FCUs, Ceiling Fans & Outdoor Marine Condensers
      const hvacCfg = getHVACConfig(project);
      if (hvacCfg.enabled && !isBlueprint) {
        const indoorUnitMat = new THREE.MeshStandardMaterial({
          color: isClay ? 0xe2e8f0 : 0xf8fafc,
          roughness: 0.25,
          metalness: 0.1,
          transparent: isXray,
          opacity: isXray ? 0.55 : 1,
          clippingPlanes: [clipPlane],
        });
        const louverMat = new THREE.MeshStandardMaterial({
          color: 0x0f172a,
          roughness: 0.45,
          clippingPlanes: [clipPlane],
        });
        const cduCasingMat = new THREE.MeshStandardMaterial({
          color: isClay ? 0xcbd5e1 : 0xe2e8f0,
          roughness: 0.38,
          metalness: 0.25,
          clippingPlanes: [clipPlane],
        });
        const blueFinMat = new THREE.MeshStandardMaterial({
          color:
            hvacCfg.condenserProtection === 'marine_blue_fin'
              ? 0x0284c7
              : hvacCfg.condenserProtection === 'epoxy_gold_fin'
              ? 0xca8a04
              : 0x64748b,
          roughness: 0.35,
          metalness: 0.55,
          clippingPlanes: [clipPlane],
        });

        for (const node of lvl.mepNodes) {
          if (node.kind === 'ac_split' && node.label !== 'EF') {
            const acGrp = new THREE.Group();
            acGrp.position.set(node.position.x, baseY + lvl.floorToFloorHeight - 0.52, node.position.y);
            const body = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.27, 0.22), indoorUnitMat);
            const slot = new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.045, 0.04), louverMat);
            slot.position.set(0, -0.09, 0.1);
            acGrp.add(body, slot);
            group.add(acGrp);
          } else if (node.kind === 'ceiling_fan') {
            const fanGrp = new THREE.Group();
            fanGrp.position.set(node.position.x, baseY + lvl.floorToFloorHeight - 0.28, node.position.y);
            const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.26, 8), louverMat);
            rod.position.y = 0.13;
            const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.08, 12), indoorUnitMat);
            const bladeA = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.018, 0.13), indoorUnitMat);
            const bladeB = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.018, 1.15), indoorUnitMat);
            fanGrp.add(rod, hub, bladeA, bladeB);
            group.add(fanGrp);
          } else if (node.kind === 'ac_condenser') {
            const cduGrp = new THREE.Group();
            cduGrp.position.set(node.position.x, baseY + 0.42, node.position.y);
            const chassis = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.66, 0.34), cduCasingMat);
            const coilFin = new THREE.Mesh(new THREE.BoxGeometry(0.88, 0.56, 0.06), blueFinMat);
            coilFin.position.set(0, 0, -0.15);
            const fanGrille = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.04, 16), louverMat);
            fanGrille.rotation.x = Math.PI / 2;
            fanGrille.position.set(-0.1, 0.02, 0.17);
            chassis.castShadow = true;
            cduGrp.add(chassis, coilFin, fanGrille);
            group.add(cduGrp);
          }
        }
      }

      // 3D MEP Conduits in X-Ray mode (including Solar PV String Conduit)
      if (isXray) {
        for (const ckt of lvl.mepCircuits) {
          if (ckt.points.length < 2) continue;
          const color =
            ckt.system === 'electrical_pv'
              ? 0x22c55e
              : ckt.system === 'hvac_refrigerant'
              ? 0xa855f7
              : ckt.system === 'hvac_condensate'
              ? 0x14b8a6
              : ckt.system.startsWith('electrical')
              ? 0xfacc15
              : 0x38bdf8;
          const hOff = ckt.system.startsWith('electrical') ? baseY + lvl.floorToFloorHeight - 0.25 : baseY + 0.12;
          const pts = ckt.points.map((p) => new THREE.Vector3(p.x, hOff, p.y));
          const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.1);
          const tube = new THREE.Mesh(
            new THREE.TubeGeometry(curve, Math.max(8, pts.length * 4), 0.035, 6, false),
            new THREE.MeshBasicMaterial({ color })
          );
          group.add(tube);
        }
      }
    }

    // Roof Geometry + Textured Cladding + 3D Solar PV Array
    if (showRoof && lastLevel && lastLevel.walls.length > 0 && cutawayHeight >= lastLevel.elevation + lastLevel.floorToFloorHeight) {
      const rBB = levelBoundingBox(lastLevel);
      const eaveY = lastLevel.elevation + lastLevel.floorToFloorHeight;
      const ov = project.roof.overhang;
      const w = rBB.width + ov * 2;
      const d = rBB.depth + ov * 2;
      const cx = (rBB.minX + rBB.maxX) / 2;
      const cz = (rBB.minY + rBB.maxY) / 2;
      const pitchRad = (project.roof.pitchDeg * Math.PI) / 180;
      const rise = Math.max(0.4, (Math.min(w, d) / 2) * Math.tan(pitchRad));

      const roofMat = new THREE.MeshStandardMaterial({
        color: isClay ? 0x94a3b8 : isPBR ? 0xffffff : roofSpec.base,
        map: roofTex,
        roughness: roofSpec.roughness,
        metalness: roofSpec.metalness,
        transparent: isXray,
        opacity: isXray ? 0.25 : 1,
        wireframe: isBlueprint,
        side: THREE.DoubleSide,
      });

      if (project.roof.type === 'flat') {
        const roofSlab = new THREE.Mesh(new THREE.BoxGeometry(w, 0.22, d), roofMat);
        roofSlab.position.set(cx, eaveY + 0.11, cz);
        roofSlab.castShadow = true;
        roofSlab.receiveShadow = true;
        group.add(roofSlab);

        const ph = project.roof.parapetHeight;
        const pThick = 0.2;
        const p1 = new THREE.Mesh(new THREE.BoxGeometry(w, ph, pThick), extWallMat);
        p1.position.set(cx, eaveY + ph / 2, cz - d / 2 + pThick / 2);
        const p2 = new THREE.Mesh(new THREE.BoxGeometry(w, ph, pThick), extWallMat);
        p2.position.set(cx, eaveY + ph / 2, cz + d / 2 - pThick / 2);
        const p3 = new THREE.Mesh(new THREE.BoxGeometry(pThick, ph, d), extWallMat);
        p3.position.set(cx - w / 2 + pThick / 2, eaveY + ph / 2, cz);
        const p4 = new THREE.Mesh(new THREE.BoxGeometry(pThick, ph, d), extWallMat);
        p4.position.set(cx + w / 2 - pThick / 2, eaveY + ph / 2, cz);
        group.add(p1, p2, p3, p4);
      } else if (project.roof.type === 'shed') {
        const slopeLen = Math.hypot(d, rise);
        const slopeAngle = Math.atan2(rise, d);
        const shed = new THREE.Mesh(new THREE.BoxGeometry(w, 0.18, slopeLen), roofMat);
        shed.position.set(cx, eaveY + rise / 2, cz);
        shed.rotation.x = -slopeAngle;
        shed.castShadow = true;
        group.add(shed);
      } else {
        const hw = w / 2;
        const hd = d / 2;
        const ridgeHalf = project.roof.type === 'hip' ? Math.max(0.2, hw - hd * 0.85) : hw;
        const verts = new Float32Array([
          // Front slope
          -hw, 0, hd, hw, 0, hd, ridgeHalf, rise, 0,
          -hw, 0, hd, ridgeHalf, rise, 0, -ridgeHalf, rise, 0,
          // Back slope
          hw, 0, -hd, -hw, 0, -hd, -ridgeHalf, rise, 0,
          hw, 0, -hd, -ridgeHalf, rise, 0, ridgeHalf, rise, 0,
          // East cap
          hw, 0, hd, hw, 0, -hd, ridgeHalf, rise, 0,
          // West cap
          -hw, 0, -hd, -hw, 0, hd, -ridgeHalf, rise, 0,
          // Soffit
          -hw, 0, -hd, hw, 0, -hd, hw, 0, hd,
          -hw, 0, -hd, hw, 0, hd, -hw, 0, hd,
        ]);
        // Assign clean UVs matching roof surface span for textures
        const uvs = new Float32Array([
          0, 0, 2, 0, 2, 1,
          0, 0, 2, 1, 0, 1,
          0, 0, 2, 0, 2, 1,
          0, 0, 2, 1, 0, 1,
          0, 0, 1, 0, 0.5, 1,
          0, 0, 1, 0, 0.5, 1,
          0, 0, 2, 0, 2, 2,
          0, 0, 2, 2, 0, 2,
        ]);
        const roofGeo = new THREE.BufferGeometry();
        roofGeo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
        roofGeo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
        roofGeo.computeVertexNormals();
        const roofMesh = new THREE.Mesh(roofGeo, roofMat);
        roofMesh.position.set(cx, eaveY, cz);
        roofMesh.castShadow = true;
        roofMesh.receiveShadow = true;
        group.add(roofMesh);
      }

      // 3D Rooftop Solar PV Panel Array + Exterior Hybrid Inverter & BESS Cabinet
      if (solar.enabled) {
        const pvMat = new THREE.MeshPhysicalMaterial({
          color: isClay ? 0x1e3a8a : 0xffffff,
          map: pvTex,
          roughness: 0.18,
          metalness: 0.35,
          clearcoat: 0.8,
        });
        const pvCols = Math.min(8, Math.max(4, Math.ceil(solar.panelCount / 2)));
        const panelW = 1.0;
        const panelH = 1.55;
        const panelGap = 0.08;
        const arrayW = pvCols * (panelW + panelGap);
        const startX = cx - arrayW / 2 + panelW / 2;

        const hd = d / 2;
        const slopePitch = Math.atan2(rise, hd);

        for (let idx = 0; idx < solar.panelCount; idx++) {
          const r = Math.floor(idx / pvCols);
          const c = idx % pvCols;
          const px = startX + c * (panelW + panelGap);
          const pMesh = new THREE.Mesh(new THREE.BoxGeometry(panelW, 0.045, panelH), pvMat);

          if (project.roof.type === 'flat') {
            pMesh.position.set(px, eaveY + 0.45, cz - 0.8 + r * 2.1);
            pMesh.rotation.x = 0.26;
          } else if (project.roof.type === 'shed') {
            const slopeAngle = Math.atan2(rise, d);
            const zOff = (r === 0 ? -0.9 : 1.0);
            const tNorm = 0.5 + zOff / d;
            pMesh.position.set(px, eaveY + rise * tNorm + 0.22, cz + zOff);
            pMesh.rotation.x = slopeAngle;
          } else {
            const zSlope = 1.15 + r * 1.75;
            const tDrop = Math.min(0.92, zSlope / hd);
            const py = eaveY + rise * (1 - tDrop) + 0.14;
            pMesh.position.set(px, py, cz + zSlope);
            pMesh.rotation.x = slopePitch;
          }
          pMesh.castShadow = true;
          group.add(pMesh);
        }

        // Wall-mounted Hybrid Inverter & LiFePO4 BESS Battery Cabinet
        if (ground) {
          const invMesh = new THREE.Mesh(
            new THREE.BoxGeometry(0.14, 0.62, 0.45),
            new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.3, metalness: 0.4 })
          );
          invMesh.position.set(gBB.minX - 0.1, ground.elevation + 1.45, gBB.minY + 1.2);
          group.add(invMesh);

          if (solar.batteryKWh > 0) {
            const bessMesh = new THREE.Mesh(
              new THREE.BoxGeometry(0.22, 0.78, 0.55),
              new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.4, metalness: 0.2 })
            );
            bessMesh.position.set(gBB.minX - 0.12, ground.elevation + 0.65, gBB.minY + 1.2);
            group.add(bessMesh);
          }
        }
      }
    }

    return () => {
      createdTextures.forEach((t) => t.dispose());
    };
  }, [project, renderMode, cutawayHeight, showRoof, lastLevel, isLight, solar.enabled, solar.panelCount, solar.batteryKWh, design]);

  const mutateProject = (updater: (next: BuildingProject) => void) => {
    if (!onUpdateProject) return;
    const next = structuredClone(project);
    updater(next);
    onUpdateProject(next);
  };

  return (
    <div className="relative w-full h-full bg-slate-950 overflow-hidden">
      <div ref={containerRef} className="w-full h-full" />

      {/* Top Left Render Mode & Quick Studio Switcher */}
      <div className="absolute top-3 left-3 z-10 flex items-center gap-1.5 bg-slate-900/90 backdrop-blur border border-slate-700/80 rounded-lg p-1.5 text-xs shadow-sm">
        <div className="flex items-center gap-1.5 pl-1.5 pr-1">
          <Box className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
          <span className="text-[11px] font-medium text-slate-400">Style:</span>
          <select
            aria-label="3D Render Style"
            value={renderMode}
            onChange={(e) => setRenderMode(e.target.value as Render3DMode)}
            className="bg-slate-950 border border-slate-700 rounded-md px-2 py-1 text-xs font-medium text-slate-200 focus:outline-none focus:border-cyan-500 cursor-pointer"
          >
            <option value="pbr">PBR Studio Render</option>
            <option value="clay">White Architectural Clay</option>
            <option value="xray">Structural &amp; MEP X-Ray</option>
            <option value="blueprint">Blueprint Wireframe</option>
          </select>
        </div>
        {onUpdateProject && (
          <button
            onClick={() => setShowStudioDrawer((s) => !s)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md font-medium transition ${
              showStudioDrawer ? 'bg-amber-600 text-white' : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
            }`}
          >
            <Palette className="w-3.5 h-3.5" /> Materials &amp; Solar
          </button>
        )}
      </div>

      {/* Collapsible On-Viewport Material & Solar Studio Drawer */}
      {showStudioDrawer && onUpdateProject && (
        <div className="absolute top-14 left-3 z-20 w-72 bg-slate-900/95 backdrop-blur border border-slate-700 rounded-xl p-3 shadow-xl text-xs space-y-2.5">
          <div className="flex items-center justify-between font-mono text-[11px] font-bold text-cyan-300">
            <span>3D MATERIAL & SOLAR STUDIO</span>
            <button onClick={() => setShowStudioDrawer(false)} className="text-slate-400 hover:text-white">
              Close
            </button>
          </div>
          <label className="block">
            <span className="text-[11px] text-slate-400">Roofing Cladding</span>
            <select
              value={project.roof.material}
              onChange={(e) =>
                mutateProject((n) => {
                  n.roof.material = e.target.value as RoofMaterial;
                })
              }
              className="w-full mt-0.5 bg-slate-950 border border-slate-700 rounded px-2 py-1"
            >
              {ROOF_MATERIAL_OPTIONS.map((rm) => (
                <option key={rm.id} value={rm.id}>
                  {rm.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-[11px] text-slate-400">Exterior Facade Cladding</span>
            <select
              value={design.exteriorFacade}
              onChange={(e) =>
                mutateProject((n) => {
                  n.design = { ...getDesignConfig(n), exteriorFacade: e.target.value as ExteriorFacadeMaterial };
                })
              }
              className="w-full mt-0.5 bg-slate-950 border border-slate-700 rounded px-2 py-1"
            >
              {FACADE_MATERIAL_OPTIONS.map((fm) => (
                <option key={fm.id} value={fm.id}>
                  {fm.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-[11px] text-slate-400">Interior Wall Finish</span>
            <select
              value={design.interiorWalls}
              onChange={(e) =>
                mutateProject((n) => {
                  n.design = { ...getDesignConfig(n), interiorWalls: e.target.value as InteriorWallMaterial };
                })
              }
              className="w-full mt-0.5 bg-slate-950 border border-slate-700 rounded px-2 py-1"
            >
              {INTERIOR_WALL_OPTIONS.map((im) => (
                <option key={im.id} value={im.id}>
                  {im.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-[11px] text-slate-400">Apply Floor Finish (Dry Rooms)</span>
            <select
              value={project.levels[0]?.rooms[0]?.finish ?? 'porcelain'}
              onChange={(e) =>
                mutateProject((n) => {
                  const fin = e.target.value as FloorFinish;
                  n.levels.forEach((l) =>
                    l.rooms.forEach((r) => {
                      if (r.category !== 'bathroom' && r.category !== 'garage') r.finish = fin;
                    })
                  );
                })
              }
              className="w-full mt-0.5 bg-slate-950 border border-slate-700 rounded px-2 py-1"
            >
              {FLOOR_FINISH_OPTIONS.map((fl) => (
                <option key={fl.id} value={fl.id}>
                  {fl.label}
                </option>
              ))}
            </select>
          </label>
          <div className="pt-1 border-t border-slate-800 flex items-center justify-between">
            <span className="text-[11px] text-slate-300 font-medium">Rooftop Solar PV</span>
            <button
              onClick={() =>
                mutateProject((n) => {
                  const s = getSolarConfig(n);
                  n.solar = { ...s, enabled: !s.enabled };
                })
              }
              className={`px-2 py-0.5 rounded font-mono text-[11px] ${
                solar.enabled ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40' : 'bg-slate-800 text-slate-400'
              }`}
            >
              {solar.enabled ? `ON (${solar.panelCount}×${solar.panelWattage}Wp)` : 'OFF'}
            </button>
          </div>
        </div>
      )}

      {/* Top Right Camera Presets, Full Explore Toggle & Roof Toggle */}
      <div className="absolute top-3 right-3 z-10 flex items-center gap-1.5 bg-slate-900/90 backdrop-blur border border-slate-700/80 rounded-lg p-1.5 text-xs shadow-sm">
        <div className="flex items-center gap-1.5 pl-1">
          <Camera className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <select
            aria-label="3D Camera View"
            value={cameraPreset}
            onChange={(e) => {
              setExploreMode(false);
              setCameraPreset(e.target.value as 'iso' | 'top' | 'front');
            }}
            className="bg-slate-950 border border-slate-700 rounded-md px-2 py-1 text-xs font-medium text-slate-200 focus:outline-none focus:border-cyan-500 cursor-pointer"
          >
            <option value="iso">View: Isometric 3D</option>
            <option value="top">View: Top Plan Ortho</option>
            <option value="front">View: Front Elevation</option>
          </select>
        </div>
        <button
          onClick={() => setExploreMode((v) => !v)}
          className={`flex items-center gap-1 px-2.5 py-1 rounded-md font-semibold transition ${
            exploreMode ? 'bg-cyan-600 text-white' : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
          }`}
          title="First-Person 3D Walkthrough & Room Explore (WASD / Drag to Look)"
        >
          <Footprints className="w-3.5 h-3.5" /> Explore / Walk
        </button>
        <span className="text-slate-600">|</span>
        <button
          onClick={() => setShowRoof((v) => !v)}
          className={`px-2 py-1 rounded-md font-medium ${
            showRoof ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40' : 'bg-slate-800 text-slate-400'
          }`}
        >
          {showRoof ? 'Roof: ON' : 'Roof: OFF'}
        </button>
      </div>

      {/* Full 3D Explore Mode Walkthrough HUD */}
      {exploreMode && (
        <div className="absolute bottom-14 left-3 right-3 z-20 flex flex-wrap items-end justify-between gap-3 pointer-events-none">
          {/* Room & Viewpoint Teleport Bar */}
          <div className="pointer-events-auto max-w-2xl bg-slate-900/92 backdrop-blur border border-slate-700 rounded-xl p-2.5 shadow-lg space-y-1.5">
            <div className="flex items-center justify-between text-[11px] font-mono text-cyan-300 px-1">
              <span className="flex items-center gap-1.5 font-bold">
                <Compass className="w-3.5 h-3.5" /> WALKTHROUGH TELEPORT ({activeRoomLabel})
              </span>
              <span className="text-slate-400">WASD: Move · Q/E or Drag: 360° Look</span>
            </div>
            <div className="flex flex-wrap gap-1">
              {viewpoints.map((vp) => (
                <button
                  key={vp.id}
                  onClick={() => teleportTo(vp.id)}
                  className={`px-2 py-1 rounded text-[11px] font-medium transition ${
                    activeRoomLabel === vp.label
                      ? 'bg-cyan-600 text-white'
                      : 'bg-slate-800 hover:bg-slate-700 text-slate-200'
                  }`}
                >
                  {vp.label}
                </button>
              ))}
            </div>
          </div>

          {/* Virtual On-Screen Move & Look Pad */}
          <div className="pointer-events-auto bg-slate-900/92 backdrop-blur border border-slate-700 rounded-xl p-2 shadow-lg flex items-center gap-2">
            <div className="grid grid-cols-3 gap-1">
              <button
                aria-label="Turn Left"
                onClick={() => stepExplore(0, 0, 0.25)}
                className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200"
                title="Look Left (Q)"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
              <button
                aria-label="Walk Forward"
                onClick={() => stepExplore(0.75, 0, 0)}
                className="p-1.5 rounded bg-cyan-600 hover:bg-cyan-500 text-white"
                title="Walk Forward (W)"
              >
                <ArrowUp className="w-3.5 h-3.5" />
              </button>
              <button
                aria-label="Turn Right"
                onClick={() => stepExplore(0, 0, -0.25)}
                className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200"
                title="Look Right (E)"
              >
                <RotateCw className="w-3.5 h-3.5" />
              </button>
              <button
                aria-label="Strafe Left"
                onClick={() => stepExplore(0, -0.65, 0)}
                className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200"
                title="Step Left (A)"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
              </button>
              <button
                aria-label="Walk Backward"
                onClick={() => stepExplore(-0.75, 0, 0)}
                className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200"
                title="Walk Backward (S)"
              >
                <ArrowDown className="w-3.5 h-3.5" />
              </button>
              <button
                aria-label="Strafe Right"
                onClick={() => stepExplore(0, 0.65, 0)}
                className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200"
                title="Step Right (D)"
              >
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bottom 3D Cutaway & Solar Study Bar */}
      <div className="absolute bottom-3 left-3 right-3 z-10 flex flex-wrap items-center justify-between gap-4 bg-slate-900/90 backdrop-blur border border-slate-700/80 rounded-lg px-4 py-2 text-xs shadow-sm">
        <div className="flex items-center gap-3 min-w-[230px]">
          <span className="text-slate-400 font-medium whitespace-nowrap">3D Section Cutaway:</span>
          <input
            type="range"
            min={1.2}
            max={maxBldgH}
            step={0.1}
            value={Math.min(cutawayHeight, maxBldgH)}
            onChange={(e) => setCutawayHeight(parseFloat(e.target.value))}
            className="w-32 accent-cyan-500"
          />
          <span className="font-mono text-cyan-300 w-12">
            {cutawayHeight >= maxBldgH - 0.5 ? 'Full' : `${cutawayHeight.toFixed(1)}m`}
          </span>
        </div>

        <div className="flex items-center gap-2.5 min-w-[210px]">
          <Sun className="w-4 h-4 text-amber-400" />
          <span className="text-slate-400 font-medium">Solar Study:</span>
          <input
            type="range"
            min={7}
            max={18}
            step={0.5}
            value={sunHour}
            onChange={(e) => setSunHour(parseFloat(e.target.value))}
            className="w-24 accent-amber-400"
          />
          <span className="font-mono text-amber-300 w-12">
            {String(Math.floor(sunHour)).padStart(2, '0')}:{sunHour % 1 === 0 ? '00' : '30'}
          </span>
        </div>

        <div className="text-slate-400 font-mono text-[11px]">
          {exploreMode ? 'Explore: Drag = Look · WASD / Pad = Walk' : 'Left-Drag: Orbit · Right-Drag: Pan · Scroll: Zoom'}
        </div>
      </div>
    </div>
  );
};
