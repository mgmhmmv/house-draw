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
