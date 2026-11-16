/**
 * Wall finish textures, drawn once on a canvas at one metre square and repeated at real size:
 * painted render, fair-face blockwork, coral stone, stone cladding, facing brick, timber slats.
 * The texture carries the pattern in greys; the material colour tints it.
 */
import * as THREE from 'three';
import type { BoundaryFinish } from '../../../model/types';

const cache = new Map<BoundaryFinish, THREE.CanvasTexture>();

function rand(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function draw(finish: BoundaryFinish): HTMLCanvasElement {
  const N = 256;
  const cv = document.createElement('canvas');
  cv.width = N;
  cv.height = N;
  const g = cv.getContext('2d')!;
  const r = rand(finish.length * 97 + 13);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, N, N);
  const joint = (shade: number, w: number) => {
    g.strokeStyle = `rgba(0,0,0,${shade})`;
    g.lineWidth = w;
  };
  // A metre is N px: courses in real sizes.
  const px = (m: number) => m * N;
  switch (finish) {
    case 'painted_render': {
      for (let i = 0; i < 1600; i++) {
        g.fillStyle = `rgba(0,0,0,${0.02 + r() * 0.03})`;
        g.fillRect(r() * N, r() * N, 1 + r() * 2, 1 + r() * 2);
      }
      break;
    }
    case 'fair_face_block': {
      joint(0.28, 2);
      const h = px(0.2);
      const w = px(0.4);
      for (let y = 0, row = 0; y <= N; y += h, row++) {
        g.beginPath();
        g.moveTo(0, y);
        g.lineTo(N, y);
        g.stroke();
        for (let x = row % 2 ? w / 2 : 0; x <= N; x += w) {
          g.beginPath();
          g.moveTo(x, y);
          g.lineTo(x, y + h);
          g.stroke();
        }
      }
      for (let i = 0; i < 900; i++) {
        g.fillStyle = `rgba(0,0,0,${r() * 0.06})`;
        g.fillRect(r() * N, r() * N, 2, 2);
      }
      break;
    }
    case 'exposed_brick': {
      const h = px(0.075);
      const w = px(0.225);
      for (let y = 0, row = 0; y < N; y += h, row++)
        for (let x = (row % 2 ? -w / 2 : 0); x < N; x += w) {
          g.fillStyle = `rgba(0,0,0,${0.05 + r() * 0.18})`;
          g.fillRect(x + 1.5, y + 1.5, w - 3, h - 3);
        }
      joint(0.35, 3);
      for (let y = 0; y <= N; y += h) {
        g.beginPath();
        g.moveTo(0, y);
        g.lineTo(N, y);
        g.stroke();
      }
      break;
    }
    case 'stone_cladding':
    case 'coral_stone': {
      const coral = finish === 'coral_stone';
      // Irregular coursed stones.
      let y = 0;
      while (y < N) {
        const h = px(coral ? 0.18 + r() * 0.08 : 0.12 + r() * 0.14);
        let x = -r() * 40;
        while (x < N) {
          const w = px(coral ? 0.35 + r() * 0.2 : 0.2 + r() * 0.35);
          g.fillStyle = `rgba(0,0,0,${0.04 + r() * (coral ? 0.1 : 0.22)})`;
          g.fillRect(x + 2, y + 2, w - 4, h - 4);
          if (coral)
            for (let k = 0; k < 14; k++) {
              g.fillStyle = 'rgba(0,0,0,0.12)';
              g.beginPath();
              g.arc(x + r() * w, y + r() * h, 1 + r() * 2.5, 0, Math.PI * 2);
              g.fill();
            }
          x += w;
        }
        y += h;
      }
      break;
    }
    case 'timber_slats': {
      const w = px(0.07);
      const gap = px(0.02);
      for (let x = 0; x < N; x += w + gap) {
        g.fillStyle = 'rgba(0,0,0,0.55)';
        g.fillRect(x + w, 0, gap, N);
        for (let k = 0; k < 6; k++) {
          g.strokeStyle = `rgba(0,0,0,${0.06 + r() * 0.08})`;
          g.lineWidth = 1;
          g.beginPath();
          const gx = x + r() * w;
          g.moveTo(gx, 0);
          g.bezierCurveTo(gx + 3, N / 3, gx - 3, (2 * N) / 3, gx + 1, N);
          g.stroke();
        }
      }
      break;
    }
  }
  return cv;
}

/** The finish texture, repeated so one tile is one metre on a face `w` × `h` metres. */
export function finishTexture(finish: BoundaryFinish, w: number, h: number): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  let base = cache.get(finish);
  if (!base) {
    base = new THREE.CanvasTexture(draw(finish));
    base.colorSpace = THREE.SRGBColorSpace;
    base.wrapS = THREE.RepeatWrapping;
    base.wrapT = THREE.RepeatWrapping;
    base.anisotropy = 4;
    cache.set(finish, base);
  }
  const t = base.clone();
  t.needsUpdate = true;
  t.repeat.set(Math.max(0.2, w), Math.max(0.2, h));
  return t;
}
