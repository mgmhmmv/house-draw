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
  getRoofDrainageConfig,
  getSolarConfig,
  GUTTER_PROFILE_META,
  GutterProfile,
  InteriorWallMaterial,
  Render3DMode,
  RoofMaterial,
  SolarRoofFace,
  WATER_COLLECTION_META,
  WaterCollectionMode,
  WindowFrameFinish,
  WiringRouteMode,
} from '../model/types';
import { computeRoofSurfaceAt, computeSolarArrayLayout, levelBoundingBox, polygonCentroid, wallAngleRad, wallLength } from '../engine/geometry';
import {
  computeHVACConduitRoutes,
  computeLightingRoutes,
  computePowerSocketRingRoutes,
  computePVAndEquipmentRoutes,
  computeSubMainRoutes,
  getCoreElectricalNodes,
  relocateMEPNode,
} from '../engine/mepEngine';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Box,
  Camera,
  Compass,
  Footprints,
  Move,
  Palette,
  RotateCcw,
  RotateCw,
  Sun,
  Zap,
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
      const step = pattern === 'corrugated' ? 16 : pattern === 'seam' ? 64 : 20;
      const lineW = pattern === 'seam' ? 6 : pattern === 'corrugated' ? 5 : 4;
      for (let x = 0; x < size; x += step) {
        ctx.fillStyle = accentHex;
        ctx.fillRect(x, 0, lineW, size);
        ctx.fillStyle = 'rgba(255,255,255,0.16)';
        ctx.fillRect(x + lineW, 0, 2, size);
        ctx.fillStyle = 'rgba(0,0,0,0.14)';
        ctx.fillRect(Math.max(0, x - 2), 0, 2, size);
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
  const [showSolarPad, setShowSolarPad] = useState<boolean>(false);
  const [showWiring3D, setShowWiring3D] = useState<boolean>(false);
  const [wiringLayer3D, setWiringLayer3D] = useState<'all' | 'feeders' | 'lighting' | 'power' | 'hvac'>('all');
  const [selectedEquipKind, setSelectedEquipKind] = useState<'mdb' | 'utility_meter' | 'solar_inv' | 'solar_bess'>('mdb');
  const [selectedWaypointKey, setSelectedWaypointKey] = useState<string | null>(null);
  const [solarMoveMode, setSolarMoveMode] = useState<'array' | 'panel'>('array');
  const [selectedPanelIndex, setSelectedPanelIndex] = useState<number | null>(null);
  const [draftProject, setDraftProject] = useState<BuildingProject | null>(null);

  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sunLightRef = useRef<THREE.DirectionalLight | null>(null);
  const buildingGroupRef = useRef<THREE.Group | null>(null);
  const solarMeshesRef = useRef<THREE.Mesh[]>([]);
  const equipMeshesRef = useRef<THREE.Mesh[]>([]);
  const waypointMeshesRef = useRef<THREE.Mesh[]>([]);
  const waypointDragRef = useRef<{
    route: 'dc' | 'ac';
    wpIndex: number;
    dragPlane: THREE.Plane;
    startHit: THREE.Vector3;
    initWaypoints: { x: number; y: number }[];
  } | null>(null);
  const equipDragRef = useRef<{
    nodeKind: 'mdb' | 'utility_meter' | 'solar_inv' | 'solar_bess';
    dragPlane: THREE.Plane;
    startHit: THREE.Vector3;
    initPos: { x: number; y: number };
  } | null>(null);

  const projectRef = useRef<BuildingProject>(project);
  projectRef.current = project;
  const draftProjectRef = useRef<BuildingProject | null>(null);
  draftProjectRef.current = draftProject;
  const onUpdateProjectRef = useRef(onUpdateProject);
  onUpdateProjectRef.current = onUpdateProject;
  const solarMoveModeRef = useRef<'array' | 'panel'>(solarMoveMode);
  solarMoveModeRef.current = solarMoveMode;
  const solarDragRef = useRef<{
    panelIndex: number;
    moveSingle: boolean;
    dragPlane: THREE.Plane;
    startHit: THREE.Vector3;
    initialSolar: ReturnType<typeof getSolarConfig>;
  } | null>(null);

  // Walkthrough / Explore refs used inside the 60fps animation frame
  const exploreActiveRef = useRef<boolean>(false);
  const explorePosRef = useRef<THREE.Vector3>(new THREE.Vector3(6, 2.1, 14));
  const exploreYawRef = useRef<number>(0);
  const explorePitchRef = useRef<number>(-0.05);
  const keysRef = useRef<Set<string>>(new Set());
  const isLookingRef = useRef<boolean>(false);
  const lastMouseRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const activeProject = draftProject ?? project;
  const solar = getSolarConfig(activeProject);
  const design = getDesignConfig(activeProject);
  const drainageCfg = getRoofDrainageConfig(activeProject.roof);

  const lastLevel = activeProject.levels[activeProject.levels.length - 1];
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
    const raycaster = new THREE.Raycaster();
    const pointerNdc = new THREE.Vector2();

    const updateNdc = (clientX: number, clientY: number) => {
      const rect = dom.getBoundingClientRect();
      pointerNdc.x = ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
      pointerNdc.y = -((clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1;
    };

    const onContainerPointerDownCapture = (e: PointerEvent) => {
      if (exploreActiveRef.current) return;
      if (e.button !== 0 || e.shiftKey || !onUpdateProjectRef.current) return;
      if (e.target !== dom) return;

      updateNdc(e.clientX, e.clientY);
      raycaster.setFromCamera(pointerNdc, camera);

      if (waypointMeshesRef.current.length > 0) {
        const wpHits = raycaster.intersectObjects(waypointMeshesRef.current, false);
        if (wpHits.length > 0) {
          const hit = wpHits[0];
          const route = hit.object.userData.route as 'dc' | 'ac';
          const wpIndex = hit.object.userData.wpIndex as number;
          const wpList = (hit.object.userData.wpList as { x: number; y: number }[]) ?? [];
          const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -hit.point.y);
          const startHit = new THREE.Vector3();
          if (raycaster.ray.intersectPlane(dragPlane, startHit)) {
            waypointDragRef.current = {
              route,
              wpIndex,
              dragPlane,
              startHit,
              initWaypoints: wpList.map((w) => ({ ...w })),
            };
            setSelectedWaypointKey(`${route}_${wpIndex}`);
            controls.enabled = false;
            dom.style.cursor = 'grabbing';
            e.stopPropagation();
          }
          return;
        }
      }
      if (equipMeshesRef.current.length > 0) {
        const eqHits = raycaster.intersectObjects(equipMeshesRef.current, false);
        if (eqHits.length > 0) {
          e.stopPropagation();
          controls.enabled = false;
          const hit = eqHits[0];
          const nodeKind = hit.object.userData.nodeKind as 'mdb' | 'utility_meter' | 'solar_inv' | 'solar_bess';
          const lvl0 = projectRef.current.levels[0];
          if (lvl0) {
            const core = getCoreElectricalNodes(lvl0);
            const curNode =
              nodeKind === 'mdb'
                ? core.mdb
                : nodeKind === 'utility_meter'
                ? core.meter
                : nodeKind === 'solar_inv'
                ? core.inverter
                : core.bess;
            equipDragRef.current = {
              nodeKind,
              dragPlane: new THREE.Plane(new THREE.Vector3(0, 1, 0), -hit.point.y),
              startHit: hit.point.clone(),
              initPos: { ...curNode.position },
            };
            setSelectedEquipKind(nodeKind);
            setShowWiring3D(true);
            setShowSolarPad(false);
            setShowStudioDrawer(false);
            dom.style.cursor = 'grabbing';
            return;
          }
        }
      }

      if (solarMeshesRef.current.length > 0) {
        const hits = raycaster.intersectObjects(solarMeshesRef.current, false);
        if (hits.length > 0) {
          e.stopPropagation();
          controls.enabled = false;
          const hit = hits[0];
          const panelIndex = Number(hit.object.userData.panelIndex ?? 0);
          const moveSingle = solarMoveModeRef.current === 'panel' || e.altKey;
          solarDragRef.current = {
            panelIndex,
            moveSingle,
            dragPlane: new THREE.Plane(new THREE.Vector3(0, 1, 0), -hit.point.y),
            startHit: hit.point.clone(),
            initialSolar: structuredClone(getSolarConfig(projectRef.current)),
          };
          setSelectedPanelIndex(panelIndex);
          setShowSolarPad(true);
          dom.style.cursor = 'grabbing';
        }
      }
    };

    const onPointerDown = (e: PointerEvent) => {
      if (!exploreActiveRef.current) return;
      isLookingRef.current = true;
      lastMouseRef.current = { x: e.clientX, y: e.clientY };
    };
    const onPointerMove = (e: PointerEvent) => {
      const wpDrag = waypointDragRef.current;
      if (wpDrag) {
        updateNdc(e.clientX, e.clientY);
        raycaster.setFromCamera(pointerNdc, camera);
        const hitPoint = new THREE.Vector3();
        if (raycaster.ray.intersectPlane(wpDrag.dragPlane, hitPoint)) {
          const dx = Math.round((hitPoint.x - wpDrag.startHit.x) * 20) / 20;
          const dz = Math.round((hitPoint.z - wpDrag.startHit.z) * 20) / 20;
          const next = structuredClone(projectRef.current);
          const curSolar = getSolarConfig(next);
          const updatedWps = wpDrag.initWaypoints.map((w, idx) =>
            idx === wpDrag.wpIndex
              ? { x: Number((w.x + dx).toFixed(2)), y: Number((w.y + dz).toFixed(2)) }
              : { ...w }
          );
          next.solar = {
            ...curSolar,
            [wpDrag.route === 'dc' ? 'dcWaypoints' : 'acWaypoints']: updatedWps,
          };
          setDraftProject(next);
        }
        return;
      }

      const eqDrag = equipDragRef.current;
      if (eqDrag) {
        updateNdc(e.clientX, e.clientY);
        raycaster.setFromCamera(pointerNdc, camera);
        const curPt = new THREE.Vector3();
        if (raycaster.ray.intersectPlane(eqDrag.dragPlane, curPt)) {
          const dx = Math.round((curPt.x - eqDrag.startHit.x) * 20) / 20;
          const dy = Math.round((curPt.z - eqDrag.startHit.z) * 20) / 20;
          const next = structuredClone(projectRef.current);
          const lvl0 = next.levels[0];
          if (lvl0) {
            const layout = getSolarConfig(next).enabled ? computeSolarArrayLayout(next) : null;
            relocateMEPNode(
              lvl0,
              eqDrag.nodeKind,
              {
                x: Number((eqDrag.initPos.x + dx).toFixed(2)),
                y: Number((eqDrag.initPos.y + dy).toFixed(2)),
              },
              layout ? { x: layout.bounds.minX, y: layout.bounds.centerY } : undefined
            );
            setDraftProject(next);
          }
        }
        return;
      }

      const drag = solarDragRef.current;
      if (drag) {
        updateNdc(e.clientX, e.clientY);
        raycaster.setFromCamera(pointerNdc, camera);
        const curPt = new THREE.Vector3();
        if (raycaster.ray.intersectPlane(drag.dragPlane, curPt)) {
          const dx = Math.round((curPt.x - drag.startHit.x) * 20) / 20;
          const dy = Math.round((curPt.z - drag.startHit.z) * 20) / 20;
          const next = structuredClone(projectRef.current);
          if (drag.moveSingle) {
            const prevOff = drag.initialSolar.panelOffsets?.[drag.panelIndex] ?? { x: 0, y: 0 };
            next.solar = {
              ...drag.initialSolar,
              panelOffsets: {
                ...(drag.initialSolar.panelOffsets ?? {}),
                [drag.panelIndex]: {
                  x: Number((prevOff.x + dx).toFixed(2)),
                  y: Number((prevOff.y + dy).toFixed(2)),
                },
              },
            };
          } else {
            next.solar = {
              ...drag.initialSolar,
              offsetX: Number(((drag.initialSolar.offsetX ?? 0) + dx).toFixed(2)),
              offsetY: Number(((drag.initialSolar.offsetY ?? 0) + dy).toFixed(2)),
            };
          }
          setDraftProject(next);
        }
        return;
      }

      if (!exploreActiveRef.current && e.target === dom) {
        updateNdc(e.clientX, e.clientY);
        raycaster.setFromCamera(pointerNdc, camera);
        const hitWaypoint = waypointMeshesRef.current.length > 0 && raycaster.intersectObjects(waypointMeshesRef.current, false).length > 0;
        const hitEquip = equipMeshesRef.current.length > 0 && raycaster.intersectObjects(equipMeshesRef.current, false).length > 0;
        const hitSolar = solarMeshesRef.current.length > 0 && raycaster.intersectObjects(solarMeshesRef.current, false).length > 0;
        dom.style.cursor = hitWaypoint || hitEquip || hitSolar ? 'grab' : '';
      }

      if (!exploreActiveRef.current || !isLookingRef.current) return;
      const dx = e.clientX - lastMouseRef.current.x;
      const dy = e.clientY - lastMouseRef.current.y;
      lastMouseRef.current = { x: e.clientX, y: e.clientY };
      exploreYawRef.current -= dx * 0.0055;
      explorePitchRef.current = Math.max(-1.1, Math.min(1.1, explorePitchRef.current - dy * 0.0045));
    };
    const onPointerUp = () => {
      if (waypointDragRef.current) {
        const finalDraft = draftProjectRef.current;
        waypointDragRef.current = null;
        controls.enabled = !exploreActiveRef.current;
        dom.style.cursor = '';
        setDraftProject(null);
        if (finalDraft && onUpdateProjectRef.current) {
          onUpdateProjectRef.current(finalDraft);
        }
      }
      if (equipDragRef.current) {
        const finalDraft = draftProjectRef.current;
        equipDragRef.current = null;
        controls.enabled = !exploreActiveRef.current;
        dom.style.cursor = '';
        setDraftProject(null);
        if (finalDraft && onUpdateProjectRef.current) {
          onUpdateProjectRef.current(finalDraft);
        }
      }
      if (solarDragRef.current) {
        const finalDraft = draftProjectRef.current;
        solarDragRef.current = null;
        controls.enabled = !exploreActiveRef.current;
        dom.style.cursor = '';
        setDraftProject(null);
        if (finalDraft && onUpdateProjectRef.current) {
          onUpdateProjectRef.current(finalDraft);
        }
      }
      isLookingRef.current = false;
    };
    container.addEventListener('pointerdown', onContainerPointerDownCapture, true);
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
      container.removeEventListener('pointerdown', onContainerPointerDownCapture, true);
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

    solarMeshesRef.current = [];
    equipMeshesRef.current = [];
    waypointMeshesRef.current = [];
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
    const roofSpec = ROOF_MATERIAL_OPTIONS.find((r) => r.id === activeProject.roof.material) ?? ROOF_MATERIAL_OPTIONS[0];

    const extTex = isPBR ? registerTex(createPatternTexture(facadeSpec.pattern, facadeSpec.base, facadeSpec.accent, 3, 2)) : null;
    const intTex = isPBR ? registerTex(createPatternTexture(intWallSpec.pattern, intWallSpec.base, intWallSpec.accent, 2, 2)) : null;
    const roofTexRepeat = activeProject.roof.type === 'gable' || activeProject.roof.type === 'hip' ? 1 : 4;
    const roofTex = isPBR ? registerTex(createPatternTexture(roofSpec.pattern, roofSpec.base, roofSpec.accent, roofTexRepeat, roofTexRepeat)) : null;
    const roofBumpTex = isPBR ? registerTex(createPatternTexture(roofSpec.pattern, '#808080', '#ffffff', roofTexRepeat, roofTexRepeat)) : null;
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

    const ground = activeProject.levels[0];
    const gBB = ground ? levelBoundingBox(ground) : { minX: 0, maxX: 12, minY: 0, maxY: 10, width: 12, depth: 10 };
    const bCenterX = (gBB.minX + gBB.maxX) / 2;
    const bCenterZ = (gBB.minY + gBB.maxY) / 2;

    // Site Lot Terrain Pad
    const lotW = Math.max(activeProject.meta.plotWidth, gBB.width + 8);
    const lotD = Math.max(activeProject.meta.plotDepth, gBB.depth + 8);
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
    for (const lvl of activeProject.levels) {
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
      const hvacCfg = getHVACConfig(activeProject);
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

      // Helper: rigid straight 3D electrical conduit run with elbow spheres
      const addConduitRun = (pts: THREE.Vector3[], colorHex: number, radius = 0.026) => {
        if (pts.length < 2) return;
        const cMat = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.35, metalness: 0.45 });
        for (let ci = 0; ci < pts.length - 1; ci++) {
          const pA = pts[ci];
          const pB = pts[ci + 1];
          const dir = new THREE.Vector3().subVectors(pB, pA);
          const len = dir.length();
          if (len < 0.03) continue;
          const seg = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, len, 8), cMat);
          seg.position.copy(pA).add(pB).multiplyScalar(0.5);
          seg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
          group.add(seg);
          if (ci > 0) {
            const elbow = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.35, 8, 8), cMat);
            elbow.position.copy(pA);
            group.add(elbow);
          }
        }
      };

      // Draggable 3D Core Electrical Equipment (MDB, Utility Smart Meter, Hybrid Inverter, BESS)
      const lvlCore = getCoreElectricalNodes(lvl);
      if (lvl.index === 0) {
        const registerEquip = (mesh: THREE.Mesh, nodeKind: 'mdb' | 'utility_meter' | 'solar_inv' | 'solar_bess') => {
          mesh.userData = { draggableKind: 'mep_equip', nodeKind };
          equipMeshesRef.current.push(mesh);
          if (showWiring3D && selectedEquipKind === nodeKind) {
            const selEdges = new THREE.EdgesGeometry(mesh.geometry);
            const selLine = new THREE.LineSegments(selEdges, new THREE.LineBasicMaterial({ color: 0xf59e0b }));
            selLine.position.copy(mesh.position);
            selLine.scale.set(1.22, 1.15, 1.22);
            group.add(selLine);
          }
        };

        // 1. Main Distribution Board (MDB)
        const mdbY = baseY + 1.52;
        const mdbBox = new THREE.Mesh(
          new THREE.BoxGeometry(0.42, 0.56, 0.24),
          new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.35, metalness: 0.55 })
        );
        mdbBox.position.set(lvlCore.mdb.position.x, mdbY, lvlCore.mdb.position.y);
        mdbBox.castShadow = true;
        registerEquip(mdbBox, 'mdb');
        const mdbFront = new THREE.Mesh(
          new THREE.BoxGeometry(0.32, 0.34, 0.26),
          new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.3, metalness: 0.2 })
        );
        mdbFront.position.set(lvlCore.mdb.position.x, mdbY + 0.04, lvlCore.mdb.position.y);
        const mdbIsolator = new THREE.Mesh(
          new THREE.BoxGeometry(0.09, 0.09, 0.28),
          new THREE.MeshStandardMaterial({ color: 0xe11d48, roughness: 0.3 })
        );
        mdbIsolator.position.set(lvlCore.mdb.position.x + 0.1, mdbY - 0.17, lvlCore.mdb.position.y);
        group.add(mdbBox, mdbFront, mdbIsolator);

        // 2. Utility Bi-Directional kWh Smart Meter
        const mtrY = baseY + 1.42;
        const mtrBox = new THREE.Mesh(
          new THREE.BoxGeometry(0.36, 0.46, 0.24),
          new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.4, metalness: 0.35 })
        );
        mtrBox.position.set(lvlCore.meter.position.x, mtrY, lvlCore.meter.position.y);
        mtrBox.castShadow = true;
        registerEquip(mtrBox, 'utility_meter');
        const mtrLcd = new THREE.Mesh(
          new THREE.BoxGeometry(0.24, 0.18, 0.26),
          new THREE.MeshStandardMaterial({ color: 0x0284c7, emissive: 0x0369a1, emissiveIntensity: 0.35 })
        );
        mtrLcd.position.set(lvlCore.meter.position.x, mtrY + 0.06, lvlCore.meter.position.y);
        const earthPit = new THREE.Mesh(
          new THREE.BoxGeometry(0.32, 0.06, 0.32),
          new THREE.MeshStandardMaterial({ color: 0xb45309, roughness: 0.7 })
        );
        earthPit.position.set(lvlCore.meter.position.x, baseY + 0.02, lvlCore.meter.position.y);
        group.add(mtrBox, mtrLcd, earthPit);

        // 3. Hybrid Solar Inverter & LiFePO4 BESS Battery Cabinet
        if (solar.enabled) {
          const invBox = new THREE.Mesh(
            new THREE.BoxGeometry(0.42, 0.62, 0.22),
            new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.3, metalness: 0.45 })
          );
          invBox.position.set(lvlCore.inverter.position.x, baseY + 1.45, lvlCore.inverter.position.y);
          invBox.castShadow = true;
          registerEquip(invBox, 'solar_inv');
          const invScreen = new THREE.Mesh(
            new THREE.BoxGeometry(0.22, 0.16, 0.24),
            new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.2 })
          );
          invScreen.position.set(lvlCore.inverter.position.x, baseY + 1.54, lvlCore.inverter.position.y);
          group.add(invBox, invScreen);

          if (solar.batteryKWh > 0) {
            const bessBox = new THREE.Mesh(
              new THREE.BoxGeometry(0.48, 0.78, 0.26),
              new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.35, metalness: 0.2 })
            );
            bessBox.position.set(lvlCore.bess.position.x, baseY + 0.68, lvlCore.bess.position.y);
            bessBox.castShadow = true;
            registerEquip(bessBox, 'solar_bess');
            const bessLed = new THREE.Mesh(
              new THREE.BoxGeometry(0.32, 0.06, 0.28),
              new THREE.MeshStandardMaterial({ color: 0x7c3aed, emissive: 0x7c3aed, emissiveIntensity: 0.45 })
            );
            bessLed.position.set(lvlCore.bess.position.x, baseY + 0.92, lvlCore.bess.position.y);
            group.add(bessBox, bessLed);
          }
        }
      }

      // Detailed 3D Wiring Plan (Grid SWA, Sub-Mains to Room DBs, Solar PV DC String, AC Bi-Dir, Lighting/Switch/Socket/HVAC Conduits)
      if (showWiring3D || isXray) {
        const equipRoutes = computePVAndEquipmentRoutes(activeProject, lvl.index);
        const showWiringLayer = (layer: 'feeders' | 'lighting' | 'power' | 'hvac') =>
          wiringLayer3D === 'all' || wiringLayer3D === layer;
        const toVec3 = (arr: { x: number; y: number; z: number }[]) =>
          arr.map((p) => new THREE.Vector3(p.x, p.y, p.z));
        const elevTrim3d = Math.max(-0.5, Math.min(0.25, solar.conduitElevationOffset ?? 0));
        const ceilY = baseY + lvl.floorToFloorHeight - 0.18;

        // Per-Room Wall-Mounted Sub-Distribution Boards (DB-1xx)
        const subDbs = lvl.mepNodes.filter((n) => n.kind === 'sub_db');
        for (const sdb of subDbs) {
          const isEW = sdb.wallSide === 'east' || sdb.wallSide === 'west';
          const sdbW = isEW ? 0.08 : 0.26;
          const sdbD = isEW ? 0.26 : 0.08;
          const sdbBody = new THREE.Mesh(
            new THREE.BoxGeometry(sdbW, 0.32, sdbD),
            new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.38, metalness: 0.5 })
          );
          sdbBody.position.set(sdb.position.x, baseY + 1.65, sdb.position.y);
          sdbBody.castShadow = true;
          const sdbFace = new THREE.Mesh(
            new THREE.BoxGeometry(isEW ? sdbW + 0.015 : 0.18, 0.22, isEW ? 0.18 : sdbD + 0.015),
            new THREE.MeshStandardMaterial({ color: 0x06b6d4, roughness: 0.28, metalness: 0.25 })
          );
          sdbFace.position.set(sdb.position.x, baseY + 1.65, sdb.position.y);
          group.add(sdbBody, sdbFace);
        }

        // In-Wall Sub-Main Feeders from MDB to Every Room's Sub-Distribution Board
        if (showWiringLayer('feeders')) {
          const subMainRuns = computeSubMainRoutes(lvl);
          for (const run of subMainRuns) {
            addConduitRun(toVec3(run), 0x06b6d4, 0.024);
          }
        }

        if (lvl.index === 0 && showWiringLayer('feeders')) {
          // Grid Intake -> Utility Meter -> Wall-Hugging MDB (Cyan SWA Feeder)
          const gIntake = new THREE.Vector3(lvlCore.meter.position.x - 1.1, baseY + 0.08, lvlCore.meter.position.y);
          const mtrBase = new THREE.Vector3(lvlCore.meter.position.x, baseY + 0.08, lvlCore.meter.position.y);
          const mtrMid = new THREE.Vector3(lvlCore.meter.position.x, baseY + 1.42, lvlCore.meter.position.y);
          addConduitRun([gIntake, mtrBase, mtrMid], 0x0284c7, 0.036);
          addConduitRun(toVec3(equipRoutes.meterToMdb.points3D), 0x0284c7, 0.032);

          if (solar.enabled) {
            const sLayout3d = computeSolarArrayLayout(activeProject);
            const pvCombPt = new THREE.Vector3(
              equipRoutes.pvCombinerPos.x,
              equipRoutes.pvCombinerY3d,
              equipRoutes.pvCombinerPos.y
            );

            if (sLayout3d.panels.length > 0) {
              const combBox = new THREE.Mesh(
                new THREE.BoxGeometry(0.26, 0.12, 0.22),
                new THREE.MeshStandardMaterial({ color: 0xe11d48, roughness: 0.35 })
              );
              combBox.position.copy(pvCombPt);
              group.add(combBox);

              // Rooftop panel row string jumper rails following roof pitch into PV-JB Combiner
              const rowCols = Math.max(1, sLayout3d.cols);
              const rowsMap = new Map<number, typeof sLayout3d.panels>();
              for (const p of sLayout3d.panels) {
                const rIdx = Math.floor(p.index / rowCols);
                const arr = rowsMap.get(rIdx) ?? [];
                arr.push(p);
                rowsMap.set(rIdx, arr);
              }
              const rowTerminals: THREE.Vector3[] = [];
              for (const rowPanels of rowsMap.values()) {
                rowPanels.sort((a, b) => a.x - b.x);
                const rowPts = rowPanels.map((p) => {
                  const surf = computeRoofSurfaceAt(activeProject, p.x, p.y);
                  return new THREE.Vector3(p.x, surf.y3d + 0.045, p.y);
                });
                if (rowPts.length >= 2) {
                  addConduitRun(rowPts, 0xbe123c, 0.017);
                }
                if (rowPts.length > 0) {
                  // Join nearest row end toward combiner
                  const firstPt = rowPts[0];
                  const lastPt = rowPts[rowPts.length - 1];
                  const chosen =
                    firstPt.distanceToSquared(pvCombPt) <= lastPt.distanceToSquared(pvCombPt) ? firstPt : lastPt;
                  rowTerminals.push(chosen);
                }
              }
              for (const term of rowTerminals) {
                const midX = (term.x + pvCombPt.x) / 2;
                const midY = (term.z + pvCombPt.z) / 2;
                const midSurf = computeRoofSurfaceAt(activeProject, midX, midY);
                addConduitRun(
                  [term, new THREE.Vector3(midX, midSurf.y3d + 0.05, midY), pvCombPt],
                  0xbe123c,
                  0.017
                );
              }
            }

            // Wall-mounted DC Isolator above Inverter
            const dcIsoPt = new THREE.Vector3(lvlCore.inverter.position.x, baseY + 2.02, lvlCore.inverter.position.y);
            const isoBox = new THREE.Mesh(
              new THREE.BoxGeometry(0.18, 0.22, 0.16),
              new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.35 })
            );
            isoBox.position.copy(dcIsoPt);
            group.add(isoBox);

            // Roof-Sloped & Wall-Hugging Red PV DC String Conduit
            addConduitRun(toVec3(equipRoutes.pvToInverter.points3D), 0xe11d48, 0.028);

            // Draggable 3D DC-JB Waypoint Junction Boxes
            equipRoutes.pvToInverter.waypoints.forEach((wp, idx) => {
              const wpY =
                idx === 0
                  ? Math.max(ceilY, computeRoofSurfaceAt(activeProject, wp.x, wp.y).y3d + 0.055)
                  : baseY + lvl.floorToFloorHeight - 0.16 + elevTrim3d;
              const isWpSel = selectedWaypointKey === `dc_${idx}`;
              const jbMesh = new THREE.Mesh(
                new THREE.BoxGeometry(0.22, 0.18, 0.22),
                new THREE.MeshStandardMaterial({
                  color: isWpSel ? 0xf59e0b : 0xf43f5e,
                  emissive: isWpSel ? 0xf59e0b : 0x000000,
                  emissiveIntensity: isWpSel ? 0.35 : 0,
                  roughness: 0.35,
                })
              );
              jbMesh.position.set(wp.x, wpY, wp.y);
              jbMesh.userData = {
                draggableKind: 'wiring_waypoint',
                route: 'dc',
                wpIndex: idx,
                wpList: equipRoutes.pvToInverter.waypoints,
              };
              group.add(jbMesh);
              waypointMeshesRef.current.push(jbMesh);
            });

            // Purple BESS DC Battery Link
            if (solar.batteryKWh > 0) {
              addConduitRun(toVec3(equipRoutes.inverterToBess.points3D), 0x7c3aed, 0.028);
            }

            // Wall-Hugging Green Bi-Directional AC Inverter -> MDB Feeder
            addConduitRun(toVec3(equipRoutes.inverterToMdb.points3D), 0x16a34a, 0.03);

            // Draggable 3D AC-JB Waypoint Junction Boxes
            equipRoutes.inverterToMdb.waypoints.forEach((wp, idx) => {
              const wpY = baseY + lvl.floorToFloorHeight - 0.24 + elevTrim3d;
              const isWpSel = selectedWaypointKey === `ac_${idx}`;
              const jbMesh = new THREE.Mesh(
                new THREE.BoxGeometry(0.22, 0.18, 0.22),
                new THREE.MeshStandardMaterial({
                  color: isWpSel ? 0xf59e0b : 0x10b981,
                  emissive: isWpSel ? 0xf59e0b : 0x000000,
                  emissiveIntensity: isWpSel ? 0.35 : 0,
                  roughness: 0.35,
                })
              );
              jbMesh.position.set(wp.x, wpY, wp.y);
              jbMesh.userData = {
                draggableKind: 'wiring_waypoint',
                route: 'ac',
                wpIndex: idx,
                wpList: equipRoutes.inverterToMdb.waypoints,
              };
              group.add(jbMesh);
              waypointMeshesRef.current.push(jbMesh);
            });
          }
        }

        // Branch Lighting Spine + Connected Ceiling-to-Wall Switch Drops (Yellow)
        if (showWiringLayer('lighting')) {
          const lightRoutes = computeLightingRoutes(lvl);
          for (const run of lightRoutes.trunkPaths3D) {
            addConduitRun(toVec3(run), 0xfacc15, 0.021);
          }
          for (const drop of lightRoutes.switchDropPaths3D) {
            addConduitRun(toVec3(drop), 0xfde047, 0.017);
          }
          for (const ln of lvl.mepNodes.filter((n) => n.kind === 'light_ceiling' && n.label !== 'SD')) {
            const bulb = new THREE.Mesh(
              new THREE.CylinderGeometry(0.14, 0.14, 0.04, 12),
              new THREE.MeshStandardMaterial({ color: 0xfef08a, emissive: 0xfacc15, emissiveIntensity: 0.45 })
            );
            bulb.position.set(ln.position.x, ceilY - 0.03, ln.position.y);
            group.add(bulb);
          }
          for (const sw of lvl.mepNodes.filter((n) => n.kind === 'switch_1g')) {
            const isEW = sw.wallSide === 'east' || sw.wallSide === 'west';
            const swBox = new THREE.Mesh(
              new THREE.BoxGeometry(isEW ? 0.04 : 0.11, 0.11, isEW ? 0.11 : 0.04),
              new THREE.MeshStandardMaterial({ color: 0xfef9c3 })
            );
            swBox.position.set(sw.position.x, baseY + 1.22, sw.position.y);
            group.add(swBox);
          }
        }

        // Wall-Hugging Power Socket Ring (Orange dado conduit + wall-oriented socket backboxes)
        if (showWiringLayer('power')) {
          const powerRuns = computePowerSocketRingRoutes(lvl);
          for (const run of powerRuns) {
            addConduitRun(toVec3(run), 0xf97316, 0.02);
          }
          for (const on of lvl.mepNodes.filter((n) => n.kind === 'outlet_duplex')) {
            const isEW = on.wallSide === 'east' || on.wallSide === 'west';
            const inKitchen =
              (on.circuitId?.startsWith('K') ?? false) ||
              lvl.rooms.some(
                (r) =>
                  r.id === on.roomId &&
                  r.category === 'kitchen'
              );
            const outBox = new THREE.Mesh(
              new THREE.BoxGeometry(isEW ? 0.05 : 0.14, 0.09, isEW ? 0.14 : 0.05),
              new THREE.MeshStandardMaterial({ color: 0xfdba74 })
            );
            outBox.position.set(on.position.x, baseY + (inKitchen ? 1.05 : 0.35), on.position.y);
            group.add(outBox);
          }
        }

        // Paired Indoor FCU <-> Outdoor CDU Wall-Hugging HVAC Power & Refrigerant Conduits (Purple)
        if (showWiringLayer('hvac')) {
          const hvacRoutes = computeHVACConduitRoutes(lvl);
          for (const run of hvacRoutes.powerFeedRuns3D) {
            addConduitRun(toVec3(run), 0xc084fc, 0.02);
          }
          for (const run of hvacRoutes.refrigerantRuns3D) {
            addConduitRun(toVec3(run), 0xa855f7, 0.025);
          }
        }
      }
    }

    // Roof Geometry + Straight Metric-Aligned UVs + Volumetric 3D Ribs/Ridges/Fascia + Gutters & Rainwater Collection
    if (showRoof && lastLevel && lastLevel.walls.length > 0 && cutawayHeight >= lastLevel.elevation + lastLevel.floorToFloorHeight) {
      const rBB = levelBoundingBox(lastLevel);
      const eaveY = lastLevel.elevation + lastLevel.floorToFloorHeight;
      const ov = activeProject.roof.overhang;
      const w = rBB.width + ov * 2;
      const d = rBB.depth + ov * 2;
      const cx = (rBB.minX + rBB.maxX) / 2;
      const cz = (rBB.minY + rBB.maxY) / 2;
      const pitchRad = (activeProject.roof.pitchDeg * Math.PI) / 180;
      const rise = Math.max(0.4, (Math.min(w, d) / 2) * Math.tan(pitchRad));
      const drainage = getRoofDrainageConfig(activeProject.roof);
      const gutterMeta = GUTTER_PROFILE_META[drainage.gutterProfile];

      const roofGroup = new THREE.Group();
      roofGroup.position.set(cx, eaveY, cz);
      group.add(roofGroup);

      const roofMat = new THREE.MeshStandardMaterial({
        color: isClay ? 0x94a3b8 : isPBR ? 0xffffff : roofSpec.base,
        map: roofTex,
        bumpMap: roofBumpTex,
        bumpScale: 0.045,
        roughness: roofSpec.roughness,
        metalness: roofSpec.metalness,
        transparent: isXray,
        opacity: isXray ? 0.25 : 1,
        wireframe: isBlueprint,
        side: THREE.DoubleSide,
      });

      const fasciaMat = new THREE.MeshStandardMaterial({
        color: isClay ? 0xcbd5e1 : isBlueprint ? 0x1e40af : 0x1e293b,
        roughness: 0.5,
        metalness: 0.2,
        transparent: isXray,
        opacity: isXray ? 0.3 : 1,
        wireframe: isBlueprint,
      });

      const soffitMat = new THREE.MeshStandardMaterial({
        color: isClay ? 0xf1f5f9 : isBlueprint ? 0x0f172a : 0xf1f5f9,
        roughness: 0.75,
        metalness: 0.05,
        transparent: isXray,
        opacity: isXray ? 0.2 : 1,
        wireframe: isBlueprint,
      });

      const capMat = new THREE.MeshStandardMaterial({
        color: isClay ? 0x64748b : isPBR ? roofSpec.accent : roofSpec.base,
        roughness: Math.max(0.25, roofSpec.roughness - 0.1),
        metalness: Math.min(0.85, roofSpec.metalness + 0.15),
        transparent: isXray,
        opacity: isXray ? 0.35 : 1,
        wireframe: isBlueprint,
      });

      const ribMat = new THREE.MeshStandardMaterial({
        color: isClay ? 0x64748b : isPBR ? roofSpec.accent : roofSpec.base,
        roughness: roofSpec.roughness,
        metalness: roofSpec.metalness,
        transparent: isXray,
        opacity: isXray ? 0.3 : 1,
        wireframe: isBlueprint,
      });

      // Helper: place a 3D beam/rib/hip cap aligned cleanly between two 3D points in roofGroup space
      const addBeamBetween = (
        pA: THREE.Vector3,
        pB: THREE.Vector3,
        width: number,
        height: number,
        mat: THREE.Material
      ) => {
        const dir = new THREE.Vector3().subVectors(pB, pA);
        const len = dir.length();
        if (len < 0.05) return;
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, len), mat);
        mesh.position.copy(pA).add(pB).multiplyScalar(0.5);
        mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.normalize());
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        roofGroup.add(mesh);
      };

      const hw = w / 2;
      const hd = d / 2;

      if (activeProject.roof.type === 'flat') {
        const roofSlab = new THREE.Mesh(new THREE.BoxGeometry(w, 0.22, d), roofMat);
        roofSlab.position.set(0, 0.11, 0);
        roofSlab.castShadow = true;
        roofSlab.receiveShadow = true;
        roofGroup.add(roofSlab);

        const ph = activeProject.roof.parapetHeight;
        const pThick = 0.2;
        const p1 = new THREE.Mesh(new THREE.BoxGeometry(w, ph, pThick), extWallMat);
        p1.position.set(0, ph / 2, -hd + pThick / 2);
        const p2 = new THREE.Mesh(new THREE.BoxGeometry(w, ph, pThick), extWallMat);
        p2.position.set(0, ph / 2, hd - pThick / 2);
        const p3 = new THREE.Mesh(new THREE.BoxGeometry(pThick, ph, d), extWallMat);
        p3.position.set(-hw + pThick / 2, ph / 2, 0);
        const p4 = new THREE.Mesh(new THREE.BoxGeometry(pThick, ph, d), extWallMat);
        p4.position.set(hw - pThick / 2, ph / 2, 0);
        roofGroup.add(p1, p2, p3, p4);
      } else if (activeProject.roof.type === 'shed') {
        const slopeLen = Math.hypot(d, rise);
        const slopeAngle = Math.atan2(rise, d);
        const shed = new THREE.Mesh(new THREE.BoxGeometry(w, 0.16, slopeLen), roofMat);
        shed.position.set(0, rise / 2, 0);
        shed.rotation.x = -slopeAngle;
        shed.castShadow = true;
        shed.receiveShadow = true;
        roofGroup.add(shed);

        // 3D ribs or tile courses on shed roof
        const ribStep = roofSpec.pattern === 'corrugated' ? 0.36 : 0.5;
        if (roofSpec.pattern === 'seam' || roofSpec.pattern === 'corrugated' || roofSpec.pattern === 'slats') {
          for (let rx = -hw + ribStep; rx <= hw - ribStep + 0.01; rx += ribStep) {
            addBeamBetween(
              new THREE.Vector3(rx, 0.09, hd),
              new THREE.Vector3(rx, rise + 0.09, -hd),
              roofSpec.pattern === 'seam' ? 0.042 : 0.036,
              0.042,
              ribMat
            );
          }
        }
        // Fascia boards at front low eave, back high eave & rakes
        addBeamBetween(new THREE.Vector3(-hw, -0.02, hd), new THREE.Vector3(hw, -0.02, hd), 0.05, 0.18, fasciaMat);
        addBeamBetween(new THREE.Vector3(-hw, rise, -hd), new THREE.Vector3(hw, rise, -hd), 0.05, 0.18, fasciaMat);
        addBeamBetween(new THREE.Vector3(-hw, 0.02, hd), new THREE.Vector3(-hw, rise + 0.02, -hd), 0.06, 0.18, fasciaMat);
        addBeamBetween(new THREE.Vector3(hw, 0.02, hd), new THREE.Vector3(hw, rise + 0.02, -hd), 0.06, 0.18, fasciaMat);
      } else {
        const isHip = activeProject.roof.type === 'hip';
        const ridgeHalf = isHip ? Math.max(0.2, hw - hd * 0.85) : hw;
        const slopeLenNS = Math.hypot(hd, rise);
        const ewRun = Math.max(0.01, hw - ridgeHalf);
        const slopeLenEW = Math.hypot(ewRun, rise);
        // Exact 2.0m metric UV tile so standing seams (0.50m spacing = 64px in 256px texture) align 1:1 with 3D ribs
        const tileScale = 2.0;

        // Helper pushing a sloped roof triangle with true metric tangent UVs (zero trapezoid shear)
        const pitchPos: number[] = [];
        const pitchUv: number[] = [];
        const pushSlopeTri = (
          ax: number, ay: number, az: number,
          bx: number, by: number, bz: number,
          cxp: number, cyp: number, czp: number,
          uvFn: (vx: number, vy: number, vz: number) => [number, number]
        ) => {
          pitchPos.push(ax, ay, az, bx, by, bz, cxp, cyp, czp);
          const ua = uvFn(ax, ay, az);
          const ub = uvFn(bx, by, bz);
          const uc = uvFn(cxp, cyp, czp);
          pitchUv.push(ua[0], ua[1], ub[0], ub[1], uc[0], uc[1]);
        };

        const uvFront = (vx: number, _vy: number, vz: number): [number, number] => [
          (vx + hw) / tileScale,
          (((hd - vz) / hd) * slopeLenNS) / tileScale,
        ];
        const uvBack = (vx: number, _vy: number, vz: number): [number, number] => [
          (hw - vx) / tileScale,
          (((hd + vz) / hd) * slopeLenNS) / tileScale,
        ];
        const uvEast = (vx: number, _vy: number, vz: number): [number, number] => [
          (hd - vz) / tileScale,
          (((hw - vx) / ewRun) * slopeLenEW) / tileScale,
        ];
        const uvWest = (vx: number, _vy: number, vz: number): [number, number] => [
          (hd + vz) / tileScale,
          (((hw + vx) / ewRun) * slopeLenEW) / tileScale,
        ];

        // Front & Back main slopes (straight perpendicular UVs along X and up slope)
        pushSlopeTri(-hw, 0, hd, hw, 0, hd, ridgeHalf, rise, 0, uvFront);
        pushSlopeTri(-hw, 0, hd, ridgeHalf, rise, 0, -ridgeHalf, rise, 0, uvFront);
        pushSlopeTri(hw, 0, -hd, -hw, 0, -hd, -ridgeHalf, rise, 0, uvBack);
        pushSlopeTri(hw, 0, -hd, -ridgeHalf, rise, 0, ridgeHalf, rise, 0, uvBack);

        if (isHip) {
          pushSlopeTri(hw, 0, hd, hw, 0, -hd, ridgeHalf, rise, 0, uvEast);
          pushSlopeTri(-hw, 0, -hd, -hw, 0, hd, -ridgeHalf, rise, 0, uvWest);
        } else {
          // Gable vertical triangular end walls rendered with exterior wall material
          const gPos = new Float32Array([
            hw, 0, hd, hw, 0, -hd, ridgeHalf, rise, 0,
            -hw, 0, -hd, -hw, 0, hd, -ridgeHalf, rise, 0,
          ]);
          const gUv = new Float32Array([
            0, 0, 1, 0, 0.5, 0.4,
            0, 0, 1, 0, 0.5, 0.4,
          ]);
          const gableGeo = new THREE.BufferGeometry();
          gableGeo.setAttribute('position', new THREE.BufferAttribute(gPos, 3));
          gableGeo.setAttribute('uv', new THREE.BufferAttribute(gUv, 2));
          gableGeo.computeVertexNormals();
          const gableWalls = new THREE.Mesh(gableGeo, extWallMat);
          gableWalls.castShadow = true;
          gableWalls.receiveShadow = true;
          roofGroup.add(gableWalls);
        }

        const roofGeo = new THREE.BufferGeometry();
        roofGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pitchPos), 3));
        roofGeo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(pitchUv), 2));
        roofGeo.computeVertexNormals();
        const roofMesh = new THREE.Mesh(roofGeo, roofMat);
        roofMesh.castShadow = true;
        roofMesh.receiveShadow = true;
        roofGroup.add(roofMesh);

        // True 3D Soffit Underside Box (eliminates hollow paper-thin roof underside)
        const soffitBox = new THREE.Mesh(new THREE.BoxGeometry(w - 0.04, 0.05, d - 0.04), soffitMat);
        soffitBox.position.set(0, -0.025, 0);
        soffitBox.receiveShadow = true;
        roofGroup.add(soffitBox);

        // 3D Perimeter Eave Fascia Boards
        const fasciaH = 0.18;
        const fasciaT = 0.05;
        const fFront = new THREE.Mesh(new THREE.BoxGeometry(w + fasciaT, fasciaH, fasciaT), fasciaMat);
        fFront.position.set(0, -fasciaH / 2 + 0.02, hd);
        const fBack = new THREE.Mesh(new THREE.BoxGeometry(w + fasciaT, fasciaH, fasciaT), fasciaMat);
        fBack.position.set(0, -fasciaH / 2 + 0.02, -hd);
        const fEast = new THREE.Mesh(new THREE.BoxGeometry(fasciaT, fasciaH, d + fasciaT), fasciaMat);
        fEast.position.set(hw, -fasciaH / 2 + 0.02, 0);
        const fWest = new THREE.Mesh(new THREE.BoxGeometry(fasciaT, fasciaH, d + fasciaT), fasciaMat);
        fWest.position.set(-hw, -fasciaH / 2 + 0.02, 0);
        roofGroup.add(fFront, fBack, fEast, fWest);

        // 3D Main Horizontal Ridge Cap + Roll
        const ridgeLen = ridgeHalf * 2 + 0.12;
        const ridgeCap = new THREE.Mesh(new THREE.BoxGeometry(ridgeLen, 0.075, 0.22), capMat);
        ridgeCap.position.set(0, rise + 0.025, 0);
        ridgeCap.castShadow = true;
        const ridgeRoll = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, ridgeLen, 10), capMat);
        ridgeRoll.rotation.z = Math.PI / 2;
        ridgeRoll.position.set(0, rise + 0.06, 0);
        ridgeRoll.castShadow = true;
        roofGroup.add(ridgeCap, ridgeRoll);

        if (isHip) {
          // 4 Diagonal 3D Hip Ridge Flashing Caps
          addBeamBetween(new THREE.Vector3(-hw, 0.02, hd), new THREE.Vector3(-ridgeHalf, rise + 0.03, 0), 0.16, 0.075, capMat);
          addBeamBetween(new THREE.Vector3(hw, 0.02, hd), new THREE.Vector3(ridgeHalf, rise + 0.03, 0), 0.16, 0.075, capMat);
          addBeamBetween(new THREE.Vector3(-hw, 0.02, -hd), new THREE.Vector3(-ridgeHalf, rise + 0.03, 0), 0.16, 0.075, capMat);
          addBeamBetween(new THREE.Vector3(hw, 0.02, -hd), new THREE.Vector3(ridgeHalf, rise + 0.03, 0), 0.16, 0.075, capMat);
        } else {
          // 4 Inclined 3D Gable Rake Bargeboards
          addBeamBetween(new THREE.Vector3(-hw, 0.0, hd), new THREE.Vector3(-hw, rise + 0.03, 0), 0.08, 0.15, fasciaMat);
          addBeamBetween(new THREE.Vector3(-hw, 0.0, -hd), new THREE.Vector3(-hw, rise + 0.03, 0), 0.08, 0.15, fasciaMat);
          addBeamBetween(new THREE.Vector3(hw, 0.0, hd), new THREE.Vector3(hw, rise + 0.03, 0), 0.08, 0.15, fasciaMat);
          addBeamBetween(new THREE.Vector3(hw, 0.0, -hd), new THREE.Vector3(hw, rise + 0.03, 0), 0.08, 0.15, fasciaMat);
        }

        // True 3D Cladding Relief: Raised Straight Ribs (Seam / Corrugated) OR Horizontal Tile/Slate Courses
        const isLinearProfile = roofSpec.pattern === 'seam' || roofSpec.pattern === 'corrugated' || roofSpec.pattern === 'slats';
        if (isLinearProfile) {
          const ribStep = roofSpec.pattern === 'seam' ? 0.5 : 0.34;
          const ribW = roofSpec.pattern === 'seam' ? 0.044 : 0.032;
          const ribH = roofSpec.pattern === 'seam' ? 0.052 : 0.035;
          // Front & Back slope vertical ribs (every rib runs 100% straight perpendicular to X eave)
          for (let rx = -hw + 0.5; rx <= hw - 0.45; rx += ribStep) {
            const absX = Math.abs(rx);
            let frac = 1.0;
            if (isHip && absX > ridgeHalf) {
              frac = Math.max(0.05, (hw - absX) / ewRun);
            }
            const yTop = frac * rise + 0.022;
            const zTopF = hd * (1 - frac);
            const zTopB = -hd * (1 - frac);
            addBeamBetween(new THREE.Vector3(rx, 0.022, hd - 0.02), new THREE.Vector3(rx, yTop, zTopF), ribW, ribH, ribMat);
            addBeamBetween(new THREE.Vector3(rx, 0.022, -hd + 0.02), new THREE.Vector3(rx, yTop, zTopB), ribW, ribH, ribMat);
          }
          // East & West hip wing ribs (100% straight perpendicular to Z eaves)
          if (isHip) {
            for (let rz = -hd + 0.5; rz <= hd - 0.45; rz += ribStep) {
              const fracZ = Math.max(0.05, (hd - Math.abs(rz)) / hd);
              const yTop = fracZ * rise + 0.022;
              const xTopE = hw - fracZ * ewRun;
              const xTopW = -hw + fracZ * ewRun;
              addBeamBetween(new THREE.Vector3(hw - 0.02, 0.022, rz), new THREE.Vector3(xTopE, yTop, rz), ribW, ribH, ribMat);
              addBeamBetween(new THREE.Vector3(-hw + 0.02, 0.022, rz), new THREE.Vector3(xTopW, yTop, rz), ribW, ribH, ribMat);
            }
          }
        } else {
          // Stepped 3D horizontal tile / slate / shingle courses
          const courseCount = 7;
          for (let ci = 1; ci < courseCount; ci++) {
            const frac = ci / courseCount;
            const cy = frac * rise + 0.022;
            const czSlope = hd * (1 - frac);
            const cHalfW = ridgeHalf + (isHip ? ewRun * (1 - frac) : 0);
            if (cHalfW > 0.25) {
              addBeamBetween(new THREE.Vector3(-cHalfW + 0.05, cy, czSlope), new THREE.Vector3(cHalfW - 0.05, cy, czSlope), 0.048, 0.042, ribMat);
              addBeamBetween(new THREE.Vector3(-cHalfW + 0.05, cy, -czSlope), new THREE.Vector3(cHalfW - 0.05, cy, -czSlope), 0.048, 0.042, ribMat);
            }
            if (isHip) {
              const cxSlope = hw - frac * ewRun;
              const cHalfD = hd * (1 - frac);
              if (cHalfD > 0.25) {
                addBeamBetween(new THREE.Vector3(cxSlope, cy, -cHalfD + 0.05), new THREE.Vector3(cxSlope, cy, cHalfD - 0.05), 0.048, 0.042, ribMat);
                addBeamBetween(new THREE.Vector3(-cxSlope, cy, -cHalfD + 0.05), new THREE.Vector3(-cxSlope, cy, cHalfD - 0.05), 0.048, 0.042, ribMat);
              }
            }
          }
        }
      }

      // 3D Perimeter Eave Gutters, Swan-Neck Downpipes (RWP), First-Flush Diverter & Rainwater Collection / Redirect System
      if (drainage.gutterEnabled && ground) {
        const gutterColor = gutterMeta.colorHex;
        const isMetallicGutter = drainage.gutterProfile === 'k_style_alu' || drainage.gutterProfile === 'copper_half_round';
        const gutterMat = new THREE.MeshStandardMaterial({
          color: isClay ? 0x94a3b8 : gutterColor,
          roughness: isMetallicGutter ? 0.34 : 0.45,
          metalness: isMetallicGutter ? 0.65 : 0.12,
          transparent: isXray,
          opacity: isXray ? 0.45 : 1,
          wireframe: isBlueprint,
        });
        const gutterWaterMat = new THREE.MeshStandardMaterial({
          color: 0x0c4a6e,
          roughness: 0.2,
          metalness: 0.1,
        });
        const rType = activeProject.roof.type;
        const gOff = 0.09; // overhang outer trough offset from fascia
        const gY = -0.10;
        const gh = 0.095;
        const gw = 0.125;

        const addGutterRun = (x1: number, z1: number, x2: number, z2: number) => {
          const dx = x2 - x1;
          const dz = z2 - z1;
          const len = Math.hypot(dx, dz);
          if (len < 0.2) return;
          const ang = Math.atan2(dx, dz);
          const midX = (x1 + x2) / 2;
          const midZ = (z1 + z2) / 2;

          // U-shaped 3D Gutter Trough (bottom + outer wall + inner wall + dark channel interior)
          const bot = new THREE.Mesh(new THREE.BoxGeometry(gw, 0.022, len), gutterMat);
          bot.position.set(midX, gY - gh / 2, midZ);
          bot.rotation.y = ang;
          const outerW = new THREE.Mesh(new THREE.BoxGeometry(0.022, gh, len), gutterMat);
          const nx = Math.cos(ang);
          const nz = -Math.sin(ang);
          outerW.position.set(midX + nx * (gw / 2 - 0.011), gY, midZ + nz * (gw / 2 - 0.011));
          outerW.rotation.y = ang;
          const innerW = new THREE.Mesh(new THREE.BoxGeometry(0.022, gh, len), gutterMat);
          innerW.position.set(midX - nx * (gw / 2 - 0.011), gY, midZ - nz * (gw / 2 - 0.011));
          innerW.rotation.y = ang;
          const troughFill = new THREE.Mesh(new THREE.BoxGeometry(gw - 0.045, 0.025, len - 0.04), gutterWaterMat);
          troughFill.position.set(midX, gY - 0.015, midZ);
          troughFill.rotation.y = ang;
          roofGroup.add(bot, outerW, innerW, troughFill);

          // Gutter Hanger Brackets every 1.4m
          const bCount = Math.max(2, Math.floor(len / 1.4));
          for (let bi = 0; bi <= bCount; bi++) {
            const t = bi / bCount;
            const bx = x1 + dx * t;
            const bz = z1 + dz * t;
            const bracket = new THREE.Mesh(new THREE.BoxGeometry(gw + 0.03, 0.018, 0.03), fasciaMat);
            bracket.position.set(bx, gY - gh / 2 - 0.01, bz);
            bracket.rotation.y = ang;
            roofGroup.add(bracket);
          }
        };

        // Add gutters along eaves per roof geometry
        addGutterRun(-hw - gOff, hd + gOff, hw + gOff, hd + gOff); // South / Front eave
        if (rType === 'hip' || rType === 'flat' || rType === 'gable') {
          addGutterRun(hw + gOff, -hd - gOff, -hw - gOff, -hd - gOff); // North / Back eave
        }
        if (rType === 'hip' || rType === 'flat') {
          addGutterRun(hw + gOff, hd + gOff, hw + gOff, -hd - gOff); // East eave
          addGutterRun(-hw - gOff, -hd - gOff, -hw - gOff, hd + gOff); // West eave
        }

        // Compute RWP Downpipe coordinates (matching building corners + mid-eave if 6 or 8 pipes)
        const baseY = ground.elevation + 0.06;
        const rwpTopLocalY = gY - 0.05;
        const swanDrop = 0.28;
        const totalBuildingH = eaveY - baseY;
        const cornerCandidates: { gx: number; gz: number; wx: number; wz: number }[] = [
          { gx: hw + gOff, gz: -hd - gOff, wx: rBB.maxX + 0.06, wz: rBB.minY - 0.06 }, // NE (primary collector)
          { gx: -hw - gOff, gz: hd + gOff, wx: rBB.minX - 0.06, wz: rBB.maxY + 0.06 }, // SW
          { gx: hw + gOff, gz: hd + gOff, wx: rBB.maxX + 0.06, wz: rBB.maxY + 0.06 }, // SE
          { gx: -hw - gOff, gz: -hd - gOff, wx: rBB.minX - 0.06, wz: rBB.minY - 0.06 }, // NW
          { gx: 0, gz: hd + gOff, wx: (rBB.minX + rBB.maxX) / 2, wz: rBB.maxY + 0.06 }, // South Mid
          { gx: 0, gz: -hd - gOff, wx: (rBB.minX + rBB.maxX) / 2, wz: rBB.minY - 0.06 }, // North Mid
          { gx: hw + gOff, gz: 0, wx: rBB.maxX + 0.06, wz: (rBB.minY + rBB.maxY) / 2 }, // East Mid
          { gx: -hw - gOff, gz: 0, wx: rBB.minX - 0.06, wz: (rBB.minY + rBB.maxY) / 2 }, // West Mid
        ];
        const activeDownpipes = cornerCandidates.slice(0, Math.min(8, Math.max(2, drainage.downpipeCount)));

        activeDownpipes.forEach((dp, idx) => {
          const gWorld = new THREE.Vector3(cx + dp.gx, eaveY + rwpTopLocalY, cz + dp.gz);
          const neckTop = new THREE.Vector3(cx + dp.gx, eaveY + rwpTopLocalY - 0.1, cz + dp.gz);
          const wallTop = new THREE.Vector3(dp.wx, eaveY + rwpTopLocalY - swanDrop, dp.wz);
          const wallBot = new THREE.Vector3(dp.wx, baseY + 0.08, dp.wz);

          // Hopper outlet box
          const hopper = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.14, 0.16), gutterMat);
          hopper.position.copy(gWorld);
          group.add(hopper);

          // Swan-neck offset + vertical downpipe stack
          const pipeCurve = new THREE.CatmullRomCurve3([gWorld, neckTop, wallTop, wallBot]);
          const rwpPipe = new THREE.Mesh(new THREE.TubeGeometry(pipeCurve, 18, 0.048, 8, false), gutterMat);
          rwpPipe.castShadow = true;
          group.add(rwpPipe);

          // Pipe wall brackets every ~1.2m
          const clampSteps = Math.max(2, Math.floor(totalBuildingH / 1.25));
          for (let ci = 1; ci < clampSteps; ci++) {
            const cyClamp = baseY + 0.25 + ((totalBuildingH - 0.65) * ci) / clampSteps;
            const clamp = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.03, 0.13), fasciaMat);
            clamp.position.set(dp.wx, cyClamp, dp.wz);
            group.add(clamp);
          }

          // First-Flush Diverter standpipe on the NE primary downpipe (idx === 0)
          if (idx === 0 && drainage.firstFlushDiverter) {
            const ffPipe = new THREE.Mesh(new THREE.CylinderGeometry(0.068, 0.068, 1.35, 10), gutterMat);
            ffPipe.position.set(dp.wx + 0.16, baseY + 0.92, dp.wz);
            ffPipe.castShadow = true;
            const ffTee = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.09, 0.1), gutterMat);
            ffTee.position.set(dp.wx + 0.08, baseY + 1.56, dp.wz);
            const ffCap = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.06, 10), fasciaMat);
            ffCap.position.set(dp.wx + 0.16, baseY + 0.24, dp.wz);
            group.add(ffPipe, ffTee, ffCap);
          }
        });

        // 3D Rainwater Collection / Redirection Destination Station (East/NE Utility Yard)
        const destX = rBB.maxX + 1.35;
        const destZ = rBB.minY + 1.25;
        const collectorMat = new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.4, metalness: 0.2 });

        // Underground/Grade Collector Header from NE & SE downpipes to destination
        if (activeDownpipes[0]) {
          const nePipe = activeDownpipes[0];
          const runCurve = new THREE.CatmullRomCurve3([
            new THREE.Vector3(nePipe.wx, baseY + 0.15, nePipe.wz),
            new THREE.Vector3((nePipe.wx + destX) / 2, baseY + 0.25, nePipe.wz + 0.4),
            new THREE.Vector3(destX, baseY + (drainage.waterCollectionMode === 'harvesting_tank' ? 1.55 : 0.08), destZ),
          ]);
          group.add(new THREE.Mesh(new THREE.TubeGeometry(runCurve, 16, 0.042, 8, false), gutterMat));
        }

        if (drainage.waterCollectionMode === 'harvesting_tank') {
          const volFactor = Math.cbrt(drainage.harvestingTankLiters / 3500);
          const tankR = 0.68 * volFactor;
          const tankH = 1.85 * volFactor;
          // Concrete plinth pad
          const plinth = new THREE.Mesh(new THREE.BoxGeometry(tankR * 2.5, 0.12, tankR * 2.5), new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.9 }));
          plinth.position.set(destX, baseY + 0.01, destZ);
          plinth.receiveShadow = true;
          // Ribbed Blue HDPE Rainwater Harvesting Tank
          const tankBody = new THREE.Mesh(
            new THREE.CylinderGeometry(tankR, tankR, tankH, 22),
            new THREE.MeshStandardMaterial({ color: 0x0369a1, roughness: 0.42, metalness: 0.08 })
          );
          tankBody.position.set(destX, baseY + 0.07 + tankH / 2, destZ);
          tankBody.castShadow = true;
          tankBody.receiveShadow = true;
          // Structural horizontal tank ribs + inspection hatch + UV pump box
          for (let ri = 0.25; ri <= 0.78; ri += 0.26) {
            const ring = new THREE.Mesh(
              new THREE.TorusGeometry(tankR + 0.015, 0.024, 8, 24),
              new THREE.MeshStandardMaterial({ color: 0x075985, roughness: 0.35 })
            );
            ring.rotation.x = Math.PI / 2;
            ring.position.set(destX, baseY + 0.07 + tankH * ri, destZ);
            group.add(ring);
          }
          const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.26, 0.08, 14), fasciaMat);
          lid.position.set(destX, baseY + 0.09 + tankH, destZ);
          const pumpBox = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.32, 0.28), collectorMat);
          pumpBox.position.set(destX, baseY + 0.22, destZ + tankR + 0.2);
          group.add(plinth, tankBody, lid, pumpBox);
        } else if (drainage.waterCollectionMode === 'underground_cistern') {
          const slab = new THREE.Mesh(
            new THREE.BoxGeometry(2.2, 0.1, 1.5),
            new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.85 })
          );
          slab.position.set(destX + 0.2, baseY + 0.0, destZ);
          slab.receiveShadow = true;
          const hatch1 = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.08, 16), fasciaMat);
          hatch1.position.set(destX - 0.25, baseY + 0.06, destZ);
          const hatch2 = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.08, 16), collectorMat);
          hatch2.position.set(destX + 0.65, baseY + 0.06, destZ);
          const ventPipe = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.65, 8), fasciaMat);
          ventPipe.position.set(destX + 0.95, baseY + 0.32, destZ - 0.4);
          group.add(slab, hatch1, hatch2, ventPipe);
        } else if (drainage.waterCollectionMode === 'soakaway_pit') {
          const curb = new THREE.Mesh(
            new THREE.BoxGeometry(2.1, 0.14, 1.5),
            new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.9 })
          );
          curb.position.set(destX + 0.2, baseY + 0.02, destZ);
          const gravelBed = new THREE.Mesh(
            new THREE.BoxGeometry(1.85, 0.16, 1.25),
            new THREE.MeshStandardMaterial({ color: 0xd6d3d1, roughness: 1.0 })
          );
          gravelBed.position.set(destX + 0.2, baseY + 0.03, destZ);
          const grate = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.06, 0.55), collectorMat);
          grate.position.set(destX + 0.2, baseY + 0.11, destZ);
          group.add(curb, gravelBed, grate);
        } else if (drainage.waterCollectionMode === 'municipal_storm') {
          const basin = new THREE.Mesh(
            new THREE.BoxGeometry(0.75, 0.16, 0.75),
            new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.85 })
          );
          basin.position.set(destX, baseY + 0.03, destZ);
          const stormGrate = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.04, 0.55), fasciaMat);
          stormGrate.position.set(destX, baseY + 0.12, destZ);
          const outfallPipe = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 3.2, 10), collectorMat);
          outfallPipe.rotation.x = Math.PI / 2;
          outfallPipe.position.set(destX, baseY + 0.04, destZ + 1.8);
          group.add(basin, stormGrate, outfallPipe);
        } else if (drainage.waterCollectionMode === 'garden_redirect') {
          const valveBox = new THREE.Mesh(
            new THREE.BoxGeometry(0.55, 0.1, 0.42),
            new THREE.MeshStandardMaterial({ color: 0x16a34a, roughness: 0.5 })
          );
          valveBox.position.set(destX, baseY + 0.02, destZ);
          const swaleBed = new THREE.Mesh(
            new THREE.BoxGeometry(0.85, 0.06, 3.4),
            new THREE.MeshStandardMaterial({ color: 0x22c55e, roughness: 0.9 })
          );
          swaleBed.position.set(destX + 0.2, baseY - 0.01, destZ + 1.9);
          const dripPipe = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 3.2, 8), new THREE.MeshStandardMaterial({ color: 0x15803d }));
          dripPipe.rotation.x = Math.PI / 2;
          dripPipe.position.set(destX + 0.2, baseY + 0.04, destZ + 1.9);
          group.add(valveBox, swaleBed, dripPipe);
        }
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
        const solarLayout = computeSolarArrayLayout(activeProject);
        for (const p of solarLayout.panels) {
          const pMesh = new THREE.Mesh(new THREE.BoxGeometry(p.width, 0.045, p.depth), pvMat);
          pMesh.position.set(p.x, p.z3d, p.y);
          pMesh.rotation.set(p.rotX, p.rotY, p.rotZ);
          pMesh.castShadow = true;
          pMesh.userData = { draggableKind: 'solar_panel', panelIndex: p.index };
          group.add(pMesh);
          solarMeshesRef.current.push(pMesh);

          if (selectedPanelIndex === p.index || (showSolarPad && solarMoveMode === 'array')) {
            const selEdges = new THREE.EdgesGeometry(pMesh.geometry);
            const selColor = selectedPanelIndex === p.index && solarMoveMode === 'panel' ? 0xf59e0b : 0x22d3ee;
            const selLine = new THREE.LineSegments(selEdges, new THREE.LineBasicMaterial({ color: selColor }));
            selLine.position.copy(pMesh.position);
            selLine.rotation.copy(pMesh.rotation);
            selLine.scale.set(1.03, 1.4, 1.03);
            group.add(selLine);
          }
        }
      }
    }

    return () => {
      createdTextures.forEach((t) => t.dispose());
    };
  }, [
    activeProject,
    renderMode,
    cutawayHeight,
    showRoof,
    lastLevel,
    isLight,
    solar.enabled,
    solar.panelCount,
    solar.batteryKWh,
    design,
    selectedPanelIndex,
    showSolarPad,
    solarMoveMode,
    showWiring3D,
    wiringLayer3D,
    selectedEquipKind,
    selectedWaypointKey,
  ]);

  const mutateProject = (updater: (next: BuildingProject) => void) => {
    if (!onUpdateProject) return;
    const next = structuredClone(project);
    updater(next);
    onUpdateProject(next);
  };

  return (
    <div className="relative w-full h-full bg-slate-950 overflow-hidden">
      <div ref={containerRef} className="w-full h-full" />

      {/* Top Overlay Toolbar: Render Style + Quick Switchers (Left) & Camera/Roof (Right) */}
      <div className="absolute top-3 left-3 right-3 z-20 flex flex-wrap items-center justify-between gap-2 pointer-events-none">
        <div className="pointer-events-auto flex flex-wrap items-center gap-1 bg-slate-900/90 backdrop-blur border border-slate-700/80 rounded-lg p-1 text-[11px] shadow-sm">
          <div className="flex items-center gap-1 pl-1 pr-0.5">
            <Box className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
            <select
              aria-label="3D Render Style"
              value={renderMode}
              onChange={(e) => setRenderMode(e.target.value as Render3DMode)}
              className="bg-slate-950 border border-slate-700 rounded-md px-1.5 py-1 text-[11px] font-medium text-slate-200 focus:outline-none focus:border-cyan-500 cursor-pointer"
            >
              <option value="pbr">PBR Studio Render</option>
              <option value="clay">White Architectural Clay</option>
              <option value="xray">Structural &amp; MEP X-Ray</option>
              <option value="blueprint">Blueprint Wireframe</option>
            </select>
          </div>
          {onUpdateProject && (
            <button
              onClick={() => {
                setShowStudioDrawer((s) => !s);
                setShowSolarPad(false);
                setShowWiring3D(false);
              }}
              className={`flex items-center gap-1 px-2 py-1 rounded-md font-medium transition whitespace-nowrap ${
                showStudioDrawer ? 'bg-amber-600 text-white' : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
              }`}
            >
              <Palette className="w-3.5 h-3.5" /> Materials &amp; Solar
            </button>
          )}
          {onUpdateProject && solar.enabled && (
            <button
              onClick={() => {
                setShowSolarPad((s) => !s);
                setShowStudioDrawer(false);
                setShowWiring3D(false);
              }}
              className={`flex items-center gap-1 px-2 py-1 rounded-md font-medium transition whitespace-nowrap ${
                showSolarPad ? 'bg-cyan-600 text-white' : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
              }`}
              title="Move, Rotate & Snap Rooftop Solar PV Array"
            >
              <Move className="w-3.5 h-3.5" /> Solar Placement
            </button>
          )}
          {onUpdateProject && (
            <button
              type="button"
              onClick={() => {
                setShowWiring3D((s) => !s);
                setShowSolarPad(false);
                setShowStudioDrawer(false);
              }}
              className={`flex items-center gap-1 px-2 py-1 rounded-md font-medium transition whitespace-nowrap ${
                showWiring3D ? 'bg-amber-600 text-white font-semibold' : 'bg-slate-800 text-amber-300 hover:bg-slate-700'
              }`}
              title="View 3D Electrical Wiring Conduits & Relocate MDB, Inverter & Utility Meter"
            >
              <Zap className="w-3.5 h-3.5" /> 3D Wiring Plan
            </button>
          )}
        </div>

        {/* Camera Presets, Full Explore Toggle & Roof Toggle */}
        <div className="pointer-events-auto flex items-center gap-1 bg-slate-900/90 backdrop-blur border border-slate-700/80 rounded-lg p-1 text-[11px] shadow-sm">
          <div className="flex items-center gap-1 pl-1">
            <Camera className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <select
              aria-label="3D Camera View"
              value={cameraPreset}
              onChange={(e) => {
                setExploreMode(false);
                setCameraPreset(e.target.value as 'iso' | 'top' | 'front');
              }}
              className="bg-slate-950 border border-slate-700 rounded-md px-1.5 py-1 text-[11px] font-medium text-slate-200 focus:outline-none focus:border-cyan-500 cursor-pointer"
            >
              <option value="iso">View: Isometric 3D</option>
              <option value="top">View: Top Plan Ortho</option>
              <option value="front">View: Front Elevation</option>
            </select>
          </div>
          <button
            onClick={() => setExploreMode((v) => !v)}
            className={`flex items-center gap-1 px-2 py-1 rounded-md font-semibold transition whitespace-nowrap ${
              exploreMode ? 'bg-cyan-600 text-white' : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
            }`}
            title="First-Person 3D Walkthrough & Room Explore (WASD / Drag to Look)"
          >
            <Footprints className="w-3.5 h-3.5" /> Explore / Walk
          </button>
          <span className="text-slate-600">|</span>
          <button
            onClick={() => setShowRoof((v) => !v)}
            className={`px-2 py-1 rounded-md font-medium whitespace-nowrap ${
              showRoof ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40' : 'bg-slate-800 text-slate-400'
            }`}
          >
            {showRoof ? 'Roof: ON' : 'Roof: OFF'}
          </button>
        </div>
      </div>

      {/* Collapsible Floating 3D Wiring Plan & Equipment Relocation Pad */}
      {showWiring3D && onUpdateProject && (() => {
        const gLvl = activeProject.levels[0];
        const gBB2 = gLvl ? levelBoundingBox(gLvl) : { minX: 0, maxX: 12, minY: 0, maxY: 10, width: 12, depth: 10 };
        const core = gLvl ? getCoreElectricalNodes(gLvl) : null;
        const activeNode =
          core &&
          (selectedEquipKind === 'mdb'
            ? core.mdb
            : selectedEquipKind === 'utility_meter'
            ? core.meter
            : selectedEquipKind === 'solar_inv'
            ? core.inverter
            : core.bess);
        const nudgeEquip = (dx: number, dy: number) => {
          mutateProject((n) => {
            const lvl0 = n.levels[0];
            if (!lvl0) return;
            const c = getCoreElectricalNodes(lvl0);
            const cur =
              selectedEquipKind === 'mdb'
                ? c.mdb
                : selectedEquipKind === 'utility_meter'
                ? c.meter
                : selectedEquipKind === 'solar_inv'
                ? c.inverter
                : c.bess;
            const layout = getSolarConfig(n).enabled ? computeSolarArrayLayout(n) : null;
            relocateMEPNode(
              lvl0,
              selectedEquipKind,
              { x: Number((cur.position.x + dx).toFixed(2)), y: Number((cur.position.y + dy).toFixed(2)) },
              layout ? { x: layout.bounds.minX, y: layout.bounds.centerY } : undefined
            );
          });
        };
        const snapEquipWall = (side: 'west' | 'north' | 'east' | 'south') => {
          mutateProject((n) => {
            const lvl0 = n.levels[0];
            if (!lvl0) return;
            const slotOffset =
              selectedEquipKind === 'mdb' ? 0.55 : selectedEquipKind === 'utility_meter' ? 1.4 : selectedEquipKind === 'solar_inv' ? 2.35 : 3.15;
            const midX = (gBB2.minX + gBB2.maxX) / 2;
            const midY = (gBB2.minY + gBB2.maxY) / 2;
            const targetPos =
              side === 'west'
                ? { x: gBB2.minX - (selectedEquipKind === 'mdb' ? -0.35 : 0.14), y: gBB2.minY + slotOffset }
                : side === 'north'
                ? { x: gBB2.minX + slotOffset, y: gBB2.minY - (selectedEquipKind === 'mdb' ? -0.35 : 0.14) }
                : side === 'east'
                ? { x: gBB2.maxX + (selectedEquipKind === 'mdb' ? -0.35 : 0.14), y: gBB2.minY + slotOffset }
                : { x: midX - 1.2 + slotOffset * 0.6, y: gBB2.maxY + (selectedEquipKind === 'mdb' ? -0.35 : 0.14) };
            const layout = getSolarConfig(n).enabled ? computeSolarArrayLayout(n) : null;
            relocateMEPNode(
              lvl0,
              selectedEquipKind,
              targetPos.x || midX ? targetPos : { x: midX, y: midY },
              layout ? { x: layout.bounds.minX, y: layout.bounds.centerY } : undefined
            );
          });
        };

        const routes3D = computePVAndEquipmentRoutes(activeProject, 0);
        const dcRouteMode: WiringRouteMode = getSolarConfig(activeProject).dcRouteMode ?? 'auto';
        const acRouteMode: WiringRouteMode = getSolarConfig(activeProject).acRouteMode ?? 'auto';
        const conduitElevOffset = getSolarConfig(activeProject).conduitElevationOffset ?? 0;

        const updateWiringConfig = (patch: Partial<ReturnType<typeof getSolarConfig>>) => {
          mutateProject((n) => {
            const cur = getSolarConfig(n);
            n.solar = { ...cur, ...patch };
          });
        };

        const resnapAllWires = () => {
          mutateProject((n) => {
            const cur = getSolarConfig(n);
            n.solar = {
              ...cur,
              dcWaypoints: undefined,
              acWaypoints: undefined,
            };
            const lvl0 = n.levels[0];
            if (lvl0) {
              const coreN = getCoreElectricalNodes(lvl0);
              const rt = computePVAndEquipmentRoutes(n, 0);
              relocateMEPNode(lvl0, coreN.inverter.id, coreN.inverter.position, rt.pvCombinerPos);
            }
          });
        };

        const routePresetOptions: [WiringRouteMode, string][] = [
          ['auto', 'Auto Wall'],
          ['north_wall', 'North Wall'],
          ['south_wall', 'South Wall'],
          ['west_wall', 'West Wall'],
          ['east_wall', 'East Wall'],
          ['corridor', 'Corridor'],
        ];

        return (
          <div className="absolute top-14 left-3 z-20 w-[336px] max-h-[82vh] overflow-y-auto bg-slate-900/95 backdrop-blur border border-slate-700 rounded-xl p-3 shadow-xl text-xs space-y-2.5">
            <div className="flex items-center justify-between font-mono text-[11px] font-bold text-amber-300">
              <span className="flex items-center gap-1.5">
                <Zap className="w-3.5 h-3.5 text-amber-400" /> 3D WIRING &amp; EQUIPMENT
              </span>
              <button onClick={() => setShowWiring3D(false)} className="text-slate-400 hover:text-white">
                Close
              </button>
            </div>
            <div className="text-[10px] text-slate-400">
              Drag any equipment cabinet or <span className="font-mono text-rose-300">JB</span> junction box in 3D, or pick wall/corridor routes below. Toggle <span className="font-mono text-slate-200">Roof: OFF</span> to inspect ceiling voids.
            </div>
            <div className="space-y-1">
              <div className="text-[10px] font-mono text-slate-400 uppercase">3D Wiring Layers</div>
              <div className="flex flex-wrap gap-1">
                {(
                  [
                    ['all', 'All'],
                    ['feeders', 'Solar/Main'],
                    ['lighting', 'Lighting'],
                    ['power', 'Sockets'],
                    ['hvac', 'HVAC'],
                  ] as const
                ).map(([layerKey, layerLbl]) => (
                  <button
                    key={layerKey}
                    type="button"
                    onClick={() => setWiringLayer3D(layerKey)}
                    className={`px-2 py-0.5 rounded text-[10px] font-medium border transition ${
                      wiringLayer3D === layerKey
                        ? 'bg-cyan-600 text-white border-cyan-500 font-semibold'
                        : 'bg-slate-950 text-slate-300 border-slate-800 hover:bg-slate-800'
                    }`}
                  >
                    {layerLbl}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5 pt-1 border-t border-slate-800">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono text-slate-400 uppercase">Conduit Path Routing</span>
                <button
                  type="button"
                  onClick={resnapAllWires}
                  className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-600 text-[10px] font-mono text-amber-300"
                  title="Clear manual bend offsets and snap all routes back to roof slopes & walls"
                >
                  Re-Snap Wires
                </button>
              </div>
              {solar.enabled && (
                <label className="block">
                  <div className="flex justify-between text-[10px] text-rose-300 mb-0.5">
                    <span>PV → INV Conduit Route</span>
                    <span className="font-mono">{routes3D.pvToInverter.lengthM}m</span>
                  </div>
                  <select
                    value={dcRouteMode}
                    onChange={(e) =>
                      updateWiringConfig({ dcRouteMode: e.target.value as WiringRouteMode, dcWaypoints: undefined })
                    }
                    className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-[11px] text-slate-200"
                  >
                    {routePresetOptions.map(([val, lbl]) => (
                      <option key={val} value={val}>
                        {lbl}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="block">
                <div className="flex justify-between text-[10px] text-emerald-300 mb-0.5">
                  <span>INV → MDB Feeder Route</span>
                  <span className="font-mono">{routes3D.inverterToMdb.lengthM}m</span>
                </div>
                <select
                  value={acRouteMode}
                  onChange={(e) =>
                    updateWiringConfig({ acRouteMode: e.target.value as WiringRouteMode, acWaypoints: undefined })
                  }
                  className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-[11px] text-slate-200"
                >
                  {routePresetOptions.map(([val, lbl]) => (
                    <option key={val} value={val}>
                      {lbl}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <div className="flex justify-between text-[10px] text-slate-400">
                  <span>Conduit Wall Height Offset</span>
                  <span className="font-mono text-slate-200">
                    {conduitElevOffset >= 0 ? '+' : ''}
                    {conduitElevOffset.toFixed(2)}m
                  </span>
                </div>
                <input
                  type="range"
                  min={-0.5}
                  max={0.2}
                  step={0.05}
                  value={conduitElevOffset}
                  onChange={(e) => updateWiringConfig({ conduitElevationOffset: parseFloat(e.target.value) })}
                  className="w-full accent-amber-500"
                />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-1 pt-1 border-t border-slate-800">
              {(
                [
                  ['mdb', 'Main DB (MDB)'],
                  ['utility_meter', 'Utility Meter'],
                  ...(solar.enabled ? [['solar_inv', 'Solar Inverter'], ['solar_bess', 'BESS Battery']] : []),
                ] as ['mdb' | 'utility_meter' | 'solar_inv' | 'solar_bess', string][]
              ).map(([k, lbl]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setSelectedEquipKind(k)}
                  className={`px-2 py-1 rounded text-[11px] font-medium border transition ${
                    selectedEquipKind === k
                      ? 'bg-amber-600 text-white border-amber-500 font-semibold'
                      : 'bg-slate-950 text-slate-300 border-slate-800 hover:bg-slate-800'
                  }`}
                >
                  {lbl}
                </button>
              ))}
            </div>
            {activeNode && (
              <div className="flex items-center justify-between bg-slate-950/70 border border-slate-800 rounded px-2.5 py-1.5 font-mono text-[11px] text-cyan-300">
                <span>{activeNode.label}</span>
                <span>
                  X: {activeNode.position.x.toFixed(2)}m · Y: {activeNode.position.y.toFixed(2)}m
                </span>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2 items-center">
              <div>
                <div className="text-[10px] text-slate-400 mb-1">Nudge (0.25m)</div>
                <div className="grid grid-cols-3 gap-1 w-24">
                  <span />
                  <button
                    type="button"
                    aria-label="Nudge Equipment North"
                    onClick={() => nudgeEquip(0, -0.25)}
                    className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center justify-center"
                  >
                    <ArrowUp className="w-3 h-3" />
                  </button>
                  <span />
                  <button
                    type="button"
                    aria-label="Nudge Equipment West"
                    onClick={() => nudgeEquip(-0.25, 0)}
                    className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center justify-center"
                  >
                    <ArrowLeft className="w-3 h-3" />
                  </button>
                  <span className="p-1 text-[9px] text-center font-mono text-slate-500">XY</span>
                  <button
                    type="button"
                    aria-label="Nudge Equipment East"
                    onClick={() => nudgeEquip(0.25, 0)}
                    className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center justify-center"
                  >
                    <ArrowRight className="w-3 h-3" />
                  </button>
                  <span />
                  <button
                    type="button"
                    aria-label="Nudge Equipment South"
                    onClick={() => nudgeEquip(0, 0.25)}
                    className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center justify-center"
                  >
                    <ArrowDown className="w-3 h-3" />
                  </button>
                  <span />
                </div>
              </div>
              <div className="space-y-1">
                <div className="text-[10px] text-slate-400">Snap to Wall</div>
                <div className="grid grid-cols-2 gap-1">
                  {(['west', 'north', 'east', 'south'] as const).map((side) => (
                    <button
                      key={side}
                      type="button"
                      onClick={() => snapEquipWall(side)}
                      className="px-1.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[10px] capitalize"
                    >
                      {side}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="pt-1.5 border-t border-slate-800 grid grid-cols-2 gap-1 text-[10px] font-mono">
              <div className="flex items-center gap-1.5 text-sky-300">
                <span className="w-2.5 h-2 rounded-sm bg-[#0284c7]" /> Grid SWA ({routes3D.meterToMdb.lengthM}m)
              </div>
              <div className="flex items-center gap-1.5 text-cyan-300">
                <span className="w-2.5 h-2 rounded-sm bg-[#06b6d4]" /> Sub-Main → Room DBs
              </div>
              <div className="flex items-center gap-1.5 text-rose-300">
                <span className="w-2.5 h-2 rounded-sm bg-[#e11d48]" /> PV DC ({routes3D.pvToInverter.lengthM}m)
              </div>
              <div className="flex items-center gap-1.5 text-emerald-300">
                <span className="w-2.5 h-2 rounded-sm bg-[#16a34a]" /> INV AC ({routes3D.inverterToMdb.lengthM}m)
              </div>
              <div className="flex items-center gap-1.5 text-amber-300">
                <span className="w-2.5 h-2 rounded-sm bg-[#facc15]" /> Lighting &amp; Wall Drops
              </div>
              <div className="flex items-center gap-1.5 text-orange-300">
                <span className="w-2.5 h-2 rounded-sm bg-[#f97316]" /> Power Socket Wall Runs
              </div>
              <div className="flex items-center gap-1.5 text-purple-300">
                <span className="w-2.5 h-2 rounded-sm bg-[#a855f7]" /> BESS / HVAC Feed
              </div>
            </div>
          </div>
        );
      })()}

      {/* Collapsible Floating 3D Solar Roof Placement Pad */}
      {showSolarPad && solar.enabled && onUpdateProject && (
        <div className="absolute top-14 left-3 z-20 w-80 bg-slate-900/95 backdrop-blur border border-slate-700 rounded-xl p-3 shadow-xl text-xs space-y-2.5">
          <div className="flex items-center justify-between font-mono text-[11px] font-bold text-cyan-300">
            <span className="flex items-center gap-1.5">
              <Sun className="w-3.5 h-3.5 text-amber-400" /> SOLAR ROOF PLACEMENT
            </span>
            <button onClick={() => setShowSolarPad(false)} className="text-slate-400 hover:text-white">
              Close
            </button>
          </div>
          <div className="text-[10px] text-slate-400">
            Drag panels directly on 3D roof · Hold <span className="font-mono text-slate-200">Alt</span> for single panel
          </div>

          <div className="grid grid-cols-2 gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
            <button
              onClick={() => setSolarMoveMode('array')}
              className={`px-2 py-1 rounded text-[11px] font-medium transition ${
                solarMoveMode === 'array' ? 'bg-cyan-600 text-white' : 'text-slate-300 hover:bg-slate-800'
              }`}
            >
              Entire Array
            </button>
            <button
              onClick={() => {
                setSolarMoveMode('panel');
                if (selectedPanelIndex === null) setSelectedPanelIndex(0);
              }}
              className={`px-2 py-1 rounded text-[11px] font-medium transition ${
                solarMoveMode === 'panel' ? 'bg-amber-600 text-white' : 'text-slate-300 hover:bg-slate-800'
              }`}
            >
              Single {selectedPanelIndex !== null ? `#${selectedPanelIndex + 1}` : 'Panel'}
            </button>
          </div>

          <div>
            <div className="text-[10px] text-slate-400 mb-1">Roof Slope Face</div>
            <div className="grid grid-cols-5 gap-1">
              {(
                [
                  ['south', 'South'],
                  ['north', 'North'],
                  ['east', 'East'],
                  ['west', 'West'],
                  ['flat_center', 'Center'],
                ] as [SolarRoofFace, string][]
              ).map(([faceId, label]) => (
                <button
                  key={faceId}
                  onClick={() =>
                    mutateProject((n) => {
                      n.solar = { ...getSolarConfig(n), roofFace: faceId, offsetX: 0, offsetY: 0 };
                    })
                  }
                  className={`py-1 rounded text-[10px] font-medium border transition ${
                    (solar.roofFace ?? 'south') === faceId
                      ? 'bg-cyan-600 text-white border-cyan-500'
                      : 'bg-slate-950 text-slate-300 border-slate-700 hover:bg-slate-800'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 items-center">
            <div>
              <div className="text-[10px] text-slate-400 mb-1">Nudge (0.25m)</div>
              <div className="grid grid-cols-3 gap-1 w-24">
                <span />
                <button
                  aria-label="Nudge Solar North"
                  onClick={() =>
                    mutateProject((n) => {
                      const s = getSolarConfig(n);
                      if (solarMoveMode === 'panel' && selectedPanelIndex !== null) {
                        const prev = s.panelOffsets?.[selectedPanelIndex] ?? { x: 0, y: 0 };
                        n.solar = {
                          ...s,
                          panelOffsets: {
                            ...(s.panelOffsets ?? {}),
                            [selectedPanelIndex]: { x: prev.x, y: Number((prev.y - 0.25).toFixed(2)) },
                          },
                        };
                      } else {
                        n.solar = { ...s, offsetY: Number(((s.offsetY ?? 0) - 0.25).toFixed(2)) };
                      }
                    })
                  }
                  className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center justify-center"
                  title="Move North (-Y)"
                >
                  <ArrowUp className="w-3 h-3" />
                </button>
                <span />
                <button
                  aria-label="Nudge Solar West"
                  onClick={() =>
                    mutateProject((n) => {
                      const s = getSolarConfig(n);
                      if (solarMoveMode === 'panel' && selectedPanelIndex !== null) {
                        const prev = s.panelOffsets?.[selectedPanelIndex] ?? { x: 0, y: 0 };
                        n.solar = {
                          ...s,
                          panelOffsets: {
                            ...(s.panelOffsets ?? {}),
                            [selectedPanelIndex]: { x: Number((prev.x - 0.25).toFixed(2)), y: prev.y },
                          },
                        };
                      } else {
                        n.solar = { ...s, offsetX: Number(((s.offsetX ?? 0) - 0.25).toFixed(2)) };
                      }
                    })
                  }
                  className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center justify-center"
                  title="Move West (-X)"
                >
                  <ArrowLeft className="w-3 h-3" />
                </button>
                <button
                  aria-label="Nudge Solar South"
                  onClick={() =>
                    mutateProject((n) => {
                      const s = getSolarConfig(n);
                      if (solarMoveMode === 'panel' && selectedPanelIndex !== null) {
                        const prev = s.panelOffsets?.[selectedPanelIndex] ?? { x: 0, y: 0 };
                        n.solar = {
                          ...s,
                          panelOffsets: {
                            ...(s.panelOffsets ?? {}),
                            [selectedPanelIndex]: { x: prev.x, y: Number((prev.y + 0.25).toFixed(2)) },
                          },
                        };
                      } else {
                        n.solar = { ...s, offsetY: Number(((s.offsetY ?? 0) + 0.25).toFixed(2)) };
                      }
                    })
                  }
                  className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center justify-center"
                  title="Move South (+Y)"
                >
                  <ArrowDown className="w-3 h-3" />
                </button>
                <button
                  aria-label="Nudge Solar East"
                  onClick={() =>
                    mutateProject((n) => {
                      const s = getSolarConfig(n);
                      if (solarMoveMode === 'panel' && selectedPanelIndex !== null) {
                        const prev = s.panelOffsets?.[selectedPanelIndex] ?? { x: 0, y: 0 };
                        n.solar = {
                          ...s,
                          panelOffsets: {
                            ...(s.panelOffsets ?? {}),
                            [selectedPanelIndex]: { x: Number((prev.x + 0.25).toFixed(2)), y: prev.y },
                          },
                        };
                      } else {
                        n.solar = { ...s, offsetX: Number(((s.offsetX ?? 0) + 0.25).toFixed(2)) };
                      }
                    })
                  }
                  className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center justify-center"
                  title="Move East (+X)"
                >
                  <ArrowRight className="w-3 h-3" />
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="block">
                <span className="text-[10px] text-slate-400">Array Columns</span>
                <select
                  value={solar.columns ?? 0}
                  onChange={(e) =>
                    mutateProject((n) => {
                      n.solar = { ...getSolarConfig(n), columns: Number(e.target.value) };
                    })
                  }
                  className="w-full mt-0.5 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-[11px]"
                >
                  <option value={0}>Auto-Fit</option>
                  {[2, 3, 4, 5, 6, 7, 8].map((c) => (
                    <option key={c} value={c}>
                      {c} Cols
                    </option>
                  ))}
                </select>
              </label>
              <button
                onClick={() =>
                  mutateProject((n) => {
                    const s = getSolarConfig(n);
                    n.solar = { ...s, rotationDeg: ((s.rotationDeg ?? 0) + 90) % 360 };
                  })
                }
                className="w-full px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[11px] font-medium flex items-center justify-center gap-1"
              >
                <RotateCw className="w-3 h-3" /> Rotate 90° ({solar.rotationDeg ?? 0}°)
              </button>
            </div>
          </div>

          <div className="pt-1 border-t border-slate-800 flex items-center justify-between text-[10px] font-mono text-slate-400">
            <span>
              Offset: {(solar.offsetX ?? 0).toFixed(2)}m, {(solar.offsetY ?? 0).toFixed(2)}m
            </span>
            <button
              onClick={() => {
                setSelectedPanelIndex(null);
                mutateProject((n) => {
                  n.solar = {
                    ...getSolarConfig(n),
                    offsetX: 0,
                    offsetY: 0,
                    rotationDeg: 0,
                    columns: 0,
                    panelOffsets: {},
                  };
                });
              }}
              className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-rose-300 font-sans font-medium"
            >
              Reset Placement
            </button>
          </div>
        </div>
      )}

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
          <div className="pt-1.5 border-t border-slate-800 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-slate-300 font-medium">Roof Gutters & Rainwater</span>
              <button
                onClick={() =>
                  mutateProject((n) => {
                    n.roof.gutterEnabled = !getRoofDrainageConfig(n.roof).gutterEnabled;
                  })
                }
                className={`px-2 py-0.5 rounded font-mono text-[11px] ${
                  drainageCfg.gutterEnabled ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40' : 'bg-slate-800 text-slate-400'
                }`}
              >
                {drainageCfg.gutterEnabled ? 'ON' : 'OFF'}
              </button>
            </div>
            {drainageCfg.gutterEnabled && (
              <>
                <label className="block">
                  <span className="text-[11px] text-slate-400">Gutter Profile</span>
                  <select
                    value={drainageCfg.gutterProfile}
                    onChange={(e) =>
                      mutateProject((n) => {
                        n.roof.gutterProfile = e.target.value as GutterProfile;
                      })
                    }
                    className="w-full mt-0.5 bg-slate-950 border border-slate-700 rounded px-2 py-1"
                  >
                    {(Object.keys(GUTTER_PROFILE_META) as GutterProfile[]).map((gp) => (
                      <option key={gp} value={gp}>
                        {GUTTER_PROFILE_META[gp].label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-[11px] text-slate-400">Water Collection / Redirect</span>
                  <select
                    value={drainageCfg.waterCollectionMode}
                    onChange={(e) =>
                      mutateProject((n) => {
                        n.roof.waterCollectionMode = e.target.value as WaterCollectionMode;
                      })
                    }
                    className="w-full mt-0.5 bg-slate-950 border border-slate-700 rounded px-2 py-1"
                  >
                    {(Object.keys(WATER_COLLECTION_META) as WaterCollectionMode[]).map((wm) => (
                      <option key={wm} value={wm}>
                        {WATER_COLLECTION_META[wm].shortLabel}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
          </div>
        </div>
      )}

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
