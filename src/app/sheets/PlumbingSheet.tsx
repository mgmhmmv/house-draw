import { useMemo } from 'react';
import { WATER_COLLECTION_META, type BuildingProject } from '../../model/types';
import { computePlumbingRiser, type PlumbingRiserReport } from '../../engine/mepEngine';
import { INK, INK_2, INK_3, MEP_COLOR } from '../drawing/style';
import { Card, DataTable, fmt, Kpis, SheetPage, Specs } from './kit';

export function PlumbingSheet({ model }: { model: BuildingProject }) {
  const r = useMemo(() => computePlumbingRiser(model), [model]);
  return (
    <SheetPage code="P-101" title="Plumbing and drainage" lede="Water supply, drainage and rainwater, sized from the fixtures in the plan.">
      <Kpis
        items={[
          { label: 'Daily demand', value: `${fmt(r.dailyWaterDemandLiters)} L`, hint: `${r.occupancyCount} occupants` },
          { label: 'Overhead tank', value: `${fmt(r.overheadTankLiters)} L` },
          { label: 'Ground tank', value: `${fmt(r.undergroundTankLiters)} L` },
          { label: 'Booster pump', value: `${fmt(r.boosterPumpKW, 2)} kW`, hint: `${fmt(r.pumpHeadMeters, 1)} m head` },
        ]}
      />

      <Card title="Riser diagram" flush>
        <div className="overflow-x-auto p-4">
          <Riser r={r} levels={model.levels.map((l) => ({ name: l.name.replace(/\s*\(.*\)/, ''), elevation: l.elevation }))} />
        </div>
      </Card>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card title="Supply and drainage">
          <Specs
            rows={[
              ['Supply main', r.supplyMainPipe],
              ['Peak flow', `${fmt(r.peakFlowLps, 2)} L/s at ${fmt(r.designVelocityMps, 1)} m/s`],
              ['Soil stack', r.soilStackPipe],
              ['Waste stack', r.wasteStackPipe],
              ['Fixture units', `${fmt(r.totalWSFU, 1)} WSFU supply · ${fmt(r.totalDFU, 1)} DFU drainage`],
            ]}
          />
        </Card>
        <Card title="Rainwater">
          <Specs
            rows={[
              ['Roof catchment', `${fmt(r.roofCatchmentM2, 1)} m² at ${fmt(r.rainfallIntensityMmh)} mm/h`],
              ['Peak runoff', `${fmt(r.stormwaterRunoffLps, 2)} L/s`],
              ['Gutters', r.gutterEnabled ? r.gutterSpec : 'None'],
              ['Downpipes', `${r.rainwaterDownpipesCount} × ${r.rainwaterPipeSpec}`],
              ['Collection', WATER_COLLECTION_META[r.waterCollectionMode]?.label ?? r.waterCollectionMode],
              ['Storage', r.rainwaterTankSpec],
              ['First-flush diverter', r.firstFlushDiverter ? 'Yes' : 'No'],
            ]}
          />
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card title="Fixtures" flush>
          <DataTable<PlumbingRiserReport['fixtureSummary'][number]>
            rows={r.fixtureSummary}
            rowKey={(f) => f.label}
            columns={[
              { key: 'f', label: 'Fixture', render: (f) => f.label },
              { key: 'n', label: 'Count', align: 'right', render: (f) => f.count },
              { key: 'e', label: 'DFU each', align: 'right', render: (f) => fmt(f.dfuEach, 1) },
              { key: 't', label: 'DFU total', align: 'right', render: (f) => <span className="font-medium">{fmt(f.totalDfu, 1)}</span> },
            ]}
          />
        </Card>
        <Card title="Inspection chambers" flush>
          <DataTable<PlumbingRiserReport['inspectionChambers'][number]>
            rows={r.inspectionChambers}
            rowKey={(c) => c.id}
            columns={[
              { key: 'id', label: 'Ref', mono: true, width: '70px', render: (c) => c.id },
              { key: 'l', label: 'Location', render: (c) => c.location },
              { key: 's', label: 'Size', render: (c) => c.sizeMm },
              { key: 'iv', label: 'Invert', align: 'right', render: (c) => `${c.invertLevelM.toFixed(2)} m` },
            ]}
          />
        </Card>
      </div>
    </SheetPage>
  );
}

/** Schematic riser: supply on the left, drainage in the middle, rainwater on the right. */
function Riser({ r, levels }: { r: PlumbingRiserReport; levels: { name: string; elevation: number }[] }) {
  const W = 880;
  const top = 70;
  const floorGap = 110;
  const floors = [...levels].reverse();
  const groundY = top + floors.length * floorGap + 30;
  const H = groundY + 120;
  const yOf = (i: number) => top + (floors.length - 1 - i) * floorGap + 60; // i = level index from bottom
  const cold = MEP_COLOR.plumbingCold;
  const drain = MEP_COLOR.drain;
  const rain = '#5C8FBF';
  const T = ({ x, y, children, anchor = 'start', weight = 400, color = INK_2, size = 11 }: { x: number; y: number; children: React.ReactNode; anchor?: 'start' | 'middle' | 'end'; weight?: number; color?: string; size?: number }) => (
    <text x={x} y={y} textAnchor={anchor} fontSize={size} fontWeight={weight} fill={color}>
      {children}
    </text>
  );

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="max-w-none" style={{ fontFamily: 'Inter, system-ui, sans-serif' }} role="img" aria-label="Plumbing riser diagram">
      {/* Floors */}
      {levels.map((l, i) => (
        <g key={l.name}>
          <line x1={150} y1={yOf(i) + 30} x2={W - 40} y2={yOf(i) + 30} stroke="#E4E0D6" strokeWidth={1} strokeDasharray="6 4" />
          <T x={20} y={yOf(i) + 34} weight={600} color={INK}>
            {l.name}
          </T>
          <T x={20} y={yOf(i) + 48} color={INK_3} size={10}>
            FFL +{l.elevation.toFixed(2)}
          </T>
        </g>
      ))}
      <line x1={20} y1={groundY} x2={W - 20} y2={groundY} stroke={INK} strokeWidth={2.2} />
      <T x={W - 20} y={groundY - 6} anchor="end" color={INK_3} size={10}>
        Ground
      </T>

      {/* Supply: main → ground tank → pump → overhead tank → down-feed */}
      <g stroke={cold} strokeWidth={2} fill="none">
        <path d={`M170 ${groundY + 60}H230V${groundY + 20}`} />
        <path d={`M300 ${groundY + 20}V${groundY + 6}`} />
        <path d={`M300 ${groundY - 30}V${top - 10}H360V${top}`} />
        <path d={`M420 ${top + 34}V${yOf(0) + 26}`} />
        {levels.map((_, i) => (
          <path key={i} d={`M420 ${yOf(i) + 22}H470`} />
        ))}
      </g>
      <T x={170} y={groundY + 76} color={INK_3} size={10}>
        Water main {r.supplyMainPipe}
      </T>
      <rect x={200} y={groundY + 20} width={130} height={52} rx={6} fill="#fff" stroke={cold} strokeWidth={1.6} />
      <T x={265} y={groundY + 42} anchor="middle" weight={600} color={INK}>
        Ground tank
      </T>
      <T x={265} y={groundY + 58} anchor="middle" color={INK_3} size={10}>
        {fmt(r.undergroundTankLiters)} L
      </T>
      <circle cx={300} cy={groundY - 12} r={18} fill="#fff" stroke={cold} strokeWidth={1.6} />
      <path d={`M292 ${groundY - 12}l14 -8v16z`} fill={cold} />
      <T x={324} y={groundY - 8} color={INK_3} size={10}>
        Pump {fmt(r.boosterPumpKW, 2)} kW
      </T>
      <rect x={350} y={top} width={140} height={34} rx={6} fill="#fff" stroke={cold} strokeWidth={1.6} />
      <T x={420} y={top + 21} anchor="middle" weight={600} color={INK}>
        Overhead {fmt(r.overheadTankLiters)} L
      </T>
      {levels.map((_, i) => (
        <g key={i}>
          <circle cx={474} cy={yOf(i) + 22} r={4} fill={cold} />
          <T x={484} y={yOf(i) + 26} color={INK_2} size={10.5}>
            Cold to fixtures
          </T>
        </g>
      ))}

      {/* Drainage stack → chambers → sewer */}
      <g stroke={drain} strokeWidth={3.5} fill="none">
        <path d={`M600 ${top + 20}V${groundY + 40}H${W - 120}`} />
        {levels.map((_, i) => (
          <path key={i} d={`M560 ${yOf(i) + 24}H600`} />
        ))}
      </g>
      <T x={612} y={top + 26} weight={600} color={INK}>
        Soil stack
      </T>
      <T x={612} y={top + 40} color={INK_3} size={10}>
        {r.soilStackPipe}
      </T>
      <T x={612} y={top + 54} color={INK_3} size={10}>
        Vent through roof
      </T>
      {r.inspectionChambers.slice(0, 4).map((c, i) => {
        const x = 650 + i * 50;
        return (
          <g key={c.id}>
            <rect x={x - 12} y={groundY + 30} width={24} height={20} fill="#fff" stroke={drain} strokeWidth={1.4} />
            <T x={x} y={groundY + 66} anchor="middle" color={INK_3} size={9.5}>
              {c.id}
            </T>
          </g>
        );
      })}
      <T x={W - 114} y={groundY + 44} color={INK_2} size={10.5}>
        → Sewer / septic
      </T>

      {/* Rainwater */}
      <g stroke={rain} strokeWidth={2} fill="none">
        <path d={`M${W - 150} ${top}H${W - 60}`} strokeWidth={3} />
        <path d={`M${W - 70} ${top}V${groundY - 10}`} />
      </g>
      <T x={W - 150} y={top - 8} weight={600} color={INK}>
        Roof {fmt(r.roofCatchmentM2)} m²
      </T>
      <T x={W - 78} y={top + 40} anchor="end" color={INK_3} size={10}>
        {r.rainwaterDownpipesCount} downpipes
      </T>
      <rect x={W - 110} y={groundY - 54} width={80} height={44} rx={6} fill="#fff" stroke={rain} strokeWidth={1.6} />
      <T x={W - 70} y={groundY - 28} anchor="middle" weight={600} color={INK} size={10.5}>
        {(WATER_COLLECTION_META[r.waterCollectionMode]?.shortLabel ?? 'Collection').split(' ')[0]}
      </T>
    </svg>
  );
}
