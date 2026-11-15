import { useMemo } from 'react';
import type { BuildingProject } from '../../model/types';
import { computeHVACReport, type HVACRoomLoadRow } from '../../engine/mepEngine';
import { BarList, Card, DataTable, fmt, Kpis, SheetPage, Specs } from './kit';

export function HvacSheet({ model }: { model: BuildingProject }) {
  const r = useMemo(() => computeHVACReport(model), [model]);
  return (
    <SheetPage code="H-101" title="HVAC and cooling" lede="Room-by-room cooling loads and the units selected to meet them, for the project's climate.">
      <Kpis
        items={[
          { label: 'Cooling load', value: `${fmt(r.totalCoolingKWth, 1)} kW`, hint: `${fmt(r.totalCoolingBtu)} Btu/h · ${fmt(r.totalCoolingTons, 1)} TR` },
          { label: 'Electrical input', value: `${fmt(r.totalElectricalKW, 1)} kW` },
          { label: 'Efficiency', value: `SEER ${fmt(r.seerCop, 1)}`, hint: `SHR ${r.sensibleHeatRatio.toFixed(2)}` },
          { label: 'Outdoor units', value: String(r.condenserUnitsCount) },
        ]}
      />

      <div className="grid gap-5 xl:grid-cols-[1.2fr_1fr]">
        <Card title="Cooling by room">
          <BarList
            items={[...r.rows].sort((a, b) => b.totalCoolingWatts - a.totalCoolingWatts).map((x) => ({ label: x.roomName, value: x.totalCoolingWatts / 1000, note: x.unitTag }))}
            format={(n) => `${fmt(n, 2)} kW`}
          />
        </Card>
        <Card title="Design basis">
          <Specs
            rows={[
              ['Climate', r.climateLabel],
              ['Outdoor design', r.outdoorSpec],
              ['Indoor design', r.indoorSpec],
              ['Refrigerant', r.refrigerantSpec],
              ['Condenser protection', r.condenserCoatingSpec],
              ['Fresh air', r.ventilationSpec],
            ]}
          />
        </Card>
      </div>

      <Card title="Room load schedule" flush>
        <DataTable<HVACRoomLoadRow>
          rows={r.rows}
          rowKey={(x) => x.roomId}
          group={(x) => x.levelName}
          columns={[
            { key: 'code', label: 'Ref', width: '70px', mono: true, render: (x) => x.roomCode },
            { key: 'room', label: 'Room', render: (x) => x.roomName },
            { key: 'area', label: 'Area (m²)', align: 'right', render: (x) => fmt(x.areaM2, 1) },
            { key: 's', label: 'Sensible (W)', align: 'right', render: (x) => fmt(x.sensibleWatts) },
            { key: 'l', label: 'Latent (W)', align: 'right', render: (x) => fmt(x.latentWatts) },
            { key: 't', label: 'Total (W)', align: 'right', render: (x) => <span className="font-medium">{fmt(x.totalCoolingWatts)}</span> },
            { key: 'unit', label: 'Unit', render: (x) => (x.unitCount ? `${x.unitCount} × ${fmt(x.selectedBtu)} Btu` : <span className="text-ink-3">—</span>) },
            { key: 'tag', label: 'Tag', render: (x) => <span className="text-ink-2">{x.unitTag}</span> },
            { key: 'cfm', label: 'Airflow', align: 'right', render: (x) => `${fmt(x.airflowCfm)} cfm` },
            { key: 'pipe', label: 'Refrigerant pipe', render: (x) => <span className="text-ink-2">{x.refrigerantPipeSpec}</span> },
            { key: 'fan', label: 'Fan', render: (x) => (x.hasCeilingFan ? 'Yes' : '—') },
          ]}
        />
      </Card>
    </SheetPage>
  );
}
