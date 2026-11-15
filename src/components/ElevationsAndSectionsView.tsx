import React, { useState } from 'react';
import {
  ActiveSheetId,
  BuildingProject,
  getDesignConfig,
  getRoofDrainageConfig,
  getSolarConfig,
  GUTTER_PROFILE_META,
  SectionLine,
  WATER_COLLECTION_META,
} from '../model/types';
import { levelBoundingBox } from '../engine/geometry';
import { computeElevation, computeSection, ElevationDirection } from '../engine/projections';
import { TitleBlock } from './TitleBlock';
import { FACADE_MATERIAL_OPTIONS, ROOF_MATERIAL_OPTIONS } from './Viewport3D';

interface ElevationsAndSectionsViewProps {
  project: BuildingProject;
  mode: 'A-201' | 'A-301';
  onUpdateProject: (proj: BuildingProject) => void;
  onSwitchSheet?: (sheet: ActiveSheetId) => void;
  isLight?: boolean;
}

const SHEET_SWITCH_ITEMS: { id: ActiveSheetId; label: string }[] = [
  { id: 'A-101', label: 'A-101 Plan' },
  { id: 'A-201', label: 'A-201 Elev' },
  { id: 'A-301', label: 'A-301 Sec' },
  { id: 'S-101', label: 'S-101 Struct' },
  { id: 'M-101', label: 'M-101 MEP' },
];

interface ArchDimHProps {
  x1: number;
  x2: number;
  y: number;
  extY1?: number;
  label: string;
  stroke: string;
  textColor: string;
  fontSize?: number;
  bold?: boolean;
}

const ArchDimH: React.FC<ArchDimHProps> = ({
  x1,
  x2,
  y,
  extY1,
  label,
  stroke,
  textColor,
  fontSize = 8.5,
  bold = false,
}) => {
  const lx1 = Math.min(x1, x2);
  const lx2 = Math.max(x1, x2);
  if (lx2 - lx1 < 8) return null;
  return (
    <g stroke={stroke} strokeWidth={0.8} fill={textColor} fontFamily="monospace" fontSize={fontSize}>
      {extY1 !== undefined && (
        <>
          <line x1={lx1} y1={extY1} x2={lx1} y2={y - 5} strokeOpacity={0.45} />
          <line x1={lx2} y1={extY1} x2={lx2} y2={y - 5} strokeOpacity={0.45} />
        </>
      )}
      <line x1={lx1 - 4} y1={y} x2={lx2 + 4} y2={y} />
      <line x1={lx1 - 3} y1={y + 3} x2={lx1 + 3} y2={y - 3} strokeWidth={1.15} />
      <line x1={lx2 - 3} y1={y + 3} x2={lx2 + 3} y2={y - 3} strokeWidth={1.15} />
      <text
        x={(lx1 + lx2) / 2}
        y={y - 3.5}
        textAnchor="middle"
        stroke="none"
        fontWeight={bold ? 'bold' : 'normal'}
      >
        {label}
      </text>
    </g>
  );
};

interface ArchDimVProps {
  x: number;
  y1: number;
  y2: number;
  extX?: number;
  label: string;
  stroke: string;
  textColor: string;
  side?: 'left' | 'right';
  fontSize?: number;
  bold?: boolean;
}

const ArchDimV: React.FC<ArchDimVProps> = ({
  x,
  y1,
  y2,
  extX,
  label,
  stroke,
  textColor,
  side = 'right',
  fontSize = 8.5,
  bold = false,
}) => {
  const top = Math.min(y1, y2);
  const bot = Math.max(y1, y2);
  if (bot - top < 8) return null;
  const tx = side === 'left' ? x - 6 : x + 6;
  const rot = side === 'left' ? -90 : 90;
  const midY = (top + bot) / 2;
  return (
    <g stroke={stroke} strokeWidth={0.8} fill={textColor} fontFamily="monospace" fontSize={fontSize}>
      {extX !== undefined && (
        <>
          <line x1={extX} y1={top} x2={side === 'left' ? x - 4 : x + 4} y2={top} strokeOpacity={0.45} />
          <line x1={extX} y1={bot} x2={side === 'left' ? x - 4 : x + 4} y2={bot} strokeOpacity={0.45} />
        </>
      )}
      <line x1={x} y1={top - 4} x2={x} y2={bot + 4} />
      <line x1={x - 3} y1={top + 3} x2={x + 3} y2={top - 3} strokeWidth={1.15} />
      <line x1={x - 3} y1={bot + 3} x2={x + 3} y2={bot - 3} strokeWidth={1.15} />
      <text
        x={tx}
        y={midY}
        textAnchor="middle"
        dominantBaseline="middle"
        stroke="none"
        fontWeight={bold ? 'bold' : 'normal'}
        transform={`rotate(${rot}, ${tx}, ${midY})`}
      >
        {label}
      </text>
    </g>
  );
};

interface RoofAngleOverlayProps {
  eaveX: number;
  eaveY: number;
  ridgeX: number;
  ridgeY: number;
  pitchDeg: number;
  slopeRatio: string;
  apexAngleDeg?: number;
  showApex?: boolean;
  strokeColor: string;
  fillBg: string;
  direction?: 'right' | 'left';
}

const RoofAngleOverlay: React.FC<RoofAngleOverlayProps> = ({
  eaveX,
  eaveY,
  ridgeX,
  ridgeY,
  pitchDeg,
  slopeRatio,
  apexAngleDeg,
  showApex = false,
  strokeColor,
  fillBg,
  direction = 'right',
}) => {
  const dx = ridgeX - eaveX;
  const dy = eaveY - ridgeY;
  const r = Math.min(34, Math.max(18, Math.abs(dx) * 0.28));
  const ang = Math.atan2(dy, Math.abs(dx));
  const sign = direction === 'right' ? 1 : -1;
  const arcEndX = eaveX + sign * r * Math.cos(ang);
  const arcEndY = eaveY - r * Math.sin(ang);
  const sweepFlag = direction === 'right' ? 0 : 1;

  // Slope triangle centered at 55% up the slope
  const t = 0.56;
  const triX = eaveX + dx * t;
  const triY = eaveY - dy * t;
  const triRun = 26 * sign;
  const triRise = Math.max(8, 26 * Math.tan(ang));

  return (
    <g>
      {/* Eave Horizontal Reference Ray & Pitch Angle Arc */}
      <line
        x1={eaveX}
        y1={eaveY}
        x2={eaveX + sign * (r + 16)}
        y2={eaveY}
        stroke={strokeColor}
        strokeWidth={0.9}
        strokeDasharray="3 2"
      />
      <path
        d={`M ${eaveX + sign * r} ${eaveY} A ${r} ${r} 0 0 ${sweepFlag} ${arcEndX} ${arcEndY}`}
        fill="none"
        stroke={strokeColor}
        strokeWidth={1.3}
      />
      <rect
        x={eaveX + sign * (r + 8) - (sign < 0 ? 44 : 0)}
        y={eaveY - 16}
        width={44}
        height={13}
        rx={2}
        fill={fillBg}
        fillOpacity={0.9}
        stroke={strokeColor}
        strokeWidth={0.6}
      />
      <text
        x={eaveX + sign * (r + 30)}
        y={eaveY - 7}
        textAnchor="middle"
        fill={strokeColor}
        fontSize={8}
        fontFamily="monospace"
        fontWeight="bold"
      >
        ∠{pitchDeg.toFixed(1)}°
      </text>

      {/* Architectural Roof Slope Ratio Triangle */}
      <g>
        <polyline
          points={`${triX - triRun * 0.5},${triY - 4} ${triX + triRun * 0.5},${triY - 4} ${triX + triRun * 0.5},${triY - 4 - triRise}`}
          fill="none"
          stroke={strokeColor}
          strokeWidth={1.1}
        />
        <text
          x={triX}
          y={triY - 8 - triRise}
          textAnchor="middle"
          fill={strokeColor}
          fontSize={7.8}
          fontFamily="monospace"
          fontWeight="bold"
        >
          {slopeRatio}
        </text>
      </g>

      {/* Apex Interior Angle Callout */}
      {showApex && apexAngleDeg !== undefined && dy > 16 && (
        <g>
          <path
            d={`M ${ridgeX - 15 * Math.cos(ang)} ${ridgeY + 15 * Math.sin(ang)} A 15 15 0 0 0 ${ridgeX + 15 * Math.cos(ang)} ${ridgeY + 15 * Math.sin(ang)}`}
            fill="none"
            stroke={strokeColor}
            strokeWidth={1.1}
          />
          <text
            x={ridgeX}
            y={ridgeY - 6}
            textAnchor="middle"
            fill={strokeColor}
            fontSize={8.2}
            fontFamily="monospace"
            fontWeight="bold"
          >
            APEX ∠{apexAngleDeg.toFixed(1)}°
          </text>
        </g>
      )}
    </g>
  );
};

export const ElevationsAndSectionsView: React.FC<ElevationsAndSectionsViewProps> = ({
  project,
  mode,
  onUpdateProject,
  onSwitchSheet,
  isLight = true,
}) => {
  const [elevFocus, setElevFocus] = useState<'all' | ElevationDirection>('all');
  const [showDims, setShowDims] = useState<boolean>(true);
  const [showAngles, setShowAngles] = useState<boolean>(true);
  const [showOpeningTags, setShowOpeningTags] = useState<boolean>(true);
  const [showDatums, setShowDatums] = useState<boolean>(true);
  const [zoomScale, setZoomScale] = useState<number>(1);
  const [fitMode, setFitMode] = useState<boolean>(true);
  const [sectionKey, setSectionKey] = useState<'A-A' | 'B-B'>('A-A');

  const design = getDesignConfig(project);
  const solar = getSolarConfig(project);
  const drainage = getRoofDrainageConfig(project.roof);
  const gutterMeta = GUTTER_PROFILE_META[drainage.gutterProfile];
  const collectMeta = WATER_COLLECTION_META[drainage.waterCollectionMode];
  const roofSpec = ROOF_MATERIAL_OPTIONS.find((r) => r.id === project.roof.material) || ROOF_MATERIAL_OPTIONS[0];
  const facadeSpec = FACADE_MATERIAL_OPTIONS.find((f) => f.id === design.exteriorFacade) || FACADE_MATERIAL_OPTIONS[0];

  const svgPaper = isLight ? '#ffffff' : '#050912';
  const wallFill = isLight ? facadeSpec.base : '#1e293b';
  const wallStroke = isLight ? '#0f172a' : '#cbd5e1';
  const roofFill = isLight ? roofSpec.base : '#334155';
  const roofStroke = isLight ? '#0f172a' : '#e2e8f0';
  const datumText = isLight ? '#334155' : '#94a3b8';
  const dimStroke = isLight ? '#475569' : '#64748b';
  const dimText = isLight ? '#0f172a' : '#e2e8f0';
  const ridgeColor = isLight ? '#0284c7' : '#38bdf8';
  const angleColor = isLight ? '#b45309' : '#fbbf24';

  const renderToolbar = (extraControls: React.ReactNode) => (
    <div className="px-3 py-2 bg-slate-900/90 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs shrink-0">
      <div className="flex flex-wrap items-center gap-1.5">
        {onSwitchSheet && (
          <div className="flex items-center gap-0.5 bg-slate-950 border border-slate-800 rounded-md p-0.5">
            {SHEET_SWITCH_ITEMS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onSwitchSheet(item.id)}
                className={`px-2 py-0.5 rounded font-mono text-[11px] font-medium transition ${
                  mode === item.id
                    ? 'bg-cyan-600 text-white text-white-keep'
                    : 'text-slate-300 hover:bg-slate-800'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        )}
        {extraControls}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {[
          { label: 'Dims', active: showDims, toggle: () => setShowDims((v) => !v) },
          { label: 'Angles & Slope', active: showAngles, toggle: () => setShowAngles((v) => !v) },
          { label: 'Openings', active: showOpeningTags, toggle: () => setShowOpeningTags((v) => !v) },
          { label: 'Datums', active: showDatums, toggle: () => setShowDatums((v) => !v) },
        ].map((item) => (
          <button
            key={item.label}
            type="button"
            onClick={item.toggle}
            className={`px-2 py-0.5 rounded border text-[11px] font-mono transition ${
              item.active
                ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/50'
                : 'bg-slate-950 text-slate-400 border-slate-700 hover:bg-slate-800'
            }`}
          >
            {item.label}
          </button>
        ))}

        <div className="flex items-center bg-slate-800 border border-slate-700 rounded-md overflow-hidden ml-1">
          <button
            type="button"
            onClick={() => {
              setFitMode(false);
              setZoomScale((z) => Math.max(0.65, Number((z - 0.15).toFixed(2))));
            }}
            className="px-1.5 py-0.5 hover:bg-slate-700 text-slate-200 border-r border-slate-700"
            title="Zoom Out"
          >
            −
          </button>
          <span className="px-2 py-0.5 font-mono text-[11px] text-slate-300 min-w-[3rem] text-center">
            {fitMode ? 'FIT' : `${Math.round(zoomScale * 100)}%`}
          </span>
          <button
            type="button"
            onClick={() => {
              setFitMode(false);
              setZoomScale((z) => Math.min(2.4, Number((z + 0.15).toFixed(2))));
            }}
            className="px-1.5 py-0.5 hover:bg-slate-700 text-slate-200 border-l border-slate-700"
            title="Zoom In"
          >
            +
          </button>
          <button
            type="button"
            onClick={() => {
              setFitMode(true);
              setZoomScale(1);
            }}
            className={`px-2 py-0.5 hover:bg-slate-700 border-l border-slate-700 font-medium ${
              fitMode ? 'text-cyan-400 font-semibold' : 'text-slate-200'
            }`}
            title="Fit View"
          >
            Fit
          </button>
        </div>
      </div>
    </div>
  );

  if (mode === 'A-201') {
    const dirs: ElevationDirection[] =
      elevFocus === 'all' ? ['North', 'South', 'East', 'West'] : [elevFocus];
    const ELEV_SCALE = elevFocus === 'all' ? 30 : 40;

    return (
      <div className="flex flex-col h-full w-full bg-[#070b14] overflow-hidden">
        {renderToolbar(
          <div className="flex items-center gap-1 bg-slate-950 border border-slate-800 rounded-md p-0.5">
            {(['all', 'North', 'South', 'East', 'West'] as const).map((viewOpt) => (
              <button
                key={viewOpt}
                type="button"
                onClick={() => setElevFocus(viewOpt)}
                className={`px-2 py-0.5 rounded text-[11px] font-medium transition ${
                  elevFocus === viewOpt
                    ? 'bg-cyan-600 text-white text-white-keep'
                    : 'text-slate-300 hover:bg-slate-800'
                }`}
              >
                {viewOpt === 'all' ? '4-View (N·S·E·W)' : `${viewOpt} Elev`}
              </button>
            ))}
          </div>
        )}

        <div
          className={`flex-1 overflow-auto p-4 ${
            elevFocus === 'all' ? 'grid grid-cols-1 lg:grid-cols-2 gap-4' : 'flex items-start justify-center'
          }`}
        >
          {dirs.map((dir) => {
            const ev = computeElevation(project, dir);
            const leftPad = 152;
            const rightPad = 118;
            const svgW = Math.max(660, Math.ceil(leftPad + ev.width * ELEV_SCALE + rightPad));
            const groundY = Math.ceil(ev.ridgeHeight * ELEV_SCALE + 114);
            const svgH = groundY + 96;
            const offsetX = leftPad - ev.minU * ELEV_SCALE;

            const isHoriz = dir === 'North' || dir === 'South';
            const gridAxes = isHoriz ? project.grid.xAxes : project.grid.yAxes;
            const bldgL = ev.minU * ELEV_SCALE + offsetX;
            const bldgR = ev.maxU * ELEV_SCALE + offsetX;
            const xL = (ev.minU - ev.overhang) * ELEV_SCALE + offsetX;
            const xR = (ev.maxU + ev.overhang) * ELEV_SCALE + offsetX;
            const yEave = groundY - ev.eaveHeight * ELEV_SCALE;
            const yRidge = groundY - ev.ridgeHeight * ELEV_SCALE;
            const yPlinth = groundY - (project.levels[0]?.elevation ?? 0.45) * ELEV_SCALE;
            const xMid = (xL + xR) / 2;

            const bayCoords = Array.from(
              new Set(gridAxes.map((a) => Number(a.coord.toFixed(2))))
            ).sort((a, b) => a - b);

            const repSill = ev.sillHeights[0];
            const repHead = ev.headHeights[0];

            return (
              <div
                key={dir}
                className={`bg-slate-900/70 border border-slate-700/80 rounded-lg p-3 flex flex-col ${
                  elevFocus !== 'all' ? 'w-full max-w-6xl' : ''
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setElevFocus((cur) => (cur === dir ? 'all' : dir))}
                      className="font-mono text-xs font-semibold text-cyan-300 uppercase hover:underline"
                      title={elevFocus === dir ? 'Return to 4-View Sheet' : `Focus ${dir} Elevation`}
                    >
                      {dir} Elevation · Scale 1:100
                    </button>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-amber-400">
                      ∠{ev.pitchDeg.toFixed(1)}° ({ev.slopeRatio})
                    </span>
                  </div>
                  <span className="font-mono text-[11px] text-slate-400">
                    Span {ev.width.toFixed(2)}m · Roof {(ev.width + ev.overhang * 2).toFixed(2)}m · Ridge +
                    {ev.ridgeHeight.toFixed(2)}m · {roofSpec.label}
                    {solar.enabled ? ` · PV ${((solar.panelCount * solar.panelWattage) / 1000).toFixed(1)}kWp` : ''}
                  </span>
                </div>

                <div
                  className="overflow-auto rounded border border-slate-800"
                  style={{ backgroundColor: svgPaper }}
                >
                  <svg
                    viewBox={`0 0 ${svgW} ${svgH}`}
                    style={{
                      backgroundColor: svgPaper,
                      width: fitMode ? '100%' : `${Math.round(svgW * zoomScale)}px`,
                      height: 'auto',
                      minWidth: fitMode ? '100%' : undefined,
                    }}
                    className="block"
                  >
                    {/* Structural Grid Axes & Top Bubbles (ISO 128) */}
                    {gridAxes.map((ax) => {
                      const gx = ax.coord * ELEV_SCALE + offsetX;
                      return (
                        <g key={`el_g_${ax.label}`}>
                          <line
                            x1={gx}
                            y1={28}
                            x2={gx}
                            y2={groundY + 14}
                            stroke={isLight ? '#cbd5e1' : '#334155'}
                            strokeWidth={0.75}
                            strokeDasharray="6 3 2 3"
                          />
                          <circle cx={gx} cy={18} r={9} fill={svgPaper} stroke="#0284c7" strokeWidth={1.1} />
                          <text
                            x={gx}
                            y={21}
                            textAnchor="middle"
                            fill={ridgeColor}
                            fontSize={9}
                            fontFamily="monospace"
                            fontWeight="bold"
                          >
                            {ax.label}
                          </text>
                        </g>
                      );
                    })}

                    {/* Top Multi-Tier Horizontal Dimension Chains */}
                    {showDims && (
                      <g>
                        {/* Tier 1: Grid Bay Centerlines */}
                        {bayCoords.map((coord, i) =>
                          i > 0 && coord - bayCoords[i - 1] >= 0.4 ? (
                            <ArchDimH
                              key={`t1_${i}`}
                              x1={bayCoords[i - 1] * ELEV_SCALE + offsetX}
                              x2={coord * ELEV_SCALE + offsetX}
                              y={44}
                              extY1={30}
                              label={`${(coord - bayCoords[i - 1]).toFixed(2)}`}
                              stroke={dimStroke}
                              textColor={dimText}
                            />
                          ) : null
                        )}

                        {/* Tier 2: Left Overhang, Overall Building Width, Right Overhang */}
                        <ArchDimH
                          x1={xL}
                          x2={bldgL}
                          y={65}
                          extY1={yEave}
                          label={`${ev.overhang.toFixed(2)}`}
                          stroke={dimStroke}
                          textColor={dimText}
                          fontSize={8}
                        />
                        <ArchDimH
                          x1={bldgL}
                          x2={bldgR}
                          y={65}
                          extY1={48}
                          label={`BUILDING SPAN ${ev.width.toFixed(2)} m`}
                          stroke={dimStroke}
                          textColor={dimText}
                          bold
                        />
                        <ArchDimH
                          x1={bldgR}
                          x2={xR}
                          y={65}
                          extY1={yEave}
                          label={`${ev.overhang.toFixed(2)}`}
                          stroke={dimStroke}
                          textColor={dimText}
                          fontSize={8}
                        />

                        {/* Tier 3: Overall Roof Width Including Overhangs */}
                        <ArchDimH
                          x1={xL}
                          x2={xR}
                          y={84}
                          extY1={67}
                          label={`OVERALL ROOF ${(ev.width + ev.overhang * 2).toFixed(2)} m`}
                          stroke={ridgeColor}
                          textColor={ridgeColor}
                          fontSize={8}
                          bold
                        />
                      </g>
                    )}

                    {/* Ground line & Sub-grade earth */}
                    <rect
                      x={15}
                      y={groundY}
                      width={svgW - 30}
                      height={14}
                      fill={isLight ? '#e2e8f0' : '#1e293b'}
                      opacity={0.75}
                    />
                    <line x1={15} y1={groundY} x2={svgW - 15} y2={groundY} stroke="#64748b" strokeWidth={2} />

                    {/* Level Datum Dashed Lines & Inverted Triangle Markers */}
                    {showDatums && (
                      <g>
                        {ev.levelDatums.map((d, i) => {
                          const yBase = groundY - d.elevation * ELEV_SCALE;
                          const yTop = groundY - d.topHeight * ELEV_SCALE;
                          return (
                            <g key={i}>
                              <line
                                x1={88}
                                y1={yBase}
                                x2={bldgR + 12}
                                y2={yBase}
                                stroke={isLight ? '#cbd5e1' : '#334155'}
                                strokeDasharray="4 4"
                                strokeWidth={0.85}
                              />
                              <polygon points={`12,${yBase - 5} 18,${yBase - 5} 15,${yBase}`} fill="#0284c7" />
                              <text x={22} y={yBase - 3} fill={datumText} fontSize={8} fontFamily="monospace">
                                FFL +{d.elevation.toFixed(2)}m
                              </text>
                              <line
                                x1={88}
                                y1={yTop}
                                x2={bldgR + 12}
                                y2={yTop}
                                stroke={isLight ? '#cbd5e1' : '#334155'}
                                strokeDasharray="4 4"
                                strokeWidth={0.85}
                              />
                              <polygon points={`12,${yTop - 5} 18,${yTop - 5} 15,${yTop}`} fill="#0284c7" />
                              <text x={22} y={yTop - 3} fill={datumText} fontSize={8} fontFamily="monospace">
                                EAVE +{d.topHeight.toFixed(2)}m
                              </text>
                            </g>
                          );
                        })}

                        {/* Ridge & NGL Datums */}
                        <line
                          x1={88}
                          y1={yRidge}
                          x2={bldgR + 12}
                          y2={yRidge}
                          stroke={ridgeColor}
                          strokeDasharray="3 3"
                          strokeWidth={0.8}
                        />
                        <polygon points={`12,${yRidge - 5} 18,${yRidge - 5} 15,${yRidge}`} fill={ridgeColor} />
                        <text
                          x={22}
                          y={yRidge - 3}
                          fill={ridgeColor}
                          fontSize={8}
                          fontFamily="monospace"
                          fontWeight="bold"
                        >
                          RIDGE +{ev.ridgeHeight.toFixed(2)}m
                        </text>
                        <polygon points={`12,${groundY - 5} 18,${groundY - 5} 15,${groundY}`} fill="#64748b" />
                        <text x={22} y={groundY - 3} fill={datumText} fontSize={8} fontFamily="monospace">
                          NGL ±0.00m
                        </text>
                      </g>
                    )}

                    {/* Plinth */}
                    <rect
                      x={bldgL}
                      y={yPlinth}
                      width={ev.width * ELEV_SCALE}
                      height={(project.levels[0]?.elevation ?? 0.45) * ELEV_SCALE}
                      fill={isLight ? '#94a3b8' : '#334155'}
                      stroke={wallStroke}
                      strokeWidth={1}
                    />

                    {/* Wall Silhouettes */}
                    {ev.wallSilhouettes.map((ws, idx) => (
                      <rect
                        key={idx}
                        x={ws.u1 * ELEV_SCALE + offsetX}
                        y={groundY - ws.yTop * ELEV_SCALE}
                        width={(ws.u2 - ws.u1) * ELEV_SCALE}
                        height={(ws.yTop - ws.yBottom) * ELEV_SCALE}
                        fill={wallFill}
                        stroke={wallStroke}
                        strokeWidth={1.3}
                      />
                    ))}

                    {/* Projected Doors & Windows with Sills, Lintels, Casement Lines & Tags */}
                    {ev.openings.map((op, idx) => {
                      const x = op.x1 * ELEV_SCALE + offsetX;
                      const y = groundY - op.yTop * ELEV_SCALE;
                      const w = Math.max(8, (op.x2 - op.x1) * ELEV_SCALE);
                      const h = (op.yTop - op.yBottom) * ELEV_SCALE;
                      const isWin = op.kind === 'window';
                      return (
                        <g key={op.id || idx}>
                          {/* RC Lintel & Projected Sill */}
                          <rect
                            x={x - 1.5}
                            y={y - 3}
                            width={w + 3}
                            height={3}
                            fill={isLight ? '#cbd5e1' : '#475569'}
                            stroke={wallStroke}
                            strokeWidth={0.5}
                          />
                          {isWin && (
                            <rect
                              x={x - 2}
                              y={y + h}
                              width={w + 4}
                              height={3}
                              fill={isLight ? '#94a3b8' : '#64748b'}
                              stroke={wallStroke}
                              strokeWidth={0.5}
                            />
                          )}
                          <rect
                            x={x}
                            y={y}
                            width={w}
                            height={h}
                            fill={isWin ? (isLight ? '#bae6fd' : '#0c4a6e') : isLight ? '#fde68a' : '#78350f'}
                            stroke={isWin ? '#0284c7' : '#b45309'}
                            strokeWidth={1.2}
                          />
                          {isWin ? (
                            <>
                              <line
                                x1={x + w / 2}
                                y1={y}
                                x2={x + w / 2}
                                y2={y + h}
                                stroke={isLight ? '#0369a1' : '#7dd3fc'}
                                strokeWidth={0.9}
                              />
                              <polyline
                                points={`${x},${y} ${x + w / 2},${y + h / 2} ${x},${y + h}`}
                                fill="none"
                                stroke={isLight ? '#0369a1' : '#7dd3fc'}
                                strokeWidth={0.6}
                                strokeDasharray="2 2"
                              />
                              <polyline
                                points={`${x + w},${y} ${x + w / 2},${y + h / 2} ${x + w},${y + h}`}
                                fill="none"
                                stroke={isLight ? '#0369a1' : '#7dd3fc'}
                                strokeWidth={0.6}
                                strokeDasharray="2 2"
                              />
                            </>
                          ) : (
                            <>
                              <rect
                                x={x + 2}
                                y={y + 2}
                                width={Math.max(4, w - 4)}
                                height={Math.max(4, h - 4)}
                                fill="none"
                                stroke="#b45309"
                                strokeWidth={0.7}
                              />
                              <circle cx={x + w - 4} cy={y + h * 0.52} r={1.3} fill="#92400e" />
                            </>
                          )}
                          {showOpeningTags && w >= 14 && (
                            <g>
                              <rect
                                x={x + w / 2 - 19}
                                y={y + h / 2 - 11}
                                width={38}
                                height={20}
                                rx={2}
                                fill={svgPaper}
                                fillOpacity={0.9}
                                stroke={isWin ? '#0284c7' : '#b45309'}
                                strokeWidth={0.7}
                              />
                              <text
                                x={x + w / 2}
                                y={y + h / 2 - 2}
                                textAnchor="middle"
                                fill={isWin ? '#0369a1' : '#92400e'}
                                fontSize={7.5}
                                fontFamily="monospace"
                                fontWeight="bold"
                              >
                                {op.tag}
                              </text>
                              <text
                                x={x + w / 2}
                                y={y + h / 2 + 6}
                                textAnchor="middle"
                                fill={dimText}
                                fontSize={6.5}
                                fontFamily="monospace"
                              >
                                {op.width.toFixed(1)}×{op.height.toFixed(1)}
                              </text>
                            </g>
                          )}
                        </g>
                      );
                    })}

                    {/* Roof Silhouette + Pitch Angles + Slope Ratio + Projected Solar PV */}
                    {(() => {
                      const isEndGableView = !isHoriz && (ev.roofType === 'gable' || ev.roofType === 'hip');
                      const hipInsetPx =
                        ev.roofType === 'hip' && isHoriz
                          ? Math.min(
                              (xR - xL) * 0.42,
                              Math.max(20, ((ev.maxU - ev.minU) / 2 + ev.overhang - ev.ridgeHalf) * ELEV_SCALE)
                            )
                          : 0;

                      return (
                        <g>
                          {ev.roofType === 'flat' ? (
                            <g>
                              <rect
                                x={xL}
                                y={yRidge}
                                width={xR - xL}
                                height={yEave - yRidge}
                                fill={roofFill}
                                stroke={roofStroke}
                                strokeWidth={1.4}
                              />
                              {showAngles && (
                                <text
                                  x={xMid}
                                  y={(yRidge + yEave) / 2 + 3}
                                  textAnchor="middle"
                                  fill={isLight ? '#0f172a' : '#f8fafc'}
                                  fontSize={8}
                                  fontFamily="monospace"
                                  fontWeight="bold"
                                >
                                  PARAPET {project.roof.parapetHeight.toFixed(2)}m · SLAB FALL {ev.slopeRatio}
                                </text>
                              )}
                            </g>
                          ) : ev.roofType === 'shed' ? (
                            <g>
                              <polygon
                                points={`${xL},${yEave} ${xR},${yRidge} ${xR},${yEave}`}
                                fill={roofFill}
                                stroke={roofStroke}
                                strokeWidth={1.4}
                              />
                              {showAngles && (
                                <RoofAngleOverlay
                                  eaveX={xL}
                                  eaveY={yEave}
                                  ridgeX={xR}
                                  ridgeY={yRidge}
                                  pitchDeg={ev.pitchDeg}
                                  slopeRatio={ev.slopeRatio}
                                  strokeColor={angleColor}
                                  fillBg={svgPaper}
                                />
                              )}
                            </g>
                          ) : isEndGableView ? (
                            <g>
                              <polygon
                                points={`${xL},${yEave} ${xMid},${yRidge} ${xR},${yEave}`}
                                fill={roofFill}
                                stroke={roofStroke}
                                strokeWidth={1.4}
                              />
                              <line x1={xMid} y1={yEave} x2={xMid} y2={yRidge} stroke={roofStroke} strokeWidth={0.8} strokeDasharray="3 3" />
                              {showAngles && (
                                <RoofAngleOverlay
                                  eaveX={xL}
                                  eaveY={yEave}
                                  ridgeX={xMid}
                                  ridgeY={yRidge}
                                  pitchDeg={ev.pitchDeg}
                                  slopeRatio={ev.slopeRatio}
                                  apexAngleDeg={ev.apexAngleDeg}
                                  showApex
                                  strokeColor={angleColor}
                                  fillBg={svgPaper}
                                />
                              )}
                            </g>
                          ) : (
                            <g>
                              <polygon
                                points={`${xL},${yEave} ${xL + hipInsetPx},${yRidge} ${xR - hipInsetPx},${yRidge} ${xR},${yEave}`}
                                fill={roofFill}
                                stroke={roofStroke}
                                strokeWidth={1.4}
                              />
                              {ev.roofType === 'hip' && (
                                <>
                                  <line x1={xL} y1={yEave} x2={xL + hipInsetPx} y2={yRidge} stroke={roofStroke} strokeWidth={1.2} />
                                  <line x1={xR} y1={yEave} x2={xR - hipInsetPx} y2={yRidge} stroke={roofStroke} strokeWidth={1.2} />
                                </>
                              )}
                              {showAngles && (
                                <>
                                  {ev.roofType === 'hip' && hipInsetPx > 20 ? (
                                    <RoofAngleOverlay
                                      eaveX={xL}
                                      eaveY={yEave}
                                      ridgeX={xL + hipInsetPx}
                                      ridgeY={yRidge}
                                      pitchDeg={ev.pitchDeg}
                                      slopeRatio={ev.slopeRatio}
                                      strokeColor={angleColor}
                                      fillBg={svgPaper}
                                    />
                                  ) : null}
                                  <rect
                                    x={xMid - 64}
                                    y={(yEave + yRidge) / 2 - 8}
                                    width={128}
                                    height={15}
                                    rx={3}
                                    fill={svgPaper}
                                    fillOpacity={0.92}
                                    stroke={angleColor}
                                    strokeWidth={0.8}
                                  />
                                  <text
                                    x={xMid}
                                    y={(yEave + yRidge) / 2 + 2.5}
                                    textAnchor="middle"
                                    fill={angleColor}
                                    fontSize={8}
                                    fontFamily="monospace"
                                    fontWeight="bold"
                                  >
                                    PITCH ∠{ev.pitchDeg.toFixed(1)}° · SLOPE {ev.slopeRatio}
                                  </text>
                                </>
                              )}
                            </g>
                          )}

                          {/* Projected Manual/Array Solar PV Panels */}
                          {solar.enabled && ev.solarPanels.length > 0 && (
                            <g>
                              {isHoriz || ev.roofType === 'flat' ? (
                                (dir === 'South' || dir === 'North' || ev.roofType === 'flat') &&
                                ev.solarPanels.map((sp, idx) => {
                                  const px = sp.u1 * ELEV_SCALE + offsetX;
                                  const pw = Math.max(6, (sp.u2 - sp.u1) * ELEV_SCALE);
                                  const py = Math.max(yRidge + 2, groundY - sp.yTop * ELEV_SCALE);
                                  const ph = Math.max(5, Math.min(yEave - py - 2, (sp.yTop - sp.yBottom) * ELEV_SCALE));
                                  return (
                                    <rect
                                      key={`pv_el_${idx}`}
                                      x={px}
                                      y={py}
                                      width={pw}
                                      height={ph}
                                      fill="#0f172a"
                                      fillOpacity={dir === 'North' && solar.roofFace !== 'north' ? 0.35 : 0.92}
                                      stroke="#38bdf8"
                                      strokeWidth={0.9}
                                      rx={1}
                                    />
                                  );
                                })
                              ) : (
                                <g>
                                  {ev.solarPanels.slice(0, 6).map((sp, idx) => {
                                    const x1 = sp.u1 * ELEV_SCALE + offsetX;
                                    const x2 = sp.u2 * ELEV_SCALE + offsetX;
                                    const y1 = groundY - sp.yTop * ELEV_SCALE;
                                    const y2 = groundY - sp.yBottom * ELEV_SCALE;
                                    return (
                                      <line
                                        key={`pv_prof_${idx}`}
                                        x1={x1}
                                        y1={y1}
                                        x2={x2}
                                        y2={y2}
                                        stroke="#0284c7"
                                        strokeWidth={3.2}
                                        strokeLinecap="round"
                                      />
                                    );
                                  })}
                                  {showAngles && (
                                    <g>
                                      <rect
                                        x={xR - 86}
                                        y={yEave - 20}
                                        width={76}
                                        height={14}
                                        rx={2}
                                        fill={svgPaper}
                                        fillOpacity={0.94}
                                        stroke="#0284c7"
                                        strokeWidth={0.7}
                                      />
                                      <text
                                        x={xR - 48}
                                        y={yEave - 10}
                                        textAnchor="middle"
                                        fill="#0284c7"
                                        fontSize={7.5}
                                        fontFamily="monospace"
                                        fontWeight="bold"
                                      >
                                        PV ∠{ev.solarPanels[0].tiltDeg}°
                                      </text>
                                    </g>
                                  )}
                                </g>
                              )}
                            </g>
                          )}

                          {/* Roof Eave Gutter, Swan-Neck Downpipes (RWP) & Collection Destination */}
                          {drainage.gutterEnabled && (
                            <g>
                              <rect
                                x={xL - 3}
                                y={yEave - 1}
                                width={xR - xL + 6}
                                height={4.5}
                                rx={1.5}
                                fill={gutterMeta.colorHex}
                                stroke="#0284c7"
                                strokeWidth={1.1}
                              />
                              {/* Left & Right Swan-Neck + Vertical RWP Downpipes down exterior walls */}
                              <polyline
                                points={`${xL + 2},${yEave + 3.5} ${xL + 2},${yEave + 9} ${bldgL + 2},${yEave + 14} ${bldgL + 2},${groundY}`}
                                fill="none"
                                stroke="#0284c7"
                                strokeWidth={2.4}
                              />
                              <polyline
                                points={`${xR - 2},${yEave + 3.5} ${xR - 2},${yEave + 9} ${bldgR - 2},${yEave + 14} ${bldgR - 2},${groundY}`}
                                fill="none"
                                stroke="#0284c7"
                                strokeWidth={2.4}
                              />
                              {dir === 'East' && drainage.waterCollectionMode === 'harvesting_tank' && (
                                <g>
                                  <rect
                                    x={bldgR + 10}
                                    y={groundY - 42}
                                    width={24}
                                    height={42}
                                    rx={3}
                                    fill="#0369a1"
                                    fillOpacity={0.85}
                                    stroke="#0f172a"
                                    strokeWidth={1.1}
                                  />
                                  <line x1={bldgR - 2} y1={groundY - 34} x2={bldgR + 10} y2={groundY - 34} stroke="#0284c7" strokeWidth={2} />
                                  <text x={bldgR + 22} y={groundY - 46} textAnchor="middle" fill="#0284c7" fontSize={7} fontFamily="monospace" fontWeight="bold">
                                    {drainage.harvestingTankLiters}L
                                  </text>
                                </g>
                              )}
                              {dir === 'South' && (
                                <text
                                  x={xMid}
                                  y={yEave + 13}
                                  textAnchor="middle"
                                  fill="#0284c7"
                                  fontSize={7.2}
                                  fontFamily="monospace"
                                  fontWeight="bold"
                                >
                                  {gutterMeta.shortLabel.toUpperCase()} GUTTER · {drainage.downpipeCount}× Ø100 RWP → {collectMeta.shortLabel.toUpperCase()}
                                </text>
                              )}
                            </g>
                          )}
                        </g>
                      );
                    })()}

                    {/* Left & Right Multi-Tier Vertical Dimension Chains */}
                    {showDims && (
                      <g>
                        {/* Left Inner: Plinth -> Sill -> Window -> Eave Breakdown */}
                        <ArchDimV
                          x={bldgL - 22}
                          y1={yPlinth}
                          y2={groundY}
                          extX={bldgL}
                          label={`${(project.levels[0]?.elevation ?? 0.45).toFixed(2)}`}
                          stroke={dimStroke}
                          textColor={dimText}
                          side="left"
                          fontSize={7.2}
                        />
                        {repSill !== undefined && repHead !== undefined ? (
                          <>
                            <ArchDimV
                              x={bldgL - 22}
                              y1={groundY - repSill * ELEV_SCALE}
                              y2={yPlinth}
                              extX={bldgL}
                              label={`${(repSill - (project.levels[0]?.elevation ?? 0.45)).toFixed(2)}`}
                              stroke={dimStroke}
                              textColor={dimText}
                              side="left"
                              fontSize={7.2}
                            />
                            <ArchDimV
                              x={bldgL - 22}
                              y1={groundY - repHead * ELEV_SCALE}
                              y2={groundY - repSill * ELEV_SCALE}
                              extX={bldgL}
                              label={`${(repHead - repSill).toFixed(2)}`}
                              stroke={dimStroke}
                              textColor={dimText}
                              side="left"
                              fontSize={7.2}
                            />
                            <ArchDimV
                              x={bldgL - 22}
                              y1={yEave}
                              y2={groundY - repHead * ELEV_SCALE}
                              extX={bldgL}
                              label={`${(ev.eaveHeight - repHead).toFixed(2)}`}
                              stroke={dimStroke}
                              textColor={dimText}
                              side="left"
                              fontSize={7.2}
                            />
                          </>
                        ) : null}

                        {/* Left Outer: Story FFL to Eave Height */}
                        <ArchDimV
                          x={bldgL - 48}
                          y1={yEave}
                          y2={yPlinth}
                          extX={bldgL - 24}
                          label={`FFL–EAVE ${(ev.eaveHeight - (project.levels[0]?.elevation ?? 0.45)).toFixed(2)}m`}
                          stroke={ridgeColor}
                          textColor={ridgeColor}
                          side="left"
                          fontSize={8}
                          bold
                        />

                        {/* Right Inner: NGL-to-Eave + Eave-to-Ridge */}
                        <ArchDimV
                          x={xR + 22}
                          y1={yEave}
                          y2={groundY}
                          extX={xR}
                          label={`${ev.eaveHeight.toFixed(2)}m`}
                          stroke={dimStroke}
                          textColor={dimText}
                          side="right"
                        />
                        <ArchDimV
                          x={xR + 22}
                          y1={yRidge}
                          y2={yEave}
                          extX={xR}
                          label={`${(ev.ridgeHeight - ev.eaveHeight).toFixed(2)}m`}
                          stroke={dimStroke}
                          textColor={dimText}
                          side="right"
                        />

                        {/* Right Outer: Overall Ridge Height from NGL */}
                        <ArchDimV
                          x={xR + 50}
                          y1={yRidge}
                          y2={groundY}
                          extX={xR + 24}
                          label={`TOTAL ${ev.ridgeHeight.toFixed(2)}m`}
                          stroke={ridgeColor}
                          textColor={ridgeColor}
                          side="right"
                          bold
                        />

                        {/* Bottom Horizontal Pier & Opening Chain */}
                        {ev.pierPoints.map((pt, i) =>
                          i > 0 && pt - ev.pierPoints[i - 1] >= 0.35 ? (
                            <ArchDimH
                              key={`pier_${i}`}
                              x1={ev.pierPoints[i - 1] * ELEV_SCALE + offsetX}
                              x2={pt * ELEV_SCALE + offsetX}
                              y={groundY + 34}
                              extY1={groundY + 2}
                              label={`${(pt - ev.pierPoints[i - 1]).toFixed(2)}`}
                              stroke={dimStroke}
                              textColor={dimText}
                              fontSize={7.8}
                            />
                          ) : null
                        )}
                      </g>
                    )}

                    {/* Bottom Graphic Scale Bar & Engineering Summary */}
                    <g transform={`translate(${bldgL}, ${groundY + 62})`}>
                      <rect x={0} y={0} width={ELEV_SCALE} height={5} fill={dimText} />
                      <rect x={ELEV_SCALE} y={0} width={ELEV_SCALE} height={5} fill="none" stroke={dimText} strokeWidth={0.8} />
                      <rect x={ELEV_SCALE * 2} y={0} width={ELEV_SCALE * 3} height={5} fill={dimText} fillOpacity={0.28} stroke={dimText} strokeWidth={0.8} />
                      <text x={0} y={-4} fill={dimText} fontSize={7.5} fontFamily="monospace">0</text>
                      <text x={ELEV_SCALE} y={-4} textAnchor="middle" fill={dimText} fontSize={7.5} fontFamily="monospace">1</text>
                      <text x={ELEV_SCALE * 2} y={-4} textAnchor="middle" fill={dimText} fontSize={7.5} fontFamily="monospace">2</text>
                      <text x={ELEV_SCALE * 5} y={-4} textAnchor="middle" fill={dimText} fontSize={7.5} fontFamily="monospace">5m (1:100)</text>
                    </g>
                  </svg>
                </div>
              </div>
            );
          })}
        </div>

        <TitleBlock
          meta={project.meta}
          sheetNo="A-201"
          sheetTitle="Architectural Elevations (North, South, East, West — ISO 128)"
          discipline="Architectural"
          compact
          isLight={isLight}
        />
      </div>
    );
  }

  // Sheet A-301: Architectural & Structural Cross-Section (A-A & B-B)
  const bb = project.levels[0]
    ? levelBoundingBox(project.levels[0])
    : { minX: 0, minY: 0, maxX: 14, maxY: 11, width: 14, depth: 11 };

  const activeSectionLine: SectionLine =
    sectionKey === 'A-A'
      ? project.sections[0] ?? {
          id: 'sec_a',
          label: 'A-A',
          start: { x: bb.minX - 1.5, y: (bb.minY + bb.maxY) / 2 },
          end: { x: bb.maxX + 1.5, y: (bb.minY + bb.maxY) / 2 },
        }
      : project.sections[1] ?? {
          id: 'sec_b',
          label: 'B-B',
          start: { x: (bb.minX + bb.maxX) / 2, y: bb.minY - 1.5 },
          end: { x: (bb.minX + bb.maxX) / 2, y: bb.maxY + 1.5 },
        };

  const sec = computeSection(project, activeSectionLine);
  const SEC_SCALE = 36;
  const leftPad = 148;
  const rightCalloutPad = 310;
  const svgW = Math.max(920, Math.ceil(leftPad + sec.length * SEC_SCALE + rightCalloutPad));
  const groundY = Math.ceil(sec.roofRidgeY * SEC_SCALE + 114);
  const svgH = groundY + 115;
  const xOffset = leftPad;

  const isSecX = sec.axis === 'X';
  const gridAxes = isSecX ? project.grid.xAxes : project.grid.yAxes;
  const gridStartCoord = isSecX ? activeSectionLine.start.x : activeSectionLine.start.y;
  const secGridCoords = Array.from(
    new Set(gridAxes.map((a) => Number(a.coord.toFixed(2))))
  ).sort((a, b) => a - b);

  const uL = (sec.minU - sec.overhang) * SEC_SCALE + xOffset;
  const uR = (sec.maxU + sec.overhang) * SEC_SCALE + xOffset;
  const bldgL = sec.minU * SEC_SCALE + xOffset;
  const bldgR = sec.maxU * SEC_SCALE + xOffset;
  const yEave = groundY - sec.roofEaveY * SEC_SCALE;
  const yRidge = groundY - sec.roofRidgeY * SEC_SCALE;
  const uMid = (uL + uR) / 2;
  const yPlinth = groundY - (project.levels[0]?.elevation ?? 0.45) * SEC_SCALE;

  const cutOffsetValue = isSecX ? activeSectionLine.start.y : activeSectionLine.start.x;
  const cutSliderMin = isSecX ? Number((bb.minY + 0.5).toFixed(2)) : Number((bb.minX + 0.5).toFixed(2));
  const cutSliderMax = isSecX ? Number((bb.maxY - 0.5).toFixed(2)) : Number((bb.maxX - 0.5).toFixed(2));

  return (
    <div className="flex flex-col h-full w-full bg-[#070b14] overflow-hidden">
      {renderToolbar(
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-0.5 bg-slate-950 border border-slate-800 rounded-md p-0.5">
            {(['A-A', 'B-B'] as const).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setSectionKey(key)}
                className={`px-2 py-0.5 rounded font-mono text-[11px] font-semibold transition ${
                  sectionKey === key
                    ? 'bg-rose-600 text-white text-white-keep'
                    : 'text-slate-300 hover:bg-slate-800'
                }`}
              >
                Section {key} ({key === 'A-A' ? 'E–W' : 'N–S'})
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-slate-400">Cut Plane ({isSecX ? 'Y' : 'X'}):</span>
            <input
              type="range"
              aria-label="Section Cut Plane Offset"
              min={Math.min(cutSliderMin, cutSliderMax - 0.5)}
              max={Math.max(cutSliderMax, cutSliderMin + 0.5)}
              step={0.25}
              value={cutOffsetValue}
              onChange={(e) => {
                const val = parseFloat(e.target.value);
                const next = structuredClone(project);
                if (sectionKey === 'A-A') {
                  if (!next.sections[0]) {
                    next.sections[0] = structuredClone(activeSectionLine);
                  }
                  next.sections[0].start.y = val;
                  next.sections[0].end.y = val;
                } else {
                  if (!next.sections[1]) {
                    next.sections[1] = structuredClone(activeSectionLine);
                  }
                  next.sections[1].start.x = val;
                  next.sections[1].end.x = val;
                }
                onUpdateProject(next);
              }}
              className="w-32 accent-rose-500"
            />
            <span className="font-mono text-rose-400 font-semibold">
              {isSecX ? 'Y' : 'X'} = {cutOffsetValue.toFixed(2)}m
            </span>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-auto p-4 flex items-start justify-center">
        <svg
          viewBox={`0 0 ${svgW} ${svgH}`}
          style={{
            backgroundColor: svgPaper,
            width: fitMode ? '100%' : `${Math.round(svgW * zoomScale)}px`,
            maxWidth: fitMode ? '1180px' : undefined,
            height: 'auto',
          }}
          className="border border-slate-800 rounded-lg shadow-sm block"
        >
          <defs>
            <pattern id="earthHatch" width="12" height="12" patternUnits="userSpaceOnUse">
              <path
                d="M 0 12 L 6 6 L 12 12 M 2 4 L 8 0"
                stroke={isLight ? '#94a3b8' : '#475569'}
                strokeWidth="1"
                fill="none"
              />
            </pattern>
            <pattern
              id="wallSectionPoche"
              width="6"
              height="6"
              patternTransform="rotate(45 0 0)"
              patternUnits="userSpaceOnUse"
            >
              <line x1="0" y1="0" x2="0" y2="6" stroke="#e11d48" strokeWidth="1.4" />
            </pattern>
          </defs>

          {/* Top Info Header */}
          <text x={uL} y={18} fill={ridgeColor} fontSize={9} fontFamily="monospace" fontWeight="bold">
            CROSS SECTION {sec.label} ({isSecX ? 'LONGITUDINAL E–W' : 'TRANSVERSE N–S'}) · PITCH ∠
            {sec.pitchDeg.toFixed(1)}° ({sec.slopeRatio}) · RAFTER {sec.rafterLength.toFixed(2)}m
          </text>

          {/* Project Structural Grid Bubbles onto Section */}
          {gridAxes.map((ax) => {
            const gx = xOffset + (ax.coord - gridStartCoord) * SEC_SCALE;
            if (gx < xOffset - 20 || gx > uR + 20) return null;
            return (
              <g key={`sec_g_${ax.label}`}>
                <line
                  x1={gx}
                  y1={42}
                  x2={gx}
                  y2={groundY + 52}
                  stroke={isLight ? '#cbd5e1' : '#334155'}
                  strokeWidth={0.8}
                  strokeDasharray="6 3 2 3"
                />
                <circle cx={gx} cy={32} r={9} fill={svgPaper} stroke="#0284c7" strokeWidth={1.1} />
                <text
                  x={gx}
                  y={35}
                  textAnchor="middle"
                  fill={ridgeColor}
                  fontSize={9}
                  fontFamily="monospace"
                  fontWeight="bold"
                >
                  {ax.label}
                </text>
              </g>
            );
          })}

          {/* Top Horizontal Grid & Roof Span Dimensions */}
          {showDims && (
            <g>
              {secGridCoords.map((coord, i) =>
                i > 0 && coord - secGridCoords[i - 1] >= 0.4 ? (
                  <ArchDimH
                    key={`sg_${i}`}
                    x1={xOffset + (secGridCoords[i - 1] - gridStartCoord) * SEC_SCALE}
                    x2={xOffset + (coord - gridStartCoord) * SEC_SCALE}
                    y={56}
                    extY1={42}
                    label={`${(coord - secGridCoords[i - 1]).toFixed(2)}`}
                    stroke={dimStroke}
                    textColor={dimText}
                  />
                ) : null
              )}
              <ArchDimH
                x1={uL}
                x2={bldgL}
                y={76}
                extY1={yEave}
                label={`${sec.overhang.toFixed(2)}`}
                stroke={dimStroke}
                textColor={dimText}
                fontSize={8}
              />
              <ArchDimH
                x1={bldgL}
                x2={bldgR}
                y={76}
                extY1={58}
                label={`CUT SPAN ${(sec.maxU - sec.minU).toFixed(2)} m`}
                stroke={dimStroke}
                textColor={dimText}
                bold
              />
              <ArchDimH
                x1={bldgR}
                x2={uR}
                y={76}
                extY1={yEave}
                label={`${sec.overhang.toFixed(2)}`}
                stroke={dimStroke}
                textColor={dimText}
                fontSize={8}
              />
            </g>
          )}

          {/* Natural Ground & Earth Subgrade */}
          <rect x={20} y={groundY} width={bldgR + 80} height={85} fill="url(#earthHatch)" opacity={0.45} />
          <line
            x1={20}
            y1={groundY}
            x2={bldgR + 90}
            y2={groundY}
            stroke={isLight ? '#475569' : '#94a3b8'}
            strokeWidth={2}
          />

          {/* Strip / Pad Footings + Stem Walls */}
          {sec.footings.map((f, i) => (
            <g key={`ft_${i}`}>
              <rect
                x={xOffset + (f.u - f.width / 2) * SEC_SCALE}
                y={groundY + f.depth * SEC_SCALE - 10}
                width={f.width * SEC_SCALE}
                height={14}
                fill={isLight ? '#94a3b8' : '#475569'}
                stroke="#0284c7"
                strokeWidth={1.3}
              />
              <rect
                x={xOffset + (f.u - 0.12) * SEC_SCALE}
                y={groundY}
                width={0.24 * SEC_SCALE}
                height={f.depth * SEC_SCALE - 10}
                fill={isLight ? '#cbd5e1' : '#334155'}
                stroke="#64748b"
                strokeWidth={1}
              />
              {showDims && i === 0 && (
                <text
                  x={xOffset + (f.u - f.width / 2) * SEC_SCALE}
                  y={groundY + f.depth * SEC_SCALE + 16}
                  fill={ridgeColor}
                  fontSize={8}
                  fontFamily="monospace"
                  fontWeight="bold"
                >
                  {Math.round(f.width * 1000)}×300 PAD @ -{(f.depth).toFixed(2)}m
                </text>
              )}
            </g>
          ))}

          {/* RC Slabs */}
          {sec.slabs.map((s, i) => (
            <rect
              key={`sl_${i}`}
              x={xOffset + s.u1 * SEC_SCALE}
              y={groundY - s.yTop * SEC_SCALE}
              width={(s.u2 - s.u1) * SEC_SCALE}
              height={Math.max(5, (s.yTop - s.yBottom) * SEC_SCALE)}
              fill={isLight ? '#94a3b8' : '#64748b'}
              stroke={isLight ? '#0f172a' : '#e2e8f0'}
              strokeWidth={1.2}
            />
          ))}

          {/* Internal Room Section Callouts & Clear Span / Ceiling Height Dims */}
          {sec.rooms.map((r) => {
            const rx1 = xOffset + r.u1 * SEC_SCALE;
            const rx2 = xOffset + r.u2 * SEC_SCALE;
            const spanW = r.u2 - r.u1;
            const ryBot = groundY - r.elevation * SEC_SCALE;
            const ryTop = ryBot - r.ceilingHeight * SEC_SCALE;
            const midX = (rx1 + rx2) / 2;
            const dimLineX = rx1 + Math.min(26, (rx2 - rx1) * 0.25);
            return (
              <g key={`sec_rm_${r.id}`}>
                <text
                  x={midX}
                  y={ryTop + 26}
                  textAnchor="middle"
                  fill={isLight ? '#0f172a' : '#e2e8f0'}
                  fontSize={8.5}
                  fontFamily="monospace"
                  fontWeight="bold"
                >
                  {r.code} {r.name}
                </text>
                {showDims && spanW >= 0.9 && (
                  <>
                    {/* Clear Room Horizontal Span */}
                    <ArchDimH
                      x1={rx1 + 5}
                      x2={rx2 - 5}
                      y={ryBot - 14}
                      label={`${spanW.toFixed(2)}m`}
                      stroke="#0284c7"
                      textColor="#0284c7"
                      fontSize={8}
                    />
                    {/* Clear Ceiling Height */}
                    {rx2 - rx1 >= 44 && (
                      <ArchDimV
                        x={dimLineX}
                        y1={ryTop + 4}
                        y2={ryBot - 4}
                        label={`CH ${r.ceilingHeight.toFixed(2)}m`}
                        stroke="#16a34a"
                        textColor="#16a34a"
                        side="right"
                        fontSize={7.8}
                      />
                    )}
                  </>
                )}
              </g>
            );
          })}

          {/* Cut Masonry Walls with Section Poché */}
          {sec.walls.map((w, i) => (
            <g key={`cw_${i}`}>
              <rect
                x={xOffset + (w.u - w.thickness / 2) * SEC_SCALE}
                y={groundY - w.yTop * SEC_SCALE}
                width={Math.max(5, w.thickness * SEC_SCALE)}
                height={(w.yTop - w.yBottom) * SEC_SCALE}
                fill="url(#wallSectionPoche)"
                stroke="#e11d48"
                strokeWidth={1.4}
              />
              {/* RC Lintel / Tie Beam */}
              <rect
                x={xOffset + (w.u - w.thickness / 2 - 0.02) * SEC_SCALE}
                y={groundY - w.yTop * SEC_SCALE}
                width={Math.max(7, (w.thickness + 0.04) * SEC_SCALE)}
                height={10}
                fill="#0284c7"
                stroke="#0369a1"
                strokeWidth={0.8}
              />
            </g>
          ))}

          {/* Cut Openings Through Walls */}
          {sec.openings.map((op, i) => (
            <g key={`sec_op_${i}`}>
              <rect
                x={xOffset + op.u1 * SEC_SCALE}
                y={groundY - op.yTop * SEC_SCALE}
                width={Math.max(5, (op.u2 - op.u1) * SEC_SCALE)}
                height={(op.yTop - op.yBottom) * SEC_SCALE}
                fill={op.kind === 'window' ? '#bae6fd' : '#fde68a'}
                stroke={op.kind === 'window' ? '#0284c7' : '#b45309'}
                strokeWidth={1.1}
              />
              {showOpeningTags && (
                <text
                  x={xOffset + ((op.u1 + op.u2) / 2) * SEC_SCALE}
                  y={groundY - ((op.yBottom + op.yTop) / 2) * SEC_SCALE}
                  textAnchor="middle"
                  fill="#0f172a"
                  fontSize={7}
                  fontFamily="monospace"
                  fontWeight="bold"
                >
                  {op.tag}
                </text>
              )}
            </g>
          ))}

          {/* Roof Truss / Rafter Profile + Angles */}
          {project.roof.type === 'flat' ? (
            <g>
              <rect
                x={uL}
                y={yRidge}
                width={uR - uL}
                height={yEave - yRidge}
                fill={roofFill}
                stroke={roofStroke}
                strokeWidth={1.5}
              />
              {solar.enabled && (
                <g>
                  <line x1={uL + 22} y1={yRidge - 8} x2={uR - 22} y2={yRidge - 16} stroke="#0f172a" strokeWidth={3.5} />
                  <line x1={uL + 22} y1={yRidge - 8} x2={uR - 22} y2={yRidge - 16} stroke="#38bdf8" strokeWidth={1.2} />
                  <text
                    x={uMid}
                    y={yRidge - 20}
                    textAnchor="middle"
                    fill="#0284c7"
                    fontSize={8.5}
                    fontFamily="monospace"
                    fontWeight="bold"
                  >
                    SOLAR PV ARRAY ({solar.panelCount} MOD · Rack Tilt 12.6°)
                  </text>
                </g>
              )}
            </g>
          ) : (
            <g>
              <polygon
                points={`${uL},${yEave} ${uMid},${yRidge} ${uR},${yEave}`}
                fill={isLight ? '#f1f5f9' : '#1e293b'}
                fillOpacity={0.7}
                stroke={roofStroke}
                strokeWidth={2}
              />
              <polyline
                points={`${uL},${yEave} ${uMid},${yRidge} ${uR},${yEave}`}
                fill="none"
                stroke={roofSpec.base === '#e2e8f0' ? '#475569' : roofSpec.base}
                strokeWidth={4.5}
              />
              {/* Truss Web Members */}
              <line x1={uMid} y1={yRidge} x2={uMid} y2={yEave} stroke="#0284c7" strokeWidth={1.2} />
              <line x1={(uL + uMid) / 2} y1={(yEave + yRidge) / 2} x2={uMid} y2={yEave} stroke="#0284c7" strokeWidth={1} />
              <line x1={(uR + uMid) / 2} y1={(yEave + yRidge) / 2} x2={uMid} y2={yEave} stroke="#0284c7" strokeWidth={1} />

              {showAngles && (
                <RoofAngleOverlay
                  eaveX={uL}
                  eaveY={yEave}
                  ridgeX={uMid}
                  ridgeY={yRidge}
                  pitchDeg={sec.pitchDeg}
                  slopeRatio={sec.slopeRatio}
                  apexAngleDeg={sec.apexAngleDeg}
                  showApex
                  strokeColor={angleColor}
                  fillBg={svgPaper}
                />
              )}

              {drainage.gutterEnabled && (
                <g>
                  <path
                    d={`M ${uL - 7} ${yEave - 2} L ${uL - 7} ${yEave + 5} L ${uL} ${yEave + 5} L ${uL} ${yEave - 2}`}
                    fill={gutterMeta.colorHex}
                    stroke="#0284c7"
                    strokeWidth={1.3}
                  />
                  <path
                    d={`M ${uR} ${yEave - 2} L ${uR} ${yEave + 5} L ${uR + 7} ${yEave + 5} L ${uR + 7} ${yEave - 2}`}
                    fill={gutterMeta.colorHex}
                    stroke="#0284c7"
                    strokeWidth={1.3}
                  />
                  <text
                    x={uL - 10}
                    y={yEave + 14}
                    textAnchor="end"
                    fill="#0284c7"
                    fontSize={7.5}
                    fontFamily="monospace"
                    fontWeight="bold"
                  >
                    {gutterMeta.shortLabel.toUpperCase()} GUTTER
                  </text>
                </g>
              )}

              {solar.enabled && (
                <g>
                  <line
                    x1={uMid + (uR - uMid) * 0.16}
                    y1={yRidge + (yEave - yRidge) * 0.16 - 5}
                    x2={uMid + (uR - uMid) * 0.82}
                    y2={yRidge + (yEave - yRidge) * 0.82 - 5}
                    stroke="#0f172a"
                    strokeWidth={4}
                    strokeLinecap="round"
                  />
                  <line
                    x1={uMid + (uR - uMid) * 0.16}
                    y1={yRidge + (yEave - yRidge) * 0.16 - 5}
                    x2={uMid + (uR - uMid) * 0.82}
                    y2={yRidge + (yEave - yRidge) * 0.82 - 5}
                    stroke="#38bdf8"
                    strokeWidth={1.2}
                  />
                  <text
                    x={uMid + (uR - uMid) * 0.55}
                    y={yRidge + (yEave - yRidge) * 0.42 - 14}
                    fill="#0284c7"
                    fontSize={8.2}
                    fontFamily="monospace"
                    fontWeight="bold"
                  >
                    PV ({solar.panelCount}×{solar.panelWattage}Wp)
                  </text>
                </g>
              )}
            </g>
          )}

          {/* Right Vertical Section Height Dimensions */}
          {showDims && (
            <g>
              <ArchDimV
                x={uR + 22}
                y1={yEave}
                y2={groundY}
                extX={uR}
                label={`${sec.roofEaveY.toFixed(2)}m`}
                stroke={dimStroke}
                textColor={dimText}
                side="right"
              />
              <ArchDimV
                x={uR + 22}
                y1={yRidge}
                y2={yEave}
                extX={uR}
                label={`${(sec.roofRidgeY - sec.roofEaveY).toFixed(2)}m`}
                stroke={dimStroke}
                textColor={dimText}
                side="right"
              />
              <ArchDimV
                x={uR + 48}
                y1={yRidge}
                y2={groundY}
                extX={uR + 24}
                label={`TOTAL ${sec.roofRidgeY.toFixed(2)}m`}
                stroke={ridgeColor}
                textColor={ridgeColor}
                side="right"
                bold
              />
            </g>
          )}

          {/* Level Elevation Annotations + Inverted Triangles */}
          {showDatums && (
            <g>
              {project.levels.map((l) => {
                const y = groundY - l.elevation * SEC_SCALE;
                return (
                  <g key={l.id}>
                    <line
                      x1={88}
                      y1={y}
                      x2={uR + 12}
                      y2={y}
                      stroke={isLight ? '#cbd5e1' : '#475569'}
                      strokeDasharray="4 4"
                      strokeWidth={0.8}
                    />
                    <polygon points={`14,${y - 5} 20,${y - 5} 17,${y}`} fill="#0284c7" />
                    <text x={24} y={y - 3} fill={isLight ? '#0f172a' : '#cbd5e1'} fontSize={8.8} fontFamily="monospace">
                      FFL +{l.elevation.toFixed(2)}m ({l.name})
                    </text>
                  </g>
                );
              })}
              <line
                x1={88}
                y1={yPlinth}
                x2={uR + 12}
                y2={yPlinth}
                stroke={isLight ? '#cbd5e1' : '#475569'}
                strokeDasharray="4 4"
                strokeWidth={0.8}
              />
              <polygon points={`14,${groundY - 5} 20,${groundY - 5} 17,${groundY}`} fill="#64748b" />
              <text x={24} y={groundY - 4} fill={datumText} fontSize={8.8} fontFamily="monospace">
                NGL ±0.00m
              </text>
              <text x={24} y={groundY + 76} fill={ridgeColor} fontSize={8.8} fontFamily="monospace" fontWeight="bold">
                FOUNDATION -0.90m (RC C25 ON 100mm PCC 1:4:8)
              </text>
            </g>
          )}

          {/* Standard Multi-Layer Assembly Callout Leaders (Placed Safely in Right Margin) */}
          <g fontFamily="monospace" fontSize={8.8} fill={isLight ? '#0f172a' : '#e2e8f0'}>
            <rect
              x={svgW - 235}
              y={42}
              width={220}
              height={60}
              rx={4}
              fill={svgPaper}
              fillOpacity={0.94}
              stroke="#0284c7"
              strokeWidth={1}
            />
            <text x={svgW - 227} y={56} fontWeight="bold" fill={ridgeColor}>
              1. ROOF ASSEMBLY (U=0.18)
            </text>
            <text x={svgW - 227} y={69}>
              {roofSpec.label} · Battens · Membrane
            </text>
            <text x={svgW - 227} y={81}>
              150mm Mineral Wool · VCL · MR Gypsum
            </text>
            <text x={svgW - 227} y={93}>
              Pitch {sec.pitchDeg.toFixed(1)}° ({sec.slopeRatio}) · L={sec.rafterLength.toFixed(2)}m
            </text>

            <rect
              x={svgW - 235}
              y={114}
              width={220}
              height={48}
              rx={4}
              fill={svgPaper}
              fillOpacity={0.94}
              stroke="#e11d48"
              strokeWidth={1}
            />
            <text x={svgW - 227} y={128} fontWeight="bold" fill="#e11d48">
              2. EXT. WALL BUILDUP (
              {project.levels.some((l) =>
                l.walls.some((w) => w.material === 'cinder_block' || w.material === 'coral_stone')
              )
                ? '240mm'
                : '265mm'}
              )
            </text>
            <text x={svgW - 227} y={141}>
              {facadeSpec.label} ·{' '}
              {project.levels.some((l) => l.walls.some((w) => w.material === 'coral_stone'))
                ? '200mm Coral Stone'
                : project.levels.some((l) => l.walls.some((w) => w.material === 'cinder_block'))
                ? '200mm Hollow Cinder Block'
                : '230mm Brick/CMU'}
            </text>
            <text x={svgW - 227} y={153}>
              {design.interiorWalls === 'smooth_cement_plaster'
                ? '20mm Skim Cement · Anti-Algae'
                : '15mm Int. Plaster · 3-Coat Paint'}
            </text>

            <rect
              x={svgW - 235}
              y={groundY + 18}
              width={220}
              height={46}
              rx={4}
              fill={svgPaper}
              fillOpacity={0.94}
              stroke="#64748b"
              strokeWidth={1}
            />
            <text x={svgW - 227} y={groundY + 32} fontWeight="bold" fill={datumText}>
              3. SLAB-ON-GRADE &amp; DPM
            </text>
            <text x={svgW - 227} y={groundY + 45}>
              150mm RC C25/30 · 1200g Polythene DPM
            </text>
            <text x={svgW - 227} y={groundY + 57}>
              100mm Hardcore · SBC 150kPa
            </text>
          </g>
        </svg>
      </div>

      <TitleBlock
        meta={project.meta}
        sheetNo="A-301"
        sheetTitle={`Cross Section ${sec.label} — Architectural, Angles & Foundation Detail`}
        discipline="Architectural / Structural"
        compact
        isLight={isLight}
      />
    </div>
  );
};
