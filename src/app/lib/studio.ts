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

export async function getStudio(): Promise<StudioProfile> {
  if (cache) return cache;
  try {
    const r = await fetch('/api/settings');
    const d = (await r.json()) as { settings?: Partial<StudioProfile> };
    cache = { ...EMPTY, ...(d.settings ?? {}) };
  } catch {
    cache = { ...EMPTY };
  }
  return cache;
}

export async function saveStudio(p: StudioProfile): Promise<StudioProfile> {
  const r = await fetch('/api/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ settings: p }) });
  if (!r.ok) throw new Error('Could not save.');
  cache = { ...EMPTY, ...((await r.json()) as { settings: Partial<StudioProfile> }).settings };
  return cache;
}
