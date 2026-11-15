import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { ArrowUp, ChevronRight, Cpu, PenLine, Sparkles, Wand2 } from 'lucide-react';
import type { BuildingProject } from '../../model/types';
import { runPromptArchitect } from '../../ai/promptEngine';
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
  onCommit: (next: BuildingProject) => void;
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
      return JSON.parse(localStorage.getItem(storeKey(projectId)) || '[]');
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
      const res = await runPromptArchitect(modelRef.current, prompt, { provider: 'claude' });
      onCommit(res.project);
      setEntries((es) =>
        es.map((e) => (e.id === id ? { id, prompt, summary: res.summary, reasoning: res.reasoning, changes: res.changes, engine: res.engineUsed } : e))
      );
    } catch (err) {
      setEntries((es) => es.map((e) => (e.id === id ? { id, prompt, error: err instanceof Error ? err.message : 'The assistant could not finish that.' } : e)));
    } finally {
      setBusy(false);
    }
  };

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
              Describe a building or a change. The plan, 3D model, engineering and BOQ update together, and every change can be undone.
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
                  <Reply entry={e} />
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

function Reply({ entry }: { entry: Entry }) {
  const [open, setOpen] = useState(false);
  const engine = entry.engine === 'claude' ? 'Claude' : entry.engine === 'tool' ? 'Tool' : entry.engine === 'gemini' ? 'Gemini' : 'Built-in rules';
  return (
    <div className="mr-4 rounded-[14px] rounded-bl-[4px] border border-line bg-surface px-3.5 py-3">
      <p className="text-[13px] leading-relaxed text-ink">{entry.summary}</p>
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
      <div className="mt-2.5 flex items-center gap-3">
        <span className="inline-flex items-center gap-1 text-2xs text-ink-3">
          <Cpu className="h-3 w-3" /> {engine}
        </span>
        {entry.reasoning && (
          <button onClick={() => setOpen(!open)} className="text-2xs font-medium text-accent hover:underline">
            {open ? 'Hide reasoning' : 'Why this design'}
          </button>
        )}
      </div>
      {open && entry.reasoning && <p className="mt-2 border-l-2 border-accent/30 pl-3 text-[13px] leading-relaxed text-ink-2">{entry.reasoning}</p>}
    </div>
  );
}
