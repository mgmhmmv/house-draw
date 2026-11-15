import { useMemo, useState } from 'react';
import { Download, FileText } from 'lucide-react';
import type { BOQRateConfig, BuildingProject } from '../../model/types';
import { calculateBOQ, type BOQLineItem } from '../../engine/boqCalculator';
import { exportBOQToCSV } from '../../export/exporters';
import { Button, toast } from '../ui';
import { BarList, Card, DataTable, fmt, Kpis, SheetPage } from './kit';

const RATE_LABELS: [keyof BOQRateConfig, string, string][] = [
  ['siteClearingPerM2', 'Site clearing', 'm²'],
  ['excavationPerM3', 'Excavation', 'm³'],
  ['pccBlindingPerM3', 'PCC blinding', 'm³'],
  ['footingConcretePerM3', 'Footing concrete', 'm³'],
  ['superConcretePerM3', 'Superstructure concrete', 'm³'],
  ['rebarPerKg', 'Reinforcement steel', 'kg'],
  ['formworkPerM2', 'Formwork', 'm²'],
  ['brickWallPerM3', 'Masonry walls', 'm³'],
  ['partitionWallPerM2', 'Partitions', 'm²'],
  ['plasterPerM2', 'Plaster', 'm²'],
  ['paintPerM2', 'Paint', 'm²'],
  ['tileFloorPerM2', 'Tiled floors', 'm²'],
  ['hardwoodFloorPerM2', 'Timber floors', 'm²'],
  ['roofStructurePerM2', 'Roof structure', 'm²'],
  ['roofCladdingPerM2', 'Roof covering', 'm²'],
  ['doorUnit', 'Doors', 'each'],
  ['windowPerM2', 'Windows', 'm²'],
  ['electricalPoint', 'Electrical points', 'each'],
  ['plumbingPoint', 'Plumbing points', 'each'],
];

export function BoqSheet({ model, onCommit }: { model: BuildingProject; onCommit: (m: BuildingProject) => void }) {
  const r = useMemo(() => calculateBOQ(model), [model]);
  const cur = model.meta.currency || '$';
  const [showRates, setShowRates] = useState(false);
  const money = (n: number) => `${cur} ${fmt(n)}`;

  const setRate = (k: keyof BOQRateConfig, v: number) => {
    const next = structuredClone(model);
    next.rates[k] = Math.max(0, v);
    onCommit(next);
  };

  const m = r.rawMaterials;
  return (
    <SheetPage
      code="Q-101"
      title="Bill of quantities"
      lede="Measured from the model and priced with your unit rates. Every change to the design updates it."
      actions={
        <>
          <Button size="sm" icon={<Download className="h-4 w-4" />} onClick={() => exportBOQToCSV(model, r).then(() => toast('BOQ exported'))}>
            Export CSV
          </Button>
          <Button size="sm" variant="ghost" icon={<FileText className="h-4 w-4" />} disabled title="Coming with the IslePOS connection">
            Quote in IslePOS
          </Button>
        </>
      }
    >
      <Kpis
        items={[
          { label: 'Estimated total', value: money(r.grandTotal), hint: `incl. ${r.contingencyPct}% contingency` },
          { label: 'Cost per m²', value: money(r.costPerM2) },
          { label: 'Floor area', value: `${fmt(r.grossFloorAreaM2, 1)} m²` },
          { label: 'Line items', value: String(r.items.length) },
        ]}
      />

      <div className="grid gap-5 xl:grid-cols-[1.3fr_1fr]">
        <Card title="Cost by trade">
          <BarList
            items={r.divisionTotals.map((d) => ({ label: d.division.replace(/^\d+\s*/, ''), value: d.amount, note: `${d.sharePct.toFixed(0)}%` }))}
            format={(n) => fmt(n)}
            unit={cur}
          />
        </Card>
        <Card title="Materials to order">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-2">
            {[
              ['Cement', `${fmt(m.cementBags50Kg)} bags`],
              ['Sand', `${fmt(m.riverSandM3, 1)} m³`],
              ['Aggregate', `${fmt(m.coarseAggregateM3, 1)} m³`],
              ['Blocks / bricks', fmt(m.bricksOrBlocksCount)],
              ['Rebar', `${fmt(m.rebarSteelKg)} kg`],
              ['Paint', `${fmt(m.paintLiters)} L`],
              ['Tiles', `${fmt(m.tileAreaM2, 1)} m²`],
            ].map(([k, val]) => (
              <div key={k} className="rounded-ctl bg-raised px-3 py-2.5">
                <div className="text-2xs text-ink-3">{k}</div>
                <div className="mt-0.5 text-sm font-semibold tabular-nums">{val}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card
        title="Unit rates"
        aside={
          <button onClick={() => setShowRates((s) => !s)} className="text-[13px] font-medium text-accent hover:underline">
            {showRates ? 'Hide' : 'Edit rates'}
          </button>
        }
        flush
      >
        {showRates ? (
          <div className="grid gap-x-6 gap-y-1 p-5 sm:grid-cols-2 lg:grid-cols-3">
            {RATE_LABELS.map(([k, label, unit]) => (
              <label key={k} className="flex items-center justify-between gap-3 py-1.5 text-[13px]">
                <span className="text-ink-2">{label}</span>
                <span className="flex items-center gap-1.5">
                  <input
                    type="number"
                    inputMode="decimal"
                    defaultValue={model.rates[k]}
                    onBlur={(e) => Number(e.target.value) !== model.rates[k] && setRate(k, Number(e.target.value))}
                    onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                    className="h-8 w-24 rounded-ctl border border-line bg-surface px-2 text-right tabular-nums focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15"
                  />
                  <span className="w-9 text-2xs text-ink-3">/{unit}</span>
                </span>
              </label>
            ))}
          </div>
        ) : (
          <p className="px-5 py-3.5 text-[13px] text-ink-3">Rates are in {cur}. Edit them to match your suppliers; the total updates as you type.</p>
        )}
      </Card>

      <Card title="Itemised bill" flush>
        <DataTable<BOQLineItem>
          rows={r.items}
          rowKey={(i) => i.code}
          group={(i) => i.division}
          columns={[
            { key: 'code', label: 'Ref', width: '72px', mono: true, render: (i) => i.code },
            { key: 'desc', label: 'Description', render: (i) => i.description },
            { key: 'qty', label: 'Qty', align: 'right', render: (i) => fmt(i.quantity, i.quantity < 100 ? 2 : 0) },
            { key: 'unit', label: 'Unit', render: (i) => <span className="text-ink-3">{i.unit}</span> },
            { key: 'rate', label: 'Rate', align: 'right', render: (i) => fmt(i.unitRate, 2) },
            { key: 'total', label: `Amount (${cur})`, align: 'right', render: (i) => <span className="font-medium">{fmt(i.totalCost)}</span> },
          ]}
          footer={
            <>
              <tr className="border-t border-line">
                <td colSpan={5} className="px-4 py-2 text-right text-[13px] text-ink-2">Subtotal</td>
                <td className="px-4 py-2 text-right text-[13px] tabular-nums">{fmt(r.subtotal)}</td>
              </tr>
              <tr>
                <td colSpan={5} className="px-4 py-2 text-right text-[13px] text-ink-2">Contingency ({r.contingencyPct}%)</td>
                <td className="px-4 py-2 text-right text-[13px] tabular-nums">{fmt(r.contingencyAmount)}</td>
              </tr>
              <tr className="border-t border-line bg-raised">
                <td colSpan={5} className="px-4 py-3 text-right text-sm font-semibold">Total</td>
                <td className="px-4 py-3 text-right text-sm font-semibold tabular-nums">{money(r.grandTotal)}</td>
              </tr>
            </>
          }
        />
      </Card>
    </SheetPage>
  );
}
