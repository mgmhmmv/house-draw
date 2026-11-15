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


/** How objects are built in ArchStudio: shared by the object maker and the chat. */
const KIT_GUIDE = `MODELLING KIT (for create_asset / make_asset)
An object is a list of simple parts, built in three.js and also drawn from above as its plan symbol.
Axes, metres: x = width (left -, right +), y = up from the floor (0 = underside of the object), z = depth with the BACK at z = -d/2 (against the wall for wall items) and the FRONT at +d/2. The object's origin is the centre of its footprint at y = 0.
Part fields:
- g: "box" | "rbox" (rounded box, r = corner radius) | "cyl" | "sph" | "tor" | "lathe"
- p: [x, y, z] CENTRE of the part (for lathe: the base point; the profile goes up from there)
- s: box/rbox [width, height, depth]; cyl [radiusTop, height, radiusBottom] (vertical by default); sph [radius, 0, 0]; tor [ringRadius, tubeRadius, 0] (lies in the x-y plane; rot [1.5708,0,0] lays it flat)
- pts (lathe only): [[radius, y], ...] profile from the bottom up, e.g. bowls, lamp shades, vases
- rot: [x, y, z] radians (a cylinder along x: rot [0,0,1.5708]; along z: rot [1.5708,0,0])
- sc: [x, y, z] stretch (e.g. squash a sphere into a cushion)
- m: material: fabric, cushion, accent, wood, woodDark, white, offwhite, metal, chrome, black, glass, ceramic, stone, leaf, soil, terracotta, linen, duvet, mattress, screen, lamp (glows), paint, rubber, steel, water, trunk, book1, book2, book3
- c: optional colour "#rrggbb" over the material
- plan: false for parts hidden under others in plan (legs, rails, small hardware); "line" for outline only; omit for normal
- seg: round detail (default 24; use 8–12 for small parts)
Guidance: real-world sizes; 6–80 parts; stand things on y = 0 (wall-mounted: mount "wall" with elevation = height of its underside above the floor, and its back at z = -d/2 touching the wall); hardware (brackets, legs, handles) as thin boxes or cylinders; no floating parts; keep inside the w × d × h box.`;

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
- If the request is ambiguous in a way that matters, ask with "answer" instead of guessing.

Precise edits (preferred whenever possible):
- The brief lists every element with its id (rooms, walls, openings, furniture, fixtures). Coordinates are plan metres: x east, y south. A level's walls show the building footprint.
- Use "edits" to change specific elements or place library items. Only use "instruction" alone for whole-design changes the edits can't express (new layout, adding a floor, redesigning rooms).
- Ops:
  · add_item {asset, x, y, rotation?, width?, depth?, height?, level?}: place a LIBRARY item (ids in LIBRARY). Rotation in degrees, 0 = item's back to the north. For long runs (boundary walls, fences, hedges) set width to the run length and rotate 90 for north–south runs; place several to go round a plot. x, y is the item's centre.
  · add_opening {asset, wall_id, at?, width?, height?, sill?}: put a door/window library item into a wall; "at" = metres from the wall's start point.
  · add_wall {x1,y1,x2,y2, thickness?, height?, exterior?, material?, level?}
  · move {id, x?, y?, dx?, dy?, rotation?} (openings: x/dx are metres along their wall)
  · resize {id, width?, depth?, height?}
  · set {id, props}: walls {thickness, height, isExterior, isLoadBearing, material}; openings {style, width, height, sillHeight, offset, swingDirection, frameColor "#rrggbb", finish}; rooms {name, category, finish, ceilingHeight}; furniture {elevation, height}; fixtures {label, wattage, model}
  · delete {id}
  · set_roof {props: type, pitchDeg, overhang, material, parapetHeight}
  · set_solar {props: enabled, panelCount, panelWattage, inverterKW, batteryKWh, offsetX, offsetY, rotationDeg, roofFace}
- Keep things outside the building footprint (gardens, gates, boundary) clear of the walls; keep furniture inside its room's extents and clear of doors.
- When the user refers to a SELECTED element, it is the one they mean.
- Fixtures (AC units, fans, lights): change the model with set {model} (e.g. ac_condenser_wall = outdoor unit on L brackets fixed to the wall; its depth = 0.30 m unit + the gap to the wall, so use resize {depth} for the gap), set {elevation, rotation}; rotation 0 = the unit's back to the north.
- If nothing in LIBRARY fits (a particular bracket, fitting, appliance or decoration), make it: create_asset {spec: {id: "ai_<short_name>", name, w, d, h, mount?, elevation?, keywords?, parts: [...]}} then place it with add_item {asset: that id, ...}. It is saved to the user's library as "AI created". Follow the MODELLING KIT.

${KIT_GUIDE}`;

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
        edits: {
          type: 'array',
          description: 'Precise edits to apply, in order (see the system prompt for ops). Leave empty only for whole-design changes.',
          items: {
            type: 'object',
            properties: {
              op: { type: 'string', enum: ['create_asset', 'add_item', 'add_opening', 'add_wall', 'move', 'resize', 'set', 'delete', 'set_roof', 'set_solar'] },
              spec: { type: 'object', description: 'create_asset only: the new object (see MODELLING KIT).' },
              id: { type: 'string' },
              asset: { type: 'string' },
              wall_id: { type: 'string' },
              x: { type: 'number' },
              y: { type: 'number' },
              dx: { type: 'number' },
              dy: { type: 'number' },
              x1: { type: 'number' },
              y1: { type: 'number' },
              x2: { type: 'number' },
              y2: { type: 'number' },
              at: { type: 'number' },
              rotation: { type: 'number' },
              width: { type: 'number' },
              depth: { type: 'number' },
              height: { type: 'number' },
              sill: { type: 'number' },
              thickness: { type: 'number' },
              exterior: { type: 'boolean' },
              material: { type: 'string' },
              level: { type: 'number' },
              props: { type: 'object' },
            },
            required: ['op'],
          },
        },
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
  const body = await readJson<{ prompt?: string; brief?: unknown; library?: unknown; selection?: unknown; history?: { role: 'user' | 'assistant'; text: string }[] }>(req, 768 * 1024);
  const prompt = typeof body.prompt === 'string' ? body.prompt.slice(0, 4000).trim() : '';
  if (!prompt) throw new HttpError(400, 'empty_prompt');

  const history = (Array.isArray(body.history) ? body.history : [])
    .filter((h) => (h.role === 'user' || h.role === 'assistant') && typeof h.text === 'string' && h.text.trim())
    .slice(-8)
    .map((h) => ({ role: h.role, content: h.text.slice(0, 3000) }));
  // The API needs alternating turns starting with the user.
  while (history.length && history[0].role !== 'user') history.shift();
  const library = Array.isArray(body.library) ? body.library.filter((x) => typeof x === 'string').slice(0, 300).join('\n') : '';
  const selection = body.selection ? `\n\nSELECTED (the user is pointing at this):\n${JSON.stringify(body.selection).slice(0, 2000)}` : '';
  const messages = [
    ...history,
    { role: 'user', content: `PROJECT BRIEF (JSON):\n${JSON.stringify(body.brief ?? {})}${library ? `\n\nLIBRARY (asset ids):\n${library}` : ''}${selection}\n\nUSER:\n${prompt}` },
  ];
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
      body: JSON.stringify({ model, max_tokens: 12000, system: ASSIST_SYSTEM, tools: ASSIST_TOOLS, tool_choice: { type: 'auto' }, messages: merged }),
    });
    if (resp.ok) {
      const data = (await resp.json()) as { content?: { type: string; name?: string; input?: Record<string, string>; text?: string }[] };
      const call = (data.content ?? []).find((c) => c.type === 'tool_use');
      if (call?.name === 'change_design' && call.input?.instruction)
        return json({
          ok: true,
          kind: 'change',
          instruction: call.input.instruction,
          summary: call.input.summary ?? '',
          reasoning: call.input.reasoning ?? '',
          edits: Array.isArray((call.input as Record<string, unknown>).edits) ? (call.input as Record<string, unknown>).edits : [],
          modelUsed: model,
        });
      const text = call?.input?.text ?? (data.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
      return json({ ok: true, kind: 'answer', text: text || 'I could not work that out. Could you rephrase it?', modelUsed: model });
    }
    lastStatus = resp.status;
    lastError = await resp.text();
    if (resp.status !== 404 && !lastError.includes('not_found_error')) break;
  }
  return json({ ok: false, error: lastError }, { status: lastStatus >= 500 ? 502 : lastStatus });
}

const ASSET_SYSTEM = `You design 3D objects for ArchStudio's library: furniture, fittings, fixtures, equipment, hardware, landscape and decoration for houses (often tropical / Maldives).
Reply by calling make_asset once. Make it recognisable and well proportioned at real size, with the details that make it read (legs, handles, rails, panels, brackets) but no more parts than needed.

${KIT_GUIDE}`;

const ASSET_TOOL = {
  name: 'make_asset',
  description: 'The designed object.',
  input_schema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Short library name, e.g. "Wall-mounted shoe rack".' },
      w: { type: 'number' },
      d: { type: 'number' },
      h: { type: 'number' },
      mount: { type: 'string', enum: ['floor', 'wall', 'ceiling'] },
      elevation: { type: 'number', description: 'Wall items: height of the underside above the floor.' },
      keywords: { type: 'string' },
      parts: { type: 'array', items: { type: 'object' } },
      note: { type: 'string', description: 'One sentence on the design, shown to the user.' },
    },
    required: ['name', 'w', 'd', 'h', 'parts'],
  },
};

/** POST /api/ai/asset { prompt, base? } → { ok, spec, note }. Designs (or revises) one object. */
export async function handleAsset(env: Env, req: Request): Promise<Response> {
  if (req.method !== 'POST') throw new HttpError(405, 'method_not_allowed');
  if (!env.ANTHROPIC_API_KEY) return json({ ok: false, error: 'NO_CLAUDE_KEY' }, { status: 503 });
  const body = await readJson<{ prompt?: string; base?: unknown }>(req, 256 * 1024);
  const prompt = typeof body.prompt === 'string' ? body.prompt.slice(0, 2000).trim() : '';
  if (!prompt) throw new HttpError(400, 'empty_prompt');
  const base = body.base ? `\n\nREVISE THIS EXISTING OBJECT (keep what isn't mentioned):\n${JSON.stringify(body.base).slice(0, 60000)}` : '';
  let lastStatus = 502;
  let lastError = 'Claude request failed';
  for (const model of MODELS) {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        max_tokens: 12000,
        system: ASSET_SYSTEM,
        tools: [ASSET_TOOL],
        tool_choice: { type: 'auto' },
        messages: [{ role: 'user', content: `${prompt}${base}` }],
      }),
    });
    if (resp.ok) {
      const data = (await resp.json()) as { content?: { type: string; input?: Record<string, unknown> }[] };
      const call = (data.content ?? []).find((c) => c.type === 'tool_use');
      if (!call?.input) return json({ ok: false, error: 'The AI did not return an object.' }, { status: 502 });
      const { note, ...spec } = call.input;
      return json({ ok: true, spec: { ...spec, prompt }, note: typeof note === 'string' ? note : '', modelUsed: model });
    }
    lastStatus = resp.status;
    lastError = await resp.text();
    if (resp.status !== 404 && !lastError.includes('not_found_error')) break;
  }
  return json({ ok: false, error: lastError }, { status: lastStatus >= 500 ? 502 : lastStatus });
}
