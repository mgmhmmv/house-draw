import { useState } from 'react';
import { ArrowUp, Sparkles } from 'lucide-react';
import { Button, cx, Spinner } from '../ui';
import type { AiDesign } from '../lib/buildFromDesign';
import { ROOM_TINT } from '../drawing/style';

interface Question {
  id: string;
  question: string;
  options: string[];
}
type Turn = { role: 'user' | 'assistant'; text: string };

/**
 * New project from a description: the AI architect reasons about the brief, asks for what it
 * cannot design without (plot, floors, bedrooms), then proposes a layout to build or refine.
 */
export function AiProjectDesigner({ known, onBuild, building }: { known: Record<string, string>; onBuild: (d: AiDesign) => void; building: boolean }) {
  const [brief, setBrief] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ask, setAsk] = useState<{ reasoning: string; known?: string[]; questions: Question[] } | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [design, setDesign] = useState<AiDesign | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [change, setChange] = useState('');

  const send = async (next: Turn[]) => {
    setBusy(true);
    setError('');
    try {
      const r = await fetch('/api/ai/project', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ known, turns: next }) });
      const j = await r.json().catch(() => ({ ok: false, error: 'The architect did not reply.' }));
      if (!j.ok) {
        setError(j.error === 'NO_CLAUDE_KEY' ? 'AI is not set up on this server.' : typeof j.error === 'string' && j.error.length < 200 ? j.error : 'The architect could not answer. Try again.');
        return;
      }
      if (j.kind === 'questions') {
        setAsk({ reasoning: j.reasoning ?? '', known: j.known, questions: j.questions ?? [] });
        setAnswers({});
        setDesign(null);
        setTurns([...next, { role: 'assistant', text: `${j.reasoning ?? ''}\nQuestions:\n${(j.questions ?? []).map((q: Question) => `- ${q.question}`).join('\n')}` }]);
      } else {
        setAsk(null);
        setDesign(j.design);
        setWarnings(j.warnings ?? []);
        setChange('');
        setTurns([...next, { role: 'assistant', text: `Proposed design (JSON):\n${JSON.stringify(j.design)}` }]);
      }
    } catch {
      setError('Could not reach the architect. Check the connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  const start = () => brief.trim() && send([{ role: 'user', text: brief.trim() }]);
  const answer = () => {
    if (!ask) return;
    const text = ask.questions.map((q) => `${q.question}\n→ ${answers[q.id]?.trim() || 'You decide.'}`).join('\n\n');
    void send([...turns, { role: 'user', text }]);
  };
  const refine = () => change.trim() && send([...turns, { role: 'user', text: `Change the design: ${change.trim()}` }]);

  if (!turns.length)
    return (
      <div className="space-y-3">
        <textarea
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          rows={4}
          autoFocus
          placeholder="Describe the house: who it's for, plot size, floors, bedrooms, must-haves… e.g. 'Two-storey, 4 bedrooms each with a bath, 12 × 18 m plot in Hulhumalé, prayer room and a big kitchen.'"
          className="w-full resize-none rounded-[12px] border border-line bg-surface px-3.5 py-3 text-[15px] leading-relaxed outline-none placeholder:text-ink-3 focus:border-accent"
          onKeyDown={(e) => e.key === 'Enter' && (e.metaKey || e.ctrlKey) && start()}
        />
        {error && <p className="text-[13px] text-danger">{error}</p>}
        <div className="flex items-center justify-between gap-3">
          <p className="text-2xs text-ink-3">The architect asks if it needs the plot size, floors or bedrooms, then designs.</p>
          <Button variant="primary" loading={busy} onClick={start} disabled={!brief.trim()}>
            <Sparkles className="h-4 w-4" /> Design it
          </Button>
        </div>
        {busy && <Working />}
      </div>
    );

  return (
    <div className="space-y-4">
      <div className="rounded-[12px] bg-sunken px-3.5 py-2.5 text-[13px] text-ink-2">
        <span className="font-medium text-ink">Brief:</span> {turns[0].text}
      </div>

      {ask && !busy && (
        <div className="space-y-4 animate-fade-up">
          <Reasoning text={ask.reasoning} />
          {ask.questions.map((q) => (
            <div key={q.id}>
              <p className="mb-2 text-[14px] font-medium">{q.question}</p>
              <div className="flex flex-wrap gap-1.5">
                {q.options.map((o) => (
                  <button
                    key={o}
                    onClick={() => setAnswers((a) => ({ ...a, [q.id]: o }))}
                    className={cx('h-8 rounded-full border px-3 text-[13px] font-medium transition-colors', answers[q.id] === o ? 'border-ink bg-ink text-page' : 'border-line text-ink-2 hover:border-line-strong')}
                  >
                    {o}
                  </button>
                ))}
              </div>
              <input
                value={q.options.includes(answers[q.id] ?? '') ? '' : answers[q.id] ?? ''}
                onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
                placeholder="Or type your own answer"
                className="mt-2 h-9 w-full rounded-[10px] border border-line bg-surface px-3 text-[14px] outline-none placeholder:text-ink-3 focus:border-accent"
              />
            </div>
          ))}
          <div className="flex justify-end">
            <Button variant="primary" onClick={answer}>
              <ArrowUp className="h-4 w-4" /> Send answers
            </Button>
          </div>
        </div>
      )}

      {design && !busy && (
        <div className="space-y-4 animate-fade-up">
          <Reasoning text={design.reasoning} />
          <div>
            <p className="text-[15px] font-semibold">{design.name}</p>
            <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{design.summary}</p>
            <p className="mt-1 text-2xs text-ink-3">
              Plot {design.plot.width} × {design.plot.depth} m · {design.floors.length} floor{design.floors.length > 1 ? 's' : ''} · {design.floors.reduce((s, f) => s + f.rooms.filter((r) => r.category === 'bedroom').length, 0)} bedrooms · {design.roof.type} roof
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {design.floors.map((f) => (
              <FloorPreview key={f.name} name={f.name} rooms={f.rooms} />
            ))}
          </div>
          {!!design.assumptions?.length && (
            <ul className="list-disc space-y-0.5 pl-5 text-[13px] text-ink-2">
              {design.assumptions.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          )}
          {!!warnings.length && <p className="rounded-[10px] bg-warn/10 px-3 py-2 text-[13px] text-warn">Some checks did not pass ({warnings.length}); you can still build it and adjust, or ask for a change.</p>}
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={change}
              onChange={(e) => setChange(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && refine()}
              placeholder="Change something… e.g. 'make the kitchen bigger'"
              className="h-10 min-w-0 flex-1 rounded-[10px] border border-line bg-surface px-3 text-[14px] outline-none placeholder:text-ink-3 focus:border-accent"
            />
            <div className="flex gap-2">
              <Button variant="secondary" onClick={refine} disabled={!change.trim()}>
                Change
              </Button>
              <Button variant="primary" loading={building} onClick={() => onBuild(design)}>
                Build project
              </Button>
            </div>
          </div>
        </div>
      )}

      {busy && <Working design={!!ask || !!design || turns.length > 1} />}
      {error && <p className="text-[13px] text-danger">{error}</p>}
    </div>
  );
}

function Working({ design }: { design?: boolean }) {
  return (
    <div className="flex items-center gap-2.5 text-[13px] text-ink-2">
      <Spinner className="h-4 w-4" />
      {design ? 'Designing the layout… this can take a minute.' : 'Reading the brief…'}
    </div>
  );
}

function Reasoning({ text }: { text: string }) {
  if (!text) return null;
  return (
    <div className="rounded-[12px] border border-line bg-raised px-3.5 py-3">
      <p className="mb-1 flex items-center gap-1.5 text-2xs font-medium uppercase tracking-wide text-ink-3">
        <Sparkles className="h-3 w-3" /> Reasoning
      </p>
      <p className="text-[13px] leading-relaxed text-ink-2">{text}</p>
    </div>
  );
}

function FloorPreview({ name, rooms }: { name: string; rooms: AiDesign['floors'][number]['rooms'] }) {
  const minX = Math.min(...rooms.map((r) => r.x));
  const minY = Math.min(...rooms.map((r) => r.y));
  const maxX = Math.max(...rooms.map((r) => r.x + r.w));
  const maxY = Math.max(...rooms.map((r) => r.y + r.d));
  const pad = 0.3;
  return (
    <div className="rounded-[12px] border border-line p-2">
      <p className="mb-1 px-1 text-2xs font-medium text-ink-3">{name}</p>
      <svg viewBox={`${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}`} className="h-44 w-full">
        {rooms.map((r, i) => (
          <g key={i}>
            <rect x={r.x} y={r.y} width={r.w} height={r.d} fill={ROOM_TINT[r.category] ?? '#F2F1ED'} stroke="#1A1917" strokeWidth={0.08} />
            <text x={r.x + r.w / 2} y={r.y + r.d / 2} fontSize={Math.min(0.42, r.w / Math.max(4, r.name.length) * 1.5)} textAnchor="middle" dominantBaseline="middle" fill="#1A1917">
              {r.name}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
