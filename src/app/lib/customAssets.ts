/** The user's own library objects (made with the AI), kept on the server and shared by projects. */
import { cleanSpec, registerCustomAssets, unregisterCustomAsset, type CustomAssetSpec } from '../drawing/assets/catalog';

let loaded: Promise<void> | null = null;

/** Load the user's objects into the library once per session. */
export function loadCustomAssets(force = false) {
  if (loaded && !force) return loaded;
  loaded = fetch('/api/assets')
    .then((r) => (r.ok ? (r.json() as Promise<{ assets: unknown[] }>) : { assets: [] }))
    .then((d) => registerCustomAssets(d.assets.flatMap((a) => cleanSpec(a) ?? [])))
    .catch(() => {
      loaded = null;
    });
  return loaded;
}

export async function saveCustomAsset(spec: CustomAssetSpec) {
  registerCustomAssets([spec]);
  const r = await fetch(`/api/assets/${spec.id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ spec }) });
  if (!r.ok) throw new Error('Could not save the object to your library.');
}

export async function deleteCustomAsset(id: string) {
  const r = await fetch(`/api/assets/${id}`, { method: 'DELETE' });
  if (!r.ok) throw new Error('Could not remove it.');
  unregisterCustomAsset(id);
}

/** Ask the AI to design an object (or revise `base`). */
export async function designAsset(prompt: string, base?: CustomAssetSpec): Promise<{ spec: CustomAssetSpec; note: string }> {
  const r = await fetch('/api/ai/asset', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt, base }) });
  const d = (await r.json().catch(() => ({}))) as { ok?: boolean; spec?: unknown; note?: string; error?: string };
  if (!d.ok) throw new Error(d.error?.slice(0, 200) || 'The AI could not design that.');
  const spec = cleanSpec({ ...(d.spec as object), id: base?.id });
  if (!spec) throw new Error('The design came back incomplete. Try describing it again.');
  return { spec, note: d.note ?? '' };
}
