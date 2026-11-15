/**
 * Renders a small 3D picture of the building for its project card: the same scene as the
 * 3D view (rendered style, afternoon sun), framed from the south-east, saved as WebP.
 */
import * as THREE from 'three';
import type { BuildingProject } from '../../../model/types';
import { buildScene } from './buildScene';

const W = 960;
const H = 560;

export async function renderCover(model: BuildingProject): Promise<Blob | null> {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  let renderer: THREE.WebGLRenderer | null = null;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  } catch {
    return null; // no WebGL (e.g. headless): the card keeps its drawn plan
  }
  renderer.setSize(W, H, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#F4F2EC');
  const parts = buildScene(model, false);
  parts.levels.forEach((g) => scene.add(g));
  scene.add(parts.roof, parts.site);

  const box = parts.box;
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const span = Math.max(size.x, size.y, size.z);

  scene.add(new THREE.HemisphereLight('#FFFFFF', '#D9D2C3', 1.35));
  const sun = new THREE.DirectionalLight('#FFF4E2', 2.5);
  sun.position.copy(center).add(new THREE.Vector3(-0.6, 1, 0.75).normalize().multiplyScalar(span * 2));
  sun.target.position.copy(center);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -span;
  sc.right = sc.top = span;
  sc.far = span * 5;
  scene.add(sun, sun.target);

  const ground = new THREE.Mesh(new THREE.CircleGeometry(span * 4, 48), new THREE.MeshStandardMaterial({ color: '#E9E5DB', roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const camera = new THREE.PerspectiveCamera(30, W / H, 0.1, 1000);
  const dir = new THREE.Vector3(0.8, 0.42, 1).normalize();
  // Frame the footprint, not the sky: the card is wide, so width governs.
  const across = Math.max(size.x, size.z);
  const dist = (across * 0.5) / Math.tan(((camera.fov / 2) * Math.PI) / 180) / Math.min(1.4, camera.aspect) + 1;
  camera.position.copy(center).addScaledVector(dir, dist);
  camera.lookAt(center.x, center.y * 0.8, center.z);

  renderer.render(scene, camera);
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/webp', 0.85));

  // Free everything the render used.
  scene.traverse((o) => {
    if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) o.geometry.dispose();
  });
  parts.materials.forEach((m) => m.dispose());
  (ground.material as THREE.Material).dispose();
  renderer.dispose();
  renderer.forceContextLoss();
  return blob;
}

/** Render and upload; returns the new cover time, or null if it couldn't be made. */
export async function updateCover(projectId: string, model: BuildingProject): Promise<number | null> {
  const blob = await renderCover(model);
  if (!blob) return null;
  const resp = await fetch(`/api/projects/${projectId}/cover`, { method: 'PUT', headers: { 'content-type': blob.type || 'image/webp' }, body: blob });
  if (!resp.ok) return null;
  const data = (await resp.json()) as { coverAt: number };
  return data.coverAt;
}
