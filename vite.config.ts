import fs from 'node:fs';
import type { IncomingMessage } from 'node:http';
import path from 'node:path';
import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';

function readConfiguredClaudeKey(): string {
  const envFiles = ['.env.local', '.env'];
  for (const fname of envFiles) {
    const fpath = path.resolve(process.cwd(), fname);
    if (!fs.existsSync(fpath)) continue;
    const content = fs.readFileSync(fpath, 'utf8');
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const m = trimmed.match(/^(?:ANTHROPIC_API_KEY|VITE_ANTHROPIC_API_KEY)\s*=\s*(.+)$/);
      if (m && m[1]) {
        const cleaned = m[1].trim().replace(/^['"]|['"]$/g, '');
        if (cleaned) return cleaned;
      }
    }
  }
  const envVal = (process.env.ANTHROPIC_API_KEY || process.env.VITE_ANTHROPIC_API_KEY || '').trim();
  return envVal.startsWith('sk-ant-api') ? envVal : '';
}

function maskApiKey(key: string): string {
  if (!key) return '';
  if (key.length <= 14) return `${key.slice(0, 4)}...`;
  return `${key.slice(0, 10)}...${key.slice(-4)}`;
}

function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8') || '{}';
        resolve(JSON.parse(raw) as T);
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

const CLAUDE_ARCHITECT_SYSTEM_PROMPT = `You are a Senior Licensed Architect and Structural/MEP BIM Engineer for ArchStudio BIM.
Given a user request and the current project JSON summary, reason carefully about:
1. Spatial zoning (public Living/Dining/Kitchen separated cleanly from private Bedrooms, quiet Home Office, wet-wall stacking for bathrooms/kitchen, clear 1.5m+ wide circulation Hallway spine so EVERY room connects logically without awkward walk-through bedrooms).
2. Daylighting & proportions (no sliver rooms < 2.2m except hallways >= 1.5m or baths >= 1.8m; exterior facade exposure for every bedroom/living/kitchen/office).
3. Roof geometry & cladding, Exterior Facade & Interior Materials, Wall Masonry, and Solar PV + Hybrid Inverter + LiFePO4 BESS sizing.
4. Climate & Tropical/Maldives Standards: for tropical, island, coastal, or Maldives requests use "cinder_block" masonry (200mm ext / 150mm int), "cement_plaster" / "coral_render" / "tropical_louvres", "marine_metal" or "thatch_palm" roof, "maldives_tropical" climateZone (33C/82% RH) with Marine Blue-Fin R32 Inverter Split AC & BLDC ceiling fans.

Respond with VALID JSON ONLY (no markdown, no explanation outside JSON) matching this exact schema:
{
  "action": "new_building" | "modify_building",
  "reasoning": "2-4 concise engineering sentences explaining spatial zoning, structural span logic, climate/HVAC sizing, roof/material choices, and solar sizing.",
  "title": string,
  "width": number,
  "depth": number,
  "stories": 1 | 2 | 3,
  "bedrooms": number,
  "hasGarage": boolean,
  "hasOffice": boolean,
  "roofType": "hip" | "gable" | "flat" | "shed",
  "pitchDeg": number,
  "roofMaterial": "standing_seam" | "clay_tile" | "natural_slate" | "asphalt_shingle" | "cedar_shake" | "green_roof" | "corrugated_metal" | "marine_metal" | "thatch_palm" | "concrete_slab",
  "wallMaterial": "brick" | "cmu" | "cinder_block" | "coral_stone" | "concrete" | "timber",
  "exteriorFacade": "white_render" | "cement_plaster" | "coral_render" | "tropical_louvres" | "exposed_brick" | "charcoal_cladding" | "stone_veneer" | "timber_slats" | "travertine_stone",
  "interiorWalls": "matte_white" | "smooth_cement_plaster" | "teak_paneling" | "warm_beige" | "sage_green" | "venetian_plaster" | "exposed_concrete" | "oak_paneling",
  "windowFrame": "anthracite" | "matte_black" | "bronze" | "silver_anodized" | "timber_oak",
  "doorMaterial": "walnut" | "oak" | "matte_black" | "white_lacquer" | "frosted_glass",
  "floorFinish": "porcelain" | "hardwood" | "herringbone_oak" | "carrara_marble" | "terrazzo",
  "climateZone": "maldives_tropical" | "temperate" | "arid_desert" | "mediterranean",
  "solar": { "enabled": boolean, "panelCount": number, "inverterKW": number, "batteryKWh": number },
  "hvac": { "enabled": boolean, "ceilingFansEnabled": boolean },
  "levels": [
    {
      "name": string,
      "rooms": [
        { "name": string, "category": "living" | "kitchen" | "dining" | "bedroom" | "bathroom" | "hallway" | "garage" | "office" | "utility" | "porch", "x": number, "y": number, "w": number, "h": number, "finish"?: "porcelain" | "hardwood" | "herringbone_oak" | "carrara_marble" | "terrazzo" | "ceramic_antiskid" | "concrete" }
      ]
    }
  ]
}

CRITICAL GEOMETRY RULES WHEN PROVIDING "levels":
- All coordinates are in meters inside the rectangle [0, width] x [0, depth]. Top (North) is y=0, Front Entry (South) is y=depth.
- Room rectangles on each floor MUST exactly tile the floor plate cleanly with ZERO overlaps and ZERO dead gaps (adjacent rooms share exact coordinates like x+w == next.x).
- Every floor MUST contain a "hallway" spine rectangle so non-public rooms connect cleanly to doors.`;

/** Vite dev middleware providing .env.local Claude API key management and Anthropic Messages proxy. */
function claudeReasoningProxyPlugin(): Plugin {
  return {
    name: 'archstudio-claude-proxy',
    configureServer(server) {
      server.middlewares.use('/api/ai/config', async (req, res, next) => {
        if (req.method === 'GET') {
          const key = readConfiguredClaudeKey();
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: true, hasKey: Boolean(key), maskedKey: maskApiKey(key) }));
          return;
        }
        if (req.method === 'POST') {
          try {
            const body = await readJsonBody<{ apiKey?: string }>(req);
            const nextKey = (body.apiKey || '').trim();
            const envLocalPath = path.resolve(process.cwd(), '.env.local');
            const existing = fs.existsSync(envLocalPath) ? fs.readFileSync(envLocalPath, 'utf8') : '';
            const preservedLines = existing
              .split(/\r?\n/)
              .filter((line) => !/^\s*(?:ANTHROPIC_API_KEY|VITE_ANTHROPIC_API_KEY)\s*=/.test(line) && line.trim() !== '');
            if (nextKey) {
              preservedLines.push(`ANTHROPIC_API_KEY=${nextKey}`, `VITE_ANTHROPIC_API_KEY=${nextKey}`);
              process.env.ANTHROPIC_API_KEY = nextKey;
              process.env.VITE_ANTHROPIC_API_KEY = nextKey;
            } else {
              delete process.env.ANTHROPIC_API_KEY;
              delete process.env.VITE_ANTHROPIC_API_KEY;
            }
            fs.writeFileSync(envLocalPath, preservedLines.length > 0 ? preservedLines.join('\n') + '\n' : '', 'utf8');
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true, hasKey: Boolean(nextKey), maskedKey: maskApiKey(nextKey) }));
          } catch (err) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: false, error: String(err) }));
          }
          return;
        }
        next();
      });

      server.middlewares.use('/api/ai/claude', async (req, res, next) => {
        if (req.method !== 'POST') {
          next();
          return;
        }
        try {
          const body = await readJsonBody<{
            prompt?: string;
            projectContext?: unknown;
            apiKey?: string;
            model?: string;
          }>(req);
          const resolvedKey = (body.apiKey || '').trim() || readConfiguredClaudeKey();
          if (!resolvedKey) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: false, error: 'NO_CLAUDE_KEY' }));
            return;
          }

          const candidates = Array.from(
            new Set([
              body.model || 'claude-sonnet-4-6',
              'claude-sonnet-4-6',
              'claude-sonnet-4-5-20250929',
              'claude-sonnet-4-20250514',
              'claude-haiku-4-5-20251001',
              'claude-3-7-sonnet-latest',
            ])
          );

          let lastStatus = 500;
          let lastError = 'Claude request failed';

          for (const modelName of candidates) {
            const anthropicResp = await fetch('https://api.anthropic.com/v1/messages', {
              method: 'POST',
              headers: {
                'x-api-key': resolvedKey,
                'anthropic-version': '2023-06-01',
                'content-type': 'application/json',
              },
              body: JSON.stringify({
                model: modelName,
                max_tokens: 4096,
                system: CLAUDE_ARCHITECT_SYSTEM_PROMPT,
                messages: [
                  {
                    role: 'user',
                    content: `Current BIM Project State:\n${JSON.stringify(body.projectContext || {})}\n\nArchitectural / Engineering Request:\n"${body.prompt || ''}"`,
                  },
                ],
              }),
            });

            if (anthropicResp.ok) {
              const data = (await anthropicResp.json()) as {
                content?: { type?: string; text?: string }[];
              };
              const rawText = (data.content || [])
                .filter((c) => c.type === 'text' && typeof c.text === 'string')
                .map((c) => c.text)
                .join('\n')
                .trim();
              const cleanJson = rawText.replace(/^```json\s*|^```\s*|```$/gm, '').trim();
              const jsonMatch = cleanJson.match(/\{[\s\S]*\}/);
              if (!jsonMatch) {
                throw new Error('Claude did not return valid JSON.');
              }
              const plan = JSON.parse(jsonMatch[0]);
              res.statusCode = 200;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ ok: true, modelUsed: modelName, plan }));
              return;
            }

            lastStatus = anthropicResp.status;
            const errText = await anthropicResp.text();
            lastError = errText;
            const isModelNotFound =
              anthropicResp.status === 404 || errText.includes('not_found_error') || errText.includes('model');
            if (!isModelNotFound) {
              break;
            }
          }

          res.statusCode = lastStatus;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: false, error: lastError }));
        } catch (err) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: false, error: String(err) }));
        }
      });
    },
  };
}

const MIME_BY_EXT: Record<string, string> = {
  '.json': 'application/json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.dxf': 'application/dxf; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.obj': 'text/plain; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.png': 'image/png',
};

function sanitizeExportFilename(raw: string): string {
  const base = path.basename(raw || 'export.txt').replace(/[^a-zA-Z0-9._-]/g, '_');
  return base && base !== '.' && base !== '..' ? base : 'export.txt';
}

/** Vite dev middleware that persists exports to ./exports and serves attachment downloads. */
function localExportServerPlugin(): Plugin {
  return {
    name: 'archstudio-local-export',
    configureServer(server) {
      const exportDir = path.resolve(process.cwd(), 'exports');

      server.middlewares.use('/api/export', (req, res, next) => {
        if (req.method === 'GET') {
          const reqUrl = new URL(req.url || '/', 'http://localhost');
          const fileParam = reqUrl.searchParams.get('file');
          if (!fileParam) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: false, error: 'Missing file query parameter' }));
            return;
          }
          const safeName = sanitizeExportFilename(fileParam);
          const fullPath = path.join(exportDir, safeName);
          if (!fs.existsSync(fullPath)) {
            res.statusCode = 404;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: false, error: 'Exported file not found' }));
            return;
          }
          const ext = path.extname(safeName).toLowerCase();
          res.statusCode = 200;
          res.setHeader('Content-Type', MIME_BY_EXT[ext] || 'application/octet-stream');
          res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
          res.end(fs.readFileSync(fullPath));
          return;
        }

        if (req.method === 'POST') {
          const chunks: Buffer[] = [];
          req.on('data', (chunk: Buffer) => chunks.push(chunk));
          req.on('end', () => {
            try {
              const rawBody = Buffer.concat(chunks).toString('utf8');
              const parsed = JSON.parse(rawBody) as {
                filename?: string;
                content?: string;
                encoding?: 'utf8' | 'base64';
              };
              if (!parsed.filename || typeof parsed.content !== 'string') {
                res.statusCode = 400;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ ok: false, error: 'Invalid payload: filename and content required' }));
                return;
              }
              const safeName = sanitizeExportFilename(parsed.filename);
              fs.mkdirSync(exportDir, { recursive: true });
              const fullPath = path.join(exportDir, safeName);
              const payload = parsed.encoding === 'base64'
                ? parsed.content.replace(/^data:[^;]+;base64,/, '')
                : parsed.content;
              fs.writeFileSync(
                fullPath,
                Buffer.from(payload, parsed.encoding === 'base64' ? 'base64' : 'utf8')
              );
              res.statusCode = 200;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ ok: true, savedPath: fullPath, filename: safeName }));
            } catch (err) {
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ ok: false, error: String(err) }));
            }
          });
          return;
        }

        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), localExportServerPlugin(), claudeReasoningProxyPlugin()],
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
  },
  server: {
    port: 5173,
    host: true,
  },
});
