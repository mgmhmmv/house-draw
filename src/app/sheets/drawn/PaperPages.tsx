import { useMemo, useRef } from 'react';
import { Maximize2, Minus, Plus } from 'lucide-react';
import { composeSheet, PAPER as SHEET, type SheetInfo } from '../../../export/sheet';
import { useViewport } from '../../drawing/useViewport';
import type { DrawnPage } from './electrical';

const GAP = 24;

/**
 * Diagram sheets drawn straight on A3 paper (millimetres), stacked like pages, with pan and
 * zoom. The same markup is what prints: each `data-paper-page` is one sheet.
 */
export function PaperPages({ pages, info }: { pages: DrawnPage[]; info: SheetInfo }) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const sheets = useMemo(
    () =>
      pages.map((pg, i) => {
        const pi: SheetInfo = {
          ...info,
          title: pg.title,
          subtitle: undefined,
          legend: pg.legend,
          drawingNumber: pages.length > 1 ? `${info.drawingNumber}-${i + 1}` : info.drawingNumber,
          sheetOf: `${i + 1} of ${pages.length}`,
        };
        const frame = composeSheet(null, pi, { key: pg.key }).svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
        return { html: frame + pg.body, top: i * (SHEET.h + GAP) };
      }),
    [pages, info]
  );
  const bounds = { minX: 0, minY: 0, maxX: SHEET.w, maxY: pages.length * (SHEET.h + GAP) - GAP };
  const vp = useViewport(ref, bounds, 24, { kMin: 0.25, kMax: 80 });
  const { k, tx, ty } = vp.view;
  return (
    <div ref={ref} className="relative h-full w-full select-none overflow-hidden" style={{ touchAction: 'none' }}>
      <svg
        className="as-plan absolute inset-0 h-full w-full"
        data-paper={info.drawingNumber}
        style={{ background: '#E9E8E4', cursor: drag.current ? 'grabbing' : 'grab', fontFamily: 'Inter, system-ui, sans-serif' }}
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
        <g transform={`translate(${tx} ${ty}) scale(${k})`}>
          {sheets.map((s, i) => (
            <g key={i} transform={`translate(0 ${s.top})`}>
              <rect x={2} y={3} width={SHEET.w} height={SHEET.h} fill="rgba(0,0,0,0.08)" className="as-scale" />
              <g data-paper-page="">
                <g className="as-scale" fontFamily="Inter, Helvetica, Arial, sans-serif" dangerouslySetInnerHTML={{ __html: s.html }} />
              </g>
            </g>
          ))}
        </g>
      </svg>
      <div className="absolute bottom-[84px] right-3 flex flex-col overflow-hidden rounded-[12px] border border-line bg-surface/95 shadow-float backdrop-blur lg:bottom-4">
        {[
          { label: 'Zoom in', icon: <Plus className="h-4 w-4" />, on: () => vp.zoomAt(1.25) },
          { label: 'Zoom out', icon: <Minus className="h-4 w-4" />, on: () => vp.zoomAt(0.8) },
          { label: 'Fit sheet', icon: <Maximize2 className="h-4 w-4" />, on: vp.fit },
        ].map((b) => (
          <button key={b.label} aria-label={b.label} title={b.label} onClick={b.on} className="flex h-9 w-9 items-center justify-center text-ink-2 hover:bg-sunken hover:text-ink">
            {b.icon}
          </button>
        ))}
      </div>
    </div>
  );
}
