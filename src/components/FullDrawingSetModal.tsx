import React from 'react';
import { BuildingProject, ActiveSheetId } from '../model/types';
import { calculateBOQ } from '../engine/boqCalculator';
import { computeElectricalSLD, computePlumbingRiser } from '../engine/mepEngine';
import { computeEngineeringSchedules } from '../engine/standardsEngine';
import { computeTotalFloorArea } from '../engine/geometry';
import { exportBOQToCSV, exportFullDrawingSetHTML, exportLevelToDXF } from '../export/exporters';
import { Printer, X, FileCheck2, Download, ShieldCheck } from 'lucide-react';

interface FullDrawingSetModalProps {
  project: BuildingProject;
  onClose: () => void;
  onJumpToSheet: (sheet: ActiveSheetId) => void;
}

export const FullDrawingSetModal: React.FC<FullDrawingSetModalProps> = ({
  project,
  onClose,
  onJumpToSheet,
}) => {
  const boq = calculateBOQ(project);
  const sld = computeElectricalSLD(project);
  const plumb = computePlumbingRiser(project);
  const schedules = computeEngineeringSchedules(project);
  const totalArea = computeTotalFloorArea(project);

  const sheets: { id: ActiveSheetId; code: string; name: string; discipline: string; status: string }[] = [
    { id: 'A-101', code: 'A-101', name: 'Architectural Floor Plans & Room Schedule', discipline: 'Architectural', status: 'Issued for Construction' },
    { id: 'A-201', code: 'A-201', name: 'Exterior Elevations (North, South, East, West)', discipline: 'Architectural', status: 'Issued for Construction' },
    { id: 'A-301', code: 'A-301', name: 'Building Cross-Sections & Foundation Details', discipline: 'Architectural / Struct', status: 'Issued for Construction' },
    { id: 'S-101', code: 'S-101', name: 'Foundation, Column Grid & Framing Plan', discipline: 'Structural', status: 'Issued for Construction' },
    { id: 'M-101', code: 'M-101', name: 'MEP Floor Layout (Power, Lighting & Piping)', discipline: 'MEP Coordinated', status: 'Issued for Construction' },
    { id: 'E-101', code: 'E-101', name: 'Electrical Single-Line Diagram & Load Schedule', discipline: 'Electrical', status: 'Issued for Construction' },
    { id: 'P-101', code: 'P-101', name: 'Plumbing Water Supply & Sanitary Riser Schematic', discipline: 'Plumbing', status: 'Issued for Construction' },
    { id: 'H-101', code: 'H-101', name: 'HVAC Cooling Load Schedule, Marine Condenser Riser & Refrigerant Schematic', discipline: 'Mechanical / HVAC', status: 'Issued for Construction' },
    { id: 'Q-101', code: 'Q-101', name: 'Bill of Quantities (BOQ) & Raw Material Take-Off', discipline: 'Quantity Surveying', status: 'Tender Ready' },
  ];

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-4xl max-h-[88vh] flex flex-col overflow-hidden shadow-2xl">
        <div className="px-5 py-3.5 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <FileCheck2 className="w-5 h-5 text-cyan-400" />
            <div>
              <h3 className="font-semibold text-slate-100 text-sm">
                Complete Engineering Drawing Package — {project.meta.projectCode}
              </h3>
              <p className="text-xs text-slate-400">
                Cover Sheet A-000 · {project.meta.title} · {project.meta.revision}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={async () => {
                await exportLevelToDXF(project, 0);
                await exportBOQToCSV(project, boq);
                await exportFullDrawingSetHTML(project);
                onClose();
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" /> Export Full Package (HTML + DXF + CSV)
            </button>
            <button
              onClick={async () => {
                await exportFullDrawingSetHTML(project);
                window.print();
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-medium whitespace-nowrap"
            >
              <Printer className="w-3.5 h-3.5" /> Print / Save PDF
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300"
              aria-label="Close Drawing Package"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-5 space-y-5">
          {/* Executive Project Summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
            <div className="bg-slate-950 border border-slate-800 rounded p-3">
              <div className="text-slate-400">GROSS AREA</div>
              <div className="text-base font-bold text-cyan-300">{totalArea.toFixed(1)} m² ({project.levels.length} Level{project.levels.length > 1 ? 's' : ''})</div>
            </div>
            <div className="bg-slate-950 border border-slate-800 rounded p-3">
              <div className="text-slate-400">ROOF SYSTEM</div>
              <div className="text-base font-bold text-slate-100 uppercase">{project.roof.type} ({project.roof.pitchDeg}°)</div>
            </div>
            <div className="bg-slate-950 border border-slate-800 rounded p-3">
              <div className="text-slate-400">ELECTRICAL DEMAND</div>
              <div className="text-base font-bold text-amber-300">{sld.diversifiedLoadKW} kW / {sld.designCurrentAmps} A</div>
            </div>
            <div className="bg-slate-950 border border-slate-800 rounded p-3">
              <div className="text-slate-400">EST. CONSTRUCTION COST</div>
              <div className="text-base font-bold text-emerald-300">
                {project.meta.currency}
                {boq.grandTotal.toLocaleString()}
              </div>
            </div>
          </div>

          {/* Sheet Index Table */}
          <div className="border border-slate-800 rounded-lg overflow-hidden">
            <div className="px-4 py-2 bg-slate-950 border-b border-slate-800 text-xs font-mono font-semibold text-slate-300">
              A-000 DRAWING SET INDEX & TRANSMITTAL SCHEDULE
            </div>
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-950/60 text-slate-400 font-mono">
                <tr>
                  <th className="px-4 py-2">Sheet ID</th>
                  <th className="px-4 py-2">Drawing Title</th>
                  <th className="px-4 py-2">Discipline</th>
                  <th className="px-4 py-2">Issue Status</th>
                  <th className="px-4 py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {sheets.map((s) => (
                  <tr key={s.code} className="hover:bg-slate-800/40">
                    <td className="px-4 py-2.5 font-mono font-bold text-cyan-300">{s.code}</td>
                    <td className="px-4 py-2.5 text-slate-100">{s.name}</td>
                    <td className="px-4 py-2.5 text-slate-400">{s.discipline}</td>
                    <td className="px-4 py-2.5">
                      <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-[11px]">
                        {s.status}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        onClick={() => {
                          onJumpToSheet(s.id);
                          onClose();
                        }}
                        className="px-2.5 py-1 rounded bg-slate-800 hover:bg-cyan-600 text-slate-200 hover:text-white text-[11px] font-medium transition"
                      >
                        Open Sheet
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* International Building & Engineering Code Compliance Matrix */}
          <div className="border border-slate-800 rounded-lg overflow-hidden">
            <div className="px-4 py-2 bg-slate-950 border-b border-slate-800 text-xs font-mono font-semibold text-emerald-300 flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4" /> INTERNATIONAL STANDARDS & CODE COMPLIANCE MATRIX
            </div>
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-950/60 text-slate-400 font-mono">
                <tr>
                  <th className="px-3 py-2">Standard / Code</th>
                  <th className="px-3 py-2">Discipline</th>
                  <th className="px-3 py-2">Requirement</th>
                  <th className="px-3 py-2">Calculated Design Value</th>
                  <th className="px-3 py-2 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {schedules.complianceChecks.map((ck) => (
                  <tr key={ck.code}>
                    <td className="px-3 py-2 font-mono font-semibold text-cyan-300">{ck.code}</td>
                    <td className="px-3 py-2 text-slate-300">{ck.discipline}</td>
                    <td className="px-3 py-2 text-slate-400">{ck.requirement}</td>
                    <td className="px-3 py-2 font-mono text-slate-200">{ck.actual}</td>
                    <td className="px-3 py-2 text-right">
                      <span
                        className={`px-2 py-0.5 rounded font-mono text-[10px] font-bold ${
                          ck.status === 'PASS'
                            ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                            : 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                        }`}
                      >
                        {ck.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* General Engineering Notes */}
          <div className="bg-slate-950/80 border border-slate-800 rounded-lg p-4 text-xs text-slate-300 space-y-1.5 font-mono">
            <div className="text-cyan-400 font-semibold">GENERAL STRUCTURAL & MEP SPECIFICATIONS:</div>
            <p>1. Structural concrete C25/30 (min 25 MPa) with B500B high-yield deformed steel per Eurocode 2 / ACI 318.</p>
            <p>2. Soil bearing pressure &le; 150 kN/m² at -0.90m below NGL on 100mm PCC 1:4:8 blinding.</p>
            <p>3. Electrical installation per IEC 60364 / BS 7671; max ΔV {sld.maxVoltageDropPct}%, {sld.spdSpec}, 30mA RCD protection.</p>
            <p>4. Plumbing per IPC / BS EN 806 & EN 12056-3: {plumb.supplyMainPipe}, {plumb.soilStackPipe}, {plumb.rainwaterDownpipesCount}×RWP ({plumb.stormwaterRunoffLps} L/s).</p>
          </div>
        </div>
      </div>
    </div>
  );
};
