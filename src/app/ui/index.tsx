import { forwardRef, useEffect, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, X } from 'lucide-react';
import type { ProjectStatus } from '../lib/api';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

/* ── Brand ─────────────────────────────────────────────────────────── */

export function Logo({ size = 28, withWord = true }: { size?: number; withWord?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
        <rect width="32" height="32" rx="8" className="fill-ink" />
        <path d="M8 23V14l8-6 8 6v9" fill="none" className="stroke-page" strokeWidth="2.2" strokeLinejoin="round" />
        <path d="M13 23v-5h6v5" fill="none" stroke="#7896FF" strokeWidth="2.2" strokeLinejoin="round" />
      </svg>
      {withWord && <span className="text-[15px] font-semibold tracking-tight">ArchStudio</span>}
    </span>
  );
}

/* ── Buttons ───────────────────────────────────────────────────────── */

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

const btnBase =
  'inline-flex items-center justify-center gap-2 font-medium rounded-ctl transition-colors select-none disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap';
const btnVariant: Record<Variant, string> = {
  primary: 'bg-ink text-page hover:bg-ink/85',
  secondary: 'bg-surface text-ink border border-line hover:bg-raised hover:border-line-strong shadow-card',
  ghost: 'text-ink-2 hover:text-ink hover:bg-sunken/70',
  danger: 'bg-danger text-white hover:bg-danger/90',
};
const btnSize: Record<Size, string> = {
  sm: 'h-8 px-3 text-[13px]',
  md: 'h-10 px-4 text-sm',
  lg: 'h-12 px-5 text-[15px]',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, icon, className, children, disabled, ...rest },
  ref
) {
  return (
    <button ref={ref} className={cx(btnBase, btnVariant[variant], btnSize[size], className)} disabled={disabled || loading} {...rest}>
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {children}
    </button>
  );
});

export const IconButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean; size?: 'sm' | 'md' }>(
  function IconButton({ label, active, size = 'md', className, children, ...rest }, ref) {
    return (
      <button
        ref={ref}
        aria-label={label}
        title={label}
        className={cx(
          'inline-flex items-center justify-center rounded-ctl transition-colors disabled:opacity-40 disabled:pointer-events-none',
          size === 'sm' ? 'h-8 w-8' : 'h-10 w-10',
          active ? 'bg-ink text-page' : 'text-ink-2 hover:text-ink hover:bg-sunken/70',
          className
        )}
        {...rest}
      >
        {children}
      </button>
    );
  }
);

/* ── Form controls ─────────────────────────────────────────────────── */

const fieldBase =
  'w-full rounded-ctl border border-line bg-surface text-ink placeholder:text-ink-3 transition-shadow focus:outline-none focus:border-accent focus:ring-4 focus:ring-accent/15';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { inputSize?: 'sm' | 'md' }>(function Input(
  { className, inputSize = 'md', ...rest },
  ref
) {
  return <input ref={ref} className={cx(fieldBase, inputSize === 'sm' ? 'h-8 px-2.5 text-[13px]' : 'h-11 px-3.5 text-[15px] sm:text-sm', className)} {...rest} />;
});

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx(fieldBase, 'h-8 px-2 text-[13px] appearance-auto', className)} {...rest}>
      {children}
    </select>
  );
}

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-ink-2">{label}</span>
      {children}
      {error ? <span className="mt-1.5 block text-[13px] text-danger">{error}</span> : hint ? <span className="mt-1.5 block text-[13px] text-ink-3">{hint}</span> : null}
    </label>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cx('relative h-6 w-10 shrink-0 rounded-full transition-colors', checked ? 'bg-accent' : 'bg-line-strong')}
    >
      <span className={cx('absolute left-0 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-[18px]' : 'translate-x-0.5')} />
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; title?: string }[];
  className?: string;
}) {
  return (
    <div className={cx('inline-flex rounded-ctl bg-sunken p-0.5', className)} role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={o.value === value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cx(
            'h-7 rounded-[8px] px-3 text-[13px] font-medium transition-colors',
            o.value === value ? 'bg-surface text-ink shadow-card' : 'text-ink-2 hover:text-ink'
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ── Display ───────────────────────────────────────────────────────── */

export const STATUS_META: Record<ProjectStatus, { label: string; dot: string; hint: string }> = {
  brief: { label: 'Brief', dot: 'bg-ink-3', hint: 'Enquiry, site and requirements' },
  concept: { label: 'Concept', dot: 'bg-sky-400', hint: 'Early layouts and massing' },
  design: { label: 'Design', dot: 'bg-accent', hint: 'Developing the chosen design' },
  drawings: { label: 'Drawings', dot: 'bg-violet-500', hint: 'Working drawings, MEP and BOQ' },
  review: { label: 'Client review', dot: 'bg-warn', hint: 'With the client for sign-off or approvals' },
  handover: { label: 'Handed over', dot: 'bg-orange-500', hint: 'Delivered, waiting for payment' },
  done: { label: 'Done', dot: 'bg-ok', hint: 'Handed over and paid' },
  archived: { label: 'Archived', dot: 'bg-line-strong', hint: 'Put away' },
};

export function StatusPill({ status }: { status: ProjectStatus }) {
  const m = STATUS_META[status] ?? STATUS_META.concept;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-sunken px-2.5 py-0.5 text-2xs font-medium text-ink-2">
      <span className={cx('h-1.5 w-1.5 rounded-full', m.dot)} />
      {m.label}
    </span>
  );
}

export function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-accent-soft font-semibold text-accent"
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      {initials || '?'}
    </span>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx('h-5 w-5 animate-spin text-ink-3', className)} />;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-line bg-raised px-1.5 py-0.5 font-mono text-2xs text-ink-3">{children}</kbd>;
}

/* ── Overlays ──────────────────────────────────────────────────────── */

/** Centered dialog on desktop, bottom sheet on phones. */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" onClick={onClose} />
      <div
        role="dialog"
        aria-modal
        aria-label={title}
        className={cx(
          'relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-sheet bg-surface shadow-float sm:rounded-sheet animate-sheet-up sm:animate-fade-up',
          wide ? 'sm:max-w-3xl' : 'sm:max-w-lg'
        )}
      >
        <div className="flex items-start justify-between gap-4 px-6 pb-2 pt-6">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
            {description && <p className="mt-1 text-sm text-ink-2">{description}</p>}
          </div>
          <IconButton label="Close" size="sm" onClick={onClose} className="-mr-2 -mt-1">
            <X className="h-4 w-4" />
          </IconButton>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-6 py-4 pb-safe">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}

/** A small popover menu anchored to its trigger. */
export function Menu({
  trigger,
  children,
  align = 'end',
  side = 'bottom',
}: {
  trigger: (props: { onClick: () => void; 'aria-expanded': boolean }) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: 'start' | 'end';
  side?: 'top' | 'bottom';
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    const inside = (t: EventTarget | null) => ref.current?.contains(t as Node) || menuRef.current?.contains(t as Node);
    const onDown = (e: PointerEvent) => !inside(e.target) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onMove = (e: Event) => !inside(e.target) && setOpen(false);
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
    };
  }, [open]);

  // The menu floats above the page (portal + fixed position), so a card with overflow
  // hidden can't clip it. Placed against the trigger, flipped if it would leave the screen.
  useLayoutEffect(() => {
    if (!open) return setPos(null);
    const t = ref.current?.getBoundingClientRect();
    const m = menuRef.current?.getBoundingClientRect();
    if (!t || !m) return;
    const gap = 6;
    const margin = 8;
    let top = side === 'bottom' ? t.bottom + gap : t.top - gap - m.height;
    if (side === 'bottom' && top + m.height > window.innerHeight - margin && t.top - gap - m.height > margin) top = t.top - gap - m.height;
    if (side === 'top' && top < margin) top = t.bottom + gap;
    let left = align === 'end' ? t.right - m.width : t.left;
    left = Math.min(Math.max(margin, left), window.innerWidth - m.width - margin);
    setPos({ top: Math.max(margin, top), left });
  }, [open, side, align]);

  return (
    <div ref={ref} className="relative">
      {trigger({ onClick: () => setOpen((o) => !o), 'aria-expanded': open })}
      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={{ position: 'fixed', top: pos?.top ?? -9999, left: pos?.left ?? -9999, visibility: pos ? 'visible' : 'hidden' }}
            className="z-[55] max-h-[70vh] min-w-[200px] overflow-y-auto rounded-[12px] border border-line bg-surface p-1 shadow-float animate-fade-up"
          >
            {children(() => setOpen(false))}
          </div>,
          document.body
        )}
    </div>
  );
}

export function MenuItem({ icon, children, onClick, danger }: { icon?: ReactNode; children: ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className={cx(
        'flex w-full items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-left text-[13px] transition-colors',
        danger ? 'text-danger hover:bg-danger/10' : 'text-ink hover:bg-sunken'
      )}
    >
      {icon && <span className="text-ink-3 [&>svg]:h-4 [&>svg]:w-4">{icon}</span>}
      {children}
    </button>
  );
}

/* ── Toast ─────────────────────────────────────────────────────────── */

let pushToast: ((msg: string) => void) | null = null;
export const toast = (msg: string) => pushToast?.(msg);

export function Toaster() {
  const [items, setItems] = useState<{ id: number; msg: string }[]>([]);
  useEffect(() => {
    pushToast = (msg) => {
      const id = Date.now() + Math.random();
      setItems((s) => [...s.slice(-2), { id, msg }]);
      setTimeout(() => setItems((s) => s.filter((i) => i.id !== id)), 3200);
    };
    return () => {
      pushToast = null;
    };
  }, []);
  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 lg:bottom-6">
      {items.map((i) => (
        <div key={i.id} className="rounded-full bg-ink px-4 py-2.5 text-[13px] font-medium text-page shadow-float animate-fade-up">
          {i.msg}
        </div>
      ))}
    </div>,
    document.body
  );
}
