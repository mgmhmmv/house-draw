import React from 'react';
import { BuildingProject, getDesignConfig, getSolarConfig } from '../model/types';
import { computeElevation, computeSection, ElevationDirection } from '../engine/projections';
import { TitleBlock } from './TitleBlock';
import { FACADE_MATERIAL_OPTIONS, ROOF_MATERIAL_OPTIONS } from './Viewport3D';

interface ElevationsAndSectionsViewProps {
  project: BuildingProject;
  mode: 'A-201' | 'A-301';
  onUpdateProject: (proj: BuildingProject) => void;
  isLight?: boolean;
}

const ELEV_SCALE = 26;

export const ElevationsAndSectionsView: React.FC<ElevationsAndSectionsViewProps> = ({
  project,
  mode,
  onUpdateProject,
  isLight = true,
}) => {
  const design = getDesignConfig(project);
  const solar = getSolarConfig(project);
  const roofSpec = ROOF_MATERIAL_OPTIONS.find((r) => r.id === project.roof.material) || ROOF_MATERIAL_OPTIONS[0];
  const facadeSpec = FACADE_MATERIAL_OPTIONS.find((f) => f.id === design.exteriorFacade) || FACADE_MATERIAL_OPTIONS[0];

  const svgPaper = isLight ? '#ffffff' : '#050912';
  const wallFill = isLight ? facadeSpec.base : '#1e293b';
  const wallStroke = isLight ? '#0f172a' : '#cbd5e1';
  const roofFill = isLight ? roofSpec.base : '#334155';
  const roofStroke = isLight ? '#0f172a' : '#e2e8f0';
  const datumText = isLight ? '#334155' : '#94a3b8';
  const ridgeColor = isLight ? '#0284c7' : '#38bdf8';

  if (mode === 'A-201') {
    const dirs: ElevationDirection[] = ['North', 'South', 'East', 'West'];
    return (
      <div className="flex flex-col h-full w-full bg-[#070b14] overflow-hidden">
        <div className="flex-1 overflow-auto p-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
          {dirs.map((dir) => {
            const ev = computeElevation(project, dir);
            const svgW = Math.max(500, (ev.width + 7) * ELEV_SCALE);
            const svgH = 310;
            const groundY = 255;
            const offsetX = (svgW - ev.width * ELEV_SCALE) / 2 - ev.minU * ELEV_SCALE;
            const isHoriz = dir === 'North' || dir === 'South';
            const gridAxes = isHoriz ? project.grid.xAxes : project.grid.yAxes;
            const dimX = ev.maxU * ELEV_SCALE + offsetX + 26;
            const yEave = groundY - ev.eaveHeight * ELEV_SCALE;
            const yRidge = groundY - ev.ridgeHeight * ELEV_SCALE;

            return (
              <div key={dir} className="bg-slate-900/70 border border-slate-700/80 rounded-lg p-3 flex flex-col">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-mono text-xs font-semibold text-cyan-300 uppercase">
                    {dir} Elevation · Scale 1:100
                  </span>
                  <span className="font-mono text-[11px] text-slate-400">
                    Ridge +{ev.ridgeHeight.toFixed(2)}m · Span {ev.width.toFixed(2)}m
                  </span>
                </div>

                <svg
                  viewBox={`0 0 ${svgW} ${svgH}`}
                  style={{ backgroundColor: svgPaper }}
                  className="w-full h-60 rounded border border-slate-800"
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
                          y2={groundY + 12}
                          stroke={isLight ? '#cbd5e1' : '#334155'}
                          strokeWidth={0.75}
                          strokeDasharray="6 3 2 3"
                        />
                        <circle cx={gx} cy={18} r={9} fill={svgPaper} stroke="#0284c7" strokeWidth={1.1} />
                        <text x={gx} y={21} textAnchor="middle" fill={ridgeColor} fontSize={9} fontFamily="monospace" fontWeight="bold">
                          {ax.label}
                        </text>
                      </g>
                    );
                  })}

                  {/* Ground line & Sub-grade earth */}
                  <line x1={15} y1={groundY} x2={svgW - 15} y2={groundY} stroke="#64748b" strokeWidth={2} />
                  <rect x={15} y={groundY} width={svgW - 30} height={16} fill={isLight ? '#e2e8f0' : '#1e293b'} opacity={0.7} />

                  {/* Level Datum Dashed Lines & Inverted Triangle Markers (▽) */}
                  {ev.levelDatums.map((d, i) => {
                    const yBase = groundY - d.elevation * ELEV_SCALE;
                    const yTop = groundY - d.topHeight * ELEV_SCALE;
                    return (
                      <g key={i}>
                        <line x1={25} y1={yBase} x2={svgW - 25} y2={yBase} stroke={isLight ? '#cbd5e1' : '#334155'} strokeDasharray="4 4" strokeWidth={0.9} />
                        <polygon points={`28,${yBase - 5} 34,${yBase - 5} 31,${yBase}`} fill="#0284c7" />
                        <text x={38} y={yBase - 3} fill={datumText} fontSize={8.5} fontFamily="monospace">
                          +{d.elevation.toFixed(2)}m ({d.name})
                        </text>
                        <line x1={25} y1={yTop} x2={svgW - 25} y2={yTop} stroke={isLight ? '#cbd5e1' : '#334155'} strokeDasharray="4 4" strokeWidth={0.9} />
                      </g>
                    );
                  })}

                  {/* Plinth */}
                  <rect
                    x={ev.minU * ELEV_SCALE + offsetX}
                    y={groundY - (project.levels[0]?.elevation ?? 0.45) * ELEV_SCALE}
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

                  {/* Projected Doors & Windows with ISO Casement Hinge Lines */}
                  {ev.openings.map((op, idx) => {
                    const x = op.x1 * ELEV_SCALE + offsetX;
                    const y = groundY - op.yTop * ELEV_SCALE;
                    const w = Math.max(6, (op.x2 - op.x1) * ELEV_SCALE);
                    const h = (op.yTop - op.yBottom) * ELEV_SCALE;
                    return (
                      <g key={idx}>
                        <rect
                          x={x}
                          y={y}
                          width={w}
                          height={h}
                          fill={op.kind === 'window' ? (isLight ? '#bae6fd' : '#0c4a6e') : (isLight ? '#fde68a' : '#78350f')}
                          stroke={op.kind === 'window' ? '#0284c7' : '#b45309'}
                          strokeWidth={1.2}
                        />
                        {op.kind === 'window' && (
                          <>
                            <line x1={x + w / 2} y1={y} x2={x + w / 2} y2={y + h} stroke={isLight ? '#0369a1' : '#7dd3fc'} strokeWidth={0.9} />
                            {/* Standard European/ISO Side-Hung Casement Hinge Lines */}
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
                        )}
                      </g>
                    );
                  })}

                  {/* Roof Silhouette */}
                  {(() => {
                    const xL = (ev.minU - project.roof.overhang) * ELEV_SCALE + offsetX;
                    const xR = (ev.maxU + project.roof.overhang) * ELEV_SCALE + offsetX;
                    if (ev.roofType === 'flat') {
                      return (
                        <rect
                          x={xL}
                          y={yRidge}
                          width={xR - xL}
                          height={yEave - yRidge}
                          fill={roofFill}
                          stroke={roofStroke}
                          strokeWidth={1.4}
                        />
                      );
                    }
                    if (ev.roofType === 'shed') {
                      return (
                        <polygon
                          points={`${xL},${yEave} ${xR},${yRidge} ${xR},${yEave}`}
                          fill={roofFill}
                          stroke={roofStroke}
                          strokeWidth={1.4}
                        />
                      );
                    }
                    const hipInset = ev.roofType === 'hip' ? (xR - xL) * 0.2 : 0;
                    const pvCount = Math.min(8, Math.max(2, Math.round(solar.panelCount / 2)));
                    const showFacePV = solar.enabled && (dir === 'South' || ev.roofType === 'flat');
                    const showSlopePVProfile = solar.enabled && !showFacePV && (dir === 'East' || dir === 'West');
                    const slopeMidX = (xL + xR) / 2;
                    return (
                      <g>
                        <polygon
                          points={`${xL},${yEave} ${xL + hipInset},${yRidge} ${xR - hipInset},${yRidge} ${xR},${yEave}`}
                          fill={roofFill}
                          stroke={roofStroke}
                          strokeWidth={1.4}
                        />
                        {showFacePV && ev.roofType !== 'flat' && (
                          <g>
                            {Array.from({ length: pvCount }).map((_, idx) => {
                              const span = xR - xL - hipInset * 2 - 24;
                              const pw = Math.max(14, span / pvCount - 4);
                              const px = xL + hipInset + 12 + idx * (span / pvCount);
                              const ph = Math.max(10, (yEave - yRidge) * 0.56);
                              const py = yRidge + (yEave - yRidge) * 0.22;
                              return (
                                <rect
                                  key={`pv_el_${idx}`}
                                  x={px}
                                  y={py}
                                  width={pw}
                                  height={ph}
                                  fill="#0f172a"
                                  stroke="#38bdf8"
                                  strokeWidth={0.9}
                                  rx={1}
                                />
                              );
                            })}
                          </g>
                        )}
                        {showSlopePVProfile && (
                          <line
                            x1={slopeMidX + 6}
                            y1={yRidge + 3}
                            x2={xR - 14}
                            y2={yEave - 7}
                            stroke="#0284c7"
                            strokeWidth={3}
                            strokeLinecap="round"
                          />
                        )}
                      </g>
                    );
                  })()}
                  <text x={svgW - 14} y={16} textAnchor="end" fill={datumText} fontSize={8} fontFamily="monospace">
                    {roofSpec.label.toUpperCase()} / {facadeSpec.label.toUpperCase()}
                    {solar.enabled ? ` · PV ${(solar.panelCount * solar.panelWattage / 1000).toFixed(1)}kWp` : ''}
                  </text>

                  {/* Ridge Datum */}
                  <line x1={25} y1={yRidge} x2={svgW - 25} y2={yRidge} stroke={ridgeColor} strokeDasharray="3 3" strokeWidth={0.8} />
                  <polygon points={`28,${yRidge - 5} 34,${yRidge - 5} 31,${yRidge}`} fill={ridgeColor} />
                  <text x={38} y={yRidge - 3} fill={ridgeColor} fontSize={8.5} fontFamily="monospace" fontWeight="bold">
                    RIDGE +{ev.ridgeHeight.toFixed(2)}m
                  </text>
                  <polygon points={`28,${groundY - 5} 34,${groundY - 5} 31,${groundY}`} fill="#64748b" />
                  <text x={38} y={groundY - 3} fill={datumText} fontSize={8.5} fontFamily="monospace">
                    NGL ±0.00m
                  </text>

                  {/* Vertical Right-Side Height Dimension Chain */}
                  <g stroke={datumText} strokeWidth={0.8} fill={datumText} fontFamily="monospace" fontSize={8.5}>
                    <line x1={dimX} y1={yRidge} x2={dimX} y2={groundY} />
                    <line x1={dimX - 4} y1={yRidge + 3} x2={dimX + 4} y2={yRidge - 3} strokeWidth={1.1} />
                    <line x1={dimX - 4} y1={yEave + 3} x2={dimX + 4} y2={yEave - 3} strokeWidth={1.1} />
                    <line x1={dimX - 4} y1={groundY + 3} x2={dimX + 4} y2={groundY - 3} strokeWidth={1.1} />
                    <text x={dimX + 6} y={(yEave + groundY) / 2} stroke="none">
                      {ev.eaveHeight.toFixed(2)}m
                    </text>
                    <text x={dimX + 6} y={(yRidge + yEave) / 2 + 3} stroke="none">
                      {(ev.ridgeHeight - ev.eaveHeight).toFixed(2)}m
                    </text>
                  </g>
                </svg>
              </div>
            );
          })}
        </div>

        <TitleBlock
          meta={project.meta}
          sheetNo="A-201"
          sheetTitle="Architectural Elevations (North, South, East, West)"
          discipline="Architectural"
          compact
          isLight={isLight}
        />
      </div>
    );
  }

  // Sheet A-301: Architectural & Structural Cross-Section
  const sectionLine = project.sections[0] ?? {
    id: 'sec_a',
    label: 'A-A',
    start: { x: -1, y: 5 },
    end: { x: 16, y: 5 },
  };
  const sec = computeSection(project, sectionLine);
  const SEC_SCALE = 36;
  const svgW = Math.max(760, (sec.length + 4) * SEC_SCALE);
  const svgH = 440;
  const groundY = 335;
  const xOffset = (svgW - sec.length * SEC_SCALE) / 2;

  return (
    <div className="flex flex-col h-full w-full bg-[#070b14] overflow-hidden">
      <div className="px-4 py-2 bg-slate-900/90 border-b border-slate-800 flex flex-wrap items-center justify-between gap-4 text-xs">
        <div className="flex items-center gap-3">
          <span className="font-mono font-semibold text-rose-400">SECTION {sec.label}</span>
          <span className="text-slate-400">Interactive Cut Plane Offset (Y):</span>
          <input
            type="range"
            min={0.5}
            max={12}
            step={0.25}
            value={sectionLine.start.y}
            onChange={(e) => {
              const newY = parseFloat(e.target.value);
              const next = structuredClone(project);
              if (next.sections[0]) {
                next.sections[0].start.y = newY;
                next.sections[0].end.y = newY;
                onUpdateProject(next);
              }
            }}
            className="w-40 accent-rose-500"
          />
          <span className="font-mono text-rose-300">Y = {sectionLine.start.y.toFixed(2)}m</span>
        </div>
        <div className="font-mono text-slate-400">
          Cut Walls: {sec.walls.length} · Footings: {sec.footings.length} · Ridge: +{sec.roofRidgeY.toFixed(2)}m
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4 flex items-center justify-center">
        <svg
          viewBox={`0 0 ${svgW} ${svgH}`}
          style={{ backgroundColor: svgPaper }}
          className="w-full max-w-5xl border border-slate-800 rounded-lg shadow-sm"
        >
          <defs>
            <pattern id="earthHatch" width="12" height="12" patternUnits="userSpaceOnUse">
              <path d="M 0 12 L 6 6 L 12 12 M 2 4 L 8 0" stroke={isLight ? '#94a3b8' : '#475569'} strokeWidth="1" fill="none" />
            </pattern>
            <pattern id="wallSectionPoche" width="6" height="6" patternTransform="rotate(45 0 0)" patternUnits="userSpaceOnUse">
              <line x1="0" y1="0" x2="0" y2="6" stroke="#e11d48" strokeWidth="1.4" />
            </pattern>
          </defs>

          {/* Project Structural Grid Bubbles onto Section A-A */}
          {project.grid.xAxes.map((ax) => {
            const gx = xOffset + (ax.coord - sectionLine.start.x) * SEC_SCALE;
            if (gx < 30 || gx > svgW - 30) return null;
            return (
              <g key={`sec_g_${ax.label}`}>
                <line
                  x1={gx}
                  y1={28}
                  x2={gx}
                  y2={groundY + 55}
                  stroke={isLight ? '#cbd5e1' : '#334155'}
                  strokeWidth={0.8}
                  strokeDasharray="6 3 2 3"
                />
                <circle cx={gx} cy={18} r={9} fill={svgPaper} stroke="#0284c7" strokeWidth={1.1} />
                <text x={gx} y={21} textAnchor="middle" fill={ridgeColor} fontSize={9.5} fontFamily="monospace" fontWeight="bold">
                  {ax.label}
                </text>
              </g>
            );
          })}

          {/* Natural Ground & Earth Subgrade */}
          <rect x={20} y={groundY} width={svgW - 40} height={85} fill="url(#earthHatch)" opacity={0.45} />
          <line x1={20} y1={groundY} x2={svgW - 20} y2={groundY} stroke={isLight ? '#475569' : '#94a3b8'} strokeWidth={2} />

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
              {/* RC Lintel Beam */}
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

          {/* Roof Truss / Rafter Profile */}
          {(() => {
            const uL = (sec.minU - project.roof.overhang) * SEC_SCALE + xOffset;
            const uR = (sec.maxU + project.roof.overhang) * SEC_SCALE + xOffset;
            const yEave = groundY - sec.roofEaveY * SEC_SCALE;
            const yRidge = groundY - sec.roofRidgeY * SEC_SCALE;
            const uMid = (uL + uR) / 2;
            if (project.roof.type === 'flat') {
              return (
                <g>
                  <rect x={uL} y={yRidge} width={uR - uL} height={yEave - yRidge} fill={roofFill} stroke={roofStroke} strokeWidth={1.5} />
                  {solar.enabled && (
                    <g>
                      <line x1={uL + 22} y1={yRidge - 8} x2={uR - 22} y2={yRidge - 16} stroke="#0f172a" strokeWidth={3.5} />
                      <line x1={uL + 22} y1={yRidge - 8} x2={uR - 22} y2={yRidge - 16} stroke="#38bdf8" strokeWidth={1.2} />
                      <text x={uMid} y={yRidge - 20} textAnchor="middle" fill="#0284c7" fontSize={8.5} fontFamily="monospace" fontWeight="bold">
                        SOLAR PV ARRAY ({solar.panelCount} MOD · {(solar.panelCount * solar.panelWattage / 1000).toFixed(1)}kWp)
                      </text>
                    </g>
                  )}
                </g>
              );
            }
            return (
              <g>
                <polygon
                  points={`${uL},${yEave} ${uMid},${yRidge} ${uR},${yEave}`}
                  fill={isLight ? '#f1f5f9' : '#1e293b'}
                  fillOpacity={0.7}
                  stroke={roofStroke}
                  strokeWidth={2}
                />
                {/* Roof Cladding Band */}
                <polyline
                  points={`${uL},${yEave} ${uMid},${yRidge} ${uR},${yEave}`}
                  fill="none"
                  stroke={roofSpec.base === '#e2e8f0' ? '#475569' : roofSpec.base}
                  strokeWidth={4.5}
                />
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
                      x={uMid + (uR - uMid) * 0.52}
                      y={yRidge + (yEave - yRidge) * 0.45 - 12}
                      fill="#0284c7"
                      fontSize={8.5}
                      fontFamily="monospace"
                      fontWeight="bold"
                    >
                      PV ARRAY ({solar.panelCount}×{solar.panelWattage}Wp)
                    </text>
                  </g>
                )}
                {/* Truss Web Members */}
                <line x1={uMid} y1={yRidge} x2={uMid} y2={yEave} stroke="#0284c7" strokeWidth={1.2} />
                <line x1={(uL + uMid) / 2} y1={(yEave + yRidge) / 2} x2={uMid} y2={yEave} stroke="#0284c7" strokeWidth={1} />
                <line x1={(uR + uMid) / 2} y1={(yEave + yRidge) / 2} x2={uMid} y2={yEave} stroke="#0284c7" strokeWidth={1} />
              </g>
            );
          })()}

          {/* Level Elevation Annotations + Inverted Triangles */}
          {project.levels.map((l) => {
            const y = groundY - l.elevation * SEC_SCALE;
            return (
              <g key={l.id}>
                <line x1={20} y1={y} x2={svgW - 20} y2={y} stroke={isLight ? '#cbd5e1' : '#475569'} strokeDasharray="4 4" strokeWidth={0.8} />
                <polygon points={`22,${y - 5} 28,${y - 5} 25,${y}`} fill="#0284c7" />
                <text x={32} y={y - 3} fill={isLight ? '#0f172a' : '#cbd5e1'} fontSize={10} fontFamily="monospace">
                  FFL +{l.elevation.toFixed(2)}m ({l.name})
                </text>
              </g>
            );
          })}
          <polygon points={`22,${groundY - 5} 28,${groundY - 5} 25,${groundY}`} fill="#64748b" />
          <text x={32} y={groundY - 4} fill={datumText} fontSize={10} fontFamily="monospace">
            NGL ±0.00m
          </text>
          <text x={28} y={groundY + 34} fill={ridgeColor} fontSize={10} fontFamily="monospace" fontWeight="bold">
            FOUNDATION LEVEL -0.90m (RC C25 FOOTINGS ON 100mm PCC 1:4:8)
          </text>

          {/* Standard Multi-Layer Assembly Callout Leaders (BS 8888 / ISO 128) */}
          <g fontFamily="monospace" fontSize={9} fill={isLight ? '#0f172a' : '#e2e8f0'}>
            <rect x={svgW - 245} y={42} width={225} height={58} rx={4} fill={svgPaper} fillOpacity={0.92} stroke="#0284c7" strokeWidth={1} />
            <text x={svgW - 237} y={56} fontWeight="bold" fill={ridgeColor}>1. ROOF ASSEMBLY (U=0.18)</text>
            <text x={svgW - 237} y={69}>{roofSpec.label} · Battens · Membrane</text>
            <text x={svgW - 237} y={81}>150mm Mineral Wool · VCL · MR Gypsum</text>
            <text x={svgW - 237} y={93}>Truss @ 600mm c/c{solar.enabled ? ` + ${solar.panelCount} PV Rack` : ''}</text>

            <rect x={svgW - 245} y={110} width={225} height={46} rx={4} fill={svgPaper} fillOpacity={0.92} stroke="#e11d48" strokeWidth={1} />
            <text x={svgW - 237} y={124} fontWeight="bold" fill="#e11d48">
              2. EXT. WALL BUILDUP ({project.levels.some((l) => l.walls.some((w) => w.material === 'cinder_block' || w.material === 'coral_stone')) ? '240mm' : '265mm'})
            </text>
            <text x={svgW - 237} y={137}>
              {facadeSpec.label} · {project.levels.some((l) => l.walls.some((w) => w.material === 'coral_stone')) ? '200mm Coral Stone' : project.levels.some((l) => l.walls.some((w) => w.material === 'cinder_block')) ? '200mm Hollow Cinder Block' : '230mm Brick/CMU'}
            </text>
            <text x={svgW - 237} y={149}>
              {design.interiorWalls === 'smooth_cement_plaster' ? '20mm Skim Cement Plaster · Anti-Algae' : '15mm Int. Plaster · 3-Coat Acrylic Paint'}
            </text>

            <rect x={svgW - 245} y={groundY + 22} width={225} height={46} rx={4} fill={svgPaper} fillOpacity={0.92} stroke="#64748b" strokeWidth={1} />
            <text x={svgW - 237} y={groundY + 36} fontWeight="bold" fill={datumText}>3. SLAB-ON-GRADE & DPM</text>
            <text x={svgW - 237} y={groundY + 49}>150mm RC C25/30 · 1200g Polythene DPM</text>
            <text x={svgW - 237} y={groundY + 61}>100mm Compacted Hardcore · SBC 150kPa</text>
          </g>
        </svg>
      </div>

      <TitleBlock
        meta={project.meta}
        sheetNo="A-301"
        sheetTitle={`Cross Section ${sec.label} — Architectural & Foundation Detail`}
        discipline="Architectural / Structural"
        compact
        isLight={isLight}
      />
    </div>
  );
};
