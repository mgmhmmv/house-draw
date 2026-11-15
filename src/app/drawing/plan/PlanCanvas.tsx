import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent, type RefObject } from 'react';
import { Maximize2, Minus, Plus } from 'lucide-react';
import type {
  ActiveSheetId,
  BuildingProject,
  CADTool,
  FloorLevel,
  FurnitureItem,
  MEPNode,
  Point2D,
  SelectableElementKind,
  SketchStroke,
} from '../../../model/types';
import { uid } from '../../../engine/geometry';
import { cx } from '../../ui';
import { ACCENT, INK, INK_2, INK_3, LINE, MEP_COLOR, PAPER, ROOM_TINT, TEXT, WEIGHT } from '../style';
import { useViewport } from '../useViewport';
import { usePrintMode } from '../printMode';
import { chooseScale, composeSheet, DRAWING_AREA, PAPER as SHEET, type SheetInfo } from '../../../export/sheet';
import { RoofPlan, roofPlanBounds, SewagePlan, sewerLayout } from './sheetPlans';
import { assetFor, type AssetDef } from '../assets/catalog';
import { assetPlan, isOverhead, mepAsset, mepSize, WALL_SIDE_ROT } from '../assets/render';
import { PlanPrims } from '../assets/PlanSymbol';
import { buildPlanGeometry, dimensionChains, fmtMM, nearestWall, openingSymbol, roomTag, wallFrame, along, type Vec } from './kernel';

type Mode = 'plan' | 'structure' | 'mep' | 'roof' | 'sewage';
type MepGroup = 'electrical' | 'plumbing' | 'hvac';
/** The water & electrical plan shows both, or one. */
type MepFilter = 'all' | 'electrical' | 'water';

interface Props {
  model: BuildingProject;
  sheet: ActiveSheetId;
  levelIndex: number;
  tool: CADTool;
  selectedId: string | null;
  onSelect: (id: string | null, kind?: SelectableElementKind) => void;
  onCommit: (next: BuildingProject) => void;
  sketchStrokes: SketchStroke[];
  onAddSketchStroke: (s: SketchStroke) => void;
  traceImageUrl: string | null;
  traceOpacity: number;
  svgRef: RefObject<SVGSVGElement | null>;
  /** A library item being placed: the next click on the plan places it. */
  placing?: { def: AssetDef; rotation: number } | null;
  /** Called after an item is placed, with what was placed (so it can be selected). */
  onPlaced?: (id: string, kind: SelectableElementKind) => void;
  /** Title-block details: when given, the plan can be shown on paper (A3, to scale). */
  paperInfo?: SheetInfo | null;
}

const EDITABLE = ['A-101', 'S-101', 'M-101'];
const PAPER_KEY = 'as_paper';
const readPaperPrefs = (): Record<string, boolean> => {
  try {
    return JSON.parse(localStorage.getItem(PAPER_KEY) ?? '{}');
  } catch {
    return {};
  }
};

/**
 * A plan sheet. Drawn freely for editing, or on paper: the A3 sheet with its title block and
 * the plan at a true scale, exactly as it prints. Roof and sewage plans are drawings only.
 */
export function PlanCanvas(p: Props) {
  const [prefs, setPrefs] = useState(readPaperPrefs);
  const paperOn = prefs[p.sheet] ?? !EDITABLE.includes(p.sheet);
  const setPaperOn = (v: boolean) => {
    const next = { ...prefs, [p.sheet]: v };
    setPrefs(next);
    try {
      localStorage.setItem(PAPER_KEY, JSON.stringify(next));
    } catch {
      /* private mode */
    }
  };
  const printing = usePrintMode();
  const paper = (paperOn || printing) && p.paperInfo ? p.paperInfo : null;
  return <PlanSurface key={paper ? `paper-${p.sheet}` : 'free'} {...p} paper={paper} canPaper={!!p.paperInfo} paperOn={paperOn} setPaperOn={setPaperOn} />;
}

const NS = 'non-scaling-stroke' as const;
const pts = (a: Vec[]) => a.map((p) => `${p.x},${p.y}`).join(' ');
const snap = (v: number, step = 0.05) => Math.round(v / step) * step;
const snapPt = (p: Vec, step = 0.05): Vec => ({ x: snap(p.x, step), y: snap(p.y, step) });
/** Rotation snapping: square angles pull hardest, then 45°, then 15° steps; Shift for free. */
const snapAngle = (deg: number, free: boolean) => {
  const a = ((deg % 360) + 360) % 360;
  if (free) return Math.round(a);
  const near = (step: number, tol: number) => {
    const t = Math.round(a / step) * step;
    return Math.abs(t - a) <= tol ? t % 360 : null;
  };
  return near(90, 8) ?? near(45, 5) ?? Math.round(a / 15) * 15 % 360;
};

/* Drag state while a pointer is down. The model is edited as a draft and committed on release. */
type Drag =
  | { kind: 'pan'; x: number; y: number }
  | { kind: 'move'; target: SelectableElementKind; id: string; start: Vec; base: BuildingProject; moved: boolean }
  | { kind: 'rotate'; target: 'furniture' | 'mep_node'; id: string; center: Vec; base: BuildingProject; angle: number }
  | { kind: 'room_rect'; start: Vec }
  | { kind: 'sketch'; points: Vec[] };

const SHEET_BOUNDS = { minX: 0, minY: 0, maxX: SHEET.w, maxY: SHEET.h };

function PlanSurface(p: Props & { paper: SheetInfo | null; canPaper: boolean; paperOn: boolean; setPaperOn: (v: boolean) => void }) {
  const mode: Mode = p.sheet === 'S-101' ? 'structure' : p.sheet === 'M-101' ? 'mep' : p.sheet === 'R-101' ? 'roof' : p.sheet === 'D-101' ? 'sewage' : 'plan';
  const paper = p.paper;
  const readOnly = !!paper || mode === 'roof' || mode === 'sewage';
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<BuildingProject | null>(null);
  const model = draft ?? p.model;
  const levelIndex = mode === 'roof' ? model.levels.length - 1 : p.levelIndex;
  const level: FloorLevel = model.levels[levelIndex] ?? model.levels[0];
  const below: FloorLevel | null = levelIndex > 0 && mode !== 'roof' && mode !== 'sewage' && !paper ? model.levels[levelIndex - 1] : null;
  const sewer = useMemo(() => (mode === 'sewage' ? sewerLayout(model, level) : null), [mode, model, level]);

  const geo = useMemo(() => buildPlanGeometry(level), [level]);
  const ghostGeo = useMemo(() => (below ? buildPlanGeometry(below) : null), [below]);
  const tags = useMemo(() => level.rooms.map(roomTag), [level.rooms]);
  const chains = useMemo(() => (mode === 'plan' ? dimensionChains(level, geo) : []), [mode, level, geo]);
  const symbols = useMemo(
    () => level.openings.flatMap((o) => (geo.frames.get(o.wallId) ? [openingSymbol(geo.frames.get(o.wallId)!, o)] : [])),
    [level.openings, geo]
  );

  const fitBounds = useMemo(() => {
    if (mode === 'roof') return roofPlanBounds(model);
    if (sewer) return sewer.bounds;
    const b = geo.bounds;
    const m = mode === 'plan' ? 2.6 : 1.8;
    return { minX: b.minX - m, minY: b.minY - m, maxX: b.maxX + m, maxY: b.maxY + m };
    // Fit to the first level's footprint so switching levels keeps the view still.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.levelIndex === 0 ? geo.bounds : null, mode, mode === 'roof' ? model : null, sewer]);

  // On paper: the plan at a true scale on the A3 sheet.
  const layout = useMemo(() => {
    if (!paper) return null;
    const e = fitBounds;
    // 1:100 like the elevations and sections (one scale through the set), smaller only if it must be.
    const scale = Math.max(100, chooseScale(e.maxX - e.minX, e.maxY - e.minY, DRAWING_AREA.w, DRAWING_AREA.h));
    const m = 1000 / scale;
    const x0 = DRAWING_AREA.x + (DRAWING_AREA.w - (e.maxX - e.minX) * m) / 2 - e.minX * m;
    const y0 = DRAWING_AREA.y + (DRAWING_AREA.h - (e.maxY - e.minY) * m) / 2 - e.minY * m;
    const frame = composeSheet(null, paper, { scale }).svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
    return { m, x0, y0, frame };
  }, [paper, fitBounds]);
  const vp = useViewport(surfaceRef, layout ? SHEET_BOUNDS : fitBounds, layout ? 24 : 72, layout ? { kMin: 0.25, kMax: 80 } : {});
  const { tx, ty } = vp.view;
  // Screen pixels per metre of the plan (on paper, through the sheet's scale).
  const k = layout ? vp.view.k * layout.m : vp.view.k;
  // Text and symbol sizes: real paper sizes when printing or on paper, kept readable on screen otherwise.
  const print = usePrintMode();
  const kText = print || layout ? 1e6 : k;

  const [hover, setHover] = useState<Vec | null>(null);
  const [wallStart, setWallStart] = useState<Vec | null>(null);
  const [measure, setMeasure] = useState<{ a: Vec; b: Vec | null } | null>(null);
  const [mepFilter, setMepFilter] = useState<MepFilter>('all');
  const drag = useRef<Drag | null>(null);
  const [, force] = useState(0);

  useEffect(() => {
    setWallStart(null);
    setMeasure(null);
  }, [p.tool, p.levelIndex]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setWallStart(null);
        setMeasure(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /* ── Snapping ────────────────────────────────────────────────────── */

  const snapTol = 12 / k;
  const smartSnap = useCallback(
    (raw: Vec, from?: Vec | null): Vec => {
      // Endpoints first, then orthogonal lock from the previous point, then the 50 mm grid.
      for (const w of level.walls) for (const e of [w.start, w.end]) if (Math.hypot(e.x - raw.x, e.y - raw.y) < snapTol) return { ...e };
      let q = snapPt(raw);
      if (from) {
        const dx = Math.abs(q.x - from.x);
        const dy = Math.abs(q.y - from.y);
        if (dy < dx * 0.12) q = { x: q.x, y: from.y };
        else if (dx < dy * 0.12) q = { x: from.x, y: q.y };
      }
      return q;
    },
    [level.walls, snapTol]
  );

  /* ── Editing helpers ─────────────────────────────────────────────── */

  const edit = (fn: (lvl: FloorLevel, m: BuildingProject) => void) => {
    const next = structuredClone(p.model);
    fn(next.levels[p.levelIndex] ?? next.levels[0], next);
    p.onCommit(next);
  };
  const wallHeight = level.floorToFloorHeight - level.slabThickness;

  const addWall = (a: Vec, b: Vec) =>
    edit((lvl) =>
      lvl.walls.push({ id: uid('w'), start: a, end: b, thickness: 0.23, height: wallHeight, isExterior: true, isLoadBearing: true, material: 'cinder_block' })
    );

  const moveDraft = (d: Extract<Drag, { kind: 'move' }>, cur: Vec) => {
    const dx = snap(cur.x - d.start.x);
    const dy = snap(cur.y - d.start.y);
    const next = structuredClone(d.base);
    const lvl = next.levels[p.levelIndex] ?? next.levels[0];
    const shift = (q: Point2D) => ({ x: q.x + dx, y: q.y + dy });
    if (d.target === 'furniture') {
      const f = lvl.furniture.find((x) => x.id === d.id);
      if (f) f.position = shift(f.position);
    } else if (d.target === 'column') {
      const c = lvl.columns.find((x) => x.id === d.id);
      if (c) c.position = shift(c.position);
    } else if (d.target === 'mep_node') {
      const n = lvl.mepNodes.find((x) => x.id === d.id);
      if (n) n.position = shift(n.position);
    } else if (d.target === 'wall') {
      const w = lvl.walls.find((x) => x.id === d.id);
      if (w) {
        // Walls slide across their own axis only, and drag connected wall ends along.
        const f = wallFrame(w);
        const off = dx * f.n.x + dy * f.n.y;
        const mv = { x: snap(f.n.x * off), y: snap(f.n.y * off) };
        const s0 = { ...w.start };
        const e0 = { ...w.end };
        for (const o of lvl.walls) {
          if (o.id === w.id) continue;
          for (const end of ['start', 'end'] as const) {
            const q = o[end];
            if ((Math.abs(q.x - s0.x) < 0.02 && Math.abs(q.y - s0.y) < 0.02) || (Math.abs(q.x - e0.x) < 0.02 && Math.abs(q.y - e0.y) < 0.02))
              o[end] = { x: q.x + mv.x, y: q.y + mv.y };
          }
        }
        w.start = { x: s0.x + mv.x, y: s0.y + mv.y };
        w.end = { x: e0.x + mv.x, y: e0.y + mv.y };
      }
    } else if (d.target === 'opening') {
      const o = lvl.openings.find((x) => x.id === d.id);
      const w = o && lvl.walls.find((x) => x.id === o.wallId);
      if (o && w) {
        const f = wallFrame(w);
        const rel = { x: cur.x - w.start.x, y: cur.y - w.start.y };
        const s = rel.x * f.dir.x + rel.y * f.dir.y;
        const half = o.width / 2 / f.length;
        o.offset = Math.min(1 - half, Math.max(half, snap(s, 0.05) / f.length));
      }
    }
    return next;
  };

  /* ── Placing library items ───────────────────────────────────────── */

  type Placement = { kind: 'item'; pos: Vec; rot: number } | { kind: 'opening'; wall: (typeof level.walls)[number]; s: number; f: ReturnType<typeof wallFrame> };
  const placementAt = (raw: Vec): Placement | null => {
    const pl = p.placing;
    if (!pl) return null;
    const def = pl.def;
    if (def.opening) {
      const hit = nearestWall(level, raw, 0.8);
      if (!hit) return null;
      const f = wallFrame(hit.wall);
      const half = def.w / 2;
      return { kind: 'opening', wall: hit.wall, f, s: Math.min(f.length - half, Math.max(half, snap(hit.t * f.length))) };
    }
    if (def.mount === 'wall') {
      // Back against the nearest wall face, on the side the pointer is on.
      const hit = nearestWall(level, raw, 1.2);
      if (hit) {
        const f = wallFrame(hit.wall);
        const s0 = Math.min(f.length - def.w / 2, Math.max(def.w / 2, snap(hit.t * f.length)));
        const rel = { x: raw.x - hit.wall.start.x, y: raw.y - hit.wall.start.y };
        const side = rel.x * f.n.x + rel.y * f.n.y >= 0 ? 1 : -1;
        const pos = along(f, s0, side * (hit.wall.thickness / 2 + def.d / 2 + 0.005));
        const nx = f.n.x * side;
        const ny = f.n.y * side;
        return { kind: 'item', pos, rot: Math.round((Math.atan2(-nx, ny) * 180) / Math.PI + 360) % 360 };
      }
    }
    return { kind: 'item', pos: snapPt(raw), rot: pl.rotation };
  };

  const place = (raw: Vec) => {
    const pl = p.placing;
    const at = placementAt(raw);
    if (!pl || !at) return;
    const def = pl.def;
    // A user-made object travels with the project.
    const keep = (m: BuildingProject) => {
      if (def.custom) m.customAssets = { ...(m.customAssets ?? {}), [def.id]: def.custom as never };
    };
    if (at.kind === 'opening' && def.opening) {
      const o = def.opening;
      edit((lvl) =>
        lvl.openings.push({
          id: uid('op'),
          wallId: at.wall.id,
          kind: o.kind,
          style: o.style,
          offset: at.s / at.f.length,
          width: def.w,
          height: o.height,
          sillHeight: o.sill,
          swingDirection: 1,
          label: `${o.kind === 'door' ? 'D' : 'W'}${lvl.openings.filter((x) => x.kind === o.kind).length + 1}`,
        })
      );
      p.onPlaced?.('', 'opening');
    } else if (at.kind === 'item' && def.mep) {
      const m = def.mep;
      const id = uid('mep');
      edit((lvl, mm) => {
        lvl.mepNodes.push({ id, kind: m.kind, system: m.system, position: at.pos, wattage: m.wattage, model: def.id, rotation: at.rot, label: def.name });
        keep(mm);
      });
      p.onPlaced?.(id, 'mep_node');
    } else if (at.kind === 'item') {
      const id = uid('f');
      edit((lvl, mm) => {
        lvl.furniture.push({ id, type: def.id, position: at.pos, rotation: at.rot, width: def.w, depth: def.d });
        keep(mm);
      });
      p.onPlaced?.(id, 'furniture');
    }
  };

  /* ── Pointer handling ────────────────────────────────────────────── */

  const onPointerDown = (e: RPointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    if (readOnly) {
      // Drawings only: a drag moves the sheet.
      drag.current = { kind: 'pan', x: e.clientX, y: e.clientY };
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
      return;
    }
    const raw = vp.toWorld(e.clientX, e.clientY);
    const target = (e.target as Element).closest('[data-kind]') as SVGElement | null;
    const hitKind = target?.dataset.kind as SelectableElementKind | undefined;
    const hitId = target?.dataset.id;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);

    if (p.placing) {
      place(raw);
      return;
    }

    // Rotation handle of the selected item.
    const rotHandle = (e.target as Element).closest('[data-rotate]') as SVGElement | null;
    if (rotHandle && p.selectedId) {
      const f = level.furniture.find((x) => x.id === p.selectedId);
      const n = level.mepNodes.find((x) => x.id === p.selectedId);
      const it = f ?? n;
      if (it) {
        drag.current = { kind: 'rotate', target: f ? 'furniture' : 'mep_node', id: it.id, center: { ...it.position }, base: p.model, angle: (f ? f.rotation : n?.rotation) ?? 0 };
        return;
      }
    }

    switch (p.tool) {
      case 'select': {
        if (hitKind && hitId) {
          p.onSelect(hitId, hitKind);
          const movable = ['furniture', 'column', 'mep_node', 'wall', 'opening'].includes(hitKind);
          drag.current = movable ? { kind: 'move', target: hitKind, id: hitId, start: raw, base: p.model, moved: false } : { kind: 'pan', x: e.clientX, y: e.clientY };
        } else {
          p.onSelect(null);
          drag.current = { kind: 'pan', x: e.clientX, y: e.clientY };
        }
        return;
      }
      case 'wall': {
        const q = smartSnap(raw, wallStart);
        if (!wallStart) setWallStart(q);
        else if (Math.hypot(q.x - wallStart.x, q.y - wallStart.y) > 0.2) {
          addWall(wallStart, q);
          setWallStart(q);
        }
        return;
      }
      case 'room_rect':
        drag.current = { kind: 'room_rect', start: smartSnap(raw) };
        return;
      case 'door':
      case 'window': {
        const hit = nearestWall(level, raw, 0.8);
        if (!hit) return;
        const isDoor = p.tool === 'door';
        const width = isDoor ? 0.9 : 1.5;
        const f = wallFrame(hit.wall);
        const half = width / 2 / f.length;
        edit((lvl) =>
          lvl.openings.push({
            id: uid('op'),
            wallId: hit.wall.id,
            kind: isDoor ? 'door' : 'window',
            style: isDoor ? 'single' : 'casement',
            offset: Math.min(1 - half, Math.max(half, snap(hit.t * f.length) / f.length)),
            width,
            height: isDoor ? 2.15 : 1.35,
            sillHeight: isDoor ? 0 : 0.9,
            swingDirection: 1,
            label: `${isDoor ? 'D' : 'W'}${lvl.openings.filter((o) => o.kind === (isDoor ? 'door' : 'window')).length + 1}`,
          })
        );
        return;
      }
      case 'column': {
        const q = smartSnap(raw);
        edit((lvl) => lvl.columns.push({ id: uid('col'), position: q, width: 0.3, depth: 0.3, label: `C${lvl.columns.length + 1}`, footingSize: 1.2, rebarSpec: '4Ø16 + Ø8@150' }));
        return;
      }
      case 'measure': {
        const q = smartSnap(raw, measure?.b === null ? measure.a : null);
        if (!measure || measure.b) setMeasure({ a: q, b: null });
        else setMeasure({ a: measure.a, b: q });
        return;
      }
      default:
        if (p.tool.startsWith('sketch')) drag.current = { kind: 'sketch', points: [raw] };
    }
  };

  const onPointerMove = (e: RPointerEvent<SVGSVGElement>) => {
    const raw = vp.toWorld(e.clientX, e.clientY);
    const d = drag.current;
    if (d?.kind === 'pan') {
      vp.panBy(e.clientX - d.x, e.clientY - d.y);
      drag.current = { ...d, x: e.clientX, y: e.clientY };
      return;
    }
    if (readOnly) return;
    if (d?.kind === 'rotate') {
      // 0° = handle straight up (north); clockwise like SVG rotate().
      const ang = snapAngle((Math.atan2(raw.x - d.center.x, -(raw.y - d.center.y)) * 180) / Math.PI, e.shiftKey);
      d.angle = ang;
      const next = structuredClone(d.base);
      const lvl = next.levels[p.levelIndex] ?? next.levels[0];
      if (d.target === 'furniture') {
        const f = lvl.furniture.find((x) => x.id === d.id);
        if (f) f.rotation = ang;
      } else {
        const n = lvl.mepNodes.find((x) => x.id === d.id);
        if (n) n.rotation = ang;
      }
      setDraft(next);
      return;
    }
    if (d?.kind === 'move') {
      if (!d.moved && Math.hypot(raw.x - d.start.x, raw.y - d.start.y) * k < 4) return;
      d.moved = true;
      setDraft(moveDraft(d, raw));
      return;
    }
    if (d?.kind === 'sketch') {
      const last = d.points[d.points.length - 1];
      if (Math.hypot(raw.x - last.x, raw.y - last.y) * k > 3) {
        d.points.push(raw);
        force((n) => n + 1);
      }
      return;
    }
    setHover(p.tool === 'wall' ? smartSnap(raw, wallStart) : p.tool === 'measure' ? smartSnap(raw, measure && !measure.b ? measure.a : null) : p.tool === 'room_rect' || p.tool === 'column' ? smartSnap(raw) : raw);
  };

  const onPointerUp = (e: RPointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const raw = vp.toWorld(e.clientX, e.clientY);
    if (d.kind === 'rotate') {
      if (draft) p.onCommit(draft);
      setDraft(null);
    } else if (d.kind === 'move' && d.moved) {
      p.onCommit(moveDraft(d, raw));
      setDraft(null);
    } else if (d.kind === 'room_rect') {
      const b = smartSnap(raw);
      const [x1, x2] = [Math.min(d.start.x, b.x), Math.max(d.start.x, b.x)];
      const [y1, y2] = [Math.min(d.start.y, b.y), Math.max(d.start.y, b.y)];
      if (x2 - x1 >= 0.8 && y2 - y1 >= 0.8) {
        const c = [
          { x: x1, y: y1 },
          { x: x2, y: y1 },
          { x: x2, y: y2 },
          { x: x1, y: y2 },
        ];
        edit((lvl) => {
          // Only add walls where none already run along that edge.
          for (let i = 0; i < 4; i++) {
            const a = c[i];
            const bb = c[(i + 1) % 4];
            const exists = lvl.walls.some((w) => {
              const on = (q: Vec) => nearestWall({ ...lvl, walls: [w] }, q, 0.05);
              return on(a) && on(bb) && on({ x: (a.x + bb.x) / 2, y: (a.y + bb.y) / 2 });
            });
            if (!exists)
              lvl.walls.push({ id: uid('w'), start: a, end: bb, thickness: 0.15, height: wallHeight, isExterior: false, isLoadBearing: false, material: 'cinder_block' });
          }
          lvl.rooms.push({ id: uid('rm'), name: `Room ${lvl.rooms.length + 1}`, category: 'living', polygon: c, finish: 'porcelain', ceilingHeight: 3 });
        });
      }
    } else if (d.kind === 'sketch' && d.points.length > 1) {
      const kind = p.tool === 'sketch_door' ? 'door' : p.tool === 'sketch_window' ? 'window' : 'wall';
      p.onAddSketchStroke({ id: uid('sk'), kind, points: d.points });
    }
    force((n) => n + 1);
  };

  const onDoubleClick = () => setWallStart(null);

  /* ── Derived drawing bits ────────────────────────────────────────── */

  const sel = p.selectedId;
  const showText = (size: number) => !!(print || layout) || size * k >= 7;
  const roomDrag = drag.current?.kind === 'room_rect' ? drag.current : null;
  const sketchDrag = drag.current?.kind === 'sketch' ? drag.current : null;
  const openingPreview =
    hover && (p.tool === 'door' || p.tool === 'window')
      ? (() => {
          const hit = nearestWall(level, hover, 0.8);
          if (!hit) return null;
          const f = wallFrame(hit.wall);
          const width = p.tool === 'door' ? 0.9 : 1.5;
          const half = width / 2 / f.length;
          return openingSymbol(f, {
            id: 'preview',
            wallId: hit.wall.id,
            kind: p.tool,
            style: p.tool === 'door' ? 'single' : 'casement',
            offset: Math.min(1 - half, Math.max(half, snap(hit.t * f.length) / f.length)),
            width,
            height: 2,
            sillHeight: 0,
            swingDirection: 1,
          });
        })()
      : null;

  const wallsFaded = mode === 'mep' || mode === 'sewage' ? 0.35 : 1;
  const cursor = readOnly ? 'grab' : p.placing ? 'copy' : p.tool === 'select' ? (drag.current?.kind === 'pan' ? 'grabbing' : 'default') : 'crosshair';
  const ghost = p.placing && hover ? placementAt(hover) : null;

  const world = mode === 'roof' ? (
    <RoofPlan model={model} k={kText} />
  ) : (
    <>
          {p.traceImageUrl && !layout && (
            <image
              href={p.traceImageUrl}
              x={geo.bounds.minX}
              y={geo.bounds.minY}
              width={Math.max(8, geo.bounds.maxX - geo.bounds.minX)}
              height={Math.max(6, geo.bounds.maxY - geo.bounds.minY)}
              preserveAspectRatio="xMidYMid meet"
              opacity={p.traceOpacity}
            />
          )}

          {/* Level below, as a faint reference */}
          {ghostGeo && <path d={ghostGeo.pochePath} fill="none" stroke={INK_3} strokeWidth={WEIGHT.hair} strokeDasharray="4 3" vectorEffect={NS} opacity={0.5} />}

          {/* Rooms */}
          <g opacity={wallsFaded}>
            {level.rooms.map((r) => (
              <polygon
                key={r.id}
                data-kind="room"
                data-id={r.id}
                points={pts(r.polygon)}
                fill={mode === 'plan' ? ROOM_TINT[r.category] ?? '#F2F1ED' : '#F6F5F1'}
                stroke="none"
              />
            ))}
          </g>

          {/* Structural grid */}
          {mode === 'structure' && <Grid model={model} bounds={geo.bounds} k={print || layout ? 1e6 : k} />}

          {/* Furniture & fixtures */}
          {mode === 'plan' && (
            <g>
              {level.furniture.map((f) => (
                <Furniture key={f.id} f={f} selected={sel === f.id} />
              ))}
              {/* Overhead equipment (AC units, fans, chosen light fittings), dashed as seen from below. */}
              {level.mepNodes.map((n) => (n.model || n.kind === 'ac_split' || n.kind === 'ceiling_fan' ? <Fixture key={n.id} n={n} selected={sel === n.id} /> : null))}
            </g>
          )}
          {mode === 'plan' && !readOnly && p.tool === 'select' && !p.placing && sel && <RotateHandle level={level} id={sel} k={k} rotating={drag.current?.kind === 'rotate' ? (drag.current as { angle: number }).angle : null} />}

          {/* Stairs */}
          <g opacity={wallsFaded}>
            {level.stairs.map((s) => (
              <Stair key={s.id} s={s} />
            ))}
          </g>

          {/* Walls: one unioned poché */}
          <g opacity={wallsFaded}>
            {mode === 'structure' ? (
              <path d={geo.pochePath} fill="#E4E1DA" stroke={INK_2} strokeWidth={WEIGHT.medium} vectorEffect={NS} fillRule="nonzero" />
            ) : (
              <path d={geo.pochePath} fill={INK} stroke={INK} strokeWidth={WEIGHT.cut} vectorEffect={NS} strokeLinejoin="miter" fillRule="nonzero" />
            )}
            {/* Invisible hit areas so each wall can still be picked */}
            {[...geo.frames.values()].map((f) => {
              const t = Math.max(f.wall.thickness / 2, 6 / kText);
              const q = [along(f, 0, -t), along(f, f.length, -t), along(f, f.length, t), along(f, 0, t)];
              return <polygon key={f.wall.id} data-kind="wall" data-id={f.wall.id} points={pts(q)} fill="transparent" />;
            })}
          </g>

          {/* Openings */}
          <g opacity={wallsFaded}>
            {symbols.map((s) => (
              <g key={s.opening.id}>
                <polygon data-kind="opening" data-id={s.opening.id} points={pts(s.hit)} fill="transparent" />
                <g pointerEvents="none" vectorEffect={NS}>
                  {s.lines.map(([a, b], i) => (
                    <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={INK} strokeWidth={WEIGHT.light} vectorEffect={NS} />
                  ))}
                  {s.leaves.map(([a, b], i) => (
                    <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={INK} strokeWidth={WEIGHT.heavy} vectorEffect={NS} strokeLinecap="round" />
                  ))}
                  {s.arcs.map((d, i) => (
                    <path key={i} d={d} fill="none" stroke={INK_2} strokeWidth={WEIGHT.light} vectorEffect={NS} />
                  ))}
                </g>
                {mode === 'plan' && s.opening.label && showText(TEXT.tag) && (
                  <OpeningTag s={s} frame={geo.frames.get(s.opening.wallId)!} />
                )}
              </g>
            ))}
          </g>

          {/* Columns */}
          <g>
            {level.columns.map((c) => (
              <g key={c.id}>
                {mode === 'structure' && (
                  <rect
                    x={c.position.x - c.footingSize / 2}
                    y={c.position.y - c.footingSize / 2}
                    width={c.footingSize}
                    height={c.footingSize}
                    fill="none"
                    stroke={INK_3}
                    strokeWidth={WEIGHT.hair}
                    strokeDasharray="4 3"
                    vectorEffect={NS}
                  />
                )}
                <rect
                  data-kind="column"
                  data-id={c.id}
                  x={c.position.x - c.width / 2}
                  y={c.position.y - c.depth / 2}
                  width={c.width}
                  height={c.depth}
                  fill={INK}
                  stroke={INK}
                  strokeWidth={WEIGHT.cut}
                  vectorEffect={NS}
                  opacity={mode === 'plan' ? 0.85 : 1}
                />
                {mode === 'structure' && showText(TEXT.tag) && (
                  <text x={c.position.x + c.width / 2 + 0.12} y={c.position.y - c.depth / 2 - 0.08} fontSize={TEXT.tag} fill={INK_2} fontWeight={500}>
                    {c.label}
                  </text>
                )}
              </g>
            ))}
          </g>

          {/* MEP */}
          {mode === 'mep' && <Mep level={level} filter={mepFilter} selectedId={sel} k={kText} />}

          {/* Room tags: paper size when zoomed in, never smaller than readable on screen */}
          {mode !== 'mep' &&
            tags.map((t) => {
              const scale = Math.min(1, Math.max(0.65, t.room_w / 2.6));
              const nameSize = Math.max(TEXT.roomName * scale, 11 / kText);
              const areaSize = Math.max(TEXT.roomArea * scale, 9.5 / kText);
              const nameW = t.room.name.length * nameSize * 0.62;
              if (nameW > t.room_w * 0.92) {
                // Too small for a name: show the area only if that fits.
                const areaW = 7 * areaSize * 0.55;
                if (areaW > t.room_w) return null;
                return (
                  <text key={t.room.id} x={t.at.x} y={t.at.y + areaSize * 0.35} textAnchor="middle" fontSize={areaSize} fill={INK_3} pointerEvents="none" style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {t.area.toFixed(1)} m²
                  </text>
                );
              }
              return (
                <g key={t.room.id} pointerEvents="none" textAnchor="middle" stroke={ROOM_TINT[t.room.category] ?? PAPER} strokeWidth={3} strokeLinejoin="round" style={{ paintOrder: 'stroke' }}>
                  <text x={t.at.x} y={t.at.y - nameSize * 0.1} fontSize={nameSize} fontWeight={600} fill={INK}>
                    {t.room.name}
                  </text>
                  <text x={t.at.x} y={t.at.y + areaSize * 1.25} fontSize={areaSize} fill={INK_3} style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {t.area.toFixed(1)} m²
                  </text>
                </g>
              );
            })}

          {/* Dimensions */}
          {chains.map((c) => (
            <DimChainView key={c.side} c={c} k={kText} />
          ))}

          {/* Section markers */}
          {mode === 'plan' && model.sections.map((s) => <SectionMark key={s.id} s={s} k={print || layout ? 1e6 : k} />)}

          {/* Selection */}
          {!readOnly && <Selection model={model} level={level} geoFrames={geo.frames} selectedId={sel} k={k} />}

          {/* Library item following the pointer */}
          {p.placing && ghost && ghost.kind === 'item' && (
            <g transform={`translate(${ghost.pos.x} ${ghost.pos.y}) rotate(${ghost.rot})`} opacity={0.85} style={{ pointerEvents: 'none' }}>
              <PlanPrims prims={assetPlan(p.placing.def, p.placing.def.w, p.placing.def.d)} ink={ACCENT} fill="rgba(47,85,212,0.08)" width={1.2} />
            </g>
          )}
          {p.placing && ghost && ghost.kind === 'opening' && (
            <line
              {...(() => {
                const a = along(ghost.f, ghost.s - p.placing!.def.w / 2);
                const b = along(ghost.f, ghost.s + p.placing!.def.w / 2);
                return { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
              })()}
              stroke={ACCENT}
              strokeWidth={ghost.wall.thickness}
              strokeOpacity={0.45}
              style={{ pointerEvents: 'none' }}
            />
          )}

          {/* Sketch strokes */}
          <g fill="none" strokeLinecap="round" strokeLinejoin="round">
            {[...(layout ? [] : p.sketchStrokes), ...(sketchDrag ? [{ id: 'live', kind: 'wall' as const, points: sketchDrag.points }] : [])].map((s) => (
              <polyline key={s.id} points={pts(s.points)} stroke={s.kind === 'door' ? MEP_COLOR.power : s.kind === 'window' ? MEP_COLOR.hvac : ACCENT} strokeWidth={2.2} vectorEffect={NS} opacity={0.85} />
            ))}
          </g>

          {/* Tool previews */}
          {p.tool === 'wall' && wallStart && hover && (
            <g pointerEvents="none">
              <line x1={wallStart.x} y1={wallStart.y} x2={hover.x} y2={hover.y} stroke={ACCENT} strokeWidth={0.23 * k} strokeOpacity={0.25} />
              <line x1={wallStart.x} y1={wallStart.y} x2={hover.x} y2={hover.y} stroke={ACCENT} strokeWidth={1.5} vectorEffect={NS} />
              <LengthLabel a={wallStart} b={hover} k={k} />
            </g>
          )}
          {roomDrag && hover && (
            <g pointerEvents="none">
              <rect
                x={Math.min(roomDrag.start.x, hover.x)}
                y={Math.min(roomDrag.start.y, hover.y)}
                width={Math.abs(hover.x - roomDrag.start.x)}
                height={Math.abs(hover.y - roomDrag.start.y)}
                fill="rgba(47,85,212,0.08)"
                stroke={ACCENT}
                strokeWidth={1.5}
                vectorEffect={NS}
              />
              <LengthLabel a={roomDrag.start} b={{ x: hover.x, y: roomDrag.start.y }} k={k} />
              <LengthLabel a={{ x: hover.x, y: roomDrag.start.y }} b={hover} k={k} />
            </g>
          )}
          {openingPreview && (
            <g pointerEvents="none" opacity={0.9}>
              <polygon points={pts(openingPreview.hit)} fill="rgba(47,85,212,0.08)" />
              {[...openingPreview.lines, ...openingPreview.leaves].map(([a, b], i) => (
                <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={ACCENT} strokeWidth={1.2} vectorEffect={NS} />
              ))}
              {openingPreview.arcs.map((d, i) => (
                <path key={i} d={d} fill="none" stroke={ACCENT} strokeWidth={0.8} vectorEffect={NS} />
              ))}
            </g>
          )}
          {p.tool === 'column' && hover && (
            <rect x={hover.x - 0.15} y={hover.y - 0.15} width={0.3} height={0.3} fill={ACCENT} opacity={0.5} pointerEvents="none" />
          )}
          {measure && (measure.b || hover) && (
            <g pointerEvents="none">
              <line x1={measure.a.x} y1={measure.a.y} x2={(measure.b ?? hover)!.x} y2={(measure.b ?? hover)!.y} stroke={ACCENT} strokeWidth={1.5} strokeDasharray="5 3" vectorEffect={NS} />
              <circle cx={measure.a.x} cy={measure.a.y} r={3 / k} fill={ACCENT} />
              <circle cx={(measure.b ?? hover)!.x} cy={(measure.b ?? hover)!.y} r={3 / k} fill={ACCENT} />
              <LengthLabel a={measure.a} b={(measure.b ?? hover)!} k={k} strong />
            </g>
          )}
          {(p.tool === 'wall' || p.tool === 'measure' || p.tool === 'room_rect') && hover && (
            <circle cx={hover.x} cy={hover.y} r={3.5 / k} fill="none" stroke={ACCENT} strokeWidth={1.5} vectorEffect={NS} pointerEvents="none" />
          )}
      {sewer && <SewagePlan layout={sewer} k={kText} />}
    </>
  );

  return (
    <div ref={surfaceRef} className="relative h-full w-full select-none overflow-hidden" style={{ background: PAPER, touchAction: 'none' }}>
      <svg
        ref={p.svgRef as RefObject<SVGSVGElement>}
        className="as-plan absolute inset-0 h-full w-full"
        data-paper={layout && paper ? paper.drawingNumber : undefined}
        style={{ cursor, fontFamily: 'Inter, system-ui, sans-serif', background: layout ? '#E9E8E4' : undefined }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => setHover(null)}
        onDoubleClick={onDoubleClick}
      >
        <defs>
          <pattern id="as-dots" width={k} height={k} patternUnits="userSpaceOnUse" patternTransform={`translate(${tx} ${ty})`}>
            <circle cx={0.5} cy={0.5} r={0.7} fill={LINE} />
          </pattern>
          <pattern id="as-hatch" width={0.12} height={0.12} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1={0} y1={0} x2={0} y2={0.12} stroke={INK_3} strokeWidth={0.012} />
          </pattern>
        </defs>
        {k >= 18 && !layout && <rect width="100%" height="100%" fill="url(#as-dots)" opacity={0.7} />}

        {layout ? (
          <g transform={`translate(${tx} ${ty}) scale(${vp.view.k})`}>
            <rect x={2} y={3} width={SHEET.w} height={SHEET.h} fill="rgba(0,0,0,0.08)" className="as-scale" />
            {/* One printed sheet: title block and the plan at true scale. */}
            <g data-paper-page="">
              <g className="as-scale" fontFamily="Inter, Helvetica, Arial, sans-serif" dangerouslySetInnerHTML={{ __html: layout.frame }} />
              <g className="as-w" transform={`translate(${layout.x0} ${layout.y0}) scale(${layout.m})`}>
                {world}
              </g>
            </g>
          </g>
        ) : (
          <g transform={`translate(${tx} ${ty}) scale(${k})`}>{world}</g>
        )}
      </svg>

      {/* Overlays */}
      {p.canPaper && (
        <div className="absolute right-3 top-3 z-10 flex gap-1 rounded-[12px] border border-line bg-surface/95 p-1 shadow-float backdrop-blur">
          {[
            { on: true, label: 'Paper' },
            { on: false, label: 'Drawing' },
          ].map((b) => (
            <button key={b.label} onClick={() => p.setPaperOn(b.on)} className={cx('h-7 rounded-[8px] px-3 text-[13px] font-medium', p.paperOn === b.on ? 'bg-ink text-page' : 'text-ink-2 hover:bg-sunken')}>
              {b.label}
            </button>
          ))}
        </div>
      )}
      {mode === 'mep' && (
        <div className="absolute left-3 top-3 flex gap-1 rounded-[12px] border border-line bg-surface/95 p-1 shadow-float backdrop-blur">
          {(['all', 'electrical', 'water'] as MepFilter[]).map((f) => (
            <button
              key={f}
              onClick={() => setMepFilter(f)}
              className={cx('h-7 rounded-[8px] px-3 text-[13px] font-medium capitalize', mepFilter === f ? 'bg-ink text-page' : 'text-ink-2 hover:bg-sunken')}
            >
              {f === 'all' ? 'Water & electrical' : f}
            </button>
          ))}
        </div>
      )}
      {readOnly ? null : p.placing ? (
        <div className="pointer-events-none absolute left-1/2 top-3 hidden -translate-x-1/2 whitespace-nowrap rounded-full bg-ink/85 px-3.5 py-1.5 text-2xs font-medium text-page backdrop-blur lg:block">
          Placing {p.placing.def.name} · click to place · R to turn · Esc to cancel
        </div>
      ) : (
        <ToolHint tool={p.tool} wallStarted={!!wallStart} />
      )}
      <div className="absolute bottom-[146px] right-3 flex flex-col overflow-hidden rounded-[12px] border border-line bg-surface/95 shadow-float backdrop-blur lg:bottom-4">
        <ZoomBtn label="Zoom in" onClick={() => vp.zoomAt(1.25)}>
          <Plus className="h-4 w-4" />
        </ZoomBtn>
        <ZoomBtn label="Zoom out" onClick={() => vp.zoomAt(0.8)}>
          <Minus className="h-4 w-4" />
        </ZoomBtn>
        <ZoomBtn label="Fit drawing" onClick={vp.fit}>
          <Maximize2 className="h-4 w-4" />
        </ZoomBtn>
      </div>
      {!layout && <ScaleAndNorth k={k} />}
    </div>
  );
}

/* ── Pieces ────────────────────────────────────────────────────────── */

function ZoomBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button aria-label={label} title={label} onClick={onClick} className="flex h-9 w-9 items-center justify-center text-ink-2 hover:bg-sunken hover:text-ink">
      {children}
    </button>
  );
}

const HINTS: Partial<Record<CADTool, [string, string]>> = {
  wall: ['Click to start a wall', 'Click to place the next corner · double-click or Esc to finish'],
  room_rect: ['Drag to draw a room', 'Drag to draw a room'],
  door: ['Click a wall to place a door', ''],
  window: ['Click a wall to place a window', ''],
  column: ['Click to place a column', ''],
  measure: ['Click two points to measure', ''],
  sketch_wall: ['Sketch walls freehand, then Make walls', ''],
};

function ToolHint({ tool, wallStarted }: { tool: CADTool; wallStarted: boolean }) {
  const h = HINTS[tool];
  if (!h) return null;
  return (
    <div className="pointer-events-none absolute left-1/2 top-3 hidden -translate-x-1/2 rounded-full bg-ink/85 px-3.5 py-1.5 text-2xs font-medium text-page backdrop-blur lg:block">
      {wallStarted && h[1] ? h[1] : h[0]}
    </div>
  );
}

function ScaleAndNorth({ k }: { k: number }) {
  const steps = [0.5, 1, 2, 5, 10, 20, 50];
  const L = steps.find((s) => s * k >= 70) ?? 50;
  const px = L * k;
  return (
    <div className="pointer-events-none absolute bottom-[146px] left-3 flex items-end gap-4 lg:bottom-4">
      <svg width={28} height={36} viewBox="0 0 28 36" aria-label="North">
        <path d="M14 2 L22 26 L14 21 L6 26 Z" fill={INK} />
        <text x={14} y={35} textAnchor="middle" fontSize={9} fontWeight={600} fill={INK_2}>
          N
        </text>
      </svg>
      <div>
        <svg width={px + 2} height={8}>
          <rect x={1} y={1} width={px / 2} height={5} fill={INK} />
          <rect x={1 + px / 2} y={1} width={px / 2} height={5} fill="none" stroke={INK} strokeWidth={1} />
        </svg>
        <div className="mt-0.5 text-[10px] font-medium tabular-nums text-ink-2" style={{ width: px }}>
          {L} m
        </div>
      </div>
    </div>
  );
}

function LengthLabel({ a, b, k, strong }: { a: Vec; b: Vec; k: number; strong?: boolean }) {
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  if (d < 0.05) return null;
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const s = 1 / k;
  const label = `${d.toFixed(2)} m`;
  const w = (label.length * 6.4 + 12) * s;
  return (
    <g transform={`translate(${mx} ${my - 14 * s})`}>
      <rect x={-w / 2} y={-9 * s} width={w} height={18 * s} rx={9 * s} fill={strong ? ACCENT : INK} />
      <text y={4 * s} textAnchor="middle" fontSize={11 * s} fontWeight={600} fill="#fff" style={{ fontVariantNumeric: 'tabular-nums' }}>
        {label}
      </text>
    </g>
  );
}

function DimChainView({ c, k }: { c: ReturnType<typeof dimensionChains>[number]; k: number }) {
  const horizontal = c.side === 'top' || c.side === 'bottom';
  const P = (s: number, at: number): Vec => (horizontal ? { x: s, y: at } : { x: at, y: s });
  const tick = 0.09;
  const size = Math.max(TEXT.dim, 9.5 / k);
  const textOff = c.side === 'top' || c.side === 'left' ? -size * 0.55 : size * 1.45;
  const line = (a: Vec, b: Vec, key: string) => <line key={key} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />;
  const ticks = (at: number, prefix: string) =>
    c.stops.map((s, i) => {
      const q = P(s, at);
      return <line key={`${prefix}${i}`} x1={q.x - tick} y1={q.y + tick} x2={q.x + tick} y2={q.y - tick} strokeWidth={WEIGHT.medium} />;
    });
  const label = (s0: number, s1: number, at: number, key: string) => {
    const m = P((s0 + s1) / 2, at);
    const len = s1 - s0;
    if (len * k < fmtMM(len).length * size * 0.58 * k + 8) return null;
    return horizontal ? (
      <text key={key} x={m.x} y={m.y + textOff - (c.side === 'top' ? 0 : size * 0.6)} textAnchor="middle" fontSize={size} fill={INK_2} stroke="none">
        {fmtMM(len)}
      </text>
    ) : (
      <text
        key={key}
        x={m.x}
        y={m.y}
        transform={`rotate(-90 ${m.x} ${m.y}) translate(0 ${c.side === 'left' ? textOff : textOff - size * 0.6})`}
        textAnchor="middle"
        fontSize={size}
        fill={INK_2}
        stroke="none"
      >
        {fmtMM(len)}
      </text>
    );
  };
  const first = c.stops[0];
  const last = c.stops[c.stops.length - 1];
  return (
    <g stroke={INK_2} strokeWidth={WEIGHT.hair} vectorEffect={NS} pointerEvents="none" style={{ fontVariantNumeric: 'tabular-nums' }}>
      {c.stops.length > 2 && (
        <>
          {line(P(first, c.at), P(last, c.at), 'chain')}
          {ticks(c.at, 'c')}
          {c.stops.slice(1).map((s, i) => label(c.stops[i], s, c.at, `l${i}`))}
        </>
      )}
      {line(P(first, c.overallAt), P(last, c.overallAt), 'overall')}
      {[first, last].map((s, i) => {
        const q = P(s, c.overallAt);
        return <line key={`o${i}`} x1={q.x - tick} y1={q.y + tick} x2={q.x + tick} y2={q.y - tick} strokeWidth={WEIGHT.medium} />;
      })}
      {label(first, last, c.overallAt, 'ol')}
    </g>
  );
}

function Grid({ model, bounds, k }: { model: BuildingProject; bounds: { minX: number; minY: number; maxX: number; maxY: number }; k: number }) {
  const ext = 1.6;
  const r = 0.28;
  const showText = TEXT.bubble * k >= 6;
  return (
    <g pointerEvents="none">
      {model.grid.xAxes.map((a) => (
        <g key={`x${a.label}`}>
          <line x1={a.coord} y1={bounds.minY - ext} x2={a.coord} y2={bounds.maxY + ext} stroke={INK_3} strokeWidth={WEIGHT.hair} strokeDasharray="10 3 2 3" vectorEffect={NS} />
          {[bounds.minY - ext - r, bounds.maxY + ext + r].map((y, i) => (
            <g key={i}>
              <circle cx={a.coord} cy={y} r={r} fill="#fff" stroke={INK_2} strokeWidth={WEIGHT.light} vectorEffect={NS} />
              {showText && (
                <text x={a.coord} y={y + TEXT.bubble * 0.36} textAnchor="middle" fontSize={TEXT.bubble} fontWeight={600} fill={INK}>
                  {a.label}
                </text>
              )}
            </g>
          ))}
        </g>
      ))}
      {model.grid.yAxes.map((a) => (
        <g key={`y${a.label}`}>
          <line x1={bounds.minX - ext} y1={a.coord} x2={bounds.maxX + ext} y2={a.coord} stroke={INK_3} strokeWidth={WEIGHT.hair} strokeDasharray="10 3 2 3" vectorEffect={NS} />
          {[bounds.minX - ext - r, bounds.maxX + ext + r].map((x, i) => (
            <g key={i}>
              <circle cx={x} cy={a.coord} r={r} fill="#fff" stroke={INK_2} strokeWidth={WEIGHT.light} vectorEffect={NS} />
              {showText && (
                <text x={x} y={a.coord + TEXT.bubble * 0.36} textAnchor="middle" fontSize={TEXT.bubble} fontWeight={600} fill={INK}>
                  {a.label}
                </text>
              )}
            </g>
          ))}
        </g>
      ))}
    </g>
  );
}

function OpeningTag({ s, frame }: { s: ReturnType<typeof openingSymbol>; frame: ReturnType<typeof wallFrame> }) {
  const o = s.opening;
  const side = o.kind === 'door' ? -(o.swingDirection >= 0 ? 1 : -1) : 1;
  const at = { x: s.center.x + frame.n.x * side * (frame.wall.thickness / 2 + 0.28), y: s.center.y + frame.n.y * side * (frame.wall.thickness / 2 + 0.28) };
  const isDoor = o.kind === 'door';
  return (
    <g pointerEvents="none">
      {isDoor ? (
        <circle cx={at.x} cy={at.y} r={0.17} fill="#fff" stroke={INK_2} strokeWidth={WEIGHT.hair} vectorEffect={NS} />
      ) : (
        <rect x={at.x - 0.2} y={at.y - 0.13} width={0.4} height={0.26} rx={0.04} fill="#fff" stroke={INK_2} strokeWidth={WEIGHT.hair} vectorEffect={NS} />
      )}
      <text x={at.x} y={at.y + 0.055} textAnchor="middle" fontSize={0.14} fontWeight={600} fill={INK_2}>
        {o.label}
      </text>
    </g>
  );
}

function SectionMark({ s, k }: { s: BuildingProject['sections'][number]; k: number }) {
  const dx = s.end.x - s.start.x;
  const dy = s.end.y - s.start.y;
  const L = Math.hypot(dx, dy) || 1;
  const n = { x: -dy / L, y: dx / L };
  const letter = s.label.split(/[-–]/)[0] || s.label;
  const r = 0.3;
  return (
    <g pointerEvents="none">
      <line x1={s.start.x} y1={s.start.y} x2={s.end.x} y2={s.end.y} stroke={INK_2} strokeWidth={WEIGHT.light} strokeDasharray="14 4 3 4" vectorEffect={NS} />
      {[s.start, s.end].map((q, i) => (
        <g key={i}>
          <circle cx={q.x} cy={q.y} r={r} fill={INK} />
          <path d={`M${q.x + n.x * r * 0.2} ${q.y + n.y * r * 0.2} L${q.x + n.x * r * 1.9} ${q.y + n.y * r * 1.9}`} stroke={INK} strokeWidth={WEIGHT.cut} vectorEffect={NS} />
          {TEXT.bubble * k >= 6 && (
            <text x={q.x} y={q.y + 0.09} textAnchor="middle" fontSize={0.24} fontWeight={700} fill="#fff">
              {letter}
            </text>
          )}
        </g>
      ))}
    </g>
  );
}

function Stair({ s }: { s: FloorLevel['stairs'][number] }) {
  const along = s.direction === 'N' || s.direction === 'S';
  const w = along ? s.width : s.length;
  const h = along ? s.length : s.width;
  const n = Math.max(2, s.risers);
  const lines: [number, number, number, number][] = [];
  for (let i = 1; i < n; i++) {
    const t = i / n;
    if (along) lines.push([s.origin.x, s.origin.y + h * t, s.origin.x + w, s.origin.y + h * t]);
    else lines.push([s.origin.x + w * t, s.origin.y, s.origin.x + w * t, s.origin.y + h]);
  }
  const cx0 = s.origin.x + w / 2;
  const cy0 = s.origin.y + h / 2;
  const arrow =
    s.direction === 'N'
      ? `M${cx0} ${s.origin.y + h - 0.2} L${cx0} ${s.origin.y + 0.25}`
      : s.direction === 'S'
        ? `M${cx0} ${s.origin.y + 0.2} L${cx0} ${s.origin.y + h - 0.25}`
        : s.direction === 'E'
          ? `M${s.origin.x + 0.2} ${cy0} L${s.origin.x + w - 0.25} ${cy0}`
          : `M${s.origin.x + w - 0.2} ${cy0} L${s.origin.x + 0.25} ${cy0}`;
  return (
    <g pointerEvents="none" stroke={INK_2} fill="none" vectorEffect={NS}>
      <rect x={s.origin.x} y={s.origin.y} width={w} height={h} fill="#fff" strokeWidth={WEIGHT.medium} vectorEffect={NS} />
      {lines.map(([a, b, c, d], i) => (
        <line key={i} x1={a} y1={b} x2={c} y2={d} strokeWidth={WEIGHT.light} vectorEffect={NS} />
      ))}
      <path d={arrow} strokeWidth={WEIGHT.medium} vectorEffect={NS} markerEnd="" />
    </g>
  );
}

function Furniture({ f, selected }: { f: FurnitureItem; selected: boolean }) {
  const def = assetFor(f.type);
  const w = f.width;
  const d = f.depth;
  // Library items draw their own top view; anything unknown is a plain outline.
  const prims = useMemo(
    () => (def ? assetPlan(def, w, d, f.height ?? def.h, isOverhead(def, f.elevation ?? def.elevation)) : [{ k: 'rect' as const, x: -w / 2, y: -d / 2, w, h: d, rx: 0.04, style: 'fill' as const }]),
    [def, w, d, f.height, f.elevation]
  );
  return (
    <g data-kind="furniture" data-id={f.id} transform={`translate(${f.position.x} ${f.position.y}) rotate(${f.rotation})`}>
      <rect x={-w / 2} y={-d / 2} width={w} height={d} fill="transparent" stroke="none" />
      <PlanPrims prims={prims} ink={selected ? ACCENT : INK_2} fill={selected ? '#F3F6FE' : '#FFFFFF'} width={WEIGHT.light + 0.15} />
    </g>
  );
}

/** A grab handle off the back of the selected item; drag it round to turn the item. */
function RotateHandle({ level, id, k, rotating }: { level: FloorLevel; id: string; k: number; rotating: number | null }) {
  const f = level.furniture.find((x) => x.id === id);
  const n = !f ? level.mepNodes.find((x) => x.id === id && (x.model || x.kind === 'ac_split' || x.kind === 'ceiling_fan')) : undefined;
  if (!f && !n) return null;
  const def = f ? assetFor(f.type) : mepAsset(n!);
  const pos = (f ?? n)!.position;
  const rot = (f ? f.rotation : n!.rotation ?? (n!.wallSide ? WALL_SIDE_ROT[n!.wallSide] : 0)) ?? 0;
  const d = f ? f.depth : n?.size?.d ?? def?.d ?? 0.4;
  const w = f ? f.width : n?.size?.w ?? def?.w ?? 0.4;
  const reach = Math.max(d, w * 0.3) / 2 + 26 / k;
  const r = 7 / k;
  return (
    <g transform={`translate(${pos.x} ${pos.y}) rotate(${rot})`}>
      <line x1={0} y1={-d / 2} x2={0} y2={-reach + r} stroke={ACCENT} strokeWidth={1.2} vectorEffect={NS} />
      <circle data-rotate="1" cx={0} cy={-reach} r={r} fill="#FFFFFF" stroke={ACCENT} strokeWidth={1.6} vectorEffect={NS} style={{ cursor: 'grab' }} />
      <path d={`M ${-r * 0.45} ${-reach - r * 0.1} A ${r * 0.45} ${r * 0.45} 0 1 1 ${r * 0.1} ${-reach + r * 0.42}`} fill="none" stroke={ACCENT} strokeWidth={1.1} vectorEffect={NS} style={{ pointerEvents: 'none' }} />
      {rotating !== null && (
        <g transform={`rotate(${-rot} 0 ${-reach - 20 / k})`}>
          <rect x={-22 / k} y={-reach - 30 / k} width={44 / k} height={18 / k} rx={9 / k} fill="#1A1917" />
          <text x={0} y={-reach - 21 / k} fontSize={11 / k} fill="#FFFFFF" textAnchor="middle" dominantBaseline="central" style={{ fontFeatureSettings: '"tnum"' }}>
            {Math.round(rotating)}°
          </text>
        </g>
      )}
    </g>
  );
}

function Fixture({ n, selected }: { n: MEPNode; selected: boolean }) {
  const def = mepAsset(n);
  const sz = def ? mepSize(n, def) : null;
  const prims = useMemo(() => (def && sz ? assetPlan(def, sz.w, sz.d, sz.h, isOverhead(def, n.elevation ?? def.elevation)) : []), [def, sz?.w, sz?.d, sz?.h, n.elevation]);
  if (!def) return null;
  const rot = n.rotation ?? (n.wallSide ? WALL_SIDE_ROT[n.wallSide] : 0);
  return (
    <g data-kind="mep_node" data-id={n.id} transform={`translate(${n.position.x} ${n.position.y}) rotate(${rot})`}>
      {/* Overhead: only its own lines are clickable, so the furniture underneath stays easy to pick. */}
      <g style={{ pointerEvents: 'visibleStroke' }}>
        <PlanPrims prims={prims} ink={selected ? ACCENT : INK_3} width={WEIGHT.light} />
      </g>
    </g>
  );
}

const MEP_GLYPH: Partial<Record<MEPNode['kind'], { letter: string; color: string; group: MepGroup }>> = {
  mdb: { letter: 'DB', color: MEP_COLOR.power, group: 'electrical' },
  sub_db: { letter: 'SDB', color: MEP_COLOR.power, group: 'electrical' },
  utility_meter: { letter: 'M', color: MEP_COLOR.power, group: 'electrical' },
  light_ceiling: { letter: '', color: MEP_COLOR.lighting, group: 'electrical' },
  switch_1g: { letter: 'S', color: MEP_COLOR.lighting, group: 'electrical' },
  outlet_duplex: { letter: '', color: MEP_COLOR.power, group: 'electrical' },
  ac_split: { letter: 'AC', color: MEP_COLOR.hvac, group: 'hvac' },
  ac_condenser: { letter: 'CU', color: MEP_COLOR.hvac, group: 'hvac' },
  ceiling_fan: { letter: 'F', color: MEP_COLOR.hvac, group: 'hvac' },
  water_main: { letter: 'WM', color: MEP_COLOR.plumbingCold, group: 'plumbing' },
  water_heater: { letter: 'WH', color: MEP_COLOR.plumbingHot, group: 'plumbing' },
  plumb_wc: { letter: 'WC', color: MEP_COLOR.drain, group: 'plumbing' },
  plumb_basin: { letter: 'B', color: MEP_COLOR.plumbingCold, group: 'plumbing' },
  plumb_sink: { letter: 'K', color: MEP_COLOR.plumbingCold, group: 'plumbing' },
  plumb_shower: { letter: 'SH', color: MEP_COLOR.plumbingCold, group: 'plumbing' },
  floor_trap: { letter: 'FT', color: MEP_COLOR.drain, group: 'plumbing' },
  solar_pv: { letter: 'PV', color: MEP_COLOR.solar, group: 'electrical' },
  solar_inv: { letter: 'INV', color: MEP_COLOR.solar, group: 'electrical' },
  solar_bess: { letter: 'BAT', color: MEP_COLOR.solar, group: 'electrical' },
};

const CIRCUIT_COLOR: Record<string, { color: string; group: MepGroup; dash?: string }> = {
  electrical_grid: { color: MEP_COLOR.power, group: 'electrical' },
  electrical_submain: { color: MEP_COLOR.power, group: 'electrical' },
  electrical_light: { color: MEP_COLOR.lighting, group: 'electrical', dash: '5 3' },
  electrical_power: { color: MEP_COLOR.power, group: 'electrical' },
  electrical_hvac: { color: MEP_COLOR.hvac, group: 'electrical', dash: '2 3' },
  electrical_pv: { color: MEP_COLOR.solar, group: 'electrical' },
  hvac_refrigerant: { color: MEP_COLOR.hvac, group: 'hvac' },
  hvac_condensate: { color: MEP_COLOR.hvac, group: 'hvac', dash: '3 3' },
  plumbing_cold: { color: MEP_COLOR.plumbingCold, group: 'plumbing' },
  plumbing_hot: { color: MEP_COLOR.plumbingHot, group: 'plumbing' },
  plumbing_drain: { color: MEP_COLOR.drain, group: 'plumbing', dash: '8 3' },
};

/**
 * Drafting convention: wiring between devices is drawn as gentle arcs (it is concealed and
 * routed on site), while pipework is drawn orthogonally along its real run.
 */
function circuitPath(system: string, p: Point2D[]): string {
  let d = `M${p[0].x} ${p[0].y}`;
  const piped = system.startsWith('plumbing') || system === 'hvac_refrigerant' || system === 'hvac_condensate';
  for (let i = 1; i < p.length; i++) {
    const a = p[i - 1];
    const b = p[i];
    if (piped) {
      d += Math.abs(b.x - a.x) > 0.02 && Math.abs(b.y - a.y) > 0.02 ? `L${b.x} ${a.y}L${b.x} ${b.y}` : `L${b.x} ${b.y}`;
    } else {
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const L = Math.hypot(b.x - a.x, b.y - a.y);
      const bulge = Math.min(0.6, L * 0.18);
      const nx = -(b.y - a.y) / (L || 1);
      const ny = (b.x - a.x) / (L || 1);
      d += `Q${mx + nx * bulge} ${my + ny * bulge} ${b.x} ${b.y}`;
    }
  }
  return d;
}

function Mep({ level, filter, selectedId, k }: { level: FloorLevel; filter: MepFilter; selectedId: string | null; k: number }) {
  // Water & electrical plan: cooling units are electrical loads; drainage has its own sheet.
  const show = (g: MepGroup) => filter === 'all' || filter === (g === 'plumbing' ? 'water' : 'electrical');
  const SEWER = ['plumbing_drain', 'hvac_refrigerant', 'hvac_condensate'];
  const r = Math.max(0.14, 9 / k);
  return (
    <g>
      <g fill="none" strokeLinejoin="round" strokeLinecap="round" pointerEvents="none">
        {level.mepCircuits.map((c) => {
          const s = CIRCUIT_COLOR[c.system] ?? { color: INK_3, group: 'electrical' as MepGroup };
          if (!show(s.group) || SEWER.includes(c.system) || c.points.length < 2 || c.system === 'electrical_grid' || c.system === 'electrical_pv') return null;
          return <path key={c.id} d={circuitPath(c.system, c.points)} stroke={s.color} strokeWidth={1.3} strokeDasharray={s.dash} vectorEffect={NS} opacity={0.85} />;
        })}
      </g>
      {level.mepNodes.map((n) => {
        const g = MEP_GLYPH[n.kind] ?? { letter: '•', color: INK_2, group: (n.system === 'plumbing' ? 'plumbing' : 'electrical') as MepGroup };
        if (!show(g.group) || n.kind === 'floor_trap') return null;
        const sel = n.id === selectedId;
        const isLight = n.kind === 'light_ceiling';
        const isOutlet = n.kind === 'outlet_duplex';
        return (
          <g key={n.id} data-kind="mep_node" data-id={n.id} transform={`translate(${n.position.x} ${n.position.y})`}>
            {isLight ? (
              <g stroke={g.color} strokeWidth={1.2} vectorEffect={NS}>
                <circle r={r * 0.9} fill="#fff" vectorEffect={NS} />
                <line x1={-r * 0.64} y1={-r * 0.64} x2={r * 0.64} y2={r * 0.64} vectorEffect={NS} />
                <line x1={r * 0.64} y1={-r * 0.64} x2={-r * 0.64} y2={r * 0.64} vectorEffect={NS} />
              </g>
            ) : isOutlet ? (
              <g stroke={g.color} strokeWidth={1.2} vectorEffect={NS}>
                <path d={`M${-r * 0.8} 0 A${r * 0.8} ${r * 0.8} 0 0 1 ${r * 0.8} 0 Z`} fill="#fff" vectorEffect={NS} />
                <line x1={-r * 0.3} y1={-r * 0.3} x2={-r * 0.3} y2={-r * 0.05} vectorEffect={NS} />
                <line x1={r * 0.3} y1={-r * 0.3} x2={r * 0.3} y2={-r * 0.05} vectorEffect={NS} />
              </g>
            ) : (
              <>
                <rect x={-r * 1.3} y={-r * 0.85} width={r * 2.6} height={r * 1.7} rx={r * 0.35} fill={g.color} />
                <text y={r * 0.33} textAnchor="middle" fontSize={r * (g.letter.length > 2 ? 0.75 : 0.95)} fontWeight={700} fill="#fff">
                  {g.letter}
                </text>
              </>
            )}
            {sel && <circle r={r * 1.8} fill="none" stroke={ACCENT} strokeWidth={2} vectorEffect={NS} />}
          </g>
        );
      })}
    </g>
  );
}

function Selection({
  level,
  geoFrames,
  selectedId,
  k,
}: {
  model: BuildingProject;
  level: FloorLevel;
  geoFrames: Map<string, ReturnType<typeof wallFrame>>;
  selectedId: string | null;
  k: number;
}) {
  if (!selectedId) return null;
  const S = { fill: 'none', stroke: ACCENT, strokeWidth: 2, vectorEffect: NS, pointerEvents: 'none' as const };
  const handle = (q: Vec, key: string) => <rect key={key} x={q.x - 4 / k} y={q.y - 4 / k} width={8 / k} height={8 / k} fill="#fff" stroke={ACCENT} strokeWidth={1.5} vectorEffect={NS} pointerEvents="none" />;

  const wf = geoFrames.get(selectedId);
  if (wf) {
    const t = wf.wall.thickness / 2;
    const q = [along(wf, -t, -t), along(wf, wf.length + t, -t), along(wf, wf.length + t, t), along(wf, -t, t)];
    return (
      <g>
        <polygon points={pts(q)} {...S} />
        {handle(wf.wall.start, 'a')}
        {handle(wf.wall.end, 'b')}
        <LengthLabel a={wf.wall.start} b={wf.wall.end} k={k} strong />
      </g>
    );
  }
  const room = level.rooms.find((r) => r.id === selectedId);
  if (room) return <polygon points={pts(room.polygon)} {...S} fill="rgba(47,85,212,0.07)" />;
  const op = level.openings.find((o) => o.id === selectedId);
  if (op) {
    const f = geoFrames.get(op.wallId);
    if (f) return <polygon points={pts(openingSymbol(f, op).hit)} {...S} />;
  }
  const col = level.columns.find((c) => c.id === selectedId);
  if (col) return <rect x={col.position.x - col.width / 2 - 0.06} y={col.position.y - col.depth / 2 - 0.06} width={col.width + 0.12} height={col.depth + 0.12} {...S} />;
  const fur = level.furniture.find((f) => f.id === selectedId);
  if (fur)
    return (
      <g transform={`translate(${fur.position.x} ${fur.position.y}) rotate(${fur.rotation})`}>
        <rect x={-fur.width / 2 - 0.05} y={-fur.depth / 2 - 0.05} width={fur.width + 0.1} height={fur.depth + 0.1} rx={0.04} {...S} strokeDasharray="5 3" />
      </g>
    );
  return null;
}
