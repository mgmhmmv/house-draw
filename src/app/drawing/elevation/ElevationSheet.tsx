import { useMemo, useRef, useState, type RefObject } from 'react';
import { Maximize2, Minus, Plus } from 'lucide-react';
import type { BuildingProject } from '../../../model/types';
import { cx } from '../../ui';
import { useMediaQuery } from '../../lib/hooks';
import { INK, INK_2, INK_3, PAPER, WEIGHT } from '../style';
import { usePrintMode } from '../printMode';
import { useViewport } from '../useViewport';
import { buildFrame } from '../model3d/faces';
import { defaultSections, ELEVATIONS, project, sectionDrawing, uAt, type Drawing } from '../model3d/project';
import { levelBounds } from '../model3d/faces';
import { fmtMM } from '../plan/kernel';

interface Props {
  model: BuildingProject;
  mode: 'elevations' | 'sections';
  svgRef: RefObject<SVGSVGElement | null>;
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
  section: boolean;
  ox: number;
  oy: number;
}

const GAP_X = 13;

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

export function ElevationSheet({ model, mode, svgRef }: Props) {
  const frame = useMemo(() => buildFrame(model), [model]);
  const sections = useMemo(() => defaultSections(model), [model]);
  const options = mode === 'elevations' ? [{ id: 'all', label: 'All' }, ...ELEVATIONS.map((e) => ({ id: e.id, label: e.name.split(' ')[0] }))] : [{ id: 'all', label: 'All' }, ...sections.map((s) => ({ id: s.id, label: s.label }))];
  // Phones show one drawing at a time; the two-column sheet is for wider screens.
  const wide = useMediaQuery('(min-width: 768px)');
  const [choice, setChoice] = useState(() => (wide ? 'all' : options[1]?.id ?? 'all'));

  const drawings = useMemo(() => {
    const out: ({ key: string; title: string; drawing: Drawing; section: boolean } & Annot)[] = [];
    const b0 = levelBounds(model.levels[0]);
    const corners = [
      { x: b0.minX, y: b0.minY },
      { x: b0.maxX, y: b0.minY },
      { x: b0.maxX, y: b0.maxY },
      { x: b0.minX, y: b0.maxY },
    ];
    if (mode === 'elevations') {
      const cxm = (frame.bounds.minX + frame.bounds.maxX) / 2;
      const cym = (frame.bounds.minY + frame.bounds.maxY) / 2;
      for (const e of ELEVATIONS) {
        if (choice !== 'all' && choice !== e.id) continue;
        const origin = { x: cxm - e.look.x * 60, y: cym - e.look.y * 60 };
        const view = { look: e.look, origin };
        const us = corners.map((c) => uAt(view, c));
        const axes = e.look.y !== 0 ? model.grid.xAxes.map((a) => ({ label: a.label, p: { x: a.coord, y: 0 } })) : model.grid.yAxes.map((a) => ({ label: a.label, p: { x: 0, y: a.coord } }));
        out.push({
          key: e.id,
          title: e.name,
          drawing: project(frame, view),
          section: false,
          grid: axes.map((a) => ({ label: a.label, u: uAt(view, a.p) })),
          width: [Math.min(...us), Math.max(...us)],
        });
      }
    } else {
      for (const s of sections) {
        if (choice !== 'all' && choice !== s.id) continue;
        out.push({ key: s.id, title: `Section ${s.label}`, drawing: sectionDrawing(model, frame, s).drawing, section: true, grid: [], width: null });
      }
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
      bounds: { minX: -3.5, minY: -1, maxX: cols * colW + (cols - 1) * GAP_X + (mode === 'elevations' ? 16 : 6.5), maxY: rows * (rowH + GAP_Y) - GAP_Y + 3 },
    };
  }, [drawings, mode, wide]);

  return <Surface key={`${mode}-${choice}`} placed={placed} bounds={bounds} frameInfo={{ model, eave: frame.eaveZ, ridge: frame.ridgeZ, notes: frame.notes }} svgRef={svgRef} options={options} choice={choice} setChoice={setChoice} />;
}

function Surface({
  placed,
  bounds,
  frameInfo,
  svgRef,
  options,
  choice,
  setChoice,
}: {
  placed: Placed[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  frameInfo: Info;
  svgRef: RefObject<SVGSVGElement | null>;
  options: { id: string; label: string }[];
  choice: string;
  setChoice: (c: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const vp = useViewport(ref, bounds, 48);
  const { k, tx, ty } = vp.view;
  const drag = useRef<{ x: number; y: number } | null>(null);
  const print = usePrintMode();
  const fs = (paper: number, px: number) => (print ? paper : Math.max(paper, px / k));

  return (
    <div ref={ref} className="relative h-full w-full select-none overflow-hidden" style={{ background: PAPER, touchAction: 'none' }}>
      <svg
        ref={svgRef as RefObject<SVGSVGElement>}
        className="as-plan absolute inset-0 h-full w-full"
        style={{ fontFamily: 'Inter, system-ui, sans-serif', cursor: drag.current ? 'grabbing' : 'grab' }}
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
        </defs>
        <g transform={`translate(${tx} ${ty}) scale(${k})`}>
          {placed.map((p) => (
            <g key={p.key} transform={`translate(${p.ox} ${p.oy})`}>
              <DrawingView p={p} k={k} fs={fs} info={frameInfo} />
            </g>
          ))}
        </g>
      </svg>

      {options.length > 2 && (
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
          { label: 'Fit drawing', icon: <Maximize2 className="h-4 w-4" />, on: vp.fit },
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

  return (
    <g>
      {/* Ground */}
      {p.section && <rect x={u0 - 1.5} y={0} width={u1 - u0 + 3} height={0.7} fill="url(#as-earth)" />}
      {/* Faces, each followed by the shadow that falls on it */}
      {d.faces.map((f, i) => {
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
      <path d={d.profile} fill="none" stroke={INK} strokeWidth={1.7} strokeLinejoin="round" />

      {/* Scale figures in front of the building (elevations only) */}
      {!p.section && (
        <g>
          <ScaleFigure u={u0 + 0.9} h={1.78} kind="man" />
          <ScaleFigure u={u0 + 1.55} h={1.65} kind="woman" />
          <ScaleFigure u={u1 - 1.0} h={1.2} kind="child" />
        </g>
      )}

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
      {!p.section && (
        <Notes
          d={d}
          info={info}
          // Clear of the longest datum label.
          x={datumX + 0.3 + Math.max(...datums.map((dt) => dt.name.length + 7)) * textSize * 0.56 + 0.9}
          avoid={datums.map((dt) => -dt.z)}
          textSize={textSize}
        />
      )}

      {/* Level datums */}
      {datums.map((dt, i) => (
        <g key={i}>
          <line x1={u1 + 0.15} y1={-dt.z} x2={datumX + 1.6} y2={-dt.z} stroke={INK_3} strokeWidth={WEIGHT.hair} strokeDasharray="6 3" />
          <path d={`M${datumX} ${-dt.z}l${-0.16} ${-0.24}h0.32Z`} fill={INK} />
          <text x={datumX + 0.3} y={-dt.z - 0.1} fontSize={textSize} fontWeight={600} fill={INK}>
            {dt.name}
            <tspan dx={textSize * 0.5} fontWeight={400} fill={INK_3} style={{ fontVariantNumeric: 'tabular-nums' }}>
              {dt.z >= 0 ? '+' : ''}
              {dt.z.toFixed(2)}
            </tspan>
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
      <g transform={`translate(${u0} ${(p.section ? 0.7 : p.width ? 1.3 : 0) + titleSize * 2})`}>
        <text fontSize={titleSize} fontWeight={600} fill={INK}>
          {p.title}
        </text>
        <text y={titleSize * 1.15} fontSize={titleSize * 0.62} fill={INK_3}>
          Scale 1:100
        </text>
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
 * A standing figure for scale, drawn as an outline the usual way on elevations: a man 1.78 m,
 * a woman 1.65 m, a child 1.20 m. Coordinates: u along the elevation, y = -height.
 */
function ScaleFigure({ u, h, kind }: { u: number; h: number; kind: 'man' | 'woman' | 'child' }) {
  // Body outline in fractions of height (x across, y up), arms hanging.
  const man: [number, number][] = [
    [-0.045, 0.862], [-0.125, 0.835], [-0.15, 0.79], [-0.165, 0.5], [-0.135, 0.495], [-0.12, 0.73], [-0.1, 0.56],
    [-0.095, 0.015], [-0.02, 0.015], [-0.014, 0.47], [0.014, 0.47], [0.02, 0.015], [0.095, 0.015], [0.1, 0.56],
    [0.12, 0.73], [0.135, 0.495], [0.165, 0.5], [0.15, 0.79], [0.125, 0.835], [0.045, 0.862],
  ];
  const woman: [number, number][] = [
    [-0.04, 0.86], [-0.11, 0.835], [-0.135, 0.79], [-0.15, 0.51], [-0.122, 0.505], [-0.105, 0.72], [-0.085, 0.6],
    [-0.15, 0.3], [-0.06, 0.3], [-0.055, 0.015], [-0.015, 0.015], [-0.012, 0.3], [0.012, 0.3], [0.015, 0.015],
    [0.055, 0.015], [0.06, 0.3], [0.15, 0.3], [0.085, 0.6], [0.105, 0.72], [0.122, 0.505], [0.15, 0.51],
    [0.135, 0.79], [0.11, 0.835], [0.04, 0.86],
  ];
  const head = kind === 'child' ? 0.165 : 0.13;
  const body = (kind === 'woman' ? woman : man).map(([x, y]) => [x * (kind === 'child' ? 1.15 : 1), y * (kind === 'child' ? (1 - head) / 0.87 : 1)] as [number, number]);
  const d = body.map(([x, y], i) => `${i ? 'L' : 'M'}${(u + x * h).toFixed(3)} ${(-y * h).toFixed(3)}`).join(' ') + ' Z';
  const r = (head * h) / 2;
  const neckTop = body[0][1] * h;
  return (
    <g fill="rgba(255,255,255,0.88)" stroke={INK_2} strokeWidth={0.7} strokeLinejoin="round">
      <path d={d} />
      <ellipse cx={u} cy={-(neckTop + r * 0.95)} rx={r * 0.82} ry={r} />
    </g>
  );
}
