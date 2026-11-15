import { CLAUDE_ARCHITECT_SYSTEM_PROMPT } from '../shared/architectPrompt';
import { Env, HttpError, json, readJson } from './http';

// Newest first; later entries are only tried when the account lacks access to an earlier model.
const MODELS = ['claude-sonnet-5-5', 'claude-sonnet-4-6', 'claude-haiku-5-5'];

/** POST /api/ai/claude { prompt, projectContext } → { ok, modelUsed, plan }. The API key never leaves the Worker. */
export async function handleAi(env: Env, req: Request): Promise<Response> {
  if (req.method !== 'POST') throw new HttpError(405, 'method_not_allowed');
  if (!env.ANTHROPIC_API_KEY) return json({ ok: false, error: 'NO_CLAUDE_KEY' }, { status: 503 });

  const body = await readJson<{ prompt?: string; projectContext?: unknown }>(req, 1024 * 1024);
  const prompt = typeof body.prompt === 'string' ? body.prompt.slice(0, 4000) : '';
  if (!prompt.trim()) throw new HttpError(400, 'empty_prompt');

  let lastStatus = 502;
  let lastError = 'Claude request failed';
  for (const model of MODELS) {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        system: CLAUDE_ARCHITECT_SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: `Current BIM Project State:\n${JSON.stringify(body.projectContext ?? {})}\n\nArchitectural / Engineering Request:\n"${prompt}"`,
          },
        ],
      }),
    });

    if (resp.ok) {
      const data = (await resp.json()) as { content?: { type?: string; text?: string }[] };
      const text = (data.content ?? [])
        .filter((c) => c.type === 'text' && typeof c.text === 'string')
        .map((c) => c.text)
        .join('\n');
      const match = text.replace(/^```json\s*|^```\s*|```$/gm, '').match(/\{[\s\S]*\}/);
      if (!match) return json({ ok: false, error: 'Claude did not return valid JSON.' }, { status: 502 });
      try {
        return json({ ok: true, modelUsed: model, plan: JSON.parse(match[0]) });
      } catch {
        return json({ ok: false, error: 'Claude did not return valid JSON.' }, { status: 502 });
      }
    }

    lastStatus = resp.status;
    lastError = await resp.text();
    if (resp.status !== 404 && !lastError.includes('not_found_error')) break;
  }
  return json({ ok: false, error: lastError }, { status: lastStatus >= 500 ? 502 : lastStatus });
}

const ASSIST_SYSTEM = `You are the AI Architect inside ArchStudio, a design tool for houses and small buildings (often in the Maldives and other tropical islands).
You are talking with the architect or designer working on the project described in the PROJECT BRIEF. Use the brief's real numbers (areas, wall materials and thicknesses, quantities, rates, loads) and say so when you are estimating.

Always reply by calling exactly one of the two tools. Decide what the user wants:
- If they ask a question, want advice, an explanation, a check, an estimate or a comparison, call "answer".
- Only if they ask to change the design (add, remove, move or resize rooms, floors, walls, doors or windows; change roof, materials, climate, solar, cooling or services), call "change_design".

When answering:
- Be practical and specific to this project: sizes, quantities, standards, cost, buildability in the local context.
- Metric units. Use the project currency for money.
- Short Markdown: a direct answer first, then a few bullets. No more than about 180 words unless the user asks for detail.
- If the brief lacks something you need, say what is missing and give a sensible default.
- Room positions are given as x/y extents in metres: x grows to the east, y grows to the south (plan north is up).

When changing the design:
- Nothing is applied until the user approves. Your "reasoning" is shown to them before they decide, so think the change through first: how it fits the current plan (sizes, where it goes, what it connects to), knock-on effects (structure, roof, services, cost) and any assumption you made.
- Make the instruction short, imperative and self-contained for the design engine: only what changes, with dimensions, positions relative to existing rooms and materials. Do not restate things that stay the same (the engine reads every word).
- If the request is ambiguous in a way that matters, ask with "answer" instead of guessing.`;

const ASSIST_TOOLS = [
  {
    name: 'answer',
    description: 'Reply to a question, request for advice, explanation, estimate or check. Does not change the design.',
    input_schema: {
      type: 'object',
      properties: { text: { type: 'string', description: 'The reply in concise Markdown.' } },
      required: ['text'],
    },
  },
  {
    name: 'change_design',
    description: 'The user asked for the building model to be changed. Restate the change precisely for the design engine.',
    input_schema: {
      type: 'object',
      properties: {
        instruction: { type: 'string', description: 'The design change as a precise, self-contained instruction (dimensions, rooms, materials).' },
        summary: { type: 'string', description: 'One short sentence telling the user what will change.' },
        reasoning: {
          type: 'string',
          description: 'Concise Markdown, shown to the user before they approve: why this approach, how it fits the current plan, knock-on effects and assumptions. 2–5 bullets.',
        },
      },
      required: ['instruction', 'summary', 'reasoning'],
    },
  },
];

/**
 * POST /api/ai/assist { prompt, brief, history } →
 *   { ok, kind: 'answer', text } | { ok, kind: 'change', instruction, summary }
 * Questions get answered from the project brief; only real change requests go to the design engine.
 */
export async function handleAssist(env: Env, req: Request): Promise<Response> {
  if (req.method !== 'POST') throw new HttpError(405, 'method_not_allowed');
  if (!env.ANTHROPIC_API_KEY) return json({ ok: false, error: 'NO_CLAUDE_KEY' }, { status: 503 });
  const body = await readJson<{ prompt?: string; brief?: unknown; history?: { role: 'user' | 'assistant'; text: string }[] }>(req, 512 * 1024);
  const prompt = typeof body.prompt === 'string' ? body.prompt.slice(0, 4000).trim() : '';
  if (!prompt) throw new HttpError(400, 'empty_prompt');

  const history = (Array.isArray(body.history) ? body.history : [])
    .filter((h) => (h.role === 'user' || h.role === 'assistant') && typeof h.text === 'string' && h.text.trim())
    .slice(-8)
    .map((h) => ({ role: h.role, content: h.text.slice(0, 3000) }));
  // The API needs alternating turns starting with the user.
  while (history.length && history[0].role !== 'user') history.shift();
  const messages = [...history, { role: 'user', content: `PROJECT BRIEF (JSON):\n${JSON.stringify(body.brief ?? {})}\n\nUSER:\n${prompt}` }];
  const merged: { role: string; content: string }[] = [];
  for (const m of messages) {
    const last = merged[merged.length - 1];
    if (last && last.role === m.role) last.content += `\n\n${m.content}`;
    else merged.push({ ...m });
  }

  let lastStatus = 502;
  let lastError = 'Claude request failed';
  for (const model of MODELS) {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: 2000, system: ASSIST_SYSTEM, tools: ASSIST_TOOLS, tool_choice: { type: 'auto' }, messages: merged }),
    });
    if (resp.ok) {
      const data = (await resp.json()) as { content?: { type: string; name?: string; input?: Record<string, string>; text?: string }[] };
      const call = (data.content ?? []).find((c) => c.type === 'tool_use');
      if (call?.name === 'change_design' && call.input?.instruction)
        return json({ ok: true, kind: 'change', instruction: call.input.instruction, summary: call.input.summary ?? '', reasoning: call.input.reasoning ?? '', modelUsed: model });
      const text = call?.input?.text ?? (data.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
      return json({ ok: true, kind: 'answer', text: text || 'I could not work that out. Could you rephrase it?', modelUsed: model });
    }
    lastStatus = resp.status;
    lastError = await resp.text();
    if (resp.status !== 404 && !lastError.includes('not_found_error')) break;
  }
  return json({ ok: false, error: lastError }, { status: lastStatus >= 500 ? 502 : lastStatus });
}
