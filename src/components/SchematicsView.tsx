import React from 'react';
import {
  BuildingProject,
  ClimateZone,
  CondenserProtection,
  getHVACConfig,
  getRoofDrainageConfig,
  getSolarConfig,
  GUTTER_PROFILE_META,
  GutterProfile,
  HVACConfig,
  HVACSystemType,
  MALDIVES_HVAC_CONFIG,
  SolarPVConfig,
  WATER_COLLECTION_META,
  WaterCollectionMode,
} from '../model/types';
import {
  autoPopulateMEPForLevel,
  computeElectricalSLD,
  computeHVACReport,
  computePlumbingRiser,
} from '../engine/mepEngine';
import { TitleBlock } from './TitleBlock';
import { Sun, Wind } from 'lucide-react';

interface SchematicsViewProps {
  project: BuildingProject;
  mode: 'E-101' | 'P-101' | 'H-101';
  onUpdateProject?: (proj: BuildingProject) => void;
  isLight?: boolean;
}

export const SchematicsView: React.FC<SchematicsViewProps> = ({
  project,
  mode,
  onUpdateProject,
  isLight = true,
}) => {
  const svgPaper = isLight ? '#ffffff' : '#050912';
  const mainInk = isLight ? '#0f172a' : '#e2e8f0';
  const subInk = isLight ? '#475569' : '#94a3b8';

  if (mode === 'E-101') {
    const sld = computeElectricalSLD(project);
    const solar = getSolarConfig(project);

    const updateSolar = (patch: Partial<SolarPVConfig>) => {
      if (!onUpdateProject) return;
      const next = structuredClone(project);
      const merged = { ...getSolarConfig(project), ...patch };
      next.solar = merged;
      if (patch.enabled !== undefined) {
        next.levels = next.levels.map((l) => autoPopulateMEPForLevel(l, merged.enabled));
      }
      onUpdateProject(next);
    };

    return (
      <div className="flex flex-col h-full w-full bg-[#070b14] overflow-hidden">
        <div className="flex-1 overflow-auto p-5 space-y-5">
          {/* Solar PV & BESS Engineering Config Bar */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-lg px-4 py-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={() => updateSolar({ enabled: !solar.enabled })}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition ${
                  solar.enabled
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                    : 'bg-slate-800 text-slate-400 border border-slate-700'
                }`}
              >
                <Sun className="w-3.5 h-3.5" /> Solar PV: {solar.enabled ? 'ON' : 'OFF'}
              </button>
              {solar.enabled && (
                <>
                  <label className="flex items-center gap-1.5 text-xs text-slate-300">
                    <span className="font-mono text-slate-400">Panels:</span>
                    <select
                      aria-label="Solar Panel Count"
                      value={solar.panelCount}
                      onChange={(e) => updateSolar({ panelCount: parseInt(e.target.value, 10) })}
                      className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs font-mono"
                    >
                      {[8, 12, 16, 20, 24].map((cnt) => (
                        <option key={cnt} value={cnt}>
                          {cnt}×{solar.panelWattage}Wp ({((cnt * solar.panelWattage) / 1000).toFixed(1)} kWp)
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-slate-300">
                    <span className="font-mono text-slate-400">Inverter:</span>
                    <select
                      aria-label="Hybrid Inverter Rating"
                      value={solar.inverterKW}
                      onChange={(e) => updateSolar({ inverterKW: parseFloat(e.target.value) })}
                      className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs font-mono"
                    >
                      {[5, 6, 8, 10].map((kw) => (
                        <option key={kw} value={kw}>
                          {kw} kW Hybrid
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-slate-300">
                    <span className="font-mono text-slate-400">LiFePO4 BESS:</span>
                    <select
                      aria-label="Battery Storage Capacity"
                      value={solar.batteryKWh}
                      onChange={(e) => updateSolar({ batteryKWh: parseFloat(e.target.value) })}
                      className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs font-mono"
                    >
                      {[0, 5, 10, 15, 20].map((kwh) => (
                        <option key={kwh} value={kwh}>
                          {kwh === 0 ? 'None (Grid-Tie)' : `${kwh} kWh`}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              )}
            </div>
            {solar.enabled && (
              <div className="flex flex-wrap items-center gap-3 text-[11px] font-mono text-slate-300">
                <span>
                  Strings: <strong className="text-cyan-300">{sld.solarPV.stringsCount}×{sld.solarPV.panelsPerString}</strong> ({sld.solarPV.stringVocV}V Voc)
                </span>
                <span>
                  Yield: <strong className="text-emerald-300">{sld.solarPV.estimatedDailyKWh} kWh/day</strong>
                </span>
                <span>
                  Net Peak: <strong className="text-amber-300">{sld.solarPV.netGridDemandKW} kW</strong>
                </span>
              </div>
            )}
          </div>

          {/* Header Metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-3">
              <div className="text-[11px] text-slate-400 uppercase">Connected / Diversified</div>
              <div className="text-lg font-bold font-mono text-amber-300">
                {(sld.totalConnectedWatts / 1000).toFixed(1)} → {sld.diversifiedLoadKW} kW
              </div>
              <div className="text-[10px] font-mono text-slate-400">{sld.supplySystem}</div>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-3">
              <div className="text-[11px] text-slate-400 uppercase">Design Current (Ib · cosφ {sld.powerFactor})</div>
              <div className="text-xl font-bold font-mono text-emerald-300">{sld.designCurrentAmps} A</div>
              <div className="text-[10px] font-mono text-slate-400">
                L1:{sld.phaseBalance.L1_kW}kW · L2:{sld.phaseBalance.L2_kW}kW · L3:{sld.phaseBalance.L3_kW}kW
              </div>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-3">
              <div className="text-[11px] text-slate-400 uppercase">Worst-Case ΔV (IEC 60364)</div>
              <div className="text-xl font-bold font-mono text-cyan-300">
                {sld.maxVoltageDropPct}%{' '}
                <span className="text-xs text-emerald-300 font-semibold">
                  ({sld.maxVoltageDropPct <= 3.0 ? 'PASS ≤3%' : sld.maxVoltageDropPct <= 5.0 ? 'PASS ≤5%' : 'CHECK'})
                </span>
              </div>
              <div className="text-[10px] font-mono text-slate-400">{sld.spdSpec}</div>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-3">
              <div className="text-[11px] text-slate-400 uppercase">Incoming Main Isolator</div>
              <div className="text-xs font-semibold font-mono text-slate-100 mt-1">{sld.mainBreakerSpec}</div>
              <div className="text-[10px] font-mono text-slate-400 mt-0.5">{sld.earthingSpec}</div>
            </div>
          </div>

          {/* Vector Single Line Diagram (SLD) */}
          <div className="bg-slate-900/70 border border-slate-800 rounded-lg p-4">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <span className="text-xs font-mono font-semibold text-amber-300">
                IEC 60617 / BS 7671{sld.solarPV.enabled ? ' / IEC 62446 SOLAR PV HYBRID' : ''} SINGLE-LINE DIAGRAM (MDB-01)
              </span>
              <span className="text-[11px] font-mono text-slate-400">
                Fault Level: 10kA Prospective · RCD: 30mA Instantaneous
              </span>
            </div>
            <svg
              viewBox="0 0 960 410"
              style={{ backgroundColor: svgPaper }}
              className="w-full h-96 rounded border border-slate-800"
            >
              {/* Utility Service Cutout Fuse + Meter */}
              <rect
                x={145}
                y={16}
                width={108}
                height={28}
                rx={4}
                fill={isLight ? '#f1f5f9' : '#1e293b'}
                stroke="#64748b"
                strokeWidth={1.3}
              />
              <text x={199} y={34} textAnchor="middle" fill={mainInk} fontSize={9.5} fontFamily="monospace" fontWeight="bold">
                100A CUTOUT FUSE
              </text>
              <line x1={253} y1={30} x2={292} y2={30} stroke="#d97706" strokeWidth={2} />

              <rect
                x={292}
                y={14}
                width={158}
                height={32}
                rx={4}
                fill={isLight ? '#fef3c7' : '#1e293b'}
                stroke="#d97706"
                strokeWidth={1.5}
              />
              <text x={371} y={34} textAnchor="middle" fill={isLight ? '#92400e' : '#fde047'} fontSize={9.5} fontFamily="monospace" fontWeight="bold">
                {sld.solarPV.enabled ? 'BI-DIR NET METER kWh' : 'kWh UTILITY METER'}
              </text>
              <line x1={371} y1={46} x2={371} y2={76} stroke="#d97706" strokeWidth={2} />
              <text x={380} y={62} fill={subInk} fontSize={8} fontFamily="monospace">
                {sld.supplyCableSpec} ({sld.equipmentRouting.meterToMdbM}m)
              </text>
              <text x={371} y={11} textAnchor="middle" fill={subInk} fontSize={7} fontFamily="monospace">
                MTR @ ({sld.equipmentRouting.meterPos.x.toFixed(1)}, {sld.equipmentRouting.meterPos.y.toFixed(1)}) · MDB @ ({sld.equipmentRouting.mdbPos.x.toFixed(1)}, {sld.equipmentRouting.mdbPos.y.toFixed(1)})
              </text>

              {/* Main Breaker + RCCB */}
              <rect
                x={345}
                y={76}
                width={54}
                height={28}
                rx={2}
                fill={isLight ? '#fde68a' : '#422006'}
                stroke="#d97706"
                strokeWidth={1.5}
              />
              <text x={372} y={94} textAnchor="middle" fill={isLight ? '#78350f' : '#fcd34d'} fontSize={8.5} fontFamily="monospace" fontWeight="bold">
                MCCB/RCD
              </text>
              <text x={407} y={93} fill={isLight ? '#b45309' : '#fbbf24'} fontSize={8.5} fontFamily="monospace" fontWeight="bold">
                {sld.mainBreakerSpec}
              </text>

              <line x1={371} y1={104} x2={371} y2={174} stroke="#d97706" strokeWidth={2} />

              {/* Surge Protection Device (Type-2 SPD) */}
              <line x1={371} y1={126} x2={165} y2={126} stroke="#e11d48" strokeWidth={1.3} strokeDasharray="4 2" />
              <rect x={68} y={114} width={97} height={24} rx={3} fill={isLight ? '#ffe4e6' : '#4c0519'} stroke="#e11d48" strokeWidth={1.2} />
              <text x={116} y={129} textAnchor="middle" fill="#be123c" fontSize={8.5} fontFamily="monospace" fontWeight="bold">
                {sld.spdSpec.slice(0, 16)}
              </text>

              {/* Earth Connection (MET) */}
              <line x1={371} y1={140} x2={475} y2={140} stroke="#16a34a" strokeWidth={1.3} strokeDasharray="4 3" />
              <line x1={475} y1={140} x2={475} y2={152} stroke="#16a34a" strokeWidth={1.3} />
              <line x1={463} y1={152} x2={487} y2={152} stroke="#16a34a" strokeWidth={2} />
              <line x1={468} y1={157} x2={482} y2={157} stroke="#16a34a" strokeWidth={1.5} />
              <text x={492} y={143} fill={isLight ? '#15803d' : '#4ade80'} fontSize={8} fontFamily="monospace">
                MET &lt;2.0Ω
              </text>

              {/* IEC 62446 Solar PV & BESS Branch */}
              {sld.solarPV.enabled && (
                <g>
                  <rect x={635} y={14} width={175} height={32} rx={4} fill={isLight ? '#dcfce7' : '#064e3b'} stroke="#16a34a" strokeWidth={1.6} />
                  <text x={722} y={29} textAnchor="middle" fill={isLight ? '#14532d' : '#a7f3d0'} fontSize={9} fontFamily="monospace" fontWeight="bold">
                    PV ARRAY {sld.solarPV.arrayKwp} kWp ({sld.solarPV.panelCount}×{sld.solarPV.panelWattage}Wp)
                  </text>
                  <text x={722} y={41} textAnchor="middle" fill={isLight ? '#166534' : '#6ee7b7'} fontSize={7.5} fontFamily="monospace">
                    {sld.solarPV.stringsCount}×MPPT · {sld.solarPV.stringVocV}V Voc
                  </text>
                  <line x1={722} y1={46} x2={722} y2={62} stroke="#16a34a" strokeWidth={2} />

                  <rect x={645} y={62} width={155} height={24} rx={3} fill={isLight ? '#fef3c7' : '#451a03'} stroke="#d97706" strokeWidth={1.3} />
                  <text x={722} y={77} textAnchor="middle" fill={isLight ? '#92400e' : '#fcd34d'} fontSize={8} fontFamily="monospace" fontWeight="bold">
                    {sld.solarPV.dcIsolatorSpec.slice(0, 26)}
                  </text>
                  <line x1={722} y1={86} x2={722} y2={102} stroke="#16a34a" strokeWidth={2} />

                  <rect x={640} y={102} width={165} height={30} rx={4} fill={isLight ? '#e0f2fe' : '#0c4a6e'} stroke="#0284c7" strokeWidth={1.6} />
                  <text x={722} y={116} textAnchor="middle" fill={isLight ? '#0c4a6e' : '#bae6fd'} fontSize={9} fontFamily="monospace" fontWeight="bold">
                    HYBRID INVERTER {sld.solarPV.inverterKW} kW
                  </text>
                  <text x={722} y={127} textAnchor="middle" fill={isLight ? '#0369a1' : '#7dd3fc'} fontSize={7.5} fontFamily="monospace">
                    INV @ ({sld.equipmentRouting.inverterPos.x.toFixed(1)}, {sld.equipmentRouting.inverterPos.y.toFixed(1)}) · PV→{sld.equipmentRouting.pvToInverterM}m
                  </text>

                  {sld.solarPV.batteryKWh > 0 && (
                    <g>
                      <line x1={805} y1={117} x2={832} y2={117} stroke="#7c3aed" strokeWidth={2} strokeDasharray="3 2" />
                      <rect x={832} y={100} width={114} height={34} rx={4} fill={isLight ? '#f3e8ff' : '#3b0764'} stroke="#7c3aed" strokeWidth={1.5} />
                      <text x={889} y={115} textAnchor="middle" fill={isLight ? '#581c87' : '#e9d5ff'} fontSize={8.5} fontFamily="monospace" fontWeight="bold">
                        LiFePO4 BESS
                      </text>
                      <text x={889} y={127} textAnchor="middle" fill={isLight ? '#6b21a8' : '#d8b4fe'} fontSize={7.5} fontFamily="monospace">
                        {sld.solarPV.batteryKWh}kWh + 125A DC
                      </text>
                    </g>
                  )}

                  <line x1={722} y1={132} x2={722} y2={174} stroke="#0284c7" strokeWidth={2} />
                  <rect x={668} y={142} width={108} height={18} rx={2} fill={isLight ? '#dcfce7' : '#064e3b'} stroke="#16a34a" strokeWidth={1.1} />
                  <text x={722} y={154} textAnchor="middle" fill={isLight ? '#15803d' : '#6ee7b7'} fontSize={7.2} fontFamily="monospace" fontWeight="bold">
                    {sld.solarPV.acBreakerSpec.split(' ')[0]} RCBO ({sld.equipmentRouting.inverterToMdbM}m)
                  </text>
                </g>
              )}

              {/* Main Copper Busbar */}
              <line x1={60} y1={174} x2={890} y2={174} stroke="#d97706" strokeWidth={5} />
              <text x={66} y={166} fill={isLight ? '#92400e' : '#fde047'} fontSize={9.5} fontFamily="monospace" fontWeight="bold">
                MAIN COPPER BUSBAR 100A · CU 25×3mm
              </text>

              {/* Outgoing Feeder Circuits (Room Sub-DBs & Legacy Branch Circuits) */}
              {sld.circuits.map((ckt, idx) => {
                const count = sld.circuits.length;
                const compact = count > 6;
                const span = compact ? 820 : 750;
                const x0 = compact ? 70 : 100;
                const spacing = span / Math.max(1, count - 1);
                const x = count === 1 ? 475 : x0 + idx * spacing;
                const isPvCkt = ckt.circuitId === 'CKT-PV';
                const cktCol = isPvCkt ? '#16a34a' : '#0284c7';
                const staggerY = compact && idx % 2 === 1 ? 14 : 0;
                const bw = compact ? 32 : 38;
                return (
                  <g key={ckt.circuitId}>
                    <line x1={x} y1={174} x2={x} y2={212} stroke={cktCol} strokeWidth={1.6} />
                    {/* Breaker Symbol + Fault Rating */}
                    <rect
                      x={x - bw / 2}
                      y={212}
                      width={bw}
                      height={24}
                      rx={3}
                      fill={isLight ? (isPvCkt ? '#dcfce7' : '#e0f2fe') : '#0c4a6e'}
                      stroke={cktCol}
                      strokeWidth={1.3}
                    />
                    <text x={x} y={227} textAnchor="middle" fill={isLight ? (isPvCkt ? '#15803d' : '#0369a1') : '#bae6fd'} fontSize={compact ? 7.5 : 8.5} fontFamily="monospace" fontWeight="bold">
                      {ckt.breakerRating.split(' ')[0]}
                    </text>
                    {!compact && (
                      <text x={x + 23} y={228} fill={subInk} fontSize={7.5} fontFamily="monospace">
                        {ckt.breakingCapacityKA}kA
                      </text>
                    )}
                    <line x1={x} y1={236} x2={x} y2={288 + staggerY} stroke={cktCol} strokeWidth={1.6} />
                    <polygon points={`${x - 4.5},${288 + staggerY} ${x + 4.5},${288 + staggerY} ${x},${297 + staggerY}`} fill={cktCol} />
                    <text x={x} y={313 + staggerY} textAnchor="middle" fill={mainInk} fontSize={compact ? 7.8 : 9.5} fontFamily="monospace" fontWeight="bold">
                      {compact ? ckt.circuitId : `${ckt.circuitId} (${isPvCkt ? 'PV' : ckt.phase})`}
                    </text>
                    <text x={x} y={326 + staggerY} textAnchor="middle" fill={subInk} fontSize={compact ? 7.0 : 8.5} fontFamily="monospace">
                      {compact ? `${ckt.loadWatts}W·${ckt.designAmps}A` : `${ckt.loadWatts}W · ${ckt.designAmps}A · ΔV ${ckt.voltageDropPct}%`}
                    </text>
                    <text x={x} y={339 + staggerY} textAnchor="middle" fill={subInk} fontSize={compact ? 6.8 : 8} fontFamily="monospace">
                      {compact ? `${ckt.phase} · ${ckt.cableLengthM}m · ${ckt.voltageDropPct}%` : `${ckt.cableSpec.split(' ')[0]} · ${ckt.cableLengthM}m`}
                    </text>
                    <text x={x} y={352 + staggerY} textAnchor="middle" fill={isLight ? '#15803d' : '#4ade80'} fontSize={compact ? 6.8 : 7.5} fontFamily="monospace">
                      Max Zs {ckt.zsMaxOhms}Ω
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>

          {/* IEC 60364 Circuit Breaker, Cable & Voltage Drop Schedule Table */}
          <div className="bg-slate-900/70 border border-slate-800 rounded-lg overflow-hidden">
            <div className="px-4 py-2.5 bg-slate-900 border-b border-slate-800 font-mono text-xs font-semibold text-slate-200">
              IEC 60364 / BS 7671 DISTRIBUTION BOARD CIRCUIT & VOLTAGE DROP SCHEDULE
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left font-mono">
                <thead className="bg-slate-950/60 text-slate-400">
                  <tr>
                    <th className="px-3 py-2">Circuit</th>
                    <th className="px-3 py-2">Description</th>
                    <th className="px-3 py-2">Ph</th>
                    <th className="px-3 py-2 text-right">Load (W)</th>
                    <th className="px-3 py-2 text-right">Ib (A)</th>
                    <th className="px-3 py-2 text-right">Len (m)</th>
                    <th className="px-3 py-2 text-right">ΔV (%)</th>
                    <th className="px-3 py-2">Protection ({sld.circuits[0]?.rcdSensitivitymA ?? 30}mA)</th>
                    <th className="px-3 py-2 text-right">Max Zs</th>
                    <th className="px-3 py-2">Conductor Spec</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80 text-slate-200">
                  {sld.circuits.map((c) => (
                    <tr key={c.circuitId} className="hover:bg-slate-800/40">
                      <td className="px-3 py-2 font-semibold text-cyan-300">{c.circuitId}</td>
                      <td className="px-3 py-2 font-sans">{c.name}</td>
                      <td className="px-3 py-2">{c.phase}</td>
                      <td className="px-3 py-2 text-right">{c.loadWatts}</td>
                      <td className="px-3 py-2 text-right text-amber-300">{c.designAmps}</td>
                      <td className="px-3 py-2 text-right">{c.cableLengthM}</td>
                      <td className="px-3 py-2 text-right text-emerald-300">{c.voltageDropPct}%</td>
                      <td className="px-3 py-2">{c.breakerRating}</td>
                      <td className="px-3 py-2 text-right">{c.zsMaxOhms}Ω</td>
                      <td className="px-3 py-2 text-slate-400">{c.cableSpec}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <TitleBlock
          meta={project.meta}
          sheetNo="E-101"
          sheetTitle="Electrical Single-Line Diagram (IEC 60617) & Load Schedule (IEC 60364)"
          discipline="Electrical Engineering"
          compact
          isLight={isLight}
        />
      </div>
    );
  }

  if (mode === 'H-101') {
    const hvacCfg = getHVACConfig(project);
    const solarCfg = getSolarConfig(project);
    const hvacRep = computeHVACReport(project);
    const hvacBreaker = `${Math.max(20, Math.ceil((hvacRep.totalElectricalKW * 1000) / (230 * 0.85 * 0.8)))}A 2P RCBO (30mA)`;
    const estPipingMeters = hvacRep.rows.length * 9;

    const applyHvacChange = (patch: Partial<HVACConfig>) => {
      if (!onUpdateProject) return;
      const next = structuredClone(project);
      const merged: HVACConfig = { ...getHVACConfig(next), ...patch };
      next.hvac = merged;
      next.levels = next.levels.map((l) =>
        autoPopulateMEPForLevel(l, solarCfg.enabled, merged.enabled, merged.ceilingFansEnabled)
      );
      onUpdateProject(next);
    };

    const handleClimatePresetChange = (zone: ClimateZone) => {
      if (zone === 'maldives_tropical') {
        applyHvacChange({ ...MALDIVES_HVAC_CONFIG, enabled: hvacCfg.enabled });
      } else if (zone === 'arid_desert') {
        applyHvacChange({
          climateZone: 'arid_desert',
          designOutdoorTempC: 42,
          designIndoorTempC: 24,
          designHumidityPct: 30,
          condenserProtection: 'epoxy_gold_fin',
          ceilingFansEnabled: false,
        });
      } else if (zone === 'mediterranean') {
        applyHvacChange({
          climateZone: 'mediterranean',
          designOutdoorTempC: 31,
          designIndoorTempC: 24,
          designHumidityPct: 65,
          condenserProtection: 'epoxy_gold_fin',
          ceilingFansEnabled: true,
        });
      } else {
        applyHvacChange({
          climateZone: 'temperate',
          designOutdoorTempC: 29,
          designIndoorTempC: 24,
          designHumidityPct: 58,
          condenserProtection: 'standard',
          ceilingFansEnabled: false,
        });
      }
    };

    const applyFullMaldivesMaterials = () => {
      if (!onUpdateProject) return;
      const next = structuredClone(project);
      next.hvac = { ...MALDIVES_HVAC_CONFIG };
      next.roof.material = 'marine_metal';
      next.design = {
        exteriorFacade: 'cement_plaster',
        interiorWalls: 'smooth_cement_plaster',
        windowFrame: 'silver_anodized',
        doorMaterial: 'oak',
      };
      next.levels = next.levels.map((l) => {
        const updatedWalls = l.walls.map((w) => ({
          ...w,
          material: 'cinder_block' as const,
          thickness: w.isExterior ? 0.2 : 0.15,
        }));
        return autoPopulateMEPForLevel({ ...l, walls: updatedWalls }, solarCfg.enabled, true, true);
      });
      onUpdateProject(next);
    };

    const svgBg = isLight ? '#ffffff' : '#0b1220';
    const svgBorder = isLight ? '#cbd5e1' : '#1e293b';
    const mainInk = isLight ? '#0f172a' : '#f1f5f9';
    const subInk = isLight ? '#475569' : '#94a3b8';

    return (
      <div className="flex flex-col h-full w-full bg-[#070b14] overflow-hidden">
        <div className="flex-1 overflow-auto p-5 space-y-5">
          {/* Top HVAC & Climate Engineering Controls */}
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-3 flex flex-wrap items-center gap-3 text-xs">
            <div className={`flex items-center gap-1.5 font-semibold ${isLight ? 'text-cyan-700' : 'text-cyan-400'}`}>
              <Wind size={15} />
              <span>HVAC & CLIMATE ENGINEERING (ASHRAE 55 / ISO 5151 / MNBC):</span>
            </div>
            <button
              onClick={() => applyHvacChange({ enabled: !hvacCfg.enabled })}
              className={`px-2.5 py-1 rounded font-medium border ${
                hvacCfg.enabled
                  ? isLight
                    ? 'bg-emerald-100 border-emerald-400 text-emerald-800'
                    : 'bg-emerald-500/20 border-emerald-500 text-emerald-300'
                  : 'bg-slate-800 border-slate-700 text-slate-400'
              }`}
            >
              HVAC System: {hvacCfg.enabled ? 'ACTIVE' : 'OFF'}
            </button>
            <label className="flex items-center gap-1.5 text-slate-300">
              <span>Climate Preset:</span>
              <select
                value={hvacCfg.climateZone}
                onChange={(e) => handleClimatePresetChange(e.target.value as ClimateZone)}
                className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-slate-100 text-xs"
              >
                <option value="maldives_tropical">Maldives Equatorial (33°C / 82% RH · MNBC)</option>
                <option value="arid_desert">Arid Desert (42°C / 30% RH)</option>
                <option value="mediterranean">Mediterranean Coastal (31°C / 65% RH)</option>
                <option value="temperate">Temperate Standard (29°C / 58% RH)</option>
              </select>
            </label>
            <label className="flex items-center gap-1.5 text-slate-300">
              <span>System:</span>
              <select
                value={hvacCfg.systemType}
                onChange={(e) => applyHvacChange({ systemType: e.target.value as HVACSystemType })}
                className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-slate-100 text-xs"
              >
                <option value="inverter_split">Inverter Split (R32)</option>
                <option value="vrf_multi_split">VRF Multi-Split</option>
                <option value="ducted_central">Concealed Ducted Split</option>
              </select>
            </label>
            <label className="flex items-center gap-1.5 text-slate-300">
              <span>Condenser Fin:</span>
              <select
                value={hvacCfg.condenserProtection}
                onChange={(e) => applyHvacChange({ condenserProtection: e.target.value as CondenserProtection })}
                className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-slate-100 text-xs"
              >
                <option value="marine_blue_fin">Marine Blue-Fin (1000h Salt Spray)</option>
                <option value="epoxy_gold_fin">Epoxy Gold-Fin</option>
                <option value="standard">Standard Aluminum Fin</option>
              </select>
            </label>
            <button
              onClick={() => applyHvacChange({ ceilingFansEnabled: !hvacCfg.ceilingFansEnabled })}
              className={`px-2 py-1 rounded border font-medium ${
                hvacCfg.ceilingFansEnabled
                  ? isLight
                    ? 'bg-teal-100 border-teal-400 text-teal-800'
                    : 'bg-teal-500/20 border-teal-500 text-teal-300'
                  : 'bg-slate-800 border-slate-700 text-slate-400'
              }`}
            >
              BLDC Fans: {hvacCfg.ceilingFansEnabled ? 'ON' : 'OFF'}
            </button>
            <button
              onClick={applyFullMaldivesMaterials}
              className={`ml-auto px-2.5 py-1 rounded font-semibold border ${
                isLight
                  ? 'bg-sky-100 border-sky-400 text-sky-900 hover:bg-sky-200'
                  : 'bg-sky-500/20 border-sky-500 text-sky-300 hover:bg-sky-500/30'
              }`}
              title="Apply Maldives Cinder Block, Sand-Cement Plaster, Marine PVDF Roof & Tropical HVAC preset"
            >
              Apply Maldives Tropical Spec
            </button>
          </div>

          {/* 4 Engineering KPI Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-3">
              <div className="text-[11px] text-slate-400 uppercase">Total Peak Cooling Capacity</div>
              <div className="text-xl font-bold font-mono text-cyan-300">
                {hvacCfg.enabled ? `${hvacRep.totalCoolingTons} TR` : '0.0 TR'}
              </div>
              <div className="text-[10px] font-mono text-slate-400">
                {hvacCfg.enabled ? `${hvacRep.totalCoolingBtu.toLocaleString()} BTU/h · ${hvacRep.totalCoolingKWth} kWth` : 'HVAC Disabled'}
              </div>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-3">
              <div className="text-[11px] text-slate-400 uppercase">Electrical Input &amp; Breaker</div>
              <div className="text-xl font-bold font-mono text-amber-300">
                {hvacCfg.enabled ? `${hvacRep.totalElectricalKW} kW` : '0.0 kW'}
              </div>
              <div className="text-[10px] font-mono text-slate-400">
                SEER COP {hvacRep.seerCop} · {hvacBreaker}
              </div>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-3">
              <div className="text-[11px] text-slate-400 uppercase">Outdoor Condenser Plant</div>
              <div className="text-xl font-bold font-mono text-emerald-300">
                {hvacRep.condenserUnitsCount}× CDU ({hvacCfg.refrigerant})
              </div>
              <div className="text-[10px] font-mono text-slate-400">
                {hvacCfg.condenserProtection.replace(/_/g, ' ')} · {estPipingMeters}m twin line
              </div>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-3">
              <div className="text-[11px] text-slate-400 uppercase">Ambient Design Condition</div>
              <div className="text-sm font-bold font-mono text-slate-100 mt-1">{hvacRep.outdoorSpec}</div>
              <div className="text-[10px] font-mono text-slate-400">{hvacRep.ventilationSpec}</div>
            </div>
          </div>

          {/* Refrigerant, Condensate & Electrical Riser Schematic SVG */}
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-300 mb-3">
              Refrigerant Piping ({hvacCfg.refrigerant} Pre-Insulated Twin Copper), Condensate Drain &amp; Condenser Riser (ISO 5151)
            </h3>
            <svg viewBox="0 0 960 270" className="w-full h-auto rounded border" style={{ background: svgBg, borderColor: svgBorder }}>
              {/* Dedicated MDB Power Feeder */}
              <rect x={24} y={24} width={145} height={58} rx={4} fill={isLight ? '#fef3c7' : '#451a03'} stroke="#d97706" strokeWidth={1.8} />
              <text x={96} y={47} textAnchor="middle" fill={isLight ? '#92400e' : '#fef08a'} fontSize={10} fontFamily="monospace" fontWeight="bold">
                MDB-1 · CKT-AC
              </text>
              <text x={96} y={64} textAnchor="middle" fill={subInk} fontSize={8.5} fontFamily="monospace">
                {hvacBreaker}
              </text>

              {/* Outdoor Marine Condenser Plant */}
              <rect x={24} y={135} width={196} height={96} rx={5} fill={isLight ? '#e0f2fe' : '#082f49'} stroke="#0284c7" strokeWidth={2} />
              <circle cx={56} cy={182} r={20} fill="none" stroke="#0284c7" strokeWidth={2} />
              <line x1={42} y1={168} x2={70} y2={196} stroke="#0284c7" strokeWidth={2} />
              <line x1={70} y1={168} x2={42} y2={196} stroke="#0284c7" strokeWidth={2} />
              <text x={148} y={162} textAnchor="middle" fill={isLight ? '#0c4a6e' : '#e0f2fe'} fontSize={10} fontFamily="monospace" fontWeight="bold">
                {hvacRep.condenserUnitsCount}× OUTDOOR CDU
              </text>
              <text x={148} y={178} textAnchor="middle" fill={isLight ? '#0369a1' : '#7dd3fc'} fontSize={8.5} fontFamily="monospace">
                {hvacCfg.condenserProtection.replace(/_/g, ' ').toUpperCase()}
              </text>
              <text x={148} y={194} textAnchor="middle" fill={subInk} fontSize={8} fontFamily="monospace">
                R32 · 1000h Salt Spray
              </text>
              <text x={148} y={210} textAnchor="middle" fill={subInk} fontSize={8} fontFamily="monospace">
                SS316 Wall Brackets
              </text>
              {/* Feeder line from MDB to CDU */}
              <line x1={96} y1={82} x2={96} y2={135} stroke="#d97706" strokeWidth={2.2} strokeDasharray="5 3" />

              {/* Refrigerant Supply/Suction Header */}
              <line x1={220} y1={165} x2={810} y2={165} stroke="#9333ea" strokeWidth={3} />
              <text x={525} y={182} textAnchor="middle" fill={isLight ? '#6b21a8' : '#d8b4fe'} fontSize={8.5} fontFamily="monospace" fontWeight="bold">
                INSULATED TWIN COPPER HEADER (LIQ Ø6.35–9.52mm + GAS Ø12.7–15.88mm · 19mm ARMAFLEX)
              </text>

              {/* Condensate Drain Header @ 1:50 slope */}
              <line x1={270} y1={225} x2={820} y2={232} stroke="#0d9488" strokeWidth={2.5} strokeDasharray="6 3" />
              <text x={520} y={248} textAnchor="middle" fill={isLight ? '#0f766e' : '#5eead4'} fontSize={9} fontFamily="monospace">
                uPVC Ø25mm CONDENSATE DRAIN @ 1:50 SLOPE (INSULATED + P-TRAP) → SOAKAWAY
              </text>
              <rect x={820} y={214} width={115} height={36} rx={4} fill={isLight ? '#ccfbf1' : '#134e4a'} stroke="#0d9488" strokeWidth={1.5} />
              <text x={877} y={236} textAnchor="middle" fill={isLight ? '#115e59' : '#99f6e4'} fontSize={8.5} fontFamily="monospace" fontWeight="bold">
                GULLY TRAP
              </text>

              {/* Sample Indoor FCU Zone Nodes */}
              {hvacRep.rows.slice(0, 4).map((row, idx) => {
                const x = 250 + idx * 145;
                return (
                  <g key={row.roomId}>
                    <line x1={x + 55} y1={165} x2={x + 55} y2={92} stroke="#9333ea" strokeWidth={2} />
                    <line x1={x + 70} y1={92} x2={x + 70} y2={227} stroke="#0d9488" strokeWidth={1.6} strokeDasharray="3 3" />
                    <rect x={x} y={32} width={132} height={60} rx={4} fill={isLight ? '#f3e8ff' : '#3b0764'} stroke="#9333ea" strokeWidth={1.5} />
                    <text x={x + 66} y={50} textAnchor="middle" fill={mainInk} fontSize={8} fontFamily="monospace" fontWeight="bold">
                      {row.roomName.slice(0, 18)}
                    </text>
                    <text x={x + 66} y={64} textAnchor="middle" fill={isLight ? '#6b21a8' : '#e9d5ff'} fontSize={9} fontFamily="monospace" fontWeight="bold">
                      {row.selectedBtu.toLocaleString()} BTU/h
                    </text>
                    <text x={x + 66} y={78} textAnchor="middle" fill={subInk} fontSize={7.5} fontFamily="monospace">
                      {row.refrigerantPipeSpec}
                    </text>
                  </g>
                );
              })}
              {hvacRep.rows.length > 4 && (
                <text x={860} y={68} textAnchor="middle" fill={subInk} fontSize={9} fontFamily="monospace" fontWeight="bold">
                  +{hvacRep.rows.length - 4} MORE ZONES
                </text>
              )}
            </svg>
          </div>

          {/* Room-by-Room ASHRAE Cooling Load & AC Selection Schedule */}
          <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
            <div className="px-4 py-2.5 bg-slate-800/70 text-xs font-semibold uppercase tracking-wider text-slate-200 flex items-center justify-between">
              <span>ASHRAE / ISO 5151 Room-by-Room Cooling Load &amp; AC Equipment Schedule</span>
              <span className="font-mono text-[11px] text-slate-400">
                {hvacRep.rows.length} Conditioned Zones · {hvacRep.climateLabel}
              </span>
            </div>
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-950/60 text-slate-400 uppercase text-[10px]">
                <tr>
                  <th className="px-3 py-2">Room / Zone</th>
                  <th className="px-3 py-2 text-right">Area (m²)</th>
                  <th className="px-3 py-2 text-right">Sensible (BTU)</th>
                  <th className="px-3 py-2 text-right">Latent (BTU)</th>
                  <th className="px-3 py-2 text-right">Design Load</th>
                  <th className="px-3 py-2">Selected Unit ({hvacCfg.refrigerant})</th>
                  <th className="px-3 py-2 text-right">COP</th>
                  <th className="px-3 py-2">Copper Pipe (Liq/Gas)</th>
                  <th className="px-3 py-2">Fan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {hvacRep.rows.map((r) => (
                  <tr key={r.roomId} className="hover:bg-slate-800/40">
                    <td className="px-3 py-2 font-medium text-slate-200">
                      {r.roomName} <span className="text-[10px] text-slate-400 uppercase">({r.category})</span>
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-slate-300">{r.areaM2}</td>
                    <td className="px-3 py-2 text-right font-mono text-slate-300">
                      {Math.round(r.sensibleWatts * 3.412).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-slate-300">
                      {Math.round(r.latentWatts * 3.412).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-cyan-300 font-semibold">
                      {Math.round(r.totalCoolingWatts * 3.412).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 font-mono text-emerald-300 font-semibold">{r.unitTag}</td>
                    <td className="px-3 py-2 text-right font-mono text-slate-300">{hvacRep.seerCop}</td>
                    <td className="px-3 py-2 font-mono text-slate-300">{r.refrigerantPipeSpec}</td>
                    <td className="px-3 py-2 font-mono text-slate-300">{r.hasCeilingFan ? 'BLDC 56"' : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <TitleBlock
          meta={project.meta}
          sheetNo="H-101"
          sheetTitle="HVAC Cooling Load Schedule, Marine Condenser Riser & Refrigerant Schematic"
          discipline="Mechanical / HVAC"
          compact
          isLight={isLight}
        />
      </div>
    );
  }

  // Plumbing, Sanitary & Stormwater Riser Schematic (P-101)
  const plumb = computePlumbingRiser(project);
  const drainage = getRoofDrainageConfig(project.roof);
  const gutterMeta = GUTTER_PROFILE_META[drainage.gutterProfile];
  const collectMeta = WATER_COLLECTION_META[drainage.waterCollectionMode];

  const updateRoofDrainage = (patch: Partial<typeof project.roof>) => {
    if (!onUpdateProject) return;
    const next = structuredClone(project);
    next.roof = { ...next.roof, ...patch };
    onUpdateProject(next);
  };

  return (
    <div className="flex flex-col h-full w-full bg-[#070b14] overflow-hidden">
      <div className="flex-1 overflow-auto p-5 space-y-5">
        {/* Interactive Roof Gutter & Rainwater Collection / Redirect Bar */}
        {onUpdateProject && (
          <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-900/90 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => updateRoofDrainage({ gutterEnabled: !drainage.gutterEnabled })}
                className={`px-2.5 py-1 rounded font-mono font-semibold ${
                  drainage.gutterEnabled
                    ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                    : 'bg-slate-800 text-slate-400 border border-slate-700'
                }`}
              >
                {drainage.gutterEnabled ? 'GUTTERS ON' : 'GUTTERS OFF'}
              </button>
              <select
                aria-label="P-101 Gutter Profile"
                value={drainage.gutterProfile}
                onChange={(e) => updateRoofDrainage({ gutterProfile: e.target.value as GutterProfile })}
                disabled={!drainage.gutterEnabled}
                className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-200 disabled:opacity-40"
              >
                {(Object.keys(GUTTER_PROFILE_META) as GutterProfile[]).map((gp) => (
                  <option key={gp} value={gp}>
                    {GUTTER_PROFILE_META[gp].label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-mono text-slate-400 uppercase">Redirect To:</span>
              <select
                aria-label="P-101 Rainwater Collection Mode"
                value={drainage.waterCollectionMode}
                onChange={(e) => updateRoofDrainage({ waterCollectionMode: e.target.value as WaterCollectionMode })}
                disabled={!drainage.gutterEnabled}
                className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-sky-300 font-medium disabled:opacity-40"
              >
                {(Object.keys(WATER_COLLECTION_META) as WaterCollectionMode[]).map((wm) => (
                  <option key={wm} value={wm}>
                    {WATER_COLLECTION_META[wm].label}
                  </option>
                ))}
              </select>
              {(drainage.waterCollectionMode === 'harvesting_tank' ||
                drainage.waterCollectionMode === 'underground_cistern') && (
                <select
                  aria-label="P-101 Tank Volume"
                  value={drainage.harvestingTankLiters}
                  onChange={(e) => updateRoofDrainage({ harvestingTankLiters: parseInt(e.target.value, 10) })}
                  className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-200 font-mono"
                >
                  {[1500, 3500, 5000, 10000].map((v) => (
                    <option key={v} value={v}>
                      {v.toLocaleString()} L
                    </option>
                  ))}
                </select>
              )}
              <select
                aria-label="P-101 Downpipes"
                value={drainage.downpipeCount}
                onChange={(e) => updateRoofDrainage({ downpipeCount: parseInt(e.target.value, 10) })}
                disabled={!drainage.gutterEnabled}
                className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-200 font-mono disabled:opacity-40"
              >
                {[2, 4, 6, 8].map((n) => (
                  <option key={n} value={n}>
                    {n}× RWP
                  </option>
                ))}
              </select>
              <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={drainage.firstFlushDiverter}
                  onChange={(e) => updateRoofDrainage({ firstFlushDiverter: e.target.checked })}
                  disabled={!drainage.gutterEnabled}
                  className="accent-sky-500"
                />
                First-Flush
              </label>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-3">
            <div className="text-[11px] text-slate-400 uppercase">Peak Flow (Hunter WSFU {plumb.totalWSFU})</div>
            <div className="text-xl font-bold font-mono text-cyan-300">{plumb.peakFlowLps} L/s</div>
            <div className="text-[10px] font-mono text-slate-400">
              Vel: {plumb.designVelocityMps} m/s ({plumb.designVelocityMps <= 2.4 ? 'OK ≤2.4' : 'HIGH'})
            </div>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-3">
            <div className="text-[11px] text-slate-400 uppercase">Storage (OHT + UG Cistern)</div>
            <div className="text-xl font-bold font-mono text-sky-300">
              {plumb.storageTankLiters}L + {plumb.storageTankLiters}L
            </div>
            <div className="text-[10px] font-mono text-slate-400">
              {plumb.occupancyCount} Occ · {plumb.dailyWaterDemandLiters} L/day
            </div>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-3">
            <div className="text-[11px] text-slate-400 uppercase">Sanitary Load & Pump Head</div>
            <div className="text-xl font-bold font-mono text-emerald-300">{plumb.totalDFU} DFU</div>
            <div className="text-[10px] font-mono text-slate-400">
              Transfer Pump {plumb.pumpKW} kW @ {plumb.pumpHeadMeters}m Head
            </div>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-3">
            <div className="text-[11px] text-slate-400 uppercase">Storm Runoff (EN 12056-3)</div>
            <div className="text-xl font-bold font-mono text-amber-300">{plumb.stormwaterRunoffLps} L/s</div>
            <div className="text-[10px] font-mono text-slate-400">
              {plumb.rainwaterDownpipesCount}× {plumb.rainwaterPipeSpec} @ {plumb.rainfallIntensityMmh}mm/h
            </div>
          </div>
        </div>

        <div className="bg-slate-900/70 border border-slate-800 rounded-lg p-4">
          <div className="text-xs font-mono font-semibold text-sky-300 mb-3">
            IPC / BS EN 806 / EN 12056 VERTICAL WATER SUPPLY, SANITARY & STORMWATER RISER SCHEMATIC
          </div>
          <svg
            viewBox="0 0 940 360"
            style={{ backgroundColor: svgPaper }}
            className="w-full h-80 rounded border border-slate-800"
          >
            {/* Roof Overhead Storage Tank + Gate Valve / NRV */}
            <rect
              x={130}
              y={18}
              width={165}
              height={46}
              rx={4}
              fill={isLight ? '#e0f2fe' : '#0c4a6e'}
              stroke="#0284c7"
              strokeWidth={2}
            />
            <text x={212} y={38} textAnchor="middle" fill={isLight ? '#0c4a6e' : '#e0f2fe'} fontSize={10} fontFamily="monospace" fontWeight="bold">
              ROOF OHT ({plumb.storageTankLiters}L)
            </text>
            <text x={212} y={53} textAnchor="middle" fill={isLight ? '#0369a1' : '#7dd3fc'} fontSize={8.5} fontFamily="monospace">
              Float Valve + 300mm Overflow
            </text>

            {/* Vent Stack Roof Termination */}
            <line x1={710} y1={25} x2={710} y2={285} stroke="#9333ea" strokeWidth={2.5} strokeDasharray="5 3" />
            <text x={710} y={17} textAnchor="middle" fill={isLight ? '#7e22ce' : '#d8b4fe'} fontSize={8.5} fontFamily="monospace">
              VENT COWL (+1.0m)
            </text>

            {/* Rainwater Downpipe to Selected Collection / Redirect Destination (EN 12056-3) */}
            {plumb.gutterEnabled ? (
              <g>
                <line x1={845} y1={26} x2={845} y2={285} stroke="#0284c7" strokeWidth={2.5} strokeDasharray="7 3" />
                <text x={845} y={17} textAnchor="middle" fill={isLight ? '#0369a1' : '#38bdf8'} fontSize={8.5} fontFamily="monospace" fontWeight="bold">
                  {plumb.rainwaterDownpipesCount}×RWP Ø100 ({gutterMeta.shortLabel})
                </text>
                {plumb.firstFlushDiverter && (
                  <text x={838} y={196} textAnchor="end" fill={isLight ? '#0369a1' : '#7dd3fc'} fontSize={7.5} fontFamily="monospace">
                    FIRST-FLUSH →
                  </text>
                )}
                <rect x={775} y={295} width={150} height={42} rx={4} fill={isLight ? '#e0f2fe' : '#082f49'} stroke={collectMeta.badgeColor} strokeWidth={1.5} />
                <text x={850} y={313} textAnchor="middle" fill={isLight ? '#0369a1' : '#bae6fd'} fontSize={8.5} fontFamily="monospace" fontWeight="bold">
                  {collectMeta.shortLabel.toUpperCase()}
                </text>
                <text x={850} y={328} textAnchor="middle" fill={isLight ? '#0284c7' : '#7dd3fc'} fontSize={7.5} fontFamily="monospace">
                  {plumb.waterCollectionMode === 'harvesting_tank' || plumb.waterCollectionMode === 'underground_cistern'
                    ? `${plumb.harvestingTankLiters.toLocaleString()}L${plumb.firstFlushDiverter ? ' + UV FILTER' : ''}`
                    : `${plumb.stormwaterRunoffLps} L/s REDIRECT`}
                </text>
              </g>
            ) : (
              <text x={845} y={34} textAnchor="middle" fill={subInk} fontSize={8} fontFamily="monospace">
                EAVE GUTTERS OFF
              </text>
            )}

            {/* Downcomer Cold Supply & Booster Riser Pipe */}
            <line x1={180} y1={64} x2={180} y2={285} stroke="#0284c7" strokeWidth={3} />
            <text x={188} y={96} fill={isLight ? '#0369a1' : '#38bdf8'} fontSize={8.5} fontFamily="monospace">
              {plumb.supplyMainPipe} + PRV
            </text>

            {/* Soil Stack */}
            <line x1={620} y1={90} x2={620} y2={295} stroke="#16a34a" strokeWidth={3.5} />
            <text x={612} y={106} textAnchor="end" fill={isLight ? '#15803d' : '#4ade80'} fontSize={8.5} fontFamily="monospace">
              {plumb.soilStackPipe}
            </text>

            {/* Floor Branches */}
            {project.levels.map((lvl, idx) => {
              const y = 240 - idx * 85;
              return (
                <g key={lvl.id}>
                  <line x1={55} y1={y + 22} x2={780} y2={y + 22} stroke={isLight ? '#cbd5e1' : '#334155'} strokeDasharray="4 4" />
                  <text x={60} y={y + 16} fill={subInk} fontSize={9.5} fontFamily="monospace">
                    {lvl.name} (+{lvl.elevation.toFixed(2)}m)
                  </text>
                  {/* Cold branch + Isolation Valve */}
                  <line x1={180} y1={y} x2={445} y2={y} stroke="#0284c7" strokeWidth={2} />
                  <polygon points={`220,${y - 5} 220,${y + 5} 227,${y}`} fill="#0284c7" />
                  <polygon points={`234,${y - 5} 234,${y + 5} 227,${y}`} fill="#0284c7" />
                  {/* Hot water heater & branch */}
                  <rect x={295} y={y - 24} width={44} height={20} rx={3} fill={isLight ? '#ffedd5' : '#7c2d12'} stroke="#ea580c" />
                  <text x={317} y={y - 11} textAnchor="middle" fill={isLight ? '#9a3412' : '#fed7aa'} fontSize={8.5} fontFamily="monospace">
                    GWH
                  </text>
                  <line x1={339} y1={y - 12} x2={445} y2={y - 12} stroke="#ea580c" strokeWidth={1.6} />

                  {/* Fixture Cluster Box */}
                  <rect
                    x={445}
                    y={y - 24}
                    width={110}
                    height={36}
                    rx={4}
                    fill={isLight ? '#f1f5f9' : '#1e293b'}
                    stroke="#64748b"
                  />
                  <text x={500} y={y - 8} textAnchor="middle" fill={mainInk} fontSize={9} fontFamily="monospace" fontWeight="bold">
                    WC + WHB + SH + KS
                  </text>
                  <text x={500} y={y + 5} textAnchor="middle" fill={subInk} fontSize={8} fontFamily="monospace">
                    FT + P-Trap @ 1:60
                  </text>

                  {/* Drain branch to Soil Stack */}
                  <line x1={555} y1={y + 4} x2={620} y2={y + 10} stroke="#16a34a" strokeWidth={2.2} />
                  <line x1={620} y1={y - 10} x2={710} y2={y - 10} stroke="#9333ea" strokeWidth={1.5} strokeDasharray="3 2" />
                </g>
              );
            })}

            {/* Underground Sump + Grease Trap + Inspection Chambers */}
            <rect
              x={60}
              y={295}
              width={145}
              height={42}
              rx={4}
              fill={isLight ? '#e0f2fe' : '#082f49'}
              stroke="#0284c7"
              strokeWidth={1.5}
            />
            <text x={132} y={314} textAnchor="middle" fill={isLight ? '#0c4a6e' : '#bae6fd'} fontSize={9} fontFamily="monospace" fontWeight="bold">
              UG SUMP ({plumb.storageTankLiters}L)
            </text>
            <text x={132} y={327} textAnchor="middle" fill={isLight ? '#0369a1' : '#38bdf8'} fontSize={8} fontFamily="monospace">
              {plumb.pumpKW}kW + NRV + Strainer
            </text>
            <line x1={150} y1={295} x2={150} y2={64} stroke="#0284c7" strokeWidth={1.8} strokeDasharray="5 2" />

            <rect x={440} y={295} width={86} height={36} rx={4} fill={isLight ? '#fef3c7' : '#451a03'} stroke="#d97706" strokeWidth={1.2} />
            <text x={483} y={316} textAnchor="middle" fill={isLight ? '#92400e' : '#fde047'} fontSize={8.5} fontFamily="monospace" fontWeight="bold">
              GREASE TRAP
            </text>
            <line x1={526} y1={313} x2={560} y2={313} stroke="#16a34a" strokeWidth={2} />

            <rect
              x={560}
              y={295}
              width={185}
              height={36}
              rx={4}
              fill={isLight ? '#dcfce7' : '#14532d'}
              stroke="#16a34a"
              strokeWidth={1.5}
            />
            <text x={652} y={316} textAnchor="middle" fill={isLight ? '#14532d' : '#bbf7d0'} fontSize={9} fontFamily="monospace" fontWeight="bold">
              IC-1 → IC-2 → MH-MAIN (IL -1.05m)
            </text>
          </svg>
        </div>

        {/* Side-by-Side Sanitary DFU Schedule & Manhole / Stormwater Schedule */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-slate-900/70 border border-slate-800 rounded-lg overflow-hidden">
            <div className="px-4 py-2.5 bg-slate-900 border-b border-slate-800 font-mono text-xs font-semibold text-slate-200">
              SANITARY FIXTURE & DRAINAGE UNIT (DFU) SCHEDULE (IPC)
            </div>
            <table className="w-full text-xs text-left font-mono">
              <thead className="bg-slate-950/60 text-slate-400">
                <tr>
                  <th className="px-3 py-2">Fixture Type</th>
                  <th className="px-3 py-2 text-right">Qty</th>
                  <th className="px-3 py-2 text-right">DFU/Unit</th>
                  <th className="px-3 py-2 text-right">Total DFU</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80 text-slate-200">
                {plumb.fixtureSummary.map((f) => (
                  <tr key={f.label}>
                    <td className="px-3 py-2 font-sans">{f.label}</td>
                    <td className="px-3 py-2 text-right">{f.count}</td>
                    <td className="px-3 py-2 text-right">{f.dfuEach}</td>
                    <td className="px-3 py-2 text-right text-cyan-300 font-semibold">{f.totalDfu}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="bg-slate-900/70 border border-slate-800 rounded-lg overflow-hidden">
            <div className="px-4 py-2.5 bg-slate-900 border-b border-slate-800 font-mono text-xs font-semibold text-slate-200">
              INSPECTION CHAMBERS & ROOF STORMWATER SCHEDULE (EN 12056-3)
            </div>
            <table className="w-full text-xs text-left font-mono">
              <thead className="bg-slate-950/60 text-slate-400">
                <tr>
                  <th className="px-3 py-2">ID</th>
                  <th className="px-3 py-2">Size (mm)</th>
                  <th className="px-3 py-2 text-right">Invert Lvl</th>
                  <th className="px-3 py-2">Location / Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80 text-slate-200">
                {plumb.inspectionChambers.map((ic) => (
                  <tr key={ic.id}>
                    <td className="px-3 py-2 font-bold text-emerald-300">{ic.id}</td>
                    <td className="px-3 py-2">{ic.sizeMm}</td>
                    <td className="px-3 py-2 text-right">{ic.invertLevelM.toFixed(2)}m</td>
                    <td className="px-3 py-2 font-sans text-slate-300">{ic.location}</td>
                  </tr>
                ))}
                <tr className="bg-slate-950/40">
                  <td className="px-3 py-2 font-bold text-cyan-300">STORM</td>
                  <td className="px-3 py-2">{plumb.rainwaterDownpipesCount}× Ø100</td>
                  <td className="px-3 py-2 text-right">{plumb.roofCatchmentM2} m²</td>
                  <td className="px-3 py-2 font-sans text-slate-300">
                    Q={plumb.stormwaterRunoffLps} L/s @ {plumb.rainfallIntensityMmh}mm/h
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <TitleBlock
        meta={project.meta}
        sheetNo="P-101"
        sheetTitle="Plumbing Water Supply, Sanitary & Stormwater Riser Schematic (IPC / EN 12056)"
        discipline="Plumbing & Public Health Engineering"
        compact
        isLight={isLight}
      />
    </div>
  );
};