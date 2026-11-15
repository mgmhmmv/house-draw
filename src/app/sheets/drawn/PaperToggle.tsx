import { cx } from '../../ui';

/** Paper (the printed A3 sheets) or Report (the working figures), top right. */
export function PaperToggle({ paper, setPaper }: { paper: boolean; setPaper: (v: boolean) => void }) {
  return (
    <div className="absolute right-3 top-3 z-10 flex gap-1 rounded-[12px] border border-line bg-surface/95 p-1 shadow-float backdrop-blur">
      {[
        { on: true, label: 'Paper' },
        { on: false, label: 'Report' },
      ].map((b) => (
        <button key={b.label} onClick={() => setPaper(b.on)} className={cx('h-7 rounded-[8px] px-3 text-[13px] font-medium', paper === b.on ? 'bg-ink text-page' : 'text-ink-2 hover:bg-sunken')}>
          {b.label}
        </button>
      ))}
    </div>
  );
}
