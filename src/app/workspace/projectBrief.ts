/**
 * A compact, factual summary of the project for the AI Architect to answer questions from.
 * Numbers come from the same engines as the drawings and BOQ, so answers match the sheets.
 */
import { getDesignConfig, getHVACConfig, getRoofDrainageConfig, getSolarConfig, type BuildingProject } from '../../model/types';
import { calculateBOQ } from '../../engine/boqCalculator';
import { computeTotalFloorArea, polygonArea, wallLength } from '../../engine/geometry';

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

export function projectBrief(model: BuildingProject) {
  const boq = calculateBOQ(model);
  const design = getDesignConfig(model);
  const hvac = getHVACConfig(model);
  const solar = getSolarConfig(model);
  const rain = getRoofDrainageConfig(model.roof);

  const levels = model.levels.map((l) => {
    const walls = l.walls;
    const groups = new Map<string, { length: number; count: number }>();
    for (const w of walls) {
      const key = `${w.isExterior ? 'exterior' : 'interior'} ${w.material} ${Math.round(w.thickness * 1000)}mm × ${r2(w.height)}m high${w.isLoadBearing ? ', load-bearing' : ''}`;
      const g = groups.get(key) ?? { length: 0, count: 0 };
      g.length += wallLength(w);
      g.count++;
      groups.set(key, g);
    }
    return {
      name: l.name,
      floorLevel_m: l.elevation,
      floorToFloor_m: l.floorToFloorHeight,
      slab_mm: Math.round(l.slabThickness * 1000),
      rooms: l.rooms.map((r) => {
        const xs = r.polygon.map((p) => p.x);
        const ys = r.polygon.map((p) => p.y);
        return {
          name: r.name,
          use: r.category,
          area_m2: r1(polygonArea(r.polygon)),
          x_m: `${r1(Math.min(...xs))}–${r1(Math.max(...xs))}`,
          y_m: `${r1(Math.min(...ys))}–${r1(Math.max(...ys))}`,
          ceiling_m: r.ceilingHeight,
          floor: r.finish,
        };
      }),
      walls: [...groups.entries()].map(([k, g]) => `${k}: ${g.count} walls, ${r1(g.length)} m run`),
      doors: l.openings.filter((o) => o.kind === 'door').map((o) => `${o.label ?? ''} ${o.style} ${Math.round(o.width * 1000)}×${Math.round(o.height * 1000)}mm`.trim()),
      windows: l.openings.filter((o) => o.kind === 'window').map((o) => `${o.label ?? ''} ${o.style} ${Math.round(o.width * 1000)}×${Math.round(o.height * 1000)}mm sill ${Math.round(o.sillHeight * 1000)}`.trim()),
      columns: l.columns.length ? `${l.columns.length} RC columns, e.g. ${Math.round(l.columns[0].width * 1000)}×${Math.round(l.columns[0].depth * 1000)}mm, ${l.columns[0].rebarSpec}, pad ${l.columns[0].footingSize}m` : 'none',
      // Every element with its id, so changes can target it exactly.
      elements: {
        rooms: l.rooms.map((r) => `${r.id} "${r.name}"`),
        walls: l.walls.map((w) => `${w.id} (${r2(w.start.x)},${r2(w.start.y)})→(${r2(w.end.x)},${r2(w.end.y)}) ${Math.round(w.thickness * 1000)}mm ${w.isExterior ? 'ext' : 'int'} ${w.material} h${r2(w.height)}`),
        openings: l.openings.map((o) => {
          const w = l.walls.find((x) => x.id === o.wallId);
          const len = w ? wallLength(w) : 0;
          return `${o.id} ${o.label ?? ''} ${o.kind} ${o.style} ${Math.round(o.width * 1000)}×${Math.round(o.height * 1000)} sill ${Math.round(o.sillHeight * 1000)} on wall ${o.wallId} at ${r2(o.offset * len)}m${o.frameColor ? ` colour ${o.frameColor}` : ''}`;
        }),
        furniture: l.furniture.map((f) => `${f.id} ${f.type} at (${r2(f.position.x)},${r2(f.position.y)}) rot ${f.rotation} ${r2(f.width)}×${r2(f.depth)}`),
        fixtures: l.mepNodes
          .filter((n) => n.model || ['ac_split', 'ac_condenser', 'ceiling_fan', 'light_ceiling'].includes(n.kind))
          .map((n) => `${n.id} ${n.model ?? n.kind} at (${r2(n.position.x)},${r2(n.position.y)})`),
      },
    };
  });

  return {
    project: { title: model.meta.title, client: model.meta.client, location: model.meta.location, currency: model.meta.currency, code: model.meta.projectCode },
    grossFloorArea_m2: r1(computeTotalFloorArea(model)),
    planAxes: 'x grows east, y grows south (plan north up); metres',
    levels,
    roof: { type: model.roof.type, pitch_deg: model.roof.pitchDeg, overhang_m: model.roof.overhang, covering: model.roof.material, parapet_m: model.roof.parapetHeight },
    rainwater: rain,
    finishes: design,
    climateAndCooling: { climate: hvac.climateZone, ac: hvac.enabled, system: hvac.systemType, refrigerant: hvac.refrigerant, outdoor_C: hvac.designOutdoorTempC, indoor_C: hvac.designIndoorTempC, humidity_pct: hvac.designHumidityPct, ceilingFans: hvac.ceilingFansEnabled },
    solar: solar.enabled ? { panels: solar.panelCount, panel_Wp: solar.panelWattage, inverter_kW: solar.inverterKW, battery_kWh: solar.batteryKWh } : 'none',
    costEstimate: {
      total: Math.round(boq.grandTotal),
      perM2: Math.round(boq.costPerM2),
      contingencyPct: boq.contingencyPct,
      byTrade: boq.divisionTotals.map((d) => `${d.division}: ${Math.round(d.amount)} (${d.sharePct.toFixed(0)}%)`),
    },
    materialQuantities: boq.rawMaterials,
    boqLines: boq.items.map((i) => `${i.code} ${i.description}: ${r2(i.quantity)} ${i.unit} @ ${i.unitRate} = ${Math.round(i.totalCost)}`),
  };
}
