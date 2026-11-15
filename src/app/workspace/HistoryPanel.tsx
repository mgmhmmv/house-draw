import { useCallback, useEffect, useRef, useState } from 'react';
import { Eye, History, PlusCircle, RotateCcw, Sparkles, Upload } from 'lucide-react';
import { api, type ProjectVersion } from '../lib/api';
import { cx, Spinner, toast } from '../ui';

const ago = (t: number) => {
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: s > 300 * 86400 ? 'numeric' : undefined });
};
const clock = (t: number) => new Date(t).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

const ICON = { ai: Sparkles, restore: RotateCcw, create: PlusCircle, import: Upload, edit: History } as const;

/**
 * Every saved version of the project, newest first. Any of them can be previewed on the canvas,
 * and restored in two clicks (Restore → Confirm). A restore is saved as a new version, so nothing
 * is ever lost.
 */
export function HistoryPanel({
  projectId,
  current,
  onRestore,
  onPreview,
  previewing,
}: {
  projectId: string;
  current: number;
  onRestore: (v: number) => Promise<void>;
  onPreview: (v: ProjectVersion) => void;
  previewing: number | null;
}) {
  const [items, setItems] = useState<ProjectVersion[] | null>(null);
  const [more, setMore] = useState(false);
  const [arming, setArming] = useState<number | null>(null);
  const [restoring, setRestoring] = useState<number | null>(null);
  const armTimer = useRef<number>();

  const load = useCallback(() => {
    api
      .versions(projectId)
      .then((r) => {
        setItems(r.versions);
        setMore(r.versions.length === 50);
      })
      .catch(() => setItems((x) => x ?? []));
  }, [projectId]);

  // Refresh shortly after each save.
  useEffect(() => {
    const t = window.setTimeout(load, 300);
    return () => window.clearTimeout(t);
  }, [load, current]);

  const loadMore = () => {
    const last = items?.[items.length - 1];
    if (!last) return;
    api.versions(projectId, last.version).then((r) => {
      setItems((x) => [...(x ?? []), ...r.versions]);
      setMore(r.versions.length === 50);
    });
  };

  const click = async (v: number) => {
    window.clearTimeout(armTimer.current);
    if (arming !== v) {
      setArming(v);
      armTimer.current = window.setTimeout(() => setArming(null), 4000);
      return;
    }
    setArming(null);
    setRestoring(v);
    try {
      await onRestore(v);
      toast(`Restored version ${v}`);
    } catch {
      toast('Could not restore that version.');
    } finally {
      setRestoring(null);
    }
  };

  if (!items)
    return (
      <div className="flex justify-center py-6">
        <Spinner className="h-4 w-4" />
      </div>
    );
  if (!items.length) return <p className="px-4 py-4 text-[13px] text-ink-3">Versions appear here as you save.</p>;

  return (
    <div className="space-y-1">
      {items.map((v) => {
        const Icon = ICON[v.source] ?? History;
        const isCurrent = v.version === current;
        const armed = arming === v.version;
        const shown = previewing === v.version;
        return (
          <div
            key={v.version}
            className={cx('rounded-ctl border px-3 py-2.5', shown ? 'border-accent/50 bg-accent-soft/40' : isCurrent ? 'border-line bg-raised' : 'border-transparent hover:border-line')}
            title={`Version ${v.version} · ${clock(v.createdAt)}`}
          >
            <div className="flex items-start gap-2.5">
              <Icon className={cx('mt-0.5 h-4 w-4 shrink-0', v.source === 'ai' ? 'text-accent' : 'text-ink-3')} />
              <div className="min-w-0 flex-1">
                <p className="line-clamp-3 text-[13px] leading-snug text-ink">{v.label || 'Edited'}</p>
                <p className="mt-0.5 text-2xs text-ink-3">
                  v{v.version} · {ago(v.createdAt)}
                  {v.summary.area ? ` · ${Math.round(v.summary.area)} m²` : ''}
                  {isCurrent && <span className="ml-1 font-medium text-accent">· current</span>}
                </p>
                {!isCurrent && (
                  <div className="mt-2 flex gap-1.5">
                    <button
                      onClick={() => onPreview(v)}
                      className={cx(
                        'inline-flex h-7 items-center gap-1 rounded-[8px] border px-2.5 text-2xs font-medium transition-colors',
                        shown ? 'border-accent/40 text-accent' : 'border-line text-ink-2 hover:text-ink'
                      )}
                    >
                      <Eye className="h-3 w-3" /> {shown ? 'Previewing' : 'Preview'}
                    </button>
                    <button
                      onClick={() => click(v.version)}
                      disabled={restoring !== null}
                      className={cx(
                        'inline-flex h-7 items-center gap-1 rounded-[8px] px-2.5 text-2xs font-medium transition-colors',
                        armed ? 'bg-accent text-accent-ink' : 'border border-line text-ink-2 hover:text-ink'
                      )}
                    >
                      {restoring === v.version ? <Spinner className="h-3 w-3" /> : <RotateCcw className="h-3 w-3" />}
                      {armed ? 'Click to confirm' : 'Restore'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
      {more && (
        <button onClick={loadMore} className="w-full px-2 py-2 text-left text-2xs font-medium text-accent hover:underline">
          Show older versions
        </button>
      )}
    </div>
  );
}
