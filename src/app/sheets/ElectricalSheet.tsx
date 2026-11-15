import { useMemo, useState } from 'react';
import type { BuildingProject } from '../../model/types';
import { computeElectricalSLD, type ElectricalCircuitScheduleRow, type ElectricalSLDReport } from '../../engine/mepEngine';
import { ACCENT, INK, INK_2, INK_3, LINE, MEP_COLOR } from '../drawing/style';
import { BarList, Card, DataTable, fmt, Kpis, SheetPage, Specs } from './kit';
import type { SheetInfo } from '../../export/sheet';
import { PaperPages } from './drawn/PaperPages';
import { electricalPages } from './drawn/electrical';
import { PaperToggle } from './drawn/PaperToggle';

/** On paper (as printed) when the title block is known; the report view keeps the working figures. */
export function ElectricalSheet({ model, paperInfo }: { model: BuildingProject; paperInfo?: SheetInfo | null }) {
  const [paper, setPaper] = useState(true);
  const pages = useMemo(() => (paperInfo && paper ? electricalPages(model) : null), [model, paperInfo, paper]);
  return (
    <div className="relative h-full w-full">
      {pages && paperInfo ? <PaperPages pages={pages} info={paperInfo} /> : <ElectricalSheetReport model={model} />}
      {paperInfo && <PaperToggle paper={paper} setPaper={setPaper} />}
    </div>
  );
}

function ElectricalSheetReport({ model }: { model: BuildingProject }) {
  const r = useMemo(() => computeElectricalSLD(model), [model]);
  const pv = r.solarPV;
  return (
    <SheetPage code="E-101" title="Electrical" lede="Single-line diagram, circuit schedule and supply design, generated from the fixtures in the plan.">
      <Kpis
        items={[
          { label: 'Connected load', value: `${fmt(r.totalConnectedWatts / 1000, 1)} kW` },
          { label: 'After diversity', value: `${fmt(r.diversifiedLoadKW, 1)} kW` },
          { label: 'Design current', value: `${fmt(r.designCurrentAmps, 1)} A` },
          { label: 'Main breaker', value: r.mainBreakerSpec.split(' ')[0] ?? r.mainBreakerSpec, hint: r.mainBreakerSpec },
        ]}
      />

      <Card title="Single-line diagram" flush>
        <div className="overflow-x-auto p-4">
          <SingleLine r={r} />
        </div>
      </Card>

      <Card title="Circuit schedule" flush>
        <DataTable<ElectricalCircuitScheduleRow>
          rows={r.circuits}
          rowKey={(c) => c.circuitId}
          columns={[
            { key: 'id', label: 'Circuit', width: '80px', mono: true, render: (c) => c.circuitId },
            { key: 'name', label: 'Serves', render: (c) => c.name.replace(new RegExp(`^${c.circuitId}\\s*[—-]\\s*`), '') },
            { key: 'ph', label: 'Phase', render: (c) => <span className="text-ink-3">{c.phase}</span> },
            { key: 'pts', label: 'Points', align: 'right', render: (c) => c.pointCount },
            { key: 'w', label: 'Load (W)', align: 'right', render: (c) => fmt(c.loadWatts) },
            { key: 'a', label: 'Ib (A)', align: 'right', render: (c) => fmt(c.designAmps, 1) },
            { key: 'brk', label: 'Breaker', render: (c) => c.breakerRating },
            { key: 'cable', label: 'Cable', render: (c) => <span className="text-ink-2">{c.cableSpec}</span> },
            { key: 'len', label: 'Run (m)', align: 'right', render: (c) => fmt(c.cableLengthM, 1) },
            {
              key: 'vd',
              label: 'Volt drop',
              align: 'right',
              render: (c) => <span className={c.voltageDropPct > 3 ? 'font-medium text-warn' : ''}>{c.voltageDropPct.toFixed(2)}%</span>,
            },
          ]}
        />
      </Card>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card title="Supply and protection">
          <Specs
            rows={[
              ['Supply system', r.supplySystem],
              ['Incoming cable', r.supplyCableSpec],
              ['Main breaker', r.mainBreakerSpec],
              ['Surge protection', r.spdSpec],
              ['Earthing', r.earthingSpec],
              ['Power factor', r.powerFactor.toFixed(2)],
              ['Worst voltage drop', `${r.maxVoltageDropPct.toFixed(2)}% (limit 4%)`],
            ]}
          />
        </Card>
        <Card title="Phase balance">
          <BarList
            items={[
              { label: 'L1', value: r.phaseBalance.L1_kW },
              { label: 'L2', value: r.phaseBalance.L2_kW },
              { label: 'L3', value: r.phaseBalance.L3_kW },
            ]}
            format={(n) => `${fmt(n, 2)} kW`}
          />
          <p className="mt-4 text-[13px] text-ink-3">Even phases keep the neutral current and voltage drop low.</p>
        </Card>
      </div>

      {pv.enabled && (
        <Card title="Solar PV and battery">
          <div className="grid gap-x-10 md:grid-cols-2">
            <Specs
              rows={[
                ['Array', `${pv.panelCount} × ${pv.panelWattage} Wp = ${fmt(pv.arrayKwp, 2)} kWp`],
                ['Strings', `${pv.stringsCount} × ${pv.panelsPerString} panels`],
                ['String Voc / Isc', `${fmt(pv.stringVocV, 0)} V / ${fmt(pv.stringIscA, 1)} A`],
                ['Estimated yield', `${fmt(pv.estimatedDailyKWh, 1)} kWh per day`],
              ]}
            />
            <Specs
              rows={[
                ['Hybrid inverter', `${fmt(pv.inverterKW, 1)} kW`],
                ['Battery', pv.batteryKWh > 0 ? `${fmt(pv.batteryKWh, 1)} kWh LiFePO4` : 'None'],
                ['DC cable / isolator', `${pv.dcCableSpec} · ${pv.dcIsolatorSpec}`],
                ['AC breaker', pv.acBreakerSpec],
              ]}
            />
          </div>
        </Card>
      )}
    </SheetPage>
  );
}

/* ── Single-line diagram ───────────────────────────────────────────── */

const STEP = 118;

/** "20A Type B RCBO (30mA)" → ["20A", "RCBO 30mA"]: short enough to sit beside a branch. */
function shortRating(full: string): string[] {
  const amps = full.match(/\d+\s*A\b/)?.[0]?.replace(/\s/g, '') ?? full.split(' ')[0];
  const kind = full.match(/RCBO|RCCB|MCCB|MCB|Isolator/i)?.[0] ?? '';
  const ma = full.match(/\d+\s*mA/)?.[0]?.replace(/\s/g, '') ?? '';
  return [amps, [kind, ma].filter(Boolean).join(' ')].filter(Boolean);
}

function Breaker({ x, y, label, compact }: { x: number; y: number; label: string; compact?: boolean }) {
  const lines = compact ? shortRating(label) : [label];
  // IEC-style breaker: contact gap with an angled blade and a cross at the fixed contact.
  return (
    <g>
      <line x1={x} y1={y} x2={x} y2={y + 10} stroke={INK} strokeWidth={1.4} />
      <line x1={x} y1={y + 10} x2={x + 9} y2={y + 26} stroke={INK} strokeWidth={1.4} />
      <path d={`M${x - 4} ${y + 26}l8 8M${x + 4} ${y + 26}l-8 8`} stroke={INK} strokeWidth={1.2} />
      <line x1={x} y1={y + 30} x2={x} y2={y + 40} stroke={INK} strokeWidth={1.4} />
      {lines.map((ln, i) => (
        <text key={i} x={x + 13} y={y + 18 + i * 12} fontSize={i ? 9.5 : 10.5} fontWeight={i ? 400 : 600} fill={i ? INK_3 : INK_2}>
          {ln}
        </text>
      ))}
    </g>
  );
}

function Box({ x, y, w, h, title, sub, accent }: { x: number; y: number; w: number; h: number; title: string; sub?: string; accent?: string }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={8} fill="#fff" stroke={accent ?? INK} strokeWidth={1.4} />
      <text x={x + w / 2} y={y + (sub ? h / 2 - 2 : h / 2 + 4)} textAnchor="middle" fontSize={12} fontWeight={600} fill={INK}>
        {title}
      </text>
      {sub && (
        <text x={x + w / 2} y={y + h / 2 + 13} textAnchor="middle" fontSize={10} fill={INK_3}>
          {sub}
        </text>
      )}
    </g>
  );
}

function wrap(s: string, n: number) {
  const out: string[] = [];
  let cur = '';
  for (const w of s.split(/\s+/)) {
    if (cur && (cur + ' ' + w).length > n) (out.push(cur), (cur = w));
    else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) out.push(cur);
  return out.slice(0, 3);
}

function SingleLine({ r }: { r: ElectricalSLDReport }) {
  const pv = r.solarPV;
  const n = r.circuits.length;
  const left = 150;
  const busY = 250;
  const solarW = pv.enabled ? 260 : 0;
  const width = Math.max(720, left + n * STEP + 40 + solarW);
  const busEnd = left + Math.max(1, n) * STEP - STEP / 2 + 24;
  const height = 470;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} className="max-w-none" style={{ fontFamily: 'Inter, system-ui, sans-serif' }} role="img" aria-label="Electrical single-line diagram">
      {/* Incoming supply → meter → main breaker → busbar */}
      <circle cx={70} cy={34} r={18} fill="#fff" stroke={INK} strokeWidth={1.4} />
      <path d="M60 34q5 -8 10 0t10 0" fill="none" stroke={INK} strokeWidth={1.4} />
      <text x={96} y={30} fontSize={12} fontWeight={600} fill={INK}>
        Utility supply
      </text>
      <text x={96} y={45} fontSize={10} fill={INK_3}>
        {r.supplySystem}
      </text>
      <line x1={70} y1={52} x2={70} y2={76} stroke={INK} strokeWidth={1.4} />
      <Box x={40} y={76} w={60} h={34} title="kWh" />
      <text x={110} y={97} fontSize={10} fill={INK_3}>
        {r.supplyCableSpec}
      </text>
      <line x1={70} y1={110} x2={70} y2={140} stroke={INK} strokeWidth={1.4} />
      {/* SPD to earth */}
      <line x1={70} y1={130} x2={30} y2={130} stroke={INK_2} strokeWidth={1.2} />
      <rect x={14} y={130} width={16} height={24} fill="#fff" stroke={INK_2} strokeWidth={1.2} />
      <text x={22} y={168} textAnchor="middle" fontSize={9.5} fill={INK_3}>
        SPD
      </text>
      <Breaker x={70} y={140} label={r.mainBreakerSpec} />
      <line x1={70} y1={180} x2={70} y2={busY} stroke={INK} strokeWidth={1.4} />
      <text x={78} y={busY - 10} fontSize={10} fill={INK_3}>
        Main distribution board
      </text>

      {/* Busbar */}
      <line x1={58} y1={busY} x2={Math.max(busEnd, 120)} y2={busY} stroke={INK} strokeWidth={5} strokeLinecap="round" />

      {/* Final circuits */}
      {r.circuits.map((c, i) => {
        const x = left + i * STEP;
        const vdWarn = c.voltageDropPct > 3;
        return (
          <g key={c.circuitId}>
            <line x1={x} y1={busY} x2={x} y2={busY + 18} stroke={INK} strokeWidth={1.4} />
            <Breaker x={x} y={busY + 18} label={c.breakerRating} compact />
            <line x1={x} y1={busY + 58} x2={x} y2={busY + 84} stroke={INK} strokeWidth={1.4} strokeDasharray="5 3" />
            <circle cx={x} cy={busY + 88} r={4} fill={INK} />
            <text x={x} y={busY + 108} textAnchor="middle" fontSize={11} fontWeight={600} fill={INK}>
              {c.circuitId}
            </text>
            {wrap(c.name.replace(new RegExp(`^${c.circuitId}\\s*[—-]\\s*`), ''), 16).map((ln, k) => (
              <text key={k} x={x} y={busY + 124 + k * 13} textAnchor="middle" fontSize={10.5} fill={INK_2}>
                {ln}
              </text>
            ))}
            <text x={x} y={busY + 168} textAnchor="middle" fontSize={10} fill={INK_3}>
              {fmt(c.loadWatts)} W · {c.phase}
            </text>
            <text x={x} y={busY + 182} textAnchor="middle" fontSize={10} fill={vdWarn ? MEP_COLOR.power : INK_3}>
              {c.cableSpec.split(' ')[0]} · ΔV {c.voltageDropPct.toFixed(1)}%
            </text>
          </g>
        );
      })}

      {/* Solar: PV array → DC isolator → hybrid inverter → AC breaker → busbar; battery on the inverter */}
      {pv.enabled && (
        <g>
          {(() => {
            const sx = busEnd + 120;
            return (
              <>
                <g>
                  <rect x={sx - 50} y={14} width={100} height={46} rx={6} fill="#fff" stroke={MEP_COLOR.solar} strokeWidth={1.6} />
                  {[0, 1, 2].map((k) => (
                    <line key={k} x1={sx - 50 + (k + 1) * 25} y1={14} x2={sx - 50 + (k + 1) * 25} y2={60} stroke={MEP_COLOR.solar} strokeWidth={0.8} />
                  ))}
                  <line x1={sx - 50} y1={37} x2={sx + 50} y2={37} stroke={MEP_COLOR.solar} strokeWidth={0.8} />
                  <text x={sx + 58} y={32} fontSize={12} fontWeight={600} fill={INK}>
                    PV array
                  </text>
                  <text x={sx + 58} y={47} fontSize={10} fill={INK_3}>
                    {fmt(pv.arrayKwp, 2)} kWp · {pv.stringsCount} strings
                  </text>
                </g>
                <line x1={sx} y1={60} x2={sx} y2={84} stroke={INK} strokeWidth={1.4} />
                <Box x={sx - 34} y={84} w={68} h={26} title="DC isolator" />
                <line x1={sx} y1={110} x2={sx} y2={132} stroke={INK} strokeWidth={1.4} />
                <Box x={sx - 56} y={132} w={112} h={46} title="Hybrid inverter" sub={`${fmt(pv.inverterKW, 1)} kW`} accent={ACCENT} />
                {pv.batteryKWh > 0 && (
                  <>
                    <line x1={sx + 56} y1={155} x2={sx + 92} y2={155} stroke={INK} strokeWidth={1.4} />
                    <Box x={sx + 92} y={136} w={92} h={38} title="Battery" sub={`${fmt(pv.batteryKWh, 1)} kWh`} />
                  </>
                )}
                <Breaker x={sx} y={178} label={pv.acBreakerSpec} compact />
                <path d={`M${sx} 218V${busY}H${busEnd}`} fill="none" stroke={INK} strokeWidth={1.4} />
              </>
            );
          })()}
        </g>
      )}

      {/* Earth bar */}
      <g>
        <line x1={20} y1={height - 30} x2={140} y2={height - 30} stroke={LINE} strokeWidth={1} />
        <text x={20} y={height - 12} fontSize={10} fill={INK_3}>
          {r.earthingSpec}
        </text>
      </g>
    </svg>
  );
}
