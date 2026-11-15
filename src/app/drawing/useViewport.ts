import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

export interface View {
  /** Pixels per metre. */
  k: number;
  tx: number;
  ty: number;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const K_MIN = 4;
const K_MAX = 600;

/**
 * Pan and zoom for a drawing surface.
 * - Trackpad: two-finger scroll pans, pinch (ctrl+wheel) zooms.
 * - Mouse wheel: zooms about the cursor.
 * - Touch: one finger is left to the active tool; two fingers pan and pinch.
 * - Middle button or space+drag pans with any tool.
 */
/**
 * `limits`: zoom range in screen px per world unit. The defaults suit metres; a sheet of paper
 * in millimetres needs a much smaller minimum.
 */
export function useViewport(
  ref: RefObject<HTMLElement | null>,
  fitBounds: Bounds | null,
  padding = 72,
  limits: { kMin?: number; kMax?: number; /** One finger pans (drawings you only look at). */ oneFingerPan?: boolean } = {}
) {
  const oneFingerPan = !!limits.oneFingerPan;
  const kMinL = limits.kMin ?? K_MIN;
  const kMaxL = limits.kMax ?? K_MAX;
  const [view, setView] = useState<View>({ k: 40, tx: 0, ty: 0 });
  const viewRef = useRef(view);
  viewRef.current = view;
  // Gestures update at most once a frame: touch and trackpads fire far faster than a large
  // drawing can re-render, which made pinch-zoom stutter and lock up on phones.
  const pending = useRef<View | null>(null);
  const frame = useRef(0);
  const cur = () => pending.current ?? viewRef.current;
  const commit = useCallback((next: View) => {
    pending.current = next;
    if (!frame.current)
      frame.current = requestAnimationFrame(() => {
        frame.current = 0;
        const v = pending.current;
        pending.current = null;
        if (v) setView(v);
      });
  }, []);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  const touchCount = useRef(0);
  const fitted = useRef(false);
  const spaceDown = useRef(false);

  const toWorld = useCallback((clientX: number, clientY: number) => {
    const el = ref.current;
    const r = el?.getBoundingClientRect();
    const v = viewRef.current;
    return { x: (clientX - (r?.left ?? 0) - v.tx) / v.k, y: (clientY - (r?.top ?? 0) - v.ty) / v.k };
  }, [ref]);

  const zoomAt = useCallback((factor: number, cx?: number, cy?: number) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const px = cx === undefined ? r.width / 2 : cx - r.left;
    const py = cy === undefined ? r.height / 2 : cy - r.top;
    setView((v) => {
      const k = Math.min(kMaxL, Math.max(kMinL, v.k * factor));
      const f = k / v.k;
      return { k, tx: px - (px - v.tx) * f, ty: py - (py - v.ty) * f };
    });
  }, [ref]);

  const fit = useCallback(() => {
    const el = ref.current;
    if (!el || !fitBounds) return;
    const r = el.getBoundingClientRect();
    if (r.width < 10 || r.height < 10) return;
    const w = Math.max(1, fitBounds.maxX - fitBounds.minX);
    const h = Math.max(1, fitBounds.maxY - fitBounds.minY);
    const pad = Math.min(padding, r.width * 0.12);
    const k = Math.min((r.width - pad * 2) / w, (r.height - pad * 2) / h);
    setView({
      k,
      tx: r.width / 2 - ((fitBounds.minX + fitBounds.maxX) / 2) * k,
      ty: r.height / 2 - ((fitBounds.minY + fitBounds.maxY) / 2) * k,
    });
    fitted.current = true;
  }, [ref, fitBounds, padding]);

  // First fit once there is something to fit, and refit if the surface size changes before the user moves.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!fitted.current) fit();
    const ro = new ResizeObserver(() => !fitted.current && fit());
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, fit]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      fitted.current = true;
      const isPinch = e.ctrlKey;
      const isMouseWheel = !isPinch && e.deltaMode === 1;
      const v = cur();
      if (isPinch || isMouseWheel || (!e.deltaX && Math.abs(e.deltaY) >= 50 && Number.isInteger(e.deltaY))) {
        const r = el.getBoundingClientRect();
        const k = Math.min(kMaxL, Math.max(kMinL, v.k * Math.exp(-e.deltaY * (isPinch ? 0.01 : 0.0025))));
        const f = k / v.k;
        const px = e.clientX - r.left;
        const py = e.clientY - r.top;
        commit({ k, tx: px - (px - v.tx) * f, ty: py - (py - v.ty) * f });
      } else {
        commit({ ...v, tx: v.tx - e.deltaX, ty: v.ty - e.deltaY });
      }
    };

    // Touch: two-finger pan + pinch.
    const touches = new Map<number, { x: number; y: number }>();
    let last: { cx: number; cy: number; d: number } | null = null;
    let one: { x: number; y: number } | null = null;
    const gesture = () => {
      const pts = [...touches.values()];
      const cx = (pts[0].x + pts[1].x) / 2;
      const cy = (pts[0].y + pts[1].y) / 2;
      return { cx, cy, d: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) };
    };
    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      touchCount.current = touches.size;
      if (touches.size === 2) {
        last = gesture();
        one = null;
      } else if (touches.size === 1 && oneFingerPan) one = { x: e.clientX, y: e.clientY };
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!touches.has(e.pointerId)) return;
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size === 2 && last) {
        const g = gesture();
        if (last.d < 1 || g.d < 1) return;
        fitted.current = true;
        const v = cur();
        const r = el.getBoundingClientRect();
        const k = Math.min(kMaxL, Math.max(kMinL, v.k * (g.d / last.d)));
        const f = k / v.k;
        const px = g.cx - r.left;
        const py = g.cy - r.top;
        commit({ k, tx: px - (last.cx - r.left - v.tx) * f, ty: py - (last.cy - r.top - v.ty) * f });
        last = g;
      } else if (touches.size === 1 && one) {
        fitted.current = true;
        const v = cur();
        commit({ ...v, tx: v.tx + e.clientX - one.x, ty: v.ty + e.clientY - one.y });
        one = { x: e.clientX, y: e.clientY };
      }
    };
    const onPointerUp = (e: PointerEvent) => {
      touches.delete(e.pointerId);
      touchCount.current = touches.size;
      if (touches.size < 2) last = null;
      // Lifting one finger of a pinch must not turn into a jump-pan with the other.
      one = null;
    };

    // Middle-button or space-drag pan.
    let drag: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => {
      if (e.button === 1 || (e.button === 0 && spaceDown.current)) {
        e.preventDefault();
        e.stopPropagation();
        drag = { x: e.clientX, y: e.clientY };
        el.setPointerCapture(e.pointerId);
      }
    };
    const onMove = (e: PointerEvent) => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      drag = { x: e.clientX, y: e.clientY };
      fitted.current = true;
      const v = cur();
      commit({ ...v, tx: v.tx + dx, ty: v.ty + dy });
    };
    const onUp = () => (drag = null);
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target as HTMLElement).closest('input,textarea,select')) {
        spaceDown.current = e.type === 'keydown';
        el.style.cursor = spaceDown.current ? 'grab' : '';
        if (e.type === 'keydown') e.preventDefault();
      }
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointercancel', onPointerUp);
    el.addEventListener('pointerdown', onDown, true);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointercancel', onPointerUp);
      el.removeEventListener('pointerdown', onDown, true);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
    };
  }, [ref, zoomAt, commit, kMinL, kMaxL, oneFingerPan]);

  /** Pan by screen pixels (used by one-finger / select-tool drag on empty paper). */
  const panBy = useCallback((dx: number, dy: number) => {
    fitted.current = true;
    const v = cur();
    commit({ ...v, tx: v.tx + dx, ty: v.ty + dy });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commit]);

  /** Fingers currently on the surface (a tool should ignore its one-finger drag during a pinch). */
  const touches = useCallback(() => touchCount.current, []);

  return { view, toWorld, zoomAt, fit, panBy, touches };
}
