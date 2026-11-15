import { useState, type ReactNode } from 'react';
import { cx } from '../ui';

/** Shared building blocks for the data sheets (BOQ, electrical, HVAC, plumbing). */

export const fmt = (n: number, d = 0) => n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

export function SheetPage({ code, title, lede, actions, children }: { code: string; title: string; lede?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="h-full overflow-y-auto bg-page">
      <div className="mx-auto w-full max-w-[1180px] px-4 pb-28 pt-6 sm:px-8 lg:pb-12 lg:pt-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="font-mono text-2xs text-ink-3">{code}</div>
            <h1 className="mt-1 text-[24px] font-semibold tracking-tight sm:text-[28px]">{title}</h1>
            {lede && <p className="mt-1.5 max-w-2xl text-sm text-ink-2">{lede}</p>}
          </div>
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </div>
        <div className="mt-6 space-y-5">{children}</div>
      </div>
    </div>
  );
}

export function Kpis({ items }: { items: { label: string; value: string; hint?: string }[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {items.map((k) => (
        <div key={k.label} className="rounded-card border border-line bg-surface px-4 py-3.5">
          <div className="text-2xs font-medium uppercase tracking-wide text-ink-3">{k.label}</div>
          <div className="mt-1 text-[20px] font-semibold tabular-nums tracking-tight">{k.value}</div>
          {k.hint && <div className="mt-0.5 text-2xs text-ink-3">{k.hint}</div>}
        </div>
      ))}
    </div>
  );
}

export function Card({ title, aside, children, flush }: { title: string; aside?: ReactNode; children: ReactNode; flush?: boolean }) {
  return (
    <section className="overflow-hidden rounded-card border border-line bg-surface">
      <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
        <h2 className="text-sm font-semibold">{title}</h2>
        {aside}
      </header>
      <div className={flush ? '' : 'p-5'}>{children}</div>
    </section>
  );
}

export interface Column<T> {
  key: string;
  label: string;
  align?: 'left' | 'right';
  width?: string;
  render: (row: T) => ReactNode;
  mono?: boolean;
}

/** A plain data table: sticky header, tabular numbers, scrolls sideways on phones. */
export function DataTable<T>({ columns, rows, rowKey, group, footer }: { columns: Column<T>[]; rows: T[]; rowKey: (r: T) => string; group?: (r: T) => string; footer?: ReactNode }) {
  let lastGroup: string | null = null;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-line bg-raised">
            {columns.map((c) => (
              <th key={c.key} className={cx('whitespace-nowrap px-4 py-2.5 font-medium text-ink-3', c.align === 'right' ? 'text-right' : 'text-left')} style={{ width: c.width }}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const g = group?.(r);
            const header = g !== undefined && g !== lastGroup;
            lastGroup = g ?? null;
            return [
              header ? (
                <tr key={`g-${g}`} className="bg-raised/60">
                  <td colSpan={columns.length} className="px-4 pb-1.5 pt-4 text-2xs font-semibold uppercase tracking-wide text-ink-2">
                    {g}
                  </td>
                </tr>
              ) : null,
              <tr key={rowKey(r)} className="border-b border-line/70 last:border-b-0 hover:bg-raised">
                {columns.map((c) => (
                  <td key={c.key} className={cx('px-4 py-2.5 align-top', c.align === 'right' ? 'text-right tabular-nums' : '', c.mono && 'font-mono text-2xs text-ink-3')}>
                    {c.render(r)}
                  </td>
                ))}
              </tr>,
            ];
          })}
        </tbody>
        {footer && <tfoot>{footer}</tfoot>}
      </table>
    </div>
  );
}

/**
 * Single-series horizontal bars: one hue, thin marks with rounded data ends, values as
 * direct labels in text colour, and a hover readout per bar.
 */
export function BarList({ items, format, unit }: { items: { label: string; value: number; note?: string }[]; format: (n: number) => string; unit?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <div className="space-y-2.5" role="list">
      {items.map((it, i) => (
        <div
          key={it.label}
          role="listitem"
          className="group grid grid-cols-[minmax(96px,34%)_1fr_auto] items-center gap-3"
          onMouseEnter={() => setHover(i)}
          onMouseLeave={() => setHover(null)}
          title={`${it.label}: ${format(it.value)}${unit ? ` ${unit}` : ''}${it.note ? ` · ${it.note}` : ''}`}
        >
          <span className={cx('truncate text-[13px]', hover === i ? 'text-ink' : 'text-ink-2')}>{it.label}</span>
          <span className="relative h-2.5 rounded-full bg-sunken">
            <span
              className={cx('absolute inset-y-0 left-0 rounded-full transition-[opacity]', hover === null || hover === i ? 'opacity-100' : 'opacity-45')}
              style={{ width: `${Math.max(1.5, (it.value / max) * 100)}%`, background: 'rgb(var(--accent))' }}
            />
          </span>
          <span className="min-w-[72px] text-right text-[13px] tabular-nums text-ink">
            {format(it.value)}
            {it.note && <span className="ml-1.5 text-2xs text-ink-3">{it.note}</span>}
          </span>
        </div>
      ))}
    </div>
  );
}

export function Specs({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="divide-y divide-line">
      {rows.map(([k, val]) => (
        <div key={k} className="grid grid-cols-[minmax(120px,40%)_1fr] gap-4 py-2.5 text-[13px] first:pt-0 last:pb-0">
          <dt className="text-ink-3">{k}</dt>
          <dd className="text-ink">{val}</dd>
        </div>
      ))}
    </dl>
  );
}
