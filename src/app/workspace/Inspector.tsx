import { moduleLabel, moduleOf, pvString } from '../../model/pvModule';
import { useState, type ReactNode } from 'react';
import { ASSETS, assetFor, CATEGORIES } from '../drawing/assets/catalog';
import { computePlumbingRiser } from '../../engine/mepEngine';
import { siteLayout } from '../drawing/model3d/site';

import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ChevronDown, ChevronRight, FlipHorizontal, RotateCcw, Scissors, Trash2 } from 'lucide-react';
import {
  getDesignConfig,
  getRoofDrainageConfig,
  GUTTER_PROFILE_META,
  WATER_COLLECTION_META,
  type GutterProfile,
  type WaterCollectionMode,
  getHVACConfig,
  getSolarConfig,
  type BuildingProject,
  type ClimateZone,
  type DoorFinishMaterial,
  type FloorFinish,
  type RoofType,
  type RoomCategory,
  type SelectableElementKind,
  type FloorLevel,
  type WallMaterial,
  type WindowFrameFinish,
  getRoofStructure,
  ROOF_STRUCTURE_META,
  type RoofStructureSystem,
  getWaterSupply,
  WATER_SUPPLY_META,
  type WaterSupplyMode,
  getSite,
  type GateKind,
  BOUNDARY_FINISHES,
  type BoundaryFinish,
} from '../../model/types';
import { computeTotalFloorArea, polygonArea, uid, wallLength } from '../../engine/geometry';
import { mepAsset } from '../drawing/assets/render';
import { FACADE_MATERIAL_OPTIONS, FLOOR_FINISH_OPTIONS, INTERIOR_WALL_OPTIONS, ROOF_MATERIAL_OPTIONS } from '../../components/Viewport3D';
import { Button, cx, Select, Toggle } from '../ui';

export interface Selection {
  id: string;
  kind: SelectableElementKind;
}

interface Props {
  model: BuildingProject;
  levelIndex: number;
  selection: Selection | null;
  onCommit: (next: BuildingProject) => void;
  onDelete: () => void;
  /** Select another element (from a room's object list). */
  onSelect?: (id: string, kind: SelectableElementKind) => void;
}

const title = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const CATEGORY_NAME = Object.fromEntries(CATEGORIES.map((c) => [c.id, c.name])) as Record<string, string>;
const opts = <T extends string>(xs: readonly T[]) => xs.map((x) => ({ value: x, label: title(x) }));

const ROOM_CATEGORIES: RoomCategory[] = ['living', 'kitchen', 'dining', 'bedroom', 'bathroom', 'hallway', 'garage', 'office', 'utility', 'porch', 'balcony'];
const WALL_MATERIALS: WallMaterial[] = ['brick', 'cmu', 'cinder_block', 'coral_stone', 'concrete', 'timber', 'drywall'];
const ROOF_TYPES: RoofType[] = ['hip', 'gable', 'flat', 'shed'];
const CLIMATES: ClimateZone[] = ['maldives_tropical', 'temperate', 'arid_desert', 'mediterranean'];
const FRAMES: WindowFrameFinish[] = ['anthracite', 'bronze', 'silver_anodized', 'timber_oak', 'matte_black'];
const DOORS: DoorFinishMaterial[] = ['walnut', 'oak', 'matte_black', 'frosted_glass', 'white_lacquer'];

/* ── Building blocks ───────────────────────────────────────────────── */

function Section({ title, children, defaultOpen = true }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="border-b border-line last:border-b-0">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between px-5 py-3.5 text-left">
        <span className="text-[13px] font-semibold">{title}</span>
        <ChevronDown className={cx('h-4 w-4 text-ink-3 transition-transform', !open && '-rotate-90')} />
      </button>
      {open && <div className="space-y-3 px-5 pb-5">{children}</div>}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-8 items-center justify-between gap-4">
      <span className="shrink-0 text-[13px] text-ink-2">{label}</span>
      <div className="flex min-w-0 max-w-[60%] flex-1 justify-end">{children}</div>
    </div>
  );
}

function Num({ value, onChange, step = 0.05, min, max, unit }: { value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; unit?: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const n = Number(draft);
    if (Number.isFinite(n)) onChange(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n)));
    setDraft(null);
  };
  return (
    <div className="flex h-8 w-full max-w-[140px] items-center rounded-ctl border border-line bg-surface focus-within:border-accent focus-within:ring-4 focus-within:ring-accent/15">
      <input
        type="number"
        inputMode="decimal"
        step={step}
        value={draft ?? String(Math.round(value * 1000) / 1000)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        className="h-full min-w-0 flex-1 bg-transparent px-2.5 text-right font-mono text-[13px] tabular-nums focus:outline-none"
      />
      {unit && <span className="pr-2.5 text-2xs text-ink-3">{unit}</span>}
    </div>
  );
}

function Text({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      value={draft ?? value}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== null && draft !== value) onChange(draft);
        setDraft(null);
      }}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      className="h-8 w-full rounded-ctl border border-line bg-surface px-2.5 text-right text-[13px] focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15"
    />
  );
}

function Choice<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value as T)} className="max-w-[180px]">
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </Select>
  );
}

function Readout({ children }: { children: ReactNode }) {
  return <span className="font-mono text-[13px] tabular-nums text-ink">{children}</span>;
}

/** A row of colour swatches plus a custom picker; '' clears back to the project default. */
function Swatches({ value, onChange, presets }: { value?: string; onChange: (v: string | undefined) => void; presets: string[] }) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      <button
        onClick={() => onChange(undefined)}
        title="Project default"
        className={cx('flex h-6 items-center rounded-full border px-2 text-[10.5px] font-medium', !value ? 'border-accent text-accent' : 'border-line text-ink-3 hover:text-ink')}
      >
        Default
      </button>
      {presets.map((c) => (
        <button
          key={c}
          onClick={() => onChange(c)}
          title={c}
          className={cx('h-6 w-6 rounded-full border transition-transform hover:scale-110', value?.toLowerCase() === c.toLowerCase() ? 'border-accent ring-2 ring-accent/40' : 'border-black/10')}
          style={{ background: c }}
        />
      ))}
      <label title="Custom colour" className="relative h-6 w-6 cursor-pointer overflow-hidden rounded-full border border-dashed border-line-strong" style={value && !presets.includes(value) ? { background: value } : undefined}>
        <input type="color" value={value ?? '#ffffff'} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
      </label>
    </div>
  );
}

const WALL_COLORS = ['#F4F1EA', '#E9E2D4', '#D8CDB9', '#C9D3CF', '#B8C7D6', '#9DAF9A', '#D9B99B', '#8C8A85'];
const FRAME_COLORS = ['#F5F5F2', '#3A3F44', '#1E1E1E', '#9EA2A6', '#7A5A3A', '#B8925E', '#4B5D52', '#2F4A6B'];
const ITEM_COLORS = ['#B7AFA2', '#E7E1D6', '#6E6A64', '#2F3B4C', '#7E8F7A', '#A86F4C', '#C9A75B', '#8C4B3F', '#B88A5E', '#3A3A3A'];

/** Move buttons: nudge by a step in plan directions. */
function Nudge({ onMove, step = 0.1 }: { onMove: (dx: number, dy: number) => void; step?: number }) {
  const b = (dx: number, dy: number, icon: ReactNode, label: string) => (
    <button onClick={() => onMove(dx * step, dy * step)} title={label} aria-label={label} className="flex h-8 w-8 items-center justify-center rounded-ctl border border-line text-ink-2 hover:border-line-strong hover:text-ink">
      {icon}
    </button>
  );
  return (
    <div className="flex gap-1">
      {b(-1, 0, <ArrowLeft className="h-3.5 w-3.5" />, 'West')}
      {b(0, -1, <ArrowUp className="h-3.5 w-3.5" />, 'North')}
      {b(0, 1, <ArrowDown className="h-3.5 w-3.5" />, 'South')}
      {b(1, 0, <ArrowRight className="h-3.5 w-3.5" />, 'East')}
    </div>
  );
}

const inPoly = (pts: { x: number; y: number }[], x: number, y: number) => {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++)
    if (pts[i].y > y !== pts[j].y > y && x < ((pts[j].x - pts[i].x) * (y - pts[i].y)) / (pts[j].y - pts[i].y) + pts[i].x) inside = !inside;
  return inside;
};
const nearEdge = (pts: { x: number; y: number }[], x: number, y: number, tol: number) =>
  pts.some((a, i) => {
    const b = pts[(i + 1) % pts.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const L = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / L));
    return Math.hypot(a.x + dx * t - x, a.y + dy * t - y) <= tol;
  });

/* ── Inspector ─────────────────────────────────────────────────────── */

export function Inspector({ model, levelIndex, selection, onCommit, onDelete, onSelect }: Props) {
  const level = model.levels[levelIndex] ?? model.levels[0];

  /** Clone, let the caller mutate the clone, commit. */
  const edit = (fn: (m: BuildingProject) => void) => {
    const next = structuredClone(model);
    fn(next);
    onCommit(next);
  };
  const lvl = (m: BuildingProject) => m.levels[levelIndex] ?? m.levels[0];

  const header = (kind: string, name: string, extra?: ReactNode) => (
    <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
      <div className="min-w-0">
        <div className="text-2xs font-medium uppercase tracking-wide text-ink-3">{kind}</div>
        <div className="mt-0.5 truncate text-[15px] font-semibold">{name}</div>
      </div>
      <div className="flex shrink-0 gap-1">
        {extra}
        <Button size="sm" variant="ghost" onClick={onDelete} icon={<Trash2 className="h-4 w-4" />} aria-label="Delete" title="Delete (⌫)" />
      </div>
    </div>
  );

  if (selection?.kind === 'wall') {
    const w = level.walls.find((x) => x.id === selection.id);
    if (w) {
      const set = (fn: (x: NonNullable<typeof w>) => void) => edit((m) => fn(lvl(m).walls.find((x) => x.id === w.id)!));
      return (
        <>
          {header('Wall', `${w.isExterior ? 'Exterior' : 'Interior'} wall`)}
          <Section title="Geometry">
            <Row label="Length">
              <Readout>{wallLength(w).toFixed(2)} m</Readout>
            </Row>
            <Row label="Thickness">
              <Num value={w.thickness} unit="m" min={0.05} max={0.6} step={0.01} onChange={(v) => set((x) => (x.thickness = v))} />
            </Row>
            <Row label="Height">
              <Num value={w.height} unit="m" min={1} max={8} onChange={(v) => set((x) => (x.height = v))} />
            </Row>
          </Section>
          <Section title="Construction">
            <Row label="Material">
              <Choice value={w.material} options={opts(WALL_MATERIALS)} onChange={(v) => set((x) => (x.material = v))} />
            </Row>
            <Row label="Exterior">
              <Toggle label="Exterior" checked={w.isExterior} onChange={(v) => set((x) => (x.isExterior = v))} />
            </Row>
            <Row label="Load bearing">
              <Toggle label="Load bearing" checked={w.isLoadBearing} onChange={(v) => set((x) => (x.isLoadBearing = v))} />
            </Row>
          </Section>
          <Section title="Finish">
            <Row label="Colour">
              <Swatches value={w.color} presets={WALL_COLORS} onChange={(v) => set((x) => (v ? (x.color = v) : delete x.color))} />
            </Row>
          </Section>
          <WallSplit length={wallLength(w)} onSplit={(at) => edit((m) => splitWall(lvl(m), w.id, at))} />
        </>
      );
    }
  }

  if (selection?.kind === 'opening') {
    const o = level.openings.find((x) => x.id === selection.id);
    if (o) {
      const set = (fn: (x: NonNullable<typeof o>) => void) => edit((m) => fn(lvl(m).openings.find((x) => x.id === o.id)!));
      const styles = o.kind === 'door' ? ['single', 'double', 'sliding', 'garage'] : ['casement', 'sliding', 'picture', 'bay'];
      return (
        <>
          {header(
            o.kind === 'door' ? 'Door' : 'Window',
            o.label || title(o.style),
            <Button size="sm" variant="ghost" title="Flip swing" aria-label="Flip swing" icon={<FlipHorizontal className="h-4 w-4" />} onClick={() => set((x) => (x.swingDirection = x.swingDirection === 1 ? -1 : 1))} />
          )}
          <Section title="Size">
            <Row label="Width">
              <Num value={o.width} unit="m" min={0.4} max={6} onChange={(v) => set((x) => (x.width = v))} />
            </Row>
            <Row label="Height">
              <Num value={o.height} unit="m" min={0.3} max={4} onChange={(v) => set((x) => (x.height = v))} />
            </Row>
            {o.kind === 'window' && (
              <Row label="Sill height">
                <Num value={o.sillHeight} unit="m" min={0} max={2.5} onChange={(v) => set((x) => (x.sillHeight = v))} />
              </Row>
            )}
            <Row label="Position on wall">
              <Num value={Math.round(o.offset * 100)} unit="%" step={1} min={0} max={100} onChange={(v) => set((x) => (x.offset = v / 100))} />
            </Row>
          </Section>
          <Section title="Type">
            <Row label="Style">
              <Choice value={o.style} options={opts(styles as never[])} onChange={(v) => set((x) => (x.style = v))} />
            </Row>
            <Row label="Mark">
              <Text value={o.label ?? ''} onChange={(v) => set((x) => (x.label = v))} />
            </Row>
          </Section>
          <Section title="Finish">
            <Row label={o.kind === 'door' ? 'Door colour' : 'Frame colour'}>
              <Swatches value={o.frameColor} presets={FRAME_COLORS} onChange={(v) => set((x) => (v ? (x.frameColor = v) : delete x.frameColor))} />
            </Row>
          </Section>
        </>
      );
    }
  }

  if (selection?.kind === 'room') {
    const r = level.rooms.find((x) => x.id === selection.id);
    if (r) {
      const set = (fn: (x: NonNullable<typeof r>) => void) => edit((m) => fn(lvl(m).rooms.find((x) => x.id === r.id)!));
      return (
        <>
          {header('Room', r.name)}
          <Section title="Room">
            <Row label="Name">
              <Text value={r.name} onChange={(v) => set((x) => (x.name = v))} />
            </Row>
            <Row label="Use">
              <Choice value={r.category} options={opts(ROOM_CATEGORIES)} onChange={(v) => set((x) => (x.category = v))} />
            </Row>
            <Row label="Area">
              <Readout>{polygonArea(r.polygon).toFixed(1)} m²</Readout>
            </Row>
            <Row label="Ceiling height">
              <Num value={r.ceilingHeight} unit="m" min={2.1} max={6} onChange={(v) => set((x) => (x.ceilingHeight = v))} />
            </Row>
          </Section>
          <Section title="Finish">
            <Row label="Floor">
              <Choice
                value={r.finish}
                options={FLOOR_FINISH_OPTIONS.map((f) => ({ value: f.id as FloorFinish, label: f.label }))}
                onChange={(v) => set((x) => (x.finish = v))}
              />
            </Row>
          </Section>
          <RoomObjects level={level} polygon={r.polygon} onSelect={onSelect} />
        </>
      );
    }
  }

  if (selection?.kind === 'column') {
    const c = level.columns.find((x) => x.id === selection.id);
    if (c) {
      const set = (fn: (x: NonNullable<typeof c>) => void) => edit((m) => fn(lvl(m).columns.find((x) => x.id === c.id)!));
      return (
        <>
          {header('Column', c.label)}
          <Section title="Section">
            <Row label="Width">
              <Num value={c.width} unit="m" min={0.15} max={1.2} step={0.025} onChange={(v) => set((x) => (x.width = v))} />
            </Row>
            <Row label="Depth">
              <Num value={c.depth} unit="m" min={0.15} max={1.2} step={0.025} onChange={(v) => set((x) => (x.depth = v))} />
            </Row>
            <Row label="Pad footing">
              <Num value={c.footingSize} unit="m" min={0.6} max={4} onChange={(v) => set((x) => (x.footingSize = v))} />
            </Row>
            <Row label="Reinforcement">
              <Text value={c.rebarSpec} onChange={(v) => set((x) => (x.rebarSpec = v))} />
            </Row>
          </Section>
        </>
      );
    }
  }

  if (selection?.kind === 'furniture') {
    const f = level.furniture.find((x) => x.id === selection.id);
    if (f) {
      const set = (fn: (x: NonNullable<typeof f>) => void) => edit((m) => fn(lvl(m).furniture.find((x) => x.id === f.id)!));
      return (
        <>
          {header(assetFor(f.type) ? CATEGORY_NAME[assetFor(f.type)!.category] : 'Furniture', assetFor(f.type)?.name ?? title(f.type))}
          <Section title="Placement">
            <Row label="Rotation">
              <Num value={f.rotation} unit="°" step={15} onChange={(v) => set((x) => (x.rotation = ((v % 360) + 360) % 360))} />
            </Row>
            <Row label="Width">
              <Num value={f.width} unit="m" min={0.05} max={60} onChange={(v) => set((x) => (x.width = v))} />
            </Row>
            <Row label="Depth">
              <Num value={f.depth} unit="m" min={0.05} max={60} onChange={(v) => set((x) => (x.depth = v))} />
            </Row>
            <Row label="Height">
              <Num value={f.height ?? assetFor(f.type)?.h ?? 0.75} unit="m" min={0.01} max={20} onChange={(v) => set((x) => (x.height = v))} />
            </Row>
            {assetFor(f.type)?.mount === 'wall' && (
              <Row label="Mounted at">
                <Num value={f.elevation ?? assetFor(f.type)?.elevation ?? 0} unit="m" min={0} max={4} onChange={(v) => set((x) => (x.elevation = v))} />
              </Row>
            )}
            <Row label="Move">
              <Nudge onMove={(dx, dy) => set((x) => (x.position = { x: Math.round((x.position.x + dx) * 100) / 100, y: Math.round((x.position.y + dy) * 100) / 100 }))} />
            </Row>
          </Section>
          <Section title="Finish">
            <Row label="Colour">
              <Swatches value={f.color} presets={ITEM_COLORS} onChange={(v) => set((x) => (v ? (x.color = v) : delete x.color))} />
            </Row>
          </Section>
        </>
      );
    }
  }

  if (selection?.kind === 'mep_node') {
    const n = level.mepNodes.find((x) => x.id === selection.id);
    if (n) {
      const set = (fn: (x: NonNullable<typeof n>) => void) => edit((m) => fn(lvl(m).mepNodes.find((x) => x.id === n.id)!));
      return (
        <>
          {header(n.system === 'plumbing' ? 'Plumbing fixture' : 'Electrical point', n.label || title(n.kind))}
          <Section title="Details">
            <Row label="Label">
              <Text value={n.label ?? ''} onChange={(v) => set((x) => (x.label = v))} />
            </Row>
            {n.system === 'electrical' && (
              <Row label="Load">
                <Num value={n.wattage ?? 0} unit="W" step={10} min={0} onChange={(v) => set((x) => (x.wattage = v))} />
              </Row>
            )}
            {n.system === 'plumbing' && (
              <Row label="Fixture units">
                <Num value={n.dfu ?? 0} unit="DFU" step={1} min={0} onChange={(v) => set((x) => (x.dfu = v))} />
              </Row>
            )}
          </Section>
          {(() => {
            const def = mepAsset(n);
            if (!def) return null;
            const models = ASSETS.filter((a) => a.mep?.kind === n.kind);
            const sz = n.size ?? { w: def.w, d: def.d, h: def.h };
            const bracketed = def.id === 'ac_condenser_wall';
            return (
              <Section title="Model & mounting">
                {models.length > 1 && (
                  <Row label="Model">
                    <Choice
                      value={def.id}
                      options={models.map((a) => ({ value: a.id, label: a.name }))}
                      onChange={(v) =>
                        set((x) => {
                          x.model = v;
                          delete x.size;
                          delete x.elevation;
                        })
                      }
                    />
                  </Row>
                )}
                {bracketed && (
                  <Row label="Gap to wall">
                    <Num value={Math.round((sz.d - 0.3) * 1000) / 1000} unit="m" step={0.01} min={0.03} max={1} onChange={(v) => set((x) => (x.size = { ...sz, d: Math.round((0.3 + v) * 1000) / 1000 }))} />
                  </Row>
                )}
                {def.mount !== 'ceiling' && (
                  <Row label={def.mount === 'wall' ? 'Mounted at' : 'Raised by'}>
                    <Num value={n.elevation ?? def.elevation ?? 0} unit="m" min={0} max={6} onChange={(v) => set((x) => (x.elevation = v))} />
                  </Row>
                )}
                <Row label="Rotation">
                  <Num value={n.rotation ?? 0} unit="°" step={15} onChange={(v) => set((x) => (x.rotation = ((v % 360) + 360) % 360))} />
                </Row>
              </Section>
            );
          })()}
        </>
      );
    }
  }

  if (selection?.kind === 'boundary' || selection?.kind === 'gate') {
    return (
      <>
        <SiteSelection model={model} gateId={selection.kind === 'gate' ? selection.id.replace(/^gate:/, '') : null} edit={edit} onSelect={onSelect} />
        <BuildingPanel model={model} edit={edit} focusSolar={false} />
      </>
    );
  }

  if (selection?.kind === 'solar_panel' || selection?.kind === 'solar_array') {
    const idx = selection.kind === 'solar_panel' ? Number(selection.id.replace('solar_panel_', '')) : null;
    return (
      <>
        <SolarSelection model={model} index={idx} edit={edit} onSelect={onSelect} />
        <BuildingPanel model={model} edit={edit} focusSolar />
      </>
    );
  }

  return <BuildingPanel model={model} edit={edit} focusSolar={false} />;
}

/* ── Nothing selected: the building as a whole ─────────────────────── */

function BuildingPanel({ model, edit, focusSolar }: { model: BuildingProject; edit: (fn: (m: BuildingProject) => void) => void; focusSolar: boolean }) {
  const design = getDesignConfig(model);
  const roofStructure = getRoofStructure(model.roof);
  const waterSupply = getWaterSupply(model);
  const site = getSite(model);
  const hvac = getHVACConfig(model);
  const solar = getSolarConfig(model);
  const activeLevels = model.levels.filter((l) => !l.decorative);
  const scope = activeLevels.length ? activeLevels : model.levels;
  const rooms = scope.flatMap((l) => l.rooms);
  const area = computeTotalFloorArea(model);

  return (
    <>
      <div className="grid grid-cols-3 gap-px border-b border-line bg-line">
        {[
          ['Floor area', `${area.toFixed(0)} m²`],
          ['Levels', scope.length < model.levels.length ? `${scope.length}/${model.levels.length}` : String(model.levels.length)],
          ['Rooms', String(rooms.length)],
        ].map(([k, v]) => (
          <div key={k} className="bg-surface px-4 py-3.5">
            <div className="text-2xs text-ink-3">{k}</div>
            <div className="mt-0.5 font-mono text-[15px] font-medium tabular-nums">{v}</div>
          </div>
        ))}
      </div>

      {focusSolar && <SolarSection model={model} edit={edit} solar={solar} />}

      {model.levels.length > 1 && (
        <Section title="Floors in scope" defaultOpen={model.levels.some((l) => l.decorative)}>
          <p className="mb-2 text-[11px] leading-snug text-ink-3">
            Mark existing lower or context floors as decorative to show them in 3D &amp; elevations while excluding them from floor area, BOQ, and electrical load calculations.
          </p>
          <div className="space-y-1.5">
            {model.levels.map((lvl, idx) => (
              <div key={lvl.id} className="flex items-center justify-between gap-2 text-[12px]">
                <span className={lvl.decorative ? 'text-ink-3 line-through' : 'font-medium text-ink'}>
                  {lvl.name}
                </span>
                <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-ink-2">
                  <input
                    type="checkbox"
                    checked={!!lvl.decorative}
                    onChange={(e) =>
                      edit((m) => {
                        m.levels[idx].decorative = e.target.checked || undefined;
                      })
                    }
                    className="h-3.5 w-3.5 accent-accent"
                  />
                  Decorative
                </label>
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section title="Roof">
        <Row label="Form">
          <Choice value={model.roof.type} options={opts(ROOF_TYPES)} onChange={(v) => edit((m) => (m.roof.type = v))} />
        </Row>
        {model.roof.type !== 'flat' && (
          <Row label="Pitch">
            <Num value={model.roof.pitchDeg} unit="°" step={1} min={2} max={45} onChange={(v) => edit((m) => (m.roof.pitchDeg = v))} />
          </Row>
        )}
        <Row label="Overhang">
          <Num value={model.roof.overhang} unit="m" min={0} max={1.5} onChange={(v) => edit((m) => (m.roof.overhang = v))} />
        </Row>
        <Row label="Covering">
          <Choice value={model.roof.material} options={ROOF_MATERIAL_OPTIONS.map((o) => ({ value: o.id, label: o.label }))} onChange={(v) => edit((m) => (m.roof.material = v))} />
        </Row>
        {model.roof.type !== 'flat' && (
          <>
            <Row label="Structure">
              <Choice
                value={roofStructure.system}
                options={(Object.keys(ROOF_STRUCTURE_META) as RoofStructureSystem[]).map((k) => ({ value: k, label: ROOF_STRUCTURE_META[k].label }))}
                onChange={(v) => edit((m) => (m.roof.structure = { system: v }))}
              />
            </Row>
            <Row label={ROOF_STRUCTURE_META[roofStructure.system].kind === 'truss' ? 'Truss spacing' : 'Rafter spacing'}>
              <Num value={roofStructure.spacing} unit="m" step={0.05} min={0.3} max={2.4} onChange={(v) => edit((m) => (m.roof.structure = { ...roofStructure, spacing: v }))} />
            </Row>
            <Row label="Purlin spacing">
              <Num value={roofStructure.purlinSpacing} unit="m" step={0.05} min={0.2} max={2} onChange={(v) => edit((m) => (m.roof.structure = { ...roofStructure, purlinSpacing: v }))} />
            </Row>
            <p className="px-4 pb-3 text-2xs leading-relaxed text-ink-3">{ROOF_STRUCTURE_META[roofStructure.system].spec}.</p>
          </>
        )}
      </Section>

      <RainwaterSection model={model} edit={edit} />

      <Section title="Water supply">
        <Row label="Supply">
          <Choice
            value={waterSupply.mode}
            options={(Object.keys(WATER_SUPPLY_META) as WaterSupplyMode[]).map((k) => ({ value: k, label: WATER_SUPPLY_META[k].label }))}
            onChange={(v) => edit((m) => (m.waterSupply = { ...waterSupply, mode: v }))}
          />
        </Row>
        {waterSupply.mode === 'ground_tank_pump' && (
          <Row label="Ground tank">
            <Num value={computePlumbingRiser(model).storageTankLiters} unit="L" step={500} min={500} max={20000} onChange={(v) => edit((m) => (m.waterSupply = { ...waterSupply, storageLiters: v }))} />
          </Row>
        )}
        <p className="px-4 pb-3 text-2xs leading-relaxed text-ink-3">{WATER_SUPPLY_META[waterSupply.mode].note}</p>
      </Section>

      <Section title="Site" defaultOpen={!!model.site}>
        <Row label="Plot">
          <div className="flex items-center gap-1.5">
            <Num value={Number(site.plot.w.toFixed(2))} unit="m" step={0.5} min={4} max={200} onChange={(v) => edit((m) => (m.site = { ...site, plot: { ...site.plot, w: v } }))} />
            <span className="text-ink-3">×</span>
            <Num value={Number(site.plot.d.toFixed(2))} unit="m" step={0.5} min={4} max={200} onChange={(v) => edit((m) => (m.site = { ...site, plot: { ...site.plot, d: v } }))} />
          </div>
        </Row>
        <Row label="Boundary wall">
          <Toggle
            label="Boundary wall"
            checked={site.boundary}
            onChange={(v) =>
              edit((m) => (m.site = { ...site, boundary: v, gates: v && !site.gates.length ? [{ id: `gate${Date.now()}`, side: 'S', at: site.plot.w / 2, width: 3, kind: 'sliding', canopy: 'none', pedestrianWidth: 0.9 }] : site.gates }))
            }
          />
        </Row>
        {site.boundary && (
          <Row label="Wall height">
            <Num value={site.boundaryHeight} unit="m" step={0.1} min={0.6} max={3.5} onChange={(v) => edit((m) => (m.site = { ...site, boundaryHeight: v }))} />
          </Row>
        )}
        {site.gates[0] && (
          <>
            <Row label="Gate">
              <Choice
                value={site.gates[0].kind}
                options={[
                  { value: 'sliding', label: 'Sliding' },
                  { value: 'swing_double', label: 'Double swing' },
                  { value: 'timber', label: 'Timber' },
                  { value: 'pedestrian', label: 'Pedestrian only' },
                ]}
                onChange={(v) => edit((m) => (m.site = { ...site, gates: [{ ...site.gates[0], kind: v as GateKind }, ...site.gates.slice(1)] }))}
              />
            </Row>
            <Row label="Gate width">
              <Num value={site.gates[0].width} unit="m" step={0.1} min={0.8} max={8} onChange={(v) => edit((m) => (m.site = { ...site, gates: [{ ...site.gates[0], width: v }, ...site.gates.slice(1)] }))} />
            </Row>
            <Row label="Gate canopy">
              <Choice
                value={site.gates[0].canopy}
                options={[
                  { value: 'gable', label: 'Gable (two-slope)' },
                  { value: 'flat', label: 'Flat' },
                  { value: 'none', label: 'None' },
                ]}
                onChange={(v) => edit((m) => (m.site = { ...site, gates: [{ ...site.gates[0], canopy: v as 'gable' | 'flat' | 'none' }, ...site.gates.slice(1)] }))}
              />
            </Row>
            <Row label="Pedestrian door">
              <Toggle label="Pedestrian door" checked={site.gates[0].pedestrianWidth > 0} onChange={(v) => edit((m) => (m.site = { ...site, gates: [{ ...site.gates[0], pedestrianWidth: v ? 0.9 : 0 }, ...site.gates.slice(1)] }))} />
            </Row>
            <Row label="Meter at gate">
              <Toggle label="Meter at gate" checked={site.meterAtGate} onChange={(v) => edit((m) => (m.site = { ...site, meterAtGate: v }))} />
            </Row>
          </>
        )}
      </Section>

      <Section title="Materials">
        <Row label="Facade">
          <Choice value={design.exteriorFacade} options={FACADE_MATERIAL_OPTIONS.map((o) => ({ value: o.id, label: o.label }))} onChange={(v) => edit((m) => (m.design = { ...design, exteriorFacade: v }))} />
        </Row>
        <Row label="Interior walls">
          <Choice value={design.interiorWalls} options={INTERIOR_WALL_OPTIONS.map((o) => ({ value: o.id, label: o.label }))} onChange={(v) => edit((m) => (m.design = { ...design, interiorWalls: v }))} />
        </Row>
        <Row label="Window frames">
          <Choice value={design.windowFrame} options={opts(FRAMES)} onChange={(v) => edit((m) => (m.design = { ...design, windowFrame: v }))} />
        </Row>
        <Row label="Doors">
          <Choice value={design.doorMaterial} options={opts(DOORS)} onChange={(v) => edit((m) => (m.design = { ...design, doorMaterial: v }))} />
        </Row>
      </Section>

      <Section title="Climate & cooling" defaultOpen={false}>
        <Row label="Climate">
          <Choice value={hvac.climateZone} options={opts(CLIMATES)} onChange={(v) => edit((m) => (m.hvac = { ...hvac, climateZone: v }))} />
        </Row>
        <Row label="Air conditioning">
          <Toggle label="Air conditioning" checked={hvac.enabled} onChange={(v) => edit((m) => (m.hvac = { ...hvac, enabled: v }))} />
        </Row>
        <Row label="Ceiling fans">
          <Toggle label="Ceiling fans" checked={hvac.ceilingFansEnabled} onChange={(v) => edit((m) => (m.hvac = { ...hvac, ceilingFansEnabled: v }))} />
        </Row>
        <Row label="Design outdoor">
          <Num value={hvac.designOutdoorTempC} unit="°C" step={0.5} onChange={(v) => edit((m) => (m.hvac = { ...hvac, designOutdoorTempC: v }))} />
        </Row>
        <Row label="Design indoor">
          <Num value={hvac.designIndoorTempC} unit="°C" step={0.5} onChange={(v) => edit((m) => (m.hvac = { ...hvac, designIndoorTempC: v }))} />
        </Row>
      </Section>

      {!focusSolar && <SolarSection model={model} edit={edit} solar={solar} collapsed />}

      <Section title="Cost rates" defaultOpen={false}>
        <Row label="Currency">
          <Text value={model.meta.currency} onChange={(v) => edit((m) => (m.meta.currency = v))} />
        </Row>
        <p className="text-[13px] text-ink-3">Unit rates for every BOQ line are edited on the Bill of quantities sheet.</p>
      </Section>
    </>
  );
}

/** The boundary wall (finish, colour, height) or one of its gates (type, size, colour, canopy). */
function SiteSelection({
  model,
  gateId,
  edit,
  onSelect,
}: {
  model: BuildingProject;
  gateId: string | null;
  edit: (fn: (m: BuildingProject) => void) => void;
  onSelect?: (id: string, kind: SelectableElementKind) => void;
}) {
  const site = getSite(model);
  const setSite = (patch: Partial<typeof site>) => edit((m) => (m.site = { ...getSite(m), ...patch }));
  const gate = gateId ? site.gates.find((g) => g.id === gateId) : null;
  const setGate = (patch: Partial<NonNullable<typeof gate>>) => gate && setSite({ gates: site.gates.map((g) => (g.id === gate.id ? { ...g, ...patch } : g)) });
  const len = siteLayout(model).wallLength;
  return (
    <>
      <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div className="min-w-0">
          <div className="text-2xs font-medium uppercase tracking-wide text-ink-3">Site</div>
          <div className="mt-0.5 truncate text-[15px] font-semibold">{gate ? `Gate · ${gate.width.toFixed(1)} m` : `Boundary wall · ${len.toFixed(1)} m`}</div>
        </div>
      </div>
      {gate ? (
        <Section title="Gate">
          <Row label="Type">
            <Choice
              value={gate.kind}
              options={[
                { value: 'sliding', label: 'Sliding' },
                { value: 'swing_double', label: 'Double swing' },
                { value: 'timber', label: 'Timber' },
                { value: 'pedestrian', label: 'Pedestrian only' },
              ]}
              onChange={(v) => setGate({ kind: v as GateKind })}
            />
          </Row>
          <Row label="Clear width">
            <Num value={gate.width} unit="m" step={0.1} min={0.8} max={8} onChange={(v) => setGate({ width: v })} />
          </Row>
          <Row label="Position">
            <Num value={Number(gate.at.toFixed(2))} unit="m" step={0.1} min={0} max={200} onChange={(v) => setGate({ at: v })} />
          </Row>
          <Row label="Nudge">
            <Nudge onMove={(dx, dy) => setGate({ at: gate.at + (gate.side === 'N' || gate.side === 'S' ? dx : dy) })} />
          </Row>
          <Row label="Colour">
            <Swatches value={gate.color} onChange={(v) => setGate({ color: v })} presets={['#1F1F1F', '#3B3F45', '#6B7078', '#F2F2EF', '#7A4E2D', '#2F5D50', '#8C2F2B']} />
          </Row>
          <Row label="Canopy">
            <Choice
              value={gate.canopy}
              options={[
                { value: 'gable', label: 'Gable (two-slope)' },
                { value: 'flat', label: 'Flat' },
                { value: 'none', label: 'None' },
              ]}
              onChange={(v) => setGate({ canopy: v as 'gable' | 'flat' | 'none' })}
            />
          </Row>
          <Row label="Pedestrian door">
            <Toggle label="Pedestrian door" checked={gate.pedestrianWidth > 0} onChange={(v) => setGate({ pedestrianWidth: v ? 0.9 : 0 })} />
          </Row>
          <Row label="Meter at gate">
            <Toggle label="Meter at gate" checked={site.meterAtGate} onChange={(v) => setSite({ meterAtGate: v })} />
          </Row>
          <div className="flex justify-between px-4 pb-3">
            <Button size="sm" variant="ghost" onClick={() => onSelect?.('boundary', 'boundary')}>
              Boundary wall
            </Button>
            <Button size="sm" variant="ghost" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => setSite({ gates: site.gates.filter((g) => g.id !== gate.id) })}>
              Remove gate
            </Button>
          </div>
        </Section>
      ) : (
        <Section title="Boundary wall">
          <Row label="Finish">
            <Choice
              value={site.boundaryFinish}
              options={(Object.keys(BOUNDARY_FINISHES) as BoundaryFinish[]).map((k) => ({ value: k, label: BOUNDARY_FINISHES[k].label }))}
              onChange={(v) => setSite({ boundaryFinish: v as BoundaryFinish, boundaryColor: undefined })}
            />
          </Row>
          <Row label="Colour">
            <Swatches value={site.boundaryColor} onChange={(v) => setSite({ boundaryColor: v })} presets={['#F4F1EA', '#E6E1D6', '#D9D9D6', '#B9B6AF', '#DCCFB2', '#C8B79A', '#9E9385', '#A65A3E', '#5F6B66']} />
          </Row>
          <Row label="Height">
            <Num value={site.boundaryHeight} unit="m" step={0.1} min={0.6} max={3.5} onChange={(v) => setSite({ boundaryHeight: v })} />
          </Row>
          <Row label="Thickness">
            <Num value={site.boundaryThickness} unit="m" step={0.025} min={0.1} max={0.4} onChange={(v) => setSite({ boundaryThickness: v })} />
          </Row>
          <Row label="Plot">
            <div className="flex items-center gap-1.5">
              <Num value={Number(site.plot.w.toFixed(2))} unit="m" step={0.5} min={4} max={200} onChange={(v) => setSite({ plot: { ...site.plot, w: v } })} />
              <span className="text-ink-3">×</span>
              <Num value={Number(site.plot.d.toFixed(2))} unit="m" step={0.5} min={4} max={200} onChange={(v) => setSite({ plot: { ...site.plot, d: v } })} />
            </div>
          </Row>
          <p className="px-4 pb-2 text-2xs text-ink-3">{BOUNDARY_FINISHES[site.boundaryFinish].spec}.</p>
          <div className="flex justify-between px-4 pb-3">
            {site.gates[0] ? (
              <Button size="sm" variant="ghost" onClick={() => onSelect?.(`gate:${site.gates[0].id}`, 'gate')}>
                Gate
              </Button>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => setSite({ gates: [{ id: `gate${Date.now()}`, side: 'S', at: site.plot.w / 2, width: 3, kind: 'sliding', canopy: 'none', pedestrianWidth: 0.9 }] })}>
                Add a gate
              </Button>
            )}
            <Button size="sm" variant="ghost" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => setSite({ boundary: false })}>
              Remove wall
            </Button>
          </div>
        </Section>
      )}
    </>
  );
}

/**
 * Strings: how many, and panels in each. Setting them lays the array out one string per row and
 * sets the panel count; Auto-arrange puts every panel back in its row (clears manual moves).
 */
function SolarStrings({ edit, solar }: { edit: (fn: (m: BuildingProject) => void) => void; solar: ReturnType<typeof getSolarConfig> }) {
  const strings = solar.strings && solar.strings > 0 ? solar.strings : solar.panelCount >= 8 ? 2 : 1;
  const per = solar.panelsPerString && solar.panelsPerString > 0 ? solar.panelsPerString : Math.max(1, Math.ceil(solar.panelCount / strings));
  const voc = pvString(per, solar.module).vocColdV;
  const set = (st: number, pp: number) =>
    edit((m) => (m.solar = { ...getSolarConfig(m), strings: st, panelsPerString: pp, panelCount: st * pp, panelOffsets: {}, columns: undefined }));
  return (
    <>
      <Row label="Strings">
        <Num value={strings} step={1} min={1} max={8} onChange={(v) => set(Math.max(1, Math.round(v)), per)} />
      </Row>
      <Row label="Panels per string">
        <Num value={per} step={1} min={1} max={24} onChange={(v) => set(strings, Math.max(1, Math.round(v)))} />
      </Row>
      <Row label="String voltage">
        <Readout>
          <span className={voc > 550 ? 'text-warn' : ''}>
            {voc.toFixed(0)} V Voc at 20 °C · {pvString(per, solar.module).vmpV.toFixed(0)} V Vmp{voc > 550 ? ' · over a typical 550 V input' : ''}
          </span>
        </Readout>
      </Row>
      <Row label="Service gap every">
        <Num
          value={solar.serviceGapEvery ?? 0}
          unit="cols"
          step={1}
          min={0}
          max={12}
          onChange={(v) => edit((m) => (m.solar = { ...getSolarConfig(m), serviceGapEvery: Math.max(0, Math.round(v)) }))}
        />
      </Row>
      {(solar.serviceGapEvery ?? 0) > 0 && (
        <Row label="Gap width">
          <Num value={solar.serviceGapWidth ?? 0.6} unit="m" step={0.05} min={0.3} max={1.5} onChange={(v) => edit((m) => (m.solar = { ...getSolarConfig(m), serviceGapWidth: v }))} />
        </Row>
      )}
      <div className="flex justify-end px-4 pb-3">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => edit((m) => (m.solar = { ...getSolarConfig(m), strings, panelsPerString: per, panelCount: strings * per, panelOffsets: {}, columns: undefined, offsetX: 0, offsetY: 0 }))}
        >
          Auto-arrange · one string per row
        </Button>
      </div>
    </>
  );
}

function SolarSection({ model, edit, solar, collapsed }: { model: BuildingProject; edit: (fn: (m: BuildingProject) => void) => void; solar: ReturnType<typeof getSolarConfig>; collapsed?: boolean }) {
  void model;
  const kWp = (solar.panelCount * solar.panelWattage) / 1000;
  return (
    <Section title="Solar PV" defaultOpen={!collapsed}>
      <Row label="Solar system">
        <Toggle label="Solar system" checked={solar.enabled} onChange={(v) => edit((m) => (m.solar = { ...solar, enabled: v }))} />
      </Row>
      {solar.enabled && (
        <>
          <Row label="Array">
            <Readout>{kWp.toFixed(2)} kWp</Readout>
          </Row>
          <Row label="Panels">
            <Num value={solar.panelCount} step={1} min={1} max={60} onChange={(v) => edit((m) => (m.solar = { ...solar, panelCount: Math.round(v), panelOffsets: {}, strings: undefined, panelsPerString: undefined }))} />
          </Row>
          <SolarStrings edit={edit} solar={solar} />
          <Row label="Panel">
            <Readout>
              {moduleLabel(solar)} · {Math.round(moduleOf(solar).length * 1000)} × {Math.round(moduleOf(solar).width * 1000)} mm
            </Readout>
          </Row>
          <Row label="Panel rating">
            <Num value={solar.panelWattage} unit="Wp" step={5} min={100} max={800} onChange={(v) => edit((m) => (m.solar = { ...solar, panelWattage: v }))} />
          </Row>
          <Row label="Inverter">
            <Num value={solar.inverterKW} unit="kW" step={0.5} min={1} max={50} onChange={(v) => edit((m) => (m.solar = { ...solar, inverterKW: v }))} />
          </Row>
          <Row label="Battery">
            <Num value={solar.batteryKWh} unit="kWh" step={2.5} min={0} max={200} onChange={(v) => edit((m) => (m.solar = { ...solar, batteryKWh: v }))} />
          </Row>
        </>
      )}
    </Section>
  );
}

function RainwaterSection({ model, edit }: { model: BuildingProject; edit: (fn: (m: BuildingProject) => void) => void }) {
  const d = getRoofDrainageConfig(model.roof);
  if (model.roof.type === 'flat') return null;
  return (
    <Section title="Rainwater" defaultOpen={false}>
      <Row label="Gutters">
        <Toggle label="Gutters" checked={d.gutterEnabled} onChange={(v) => edit((m) => (m.roof.gutterEnabled = v))} />
      </Row>
      {d.gutterEnabled && (
        <>
          <Row label="Profile">
            <Choice
              value={d.gutterProfile}
              options={(Object.keys(GUTTER_PROFILE_META) as GutterProfile[]).map((k) => ({ value: k, label: GUTTER_PROFILE_META[k].shortLabel }))}
              onChange={(v) => edit((m) => (m.roof.gutterProfile = v))}
            />
          </Row>
          <Row label="Downpipes">
            <Num value={d.downpipeCount} step={1} min={1} max={8} onChange={(v) => edit((m) => (m.roof.downpipeCount = Math.round(v)))} />
          </Row>
          <Row label="Collection">
            <Choice
              value={d.waterCollectionMode}
              options={(Object.keys(WATER_COLLECTION_META) as WaterCollectionMode[]).map((k) => ({ value: k, label: WATER_COLLECTION_META[k].shortLabel }))}
              onChange={(v) => edit((m) => (m.roof.waterCollectionMode = v))}
            />
          </Row>
          {d.waterCollectionMode === 'harvesting_tank' && (
            <Row label="Tank size">
              <Num value={d.harvestingTankLiters} unit="L" step={500} min={500} max={20000} onChange={(v) => edit((m) => (m.roof.harvestingTankLiters = v))} />
            </Row>
          )}
          <Row label="First-flush diverter">
            <Toggle label="First-flush diverter" checked={d.firstFlushDiverter} onChange={(v) => edit((m) => (m.roof.firstFlushDiverter = v))} />
          </Row>
        </>
      )}
    </Section>
  );
}

/* ── Type-specific pieces ──────────────────────────────────────────── */

/** Split a wall in two at a distance from its start; openings go with the part they sit on. */
function splitWall(level: FloorLevel, id: string, at: number) {
  const i = level.walls.findIndex((w) => w.id === id);
  if (i < 0) return;
  const w = level.walls[i];
  const len = wallLength(w);
  if (at <= 0.1 || at >= len - 0.1) return;
  const t = at / len;
  const mid = { x: w.start.x + (w.end.x - w.start.x) * t, y: w.start.y + (w.end.y - w.start.y) * t };
  const b = { ...w, id: uid('w'), start: mid, end: { ...w.end } };
  level.walls[i] = { ...w, end: mid };
  level.walls.splice(i + 1, 0, b);
  for (const o of level.openings) {
    if (o.wallId !== id) continue;
    const s = o.offset * len;
    if (s < at) o.offset = s / at;
    else {
      o.wallId = b.id;
      o.offset = (s - at) / (len - at);
    }
  }
}

function WallSplit({ length, onSplit }: { length: number; onSplit: (at: number) => void }) {
  const [at, setAt] = useState(Math.round((length / 2) * 100) / 100);
  return (
    <Section title="Wall sections" defaultOpen={false}>
      <p className="text-2xs leading-relaxed text-ink-3">Split this wall into two sections, each with its own height, thickness, material and colour.</p>
      <Row label="Split at">
        <Num value={at} unit="m" min={0.15} max={Math.max(0.15, length - 0.15)} onChange={setAt} />
      </Row>
      <div className="flex justify-end">
        <Button size="sm" variant="secondary" icon={<Scissors className="h-3.5 w-3.5" />} onClick={() => onSplit(at)}>
          Split wall
        </Button>
      </div>
    </Section>
  );
}

/** Everything in a room, so a crowded room's items are easy to pick. */
function RoomObjects({ level, polygon, onSelect }: { level: FloorLevel; polygon: { x: number; y: number }[]; onSelect?: (id: string, kind: SelectableElementKind) => void }) {
  const items = [
    ...level.furniture.filter((f) => inPoly(polygon, f.position.x, f.position.y)).map((f) => ({ id: f.id, kind: 'furniture' as const, name: assetFor(f.type)?.name ?? title(f.type), group: 'Furniture' })),
    ...level.mepNodes
      .filter((n) => inPoly(polygon, n.position.x, n.position.y))
      .map((n) => ({ id: n.id, kind: 'mep_node' as const, name: n.label || mepAsset(n)?.name || title(n.kind), group: n.system === 'plumbing' ? 'Plumbing' : 'Services' })),
    ...level.openings
      .filter((o) => {
        const w = level.walls.find((x) => x.id === o.wallId);
        if (!w) return false;
        const c = { x: w.start.x + (w.end.x - w.start.x) * o.offset, y: w.start.y + (w.end.y - w.start.y) * o.offset };
        return nearEdge(polygon, c.x, c.y, w.thickness / 2 + 0.15);
      })
      .map((o) => ({ id: o.id, kind: 'opening' as const, name: `${o.kind === 'door' ? 'Door' : 'Window'} ${o.label ?? ''}`.trim(), group: 'Doors & windows' })),
  ];
  const groups = [...new Set(items.map((i) => i.group))];
  return (
    <Section title={`Objects (${items.length})`} defaultOpen={false}>
      {items.length === 0 ? (
        <p className="text-[13px] text-ink-3">Nothing placed in this room yet.</p>
      ) : (
        groups.map((g) => (
          <div key={g}>
            <p className="mb-1 text-2xs font-medium uppercase tracking-wide text-ink-3">{g}</p>
            <div className="-mx-2 space-y-0.5">
              {items
                .filter((i) => i.group === g)
                .map((i) => (
                  <button key={i.id} onClick={() => onSelect?.(i.id, i.kind)} className="flex w-full items-center gap-2 rounded-ctl px-2 py-1.5 text-left text-[13px] text-ink-2 hover:bg-sunken hover:text-ink">
                    <span className="min-w-0 flex-1 truncate">{i.name}</span>
                    <ChevronRight className="h-3.5 w-3.5 text-ink-3" />
                  </button>
                ))}
            </div>
          </div>
        ))
      )}
    </Section>
  );
}

/** A selected solar panel (or the whole array): move one panel, or the array as a whole. */
function SolarSelection({
  model,
  index,
  edit,
  onSelect,
}: {
  model: BuildingProject;
  index: number | null;
  edit: (fn: (m: BuildingProject) => void) => void;
  onSelect?: (id: string, kind: SelectableElementKind) => void;
}) {
  const solar = getSolarConfig(model);
  const panelMode = index !== null;
  const off = panelMode ? solar.panelOffsets?.[index] ?? { x: 0, y: 0 } : { x: solar.offsetX ?? 0, y: solar.offsetY ?? 0 };
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const setOff = (x: number, y: number) =>
    edit((m) => {
      const s = getSolarConfig(m);
      m.solar = panelMode ? { ...s, panelOffsets: { ...(s.panelOffsets ?? {}), [index!]: { x: r2(x), y: r2(y) } } } : { ...s, offsetX: r2(x), offsetY: r2(y) };
    });
  return (
    <>
      <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div className="min-w-0">
          <div className="text-2xs font-medium uppercase tracking-wide text-ink-3">Solar PV</div>
          <div className="mt-0.5 truncate text-[15px] font-semibold">{panelMode ? `Panel ${index! + 1} of ${solar.panelCount}` : `Array · ${solar.panelCount} panels`}</div>
        </div>
      </div>
      <p className="px-5 pt-3 text-2xs leading-relaxed text-ink-3">In 3D with the select tool, drag {panelMode ? 'the panel' : 'any panel'} to slide {panelMode ? 'it' : 'the array'} along the roof.</p>
      <Section title="Position">
        <Row label="Moving">
          <div className="flex rounded-ctl border border-line p-0.5">
            {[
              { on: panelMode, label: 'This panel', go: () => onSelect?.(`solar_panel_${index ?? 0}`, 'solar_panel') },
              { on: !panelMode, label: 'Whole array', go: () => onSelect?.('solar_array', 'solar_array') },
            ].map((b) => (
              <button key={b.label} onClick={b.go} className={cx('h-7 rounded-[7px] px-2.5 text-2xs font-medium', b.on ? 'bg-ink text-page' : 'text-ink-2 hover:text-ink')}>
                {b.label}
              </button>
            ))}
          </div>
        </Row>
        <Row label="East / west">
          <Num value={off.x} unit="m" step={0.05} min={-30} max={30} onChange={(v) => setOff(v, off.y)} />
        </Row>
        <Row label="North / south">
          <Num value={off.y} unit="m" step={0.05} min={-30} max={30} onChange={(v) => setOff(off.x, v)} />
        </Row>
        <Row label="Nudge">
          <Nudge onMove={(dx, dy) => setOff(off.x + dx, off.y + dy)} />
        </Row>
        {panelMode ? (
          <div className="flex justify-end">
            <Button size="sm" variant="ghost" icon={<RotateCcw className="h-3.5 w-3.5" />} onClick={() => setOff(0, 0)}>
              Back in line
            </Button>
          </div>
        ) : (
          <>
            <Row label="Turn array">
              <Choice
                value={String(solar.rotationDeg ?? 0) as '0'}
                options={['0', '90', '180', '270'].map((v) => ({ value: v as '0', label: `${v}°` }))}
                onChange={(v) => edit((m) => (m.solar = { ...getSolarConfig(m), rotationDeg: Number(v) }))}
              />
            </Row>
            <SolarStrings edit={edit} solar={solar} />
          </>
        )}
      </Section>
    </>
  );
}
