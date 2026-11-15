import React, { useMemo, useRef, useState } from 'react';
import {
  ActiveSheetId,
  BuildingProject,
  CADTool,
  getSolarConfig,
  Point2D,
  SketchStroke,
} from '../model/types';
import { autoPopulateMEPForLevel } from '../engine/mepEngine';
import {
  dist,
  getRoomFloorColor,
  levelBoundingBox,
  openingWorldCenter,
  polygonArea,
  polygonCentroid,
  projectPointOnSegment,
  snapPoint,
  uid,
  wallAngleRad,
  wallLength,
} from '../engine/geometry';
import { computeEngineeringSchedules, getOpeningMarkMap } from '../engine/standardsEngine';
import { TitleBlock } from './TitleBlock';

interface Canvas2DCADProps {
  project: BuildingProject;
  activeLevelIndex: number;
  activeSheet: ActiveSheetId;
  activeTool: CADTool;
  selectedId: string | null;
  onSelect: (id: string | null, kind?: 'wall' | 'opening' | 'room' | 'column') => void;
  onUpdateProject: (proj: BuildingProject) => void;
  sketchStrokes: SketchStroke[];
  onAddSketchStroke: (stroke: SketchStroke) => void;
  traceImageUrl: string | null;
  traceOpacity: number;
  svgRef?: React.RefObject<SVGSVGElement | null>;
  isLight?: boolean;
}

const SCALE = 42; // 42 SVG px per meter

export const Canvas2DCAD: React.FC<Canvas2DCADProps> = ({
  project,
  activeLevelIndex,
  activeSheet,
  activeTool,
  selectedId,
  onSelect,
  onUpdateProject,
  sketchStrokes,
  onAddSketchStroke,
  traceImageUrl,
  traceOpacity,
  svgRef,
  isLight = true,
}) => {
  const internalSvgRef = useRef<SVGSVGElement | null>(null);
  const effectiveSvgRef = svgRef ?? internalSvgRef;

  const level = project.levels[activeLevelIndex] ?? project.levels[0];
  const bb = levelBoundingBox(level);

  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 155, y: 135 });
  const [zoom, setZoom] = useState<number>(0.92);
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [cursorWorld, setCursorWorld] = useState<Point2D>({ x: 0, y: 0 });

  // Interactive drawing states
  const [drawStart, setDrawStart] = useState<Point2D | null>(null);
  const [measurePts, setMeasurePts] = useState<{ a: Point2D; b: Point2D } | null>(null);
  const [activeStroke, setActiveStroke] = useState<Point2D[] | null>(null);
  const [canvasBlueprint, setCanvasBlueprint] = useState<boolean>(false);
  const [showSchedules, setShowSchedules] = useState<boolean>(false);
  const [mepFilter, setMepFilter] = useState<'all' | 'electrical' | 'plumbing' | 'hvac' | 'solar'>('all');
  const solar = getSolarConfig(project);

  const schedules = useMemo(() => computeEngineeringSchedules(project), [project]);
  const openingMarks = useMemo(() => getOpeningMarkMap(project), [project]);

  const canvasLight = isLight && !canvasBlueprint;

  const toWorld = (clientX: number, clientY: number): Point2D => {
    const svg = effectiveSvgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    return {
      x: (sx - pan.x) / (SCALE * zoom),
      y: (sy - pan.y) / (SCALE * zoom),
    };
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.91;
    setZoom((z) => Math.max(0.35, Math.min(3.5, Number((z * factor).toFixed(3)))));
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button === 1 || e.altKey || (e.button === 0 && e.shiftKey)) {
      setIsPanning(true);
      setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
      return;
    }
    const rawW = toWorld(e.clientX, e.clientY);
    const snapped = snapPoint(rawW, 0.25);

    if (activeTool === 'sketch_wall' || activeTool === 'sketch_door' || activeTool === 'sketch_window') {
      setActiveStroke([rawW]);
      return;
    }

    if (activeTool === 'wall' || activeTool === 'room_rect') {
      if (!drawStart) {
        setDrawStart(snapped);
      } else {
        if (dist(drawStart, snapped) >= 0.4) {
          const next = structuredClone(project);
          const lvl = next.levels[activeLevelIndex];
          if (activeTool === 'wall') {
            lvl.walls.push({
              id: uid('w'),
              start: drawStart,
              end: snapped,
              thickness: 0.23,
              height: lvl.floorToFloorHeight - lvl.slabThickness,
              isExterior: true,
              isLoadBearing: true,
              material: 'brick',
            });
          } else {
            const x1 = Math.min(drawStart.x, snapped.x);
            const x2 = Math.max(drawStart.x, snapped.x);
            const y1 = Math.min(drawStart.y, snapped.y);
            const y2 = Math.max(drawStart.y, snapped.y);
            const h = lvl.floorToFloorHeight - lvl.slabThickness;
            lvl.walls.push(
              { id: uid('w'), start: { x: x1, y: y1 }, end: { x: x2, y: y1 }, thickness: 0.23, height: h, isExterior: true, isLoadBearing: true, material: 'brick' },
              { id: uid('w'), start: { x: x2, y: y1 }, end: { x: x2, y: y2 }, thickness: 0.23, height: h, isExterior: true, isLoadBearing: true, material: 'brick' },
              { id: uid('w'), start: { x: x2, y: y2 }, end: { x: x1, y: y2 }, thickness: 0.23, height: h, isExterior: true, isLoadBearing: true, material: 'brick' },
              { id: uid('w'), start: { x: x1, y: y2 }, end: { x: x1, y: y1 }, thickness: 0.23, height: h, isExterior: true, isLoadBearing: true, material: 'brick' }
            );
            lvl.rooms.push({
              id: uid('rm'),
              name: `Room ${lvl.rooms.length + 1}`,
              category: 'living',
              polygon: [
                { x: x1, y: y1 },
                { x: x2, y: y1 },
                { x: x2, y: y2 },
                { x: x1, y: y2 },
              ],
              finish: 'porcelain',
              ceilingHeight: 3.0,
            });
          }
          onUpdateProject(next);
        }
        setDrawStart(null);
      }
      return;
    }

    if (activeTool === 'door' || activeTool === 'window') {
      let bestWallId: string | null = null;
      let bestT = 0.5;
      let bestD = Infinity;
      for (const w of level.walls) {
        const proj = projectPointOnSegment(rawW, w.start, w.end);
        if (proj.distance < bestD) {
          bestD = proj.distance;
          bestT = proj.t;
          bestWallId = w.id;
        }
      }
      if (bestWallId && bestD < 0.8) {
        const next = structuredClone(project);
        const lvl = next.levels[activeLevelIndex];
        lvl.openings.push({
          id: uid('op'),
          wallId: bestWallId,
          kind: activeTool,
          style: activeTool === 'door' ? 'single' : 'casement',
          offset: Math.max(0.08, Math.min(0.92, Number(bestT.toFixed(2)))),
          width: activeTool === 'door' ? 0.9 : 1.5,
          height: activeTool === 'door' ? 2.15 : 1.35,
          sillHeight: activeTool === 'door' ? 0 : 0.9,
          swingDirection: 1,
          label: activeTool === 'door' ? 'D1' : 'W1',
        });
        onUpdateProject(next);
      }
      return;
    }

    if (activeTool === 'column') {
      const next = structuredClone(project);
      const lvl = next.levels[activeLevelIndex];
      lvl.columns.push({
        id: uid('col'),
        position: snapped,
        width: 0.3,
        depth: 0.3,
        label: `C${lvl.columns.length + 1}`,
        footingSize: 1.2,
        rebarSpec: '4Ø16 + Ø8@150',
      });
      onUpdateProject(next);
      return;
    }

    if (activeTool === 'measure') {
      if (!drawStart) {
        setDrawStart(snapped);
        setMeasurePts(null);
      } else {
        setMeasurePts({ a: drawStart, b: snapped });
        setDrawStart(null);
      }
      return;
    }

    // Select mode: hit test openings, columns, walls, rooms
    for (const op of level.openings) {
      const w = level.walls.find((x) => x.id === op.wallId);
      if (!w) continue;
      const c = openingWorldCenter(w, op);
      if (dist(rawW, c) < 0.6) {
        onSelect(op.id, 'opening');
        return;
      }
    }
    for (const c of level.columns) {
      if (dist(rawW, c.position) < 0.5) {
        onSelect(c.id, 'column');
        return;
      }
    }
    for (const w of level.walls) {
      const p = projectPointOnSegment(rawW, w.start, w.end);
      if (p.distance < 0.35) {
        onSelect(w.id, 'wall');
        return;
      }
    }
    for (const r of level.rooms) {
      const c = polygonCentroid(r.polygon);
      if (dist(rawW, c) < 1.8) {
        onSelect(r.id, 'room');
        return;
      }
    }
    onSelect(null);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (isPanning) {
      setPan({ x: e.clientX - panStart.x, y: e.clientY - panStart.y });
      return;
    }
    const rawW = toWorld(e.clientX, e.clientY);
    setCursorWorld(snapPoint(rawW, 0.05));
    if (activeStroke) {
      setActiveStroke((prev) => (prev ? [...prev, rawW] : null));
    }
  };

  const handlePointerUp = () => {
    setIsPanning(false);
    if (activeStroke && activeStroke.length >= 2) {
      const kind: SketchStroke['kind'] =
        activeTool === 'sketch_door'
          ? 'door'
          : activeTool === 'sketch_window'
          ? 'window'
          : 'wall';
      onAddSketchStroke({
        id: uid('sk'),
        kind,
        points: activeStroke,
      });
    }
    setActiveStroke(null);
  };

  const isStructural = activeSheet === 'S-101';
  const isMEP = activeSheet === 'M-101';
  const sheetTitle =
    isStructural
      ? 'Foundation & Structural Framing Plan'
      : isMEP
      ? 'MEP Systems Floor Layout (Electrical & Plumbing)'
      : `${level.name} — Architectural Plan`;

  const paperBg = canvasLight ? '#f8fafc' : '#070b14';
  const gridMinor = canvasLight ? '#e2e8f0' : '#1e293b';
  const gridMajor = canvasLight ? '#cbd5e1' : '#283548';
  const gridAxisLine = isStructural ? '#0284c7' : canvasLight ? '#94a3b8' : '#334155';
  const bubbleFill = canvasLight ? '#ffffff' : '#0f172a';
  const bubbleText = canvasLight ? '#0369a1' : '#7dd3fc';
  const wallOuterStroke = canvasLight ? '#0f172a' : '#e2e8f0';
  const wallIntStroke = canvasLight ? '#334155' : '#94a3b8';
  const wallCoreStroke = canvasLight ? '#e2e8f0' : '#0f172a';
  const roomTitleColor = canvasLight ? '#0f172a' : '#e2e8f0';
  const roomSubColor = canvasLight ? '#475569' : '#94a3b8';
  const dimStroke = canvasLight ? '#475569' : '#64748b';
  const dimText = canvasLight ? '#1e293b' : '#cbd5e1';

  const xGridCoords = Array.from(new Set(project.grid.xAxes.map((a) => Number(a.coord.toFixed(2))))).sort((a, b) => a - b);
  const yGridCoords = Array.from(new Set(project.grid.yAxes.map((a) => Number(a.coord.toFixed(2))))).sort((a, b) => a - b);

  const southPierPoints = useMemo(() => {
    const pts = new Set<number>([Number(bb.minX.toFixed(2)), Number(bb.maxX.toFixed(2))]);
    for (const op of level.openings) {
      const w = level.walls.find((x) => x.id === op.wallId);
      if (!w || !w.isExterior) continue;
      const midY = (w.start.y + w.end.y) / 2;
      if (Math.abs(midY - bb.maxY) < 0.8 && Math.abs(w.end.x - w.start.x) > 0.5) {
        const c = openingWorldCenter(w, op);
        pts.add(Number((c.x - op.width / 2).toFixed(2)));
        pts.add(Number((c.x + op.width / 2).toFixed(2)));
      }
    }
    return Array.from(pts).sort((a, b) => a - b);
  }, [level.openings, level.walls, bb.minX, bb.maxX, bb.maxY]);

  const eastPierPoints = useMemo(() => {
    const pts = new Set<number>([Number(bb.minY.toFixed(2)), Number(bb.maxY.toFixed(2))]);
    for (const op of level.openings) {
      const w = level.walls.find((x) => x.id === op.wallId);
      if (!w || !w.isExterior) continue;
      const midX = (w.start.x + w.end.x) / 2;
      if (Math.abs(midX - bb.maxX) < 0.8 && Math.abs(w.end.y - w.start.y) > 0.5) {
        const c = openingWorldCenter(w, op);
        pts.add(Number((c.y - op.width / 2).toFixed(2)));
        pts.add(Number((c.y + op.width / 2).toFixed(2)));
      }
    }
    return Array.from(pts).sort((a, b) => a - b);
  }, [level.openings, level.walls, bb.minY, bb.maxY, bb.maxX]);

  const matchesMepFilter = (sys: string, label?: string) => {
    if (mepFilter === 'all') return true;
    const isHvacOrFire =
      sys === 'electrical_hvac' ||
      sys === 'hvac_refrigerant' ||
      sys === 'hvac_condensate' ||
      label === 'EF' ||
      label === 'SD' ||
      label === 'CF' ||
      (label ? label.startsWith('AC') || label.startsWith('CDU') : false);
    const isSolarItem =
      sys === 'electrical_pv' ||
      label === 'PV-ARRAY' ||
      label === 'HYB-INV' ||
      label === 'BESS' ||
      label === 'MDB-1';
    if (mepFilter === 'solar') return isSolarItem;
    if (mepFilter === 'hvac') return isHvacOrFire;
    if (mepFilter === 'electrical') return sys.startsWith('electrical') && !isHvacOrFire;
    return sys.startsWith('plumbing');
  };

  return (
    <div className={`flex flex-col h-full w-full relative overflow-hidden ${canvasLight ? 'bg-[#f8fafc]' : 'bg-[#070b14]'}`}>
      {/* Top Viewport Overlay Controls */}
      <div className="absolute top-3 left-3 z-10 flex flex-wrap items-center gap-1.5 bg-slate-900/90 backdrop-blur border border-slate-700/80 rounded-lg px-2.5 py-1.5 text-xs shadow-sm">
        <span className="font-mono text-cyan-400 font-semibold">{activeSheet}</span>
        <span className="text-slate-500">|</span>
        <div className="flex items-center bg-slate-800 border border-slate-700 rounded-md overflow-hidden">
          <button
            onClick={() => setZoom((z) => Math.max(0.35, Number((z - 0.15).toFixed(2))))}
            className="px-1.5 py-0.5 hover:bg-slate-700 text-slate-200 border-r border-slate-700"
            title="Zoom Out"
          >
            −
          </button>
          <span className="px-2 py-0.5 font-mono text-[11px] text-slate-300 min-w-[3rem] text-center">
            {Math.round(zoom * 100)}%
          </span>
          <button
            onClick={() => setZoom((z) => Math.min(3.5, Number((z + 0.15).toFixed(2))))}
            className="px-1.5 py-0.5 hover:bg-slate-700 text-slate-200 border-l border-slate-700"
            title="Zoom In"
          >
            +
          </button>
          <button
            onClick={() => {
              setZoom(0.92);
              setPan({ x: 155, y: 135 });
            }}
            className="px-2 py-0.5 hover:bg-slate-700 text-slate-200 border-l border-slate-700 font-medium"
            title="Fit View"
          >
            Fit
          </button>
        </div>
        {isLight && (
          <button
            onClick={() => setCanvasBlueprint((b) => !b)}
            className="px-2 py-0.5 rounded-md bg-slate-800 border border-slate-700 hover:bg-slate-700 text-slate-200 font-medium"
            title="Toggle CAD Canvas Paper / Dark Blueprint"
          >
            {canvasBlueprint ? 'Canvas: Blueprint' : 'Canvas: Paper'}
          </button>
        )}
        <button
          onClick={() => setShowSchedules((s) => !s)}
          className={`px-2 py-0.5 rounded-md font-medium transition ${
            showSchedules ? 'bg-cyan-600 text-white' : 'bg-slate-800 border border-slate-700 hover:bg-slate-700 text-slate-200'
          }`}
          title="Toggle ISO/BS Engineering Schedules Drawer"
        >
          {showSchedules ? 'Hide Schedules' : 'Schedules & Key'}
        </button>
        {isMEP && (
          <div className="flex items-center gap-1.5 pl-1.5 border-l border-slate-700">
            <select
              aria-label="MEP Layer Filter"
              value={mepFilter}
              onChange={(e) => setMepFilter(e.target.value as typeof mepFilter)}
              className="bg-slate-950 border border-slate-700 rounded-md px-2 py-0.5 text-[11px] font-medium text-slate-200 focus:outline-none focus:border-cyan-500 cursor-pointer"
            >
              <option value="all">MEP: All Systems</option>
              <option value="electrical">MEP: Electrical Only</option>
              <option value="plumbing">MEP: Plumbing &amp; Rainwater</option>
              <option value="hvac">MEP: HVAC &amp; Fire Safety</option>
              <option value="solar">MEP: Solar PV &amp; BESS</option>
            </select>
            <button
              onClick={() => {
                const next = structuredClone(project);
                const enabled = !solar.enabled;
                next.solar = { ...solar, enabled };
                next.levels = next.levels.map((l) => autoPopulateMEPForLevel(l, enabled));
                onUpdateProject(next);
              }}
              className={`px-2 py-0.5 rounded-md text-[10px] font-mono ${
                solar.enabled
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                  : 'bg-slate-800 text-slate-400 border border-slate-700'
              }`}
              title="Toggle Rooftop Solar PV & BESS Wiring Overlay"
            >
              PV: {solar.enabled ? 'ON' : 'OFF'}
            </button>
          </div>
        )}
        <span className="text-slate-500 hidden xl:inline">| Hold Shift/Alt + Drag to Pan</span>
      </div>

      {/* Cursor Coordinate Readout */}
      <div className="absolute bottom-14 right-3 z-10 bg-slate-900/85 border border-slate-700/70 rounded px-2.5 py-1 font-mono text-[11px] text-slate-300 shadow-sm">
        X: {cursorWorld.x.toFixed(2)}m &nbsp; Y: {cursorWorld.y.toFixed(2)}m
      </div>

      <svg
        ref={effectiveSvgRef as React.RefObject<SVGSVGElement>}
        className="flex-1 w-full h-full cursor-crosshair"
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <defs>
          <pattern id="cadGridMinor" width={SCALE * zoom * 0.5} height={SCALE * zoom * 0.5} patternUnits="userSpaceOnUse">
            <path
              d={`M ${SCALE * zoom * 0.5} 0 L 0 0 0 ${SCALE * zoom * 0.5}`}
              fill="none"
              stroke={gridMinor}
              strokeWidth="0.6"
            />
          </pattern>
          <pattern id="cadGridMajor" width={SCALE * zoom * 2} height={SCALE * zoom * 2} patternUnits="userSpaceOnUse">
            <rect width={SCALE * zoom * 2} height={SCALE * zoom * 2} fill="url(#cadGridMinor)" />
            <path
              d={`M ${SCALE * zoom * 2} 0 L 0 0 0 ${SCALE * zoom * 2}`}
              fill="none"
              stroke={gridMajor}
              strokeWidth="1"
            />
          </pattern>
          <pattern id="masonryHatch" width="8" height="8" patternTransform="rotate(45 0 0)" patternUnits="userSpaceOnUse">
            <line x1="0" y1="0" x2="0" y2="8" stroke="#94a3b8" strokeWidth="1.5" />
          </pattern>
          <pattern id="footingHatch" width="6" height="6" patternTransform="rotate(-45 0 0)" patternUnits="userSpaceOnUse">
            <line x1="0" y1="0" x2="0" y2="6" stroke="#0284c7" strokeWidth="1" strokeDasharray="2 2" />
          </pattern>
        </defs>

        {/* Infinite CAD Background Grid */}
        <rect width="100%" height="100%" fill="url(#cadGridMajor)" />

        <g transform={`translate(${pan.x}, ${pan.y}) scale(${SCALE * zoom})`}>
          {/* Optional Uploaded Sketch Reference Underlay */}
          {traceImageUrl && (
            <image
              href={traceImageUrl}
              x={-1}
              y={-1}
              width={Math.max(16, bb.width + 2)}
              height={Math.max(13, bb.depth + 2)}
              opacity={traceOpacity}
              preserveAspectRatio="xMidYMid meet"
            />
          )}

          {/* Plot Boundary Line */}
          <rect
            x={-2}
            y={-2}
            width={Math.max(project.meta.plotWidth, bb.width + 4)}
            height={Math.max(project.meta.plotDepth, bb.depth + 4)}
            fill="none"
            stroke={canvasLight ? '#94a3b8' : '#334155'}
            strokeWidth={0.05}
            strokeDasharray="0.4 0.25"
          />

          {/* Structural Grid Axes & Bubbles */}
          {project.grid.xAxes.map((ax) => (
            <g key={`gx_${ax.label}`}>
              <line
                x1={ax.coord}
                y1={bb.minY - 1.65}
                x2={ax.coord}
                y2={bb.maxY + 1.65}
                stroke={gridAxisLine}
                strokeWidth={0.025}
                strokeDasharray="0.3 0.15 0.06 0.15"
              />
              <circle cx={ax.coord} cy={bb.minY - 1.98} r={0.3} fill={bubbleFill} stroke="#0284c7" strokeWidth={0.04} />
              <text
                x={ax.coord}
                y={bb.minY - 1.88}
                textAnchor="middle"
                fill={bubbleText}
                fontSize={0.3}
                fontFamily="monospace"
                fontWeight="bold"
              >
                {ax.label}
              </text>
            </g>
          ))}
          {project.grid.yAxes.map((ax) => (
            <g key={`gy_${ax.label}`}>
              <line
                x1={bb.minX - 1.65}
                y1={ax.coord}
                x2={bb.maxX + 1.65}
                y2={ax.coord}
                stroke={gridAxisLine}
                strokeWidth={0.025}
                strokeDasharray="0.3 0.15 0.06 0.15"
              />
              <circle cx={bb.minX - 1.98} cy={ax.coord} r={0.3} fill={bubbleFill} stroke="#0284c7" strokeWidth={0.04} />
              <text
                x={bb.minX - 1.98}
                y={ax.coord + 0.1}
                textAnchor="middle"
                fill={bubbleText}
                fontSize={0.3}
                fontFamily="monospace"
                fontWeight="bold"
              >
                {ax.label}
              </text>
            </g>
          ))}

          {/* Rooms Layer (Polygons & Slab Span Overlay) */}
          {level.rooms.map((r, rIdx) => {
            const pts = r.polygon.map((p) => `${p.x},${p.y}`).join(' ');
            const c = polygonCentroid(r.polygon);
            const isSel = selectedId === r.id;
            return (
              <g key={r.id}>
                <polygon
                  points={pts}
                  fill={isStructural || isMEP ? (canvasLight ? '#f1f5f9' : '#0f172a') : getRoomFloorColor(r, canvasLight)}
                  fillOpacity={isStructural || isMEP ? 0.5 : 0.78}
                  stroke={isSel ? '#0284c7' : 'none'}
                  strokeWidth={0.06}
                />
                {/* Structural Two-Way Slab Span Diagonals & Rebar Tag */}
                {isStructural && r.polygon.length === 4 && (
                  <g stroke="#0284c7" strokeWidth={0.025} strokeDasharray="0.2 0.15" opacity={0.75}>
                    <line x1={r.polygon[0].x} y1={r.polygon[0].y} x2={r.polygon[2].x} y2={r.polygon[2].y} />
                    <line x1={r.polygon[1].x} y1={r.polygon[1].y} x2={r.polygon[3].x} y2={r.polygon[3].y} />
                    <text x={c.x} y={c.y + 0.52} textAnchor="middle" fill={canvasLight ? '#0369a1' : '#38bdf8'} fontSize={0.2} fontFamily="monospace" fontWeight="bold" stroke="none">
                      S{rIdx + 1}: {Math.round(level.slabThickness * 1000)}mm · Ø10@150 B1/B2
                    </text>
                  </g>
                )}
              </g>
            );
          })}

          {/* Architectural Sanitaryware & Furniture Symbols (Architectural mode only) */}
          {!isStructural &&
            !isMEP &&
            level.furniture.map((f) => {
              const strokeCol = canvasLight ? '#475569' : '#64748b';
              const fillCol = canvasLight ? '#e2e8f0' : '#334155';
              return (
                <g
                  key={f.id}
                  transform={`translate(${f.position.x}, ${f.position.y}) rotate(${f.rotation})`}
                  opacity={0.85}
                >
                  <rect
                    x={-f.width / 2}
                    y={-f.depth / 2}
                    width={f.width}
                    height={f.depth}
                    rx={f.type === 'wc' || f.type === 'sink' ? 0.14 : 0.06}
                    fill={fillCol}
                    fillOpacity={0.38}
                    stroke={strokeCol}
                    strokeWidth={0.03}
                  />
                  {f.type.includes('bed') && (
                    <>
                      <rect x={-f.width / 2 + 0.08} y={-f.depth / 2 + 0.08} width={f.width / 2 - 0.12} height={0.34} fill={canvasLight ? '#94a3b8' : '#475569'} rx={0.04} />
                      <rect x={0.04} y={-f.depth / 2 + 0.08} width={f.width / 2 - 0.12} height={0.34} fill={canvasLight ? '#94a3b8' : '#475569'} rx={0.04} />
                      <line x1={-f.width / 2} y1={-0.1} x2={f.width / 2} y2={-0.1} stroke={strokeCol} strokeWidth={0.025} />
                    </>
                  )}
                  {f.type === 'wc' && (
                    <>
                      <rect x={-f.width / 2 + 0.04} y={-f.depth / 2 + 0.03} width={f.width - 0.08} height={0.16} fill={canvasLight ? '#cbd5e1' : '#475569'} stroke={strokeCol} strokeWidth={0.02} />
                      <ellipse cx={0} cy={0.08} rx={f.width * 0.34} ry={f.depth * 0.28} fill="none" stroke={strokeCol} strokeWidth={0.025} />
                    </>
                  )}
                  {f.type === 'sink' && (
                    <ellipse cx={0} cy={0} rx={f.width * 0.36} ry={f.depth * 0.32} fill="none" stroke={strokeCol} strokeWidth={0.025} />
                  )}
                  {f.type === 'shower' && (
                    <>
                      <line x1={-f.width / 2} y1={-f.depth / 2} x2={f.width / 2} y2={f.depth / 2} stroke={strokeCol} strokeWidth={0.02} />
                      <line x1={f.width / 2} y1={-f.depth / 2} x2={-f.width / 2} y2={f.depth / 2} stroke={strokeCol} strokeWidth={0.02} />
                      <circle cx={0} cy={0} r={0.06} fill={strokeCol} />
                    </>
                  )}
                  {f.type === 'kitchen_counter' && (
                    <>
                      <rect x={-f.width * 0.35} y={-f.depth * 0.25} width={0.45} height={f.depth * 0.5} fill="none" stroke={strokeCol} strokeWidth={0.02} />
                      <rect x={0.05} y={-f.depth * 0.25} width={0.45} height={f.depth * 0.5} fill="none" stroke={strokeCol} strokeWidth={0.02} />
                      <circle cx={-f.width * 0.12} cy={0} r={0.04} fill={strokeCol} />
                    </>
                  )}
                  {f.type === 'sofa' && (
                    <rect x={-f.width / 2 + 0.06} y={-f.depth / 2 + 0.05} width={f.width - 0.12} height={0.18} fill={canvasLight ? '#94a3b8' : '#475569'} rx={0.03} />
                  )}
                  {f.type === 'car' && (
                    <rect x={-f.width * 0.38} y={-f.depth * 0.22} width={f.width * 0.76} height={f.depth * 0.44} rx={0.1} fill="none" stroke={strokeCol} strokeWidth={0.025} />
                  )}
                </g>
              );
            })}

          {/* Room Stamp Callout Layer (rendered above furniture for crisp legibility) */}
          {level.rooms.map((r, rIdx) => {
            const c = polygonCentroid(r.polygon);
            const area = polygonArea(r.polygon);
            const roomCode = `RM-${level.index + 1}${String(rIdx + 1).padStart(2, '0')}`;
            return (
              <g key={`rm_stamp_${r.id}`} pointerEvents="none">
                {!isStructural && !isMEP ? (
                  <g>
                    <rect
                      x={c.x - 1.38}
                      y={c.y - 0.5}
                      width={2.76}
                      height={1.06}
                      rx={0.08}
                      fill={canvasLight ? '#ffffff' : '#0f172a'}
                      fillOpacity={0.92}
                      stroke={canvasLight ? '#cbd5e1' : '#334155'}
                      strokeWidth={0.025}
                    />
                    <text x={c.x} y={c.y - 0.28} textAnchor="middle" fill={canvasLight ? '#0369a1' : '#38bdf8'} fontSize={0.17} fontFamily="monospace" fontWeight="bold">
                      {roomCode}
                    </text>
                    <text x={c.x} y={c.y - 0.01} textAnchor="middle" fill={roomTitleColor} fontSize={0.25} fontWeight="700" fontFamily="sans-serif">
                      {r.name}
                    </text>
                    <text x={c.x} y={c.y + 0.23} textAnchor="middle" fill={roomSubColor} fontSize={0.17} fontFamily="monospace">
                      {area.toFixed(1)} m² · FFL +{level.elevation.toFixed(2)}m
                    </text>
                    <text x={c.x} y={c.y + 0.43} textAnchor="middle" fill={roomSubColor} fontSize={0.15} fontFamily="monospace">
                      {r.finish.replace('_', ' ')} · CH {r.ceilingHeight.toFixed(1)}m
                    </text>
                  </g>
                ) : (
                  <>
                    <text x={c.x} y={c.y - 0.08} textAnchor="middle" fill={roomTitleColor} fontSize={0.28} fontWeight="600" fontFamily="sans-serif">
                      {r.name}
                    </text>
                    <text x={c.x} y={c.y + 0.2} textAnchor="middle" fill={roomSubColor} fontSize={0.19} fontFamily="monospace">
                      {roomCode} · {area.toFixed(1)} m²
                    </text>
                  </>
                )}
              </g>
            );
          })}

          {/* Staircases */}
          {level.stairs.map((st) => (
            <g key={st.id} transform={`translate(${st.origin.x}, ${st.origin.y})`}>
              <rect width={st.width} height={st.length} fill={canvasLight ? '#e2e8f0' : '#1e293b'} stroke={canvasLight ? '#334155' : '#94a3b8'} strokeWidth={0.04} />
              {Array.from({ length: 9 }).map((_, idx) => {
                const y = (idx / 9) * st.length;
                return <line key={idx} x1={0} y1={y} x2={st.width} y2={y} stroke="#64748b" strokeWidth={0.025} />;
              })}
              <line x1={st.width / 2} y1={st.length - 0.2} x2={st.width / 2} y2={0.2} stroke="#0284c7" strokeWidth={0.04} />
              <polygon points={`${st.width / 2 - 0.12},0.38 ${st.width / 2 + 0.12},0.38 ${st.width / 2},0.16`} fill="#0284c7" />
              <text x={st.width / 2} y={st.length / 2} textAnchor="middle" fill="#0369a1" fontSize={0.22} fontFamily="monospace" fontWeight="bold">
                UP {st.risers}R
              </text>
            </g>
          ))}

          {/* Structural Footings & Plinth/Floor Beams (Structural mode) */}
          {isStructural && (
            <>
              {level.walls
                .filter((w) => w.isLoadBearing || w.isExterior)
                .map((w, bIdx) => {
                  const beamMark = level.index === 0 ? 'PB-1' : 'FB-1';
                  const beamDim = level.index === 0 ? '230×350' : '230×400';
                  const mx = (w.start.x + w.end.x) / 2;
                  const my = (w.start.y + w.end.y) / 2;
                  const len = wallLength(w);
                  return (
                    <g key={`bm_${w.id}`}>
                      <line
                        x1={w.start.x}
                        y1={w.start.y}
                        x2={w.end.x}
                        y2={w.end.y}
                        stroke="#0284c7"
                        strokeWidth={0.28}
                        strokeOpacity={0.28}
                      />
                      <line
                        x1={w.start.x}
                        y1={w.start.y}
                        x2={w.end.x}
                        y2={w.end.y}
                        stroke="#0369a1"
                        strokeWidth={0.025}
                        strokeDasharray="0.3 0.1 0.05 0.1"
                      />
                      {len >= 2.2 && bIdx % 2 === 0 && (
                        <text
                          x={mx}
                          y={my - 0.18}
                          textAnchor="middle"
                          fill={canvasLight ? '#0369a1' : '#38bdf8'}
                          fontSize={0.18}
                          fontFamily="monospace"
                          fontWeight="bold"
                        >
                          {beamMark} ({beamDim})
                        </text>
                      )}
                    </g>
                  );
                })}
              {level.columns.map((c) => {
                const pccSize = c.footingSize + 0.2;
                return (
                  <g key={`ft_${c.id}`}>
                    {/* 100mm PCC Lean Concrete Blinding Perimeter */}
                    <rect
                      x={c.position.x - pccSize / 2}
                      y={c.position.y - pccSize / 2}
                      width={pccSize}
                      height={pccSize}
                      fill="none"
                      stroke={canvasLight ? '#64748b' : '#475569'}
                      strokeWidth={0.025}
                      strokeDasharray="0.08 0.06"
                    />
                    <rect
                      x={c.position.x - c.footingSize / 2}
                      y={c.position.y - c.footingSize / 2}
                      width={c.footingSize}
                      height={c.footingSize}
                      fill="url(#footingHatch)"
                      stroke="#0284c7"
                      strokeWidth={0.04}
                      strokeDasharray="0.12 0.08"
                    />
                    <text
                      x={c.position.x - c.footingSize / 2 + 0.06}
                      y={c.position.y + c.footingSize / 2 - 0.08}
                      fill={canvasLight ? '#0369a1' : '#7dd3fc'}
                      fontSize={0.17}
                      fontFamily="monospace"
                    >
                      F-{c.label} {Math.round(c.footingSize * 1000)}² · Ø12@150
                    </text>
                  </g>
                );
              })}
            </>
          )}

          {/* Walls Layer */}
          {level.walls.map((w) => {
            const isSel = selectedId === w.id;
            const len = wallLength(w);
            const midX = (w.start.x + w.end.x) / 2;
            const midY = (w.start.y + w.end.y) / 2;
            return (
              <g key={w.id}>
                <line
                  x1={w.start.x}
                  y1={w.start.y}
                  x2={w.end.x}
                  y2={w.end.y}
                  stroke={isSel ? '#0284c7' : w.isExterior ? wallOuterStroke : wallIntStroke}
                  strokeWidth={w.thickness}
                  strokeLinecap="square"
                  opacity={isMEP || isStructural ? 0.45 : 0.95}
                />
                {!isMEP && !isStructural && (
                  <line
                    x1={w.start.x}
                    y1={w.start.y}
                    x2={w.end.x}
                    y2={w.end.y}
                    stroke={wallCoreStroke}
                    strokeWidth={Math.max(0.03, w.thickness - 0.07)}
                    strokeLinecap="butt"
                  />
                )}
                {isSel && (
                  <text
                    x={midX}
                    y={midY - 0.25}
                    textAnchor="middle"
                    fill="#0284c7"
                    fontSize={0.26}
                    fontFamily="monospace"
                  >
                    {len.toFixed(2)}m ({Math.round(w.thickness * 1000)}mm)
                  </text>
                )}
              </g>
            );
          })}

          {/* Doors & Windows + Standard Opening Marks (D1, W1...) */}
          {level.openings.map((op) => {
            const wall = level.walls.find((w) => w.id === op.wallId);
            if (!wall) return null;
            const c = openingWorldCenter(wall, op);
            const rad = wallAngleRad(wall);
            const deg = (rad * 180) / Math.PI;
            const isSel = selectedId === op.id;
            const mark = openingMarks.get(op.id) ?? (op.kind === 'door' ? 'D1' : 'W1');
            const tagDist = op.kind === 'door' ? -0.35 * op.swingDirection : 0.42;
            const tagX = c.x + Math.sin(rad) * tagDist;
            const tagY = c.y - Math.cos(rad) * tagDist;

            return (
              <g key={op.id}>
                <g transform={`translate(${c.x}, ${c.y}) rotate(${deg})`}>
                  {/* Clear wall gap */}
                  <rect
                    x={-op.width / 2}
                    y={-wall.thickness / 2 - 0.02}
                    width={op.width}
                    height={wall.thickness + 0.04}
                    fill={paperBg}
                  />
                  {op.kind === 'door' ? (
                    <g stroke={isSel ? '#0284c7' : canvasLight ? '#b45309' : '#f59e0b'} strokeWidth={0.04} fill="none">
                      {op.style === 'garage' ? (
                        <>
                          <rect
                            x={-op.width / 2}
                            y={-0.06}
                            width={op.width}
                            height={0.12}
                            fill="#f59e0b"
                            fillOpacity={0.25}
                          />
                          <line x1={-op.width / 2} y1={0} x2={op.width / 2} y2={0} strokeDasharray="0.15 0.1" />
                        </>
                      ) : op.style === 'double' ? (
                        <>
                          <line x1={-op.width / 2} y1={0} x2={-op.width / 2} y2={op.swingDirection * (op.width / 2)} />
                          <path
                            d={`M ${-op.width / 2} ${op.swingDirection * (op.width / 2)} A ${op.width / 2} ${op.width / 2} 0 0 ${op.swingDirection > 0 ? 1 : 0} 0 0`}
                            strokeDasharray="0.08 0.06"
                          />
                          <line x1={op.width / 2} y1={0} x2={op.width / 2} y2={op.swingDirection * (op.width / 2)} />
                          <path
                            d={`M ${op.width / 2} ${op.swingDirection * (op.width / 2)} A ${op.width / 2} ${op.width / 2} 0 0 ${op.swingDirection > 0 ? 0 : 1} 0 0`}
                            strokeDasharray="0.08 0.06"
                          />
                        </>
                      ) : (
                        <>
                          <line x1={-op.width / 2} y1={0} x2={-op.width / 2} y2={op.swingDirection * op.width} strokeWidth={0.055} />
                          <path
                            d={`M ${-op.width / 2} ${op.swingDirection * op.width} A ${op.width} ${op.width} 0 0 ${op.swingDirection > 0 ? 1 : 0} ${op.width / 2} 0`}
                            strokeDasharray="0.08 0.06"
                          />
                        </>
                      )}
                    </g>
                  ) : (
                    <g stroke={isSel ? '#0284c7' : canvasLight ? '#0284c7' : '#38bdf8'} strokeWidth={0.035}>
                      <rect
                        x={-op.width / 2}
                        y={-wall.thickness / 2}
                        width={op.width}
                        height={wall.thickness}
                        fill={canvasLight ? '#bae6fd' : '#0c4a6e'}
                        fillOpacity={0.65}
                      />
                      <line x1={-op.width / 2} y1={0} x2={op.width / 2} y2={0} stroke={canvasLight ? '#0369a1' : '#7dd3fc'} strokeWidth={0.04} />
                    </g>
                  )}
                </g>

                {/* Standard Upright Door/Window Callout Tag */}
                {!isStructural && (
                  <g transform={`translate(${tagX}, ${tagY})`}>
                    {op.kind === 'door' ? (
                      <circle
                        r={0.21}
                        fill={canvasLight ? '#fef3c7' : '#451a03'}
                        stroke={canvasLight ? '#b45309' : '#f59e0b'}
                        strokeWidth={0.03}
                      />
                    ) : (
                      <rect
                        x={-0.24}
                        y={-0.16}
                        width={0.48}
                        height={0.32}
                        rx={0.07}
                        fill={canvasLight ? '#e0f2fe' : '#082f49'}
                        stroke={canvasLight ? '#0284c7' : '#38bdf8'}
                        strokeWidth={0.03}
                      />
                    )}
                    <text
                      y={0.065}
                      textAnchor="middle"
                      fill={op.kind === 'door' ? (canvasLight ? '#92400e' : '#fcd34d') : (canvasLight ? '#0369a1' : '#7dd3fc')}
                      fontSize={0.18}
                      fontFamily="monospace"
                      fontWeight="bold"
                    >
                      {mark}
                    </text>
                  </g>
                )}
              </g>
            );
          })}

          {/* Structural Columns */}
          {level.columns.map((col) => {
            const isSel = selectedId === col.id;
            return (
              <g key={col.id}>
                <rect
                  x={col.position.x - col.width / 2}
                  y={col.position.y - col.depth / 2}
                  width={col.width}
                  height={col.depth}
                  fill={isStructural ? '#0284c7' : canvasLight ? '#0f172a' : '#e2e8f0'}
                  stroke={isSel ? '#f43f5e' : canvasLight ? '#ffffff' : '#0f172a'}
                  strokeWidth={0.03}
                />
                {isStructural && (
                  <text
                    x={col.position.x + col.width / 2 + 0.08}
                    y={col.position.y - col.depth / 2}
                    fill={canvasLight ? '#0369a1' : '#bae6fd'}
                    fontSize={0.2}
                    fontFamily="monospace"
                    fontWeight="bold"
                  >
                    {col.label} ({Math.round(col.width * 1000)}²)
                  </text>
                )}
              </g>
            );
          })}

          {/* Standard Coordinated MEP, Fire & Stormwater Overlay (M-101) */}
          {isMEP && (
            <>
              {level.mepCircuits
                .filter((ckt) => (solar.enabled || ckt.system !== 'electrical_pv') && matchesMepFilter(ckt.system))
                .map((ckt) => {
                  const color =
                    ckt.system === 'electrical_light'
                      ? '#d97706'
                      : ckt.system === 'electrical_power'
                      ? '#ea580c'
                      : ckt.system === 'electrical_hvac'
                      ? '#9333ea'
                      : ckt.system === 'hvac_refrigerant'
                      ? '#7e22ce'
                      : ckt.system === 'hvac_condensate'
                      ? '#0d9488'
                      : ckt.system === 'electrical_pv'
                      ? '#16a34a'
                      : ckt.system === 'plumbing_cold'
                      ? '#0284c7'
                      : '#16a34a';
                  const d = ckt.points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
                  return (
                    <path
                      key={ckt.id}
                      d={d}
                      fill="none"
                      stroke={color}
                      strokeWidth={ckt.system === 'electrical_pv' || ckt.system === 'hvac_refrigerant' ? 0.065 : 0.055}
                      strokeDasharray={
                        ckt.system === 'hvac_condensate'
                          ? '0.09 0.08'
                          : ckt.system.startsWith('electrical') || ckt.system === 'hvac_refrigerant'
                          ? '0.18 0.1'
                          : undefined
                      }
                    />
                  );
                })}

              {/* Rooftop Solar PV Array & DC/AC String Wiring Plan (IEC 62446) */}
              {solar.enabled &&
                level.walls.length > 0 &&
                (mepFilter === 'all' || mepFilter === 'electrical' || mepFilter === 'solar') && (() => {
                  const cols = Math.min(8, Math.max(4, Math.ceil(solar.panelCount / 2)));
                  const pw = 0.72;
                  const ph = 1.05;
                  const gap = 0.08;
                  const totalW = cols * (pw + gap);
                  const arrX = Math.max(bb.minX + 1.5, bb.maxX - totalW - 0.8);
                  const arrY = bb.minY + 0.85;
                  const arrayKwp = ((solar.panelCount * solar.panelWattage) / 1000).toFixed(2);
                  const dcIsoX = arrX - 0.55;
                  const dcIsoY = arrY + 0.5;
                  const invX = bb.minX + 1.25;
                  const invY = bb.minY + 0.52;
                  const bessX = bb.minX + 2.15;
                  const bessY = bb.minY + 0.52;
                  return (
                    <g>
                      {/* PV Array Dotted Roof Mounting Boundary */}
                      <rect
                        x={arrX - 0.18}
                        y={arrY - 0.34}
                        width={totalW + 0.28}
                        height={(Math.ceil(solar.panelCount / cols) * (ph + gap)) + 0.44}
                        rx={0.08}
                        fill={canvasLight ? '#ecfdf5' : '#064e3b'}
                        fillOpacity={0.35}
                        stroke="#16a34a"
                        strokeWidth={0.035}
                        strokeDasharray="0.16 0.1"
                      />
                      <text
                        x={arrX}
                        y={arrY - 0.12}
                        fill={canvasLight ? '#15803d' : '#6ee7b7'}
                        fontSize={0.18}
                        fontFamily="monospace"
                        fontWeight="bold"
                      >
                        PV ARRAY: {solar.panelCount}×{solar.panelWattage}Wp ({arrayKwp}kWp) · 2×6mm² H1Z2Z2-K DC
                      </text>
                      {Array.from({ length: solar.panelCount }).map((_, idx) => {
                        const r = Math.floor(idx / cols);
                        const c = idx % cols;
                        const px = arrX + c * (pw + gap);
                        const py = arrY + r * (ph + gap);
                        return (
                          <g key={`pv_p_${idx}`}>
                            <rect
                              x={px}
                              y={py}
                              width={pw}
                              height={ph}
                              fill={canvasLight ? '#1e3a8a' : '#172554'}
                              fillOpacity={0.86}
                              stroke="#93c5fd"
                              strokeWidth={0.025}
                            />
                            <line x1={px + pw / 2} y1={py} x2={px + pw / 2} y2={py + ph} stroke="#60a5fa" strokeWidth={0.015} opacity={0.7} />
                            <line x1={px} y1={py + ph / 2} x2={px + pw} y2={py + ph / 2} stroke="#60a5fa" strokeWidth={0.015} opacity={0.7} />
                          </g>
                        );
                      })}
                      {/* DC String Wire -> DC Isolator -> Hybrid Inverter -> BESS & MDB */}
                      <polyline
                        points={`${arrX},${arrY + 0.5} ${dcIsoX},${dcIsoY} ${invX},${invY}`}
                        fill="none"
                        stroke="#e11d48"
                        strokeWidth={0.055}
                        strokeDasharray="0.16 0.08"
                      />
                      <rect x={dcIsoX - 0.16} y={dcIsoY - 0.14} width={0.32} height={0.28} rx={0.04} fill="#fef3c7" stroke="#d97706" strokeWidth={0.03} />
                      <text x={dcIsoX} y={dcIsoY + 0.05} textAnchor="middle" fill="#92400e" fontSize={0.11} fontFamily="monospace" fontWeight="bold">
                        DC
                      </text>
                      {solar.batteryKWh > 0 && (
                        <>
                          <line x1={invX} y1={invY} x2={bessX} y2={bessY} stroke="#7c3aed" strokeWidth={0.05} strokeDasharray="0.1 0.08" />
                          <rect x={bessX - 0.22} y={bessY - 0.15} width={0.44} height={0.3} rx={0.04} fill={canvasLight ? '#f3e8ff' : '#3b0764'} stroke="#7c3aed" strokeWidth={0.035} />
                          <text x={bessX} y={bessY + 0.05} textAnchor="middle" fill={canvasLight ? '#6b21a8' : '#e9d5ff'} fontSize={0.13} fontFamily="monospace" fontWeight="bold">
                            BESS
                          </text>
                        </>
                      )}
                      <line x1={invX} y1={invY} x2={bb.minX + 0.5} y2={bb.minY + 0.5} stroke="#16a34a" strokeWidth={0.055} />
                      <rect x={invX - 0.22} y={invY - 0.15} width={0.44} height={0.3} rx={0.04} fill={canvasLight ? '#e0f2fe' : '#0c4a6e'} stroke="#0284c7" strokeWidth={0.035} />
                      <text x={invX} y={invY + 0.05} textAnchor="middle" fill={canvasLight ? '#0369a1' : '#bae6fd'} fontSize={0.13} fontFamily="monospace" fontWeight="bold">
                        INV
                      </text>
                    </g>
                  );
                })()}

              {/* Sanitary Inspection Chambers & External Drainage Run (IPC / EN 12056) */}
              {(mepFilter === 'all' || mepFilter === 'plumbing') && level.walls.length > 0 && (
                <g>
                  <line
                    x1={bb.minX + 0.4}
                    y1={bb.maxY - 0.6}
                    x2={bb.minX - 1.1}
                    y2={bb.maxY + 0.4}
                    stroke="#16a34a"
                    strokeWidth={0.06}
                  />
                  <line
                    x1={bb.minX - 1.1}
                    y1={bb.maxY + 0.4}
                    x2={bb.maxX + 1.1}
                    y2={bb.maxY + 0.4}
                    stroke="#16a34a"
                    strokeWidth={0.06}
                    strokeDasharray="0.25 0.1"
                  />
                  <text
                    x={(bb.minX + bb.maxX) / 2}
                    y={bb.maxY + 0.3}
                    textAnchor="middle"
                    fill="#15803d"
                    fontSize={0.18}
                    fontFamily="monospace"
                    fontWeight="bold"
                  >
                    Ø110mm uPVC SOIL SEWER @ 1:60 → MH-MAIN →
                  </text>
                  {[
                    { id: 'IC-1', x: bb.minX - 1.1, y: bb.maxY + 0.4 },
                    { id: 'IC-2', x: (bb.minX + bb.maxX) / 2, y: bb.maxY + 0.4 },
                    { id: 'MH-1', x: bb.maxX + 1.1, y: bb.maxY + 0.4 },
                  ].map((ic) => (
                    <g key={ic.id} transform={`translate(${ic.x}, ${ic.y})`}>
                      <rect x={-0.25} y={-0.25} width={0.5} height={0.5} fill={canvasLight ? '#dcfce7' : '#14532d'} stroke="#16a34a" strokeWidth={0.04} />
                      <line x1={-0.25} y1={-0.25} x2={0.25} y2={0.25} stroke="#16a34a" strokeWidth={0.025} />
                      <text y={0.44} textAnchor="middle" fill={canvasLight ? '#15803d' : '#86efac'} fontSize={0.18} fontFamily="monospace" fontWeight="bold">
                        {ic.id}
                      </text>
                    </g>
                  ))}
                  {/* Roof Rainwater Downpipes (RWP Ø100) at building corners */}
                  {[
                    { x: bb.minX - 0.15, y: bb.minY - 0.15 },
                    { x: bb.maxX + 0.15, y: bb.minY - 0.15 },
                    { x: bb.minX - 0.15, y: bb.maxY + 0.15 },
                    { x: bb.maxX + 0.15, y: bb.maxY + 0.15 },
                  ].map((rwp, idx) => (
                    <g key={`rwp_${idx}`} transform={`translate(${rwp.x}, ${rwp.y})`}>
                      <circle r={0.12} fill="#0284c7" stroke="#ffffff" strokeWidth={0.025} />
                      <text x={0.18} y={0.06} fill="#0369a1" fontSize={0.15} fontFamily="monospace">
                        RWP
                      </text>
                    </g>
                  ))}
                </g>
              )}

              {/* Standard IEC 60617 / NFPA 72 / IPC Point Symbols */}
              {level.mepNodes
                .filter(
                  (n) =>
                    !n.kind.startsWith('solar_') &&
                    matchesMepFilter(n.system === 'electrical' ? 'electrical_' : 'plumbing_', n.label)
                )
                .map((n) => {
                  const isSD = n.label === 'SD';
                  const isEF = n.label === 'EF';
                  return (
                    <g key={n.id} transform={`translate(${n.position.x}, ${n.position.y})`}>
                      {n.kind === 'mdb' ? (
                        <g>
                          <rect x={-0.28} y={-0.16} width={0.56} height={0.32} fill={canvasLight ? '#fef3c7' : '#451a03'} stroke="#d97706" strokeWidth={0.045} />
                          <polygon points="-0.28,-0.16 0.28,0.16 -0.28,0.16" fill="#d97706" />
                        </g>
                      ) : isSD ? (
                        <g>
                          <circle r={0.16} fill={canvasLight ? '#ffe4e6' : '#4c0519'} stroke="#e11d48" strokeWidth={0.035} />
                          <text y={0.06} textAnchor="middle" fill="#be123c" fontSize={0.16} fontFamily="monospace" fontWeight="bold">
                            SD
                          </text>
                        </g>
                      ) : isEF ? (
                        <g>
                          <circle r={0.16} fill={canvasLight ? '#f3e8ff' : '#3b0764'} stroke="#9333ea" strokeWidth={0.035} />
                          <text y={0.06} textAnchor="middle" fill="#7e22ce" fontSize={0.16} fontFamily="monospace" fontWeight="bold">
                            EF
                          </text>
                        </g>
                      ) : n.kind === 'light_ceiling' ? (
                        <g stroke="#d97706" strokeWidth={0.035}>
                          <circle r={0.16} fill={canvasLight ? '#fef9c3' : '#422006'} />
                          <line x1={-0.11} y1={-0.11} x2={0.11} y2={0.11} />
                          <line x1={-0.11} y1={0.11} x2={0.11} y2={-0.11} />
                        </g>
                      ) : n.kind === 'switch_1g' ? (
                        <g stroke="#d97706" strokeWidth={0.035} fill="none">
                          <circle r={0.09} fill={canvasLight ? '#fef3c7' : '#422006'} />
                          <line x1={0.06} y1={-0.06} x2={0.22} y2={-0.22} />
                          <line x1={0.22} y1={-0.22} x2={0.28} y2={-0.14} />
                        </g>
                      ) : n.kind === 'outlet_duplex' ? (
                        <g stroke="#ea580c" strokeWidth={0.035} fill="none">
                          <path d="M -0.14 0.04 A 0.14 0.14 0 0 1 0.14 0.04 Z" fill={canvasLight ? '#ffedd5' : '#431407'} />
                          <line x1={-0.05} y1={0.04} x2={-0.05} y2={0.16} />
                          <line x1={0.05} y1={0.04} x2={0.05} y2={0.16} />
                        </g>
                      ) : n.kind === 'ac_split' ? (
                        <g>
                          <rect x={-0.38} y={-0.11} width={0.76} height={0.22} rx={0.03} fill={canvasLight ? '#f3e8ff' : '#3b0764'} stroke="#9333ea" strokeWidth={0.035} />
                          <line x1={-0.28} y1={0.04} x2={0.28} y2={0.04} stroke="#9333ea" strokeWidth={0.025} />
                        </g>
                      ) : n.kind === 'ac_condenser' ? (
                        <g>
                          <rect x={-0.32} y={-0.22} width={0.64} height={0.44} rx={0.04} fill={canvasLight ? '#e0f2fe' : '#082f49'} stroke="#0284c7" strokeWidth={0.04} />
                          <circle cx={-0.06} cy={0} r={0.14} fill="none" stroke="#9333ea" strokeWidth={0.03} />
                          <line x1={-0.16} y1={-0.1} x2={0.04} y2={0.1} stroke="#9333ea" strokeWidth={0.025} />
                          <line x1={0.04} y1={-0.1} x2={-0.16} y2={0.1} stroke="#9333ea" strokeWidth={0.025} />
                          <rect x={0.14} y={-0.15} width={0.1} height={0.3} fill="#0284c7" />
                        </g>
                      ) : n.kind === 'ceiling_fan' ? (
                        <g stroke="#0d9488" strokeWidth={0.035}>
                          <circle r={0.08} fill={canvasLight ? '#ccfbf1' : '#134e4a'} />
                          <line x1={-0.32} y1={0} x2={0.32} y2={0} />
                          <line x1={0} y1={-0.32} x2={0} y2={0.32} />
                        </g>
                      ) : n.kind === 'water_main' ? (
                        <g stroke="#0284c7" strokeWidth={0.035}>
                          <polygon points="-0.16,-0.12 -0.16,0.12 0,0" fill="#bae6fd" />
                          <polygon points="0.16,-0.12 0.16,0.12 0,0" fill="#bae6fd" />
                        </g>
                      ) : (
                        <circle
                          r={0.15}
                          fill={canvasLight ? (n.system === 'electrical' ? '#fef3c7' : '#e0f2fe') : '#082f49'}
                          stroke={n.system === 'electrical' ? '#d97706' : '#0284c7'}
                          strokeWidth={0.04}
                        />
                      )}
                      {n.label && !isSD && !isEF && (
                        <text
                          y={n.kind === 'ceiling_fan' ? -0.42 : n.kind === 'ac_condenser' ? -0.32 : -0.23}
                          textAnchor="middle"
                          fill={
                            n.kind === 'ac_split' || n.kind === 'ac_condenser'
                              ? '#7e22ce'
                              : n.kind === 'ceiling_fan'
                              ? '#0f766e'
                              : canvasLight
                              ? n.system === 'electrical'
                                ? '#92400e'
                                : '#0369a1'
                              : '#fde047'
                          }
                          fontSize={0.18}
                          fontFamily="monospace"
                          fontWeight="bold"
                        >
                          {n.label}
                        </text>
                      )}
                    </g>
                  );
                })}

              {/* On-Canvas IEC 60617 & IPC Legend Box */}
              <g transform={`translate(${bb.maxX + 2.3}, ${bb.minY})`}>
                <rect width={4.2} height={6.55} rx={0.12} fill={canvasLight ? '#ffffff' : '#0f172a'} stroke={canvasLight ? '#cbd5e1' : '#334155'} strokeWidth={0.04} />
                <text x={0.2} y={0.42} fill={canvasLight ? '#0369a1' : '#38bdf8'} fontSize={0.23} fontFamily="monospace" fontWeight="bold">
                  MEP SYMBOLS (IEC/IPC/ASHRAE)
                </text>
                <line x1={0.2} y1={0.58} x2={4.0} y2={0.58} stroke={canvasLight ? '#cbd5e1' : '#334155'} strokeWidth={0.02} />
                {[
                  { y: 1.0, col: '#d97706', label: '⊗ Ceiling Luminaire (LED)' },
                  { y: 1.45, col: '#ea580c', label: '⊥ Twin Switched Socket' },
                  { y: 1.9, col: '#d97706', label: 'MDB Distribution Board' },
                  { y: 2.35, col: '#e11d48', label: 'SD Smoke Detector (NFPA72)' },
                  { y: 2.8, col: '#9333ea', label: 'AC / EF Split FCU & Exhaust' },
                  { y: 3.25, col: '#0284c7', label: 'CDU Marine Blue-Fin Condenser' },
                  { y: 3.7, col: '#0d9488', label: 'CF BLDC Ceiling Fan / Drain' },
                  { y: 4.15, col: '#0284c7', label: 'CW Cold Water Ø25 PPR' },
                  { y: 4.6, col: '#16a34a', label: 'SAN Soil Drain Ø110 @ 1:60' },
                  { y: 5.05, col: '#16a34a', label: 'IC Inspection Chamber' },
                  { y: 5.5, col: '#0284c7', label: 'RWP Rainwater Pipe Ø100' },
                  { y: 5.95, col: '#1e3a8a', label: 'PV/INV/BESS Solar Array' },
                ].map((row) => (
                  <g key={row.label} transform={`translate(0.25, ${row.y})`}>
                    <circle cx={0.12} cy={-0.06} r={0.09} fill={row.col} />
                    <text x={0.35} y={0} fill={dimText} fontSize={0.19} fontFamily="monospace">
                      {row.label}
                    </text>
                  </g>
                ))}
              </g>
            </>
          )}

          {/* Section Cut Lines (A-A) */}
          {project.sections.slice(0, 1).map((sec) => (
            <g key={sec.id}>
              <line
                x1={sec.start.x}
                y1={sec.start.y}
                x2={sec.end.x}
                y2={sec.end.y}
                stroke="#e11d48"
                strokeWidth={0.04}
                strokeDasharray="0.45 0.15 0.1 0.15"
              />
              <circle cx={sec.start.x} cy={sec.start.y} r={0.28} fill="#be123c" />
              <text x={sec.start.x} y={sec.start.y + 0.1} textAnchor="middle" fill="#fff" fontSize={0.24} fontWeight="bold">
                {sec.label.split('-')[0]}
              </text>
              <circle cx={sec.end.x} cy={sec.end.y} r={0.28} fill="#be123c" />
              <text x={sec.end.x} y={sec.end.y + 0.1} textAnchor="middle" fill="#fff" fontSize={0.24} fontWeight="bold">
                {sec.label.split('-')[0]}
              </text>
            </g>
          ))}

          {/* Multi-Tier ISO 128 Dimension Chains + Architectural 45° Slash Ticks */}
          {level.walls.length > 0 && (
            <g stroke={dimStroke} strokeWidth={0.025} fill={dimText} fontFamily="monospace" fontSize={0.24}>
              {/* Tier 1 Top: Structural Grid Bay Dimensions */}
              {xGridCoords.length >= 2 && (
                <>
                  <line x1={xGridCoords[0]} y1={bb.minY - 0.6} x2={xGridCoords[xGridCoords.length - 1]} y2={bb.minY - 0.6} />
                  {xGridCoords.map((gx, i) => (
                    <g key={`tx_${i}`}>
                      <line x1={gx} y1={bb.minY - 0.72} x2={gx} y2={bb.minY - 0.25} strokeOpacity={0.55} />
                      <line x1={gx - 0.08} y1={bb.minY - 0.52} x2={gx + 0.08} y2={bb.minY - 0.68} strokeWidth={0.04} />
                      {i > 0 && xGridCoords[i] - xGridCoords[i - 1] >= 0.6 && (
                        <text x={(xGridCoords[i - 1] + gx) / 2} y={bb.minY - 0.7} textAnchor="middle" stroke="none" fontSize={0.2}>
                          {(gx - xGridCoords[i - 1]).toFixed(2)}
                        </text>
                      )}
                    </g>
                  ))}
                </>
              )}

              {/* Tier 2 Top: Overall Width */}
              <line x1={bb.minX} y1={bb.minY - 1.2} x2={bb.maxX} y2={bb.minY - 1.2} />
              <line x1={bb.minX} y1={bb.minY - 1.35} x2={bb.minX} y2={bb.minY - 0.25} strokeOpacity={0.6} />
              <line x1={bb.maxX} y1={bb.minY - 1.35} x2={bb.maxX} y2={bb.minY - 0.25} strokeOpacity={0.6} />
              <line x1={bb.minX - 0.09} y1={bb.minY - 1.11} x2={bb.minX + 0.09} y2={bb.minY - 1.29} strokeWidth={0.045} />
              <line x1={bb.maxX - 0.09} y1={bb.minY - 1.11} x2={bb.maxX + 0.09} y2={bb.minY - 1.29} strokeWidth={0.045} />
              <text x={(bb.minX + bb.maxX) / 2} y={bb.minY - 1.32} textAnchor="middle" stroke="none" fontWeight="bold">
                {bb.width.toFixed(2)} m
              </text>

              {/* Tier 1 Left: Y-Grid Bay Dimensions */}
              {yGridCoords.length >= 2 && (
                <>
                  <line x1={bb.minX - 0.6} y1={yGridCoords[0]} x2={bb.minX - 0.6} y2={yGridCoords[yGridCoords.length - 1]} />
                  {yGridCoords.map((gy, i) => (
                    <g key={`ly_${i}`}>
                      <line x1={bb.minX - 0.72} y1={gy} x2={bb.minX - 0.25} y2={gy} strokeOpacity={0.55} />
                      <line x1={bb.minX - 0.68} y1={gy + 0.08} x2={bb.minX - 0.52} y2={gy - 0.08} strokeWidth={0.04} />
                      {i > 0 && yGridCoords[i] - yGridCoords[i - 1] >= 0.6 && (
                        <text
                          x={bb.minX - 0.72}
                          y={(yGridCoords[i - 1] + gy) / 2}
                          textAnchor="middle"
                          stroke="none"
                          fontSize={0.2}
                          transform={`rotate(-90, ${bb.minX - 0.72}, ${(yGridCoords[i - 1] + gy) / 2})`}
                        >
                          {(gy - yGridCoords[i - 1]).toFixed(2)}
                        </text>
                      )}
                    </g>
                  ))}
                </>
              )}

              {/* Tier 2 Left: Overall Depth */}
              <line x1={bb.minX - 1.2} y1={bb.minY} x2={bb.minX - 1.2} y2={bb.maxY} />
              <line x1={bb.minX - 1.35} y1={bb.minY} x2={bb.minX - 0.25} y2={bb.minY} strokeOpacity={0.6} />
              <line x1={bb.minX - 1.35} y1={bb.maxY} x2={bb.minX - 0.25} y2={bb.maxY} strokeOpacity={0.6} />
              <line x1={bb.minX - 1.29} y1={bb.minY + 0.09} x2={bb.minX - 1.11} y2={bb.minY - 0.09} strokeWidth={0.045} />
              <line x1={bb.minX - 1.29} y1={bb.maxY + 0.09} x2={bb.minX - 1.11} y2={bb.maxY - 0.09} strokeWidth={0.045} />
              <text
                x={bb.minX - 1.35}
                y={(bb.minY + bb.maxY) / 2}
                textAnchor="middle"
                stroke="none"
                fontWeight="bold"
                transform={`rotate(-90, ${bb.minX - 1.35}, ${(bb.minY + bb.maxY) / 2})`}
              >
                {bb.depth.toFixed(2)} m
              </text>

              {/* Tier 3 Bottom & Right: Exterior Wall/Opening Pier Segment Chains */}
              {!isMEP && southPierPoints.length >= 2 && (
                <>
                  <line x1={bb.minX} y1={bb.maxY + 0.62} x2={bb.maxX} y2={bb.maxY + 0.62} />
                  {southPierPoints.map((px, i) => (
                    <g key={`sp_${i}`}>
                      <line x1={px} y1={bb.maxY + 0.22} x2={px} y2={bb.maxY + 0.74} strokeOpacity={0.5} />
                      <line x1={px - 0.07} y1={bb.maxY + 0.7} x2={px + 0.07} y2={bb.maxY + 0.54} strokeWidth={0.038} />
                      {i > 0 && southPierPoints[i] - southPierPoints[i - 1] >= 0.45 && (
                        <text x={(southPierPoints[i - 1] + px) / 2} y={bb.maxY + 0.92} textAnchor="middle" stroke="none" fontSize={0.19}>
                          {(px - southPierPoints[i - 1]).toFixed(2)}
                        </text>
                      )}
                    </g>
                  ))}
                </>
              )}
              {eastPierPoints.length >= 2 && (
                <>
                  <line x1={bb.maxX + 0.62} y1={bb.minY} x2={bb.maxX + 0.62} y2={bb.maxY} />
                  {eastPierPoints.map((py, i) => (
                    <g key={`ep_${i}`}>
                      <line x1={bb.maxX + 0.22} y1={py} x2={bb.maxX + 0.74} y2={py} strokeOpacity={0.5} />
                      <line x1={bb.maxX + 0.54} y1={py + 0.07} x2={bb.maxX + 0.7} y2={py - 0.07} strokeWidth={0.038} />
                      {i > 0 && eastPierPoints[i] - eastPierPoints[i - 1] >= 0.45 && (
                        <text
                          x={bb.maxX + 0.88}
                          y={(eastPierPoints[i - 1] + py) / 2}
                          textAnchor="middle"
                          stroke="none"
                          fontSize={0.19}
                          transform={`rotate(90, ${bb.maxX + 0.88}, ${(eastPierPoints[i - 1] + py) / 2})`}
                        >
                          {(py - eastPierPoints[i - 1]).toFixed(2)}
                        </text>
                      )}
                    </g>
                  ))}
                </>
              )}
            </g>
          )}

          {/* Architectural Compass North Arrow, Scale Bar & Exterior Elevation Callouts */}
          {level.walls.length > 0 && (
            <g>
              {/* North Arrow */}
              <g transform={`translate(${bb.maxX + 2.2}, ${bb.minY - 1.3})`}>
                <circle r={0.55} fill={bubbleFill} stroke={dimStroke} strokeWidth={0.035} />
                <polygon points="0,-0.45 -0.18,0.18 0,0.04" fill="#0284c7" />
                <polygon points="0,-0.45 0.18,0.18 0,0.04" fill={canvasLight ? '#e2e8f0' : '#334155'} stroke="#0284c7" strokeWidth={0.02} />
                <text y={0.42} textAnchor="middle" fill={dimText} fontSize={0.22} fontFamily="monospace" fontWeight="bold">
                  N
                </text>
              </g>

              {/* Graphic Scale Bar (1:100 · 0 1 2 5m) */}
              <g transform={`translate(${bb.minX}, ${bb.maxY + 1.55})`}>
                <rect x={0} y={0} width={1} height={0.14} fill={dimText} />
                <rect x={1} y={0} width={1} height={0.14} fill="none" stroke={dimText} strokeWidth={0.025} />
                <rect x={2} y={0} width={3} height={0.14} fill={dimText} fillOpacity={0.3} stroke={dimText} strokeWidth={0.025} />
                <text x={0} y={-0.08} fill={dimText} fontSize={0.18} fontFamily="monospace">0</text>
                <text x={1} y={-0.08} textAnchor="middle" fill={dimText} fontSize={0.18} fontFamily="monospace">1</text>
                <text x={2} y={-0.08} textAnchor="middle" fill={dimText} fontSize={0.18} fontFamily="monospace">2</text>
                <text x={5} y={-0.08} textAnchor="middle" fill={dimText} fontSize={0.18} fontFamily="monospace">5m (1:100)</text>
              </g>

              {/* Cardinal Elevation Callouts (N/E/S/W -> A-201) */}
              {!isStructural && !isMEP && (
                <g fill={bubbleFill} stroke="#0284c7" strokeWidth={0.035} fontFamily="monospace" fontSize={0.17}>
                  {[
                    { x: bb.minX + bb.width * 0.25, y: bb.minY - 2.38, lbl: 'N/A201' },
                    { x: (bb.minX + bb.maxX) / 2, y: bb.maxY + 1.85, lbl: 'S/A201' },
                    { x: bb.maxX + 1.65, y: (bb.minY + bb.maxY) / 2, lbl: 'E/A201' },
                    { x: bb.minX - 2.45, y: bb.minY + bb.depth * 0.25, lbl: 'W/A201' },
                  ].map((el) => (
                    <g key={el.lbl} transform={`translate(${el.x}, ${el.y})`}>
                      <circle r={0.34} />
                      <text y={0.06} textAnchor="middle" stroke="none" fill={bubbleText} fontWeight="bold">
                        {el.lbl}
                      </text>
                    </g>
                  ))}
                </g>
              )}
            </g>
          )}

          {/* Active Interactive Wall Preview */}
          {drawStart && (
            <g>
              <circle cx={drawStart.x} cy={drawStart.y} r={0.14} fill="#22d3ee" />
              <line
                x1={drawStart.x}
                y1={drawStart.y}
                x2={cursorWorld.x}
                y2={cursorWorld.y}
                stroke="#22d3ee"
                strokeWidth={0.12}
                strokeDasharray="0.2 0.1"
              />
              {activeTool === 'room_rect' && (
                <rect
                  x={Math.min(drawStart.x, cursorWorld.x)}
                  y={Math.min(drawStart.y, cursorWorld.y)}
                  width={Math.abs(cursorWorld.x - drawStart.x)}
                  height={Math.abs(cursorWorld.y - drawStart.y)}
                  fill="#22d3ee"
                  fillOpacity={0.12}
                  stroke="#22d3ee"
                  strokeWidth={0.05}
                />
              )}
              <text
                x={(drawStart.x + cursorWorld.x) / 2}
                y={(drawStart.y + cursorWorld.y) / 2 - 0.25}
                textAnchor="middle"
                fill="#22d3ee"
                fontSize={0.28}
                fontFamily="monospace"
              >
                {dist(drawStart, cursorWorld).toFixed(2)}m
              </text>
            </g>
          )}

          {/* Measure Result */}
          {measurePts && (
            <g>
              <line x1={measurePts.a.x} y1={measurePts.a.y} x2={measurePts.b.x} y2={measurePts.b.y} stroke="#10b981" strokeWidth={0.06} />
              <text
                x={(measurePts.a.x + measurePts.b.x) / 2}
                y={(measurePts.a.y + measurePts.b.y) / 2 - 0.25}
                textAnchor="middle"
                fill="#34d399"
                fontSize={0.32}
                fontFamily="monospace"
                fontWeight="bold"
              >
                {dist(measurePts.a, measurePts.b).toFixed(2)} m
              </text>
            </g>
          )}

          {/* Freehand AI Sketch Strokes Overlay */}
          {sketchStrokes.map((st) => (
            <polyline
              key={st.id}
              points={st.points.map((p) => `${p.x},${p.y}`).join(' ')}
              fill="none"
              stroke={st.kind === 'wall' ? '#a855f7' : st.kind === 'door' ? '#f59e0b' : '#38bdf8'}
              strokeWidth={0.14}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeOpacity={0.85}
            />
          ))}
          {activeStroke && (
            <polyline
              points={activeStroke.map((p) => `${p.x},${p.y}`).join(' ')}
              fill="none"
              stroke="#c084fc"
              strokeWidth={0.15}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
        </g>
      </svg>

      {/* Collapsible On-Sheet Engineering Schedules & Code Compliance Drawer */}
      {showSchedules && (
        <div className="bg-slate-900 border-t border-slate-700 max-h-60 overflow-auto p-3 text-[11px] font-mono space-y-3 shrink-0">
          {isStructural ? (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
              <div>
                <div className="font-semibold text-cyan-300 mb-1">
                  COLUMN & PAD FOOTING SCHEDULE (ACI 318 / EUROCODE 2)
                </div>
                <table className="w-full text-left border border-slate-800">
                  <thead className="bg-slate-950 text-slate-400">
                    <tr>
                      <th className="px-2 py-1">Lvl</th>
                      <th className="px-2 py-1">Col</th>
                      <th className="px-2 py-1">Size (mm)</th>
                      <th className="px-2 py-1 text-right">Pu (kN)</th>
                      <th className="px-2 py-1">Rebar</th>
                      <th className="px-2 py-1">Footing / PCC</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800 text-slate-200">
                    {schedules.columns.slice(0, 12).map((c, idx) => (
                      <tr key={idx}>
                        <td className="px-2 py-1">{c.levelName}</td>
                        <td className="px-2 py-1 font-bold text-cyan-300">{c.colMark}</td>
                        <td className="px-2 py-1">{c.colSizeMm}</td>
                        <td className="px-2 py-1 text-right">{c.axialLoadKN}</td>
                        <td className="px-2 py-1">{c.mainBars}</td>
                        <td className="px-2 py-1">{c.footingMark}: {c.footingSizeMm} · {c.bottomMesh}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="space-y-3">
                <div>
                  <div className="font-semibold text-cyan-300 mb-1">RC BEAM & LINTEL SCHEDULE</div>
                  <table className="w-full text-left border border-slate-800">
                    <thead className="bg-slate-950 text-slate-400">
                      <tr>
                        <th className="px-2 py-1">Mark</th>
                        <th className="px-2 py-1">Size (mm)</th>
                        <th className="px-2 py-1">Top / Bot Steel</th>
                        <th className="px-2 py-1">Links</th>
                        <th className="px-2 py-1">L/d</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800 text-slate-200">
                      {schedules.beams.map((b) => (
                        <tr key={b.mark}>
                          <td className="px-2 py-1 font-bold text-cyan-300">{b.mark}</td>
                          <td className="px-2 py-1">{b.sizeMm}</td>
                          <td className="px-2 py-1">{b.topSteel} / {b.bottomSteel}</td>
                          <td className="px-2 py-1">{b.stirrups}</td>
                          <td className="px-2 py-1 text-emerald-300">{b.spanDepthRatio} ({b.status})</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div>
                  <div className="font-semibold text-amber-300 mb-1">BS 8666 BAR BENDING SCHEDULE (BBS)</div>
                  <table className="w-full text-left border border-slate-800">
                    <thead className="bg-slate-950 text-slate-400">
                      <tr>
                        <th className="px-2 py-1">Bar</th>
                        <th className="px-2 py-1">Ø</th>
                        <th className="px-2 py-1">SC</th>
                        <th className="px-2 py-1">Member</th>
                        <th className="px-2 py-1 text-right">Qty</th>
                        <th className="px-2 py-1 text-right">Mass (kg)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800 text-slate-200">
                      {schedules.bbs.map((b) => (
                        <tr key={b.barMark}>
                          <td className="px-2 py-1 font-bold">{b.barMark}</td>
                          <td className="px-2 py-1">Ø{b.diameterMm}</td>
                          <td className="px-2 py-1">{b.shapeCode}</td>
                          <td className="px-2 py-1 font-sans">{b.member}</td>
                          <td className="px-2 py-1 text-right">{b.totalBars}</td>
                          <td className="px-2 py-1 text-right font-bold text-emerald-300">{b.totalWeightKg}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : isMEP ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <div>
                <div className="font-semibold text-cyan-300 mb-1">
                  COORDINATED MEP & FIRE SAFETY STANDARDS SUMMARY (IEC 60364 / IPC / NFPA 72)
                </div>
                <table className="w-full text-left border border-slate-800">
                  <thead className="bg-slate-950 text-slate-400">
                    <tr>
                      <th className="px-2 py-1">System</th>
                      <th className="px-2 py-1">Specification</th>
                      <th className="px-2 py-1">Slope / Mounting</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800 text-slate-200">
                    {level.mepCircuits.map((c) => (
                      <tr key={c.id}>
                        <td className="px-2 py-1 font-bold text-cyan-300">{c.id}</td>
                        <td className="px-2 py-1">{c.spec}</td>
                        <td className="px-2 py-1">
                          {c.system.startsWith('electrical') ? 'Concealed +2.4m / +0.45m' : 'Fall 1:60 min Gravity / Pressurized'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div>
                <div className="font-semibold text-emerald-300 mb-1">CODE COMPLIANCE STATUS</div>
                <div className="space-y-1">
                  {schedules.complianceChecks.map((ck) => (
                    <div key={ck.code} className="flex items-center justify-between bg-slate-950 border border-slate-800 rounded px-2 py-1">
                      <span><strong className="text-cyan-300">{ck.code}:</strong> {ck.actual}</span>
                      <span className="text-emerald-300 font-bold">{ck.status}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
              <div>
                <div className="font-semibold text-amber-300 mb-1">DOOR SCHEDULE (ISO 128)</div>
                <table className="w-full text-left border border-slate-800">
                  <thead className="bg-slate-950 text-slate-400">
                    <tr>
                      <th className="px-2 py-1">Mark</th>
                      <th className="px-2 py-1">W×H (mm)</th>
                      <th className="px-2 py-1">Rating</th>
                      <th className="px-2 py-1 text-right">Qty</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800 text-slate-200">
                    {schedules.doors.map((d) => (
                      <tr key={d.mark + d.widthMm}>
                        <td className="px-2 py-1 font-bold text-amber-300">{d.mark}</td>
                        <td className="px-2 py-1">{d.widthMm}×{d.heightMm}</td>
                        <td className="px-2 py-1">{d.fireRating}</td>
                        <td className="px-2 py-1 text-right">{d.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div>
                <div className="font-semibold text-cyan-300 mb-1">
                  WINDOW SCHEDULE (Daylighting {schedules.glazingToFloorPct}% GFA)
                </div>
                <table className="w-full text-left border border-slate-800">
                  <thead className="bg-slate-950 text-slate-400">
                    <tr>
                      <th className="px-2 py-1">Mark</th>
                      <th className="px-2 py-1">W×H (Sill)</th>
                      <th className="px-2 py-1">U-Val</th>
                      <th className="px-2 py-1 text-right">Qty</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800 text-slate-200">
                    {schedules.windows.map((w) => (
                      <tr key={w.mark + w.widthMm}>
                        <td className="px-2 py-1 font-bold text-cyan-300">{w.mark}</td>
                        <td className="px-2 py-1">{w.widthMm}×{w.heightMm} ({w.sillMm})</td>
                        <td className="px-2 py-1">{w.uValue} W/m²K</td>
                        <td className="px-2 py-1 text-right">{w.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div>
                <div className="font-semibold text-emerald-300 mb-1">ROOM FINISH & IBC 1208 SCHEDULE</div>
                <table className="w-full text-left border border-slate-800">
                  <thead className="bg-slate-950 text-slate-400">
                    <tr>
                      <th className="px-2 py-1">ID</th>
                      <th className="px-2 py-1">Room</th>
                      <th className="px-2 py-1 text-right">Area</th>
                      <th className="px-2 py-1">Finish</th>
                      <th className="px-2 py-1">IBC</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800 text-slate-200">
                    {schedules.rooms.map((r) => (
                      <tr key={r.code}>
                        <td className="px-2 py-1 font-bold text-cyan-300">{r.code}</td>
                        <td className="px-2 py-1 font-sans">{r.name}</td>
                        <td className="px-2 py-1 text-right">{r.areaM2}m²</td>
                        <td className="px-2 py-1">{r.floorFinish}</td>
                        <td className="px-2 py-1 text-emerald-300">{r.compliance}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Bottom Engineering Title Block */}
      <TitleBlock
        meta={project.meta}
        sheetNo={activeSheet}
        sheetTitle={sheetTitle}
        discipline={isStructural ? 'Structural Engineering' : isMEP ? 'MEP Engineering' : 'Architectural'}
        compact
        isLight={isLight}
      />
    </div>
  );
};
