/**
 * While a sheet is being captured for print, drawings size text and symbols for paper
 * (their real-world sizes) instead of keeping them readable at the current screen zoom.
 */
import { useSyncExternalStore } from 'react';

let on = false;
const subs = new Set<() => void>();

export function setPrintMode(v: boolean) {
  if (on === v) return;
  on = v;
  subs.forEach((f) => f());
}

export function usePrintMode() {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => on
  );
}

/** Wait for React to redraw (two frames). */
export const nextPaint = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
