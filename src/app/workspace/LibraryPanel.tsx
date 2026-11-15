import { useEffect, useMemo, useState } from 'react';
import { Box, Search, Sparkles, Square, Trash2 } from 'lucide-react';
import { ASSETS, CATEGORIES, defFromSpec, onAssetsChanged, type AssetDef, type Category, type CustomAssetSpec } from '../drawing/assets/catalog';
import { deleteCustomAsset, designAsset, saveCustomAsset } from '../lib/customAssets';
import { Button, cx, Spinner, toast } from '../ui';
import { assetPlan, assetThumb } from '../drawing/assets/render';
import { PlanSymbolSvg } from '../drawing/assets/PlanSymbol';

/* Thumbnails render one at a time in idle moments, so opening the library never stalls the page. */
const queue: { def: AssetDef; done: (url: string | null) => void }[] = [];
let running = false;
function pump() {
  if (running) return;
  running = true;
  const step = () => {
    const job = queue.shift();
    if (!job) {
      running = false;
      return;
    }
    job.done(assetThumb(job.def));
    setTimeout(step, 8);
  };
  setTimeout(step, 0);
}
function useThumb(def: AssetDef) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    queue.push({ def, done: (u) => live && setUrl(u) });
    pump();
    return () => {
      live = false;
    };
  }, [def]);
  return url;
}

/**
 * The asset library: furniture, fittings, equipment, trees, gates and openings. Every item has a
 * 3D model and a matching plan symbol; picking one starts placing it on the plan.
 */
export function LibraryPanel({ onPick, placingId }: { onPick: (def: AssetDef) => void; placingId: string | null }) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<Category | 'all'>('all');
  const [view, setView] = useState<'3d' | '2d'>('3d');
  // User-made objects arrive after load; redraw when they do.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const off = onAssetsChanged(() => setTick((t) => t + 1));
    return () => {
      off();
    };
  }, []);

  const items = useMemo(() => {
    const t = q.trim().toLowerCase();
    return ASSETS.filter((a) => (cat === 'all' || a.category === cat) && (!t || `${a.name} ${a.keywords ?? ''} ${a.category}`.toLowerCase().includes(t)));
  }, [q, cat, tick]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-2.5 border-b border-line px-3 pb-3 pt-3">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search furniture, trees, gates…"
              className="h-9 w-full rounded-ctl border border-line bg-surface pl-9 pr-3 text-[13px] placeholder:text-ink-3 focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15"
            />
          </div>
          <div className="flex rounded-ctl border border-line p-0.5">
            {(['3d', '2d'] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                title={v === '3d' ? '3D models' : 'Plan symbols'}
                className={cx('flex h-7 w-8 items-center justify-center rounded-[7px]', view === v ? 'bg-ink text-page' : 'text-ink-3 hover:text-ink')}
              >
                {v === '3d' ? <Box className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
              </button>
            ))}
          </div>
        </div>
        <div className="-mx-3 flex gap-1.5 overflow-x-auto px-3 no-scrollbar">
          {[{ id: 'all' as const, name: 'All' }, ...CATEGORIES].map((c) => (
            <button
              key={c.id}
              onClick={() => setCat(c.id)}
              className={cx('h-7 shrink-0 rounded-full px-3 text-2xs font-medium transition-colors', cat === c.id ? 'bg-ink text-page' : 'border border-line text-ink-2 hover:text-ink')}
            >
              {c.name}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {cat === 'ai' && <CreateWithAI onPlace={onPick} />}
        {items.length === 0 ? (
          <p className="py-8 text-center text-[13px] text-ink-3">{cat === 'ai' && !q ? 'Objects you make with the AI appear here.' : `Nothing matches “${q}”.`}</p>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {items.map((a) => (
              <Card
                key={`${a.id}:${a.custom?.updatedAt ?? ''}`}
                def={a}
                view={view}
                active={placingId === a.id}
                onPick={() => onPick(a)}
                onDelete={
                  a.custom
                    ? () =>
                        void deleteCustomAsset(a.id)
                          .then(() => toast(`Removed ${a.name} from your library (projects that use it keep it)`))
                          .catch((e: Error) => toast(e.message))
                    : undefined
                }
              />
            ))}
          </div>
        )}
        <p className="mt-4 px-1 text-2xs leading-relaxed text-ink-3">Pick an item, then click the plan to place it (R turns it first, Esc cancels). Wall items snap to the nearest wall. Drag the round handle to turn a placed item; it stops at 0°, 45°, 90°… (Shift for free).</p>
      </div>
    </div>
  );
}

/** Describe an object; the AI designs it; preview, then keep it in the library. */
function CreateWithAI({ onPlace }: { onPlace: (def: AssetDef) => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<{ spec: CustomAssetSpec; note: string } | null>(null);
  const [error, setError] = useState('');
  const def = useMemo(() => (draft ? defFromSpec(draft.spec) : null), [draft]);

  const go = async (revise = false) => {
    const prompt = text.trim();
    if (!prompt || busy) return;
    setBusy(true);
    setError('');
    try {
      setDraft(await designAsset(prompt, revise ? draft?.spec : undefined));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The AI could not design that.');
    } finally {
      setBusy(false);
    }
  };
  const keep = async (place: boolean) => {
    if (!draft || !def) return;
    try {
      await saveCustomAsset(draft.spec);
      toast(`${draft.spec.name} added to your library`);
      if (place) onPlace(def);
      setDraft(null);
      setText('');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not save it.');
    }
  };

  return (
    <div className="mb-3 rounded-[12px] border border-accent/30 bg-accent-soft/40 p-3">
      <p className="flex items-center gap-1.5 text-[13px] font-semibold">
        <Sparkles className="h-4 w-4 text-accent" /> Make an object with AI
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        placeholder={draft ? 'Describe changes, e.g. “make it taller, in teak”' : 'e.g. “galvanised L bracket shelf for a water heater, 600 mm deep”'}
        className="mt-2 w-full resize-none rounded-ctl border border-line bg-surface px-2.5 py-2 text-[13px] placeholder:text-ink-3 focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void go(!!draft);
        }}
      />
      {error && <p className="mt-1 text-2xs text-danger">{error}</p>}
      {busy ? (
        <p className="mt-2 flex items-center gap-2 text-2xs text-ink-3">
          <Spinner className="h-3.5 w-3.5" /> Designing… this takes up to a minute.
        </p>
      ) : draft && def ? (
        <div className="mt-2 space-y-2">
          <div className="flex gap-2.5 rounded-[10px] border border-line bg-surface p-2">
            <div className="w-24 shrink-0">
              <Card def={def} view="3d" active={false} onPick={() => {}} bare />
            </div>
            <div className="min-w-0 text-2xs text-ink-2">
              <p className="text-[13px] font-medium text-ink">{draft.spec.name}</p>
              <p className="font-mono text-ink-3">
                {draft.spec.w.toFixed(2)} × {draft.spec.d.toFixed(2)} × {draft.spec.h.toFixed(2)} m · {draft.spec.parts.length} parts
              </p>
              {draft.note && <p className="mt-1 leading-snug">{draft.note}</p>}
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant="primary" onClick={() => void keep(true)}>
              Save & place
            </Button>
            <Button size="sm" variant="secondary" onClick={() => void keep(false)}>
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void go(true)} disabled={!text.trim()}>
              Revise
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
              Discard
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-2 flex justify-end">
          <Button size="sm" variant="primary" icon={<Sparkles className="h-3.5 w-3.5" />} onClick={() => void go(false)} disabled={!text.trim()}>
            Design it
          </Button>
        </div>
      )}
    </div>
  );
}

function Card({ def, view, active, onPick, onDelete, bare }: { def: AssetDef; view: '3d' | '2d'; active: boolean; onPick: () => void; onDelete?: () => void; bare?: boolean }) {
  const thumb = useThumb(def);
  const prims = useMemo(() => (view === '2d' ? assetPlan(def, def.w, def.d, def.h) : []), [def, view]);
  const size = def.opening ? `${def.w.toFixed(2)} × ${def.h.toFixed(2)} m` : `${def.w.toFixed(2)} × ${def.d.toFixed(2)} m`;
  return (
    <button
      onClick={onPick}
      className={cx(
        'group flex flex-col overflow-hidden rounded-[12px] border text-left transition-all',
        active ? 'border-accent ring-4 ring-accent/15' : 'border-line hover:border-line-strong hover:shadow-card'
      )}
    >
      <div className="relative flex aspect-[4/3] items-center justify-center bg-raised">
        {view === '3d' ? (
          thumb ? (
            <img src={thumb} alt="" className="h-full w-full object-contain" draggable={false} />
          ) : (
            <div className="h-8 w-8 animate-pulse rounded-full bg-sunken" />
          )
        ) : (
          <PlanSymbolSvg prims={prims} w={def.w} d={def.opening ? Math.max(def.d, def.w * 0.6) : def.d} className="h-[78%] w-[78%]" />
        )}
        {def.mep && <span className="absolute left-1.5 top-1.5 rounded-full bg-surface/90 px-1.5 py-0.5 text-[10px] font-medium text-ink-3">{def.mep.wattage ? `${def.mep.wattage} W` : 'Service'}</span>}
        {def.custom && !bare && (
          <span className="absolute left-1.5 top-1.5 flex items-center gap-1 rounded-full bg-accent-soft px-1.5 py-0.5 text-[10px] font-medium text-accent">
            <Sparkles className="h-2.5 w-2.5" /> AI
          </span>
        )}
        {onDelete && (
          <span
            role="button"
            tabIndex={0}
            aria-label={`Remove ${def.name} from the library`}
            title="Remove from library"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="absolute right-1.5 top-1.5 hidden h-6 w-6 items-center justify-center rounded-full bg-surface/90 text-ink-3 hover:text-danger group-hover:flex"
          >
            <Trash2 className="h-3 w-3" />
          </span>
        )}
      </div>
      {!bare && (
        <div className="px-2.5 py-2">
          <p className="truncate text-[12.5px] font-medium text-ink">{def.name}</p>
          <p className="font-mono text-[10.5px] text-ink-3">{size}</p>
        </div>
      )}
    </button>
  );
}
