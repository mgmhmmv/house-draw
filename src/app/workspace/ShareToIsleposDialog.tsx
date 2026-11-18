/**
 * "Share to IslePOS": a link for the IslePOS Solar Suite. Paste it into a solar project there
 * (Drawings → Maavadiyaa) and it imports this design: strings, the cable runs measured on the 3D
 * model, the roof/array/cable geometry, the elevations, roof plan and 3D view, and the 3D link.
 * The link never expires; it can be turned off here. The runs and geometry follow every save;
 * the drawings are updated when you press Update drawings.
 */
import { useEffect, useMemo, useState } from 'react';
import { Copy, Power, RefreshCw, Sun } from 'lucide-react';
import type { BuildingProject } from '../../model/types';
import { api, ApiError } from '../lib/api';
import { solarExport, type SolarExport } from '../lib/solarExport';
import { Button, Dialog, Spinner, toast } from '../ui';

export function ShareToIsleposDialog({
  open,
  onClose,
  model,
  project,
  viewUrl,
  captureDrawings,
  onShared,
}: {
  open: boolean;
  onClose: () => void;
  model: BuildingProject;
  project: { id: string; name: string; version: number };
  viewUrl: string | null;
  /** Renders the elevations, roof plan and 3D view as A3 sheets (SVG). */
  captureDrawings: (onStep: (msg: string) => void) => Promise<SolarExport['drawings']>;
  onShared: (url: string | null) => void;
}) {
  const [link, setLink] = useState<{ url: string | null; updatedAt: number | null } | null>(null);
  const [busy, setBusy] = useState('');

  const exp = useMemo(() => {
    if (!open) return null;
    try {
      return { data: solarExport(model, { projectId: project.id, projectName: project.name, modelVersion: project.version, viewUrl }) };
    } catch (e) {
      return { error: e instanceof Error ? e.message : 'This design could not be shared.' };
    }
  }, [open, model, project.id, project.name, project.version, viewUrl]);

  useEffect(() => {
    if (!open) return;
    api
      .isleposShare(project.id)
      .then(setLink)
      .catch(() => setLink({ url: null, updatedAt: null }));
  }, [open, project.id]);

  const data = exp && 'data' in exp ? exp.data : null;

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast('Link copied · paste it in IslePOS → solar project → Drawings → Maavadiyaa');
    } catch {
      toast(url);
    }
  };

  /** Make (or refresh) the share: the export with freshly drawn sheets. */
  const share = async () => {
    if (!data) return;
    try {
      const drawings = await captureDrawings(setBusy);
      const size = JSON.stringify({ ...data, drawings }).length;
      if (size > 4.8 * 1024 * 1024) throw new Error(`The drawings come to ${(size / 1048576).toFixed(1)} MB; IslePOS takes up to 5 MB.`);
      setBusy('Saving the share…');
      const r = await api.putIsleposShare(project.id, { export: { ...data, drawings } });
      setLink(r);
      onShared(r.url);
      await copy(r.url);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Could not share');
    } finally {
      setBusy('');
    }
  };

  const stop = async () => {
    setBusy('Turning the link off…');
    try {
      await api.stopIsleposShare(project.id);
      setLink({ url: null, updatedAt: null });
      onShared(null);
      toast('Link turned off. IslePOS can no longer read this design through it.');
    } catch {
      toast('Could not turn the link off');
    } finally {
      setBusy('');
    }
  };

  return (
    <Dialog
      open={open}
      onClose={() => !busy && onClose()}
      title="Share to IslePOS"
      description="Paste this link into a solar project in the IslePOS Solar Suite (Drawings → Maavadiyaa). It brings in the strings, the cable runs measured on this 3D model, the elevations, roof plan, 3D view and the 3D link. The link never expires."
      wide
      footer={
        link?.url ? (
          <>
            <Button variant="ghost" onClick={stop} disabled={!!busy} icon={<Power className="h-4 w-4" />}>
              Turn link off
            </Button>
            <Button variant="secondary" onClick={share} disabled={!data || !!busy} icon={busy ? <Spinner /> : <RefreshCw className="h-4 w-4" />}>
              {busy || 'Update drawings'}
            </Button>
            <Button onClick={() => copy(link.url!)} disabled={!!busy} icon={<Copy className="h-4 w-4" />}>
              Copy link
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose} disabled={!!busy}>
              Cancel
            </Button>
            <Button onClick={share} disabled={!data || !!busy || !link} icon={busy ? <Spinner /> : <Sun className="h-4 w-4" />}>
              {busy || 'Make link'}
            </Button>
          </>
        )
      }
    >
      {exp && 'error' in exp && <p className="rounded-[10px] bg-warn/10 px-3 py-2 text-sm text-ink">{exp.error}</p>}
      {link?.url && (
        <div className="mb-4 rounded-[12px] border border-line bg-sunken/50 px-3 py-2">
          <div className="break-all font-mono text-[12px] text-ink">{link.url}</div>
          <div className="mt-1 text-2xs text-ink-3">
            Runs and layout follow every save of this design. Drawings as of {link.updatedAt ? new Date(link.updatedAt).toLocaleString() : 'the last share'} — press Update drawings after changing the building.
          </div>
        </div>
      )}
      {data && (
        <div className="rounded-[12px] border border-line p-3">
          <div className="mb-2 text-[13px] font-medium text-ink">
            {data.system.strings.length} strings × {data.system.strings[0]?.panelsInSeries} × {data.panel.wp} W {data.panel.model} · {data.system.inverterKw} kW inverter · {data.system.phase}-phase
          </div>
          <table className="w-full text-[13px] text-ink-2">
            <thead>
              <tr className="text-left text-2xs uppercase tracking-wide text-ink-3">
                <th className="py-1 font-medium">Run (measured on the 3D model)</th>
                <th className="py-1 text-right font-medium">+ pole</th>
                <th className="py-1 text-right font-medium">− pole</th>
              </tr>
            </thead>
            <tbody>
              {data.runs.perString.map((r) => (
                <tr key={r.stringId} className="border-t border-line">
                  <td className="py-1">String {r.stringId.slice(1)} · DC</td>
                  <td className="py-1 text-right tabular-nums">{r.positiveM.toFixed(1)} m</td>
                  <td className="py-1 text-right tabular-nums">{r.negativeM.toFixed(1)} m</td>
                </tr>
              ))}
              <tr className="border-t border-line">
                <td className="py-1">Inverter → main board · AC</td>
                <td className="py-1 text-right tabular-nums" colSpan={2}>
                  {data.runs.acRunM.toFixed(1)} m
                </td>
              </tr>
              <tr className="border-t border-line">
                <td className="py-1">Array bonding · earth</td>
                <td className="py-1 text-right tabular-nums" colSpan={2}>
                  {data.runs.earthRunM.toFixed(1)} m
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </Dialog>
  );
}
