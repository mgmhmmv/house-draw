/**
 * POST /api/ai/project — start a new project from a description.
 *
 * The architect model reads the brief (and whatever the New project form already knows), reasons
 * about it, and either asks for the few things it cannot design without, or returns a room
 * layout per floor that the app turns into walls, doors, windows, structure and services.
 * Layouts are checked here (rooms inside the plot, no overlaps, no gaps, reachable rooms) and
 * sent back once with the problems if they fail.
 */
import { Env, HttpError, json, readJson } from './http';

const MODELS = ['claude-sonnet-5-5', 'claude-sonnet-4-6', 'claude-haiku-5-5'];

const SYSTEM = `You are the design architect of a small Maldivian practice. A user wants a new house project. Think it through like an architect, then either ask for what is missing or design it.

MINIMUM INFORMATION needed before designing (from the brief, the known details, or the user's answers):
1. Plot size: width × depth in metres (or plot area with a shape you can assume, or "typical" — then use 12 × 18 m, a common Maldivian house plot).
2. Number of floors (storeys).
3. Number of bedrooms.
If ANY of these is missing or unclear, call ask_clarification. Ask only what you need (max 4 short questions), each with 2-4 sensible options. You may also ask about bathrooms, budget or must-haves in the same round if they would change the design, but never ask for things you can reasonably assume. Never ask the same thing twice: if the user answered vaguely or said "you decide", decide.

When you have the minimum, call design_house. Design rules:
- Plan coordinates in metres: x east, y south, origin at the north-west corner of the building. Every room is an axis-aligned rectangle {x, y, w, d}; w along x, d along y. Use 0.05 m precision (prefer 0.1).
- On each floor, rooms tile the footprint exactly: no overlaps, no gaps; together they form one solid outline (usually a rectangle or L). Upper floors sit within the ground floor outline.
- The building fits the plot with at least 1 m front (south) and rear setbacks and 0.6 m side setbacks where the plot allows (narrow plots: sides may be 0).
- Every room shares at least 1.0 m of wall with a circulation space (hallway, living, dining, or porch) or with the room it belongs to (en-suite bathroom to its bedroom), so it can have a door. The entrance is through a porch, hallway or living room on the south side.
- Minimum sizes: bedroom 3.0 × 3.0 (master 3.6 × 3.6), bathroom 1.6 × 2.2, kitchen 2.4 × 3.0, living 3.6 × 4.2, hallway width 1.1, stair 2.4 × 4.0.
- Multi-storey: one room named "Stair" (category hallway) with the SAME rectangle on every floor it serves, plus circulation on each floor connecting to it.
- Maldivian practice: a front verandah (fenda / porch) is common; a prayer room, a separate laundry/wash area, a store, and bathrooms for every bedroom or close to them are valued; cross ventilation and shade matter; kitchens often open to a back yard.
- Name rooms plainly (Master Bedroom, Bedroom 2, Bath 1, Kitchen, Living, Dining, Hall, Porch, Stair, Laundry, Prayer, Store).
- Roof: hip or gable for houses, pitch 20-25°; flat only if asked (roof terrace).
Always reply by calling exactly one tool (ask_clarification or design_house), never with plain text.
Reasoning: in "reasoning", explain briefly what you understood, what you assumed, and the key layout decisions (zoning, orientation, circulation, ventilation). Keep it under 120 words.`;

const CATEGORIES = ['living', 'kitchen', 'dining', 'bedroom', 'bathroom', 'hallway', 'garage', 'office', 'utility', 'porch', 'balcony'];

const TOOLS = [
  {
    name: 'ask_clarification',
    description: 'Ask the user for the minimum information still missing before the house can be designed.',
    input_schema: {
      type: 'object',
      properties: {
        reasoning: { type: 'string', description: 'What you understood so far and why you need these answers (under 80 words).' },
        known: { type: 'array', items: { type: 'string' }, description: 'Facts you already have, as short phrases.' },
        questions: {
          type: 'array',
          maxItems: 4,
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              question: { type: 'string' },
              options: { type: 'array', items: { type: 'string' }, maxItems: 4 },
            },
            required: ['id', 'question', 'options'],
          },
        },
      },
      required: ['reasoning', 'questions'],
    },
  },
  {
    name: 'design_house',
    description: 'Return the house design: plot, floors with their rooms as rectangles, and roof.',
    input_schema: {
      type: 'object',
      properties: {
        reasoning: { type: 'string' },
        name: { type: 'string', description: 'Short project name, e.g. "3-bed family house, Hulhumalé".' },
        summary: { type: 'string', description: 'One or two sentences describing the design.' },
        plot: { type: 'object', properties: { width: { type: 'number' }, depth: { type: 'number' } }, required: ['width', 'depth'] },
        offset: { type: 'object', description: 'Position of the building origin inside the plot (setbacks): x from the west boundary, y from the north boundary.', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'] },
        floors: {
          type: 'array',
          minItems: 1,
          maxItems: 4,
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              rooms: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    category: { type: 'string', enum: CATEGORIES },
                    x: { type: 'number' },
                    y: { type: 'number' },
                    w: { type: 'number' },
                    d: { type: 'number' },
                  },
                  required: ['name', 'category', 'x', 'y', 'w', 'd'],
                },
              },
            },
            required: ['name', 'rooms'],
          },
        },
        roof: { type: 'object', properties: { type: { type: 'string', enum: ['hip', 'gable', 'shed', 'flat'] }, pitchDeg: { type: 'number' } }, required: ['type', 'pitchDeg'] },
        assumptions: { type: 'array', items: { type: 'string' } },
      },
      required: ['reasoning', 'name', 'summary', 'plot', 'offset', 'floors', 'roof'],
    },
  },
];

interface RoomIn {
  name: string;
  category: string;
  x: number;
  y: number;
  w: number;
  d: number;
}
interface DesignIn {
  plot: { width: number; depth: number };
  offset: { x: number; y: number };
  floors: { name: string; rooms: RoomIn[] }[];
}

/** Problems an architect would spot at a glance; empty when the layout can be built. */
export function checkDesign(d: DesignIn): string[] {
  const out: string[] = [];
  if (!d?.floors?.length) return ['No floors.'];
  const eps = 0.02;
  d.floors.forEach((f, fi) => {
    const rooms = (f.rooms ?? []).filter((r) => r.w > 0 && r.d > 0);
    if (!rooms.length) out.push(`Floor ${fi + 1} has no rooms.`);
    // Overlaps.
    for (let i = 0; i < rooms.length; i++)
      for (let j = i + 1; j < rooms.length; j++) {
        const a = rooms[i];
        const b = rooms[j];
        const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const oy = Math.min(a.y + a.d, b.y + b.d) - Math.max(a.y, b.y);
        if (ox > eps && oy > eps) out.push(`${f.name}: "${a.name}" and "${b.name}" overlap by ${ox.toFixed(2)} × ${oy.toFixed(2)} m.`);
      }
    // Inside the plot.
    for (const r of rooms) {
      const px = d.offset.x + r.x;
      const py = d.offset.y + r.y;
      if (px < -eps || py < -eps || px + r.w > d.plot.width + eps || py + r.d > d.plot.depth + eps) out.push(`${f.name}: "${r.name}" is outside the plot.`);
    }
    // Gaps: area of the bounding box not covered, sampled on a 0.1 m grid inside the outline.
    const minX = Math.min(...rooms.map((r) => r.x));
    const minY = Math.min(...rooms.map((r) => r.y));
    const maxX = Math.max(...rooms.map((r) => r.x + r.w));
    const maxY = Math.max(...rooms.map((r) => r.y + r.d));
    const inRoom = (x: number, y: number) => rooms.some((r) => x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.d);
    let holes = 0;
    for (let x = minX + 0.05; x < maxX; x += 0.1)
      for (let y = minY + 0.05; y < maxY; y += 0.1) {
        if (inRoom(x, y)) continue;
        // A hole is uncovered but enclosed on both axes (not just an L-shaped outline's notch).
        const left = rooms.some((r) => r.y < y && r.y + r.d > y && r.x + r.w <= x + 1e-6);
        const right = rooms.some((r) => r.y < y && r.y + r.d > y && r.x >= x - 1e-6);
        const up = rooms.some((r) => r.x < x && r.x + r.w > x && r.y + r.d <= y + 1e-6);
        const down = rooms.some((r) => r.x < x && r.x + r.w > x && r.y >= y - 1e-6);
        if (left && right && up && down) holes++;
      }
    if (holes * 0.01 > 0.3) out.push(`${f.name}: about ${(holes * 0.01).toFixed(1)} m² inside the outline is not part of any room; rooms must tile the floor with no gaps.`);
    // Reachability: rooms touching along ≥ 0.9 m form a graph from the circulation rooms.
    const touch = (a: RoomIn, b: RoomIn) => {
      const vx = Math.abs(a.x + a.w - b.x) < eps || Math.abs(b.x + b.w - a.x) < eps;
      const hy = Math.abs(a.y + a.d - b.y) < eps || Math.abs(b.y + b.d - a.y) < eps;
      if (vx) return Math.min(a.y + a.d, b.y + b.d) - Math.max(a.y, b.y) >= 0.9;
      if (hy) return Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) >= 0.9;
      return false;
    };
    const circ = (r: RoomIn) => ['hallway', 'living', 'dining', 'porch'].includes(r.category);
    const seen = new Set<number>();
    const queue = rooms.map((r, i) => (circ(r) ? i : -1)).filter((i) => i >= 0);
    queue.forEach((i) => seen.add(i));
    while (queue.length) {
      const i = queue.shift()!;
      rooms.forEach((r, j) => {
        if (!seen.has(j) && touch(rooms[i], r)) {
          seen.add(j);
          queue.push(j);
        }
      });
    }
    rooms.forEach((r, i) => !seen.has(i) && out.push(`${f.name}: "${r.name}" cannot be reached (no 0.9 m shared wall with a hall, living, dining or a room connected to them).`));
  });
  return out.slice(0, 12);
}

type Msg = { role: 'user' | 'assistant'; content: string };

async function callClaude(env: Env, messages: Msg[]) {
  let lastStatus = 502;
  let lastError = 'Claude request failed';
  for (const model of MODELS) {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': env.ANTHROPIC_API_KEY!, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      // Medium effort: enough thought for a sound layout without spending the output on it.
      body: JSON.stringify({ model, max_tokens: 16000, output_config: { effort: 'medium' }, system: SYSTEM, tools: TOOLS, tool_choice: { type: 'auto' }, messages }),
    });
    if (resp.ok) {
      const data = (await resp.json()) as { stop_reason?: string; content?: { type: string; name?: string; input?: Record<string, unknown> }[] };
      // A reply cut off at the token limit carries a partial design: never build from it.
      if (data.stop_reason === 'max_tokens') return { ok: false as const, status: 502, error: 'The design ran too long. Try a simpler brief or fewer floors.' };
      if (data.stop_reason === 'refusal') return { ok: false as const, status: 502, error: 'The architect declined this request.' };
      const call = (data.content ?? []).find((c) => c.type === 'tool_use');
      return { ok: true as const, call, model };
    }
    lastStatus = resp.status;
    lastError = await resp.text();
    if (resp.status !== 404 && !lastError.includes('not_found_error')) break;
  }
  return { ok: false as const, status: lastStatus, error: lastError };
}

export async function handleAiProject(env: Env, req: Request): Promise<Response> {
  if (req.method !== 'POST') throw new HttpError(405, 'method_not_allowed');
  if (!env.ANTHROPIC_API_KEY) return json({ ok: false, error: 'NO_CLAUDE_KEY' }, { status: 503 });
  const body = await readJson<{ known?: Record<string, string>; turns?: { role: 'user' | 'assistant'; text: string }[] }>(req, 512 * 1024);
  const turns = (Array.isArray(body.turns) ? body.turns : [])
    .filter((t) => (t.role === 'user' || t.role === 'assistant') && typeof t.text === 'string' && t.text.trim())
    .slice(-12)
    .map((t) => ({ role: t.role, content: t.text.slice(0, t.role === 'assistant' ? 16000 : 4000) }));
  if (!turns.length || turns[0].role !== 'user') throw new HttpError(400, 'empty_brief');
  const known = Object.entries(body.known ?? {})
    .filter(([, v]) => typeof v === 'string' && v.trim())
    .map(([k, v]) => `${k}: ${String(v).slice(0, 200)}`)
    .join('\n');
  const messages: Msg[] = [];
  for (const [i, t] of turns.entries()) {
    const content = i === 0 && known ? `KNOWN FROM THE NEW PROJECT FORM:\n${known}\n\nBRIEF:\n${t.content}` : t.content;
    const last = messages[messages.length - 1];
    if (last && last.role === t.role) last.content += `\n\n${content}`;
    else messages.push({ role: t.role, content });
  }

  let res = await callClaude(env, messages);
  if (!res.ok) return json({ ok: false, error: res.error }, { status: res.status >= 500 ? 502 : res.status });
  // One round of self-correction if the layout does not hold together.
  for (let attempt = 0; attempt < 2 && res.ok && res.call?.name === 'design_house'; attempt++) {
    const problems = checkDesign(res.call.input as unknown as DesignIn);
    if (!problems.length) break;
    if (attempt === 1) {
      return json({ ok: true, kind: 'design', design: res.call.input, warnings: problems, modelUsed: res.model });
    }
    const retry: Msg[] = [
      ...messages,
      { role: 'assistant', content: `Proposed design:\n${JSON.stringify(res.call.input).slice(0, 12000)}` },
      { role: 'user', content: `The layout has these problems; fix them and call design_house again with the full corrected design:\n- ${problems.join('\n- ')}` },
    ];
    res = await callClaude(env, retry);
    if (!res.ok) return json({ ok: false, error: res.error }, { status: res.status >= 500 ? 502 : res.status });
  }
  if (!res.ok) return json({ ok: false, error: 'failed' }, { status: 502 });
  const call = res.call;
  if (call?.name === 'ask_clarification') return json({ ok: true, kind: 'questions', ...call.input, modelUsed: res.model });
  if (call?.name === 'design_house') return json({ ok: true, kind: 'design', design: call.input, warnings: [], modelUsed: res.model });
  return json({ ok: false, error: 'The architect did not reply with a design or questions.' }, { status: 502 });
}
