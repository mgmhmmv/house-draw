import React, { useMemo } from 'react';
import { BuildingProject, BOQRateConfig } from '../model/types';
import { calculateBOQ } from '../engine/boqCalculator';
import { exportBOQToCSV } from '../export/exporters';
import { TitleBlock } from './TitleBlock';
import { Download, Printer, Package, DollarSign } from 'lucide-react';

interface BOQViewProps {
  project: BuildingProject;
  onUpdateProject: (proj: BuildingProject) => void;
  isLight?: boolean;
}

export const BOQView: React.FC<BOQViewProps> = ({ project, onUpdateProject, isLight = true }) => {
  const report = useMemo(() => calculateBOQ(project), [project]);
  const cur = project.meta.currency;

  const updateRate = (key: keyof BOQRateConfig, val: number) => {
    const next = structuredClone(project);
    next.rates[key] = Math.max(0, val);
    onUpdateProject(next);
  };

  return (
    <div className="flex flex-col h-full w-full bg-[#070b14] overflow-hidden">
      <div className="flex-1 overflow-auto p-5 space-y-5">
        {/* Summary KPI Strip */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-100">
              Live Engineering Bill of Quantities (BOQ) & Material Take-Off
            </h2>
            <p className="text-xs text-slate-400">
              Quantities update automatically in real time whenever walls, rooms, floors, roofs, or openings change.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => exportBOQToCSV(project, report)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium transition"
            >
              <Download className="w-3.5 h-3.5" /> Export BOQ CSV
            </button>
            <button
              onClick={() => window.print()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-medium transition"
            >
              <Printer className="w-3.5 h-3.5" /> Print BOQ
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-3.5">
            <div className="text-[11px] text-slate-400 uppercase">Gross Floor Area</div>
            <div className="text-2xl font-bold font-mono text-cyan-300">{report.grossFloorAreaM2.toFixed(1)} m²</div>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-3.5">
            <div className="text-[11px] text-slate-400 uppercase">Unit Cost / m²</div>
            <div className="text-2xl font-bold font-mono text-amber-300">
              {cur}
              {report.costPerM2.toLocaleString()}
            </div>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-3.5">
            <div className="text-[11px] text-slate-400 uppercase">Subtotal (Excl. Contingency)</div>
            <div className="text-2xl font-bold font-mono text-slate-100">
              {cur}
              {report.subtotal.toLocaleString()}
            </div>
          </div>
          <div className="bg-emerald-950/40 border border-emerald-700/50 rounded-lg p-3.5">
            <div className="text-[11px] text-emerald-300 uppercase">Grand Total (+8% Cont.)</div>
            <div className="text-2xl font-bold font-mono text-emerald-300">
              {cur}
              {report.grandTotal.toLocaleString()}
            </div>
          </div>
        </div>

        {/* Raw Civil Material Take-Off Card */}
        <div className="bg-slate-900/70 border border-slate-800 rounded-lg p-4">
          <div className="flex items-center gap-2 text-xs font-mono font-semibold text-amber-300 mb-3">
            <Package className="w-4 h-4" /> PROCUREMENT RAW MATERIAL SCHEDULE (CIVIL MIX ESTIMATE)
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5 text-center font-mono">
            {[
              { label: 'Cement (50kg Bags)', val: `${report.rawMaterials.cementBags50Kg}` },
              { label: 'River Sand', val: `${report.rawMaterials.riverSandM3} m³` },
              { label: 'Aggregate 20mm', val: `${report.rawMaterials.coarseAggregateM3} m³` },
              { label: 'Bricks / Blocks', val: `${report.rawMaterials.bricksOrBlocksCount.toLocaleString()}` },
              { label: 'Rebar Steel', val: `${report.rawMaterials.rebarSteelKg.toLocaleString()} kg` },
              { label: 'Paint (3 Coats)', val: `${report.rawMaterials.paintLiters} L` },
              { label: 'Floor Tiles (+8%)', val: `${report.rawMaterials.tileAreaM2} m²` },
            ].map((m) => (
              <div key={m.label} className="bg-slate-950/70 border border-slate-800 rounded p-2.5">
                <div className="text-sm font-bold text-slate-100">{m.val}</div>
                <div className="text-[10px] text-slate-400 mt-0.5">{m.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Division Breakdown Visual Bar */}
        <div className="bg-slate-900/70 border border-slate-800 rounded-lg p-4 space-y-2">
          <div className="text-xs font-mono font-semibold text-slate-300">COST DISTRIBUTION BY TRADE DIVISION</div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {report.divisionTotals.map((d) => (
              <div key={d.division} className="bg-slate-950/60 border border-slate-800/80 rounded p-2.5">
                <div className="flex justify-between text-xs mb-1">
                  <span className="font-medium text-slate-200">{d.division}</span>
                  <span className="font-mono text-cyan-300">
                    {cur}
                    {d.amount.toLocaleString()} ({d.sharePct}%)
                  </span>
                </div>
                <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                  <div className="h-full bg-cyan-500 rounded-full" style={{ width: `${Math.min(100, d.sharePct)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Itemized BOQ Table */}
        <div className="bg-slate-900/70 border border-slate-800 rounded-lg overflow-hidden">
          <div className="px-4 py-2.5 bg-slate-900 border-b border-slate-800 flex items-center justify-between">
            <span className="font-mono text-xs font-semibold text-slate-200">ITEMIZED BILL OF QUANTITIES</span>
            <span className="text-[11px] text-slate-400 flex items-center gap-1">
              <DollarSign className="w-3 h-3" /> Edit unit rates below to calibrate local market pricing
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left font-mono">
              <thead className="bg-slate-950/70 text-slate-400">
                <tr>
                  <th className="px-3 py-2">Code</th>
                  <th className="px-3 py-2">Division</th>
                  <th className="px-3 py-2">Work Item Description</th>
                  <th className="px-3 py-2 text-center">Unit</th>
                  <th className="px-3 py-2 text-right">Qty</th>
                  <th className="px-3 py-2 text-right">Rate ({cur})</th>
                  <th className="px-3 py-2 text-right">Amount ({cur})</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80 text-slate-200">
                {report.items.map((it) => (
                  <tr key={it.code} className="hover:bg-slate-800/40">
                    <td className="px-3 py-2 text-cyan-300">{it.code}</td>
                    <td className="px-3 py-2 text-slate-400">{it.division}</td>
                    <td className="px-3 py-2 font-sans text-slate-100">{it.description}</td>
                    <td className="px-3 py-2 text-center">{it.unit}</td>
                    <td className="px-3 py-2 text-right">{it.quantity.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right">{it.unitRate.toFixed(2)}</td>
                    <td className="px-3 py-2 text-right font-semibold text-emerald-300">
                      {it.totalCost.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Quick Rate Calibrator */}
        <div className="bg-slate-900/70 border border-slate-800 rounded-lg p-4">
          <div className="text-xs font-mono font-semibold text-slate-300 mb-3">
            QUICK UNIT RATE CALIBRATION ({cur})
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3 text-xs">
            {(
              [
                ['superConcretePerM3', 'RC Concrete / m³'],
                ['rebarPerKg', 'Steel Rebar / kg'],
                ['brickWallPerM3', 'Brickwork / m³'],
                ['tileFloorPerM2', 'Tiling / m²'],
                ['roofCladdingPerM2', 'Roofing / m²'],
                ['electricalPoint', 'Elec Point / nr'],
              ] as [keyof BOQRateConfig, string][]
            ).map(([key, label]) => (
              <label key={key} className="block">
                <span className="text-[11px] text-slate-400 block mb-1">{label}</span>
                <input
                  type="number"
                  step="0.5"
                  value={project.rates[key]}
                  onChange={(e) => updateRate(key, parseFloat(e.target.value) || 0)}
                  className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 font-mono text-slate-100"
                />
              </label>
            ))}
          </div>
        </div>
      </div>

      <TitleBlock
        meta={project.meta}
        sheetNo="Q-101"
        sheetTitle="Bill of Quantities (BOQ) & Construction Cost Estimate"
        discipline="Quantity Surveying"
        compact
        isLight={isLight}
      />
    </div>
  );
};
