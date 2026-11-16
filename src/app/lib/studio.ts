/** The studio details printed in every drawing's title block (per user, stored on the server). */
export interface StudioProfile {
  studioName: string;
  legalName: string;
  regNo: string;
  tin: string;
  address: string;
  phone: string;
  email: string;
  drawnBy: string;
  checkedBy: string;
  /** Drawing number prefix, e.g. "RS" → RS-55632-A101. */
  prefix: string;
  /** General notes, one per line. */
  notes: string;
}

export const DEFAULT_NOTES = [
  'Do not scale. Dimensions govern; check on site before ordering or fabricating.',
  'Dimensions in millimetres unless noted. Levels in metres.',
  'Read with the structural, electrical and plumbing drawings.',
  'Any discrepancy to be reported to the designer before work proceeds.',
].join('\n');

const EMPTY: StudioProfile = { studioName: '', legalName: '', regNo: '', tin: '', address: '', phone: '', email: '', drawnBy: '', checkedBy: '', prefix: '', notes: DEFAULT_NOTES };

let cache: StudioProfile | null = null;

/** Maavadiyaa's own details, used wherever the studio hasn't filled a field in. */
async function defaults(): Promise<StudioProfile> {
  const d: StudioProfile = { ...EMPTY, studioName: 'Maavadiyaa', prefix: 'MV' };
  try {
    const me = (await (await fetch('/api/auth/me')).json()) as { user?: { name?: string; email?: string } | null };
    if (me.user?.name) d.drawnBy = me.user.name;
    if (me.user?.email) d.email = me.user.email;
  } catch {
    /* offline: the fixed defaults still apply */
  }
  return d;
}

/** Saved values win; empty ones fall back to the defaults. */
const fill = (saved: Partial<StudioProfile>, d: StudioProfile): StudioProfile =>
  Object.fromEntries((Object.keys(d) as (keyof StudioProfile)[]).map((k) => [k, (saved[k] ?? '').trim() ? saved[k] : d[k]])) as unknown as StudioProfile;

export async function getStudio(): Promise<StudioProfile> {
  if (cache) return cache;
  const d = await defaults();
  try {
    const r = await fetch('/api/settings');
    const s = (await r.json()) as { settings?: Partial<StudioProfile> };
    cache = fill(s.settings ?? {}, d);
  } catch {
    cache = d;
  }
  return cache;
}

export async function saveStudio(p: StudioProfile): Promise<StudioProfile> {
  const r = await fetch('/api/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ settings: p }) });
  if (!r.ok) throw new Error('Could not save.');
  cache = fill(((await r.json()) as { settings: Partial<StudioProfile> }).settings ?? {}, await defaults());
  return cache;
}
