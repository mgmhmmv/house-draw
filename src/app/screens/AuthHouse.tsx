import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createMaldivesTropicalVilla } from '../../model/presets';
import { buildFrame, type V3 } from '../drawing/model3d/faces';

/**
 * Sign-in background: the tropical-villa template as a live wireframe, drawn from the same
 * face model as the app's drawings. It turns slowly on its own; drag to orbit, scroll to zoom.
 */
export default function AuthHouse() {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = host.current!;
    const css = getComputedStyle(document.documentElement);
    const token = (name: string, fallback: string) => {
      const v = css.getPropertyValue(name).trim();
      return v ? new THREE.Color(`rgb(${v.split(/\s+/).join(',')})`) : new THREE.Color(fallback);
    };
    const ink = token('--ink', '#1a1917');
    const ink3 = token('--ink-3', '#8a857d');
    const accent = token('--accent', '#2f55d4');
    const line = token('--line', '#e7e5e0');

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    el.appendChild(renderer.domElement);
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.touchAction = 'none';

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 500);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.enablePan = false;
    controls.minDistance = 14;
    controls.maxDistance = 90;
    controls.maxPolarAngle = Math.PI * 0.47;
    controls.autoRotate = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    controls.autoRotateSpeed = 0.6;

    // Build the house as lines: every face outline, plus window mullions and roof seams.
    const frame = buildFrame(createMaldivesTropicalVilla());
    const edges: number[] = [];
    const detail: number[] = [];
    const roofs: number[] = [];
    const push = (arr: number[], a: V3, b: V3) => arr.push(a.x, a.z, a.y, b.x, b.z, b.y);
    for (const f of frame.faces) {
      if (f.kind === 'reveal') continue;
      const target = f.kind === 'roof' || f.kind === 'solar' ? roofs : edges;
      for (const ring of [f.pts, ...(f.holes ?? [])]) for (let i = 0; i < ring.length; i++) push(target, ring[i], ring[(i + 1) % ring.length]);
      for (const [a, b] of f.lines ?? []) push(f.kind === 'roof' ? roofs : detail, a, b);
    }
    const seg = (arr: number[], color: THREE.Color, opacity: number) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
      return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity }));
    };
    const house = new THREE.Group();
    house.add(seg(edges, ink, 0.85), seg(detail, ink3, 0.55), seg(roofs, accent, 0.45));

    // Room floors as faint fills so the plan reads through the wireframe.
    for (const lvl of createMaldivesTropicalVilla().levels)
      for (const r of lvl.rooms) {
        const shape = new THREE.Shape(r.polygon.map((p) => new THREE.Vector2(p.x, p.y)));
        const m = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.05, side: THREE.DoubleSide }));
        m.rotation.x = Math.PI / 2;
        m.position.y = lvl.elevation + 0.01;
        house.add(m);
      }

    const box = new THREE.Box3().setFromObject(house);
    const center = box.getCenter(new THREE.Vector3());
    house.position.sub(new THREE.Vector3(center.x, 0, center.z));
    scene.add(house);

    const grid = new THREE.GridHelper(80, 80, line, line);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.9;
    scene.add(grid);

    const size = box.getSize(new THREE.Vector3());
    // The art pane is usually taller than wide, so step back further than a square view would.
    const d = Math.max(size.x, size.z) * 2.9;
    controls.target.set(0, size.y * 0.45, 0);
    camera.position.set(d * 0.72, d * 0.55, d * 0.82);

    let resumeTimer = 0;
    controls.addEventListener('start', () => {
      controls.autoRotate = false;
      window.clearTimeout(resumeTimer);
    });
    controls.addEventListener('end', () => {
      resumeTimer = window.setTimeout(() => (controls.autoRotate = true), 4000);
    });

    const resize = () => {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return;
      renderer.setSize(r.width, r.height, false);
      renderer.domElement.style.width = `${r.width}px`;
      renderer.domElement.style.height = `${r.height}px`;
      camera.aspect = r.width / r.height;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      controls.update();
      renderer.render(scene, camera);
    };
    loop();

    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(resumeTimer);
      ro.disconnect();
      controls.dispose();
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) {
          o.geometry.dispose();
          (o.material as THREE.Material).dispose();
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return <div ref={host} className="absolute inset-0 cursor-grab active:cursor-grabbing" aria-label="Interactive 3D model of a house. Drag to turn it." role="img" />;
}
