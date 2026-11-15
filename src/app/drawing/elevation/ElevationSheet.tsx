import { useMemo, useRef, useState, type RefObject } from 'react';
import { Maximize2, Minus, Plus } from 'lucide-react';
import { getRoofStructure, ROOF_STRUCTURE_META, type BuildingProject } from '../../../model/types';
import { cx } from '../../ui';
import { useMediaQuery } from '../../lib/hooks';
import { INK, INK_2, INK_3, PAPER, WEIGHT } from '../style';
import { usePrintMode } from '../printMode';
import { useViewport } from '../useViewport';
import * as THREE from 'three';
import { buildScene } from '../three/buildScene';
import { vectorElevation, type VectorDrawing } from '../three/vectorize';
import { ASSET_BY_ID } from '../assets/catalog';
import { AssetMaterials } from '../assets/kit';
import { assetModel } from '../assets/render';
import { buildFrame } from '../model3d/faces';
import { defaultSections, ELEVATIONS, project, sectionDrawing, uAt, type Drawing } from '../model3d/project';
import { levelBounds } from '../model3d/faces';
import { fmtMM } from '../plan/kernel';
import { composeSheet, placeDrawing, PAPER as SHEET, type SheetInfo } from '../../../export/sheet';

interface Props {
  model: BuildingProject;
  mode: 'elevations' | 'sections';
  svgRef: RefObject<SVGSVGElement | null>;
  /** Title-block details: when given, the sheet is shown on paper (A3, as printed). */
  paperInfo?: SheetInfo | null;
}

interface Info {
  model: BuildingProject;
  eave: number;
  ridge: number;
  notes: Partial<Record<string, string>>;
}

interface Annot {
  grid: { label: string; u: number }[];
  /** Wall-to-wall extent along the picture plane. */
  width: [number, number] | null;
}

interface Placed extends Annot {
  key: string;
  title: string;
  drawing: Drawing;
  /** Elevations: the 3D model seen square-on, as vector drawing. */
  vector?: VectorDrawing | null;
  /** Sections: walls cut on the ground floor (for footings) and the roof line (for trusses). */
  cutWalls?: { u: number; t: number; bearing: boolean }[];
  roofLine?: { a: { u: number; z: number }; b: { u: number; z: number } }[];
  plate?: number;
  plateSpan?: [number, number];
  section: boolean;
  ox: number;
  oy: number;
}

const GAP_X = 17;

/** Line weights by surface: openings and texture lighter than walls; the profile is drawn separately. */
const FACE_STROKE: Record<string, { color: string; w: number }> = {
  wall: { color: INK_2, w: 0.7 },
  plinth: { color: INK_2, w: 0.7 },
  roof: { color: INK_2, w: 0.7 },
  fascia: { color: INK_2, w: 0.6 },
  frame: { color: INK, w: 0.5 },
  glass: { color: 'none', w: 0 },
  door: { color: INK_2, w: 0.5 },
  sill: { color: INK_2, w: 0.5 },
  reveal: { color: INK_3, w: 0.4 },
  slab: { color: INK_2, w: 0.6 },
  gutter: { color: INK_2, w: 0.6 },
  downpipe: { color: INK_2, w: 0.5 },
  tank: { color: INK_2, w: 0.6 },
  solar: { color: INK, w: 0.5 },
};
const GAP_Y = 7.5;

export function ElevationSheet({ model, mode, svgRef, paperInfo }: Props) {
  const [paperOn, setPaperOn] = useState(true);
  const frame = useMemo(() => buildFrame(model), [model]);
  const sections = useMemo(() => defaultSections(model), [model]);
  // One drawing at a time (one sheet each); South first.
  const options = mode === 'elevations' ? ELEVATIONS.map((e) => ({ id: e.id, label: e.name.split(' ')[0] })) : sections.map((s) => ({ id: s.id, label: s.label }));
  const wide = useMediaQuery('(min-width: 768px)');
  const [picked, setChoice] = useState(() => options[0]?.id ?? '');
  // When printing, every view goes out (one sheet each); on screen, the one picked.
  const printing = usePrintMode();
  const choice = printing ? 'all' : options.some((o) => o.id === picked) ? picked : options[0]?.id ?? '';

  const drawings = useMemo(() => {
    const out: ({ key: string; title: string; drawing: Drawing; section: boolean; vector?: VectorDrawing | null; cutWalls?: Placed['cutWalls']; roofLine?: Placed['roofLine']; plate?: number; plateSpan?: [number, number] } & Annot)[] = [];
    const b0 = levelBounds(model.levels[0]);
    const corners = [
      { x: b0.minX, y: b0.minY },
      { x: b0.maxX, y: b0.minY },
      { x: b0.maxX, y: b0.maxY },
      { x: b0.minX, y: b0.maxY },
    ];
    if (mode === 'elevations') {
      // The 3D model (building, roof, fittings, outdoor objects), built once for all four views.
      const parts = buildScene(model, false);
      const roots: THREE.Object3D[] = [...parts.levels, parts.roof, parts.site];
      const figureMats = new AssetMaterials(false);
      const cxm = (frame.bounds.minX + frame.bounds.maxX) / 2;
      const cym = (frame.bounds.minY + frame.bounds.maxY) / 2;
      for (const e of ELEVATIONS) {
        if (choice !== 'all' && choice !== e.id) continue;
        const origin = { x: cxm - e.look.x * 60, y: cym - e.look.y * 60 };
        const view = { look: e.look, origin };
        const us = corners.map((c) => uAt(view, c));
        const axes = e.look.y !== 0 ? model.grid.xAxes.map((a) => ({ label: a.label, p: { x: a.coord, y: 0 } })) : model.grid.yAxes.map((a) => ({ label: a.label, p: { x: 0, y: a.coord } }));
        const drawing = project(frame, view);
        // People for scale: the library's 3D figures, standing in front of this facade.
        const people = scaleFigures(frame.bounds, e.look, figureMats);
        const vector = vectorElevation([...roots, people], view);
        people.traverse((o) => o instanceof THREE.Mesh && o.geometry.dispose());
        // Lay out by what is actually drawn (trees and gates can reach past the building).
        const d2 = vector ? { ...drawing, uMin: Math.min(drawing.uMin, vector.uMin + 0.2), uMax: Math.max(drawing.uMax, vector.uMax - 0.2), zMax: Math.max(drawing.zMax, vector.zMax) } : drawing;
        out.push({
          key: e.id,
          title: e.name,
          drawing: d2,
          vector,
          section: false,
          grid: axes.map((a) => ({ label: a.label, u: uAt(view, a.p) })),
          width: [Math.min(...us), Math.max(...us)],
        });
      }
      roots.forEach((r) =>
        r.traverse((o) => {
          if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) o.geometry.dispose();
        })
      );
      parts.materials.forEach((m) => m.dispose());
      figureMats.dispose();
    } else {
      // The 3D model beyond each cut, plus what the cut needs (walls for footings, roof for trusses).
      const parts = buildScene(model, false);
      // The roof is shown by its cut band and its real structure (trusses or rafters, purlins);
      // its far slopes would only hide them.
      const roots: THREE.Object3D[] = [...parts.levels, parts.roofFrame, parts.site];
      for (const s of sections) {
        if (choice !== 'all' && choice !== s.id) continue;
        const { view, drawing } = sectionDrawing(model, frame, s);
        const vector = vectorElevation(roots, view, { clip: true });
        const look = view.look;
        const depth = (p: { x: number; y: number }) => (p.x - view.origin.x) * look.x + (p.y - view.origin.y) * look.y;
        const cuts = (lvl: BuildingProject['levels'][number]) =>
          lvl.walls.flatMap((w) => {
            const da = depth(w.start);
            const db = depth(w.end);
            if ((da >= 0) === (db >= 0) || Math.abs(da - db) < 1e-6) return [];
            const t = da / (da - db);
            const p = { x: w.start.x + (w.end.x - w.start.x) * t, y: w.start.y + (w.end.y - w.start.y) * t };
            // Thickness along the cut grows when the wall crosses at an angle.
            const len = Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y) || 1;
            const across = Math.abs(((w.end.x - w.start.x) * look.x + (w.end.y - w.start.y) * look.y) / len);
            return [{ u: uAt(view, p), t: w.thickness / Math.max(0.2, across), bearing: w.isExterior || w.isLoadBearing }];
          });
        const top = model.levels[model.levels.length - 1];
        const topCuts = cuts(top);
        const roofLine: NonNullable<Placed['roofLine']> = [];
        for (const pl of frame.roofPlanes) {
          const pts: { u: number; z: number }[] = [];
          for (let i = 0; i < pl.pts.length; i++) {
            const a = pl.pts[i];
            const b = pl.pts[(i + 1) % pl.pts.length];
            const da = depth(a);
            const db = depth(b);
            if ((da >= 0) !== (db >= 0)) {
              const tt = da / (da - db);
              pts.push({ u: uAt(view, { x: a.x + (b.x - a.x) * tt, y: a.y + (b.y - a.y) * tt }), z: a.z + (b.z - a.z) * tt });
            }
          }
          if (pts.length >= 2) roofLine.push({ a: pts[0], b: pts[1] });
        }
        const d2 = vector ? { ...drawing, uMin: Math.min(drawing.uMin, vector.uMin + 0.2), uMax: Math.max(drawing.uMax, vector.uMax - 0.2), zMax: Math.max(drawing.zMax, vector.zMax) } : drawing;
        out.push({
          key: s.id,
          title: `Section ${s.label}`,
          drawing: d2,
          vector,
          section: true,
          grid: [],
          width: null,
          cutWalls: cuts(model.levels[0]),
          roofLine,
          plate: top.elevation + Math.max(...top.walls.map((w) => w.height), 2.4),
          plateSpan: topCuts.length >= 2 ? [Math.min(...topCuts.map((c) => c.u)), Math.max(...topCuts.map((c) => c.u))] : undefined,
        });
      }
      [...roots, parts.roof].forEach((r) =>
        r.traverse((o) => {
          if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) o.geometry.dispose();
        })
      );
      parts.materials.forEach((m) => m.dispose());
    }
    return out;
  }, [mode, choice, frame, sections, model]);

  // Lay drawings out on one sheet: two columns for elevations, one column for sections.
  const { placed, bounds } = useMemo(() => {
    const cols = wide && mode === 'elevations' && drawings.length > 1 ? 2 : 1;
    const colW = Math.max(...drawings.map((d) => d.drawing.uMax - d.drawing.uMin), 8);
    const rowH = Math.max(...drawings.map((d) => d.drawing.zMax), 4) + 1.6;
    const placed: Placed[] = drawings.map((d, i) => {
      const c = i % cols;
      const r = Math.floor(i / cols);
      return { ...d, ox: c * (colW + GAP_X) - d.drawing.uMin + (colW - (d.drawing.uMax - d.drawing.uMin)) / 2, oy: r * (rowH + GAP_Y) + rowH };
    });
    const rows = Math.ceil(drawings.length / cols);
    return {
      placed,
      bounds: { minX: -7.5, minY: -1, maxX: cols * colW + (cols - 1) * GAP_X + (mode === 'elevations' ? 16 : 6.5), maxY: rows * (rowH + GAP_Y) - GAP_Y + (mode === 'elevations' ? 3 : 4.5) },
    };
  }, [drawings, mode, wide]);

  const paper = paperOn && paperInfo ? paperInfo : null;
  return (
    <Surface
      key={`${mode}-${choice}-${paper ? 'paper' : 'free'}`}
      placed={placed}
      bounds={bounds}
      frameInfo={{ model, eave: frame.eaveZ, ridge: frame.ridgeZ, notes: frame.notes }}
      svgRef={svgRef}
      options={options}
      choice={choice}
      setChoice={setChoice}
      paper={paper}
      canPaper={!!paperInfo}
      paperOn={paperOn}
      setPaperOn={setPaperOn}
    />
  );
}

function Surface({
  placed,
  bounds,
  frameInfo,
  svgRef,
  options,
  choice,
  setChoice,
  paper,
  canPaper,
  paperOn,
  setPaperOn,
}: {
  placed: Placed[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  frameInfo: Info;
  svgRef: RefObject<SVGSVGElement | null>;
  options: { id: string; label: string }[];
  choice: string;
  setChoice: (c: string) => void;
  paper: SheetInfo | null;
  canPaper: boolean;
  paperOn: boolean;
  setPaperOn: (v: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const print = usePrintMode();
  // On paper, text is at its printed size (it grows and shrinks with the sheet).
  const fs = (paperSize: number, px: number) => (print || paper ? paperSize : Math.max(paperSize, px / k));

  // One drawing per sheet. All sheets share one scale (the one the largest drawing needs) so
  // the set reads consistently; sheets stack like pages.
  const PAGE_GAP = 24;
  const layout = useMemo(() => {
    if (!paper) return null;
    const extent = (p: Placed) => {
      const d = p.drawing;
      // What is actually drawn at print text size: datum names on the left (~4 m at 1:100),
      // level values and the notes column on the right, grid bubbles above, title below.
      return { minX: d.uMin - 4.2, maxX: d.uMax + (p.section ? 3 : 8.2), minY: -(d.zMax + 1.6), maxY: p.section ? 3.3 : 2.9 };
    };
    // One scale for the set (the one the largest drawing needs with its legend beside it).
    const scale = Math.max(100, ...placed.map((p) => placeDrawing(extent(p), paper.legend).scale));
    const pages = placed.map((p, i) => {
      const pl = placeDrawing(extent(p), paper.legend, scale);
      const x0 = pl.x0;
      const y0 = pl.y0;
      const info: SheetInfo = {
        ...paper,
        title: p.title,
        subtitle: undefined,
        drawingNumber: placed.length > 1 ? `${paper.drawingNumber}-${i + 1}` : paper.drawingNumber,
        sheetOf: `${i + 1} of ${placed.length}`,
      };
      const frame = composeSheet(null, info, { scale, footerBar: false, key: pl.key }).svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
      return { p, x0, y0, frame, top: i * (SHEET.h + PAGE_GAP) };
    });
    return { scale, m: 1000 / scale, pages };
  }, [paper, placed]);
  const sheetBounds = { minX: 0, minY: 0, maxX: SHEET.w, maxY: Math.max(1, placed.length) * (SHEET.h + PAGE_GAP) - PAGE_GAP };
  const vp = useViewport(ref, paper ? sheetBounds : bounds, paper ? 24 : 48, paper ? { kMin: 0.25, kMax: 80 } : {});
  const { k, tx, ty } = vp.view;

  return (
    <div ref={ref} className="relative h-full w-full select-none overflow-hidden" style={{ background: PAPER, touchAction: 'none' }}>
      <svg
        ref={svgRef as RefObject<SVGSVGElement>}
        className="as-plan absolute inset-0 h-full w-full"
        data-paper={layout && paper ? paper.drawingNumber : undefined}
        style={{ fontFamily: 'Inter, system-ui, sans-serif', cursor: drag.current ? 'grabbing' : 'grab', background: layout ? '#E9E8E4' : undefined }}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          drag.current = { x: e.clientX, y: e.clientY };
          (e.currentTarget as Element).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drag.current || e.pointerType === 'touch') return;
          vp.panBy(e.clientX - drag.current.x, e.clientY - drag.current.y);
          drag.current = { x: e.clientX, y: e.clientY };
        }}
        onPointerUp={() => (drag.current = null)}
      >
        <defs>
          <pattern id="as-earth" width={0.25} height={0.25} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1={0} y1={0} x2={0} y2={0.25} stroke={INK_3} strokeWidth={0.02} />
          </pattern>
          <pattern id="as-conc" width={0.14} height={0.14} patternUnits="userSpaceOnUse">
            <circle cx={0.03} cy={0.04} r={0.007} fill={INK_3} />
            <circle cx={0.1} cy={0.1} r={0.006} fill={INK_3} />
            <path d="M0.09 0.02 l0.018 0.03 h-0.036 Z" fill="none" stroke={INK_3} strokeWidth={0.005} />
          </pattern>
          <pattern id="as-hardcore" width={0.18} height={0.12} patternUnits="userSpaceOnUse">
            <ellipse cx={0.05} cy={0.06} rx={0.035} ry={0.025} fill="none" stroke={INK_3} strokeWidth={0.008} />
            <ellipse cx={0.135} cy={0.035} rx={0.03} ry={0.02} fill="none" stroke={INK_3} strokeWidth={0.008} />
          </pattern>
          <pattern id="as-block" width={0.1} height={0.1} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1={0} y1={0} x2={0} y2={0.1} stroke={INK_2} strokeWidth={0.01} />
          </pattern>
        </defs>
        {layout ? (
          <g transform={`translate(${tx} ${ty}) scale(${k})`}>
            {layout.pages.map((pg) => (
              <g key={pg.p.key} transform={`translate(0 ${pg.top})`}>
                <rect x={2} y={3} width={SHEET.w} height={SHEET.h} fill="rgba(0,0,0,0.08)" className="as-scale" />
                {/* One printed sheet: title block and the drawing at true scale. */}
                <g data-paper-page="">
                  <g className="as-scale" fontFamily="Inter, Helvetica, Arial, sans-serif" dangerouslySetInnerHTML={{ __html: pg.frame }} />
                  <g className="as-w" transform={`translate(${pg.x0} ${pg.y0}) scale(${layout.m})`}>
                    <DrawingView p={pg.p} k={1e6} fs={fs} info={frameInfo} />
                  </g>
                </g>
              </g>
            ))}
          </g>
        ) : (
          <g transform={`translate(${tx} ${ty}) scale(${k})`}>
            {placed.map((p) => (
              <g key={p.key} transform={`translate(${p.ox} ${p.oy})`}>
                <DrawingView p={p} k={k} fs={fs} info={frameInfo} />
              </g>
            ))}
          </g>
        )}
      </svg>

      {canPaper && (
        <div className="absolute right-3 top-3 flex gap-1 rounded-[12px] border border-line bg-surface/95 p-1 shadow-float backdrop-blur">
          {[
            { on: true, label: 'Paper' },
            { on: false, label: 'Drawing' },
          ].map((b) => (
            <button key={b.label} onClick={() => setPaperOn(b.on)} className={cx('h-7 rounded-[8px] px-3 text-[13px] font-medium', paperOn === b.on ? 'bg-ink text-page' : 'text-ink-2 hover:bg-sunken')}>
              {b.label}
            </button>
          ))}
        </div>
      )}
      {options.length > 1 && (
        <div className="absolute left-3 top-3 flex max-w-[calc(100%-24px)] gap-1 overflow-x-auto rounded-[12px] border border-line bg-surface/95 p-1 shadow-float backdrop-blur no-scrollbar">
          {options.map((o) => (
            <button
              key={o.id}
              onClick={() => setChoice(o.id)}
              className={cx('h-7 shrink-0 rounded-[8px] px-3 text-[13px] font-medium', choice === o.id ? 'bg-ink text-page' : 'text-ink-2 hover:bg-sunken')}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
      <div className="absolute bottom-[84px] right-3 flex flex-col overflow-hidden rounded-[12px] border border-line bg-surface/95 shadow-float backdrop-blur lg:bottom-4">
        {[
          { label: 'Zoom in', icon: <Plus className="h-4 w-4" />, on: () => vp.zoomAt(1.25) },
          { label: 'Zoom out', icon: <Minus className="h-4 w-4" />, on: () => vp.zoomAt(0.8) },
          { label: paper ? 'Fit sheet' : 'Fit drawing', icon: <Maximize2 className="h-4 w-4" />, on: vp.fit },
        ].map((b) => (
          <button key={b.label} aria-label={b.label} title={b.label} onClick={b.on} className="flex h-9 w-9 items-center justify-center text-ink-2 hover:bg-sunken hover:text-ink">
            {b.icon}
          </button>
        ))}
      </div>
    </div>
  );
}

function DrawingView({ p, k, fs, info }: { p: Placed; k: number; fs: (paper: number, px: number) => number; info: Info }) {
  const d = p.drawing;
  const u0 = d.uMin;
  const u1 = d.uMax;
  const datumX = u1 + 0.6;
  const dimX = u0 - 1.1;
  const levels = info.model.levels;
  const datums = [
    ...levels.map((l) => ({ name: l.name.replace(/\s*\(.*\)/, ''), z: l.elevation })),
    { name: 'Eave', z: info.eave },
    ...(info.ridge > info.eave + 0.2 ? [{ name: info.model.roof.type === 'flat' ? 'Parapet' : 'Ridge', z: info.ridge }] : []),
  ];
  const stops = [0, ...datums.map((x) => x.z)].sort((a, b) => a - b).filter((z, i, a) => i === 0 || z - a[i - 1] > 0.05);
  const textSize = fs(0.2, 10);
  const titleSize = fs(0.42, 15);
  // Notes and labels only when they can sit at (close to) paper size; zoomed far out they would pile up.
  const detail = textSize <= 0.34;

  return (
    <g>
      {/* Ground */}
      {p.section && <rect x={u0 - 1.5} y={0} width={u1 - u0 + 3} height={1.15} fill="url(#as-earth)" />}
      {/* Faces, each followed by the shadow that falls on it */}
      {p.vector ? (
        <g>
          {p.vector.fills.map((fl, i) => (
            <path key={i} d={fl.d} fill={fl.fill} fillOpacity={fl.opacity} stroke={fl.opacity < 1 ? 'none' : fl.fill} strokeWidth={0.35} strokeLinejoin="round" />
          ))}
          <path d={p.vector.edges} fill="none" stroke={INK_2} strokeWidth={0.55} strokeLinecap="round" />
          <line x1={u0 - 1.2} y1={0} x2={u1 + 1.2} y2={0} stroke={INK} strokeWidth={1.8} />
        </g>
      ) : d.faces.map((f, i) => {
        const st = FACE_STROKE[f.kind] ?? FACE_STROKE.wall;
        return (
          <g key={i}>
            <path d={f.d} fill={f.fill} fillRule="evenodd" stroke={st.color} strokeWidth={st.w} strokeLinejoin="round" />
            {f.shadow && <path d={f.shadow} fill="rgba(38, 34, 28, 0.17)" fillRule="evenodd" stroke="none" />}
            {f.lines && <path d={f.lines} fill="none" stroke={f.kind === 'roof' ? INK_3 : INK_2} strokeWidth={f.kind === 'roof' ? 0.35 : WEIGHT.hair} opacity={f.kind === 'roof' ? 0.7 : 0.85} />}
            {f.sash && <path d={f.sash} fill="none" stroke={INK_2} strokeWidth={0.5} strokeDasharray="4 3" />}
          </g>
        );
      })}
      {/* Profile: the building's outline, heaviest line after the ground */}
      {!p.vector && <path d={d.profile} fill="none" stroke={INK} strokeWidth={1.7} strokeLinejoin="round" />}



      {/* Grid bubbles */}
      {p.grid.map((g) => {
        const top = d.zMax + 1.0;
        const r = Math.max(0.28, 9 / k);
        return (
          <g key={g.label}>
            <line x1={g.u} y1={0} x2={g.u} y2={-top + r} stroke={INK_3} strokeWidth={WEIGHT.hair} strokeDasharray="10 3 2 3" opacity={0.7} />
            <circle cx={g.u} cy={-top} r={r} fill="#fff" stroke={INK_2} strokeWidth={WEIGHT.light} />
            <text x={g.u} y={-top + r * 0.36} textAnchor="middle" fontSize={r * 0.95} fontWeight={600} fill={INK}>
              {g.label}
            </text>
          </g>
        );
      })}

      {/* Overall width */}
      {p.width && (
        <g stroke={INK_2} strokeWidth={WEIGHT.hair}>
          <line x1={p.width[0]} y1={0.9} x2={p.width[1]} y2={0.9} />
          {p.width.map((u, i) => (
            <g key={i}>
              <line x1={u} y1={0.25} x2={u} y2={1.05} />
              <line x1={u - 0.09} y1={0.99} x2={u + 0.09} y2={0.81} strokeWidth={WEIGHT.medium} />
            </g>
          ))}
          <text x={(p.width[0] + p.width[1]) / 2} y={0.9 - textSize * 0.45} textAnchor="middle" fontSize={textSize} fill={INK_2} stroke="none" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {fmtMM(p.width[1] - p.width[0])}
          </text>
        </g>
      )}

      {/* Section: below-ground build-up, footings and roof trusses, then the cut on top */}
      {p.section && <SectionDetails p={p} info={info} textSize={textSize} notes={detail} />}

      {/* Section cut */}
      {p.section && (
        <>
          <path d={d.cut} fill={INK} stroke={INK} strokeWidth={WEIGHT.cut} />
          <path d={d.roofCut} fill={INK} stroke={INK} strokeWidth={WEIGHT.cut} />
          {d.rooms.filter((r) => r.name.length * fs(0.24, 11) * 0.6 < r.w - 0.3).map((r, i) => (
            <text key={i} x={r.u} y={-r.z} textAnchor="middle" fontSize={fs(0.24, 11)} fontWeight={600} fill={INK_2} stroke={PAPER} strokeWidth={3} style={{ paintOrder: 'stroke' }}>
              {r.name}
            </text>
          ))}
        </>
      )}
      <line x1={u0 - 1.5} y1={0} x2={u1 + 1.5} y2={0} stroke={INK} strokeWidth={2.8} strokeLinecap="square" />

      {/* Opening marks under each exterior window and door */}
      {!p.section &&
        d.faces.map((f, i) => {
          if (!f.tag) return null;
          const isDoor = f.kind === 'door';
          const h = Math.max(0.26, 9 / k);
          const w = Math.max(h * 1.5, f.tag.text.length * h * 0.48 + h * 0.5);
          const y = f.tag.bottom + h * 0.9 + (isDoor ? 0.05 : 0.12);
          return (
            <g key={`t${i}`}>
              {isDoor ? (
                <circle cx={f.tag.u} cy={y} r={h * 0.62} fill="#fff" stroke={INK_2} strokeWidth={WEIGHT.hair} />
              ) : (
                <rect x={f.tag.u - w / 2} y={y - h / 2} width={w} height={h} rx={h * 0.18} fill="#fff" stroke={INK_2} strokeWidth={WEIGHT.hair} />
              )}
              <text x={f.tag.u} y={y + h * 0.3} textAnchor="middle" fontSize={h * 0.68} fontWeight={600} fill={INK_2}>
                {f.tag.text}
              </text>
            </g>
          );
        })}

      {/* Material notes with leaders, in a column to the right */}
      {!p.section && detail && (
        <Notes
          d={d}
          info={info}
          // Clear of the longest datum label.
          x={datumX + 0.3 + Math.max(...datums.map((dt) => dt.name.length + 7)) * textSize * 0.56 + 0.9}
          avoid={datums.map((dt) => -dt.z)}
          textSize={textSize}
        />
      )}

      {/* Level datums: dashed right across, named on the left, value marker on the right */}
      {[{ name: 'Natural ground', z: 0 }, ...datums.filter((dt) => Math.abs(dt.z) > 0.01)].map((dt, i) => (
        <g key={i}>
          <line x1={dimX - 0.25} y1={-dt.z} x2={datumX + 1.6} y2={-dt.z} stroke={INK_3} strokeWidth={WEIGHT.hair} strokeDasharray="6 3" opacity={0.8} />
          <text x={dimX - 0.45} y={-dt.z - textSize * 0.35} textAnchor="end" fontSize={textSize * 0.92} fontWeight={700} fill={INK} letterSpacing={textSize * 0.04} display={detail ? undefined : 'none'}>
            {`${dt.name.toUpperCase()}${/level|ground/i.test(dt.name) ? '' : ' LEVEL'}`}
          </text>
          <path d={`M${datumX} ${-dt.z}l${-0.16} ${-0.24}h0.32Z`} fill={INK} />
          <text x={datumX + 0.3} y={-dt.z - 0.1} fontSize={textSize} fontWeight={600} fill={INK_2} style={{ fontVariantNumeric: 'tabular-nums' }}>
            {dt.z > 0.0005 ? '+' : dt.z < -0.0005 ? '' : '±'}
            {dt.z.toFixed(3)}
          </text>
        </g>
      ))}

      {/* Height dimensions */}
      <g stroke={INK_2} strokeWidth={WEIGHT.hair}>
        <line x1={dimX} y1={-stops[0]} x2={dimX} y2={-stops[stops.length - 1]} />
        {stops.map((z, i) => (
          <line key={i} x1={dimX - 0.09} y1={-z + 0.09} x2={dimX + 0.09} y2={-z - 0.09} strokeWidth={WEIGHT.medium} />
        ))}
        {stops.slice(1).map((z, i) => {
          const len = z - stops[i];
          const fits = len * k >= fmtMM(len).length * textSize * 0.6 * k + 6;
          const m = -(z + stops[i]) / 2;
          if (!fits) {
            // Too short to letter along the line (e.g. the plinth): write it beside, horizontally.
            return (
              <text key={i} x={dimX - 0.25} y={m + textSize * 0.35} textAnchor="end" fontSize={textSize} fill={INK_2} stroke="none" style={{ fontVariantNumeric: 'tabular-nums' }}>
                {fmtMM(len)}
              </text>
            );
          }
          return (
            <text key={i} x={dimX - textSize * 0.5} y={m} transform={`rotate(-90 ${dimX - textSize * 0.5} ${m})`} textAnchor="middle" fontSize={textSize} fill={INK_2} stroke="none" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {fmtMM(len)}
            </text>
          );
        })}
      </g>

      {/* Title */}
      <g transform={`translate(${u0} ${(p.section ? 1.25 : p.width ? 1.3 : 0) + titleSize * 2})`}>
        <text fontSize={titleSize} fontWeight={700} fill={INK} letterSpacing={titleSize * 0.03}>
          {p.title.toUpperCase()}
        </text>
        <line x1={0} y1={titleSize * 0.35} x2={p.title.length * titleSize * 0.66} y2={titleSize * 0.35} stroke={INK} strokeWidth={1.2} />
        {/* Graphical scale: 0–5 m */}
        <g transform={`translate(0 ${titleSize * 1.05})`}>
          {[0, 1, 2, 3, 4].map((m) => (
            <rect key={m} x={m} y={0} width={1} height={0.09} fill={m % 2 ? '#fff' : INK} stroke={INK} strokeWidth={0.6} />
          ))}
          {[0, 1, 2, 3, 4, 5].map((m) => (
            <text key={m} x={m} y={0.09 + textSize * 1.05} textAnchor="middle" fontSize={textSize * 0.75} fill={INK_2}>
              {m === 5 ? '5 m' : m}
            </text>
          ))}
        </g>
      </g>
    </g>
  );
}

const NOTE_ORDER = ['roof', 'solar', 'gutter', 'fascia', 'wall', 'frame', 'door', 'plinth', 'tank'];

function Notes({ d, info, x, avoid, textSize }: { d: Drawing; info: Info; x: number; avoid: number[]; textSize: number }) {
  const items = d.targets
    .filter((t) => info.notes[t.kind])
    .sort((a, b) => a.y - b.y || NOTE_ORDER.indexOf(a.kind) - NOTE_ORDER.indexOf(b.kind));
  // Stack notes top to bottom near their targets, never closer than two lines apart.
  const gap = textSize * 3.2;
  let last = -Infinity;
  const placed = items.map((t) => {
    let y = Math.max(t.y, last + gap);
    // Keep notes off the level datum lines so leaders and text stay readable.
    for (let guard = 0; guard < 6; guard++) {
      const hit = avoid.find((a) => Math.abs(a - y) < textSize * 1.3);
      if (hit === undefined) break;
      y = hit + textSize * 1.4;
    }
    last = y;
    return { ...t, ny: y };
  });
  return (
    <g>
      {placed.map((t) => (
        <g key={t.kind}>
          <circle cx={t.u} cy={t.y} r={textSize * 0.28} fill={INK} />
          <polyline points={`${t.u},${t.y} ${x - 0.6},${t.ny} ${x - 0.15},${t.ny}`} fill="none" stroke={INK_2} strokeWidth={WEIGHT.hair} />
          <text x={x} y={t.ny + textSize * 0.35} fontSize={textSize} fill={INK} stroke={PAPER} strokeWidth={3} style={{ paintOrder: 'stroke' }}>
            {wrap(info.notes[t.kind]!, 30).map((line, i) => (
              <tspan key={i} x={x} dy={i ? textSize * 1.25 : 0}>
                {line}
              </tspan>
            ))}
          </text>
        </g>
      ))}
    </g>
  );
}

/** Break a note into lines of at most `max` characters, on word boundaries. */
function wrap(text: string, max: number): string[] {
  const lines: string[] = [];
  let cur = '';
  for (const w of text.split(' ')) {
    if (cur && (cur + ' ' + w).length > max) {
      lines.push(cur);
      cur = w;
    } else cur = cur ? cur + ' ' + w : w;
  }
  if (cur) lines.push(cur);
  return lines;
}

/**
 * A man (1.78 m), a woman (1.65 m) and a child (1.20 m) from the library, standing on the
 * ground in front of the facade that faces the viewer, turned towards them. Drawing only.
 */
function scaleFigures(b: { minX: number; maxX: number; minY: number; maxY: number }, look: { x: number; y: number }, mats: AssetMaterials) {
  const g = new THREE.Group();
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  const r = { x: -look.y, y: look.x };
  const halfDepth = Math.abs(look.x) * (b.maxX - b.minX) / 2 + Math.abs(look.y) * (b.maxY - b.minY) / 2;
  const halfWidth = Math.abs(r.x) * (b.maxX - b.minX) / 2 + Math.abs(r.y) * (b.maxY - b.minY) / 2;
  const front = halfDepth + 1.4;
  const yaw = Math.atan2(-look.x, -look.y);
  const place = (id: string, along: number) => {
    const def = ASSET_BY_ID.get(id);
    if (!def) return;
    const o = assetModel(def, def.w, def.d, def.h, mats, false);
    o.position.set(cx - look.x * front + r.x * along, 0, cy - look.y * front + r.y * along);
    o.rotation.y = yaw;
    g.add(o);
  };
  place('person_man', -halfWidth + 1.0);
  place('person_woman', -halfWidth + 1.6);
  place('person_child', halfWidth - 1.1);
  g.updateMatrixWorld(true);
  return g;
}

/**
 * What a section shows besides the cut itself, the way sections are issued for approval:
 * the ground-floor build-up under the slab (DPM, hardcore, blinding, compacted earth) with a
 * note stack, strip footings under bearing walls, and the roof trusses with ceiling, joists and
 * roof notes.
 */
function SectionDetails({ p, info, textSize, notes: showNotes }: { p: Placed; info: Info; textSize: number; notes: boolean }) {
  const g0 = info.model.levels[0];
  const ffl = g0.elevation;
  const slab = g0.slabThickness || 0.15;
  const walls = p.cutWalls ?? [];
  const bearing = walls.filter((w) => w.bearing);
  const outer: [number, number] | null = walls.length >= 2 ? [Math.min(...walls.map((w) => w.u)), Math.max(...walls.map((w) => w.u))] : null;
  const y = (z: number) => -z;
  const out: React.ReactNode[] = [];

  if (outer) {
    const [uL, uR] = outer;
    const sb = ffl - slab; // underside of slab
    const hc = 0.15;
    const bl = 0.05;
    // Fill between slab and natural ground (when the floor is raised), then the layers.
    if (sb - hc - bl > 0.01) out.push(<rect key="fill" x={uL} y={y(sb - hc - bl)} width={uR - uL} height={sb - hc - bl} fill="url(#as-conc)" opacity={0.6} />);
    out.push(<rect key="hc" x={uL} y={y(sb)} width={uR - uL} height={hc} fill="#fff" />);
    out.push(<rect key="hc2" x={uL} y={y(sb)} width={uR - uL} height={hc} fill="url(#as-hardcore)" stroke={INK_3} strokeWidth={0.4} />);
    out.push(<rect key="bl" x={uL} y={y(sb - hc)} width={uR - uL} height={bl} fill="url(#as-conc)" stroke={INK_3} strokeWidth={0.4} />);
    out.push(<line key="dpm" x1={uL} y1={y(sb)} x2={uR} y2={y(sb)} stroke={INK} strokeWidth={0.8} strokeDasharray="5 2" />);

    // Strip footings with block stems under bearing walls.
    for (const [i, w] of bearing.entries()) {
      const fw = Math.max(0.6, w.t * 2.6);
      const fb = -0.9;
      const ft = -0.65;
      out.push(
        <g key={`ft${i}`}>
          <rect x={w.u - fw / 2} y={y(ft)} width={fw} height={ft - fb} fill="#fff" stroke={INK} strokeWidth={0.8} />
          <rect x={w.u - fw / 2} y={y(ft)} width={fw} height={ft - fb} fill="url(#as-conc)" />
          <rect x={w.u - w.t / 2} y={y(sb)} width={w.t} height={sb - ft} fill="#fff" stroke={INK} strokeWidth={0.8} />
          <rect x={w.u - w.t / 2} y={y(sb)} width={w.t} height={sb - ft} fill="url(#as-block)" />
        </g>
      );
    }

    // Build-up note stack with arrows to a vertical leader.
    const um = uL + (uR - uL) * 0.42;
    const notes = [
      { t: 'Floor finish to interior specs', z: ffl },
      { t: `${Math.round(slab * 1000)} mm reinforced concrete slab`, z: ffl - slab / 2 },
      { t: 'Damp-proof membrane (DPM)', z: sb },
      { t: '150 mm compacted hardcore bed', z: sb - hc / 2 },
      { t: '50 mm blinding layer', z: sb - hc - bl / 2 },
      { t: 'Compacted earth', z: Math.min(0, sb - hc - bl) - 0.2 },
    ];
    const top = 1.45;
    const gap = textSize * 1.55;
    if (!showNotes) notes.length = 0;
    const yLast = top + gap * (notes.length - 1);
    if (notes.length) out.push(<line key="nl" x1={um} y1={y(ffl)} x2={um} y2={yLast} stroke={INK_2} strokeWidth={0.6} />);
    notes.forEach((n, i) => {
      const ty = top + gap * i;
      out.push(
        <g key={`n${i}`}>
          <circle cx={um} cy={y(n.z)} r={0.035} fill={INK} />
          <line x1={um + 0.08} y1={ty} x2={um + 0.5} y2={ty} stroke={INK_2} strokeWidth={0.5} />
          <path d={`M${um + 0.02} ${ty} l0.12 -0.045 v0.09 Z`} fill={INK_2} />
          <text x={um + 0.58} y={ty + textSize * 0.34} fontSize={textSize} fill={INK}>
            {n.t}
          </text>
        </g>
      );
    });
  }

  // Roof trusses between the outermost walls of the top floor.
  const line = p.roofLine ?? [];
  const plate = p.plate ?? 0;
  const span = p.plateSpan;
  const roofAt = (u: number) => {
    let best = -Infinity;
    for (const s of line) {
      const a = s.a.u <= s.b.u ? s.a : s.b;
      const b = s.a.u <= s.b.u ? s.b : s.a;
      if (u < a.u - 1e-6 || u > b.u + 1e-6 || b.u - a.u < 1e-6) continue;
      best = Math.max(best, a.z + ((u - a.u) / (b.u - a.u)) * (b.z - a.z));
    }
    return best;
  };
  if (span && line.length && info.model.roof.type !== 'flat') {
    const [wl, wr] = span;
    const chord = (u: number) => roofAt(u) - 0.2;
    const peak = Math.max(...[wl, (wl + wr) / 2, wr].map(chord));
    if (peak - plate > 0.4) {
      const mid = (wl + wr) / 2;
      const st = ROOF_STRUCTURE_META[getRoofStructure(info.model.roof).system];
      const cfg = getRoofStructure(info.model.roof);
      const ceil = plate + st.plate.d - 0.02;
      // The structure itself comes from the 3D model behind the cut; the ceiling is drawn here.
      out.push(<line key="ceil" x1={wl} y1={y(ceil)} x2={wr} y2={y(ceil)} stroke={INK} strokeWidth={1.1} />);
      // Roof and ceiling notes with leaders, above the drawing.
      const ridge = Math.max(...line.flatMap((s) => [s.a.z, s.b.z]));
      const notes = [
        { t: info.notes.roof ?? 'Roof covering to specification', at: { u: wl + (mid - wl) * 0.35, z: roofAt(wl + (mid - wl) * 0.35) }, side: -1, row: 1 },
        { t: `${st.purlin.name} purlins at ${Math.round(cfg.purlinSpacing * 1000)} c/c`, at: { u: wl + (mid - wl) * 0.62, z: roofAt(wl + (mid - wl) * 0.62) - 0.08 }, side: -1, row: 0 },
        { t: `${st.label}: ${st.chord.name} at ${Math.round(cfg.spacing * 1000)} c/c`, at: { u: mid + (wr - mid) * 0.45, z: (plate + chord(mid + (wr - mid) * 0.45)) / 2 }, side: 1, row: 1 },
        { t: `Gypsum ceiling board on ${st.kind === 'truss' ? 'battens under bottom chords' : `${st.joist.name}s`}; ${st.plate.name} on walls`, at: { u: mid + (wr - mid) * 0.7, z: ceil }, side: 1, row: 0 },
      ];
      for (const [i, nt] of (showNotes ? notes : []).entries()) {
        const ly = y(ridge + 0.75 + nt.row * textSize * 1.9);
        const lx = mid + nt.side * 0.4;
        out.push(
          <g key={`rn${i}`}>
            <path d={`M${lx} ${ly}L${nt.at.u} ${ly}L${nt.at.u} ${y(nt.at.z)}`} fill="none" stroke={INK_3} strokeWidth={0.5} />
            <circle cx={nt.at.u} cy={y(nt.at.z)} r={0.035} fill={INK} />
            <text x={lx + nt.side * -0.1} y={ly - textSize * 0.3} textAnchor={nt.side < 0 ? 'end' : 'start'} fontSize={textSize} fill={INK}>
              {nt.t}
            </text>
          </g>
        );
      }
    }
  }
  return <g>{out}</g>;
}
