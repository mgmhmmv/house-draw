import { assetFor } from '../drawing/assets/catalog';
import { getDesignConfig, getHVACConfig, getSolarConfig, type BuildingProject, type FloorLevel } from '../../model/types';

/**
 * A short, human label for what changed between two saved models, for the project history
 * ("Added Study · Moved 2 windows"). Compares by element id, level by level.
 */
export function describeChange(prev: BuildingProject | null, next: BuildingProject, max = 3): string {
  if (!prev) return 'Edited';
  const out: string[] = [];
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

  const prevLevels = new Map(prev.levels.map((l) => [l.id, l]));
  const nextIds = new Set(next.levels.map((l) => l.id));
  for (const l of next.levels) if (!prevLevels.has(l.id)) out.push(`Added ${l.name}`);
  for (const l of prev.levels) if (!nextIds.has(l.id)) out.push(`Removed ${l.name}`);

  const diff = <T extends { id: string }>(a: T[], b: T[]) => {
    const am = new Map(a.map((x) => [x.id, x]));
    const bm = new Map(b.map((x) => [x.id, x]));
    return {
      added: b.filter((x) => !am.has(x.id)),
      removed: a.filter((x) => !bm.has(x.id)),
      changed: b.filter((x) => am.has(x.id) && !same(am.get(x.id), x)),
    };
  };
  const names = (xs: { name: string }[]) => (xs.length <= 2 ? xs.map((x) => x.name).join(' and ') : plural(xs.length, 'room'));

  const many = next.levels.length > 1;
  for (const l of next.levels) {
    const p = prevLevels.get(l.id);
    if (!p) continue;
    const at = many ? ` (${l.name})` : '';
    const parts: string[] = [];
    const rooms = diff(p.rooms, l.rooms);
    if (rooms.added.length) parts.push(`Added ${names(rooms.added)}`);
    if (rooms.removed.length) parts.push(`Removed ${names(rooms.removed)}`);
    const renamed = rooms.changed.filter((r) => p.rooms.find((x) => x.id === r.id)?.name !== r.name);
    if (renamed.length) parts.push(`Renamed ${renamed.map((r) => r.name).join(', ')}`);
    const reshaped = rooms.changed.filter((r) => !renamed.includes(r));
    if (reshaped.length) parts.push(`Edited ${names(reshaped)}`);

    const walls = diff(p.walls, l.walls);
    const wallBits = [
      walls.added.length && `added ${plural(walls.added.length, 'wall')}`,
      walls.removed.length && `removed ${plural(walls.removed.length, 'wall')}`,
      walls.changed.length && `edited ${plural(walls.changed.length, 'wall')}`,
    ].filter(Boolean) as string[];
    if (wallBits.length) parts.push(cap(wallBits.join(', ')));

    for (const kind of ['door', 'window'] as const) {
      const pick = (lv: FloorLevel) => lv.openings.filter((o) => o.kind === kind);
      const d = diff(pick(p), pick(l));
      const bits = [
        d.added.length && `added ${plural(d.added.length, kind)}`,
        d.removed.length && `removed ${plural(d.removed.length, kind)}`,
        d.changed.length && `edited ${plural(d.changed.length, kind)}`,
      ].filter(Boolean) as string[];
      if (bits.length) parts.push(cap(bits.join(', ')));
    }
    if (!same(p.columns, l.columns) || !same(p.stairs, l.stairs)) parts.push('Updated structure');
    if (!same(p.mepNodes, l.mepNodes) || !same(p.mepCircuits, l.mepCircuits)) parts.push('Updated services');
    const fur = diff(p.furniture, l.furniture);
    const fname = (t: string) => assetFor(t)?.name ?? t.replace(/_/g, ' ');
    const list = (xs: { type: string }[]) => (xs.length <= 2 ? xs.map((x) => fname(x.type)).join(' and ') : plural(xs.length, 'item'));
    if (fur.added.length) parts.push(`Added ${list(fur.added)}`);
    if (fur.removed.length) parts.push(`Removed ${list(fur.removed)}`);
    if (fur.changed.length) parts.push(`Moved ${list(fur.changed)}`);
    const fx = diff(p.mepNodes.filter((n) => n.model), l.mepNodes.filter((n) => n.model));
    if (fx.added.length) parts.push(`Added ${fx.added.map((n) => n.label ?? n.model).slice(0, 2).join(' and ')}`);
    if (p.name !== l.name) parts.push(`Renamed level to ${l.name}`);
    if (p.floorToFloorHeight !== l.floorToFloorHeight || p.elevation !== l.elevation || p.slabThickness !== l.slabThickness) parts.push('Changed level heights');
    out.push(...parts.map((x) => x + at));
  }

  if (prev.roof.type !== next.roof.type) out.push(`Roof: ${prev.roof.type} → ${next.roof.type}`);
  else if (!same(prev.roof, next.roof)) out.push('Changed the roof');
  // Compare with defaults filled in, so a config written out in full doesn't count as a change.
  if (!same(getSolarConfig(prev), getSolarConfig(next))) out.push('Changed solar');
  if (!same(getHVACConfig(prev), getHVACConfig(next))) out.push('Changed cooling');
  if (!same(getDesignConfig(prev), getDesignConfig(next))) out.push('Changed materials');
  if (!same(prev.rates, next.rates)) out.push('Changed rates');
  if (!same(prev.grid, next.grid)) out.push('Updated grid');
  if (!same(prev.meta, next.meta)) out.push('Updated project details');
  if (!same(prev.sections, next.sections)) out.push('Edited sections');
  const made = Object.values(next.customAssets ?? {}).filter((a) => !prev.customAssets?.[a.id]);
  if (made.length) out.unshift(`Made ${made.map((a) => a.name).slice(0, 2).join(' and ')}`);

  if (!out.length) return 'Edited';
  return out.length > max ? `${out.slice(0, max).join(' · ')} · +${out.length - max} more` : out.join(' · ');
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
