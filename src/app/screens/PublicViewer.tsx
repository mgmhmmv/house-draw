/**
 * The public 3D view at /v/<token>: the building's facade in 3D, for anyone with the link.
 * Turn, zoom and switch views; nothing else (no plans, services, client or project details).
 */
import { useEffect, useState } from 'react';
import type { BuildingProject } from '../../model/types';
import { ModelView } from '../drawing/three/ModelView';
import { Logo, Spinner } from '../ui';

export default function PublicViewer({ token }: { token: string }) {
  const [state, setState] = useState<{ name: string; model: BuildingProject } | { error: string } | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/public/model/${encodeURIComponent(token)}`)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!live) return;
        if (!r.ok) setState({ error: d.message || 'This link is not available.' });
        else setState({ name: d.name, model: d.model });
      })
      .catch(() => live && setState({ error: 'Could not load this view. Check your connection and try again.' }));
    return () => {
      live = false;
    };
  }, [token]);

  useEffect(() => {
    if (state && 'name' in state) document.title = `${state.name} · 3D view`;
  }, [state]);

  return (
    <div className="flex h-screen-safe flex-col bg-page">
      <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-line bg-surface px-4">
        <div className="min-w-0 truncate text-[15px] font-semibold text-ink">{state && 'name' in state ? state.name : ' '}</div>
        <a href="/" className="flex shrink-0 items-center gap-2 text-2xs text-ink-3 hover:text-ink-2" title="Made with Maavadiyaa">
          <Logo size={20} withWord />
        </a>
      </header>
      <main className="relative min-h-0 flex-1">
        {!state && (
          <div className="flex h-full items-center justify-center">
            <Spinner />
          </div>
        )}
        {state && 'error' in state && <div className="flex h-full items-center justify-center px-6 text-center text-sm text-ink-2">{state.error}</div>}
        {state && 'model' in state && <ModelView model={state.model} lookOnly />}
      </main>
    </div>
  );
}
