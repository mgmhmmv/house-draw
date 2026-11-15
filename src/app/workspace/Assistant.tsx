import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { ArrowUp, Check, ChevronRight, Cpu, PenLine, RotateCcw, Sparkles, Wand2, X } from 'lucide-react';
import type { BuildingProject } from '../../model/types';
import { runPromptArchitect } from '../../ai/promptEngine';
import { projectBrief } from './projectBrief';
import { describeChange } from './describeChange';
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
  proposal?: 'pending' | 'applied' | 'discarded' | 'expired';
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

export interface AssistantHandle {
  focus: () => void;
  log: (prompt: string, summary: string) => void;
}

interface Props {
  projectId: string;
  model: BuildingProject;
  onCommit: (next: BuildingProject, opts?: CommitOptions) => void;
  sketchCount: number;
  onConvertSketch: () => void;
  onSyncEngineering: () => void;
}

const storeKey = (id: string) => `as_ai_${id}`;

export const Assistant = forwardRef<AssistantHandle, Props>(function Assistant(
  { projectId, model, onCommit, sketchCount, onConvertSketch, onSyncEngineering },
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

  useImperativeHandle(ref, () => ({ focus: () => inputRef.current?.focus(), log }));

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
        body: JSON.stringify({ prompt, brief: projectBrief(modelRef.current), history }),
      })
        .then((r) => r.json() as Promise<{ ok: boolean; kind?: 'answer' | 'change'; text?: string; instruction?: string; summary?: string; reasoning?: string }>)
        .catch(() => ({ ok: false }) as { ok: false; kind?: undefined; text?: undefined; instruction?: undefined; summary?: undefined; reasoning?: undefined });

      if (routed.ok && routed.kind === 'answer') {
        setEntries((es) => es.map((e) => (e.id === id ? { id, prompt, answer: routed.text, engine: 'claude' } : e)));
        return;
      }
      // A change (or no AI connection): work it out with the design engine, but only propose it.
      // Nothing touches the project until the user approves.
      const instruction = routed.ok && routed.kind === 'change' && routed.instruction ? routed.instruction : prompt;
      const base = modelRef.current;
      const res = await runPromptArchitect(base, instruction, { provider: 'claude' }, prompt);
      const diff = describeChange(base, res.project);
      if (diff === 'Edited' && JSON.stringify(base) === JSON.stringify(res.project)) {
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
    onCommit(p.next, { label: `AI: ${e.summary || e.prompt}`.slice(0, 200), source: 'ai', saveNow: true });
    proposals.current.delete(e.id);
    setStatus(e.id, 'applied');
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
                  <Reply entry={e} stale={stale(e)} busy={busy} onApprove={() => approve(e)} onDiscard={() => discard(e)} onRetry={() => run(e.prompt)} />
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
            placeholder="Ask the AI Architect…"
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

function Reply({ entry, stale, busy, onApprove, onDiscard, onRetry }: { entry: Entry; stale: boolean; busy: boolean; onApprove: () => void; onDiscard: () => void; onRetry: () => void }) {
  const isProposal = !!entry.proposal;
  const [open, setOpen] = useState(isProposal && entry.proposal === 'pending');
  const engine = entry.engine === 'claude' ? 'Claude' : entry.engine === 'tool' ? 'Tool' : entry.engine === 'gemini' ? 'Gemini' : 'Built-in rules';
  const pending = entry.proposal === 'pending';
  return (
    <div className={cx('mr-4 rounded-[14px] rounded-bl-[4px] border bg-surface px-3.5 py-3', pending ? 'border-accent/50 ring-4 ring-accent/10' : 'border-line')}>
      {isProposal && (
        <p className="mb-1.5 text-2xs font-semibold uppercase tracking-wide text-accent">
          {pending ? 'Proposed change' : entry.proposal === 'applied' ? 'Applied' : entry.proposal === 'discarded' ? 'Discarded' : 'Not applied'}
        </p>
      )}
      {entry.answer ? <Markdown text={entry.answer} /> : <p className="text-[13px] leading-relaxed text-ink">{entry.summary}</p>}
      {entry.diff && entry.diff !== 'Edited' && <p className="mt-1.5 text-[13px] text-ink-2">{entry.diff}</p>}
      {entry.changes && entry.changes.length > 0 && (
        <ul className="mt-2 space-y-1">
          {entry.changes.slice(0, 6).map((c, i) => (
            <li key={i} className="flex gap-2 text-[13px] text-ink-2">
              <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-ink-3" />
              {c}
            </li>
          ))}
        </ul>
      )}
      {open && entry.reasoning && (
        <div className="mt-2.5 border-l-2 border-accent/30 pl-3">
          <Markdown text={entry.reasoning} />
        </div>
      )}
      {pending && !stale && (
        <div className="mt-3 flex gap-2">
          <button onClick={onApprove} className="inline-flex h-8 items-center gap-1.5 rounded-[9px] bg-ink px-3 text-[13px] font-medium text-page hover:opacity-90">
            <Check className="h-3.5 w-3.5" /> Apply change
          </button>
          <button onClick={onDiscard} className="inline-flex h-8 items-center gap-1.5 rounded-[9px] border border-line px-3 text-[13px] font-medium text-ink-2 hover:border-line-strong hover:text-ink">
            <X className="h-3.5 w-3.5" /> Discard
          </button>
        </div>
      )}
      {(entry.proposal === 'expired' || (pending && stale)) && (
        <div className="mt-3 flex items-center gap-2">
          <span className="text-[13px] text-ink-3">{stale ? 'The design changed since this was proposed.' : 'This proposal has expired.'}</span>
          <button disabled={busy} onClick={onRetry} className="inline-flex h-7 items-center gap-1 rounded-[8px] border border-line px-2.5 text-2xs font-medium text-ink-2 hover:text-ink disabled:opacity-40">
            <RotateCcw className="h-3 w-3" /> Propose again
          </button>
        </div>
      )}
      <div className="mt-2.5 flex items-center gap-3">
        <span className="inline-flex items-center gap-1 text-2xs text-ink-3">
          <Cpu className="h-3 w-3" /> {engine}
        </span>
        {entry.reasoning && (
          <button onClick={() => setOpen(!open)} className="text-2xs font-medium text-accent hover:underline">
            {open ? 'Hide reasoning' : 'Show reasoning'}
          </button>
        )}
        {entry.proposal === 'applied' && <span className="text-2xs text-ink-3">Saved as a version · restore it from History</span>}
      </div>
    </div>
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
