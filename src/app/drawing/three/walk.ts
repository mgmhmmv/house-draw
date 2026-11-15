/**
 * Walk mode: first-person movement at eye height through one level of the building.
 *
 * Keyboard (WASD / arrows, Shift to hurry) or the on-screen pad moves; dragging looks around.
 * Walls block movement except through door openings, so you walk the plan the way a visitor
 * would. Coordinates follow the scene: three.js x = plan x, three.js z = plan y.
 */
import * as THREE from 'three';
import type { FloorLevel } from '../../../model/types';
import { wallFrame } from '../plan/kernel';

export type Move = 'forward' | 'back' | 'left' | 'right';

const EYE = 1.6;
const RADIUS = 0.22; // body radius for collisions
const SPEED = 1.4; // m/s, a relaxed walk
const KEYMAP: Record<string, Move> = {
  KeyW: 'forward',
  ArrowUp: 'forward',
  KeyS: 'back',
  ArrowDown: 'back',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
};

interface Blocker {
  ax: number;
  az: number;
  dx: number;
  dz: number;
  len: number;
  half: number;
  doors: [number, number][]; // passable spans along the wall (metres from start)
}

export class WalkController {
  active = false;
  private yaw = 0;
  private pitch = 0;
  private pos = new THREE.Vector3();
  private floorY = 0;
  private held = new Set<Move>();
  private fast = false;
  private blockers: Blocker[] = [];
  private drag: { x: number; y: number; id: number } | null = null;
  /** Double-click walk: heading in the plan and distance still to go. */
  private auto: { dx: number; dz: number; left: number; yaw: number } | null = null;

  constructor(private camera: THREE.PerspectiveCamera, private dom: HTMLElement) {}

  /** Enter walk mode on a level, standing just outside the main door looking in. */
  start(level: FloorLevel) {
    this.active = true;
    this.floorY = level.elevation;
    this.blockers = level.walls.flatMap((w) => {
      const f = wallFrame(w);
      if (f.length < 0.05) return [];
      const doors = level.openings
        .filter((o) => o.wallId === w.id && o.kind === 'door')
        .map((o) => [o.offset * f.length - o.width / 2 + RADIUS * 0.6, o.offset * f.length + o.width / 2 - RADIUS * 0.6] as [number, number]);
      return [{ ax: w.start.x, az: w.start.y, dx: f.dir.x, dz: f.dir.y, len: f.length, half: w.thickness / 2, doors }];
    });

    // Find an exterior door; stand 1.6 m outside it, facing in.
    const xs = level.walls.flatMap((w) => [w.start.x, w.end.x]);
    const ys = level.walls.flatMap((w) => [w.start.y, w.end.y]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cz = (Math.min(...ys) + Math.max(...ys)) / 2;
    // Prefer a door whose outside lies beyond the building's footprint (a real front door,
    // not one onto an enclosed verandah); otherwise take any exterior door.
    const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...ys), maxZ = Math.max(...ys);
    let spot: { x: number; z: number; yaw: number } | null = null;
    let fallback: { x: number; z: number; yaw: number } | null = null;
    for (const o of level.openings) {
      const w = level.walls.find((x) => x.id === o.wallId);
      if (o.kind !== 'door' || !w?.isExterior) continue;
      const f = wallFrame(w);
      const px = w.start.x + f.dir.x * o.offset * f.length;
      const pz = w.start.y + f.dir.y * o.offset * f.length;
      const side = (px - cx) * f.n.x + (pz - cz) * f.n.y > 0 ? 1 : -1;
      const ox = px + f.n.x * side * 1.6;
      const oz = pz + f.n.y * side * 1.6;
      const cand = { x: ox, z: oz, yaw: Math.atan2(-(px - ox), -(pz - oz)) };
      if (ox < minX || ox > maxX || oz < minZ || oz > maxZ) {
        spot = cand;
        break;
      }
      fallback ??= cand;
    }
    spot ??= fallback;
    if (!spot) spot = { x: cx, z: Math.max(...ys) + 3, yaw: 0 };
    this.pos.set(spot.x, this.floorY + EYE, spot.z);
    this.yaw = spot.yaw;
    this.pitch = -0.05;
    this.camera.fov = 62;
    this.camera.near = 0.05;
    this.camera.updateProjectionMatrix();
    this.apply();

    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKey);
    this.dom.addEventListener('pointerdown', this.onDown);
    this.dom.addEventListener('dblclick', this.onDouble);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
  }

  stop() {
    this.active = false;
    this.held.clear();
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKey);
    this.dom.removeEventListener('pointerdown', this.onDown);
    this.dom.removeEventListener('dblclick', this.onDouble);
    window.removeEventListener('pointermove', this.onMove);
    this.auto = null;
    window.removeEventListener('pointerup', this.onUp);
    this.camera.fov = 35;
    this.camera.near = 0.1;
    this.camera.updateProjectionMatrix();
  }

  /** On-screen pad. */
  press(m: Move, down: boolean) {
    if (down) this.held.add(m);
    else this.held.delete(m);
  }

  update(dt: number) {
    if (!this.active) return;
    const step = SPEED * (this.fast ? 2.2 : 1) * Math.min(dt, 0.05);
    let fx = 0;
    let fz = 0;
    // Forward is −z in camera space; rotate by yaw into the plan.
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    if (this.held.has('forward')) (fx -= sin, fz -= cos);
    if (this.held.has('back')) (fx += sin, fz += cos);
    if (this.held.has('left')) (fx -= cos, fz += sin);
    if (this.held.has('right')) (fx += cos, fz -= sin);
    if (this.held.size) this.auto = null; // keys take over
    if (this.auto) {
      // Turn towards the target while walking, a few steps in all.
      let dy = this.auto.yaw - this.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      this.yaw += dy * Math.min(1, dt * 6);
      const st = Math.min(step * 1.2, this.auto.left);
      const nx = this.pos.x + this.auto.dx * st;
      const nz = this.pos.z + this.auto.dz * st;
      const bx = this.blocked(nx, this.pos.z);
      const bz = this.blocked(this.pos.x, nz);
      if (!bx) this.pos.x = nx;
      if (!bz) this.pos.z = nz;
      this.auto.left -= st;
      if (this.auto.left <= 0.001 || (bx && bz)) this.auto = null;
    }
    const l = Math.hypot(fx, fz);
    if (l > 0) {
      // Move one axis at a time so you slide along walls instead of sticking to them.
      const nx = this.pos.x + (fx / l) * step;
      if (!this.blocked(nx, this.pos.z)) this.pos.x = nx;
      const nz = this.pos.z + (fz / l) * step;
      if (!this.blocked(this.pos.x, nz)) this.pos.z = nz;
    }
    this.apply();
  }

  private blocked(x: number, z: number): boolean {
    for (const b of this.blockers) {
      const rx = x - b.ax;
      const rz = z - b.az;
      const s = rx * b.dx + rz * b.dz;
      if (s < -b.half - RADIUS || s > b.len + b.half + RADIUS) continue;
      const d = Math.abs(rx * -b.dz + rz * b.dx);
      if (d > b.half + RADIUS) continue;
      if (b.doors.some(([a, c]) => s >= a && s <= c)) continue;
      return true;
    }
    return false;
  }

  private apply() {
    this.camera.position.copy(this.pos);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }

  private onKey = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t?.closest?.('input, textarea, select')) return;
    if (e.key === 'Shift') this.fast = e.type === 'keydown';
    const m = KEYMAP[e.code];
    if (!m) return;
    e.preventDefault();
    this.press(m, e.type === 'keydown');
  };

  private onDown = (e: PointerEvent) => {
    this.drag = { x: e.clientX, y: e.clientY, id: e.pointerId };
  };

  private onMove = (e: PointerEvent) => {
    if (!this.drag || e.pointerId !== this.drag.id) return;
    const dx = e.clientX - this.drag.x;
    const dy = e.clientY - this.drag.y;
    this.drag = { ...this.drag, x: e.clientX, y: e.clientY };
    // Drag the scene: the view turns the opposite way to the pointer, like Street View.
    this.yaw += dx * 0.0045;
    this.pitch = Math.max(-1.1, Math.min(1.1, this.pitch + dy * 0.0045));
  };

  /** Double-click: walk a few steps towards the point clicked. */
  private onDouble = (e: MouseEvent) => {
    const r = this.dom.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const d = ray.ray.direction;
    const h = Math.hypot(d.x, d.z);
    if (h < 1e-3) return;
    this.auto = { dx: d.x / h, dz: d.z / h, left: 2.5, yaw: Math.atan2(-d.x, -d.z) };
  };

  private onUp = (e: PointerEvent) => {
    if (this.drag?.id === e.pointerId) this.drag = null;
  };
}
