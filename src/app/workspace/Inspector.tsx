import { useState, type ReactNode } from 'react';
import { ChevronDown, FlipHorizontal, Trash2 } from 'lucide-react';
import {
  getDesignConfig,
  getHVACConfig,
  getSolarConfig,
  type BuildingProject,
  type ClimateZone,
  type DoorFinishMaterial,
  type FloorFinish,
  type RoofType,
  type RoomCategory,
  type SelectableElementKind,
  type WallMaterial,
  type WindowFrameFinish,
} from '../../model/types';
import { computeTotalFloorArea, polygonArea, wallLength } from '../../engine/geometry';
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
}

const title = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
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

/* ── Inspector ─────────────────────────────────────────────────────── */

export function Inspector({ model, levelIndex, selection, onCommit, onDelete }: Props) {
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
          {header('Furniture', title(f.type))}
          <Section title="Placement">
            <Row label="Rotation">
              <Num value={f.rotation} unit="°" step={15} onChange={(v) => set((x) => (x.rotation = ((v % 360) + 360) % 360))} />
            </Row>
            <Row label="Width">
              <Num value={f.width} unit="m" min={0.3} max={6} onChange={(v) => set((x) => (x.width = v))} />
            </Row>
            <Row label="Depth">
              <Num value={f.depth} unit="m" min={0.3} max={6} onChange={(v) => set((x) => (x.depth = v))} />
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
        </>
      );
    }
  }

  return <BuildingPanel model={model} edit={edit} focusSolar={selection?.kind === 'solar_array' || selection?.kind === 'solar_panel'} />;
}

/* ── Nothing selected: the building as a whole ─────────────────────── */

function BuildingPanel({ model, edit, focusSolar }: { model: BuildingProject; edit: (fn: (m: BuildingProject) => void) => void; focusSolar: boolean }) {
  const design = getDesignConfig(model);
  const hvac = getHVACConfig(model);
  const solar = getSolarConfig(model);
  const rooms = model.levels.flatMap((l) => l.rooms);
  const area = computeTotalFloorArea(model);

  return (
    <>
      <div className="grid grid-cols-3 gap-px border-b border-line bg-line">
        {[
          ['Floor area', `${area.toFixed(0)} m²`],
          ['Levels', String(model.levels.length)],
          ['Rooms', String(rooms.length)],
        ].map(([k, v]) => (
          <div key={k} className="bg-surface px-4 py-3.5">
            <div className="text-2xs text-ink-3">{k}</div>
            <div className="mt-0.5 font-mono text-[15px] font-medium tabular-nums">{v}</div>
          </div>
        ))}
      </div>

      {focusSolar && <SolarSection model={model} edit={edit} solar={solar} />}

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
            <Num value={solar.panelCount} step={1} min={1} max={60} onChange={(v) => edit((m) => (m.solar = { ...solar, panelCount: Math.round(v), panelOffsets: {} }))} />
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
