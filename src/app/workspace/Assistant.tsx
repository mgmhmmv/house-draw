import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { ArrowUp, Check, ChevronDown, ChevronRight, Cpu, History, PenLine, RotateCcw, Sparkles, Wand2, X } from 'lucide-react';
import type { BuildingProject } from '../../model/types';
import { runPromptArchitect } from '../../ai/promptEngine';
import { projectBrief } from './projectBrief';
import { describeChange } from './describeChange';
import { applyEdits, libraryForAI, type EditOp } from './editOps';
import { cleanSpec } from '../drawing/assets/catalog';
import { saveCustomAsset } from '../lib/customAssets';
import type { CommitOptions } from './useProjectDoc';
import { cx, Spinner } from '../ui';

interface Entry {
  id: number;
  prompt: string;
  summary?: string;
  reasoning?: string;
  changes?: string[];
  engine?: string;
  error?: string;
  pending?: boolean;
  /** A conversational reply to a question (no design change). */
  answer?: string;
  /** A proposed design change waiting for approval. The proposed model itself is kept in memory only. */
  proposal?: 'pending' | 'saving' | 'applied' | 'unsaved' | 'discarded' | 'expired';
  /** What the proposal changes, worked out from the models. */
  diff?: string;
}

interface Proposal {
  base: BuildingProject;
  next: BuildingProject;
}

const SUGGESTIONS = [
  'Design a 3 bedroom tropical house, 14 × 11 m, cinder block and a hip roof',
  'Add a 4 × 3.5 m study on the east side',
  'Add a second floor',
  'Change the roof to flat with a parapet',
  'Move the inverter and battery into the utility room',
];

/** An element the user is asking about (from the plan or 3D view). */
export interface AboutRef {
  kind: string;
  id: string;
  label: string;
  details?: Record<string, unknown>;
}

export interface AssistantHandle {
  focus: () => void;
  log: (prompt: string, summary: string) => void;
  /** Point the next question at an element. */
  attach: (ref: AboutRef) => void;
}

interface Props {
  projectId: string;
  model: BuildingProject;
  onCommit: (next: BuildingProject, opts?: CommitOptions) => Promise<boolean> | void;
  sketchCount: number;
  onConvertSketch: () => void;
  /** Open the History tab (after a change is applied). */
  onOpenHistory?: () => void;
  onSyncEngineering: () => void;
}

const storeKey = (id: string) => `as_ai_${id}`;

export const Assistant = forwardRef<AssistantHandle, Props>(function Assistant(
  { projectId, model, onCommit, sketchCount, onConvertSketch, onSyncEngineering, onOpenHistory },
  ref
) {
  const [entries, setEntries] = useState<Entry[]>(() => {
    try {
      // Proposed models are not stored, so proposals from an earlier visit can't be applied.
      return (JSON.parse(localStorage.getItem(storeKey(projectId)) || '[]') as Entry[]).map((e) => (e.proposal === 'pending' ? { ...e, proposal: 'expired' } : e));
    } catch {
      return [];
    }
  });
  const [input, setInput] = useState('');
  const [about, setAbout] = useState<AboutRef | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const modelRef = useRef(model);
  modelRef.current = model;
  const proposals = useRef(new Map<number, Proposal>());

  useEffect(() => {
    try {
      localStorage.setItem(storeKey(projectId), JSON.stringify(entries.filter((e) => !e.pending).slice(-30)));
    } catch {
      /* storage full or blocked */
    }
    endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [entries, projectId]);

  const log = (prompt: string, summary: string) => setEntries((es) => [...es, { id: Date.now(), prompt, summary, engine: 'tool' }]);

  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus(),
    log,
    attach: (r: AboutRef) => {
      setAbout(r);
      setTimeout(() => inputRef.current?.focus(), 30);
    },
  }));

  const run = async (text?: string) => {
    const prompt = (text ?? input).trim();
    if (!prompt || busy) return;
    const id = Date.now();
    setEntries((es) => [...es, { id, prompt, pending: true }]);
    setInput('');
    setBusy(true);
    try {
      // First ask whether this is a question or a design change; questions never touch the model.
      const history = entries
        .filter((e) => !e.pending && !e.error)
        .slice(-4)
        .flatMap((e) => [
          { role: 'user' as const, text: e.prompt },
          { role: 'assistant' as const, text: e.answer ?? e.summary ?? '' },
        ]);
      const routed = await fetch('/api/ai/assist', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt, brief: projectBrief(modelRef.current), library: libraryForAI(), selection: about ?? undefined, history }),
      })
        .then((r) => r.json() as Promise<{ ok: boolean; kind?: 'answer' | 'change'; text?: string; instruction?: string; summary?: string; reasoning?: string; edits?: EditOp[] }>)
        .catch(() => ({ ok: false }) as { ok: false; kind?: undefined; text?: undefined; instruction?: undefined; summary?: undefined; reasoning?: undefined; edits?: undefined });

      if (routed.ok && routed.kind === 'answer') {
        setEntries((es) => es.map((e) => (e.id === id ? { id, prompt, answer: routed.text, engine: 'claude' } : e)));
        return;
      }
      // A change: nothing touches the project until the user approves.
      const base = modelRef.current;
      // Precise edits by element id / library item: applied exactly as proposed.
      if (routed.ok && routed.kind === 'change' && routed.edits?.length) {
        const r = applyEdits(base, routed.edits);
        const diff = describeChange(base, r.next, 50);
        if (r.applied.length && diff !== 'Edited') {
          proposals.current.set(id, { base, next: r.next });
          const failed = r.failed.length ? `\n\n**Couldn't do:** ${r.failed.join('; ')}` : '';
          setEntries((es) =>
            es.map((e) => (e.id === id ? { id, prompt, summary: routed.summary || r.applied.join('. '), reasoning: (routed.reasoning ?? '') + failed, changes: r.applied, engine: 'claude', proposal: 'pending', diff } : e))
          );
          setAbout(null);
          return;
        }
        if (!r.applied.length && r.failed.length && !routed.instruction) {
          setEntries((es) => es.map((e) => (e.id === id ? { id, prompt, answer: `I couldn't make that change: ${r.failed.join('; ')}.`, engine: 'claude' } : e)));
          return;
        }
      }
      // Whole-design changes: the design engine.
      const instruction = routed.ok && routed.kind === 'change' && routed.instruction ? routed.instruction : prompt;
      const res = await runPromptArchitect(base, instruction, { provider: 'claude' }, prompt);
      const diff = describeChange(base, res.project, 50);
      // 'Edited' means nothing the drawings show changed: the engine couldn't do it.
      if (diff === 'Edited') {
        setEntries((es) => es.map((e) => (e.id === id ? { id, prompt, answer: `I couldn't turn that into a change to the design. Could you say it another way, with sizes or room names?`, engine: res.engineUsed } : e)));
        return;
      }
      proposals.current.set(id, { base, next: res.project });
      const reasoning = [routed.ok ? routed.reasoning : '', res.reasoning].filter((x) => x && x.trim()).join('\n\n');
      setEntries((es) =>
        es.map((e) =>
          e.id === id
            ? { id, prompt, summary: routed.ok && routed.summary ? routed.summary : res.summary, reasoning, changes: res.changes, engine: res.engineUsed, proposal: 'pending', diff }
            : e
        )
      );
    } catch (err) {
      setEntries((es) => es.map((e) => (e.id === id ? { id, prompt, error: err instanceof Error ? err.message : 'The assistant could not finish that.' } : e)));
    } finally {
      setBusy(false);
    }
  };

  const setStatus = (id: number, proposal: Entry['proposal']) => setEntries((es) => es.map((e) => (e.id === id ? { ...e, proposal } : e)));
  const approve = (e: Entry) => {
    const p = proposals.current.get(e.id);
    if (!p) return setStatus(e.id, 'expired');
    // Apply on top of the current design only if it hasn't changed since the proposal was made.
    if (modelRef.current !== p.base) return setStatus(e.id, 'expired');
    setStatus(e.id, 'saving');
    proposals.current.delete(e.id);
    // Only say "Applied" once the change is actually saved.
    Promise.resolve(onCommit(p.next, { label: `AI: ${e.summary || e.prompt}`.slice(0, 200), source: 'ai', saveNow: true }))
      .then((ok) => {
        setStatus(e.id, ok === false ? 'unsaved' : 'applied');
        // New objects the AI made also go into the user's library.
        if (ok !== false)
          for (const a of Object.values(p.next.customAssets ?? {})) {
            if (p.base.customAssets?.[a.id]) continue;
            const spec = cleanSpec(a);
            if (spec) void saveCustomAsset(spec).catch(() => {});
          }
      })
      .catch(() => setStatus(e.id, 'unsaved'));
  };
  const discard = (e: Entry) => {
    proposals.current.delete(e.id);
    setStatus(e.id, 'discarded');
  };
  // A proposal made against an older design can't be applied as is.
  const stale = (e: Entry) => e.proposal === 'pending' && proposals.current.get(e.id)?.base !== model;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
        {entries.length === 0 ? (
          <div className="animate-fade-up">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-soft text-accent">
              <Sparkles className="h-5 w-5" />
            </div>
            <h3 className="mt-4 text-[15px] font-semibold">AI Architect</h3>
            <p className="mt-1 text-[13px] leading-relaxed text-ink-2">
              Ask anything about this project, or describe a change. Changes are shown with the reasoning first and only applied when you approve, and every version can be restored from History.
            </p>
            <div className="mt-5 space-y-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => run(s)} className="flex w-full items-center gap-2 rounded-ctl border border-line bg-surface px-3 py-2.5 text-left text-[13px] text-ink-2 transition-colors hover:border-line-strong hover:text-ink">
                  <span className="flex-1">{s}</span>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ink-3" />
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            {entries.map((e) => (
              <div key={e.id} className="space-y-2 animate-fade-up">
                <div className="ml-8 rounded-[14px] rounded-br-[4px] bg-ink px-3.5 py-2.5 text-[13px] leading-relaxed text-page">{e.prompt}</div>
                {e.pending ? (
                  <div className="flex items-center gap-2 px-1 text-[13px] text-ink-3">
                    <Spinner className="h-4 w-4" /> Working on it…
                  </div>
                ) : e.error ? (
                  <div className="mr-8 rounded-[14px] rounded-bl-[4px] bg-danger/10 px-3.5 py-2.5 text-[13px] text-danger">{e.error}</div>
                ) : (
                  <Reply entry={e} stale={stale(e)} busy={busy} onApprove={() => approve(e)} onDiscard={() => discard(e)} onRetry={() => run(e.prompt)} onOpenHistory={onOpenHistory} />
                )}
              </div>
            ))}
            <div ref={endRef} />
          </div>
        )}
      </div>

      <div className="border-t border-line bg-surface px-4 pb-4 pt-3">
        <div className="mb-2.5 flex gap-1.5 overflow-x-auto no-scrollbar">
          {sketchCount > 0 && (
            <QuickAction icon={<PenLine className="h-3.5 w-3.5" />} onClick={onConvertSketch} highlight>
              Turn {sketchCount} sketch {sketchCount === 1 ? 'stroke' : 'strokes'} into walls
            </QuickAction>
          )}
          <QuickAction icon={<Wand2 className="h-3.5 w-3.5" />} onClick={onSyncEngineering}>
            Regenerate structure & MEP
          </QuickAction>
        </div>
        {about && (
          <div className="mb-2 flex items-center gap-2 rounded-[10px] border border-accent/30 bg-accent-soft px-2.5 py-1.5 text-2xs text-accent">
            <span className="font-semibold uppercase tracking-wide">About</span>
            <span className="min-w-0 flex-1 truncate font-medium text-ink">{about.label}</span>
            <span className="font-mono text-ink-3">{about.id}</span>
            <button onClick={() => setAbout(null)} aria-label="Remove" className="rounded p-0.5 text-ink-3 hover:text-ink">
              <X className="h-3 w-3" />
            </button>
          </div>
        )}
        <div className="flex items-end gap-2 rounded-[14px] border border-line bg-raised p-1.5 pl-3.5 focus-within:border-accent focus-within:ring-4 focus-within:ring-accent/15">
          <textarea
            ref={inputRef}
            value={input}
            rows={1}
            onChange={(e) => {
              setInput(e.target.value);
              e.target.style.height = 'auto';
              e.target.style.height = `${Math.min(e.target.scrollHeight, 140)}px`;
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                run();
              }
            }}
            placeholder={about ? `Ask about ${about.label}…` : 'Ask the AI Architect…'}
            className="max-h-[140px] min-h-[36px] flex-1 resize-none bg-transparent py-2 text-[15px] placeholder:text-ink-3 focus:outline-none sm:text-sm"
          />
          <button
            onClick={() => run()}
            disabled={!input.trim() || busy}
            aria-label="Send"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-ink text-page transition-opacity disabled:opacity-30"
          >
            {busy ? <Spinner className="h-4 w-4 text-page" /> : <ArrowUp className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </div>
  );
});

function QuickAction({ icon, children, onClick, highlight }: { icon: React.ReactNode; children: React.ReactNode; onClick: () => void; highlight?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={cx(
        'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-3 text-2xs font-medium transition-colors',
        highlight ? 'border-accent/40 bg-accent-soft text-accent' : 'border-line text-ink-2 hover:border-line-strong hover:text-ink'
      )}
    >
      {icon}
      {children}
    </button>
  );
}

const ENGINE: Record<string, string> = { claude: 'Claude', tool: 'Tool', gemini: 'Gemini' };

const STATUS = {
  pending: { label: 'Proposed change', dot: 'bg-accent', text: 'text-accent', bg: 'bg-accent-soft' },
  saving: { label: 'Saving…', dot: 'bg-accent', text: 'text-accent', bg: 'bg-accent-soft' },
  applied: { label: 'Applied', dot: 'bg-ok', text: 'text-ok', bg: 'bg-ok/10' },
  unsaved: { label: 'Not saved', dot: 'bg-danger', text: 'text-danger', bg: 'bg-danger/10' },
  discarded: { label: 'Discarded', dot: 'bg-ink-3', text: 'text-ink-3', bg: 'bg-sunken' },
  expired: { label: 'Not applied', dot: 'bg-warn', text: 'text-warn', bg: 'bg-warn/10' },
} as const;

function Reply({
  entry,
  stale,
  busy,
  onApprove,
  onDiscard,
  onRetry,
  onOpenHistory,
}: {
  entry: Entry;
  stale: boolean;
  busy: boolean;
  onApprove: () => void;
  onDiscard: () => void;
  onRetry: () => void;
  onOpenHistory?: () => void;
}) {
  const pending = entry.proposal === 'pending';
  const [open, setOpen] = useState(pending);
  const engine = ENGINE[entry.engine ?? ''] ?? 'Built-in rules';

  // A plain answer, or a log line from a tool: just the text.
  if (!entry.proposal)
    return (
      <div className="mr-4 rounded-[14px] rounded-bl-[4px] border border-line bg-surface px-3.5 py-3">
        {entry.answer ? <Markdown text={entry.answer} /> : <p className="text-[13px] leading-relaxed text-ink">{entry.summary}</p>}
        {entry.changes && entry.changes.length > 0 && <Steps items={entry.changes} />}
        <p className="mt-2.5 inline-flex items-center gap-1 text-2xs text-ink-3">
          <Cpu className="h-3 w-3" /> {engine}
        </p>
      </div>
    );

  const st = STATUS[stale && pending ? 'expired' : entry.proposal];
  const chips = entry.diff && entry.diff !== 'Edited' ? entry.diff.split(' · ') : [];
  const hasDetails = !!entry.reasoning || (entry.changes?.length ?? 0) > 0;

  return (
    <div className={cx('mr-4 overflow-hidden rounded-[14px] rounded-bl-[4px] border bg-surface', pending && !stale ? 'border-accent/50 shadow-card' : 'border-line')}>
      <div className="px-3.5 pb-3 pt-3">
        <div className="flex items-center justify-between gap-2">
          <span className={cx('inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-2xs font-semibold', st.bg, st.text)}>
            <span className={cx('h-1.5 w-1.5 rounded-full', st.dot)} />
            {st.label}
          </span>
          {entry.proposal === 'applied' && onOpenHistory && (
            <button onClick={onOpenHistory} className="inline-flex h-6 items-center gap-1 rounded-full px-2 text-2xs font-medium text-ink-3 hover:bg-sunken hover:text-ink">
              <History className="h-3 w-3" /> History
            </button>
          )}
        </div>

        <p className="mt-2.5 text-[14px] font-medium leading-snug text-ink">{entry.summary}</p>

        {chips.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {chips.map((c) => (
              <span key={c} className="inline-flex h-6 items-center rounded-[7px] border border-line bg-raised px-2 text-2xs text-ink-2">
                {c}
              </span>
            ))}
          </div>
        )}

        {entry.proposal === 'applied' && <p className="mt-2.5 text-2xs text-ink-3">Saved as a new version. You can restore the one before it from History.</p>}
        {entry.proposal === 'unsaved' && (
          <p className="mt-2.5 text-2xs text-danger">The change is on screen but not saved: this project was saved from another tab. Use Keep mine in the top bar to save it, or Reload to drop it.</p>
        )}
        {(entry.proposal === 'expired' || (pending && stale)) && (
          <p className="mt-2.5 text-2xs text-ink-3">{stale ? 'The design changed after this was proposed.' : 'This proposal is from an earlier visit.'}</p>
        )}
      </div>

      {hasDetails && (
        <div className="border-t border-line">
          <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 px-3.5 py-2 text-left text-2xs font-medium text-ink-2 hover:bg-raised">
            <ChevronDown className={cx('h-3.5 w-3.5 transition-transform', open ? '' : '-rotate-90')} />
            <span className="flex-1">Reasoning</span>
            <span className="inline-flex items-center gap-1 font-normal text-ink-3">
              <Cpu className="h-3 w-3" /> {engine}
            </span>
          </button>
          {open && (
            <div className="max-h-80 overflow-y-auto px-3.5 pb-3">
              {entry.reasoning && <Markdown text={entry.reasoning} />}
              {entry.changes && entry.changes.length > 0 && (
                <>
                  <p className="mb-1 mt-3 text-2xs font-semibold uppercase tracking-wide text-ink-3">Engine steps</p>
                  <Steps items={entry.changes} />
                </>
              )}
            </div>
          )}
        </div>
      )}

      {pending && !stale && (
        <div className="flex gap-2 border-t border-line bg-raised px-3.5 py-2.5">
          <button onClick={onApprove} className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-[9px] bg-ink px-3 text-[13px] font-medium text-page hover:opacity-90">
            <Check className="h-3.5 w-3.5" /> Apply change
          </button>
          <button onClick={onDiscard} className="inline-flex h-8 items-center justify-center gap-1.5 rounded-[9px] border border-line bg-surface px-3 text-[13px] font-medium text-ink-2 hover:text-ink">
            <X className="h-3.5 w-3.5" /> Discard
          </button>
        </div>
      )}
      {(entry.proposal === 'expired' || (pending && stale)) && (
        <div className="border-t border-line bg-raised px-3.5 py-2.5">
          <button disabled={busy} onClick={onRetry} className="inline-flex h-8 items-center gap-1.5 rounded-[9px] border border-line bg-surface px-3 text-[13px] font-medium text-ink-2 hover:text-ink disabled:opacity-40">
            <RotateCcw className="h-3.5 w-3.5" /> Propose again
          </button>
        </div>
      )}
    </div>
  );
}

function Steps({ items }: { items: string[] }) {
  return (
    <ul className="mt-2 space-y-1">
      {items.slice(0, 8).map((c, i) => (
        <li key={i} className="flex gap-2 text-[12.5px] leading-snug text-ink-2">
          <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-ink-3" />
          {c}
        </li>
      ))}
    </ul>
  );
}

/** Just enough Markdown for chat replies: paragraphs, bullets, numbered lists, **bold**, `code`. Rendered as text, never HTML. */
function Markdown({ text }: { text: string }) {
  const inline = (s: string) =>
    s.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) =>
      part.startsWith('**') && part.endsWith('**') ? (
        <strong key={i} className="font-semibold">
          {part.slice(2, -2)}
        </strong>
      ) : part.startsWith('`') && part.endsWith('`') ? (
        <code key={i} className="rounded bg-sunken px-1 font-mono text-[12px]">
          {part.slice(1, -1)}
        </code>
      ) : (
        part
      )
    );
  const blocks: React.ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const Tag = list.ordered ? 'ol' : 'ul';
    blocks.push(
      <Tag key={blocks.length} className={cx('space-y-1 pl-4', list.ordered ? 'list-decimal' : 'list-disc')}>
        {list.items.map((it, i) => (
          <li key={i}>{inline(it)}</li>
        ))}
      </Tag>
    );
    list = null;
  };
  let table: string[][] | null = null;
  const flushTable = () => {
    if (!table) return;
    const [head, ...body] = table;
    blocks.push(
      <div key={blocks.length} className="-mx-1 overflow-x-auto">
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr className="border-b border-line">
              {head.map((c, i) => (
                <th key={i} className="px-1.5 py-1 text-left font-semibold text-ink-2">
                  {inline(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.map((r, i) => (
              <tr key={i} className="border-b border-line/60 last:border-b-0">
                {r.map((c, j) => (
                  <td key={j} className="px-1.5 py-1 align-top tabular-nums">
                    {inline(c)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
    table = null;
  };
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('|')) {
      flush();
      // Separator rows (|---|:--:|) carry no data.
      if (/^\|[\s:|-]+\|?$/.test(line)) continue;
      (table ??= []).push(line.replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
      continue;
    }
    if (!line && table) continue;
    flushTable();
    const bullet = line.match(/^[-*•]\s+(.*)$/);
    const num = line.match(/^\d+[.)]\s+(.*)$/);
    if (bullet || num) {
      const ordered = !!num;
      if (!list || list.ordered !== ordered) {
        flush();
        list = { ordered, items: [] };
      }
      list.items.push((bullet ?? num)![1]);
      continue;
    }
    flush();
    if (!line) continue;
    const h = line.match(/^#{1,4}\s+(.*)$/);
    blocks.push(
      h ? (
        <p key={blocks.length} className="font-semibold">
          {inline(h[1])}
        </p>
      ) : (
        <p key={blocks.length}>{inline(line)}</p>
      )
    );
  }
  flush();
  flushTable();
  return <div className="space-y-2 text-[13px] leading-relaxed text-ink marker:text-ink-3">{blocks}</div>;
}
