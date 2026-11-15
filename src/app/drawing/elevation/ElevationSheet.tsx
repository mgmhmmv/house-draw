import { useMemo, useRef, useState, type RefObject } from 'react';
import { Maximize2, Minus, Plus } from 'lucide-react';
import type { BuildingProject } from '../../../model/types';
import { cx } from '../../ui';
import { useMediaQuery } from '../../lib/hooks';
import { INK, INK_2, INK_3, PAPER, WEIGHT } from '../style';
import { useViewport } from '../useViewport';
import { buildFrame } from '../model3d/faces';
import { defaultSections, ELEVATIONS, project, sectionDrawing, type Drawing } from '../model3d/project';
import { fmtMM } from '../plan/kernel';

interface Props {
  model: BuildingProject;
  mode: 'elevations' | 'sections';
  svgRef: RefObject<SVGSVGElement | null>;
}

interface Placed {
  key: string;
  title: string;
  drawing: Drawing;
  section: boolean;
  ox: number;
  oy: number;
}

const GAP_X = 6;
const GAP_Y = 6.5;

export function ElevationSheet({ model, mode, svgRef }: Props) {
  const frame = useMemo(() => buildFrame(model), [model]);
  const sections = useMemo(() => defaultSections(model), [model]);
  const options = mode === 'elevations' ? [{ id: 'all', label: 'All' }, ...ELEVATIONS.map((e) => ({ id: e.id, label: e.name.split(' ')[0] }))] : [{ id: 'all', label: 'All' }, ...sections.map((s) => ({ id: s.id, label: s.label }))];
  // Phones show one drawing at a time; the two-column sheet is for wider screens.
  const wide = useMediaQuery('(min-width: 768px)');
  const [choice, setChoice] = useState(() => (wide ? 'all' : options[1]?.id ?? 'all'));

  const drawings = useMemo(() => {
    const out: { key: string; title: string; drawing: Drawing; section: boolean }[] = [];
    if (mode === 'elevations') {
      const cxm = (frame.bounds.minX + frame.bounds.maxX) / 2;
      const cym = (frame.bounds.minY + frame.bounds.maxY) / 2;
      for (const e of ELEVATIONS) {
        if (choice !== 'all' && choice !== e.id) continue;
        const origin = { x: cxm - e.look.x * 60, y: cym - e.look.y * 60 };
        out.push({ key: e.id, title: e.name, drawing: project(frame, { look: e.look, origin }), section: false });
      }
    } else {
      for (const s of sections) {
        if (choice !== 'all' && choice !== s.id) continue;
        out.push({ key: s.id, title: `Section ${s.label}`, drawing: sectionDrawing(model, frame, s).drawing, section: true });
      }
    }
    return out;
  }, [mode, choice, frame, sections, model]);

  // Lay drawings out on one sheet: two columns for elevations, one column for sections.
  const { placed, bounds } = useMemo(() => {
    const cols = wide && mode === 'elevations' && drawings.length > 1 ? 2 : 1;
    const colW = Math.max(...drawings.map((d) => d.drawing.uMax - d.drawing.uMin), 8);
    const rowH = Math.max(...drawings.map((d) => d.drawing.zMax), 4);
    const placed: Placed[] = drawings.map((d, i) => {
      const c = i % cols;
      const r = Math.floor(i / cols);
      return { ...d, ox: c * (colW + GAP_X) - d.drawing.uMin + (colW - (d.drawing.uMax - d.drawing.uMin)) / 2, oy: r * (rowH + GAP_Y) + rowH };
    });
    const rows = Math.ceil(drawings.length / cols);
    return {
      placed,
      bounds: { minX: -3.5, minY: -1, maxX: cols * colW + (cols - 1) * GAP_X + 6.5, maxY: rows * (rowH + GAP_Y) - GAP_Y + 3 },
    };
  }, [drawings, mode, wide]);

  return <Surface key={`${mode}-${choice}`} placed={placed} bounds={bounds} frameInfo={{ model, eave: frame.eaveZ, ridge: frame.ridgeZ }} svgRef={svgRef} options={options} choice={choice} setChoice={setChoice} />;
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
  frameInfo: { model: BuildingProject; eave: number; ridge: number };
  svgRef: RefObject<SVGSVGElement | null>;
  options: { id: string; label: string }[];
  choice: string;
  setChoice: (c: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const vp = useViewport(ref, bounds, 48);
  const { k, tx, ty } = vp.view;
  const drag = useRef<{ x: number; y: number } | null>(null);
  const fs = (paper: number, px: number) => Math.max(paper, px / k);

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

function DrawingView({ p, k, fs, info }: { p: Placed; k: number; fs: (paper: number, px: number) => number; info: { model: BuildingProject; eave: number; ridge: number } }) {
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
      {/* Faces */}
      {d.faces.map((f, i) => (
        <g key={i}>
          <path d={f.d} fill={f.fill} fillRule="evenodd" stroke={f.kind === 'glass' || f.kind === 'door' ? INK_2 : INK} strokeWidth={f.kind === 'reveal' ? WEIGHT.hair : WEIGHT.light} strokeLinejoin="round" />
          {f.lines && <path d={f.lines} fill="none" stroke={f.kind === 'roof' ? INK_3 : INK_2} strokeWidth={WEIGHT.hair} opacity={f.kind === 'roof' ? 0.55 : 0.9} />}
        </g>
      ))}
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
      <line x1={u0 - 1.5} y1={0} x2={u1 + 1.5} y2={0} stroke={INK} strokeWidth={2.4} strokeLinecap="square" />

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
          if (len * k < fmtMM(len).length * textSize * 0.6 * k + 6) return null;
          const m = -(z + stops[i]) / 2;
          return (
            <text key={i} x={dimX - textSize * 0.5} y={m} transform={`rotate(-90 ${dimX - textSize * 0.5} ${m})`} textAnchor="middle" fontSize={textSize} fill={INK_2} stroke="none" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {fmtMM(len)}
            </text>
          );
        })}
      </g>

      {/* Title */}
      <g transform={`translate(${u0} ${(p.section ? 0.7 : 0) + titleSize * 2})`}>
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
