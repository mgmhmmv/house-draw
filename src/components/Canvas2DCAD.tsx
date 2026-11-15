import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActiveSheetId,
  BuildingProject,
  CADTool,
  getRoofDrainageConfig,
  getSolarConfig,
  GUTTER_PROFILE_META,
  Point2D,
  SelectableElementKind,
  SketchStroke,
  WATER_COLLECTION_META,
} from '../model/types';
import {
  autoPopulateMEPForLevel,
  computePVAndEquipmentRoutes,
  getCoreElectricalNodes,
  relocateMEPNode,
} from '../engine/mepEngine';
import {
  computeSolarArrayLayout,
  dist,
  getRoomFloorColor,
  levelBoundingBox,
  openingWorldCenter,
  polygonArea,
  polygonCentroid,
  projectPointOnSegment,
  roundTo,
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
  onSelect: (id: string | null, kind?: SelectableElementKind) => void;
  onUpdateProject: (proj: BuildingProject) => void;
  onSwitchSheet?: (sheet: ActiveSheetId) => void;
  sketchStrokes: SketchStroke[];
  onAddSketchStroke: (stroke: SketchStroke) => void;
  traceImageUrl: string | null;
  traceOpacity: number;
  svgRef?: React.RefObject<SVGSVGElement | null>;
  isLight?: boolean;
}

type ActiveDragState =
  | {
      kind: 'solar_array';
      startWorld: Point2D;
      initOffsetX: number;
      initOffsetY: number;
    }
  | {
      kind: 'solar_panel';
      panelIndex: number;
      startWorld: Point2D;
      initOffset: Point2D;
    }
  | {
      kind: 'mep_node';
      nodeId: string;
      startWorld: Point2D;
      initPos: Point2D;
    }
  | {
      kind: 'wiring_waypoint';
      route: 'dc' | 'ac';
      wpIndex: number;
      startWorld: Point2D;
      initWaypoints: Point2D[];
    }
  | {
      kind: 'furniture';
      itemId: string;
      startWorld: Point2D;
      initPos: Point2D;
    }
  | {
      kind: 'column';
      colId: string;
      startWorld: Point2D;
      initPos: Point2D;
    }
  | {
      kind: 'opening';
      openingId: string;
      wallId: string;
    }
  | {
      kind: 'wall';
      wallId: string;
      mode: 'move' | 'start' | 'end';
      startWorld: Point2D;
      initStart: Point2D;
      initEnd: Point2D;
    }
  | {
      kind: 'room';
      roomId: string;
      startWorld: Point2D;
      initPoly: Point2D[];
    };

const SCALE = 42; // 42 SVG px per meter

export const Canvas2DCAD: React.FC<Canvas2DCADProps> = ({
  project,
  activeLevelIndex,
  activeSheet,
  activeTool,
  selectedId,
  onSelect,
  onUpdateProject,
  onSwitchSheet,
  sketchStrokes,
  onAddSketchStroke,
  traceImageUrl,
  traceOpacity,
  svgRef,
  isLight = true,
}) => {
  const internalSvgRef = useRef<SVGSVGElement | null>(null);
  const effectiveSvgRef = svgRef ?? internalSvgRef;

  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 118, y: 175 });
  const [zoom, setZoom] = useState<number>(0.77);
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [cursorWorld, setCursorWorld] = useState<Point2D>({ x: 0, y: 0 });

  // Interactive drawing & dragging states
  const [drawStart, setDrawStart] = useState<Point2D | null>(null);
  const [measurePts, setMeasurePts] = useState<{ a: Point2D; b: Point2D } | null>(null);
  const [activeStroke, setActiveStroke] = useState<Point2D[] | null>(null);
  const [canvasBlueprint, setCanvasBlueprint] = useState<boolean>(false);
  const [showSchedules, setShowSchedules] = useState<boolean>(false);
  const [showCornerAngles, setShowCornerAngles] = useState<boolean>(false);
  const [showFullSpecs, setShowFullSpecs] = useState<boolean>(false);
  const [mepFilter, setMepFilter] = useState<'all' | 'electrical' | 'plumbing' | 'hvac' | 'solar'>('all');
  const [showRoofPVOnArch, setShowRoofPVOnArch] = useState<boolean>(true);
  const [showWiringPlan, setShowWiringPlan] = useState<boolean>(false);
  const [pvDragMode, setPvDragMode] = useState<'array' | 'panel'>('array');
  const [draftProject, setDraftProject] = useState<BuildingProject | null>(null);
  const dragRef = useRef<ActiveDragState | null>(null);
  const didDragMoveRef = useRef<boolean>(false);

  useEffect(() => {
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setDrawStart(null);
        setMeasurePts(null);
        setActiveStroke(null);
      }
    };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, []);

  const effectiveProject = draftProject ?? project;
  const level = effectiveProject.levels[activeLevelIndex] ?? effectiveProject.levels[0];
  const bb = levelBoundingBox(level);
  const coreElec = getCoreElectricalNodes(level);
  const solar = getSolarConfig(effectiveProject);
  const solarLayout = useMemo(
    () => (solar.enabled && level.walls.length > 0 ? computeSolarArrayLayout(effectiveProject) : null),
    [effectiveProject, solar.enabled, level.walls.length]
  );
  const equipRoutes = useMemo(
    () => computePVAndEquipmentRoutes(effectiveProject, activeLevelIndex),
    [effectiveProject, activeLevelIndex]
  );

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

  const isStructural = activeSheet === 'S-101';
  const isMEP = activeSheet === 'M-101';

  const structuralColumns = useMemo(() => {
    if (!isStructural) return level.columns;
    const out: typeof level.columns = [];
    for (const col of level.columns) {
      if (!out.some((prev) => dist(prev.position, col.position) < 1.25)) {
        out.push(col);
      }
    }
    return out;
  }, [isStructural, level.columns]);

  const structuralColumnPositions = useMemo(() => {
    const base = isStructural ? structuralColumns : level.columns;
    return base.map((c) => c.position);
  }, [isStructural, structuralColumns, level.columns]);

  const roomCentroids = useMemo(
    () => level.rooms.map((r) => polygonCentroid(r.polygon)),
    [level.rooms]
  );

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

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
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

    // Select & Drag mode: hit test Solar PV, MEP equipment, openings, columns, walls, furniture, rooms
    const startDrag = (state: ActiveDragState) => {
      dragRef.current = state;
      didDragMoveRef.current = false;
      try {
        (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
      } catch {
        // Ignore capture failures
      }
    };

    const showSolarHere =
      solarLayout &&
      solar.enabled &&
      ((isMEP && (mepFilter === 'all' || mepFilter === 'electrical' || mepFilter === 'solar')) ||
        (!isStructural && !isMEP && showRoofPVOnArch));

    if (showSolarHere && solarLayout) {
      for (let i = solarLayout.panels.length - 1; i >= 0; i--) {
        const p = solarLayout.panels[i];
        if (Math.abs(rawW.x - p.x) <= p.width / 2 + 0.08 && Math.abs(rawW.y - p.y) <= p.depth / 2 + 0.08) {
          const singleMode = pvDragMode === 'panel' || e.altKey || selectedId === `solar_panel_${p.index}`;
          if (singleMode) {
            onSelect(`solar_panel_${p.index}`, 'solar_panel');
            startDrag({
              kind: 'solar_panel',
              panelIndex: p.index,
              startWorld: rawW,
              initOffset: { ...(solar.panelOffsets?.[p.index] ?? { x: 0, y: 0 }) },
            });
          } else {
            onSelect('solar_array', 'solar_array');
            startDrag({
              kind: 'solar_array',
              startWorld: rawW,
              initOffsetX: solar.offsetX ?? 0,
              initOffsetY: solar.offsetY ?? 0,
            });
          }
          return;
        }
      }
      if (
        rawW.x >= solarLayout.bounds.minX - 0.25 &&
        rawW.x <= solarLayout.bounds.maxX + 0.25 &&
        rawW.y >= solarLayout.bounds.minY - 0.5 &&
        rawW.y <= solarLayout.bounds.maxY + 0.2
      ) {
        onSelect('solar_array', 'solar_array');
        startDrag({
          kind: 'solar_array',
          startWorld: rawW,
          initOffsetX: solar.offsetX ?? 0,
          initOffsetY: solar.offsetY ?? 0,
        });
        return;
      }
    }

    if (!isStructural && (showWiringPlan || (isMEP && (mepFilter === 'all' || mepFilter === 'electrical' || mepFilter === 'solar')))) {
      if (solar.enabled) {
        for (let i = 0; i < equipRoutes.pvToInverter.waypoints.length; i++) {
          if (dist(rawW, equipRoutes.pvToInverter.waypoints[i]) < 0.42) {
            startDrag({
              kind: 'wiring_waypoint',
              route: 'dc',
              wpIndex: i,
              startWorld: rawW,
              initWaypoints: equipRoutes.pvToInverter.waypoints.map((w) => ({ ...w })),
            });
            return;
          }
        }
      }
      for (let i = 0; i < equipRoutes.inverterToMdb.waypoints.length; i++) {
        if (dist(rawW, equipRoutes.inverterToMdb.waypoints[i]) < 0.42) {
          startDrag({
            kind: 'wiring_waypoint',
            route: 'ac',
            wpIndex: i,
            startWorld: rawW,
            initWaypoints: equipRoutes.inverterToMdb.waypoints.map((w) => ({ ...w })),
          });
          return;
        }
      }
    }

    if (isMEP || showWiringPlan || (!isStructural && solar.enabled && showRoofPVOnArch)) {
      const movableCore = [
        coreElec.mdb,
        coreElec.meter,
        ...(solar.enabled ? [coreElec.inverter, coreElec.bess] : []),
      ];
      for (const cn of movableCore) {
        if (dist(rawW, cn.position) < 0.5) {
          onSelect(cn.id, 'mep_node');
          startDrag({
            kind: 'mep_node',
            nodeId: cn.id.startsWith('virtual_') ? cn.kind : cn.id,
            startWorld: rawW,
            initPos: { ...cn.position },
          });
          return;
        }
      }
    }

    if (isMEP) {
      for (let i = level.mepNodes.length - 1; i >= 0; i--) {
        const n = level.mepNodes[i];
        if (n.kind === 'solar_pv') continue;
        if (!solar.enabled && n.kind.startsWith('solar_')) continue;
        if (!matchesMepFilter(n.system === 'electrical' ? 'electrical_' : 'plumbing_', n.label)) continue;
        if (dist(rawW, n.position) < 0.45) {
          onSelect(n.id, 'mep_node');
          startDrag({
            kind: 'mep_node',
            nodeId: n.id,
            startWorld: rawW,
            initPos: { ...n.position },
          });
          return;
        }
      }
    }

    for (const op of level.openings) {
      const w = level.walls.find((x) => x.id === op.wallId);
      if (!w) continue;
      const c = openingWorldCenter(w, op);
      if (dist(rawW, c) < 0.6) {
        onSelect(op.id, 'opening');
        startDrag({ kind: 'opening', openingId: op.id, wallId: w.id });
        return;
      }
    }
    for (const c of isStructural ? structuralColumns : level.columns) {
      if (dist(rawW, c.position) < 0.5) {
        onSelect(c.id, 'column');
        startDrag({
          kind: 'column',
          colId: c.id,
          startWorld: rawW,
          initPos: { ...c.position },
        });
        return;
      }
    }
    for (const w of level.walls) {
      if (selectedId === w.id) {
        if (dist(rawW, w.start) < 0.35) {
          onSelect(w.id, 'wall');
          startDrag({
            kind: 'wall',
            wallId: w.id,
            mode: 'start',
            startWorld: rawW,
            initStart: { ...w.start },
            initEnd: { ...w.end },
          });
          return;
        }
        if (dist(rawW, w.end) < 0.35) {
          onSelect(w.id, 'wall');
          startDrag({
            kind: 'wall',
            wallId: w.id,
            mode: 'end',
            startWorld: rawW,
            initStart: { ...w.start },
            initEnd: { ...w.end },
          });
          return;
        }
      }
      const p = projectPointOnSegment(rawW, w.start, w.end);
      if (p.distance < 0.35) {
        onSelect(w.id, 'wall');
        startDrag({
          kind: 'wall',
          wallId: w.id,
          mode: 'move',
          startWorld: rawW,
          initStart: { ...w.start },
          initEnd: { ...w.end },
        });
        return;
      }
    }
    if (!isStructural && !isMEP) {
      for (let i = level.furniture.length - 1; i >= 0; i--) {
        const f = level.furniture[i];
        const rad = (-f.rotation * Math.PI) / 180;
        const dxF = rawW.x - f.position.x;
        const dyF = rawW.y - f.position.y;
        const lx = dxF * Math.cos(rad) - dyF * Math.sin(rad);
        const ly = dxF * Math.sin(rad) + dyF * Math.cos(rad);
        if (Math.abs(lx) <= f.width / 2 + 0.14 && Math.abs(ly) <= f.depth / 2 + 0.14) {
          onSelect(f.id, 'furniture');
          startDrag({
            kind: 'furniture',
            itemId: f.id,
            startWorld: rawW,
            initPos: { ...f.position },
          });
          return;
        }
      }
    }
    for (const r of level.rooms) {
      const c = polygonCentroid(r.polygon);
      if (dist(rawW, c) < 1.8) {
        onSelect(r.id, 'room');
        startDrag({
          kind: 'room',
          roomId: r.id,
          startWorld: rawW,
          initPoly: r.polygon.map((p) => ({ ...p })),
        });
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
      return;
    }

    const drag = dragRef.current;
    if (!drag) return;
    if (drag.kind === 'opening') {
      const next = structuredClone(project);
      const lvl = next.levels[activeLevelIndex];
      const w = lvl.walls.find((x) => x.id === drag.wallId);
      const op = lvl.openings.find((x) => x.id === drag.openingId);
      if (w && op) {
        const proj = projectPointOnSegment(rawW, w.start, w.end);
        const clampedT = Math.max(0.08, Math.min(0.92, Number(proj.t.toFixed(2))));
        if (Math.abs(clampedT - op.offset) > 0.005) {
          didDragMoveRef.current = true;
          op.offset = clampedT;
          setDraftProject(next);
        }
      }
      return;
    }

    const dx = roundTo(rawW.x - drag.startWorld.x, 0.05);
    const dy = roundTo(rawW.y - drag.startWorld.y, 0.05);
    if (Math.abs(dx) < 0.03 && Math.abs(dy) < 0.03) return;
    didDragMoveRef.current = true;

    const next = structuredClone(project);
    const lvl = next.levels[activeLevelIndex];
    if (drag.kind === 'solar_array') {
      const curSolar = getSolarConfig(next);
      next.solar = {
        ...curSolar,
        offsetX: Number((drag.initOffsetX + dx).toFixed(2)),
        offsetY: Number((drag.initOffsetY + dy).toFixed(2)),
      };
    } else if (drag.kind === 'solar_panel') {
      const curSolar = getSolarConfig(next);
      next.solar = {
        ...curSolar,
        panelOffsets: {
          ...(curSolar.panelOffsets ?? {}),
          [drag.panelIndex]: {
            x: Number((drag.initOffset.x + dx).toFixed(2)),
            y: Number((drag.initOffset.y + dy).toFixed(2)),
          },
        },
      };
    } else if (drag.kind === 'wiring_waypoint') {
      const curSolar = getSolarConfig(next);
      const updatedWps = drag.initWaypoints.map((w, idx) =>
        idx === drag.wpIndex
          ? { x: Number((w.x + dx).toFixed(2)), y: Number((w.y + dy).toFixed(2)) }
          : { ...w }
      );
      next.solar = {
        ...curSolar,
        [drag.route === 'dc' ? 'dcWaypoints' : 'acWaypoints']: updatedWps,
      };
    } else if (drag.kind === 'mep_node') {
      relocateMEPNode(
        lvl,
        drag.nodeId,
        {
          x: Number((drag.initPos.x + dx).toFixed(2)),
          y: Number((drag.initPos.y + dy).toFixed(2)),
        },
        solarLayout ? equipRoutes.pvCombinerPos : undefined
      );
    } else if (drag.kind === 'furniture') {
      const item = lvl.furniture.find((f) => f.id === drag.itemId);
      if (item) {
        item.position = {
          x: Number((drag.initPos.x + dx).toFixed(2)),
          y: Number((drag.initPos.y + dy).toFixed(2)),
        };
      }
    } else if (drag.kind === 'column') {
      const col = lvl.columns.find((c) => c.id === drag.colId);
      if (col) {
        col.position = {
          x: Number((drag.initPos.x + dx).toFixed(2)),
          y: Number((drag.initPos.y + dy).toFixed(2)),
        };
      }
    } else if (drag.kind === 'wall') {
      const w = lvl.walls.find((x) => x.id === drag.wallId);
      if (w) {
        if (drag.mode === 'start' || drag.mode === 'move') {
          w.start = {
            x: Number((drag.initStart.x + dx).toFixed(2)),
            y: Number((drag.initStart.y + dy).toFixed(2)),
          };
        }
        if (drag.mode === 'end' || drag.mode === 'move') {
          w.end = {
            x: Number((drag.initEnd.x + dx).toFixed(2)),
            y: Number((drag.initEnd.y + dy).toFixed(2)),
          };
        }
      }
    } else if (drag.kind === 'room') {
      const rm = lvl.rooms.find((r) => r.id === drag.roomId);
      if (rm) {
        rm.polygon = drag.initPoly.map((p) => ({
          x: Number((p.x + dx).toFixed(2)),
          y: Number((p.y + dy).toFixed(2)),
        }));
      }
    }
    setDraftProject(next);
  };

  const handlePointerUp = (e?: React.PointerEvent) => {
    setIsPanning(false);
    if (e) {
      try {
        (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
      } catch {
        // Ignore release errors
      }
    }
    if (dragRef.current) {
      const shouldCommit = didDragMoveRef.current && draftProject !== null;
      const finalProj = draftProject;
      dragRef.current = null;
      didDragMoveRef.current = false;
      setDraftProject(null);
      if (shouldCommit && finalProj) {
        onUpdateProject(finalProj);
      }
    }
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

  const cornerAngles = useMemo(() => {
    interface Junction {
      x: number;
      y: number;
      isExterior: boolean;
      rays: number[];
    }
    const map = new Map<string, Junction>();
    const addRay = (pt: Point2D, angle: number, isExt: boolean) => {
      const k = `${Math.round(pt.x * 10)}_${Math.round(pt.y * 10)}`;
      const entry = map.get(k) ?? { x: pt.x, y: pt.y, isExterior: isExt, rays: [] };
      entry.isExterior = entry.isExterior || isExt;
      entry.rays.push(((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2));
      map.set(k, entry);
    };
    for (const w of level.walls) {
      if (wallLength(w) < 0.3) continue;
      const a = Math.atan2(w.end.y - w.start.y, w.end.x - w.start.x);
      addRay(w.start, a, w.isExterior);
      addRay(w.end, a + Math.PI, w.isExterior);
    }
    const items: {
      x: number;
      y: number;
      a1: number;
      a2: number;
      deg: number;
      isRightAngle: boolean;
    }[] = [];
    for (const j of map.values()) {
      if (j.rays.length < 2) continue;
      const uniqueRays: number[] = [];
      for (const r of [...j.rays].sort((a, b) => a - b)) {
        if (uniqueRays.length === 0 || Math.abs(r - uniqueRays[uniqueRays.length - 1]) > 0.08) {
          uniqueRays.push(r);
        }
      }
      if (uniqueRays.length < 2) continue;
      for (let i = 0; i < uniqueRays.length; i++) {
        const a1 = uniqueRays[i];
        const nextRaw = i + 1 < uniqueRays.length ? uniqueRays[i + 1] : uniqueRays[0] + Math.PI * 2;
        const sweep = nextRaw - a1;
        const deg = (sweep * 180) / Math.PI;
        if (deg < 15 || deg > 170) continue;
        const isRight = Math.abs(deg - 90) < 1.2;
        const midAngle = a1 + sweep / 2;
        const testX = j.x + Math.cos(midAngle) * 0.65;
        const testY = j.y + Math.sin(midAngle) * 0.65;
        const insideBuilding =
          testX >= bb.minX + 0.05 && testX <= bb.maxX - 0.05 && testY >= bb.minY + 0.05 && testY <= bb.maxY - 0.05;
        if ((!isRight || (j.isExterior && uniqueRays.length === 2)) && insideBuilding) {
          items.push({
            x: j.x,
            y: j.y,
            a1,
            a2: nextRaw,
            deg: Number(deg.toFixed(1)),
            isRightAngle: isRight,
          });
        }
      }
    }
    return items;
  }, [level.walls, bb.minX, bb.maxX, bb.minY, bb.maxY]);

  return (
    <div className={`flex flex-col h-full w-full relative overflow-hidden ${canvasLight ? 'bg-[#f8fafc]' : 'bg-[#070b14]'}`}>
      {/* Top Viewport Overlay Controls */}
      <div className="absolute top-3 left-3 z-10 flex flex-wrap items-center gap-1.5 bg-slate-900/90 backdrop-blur border border-slate-700/80 rounded-lg px-2.5 py-1.5 text-xs shadow-sm">
        {onSwitchSheet ? (
          <div className="flex items-center gap-0.5 bg-slate-950 border border-slate-800 rounded-md p-0.5">
            {(
              [
                ['A-101', 'A-101 Plan'],
                ['A-201', 'A-201 Elev'],
                ['A-301', 'A-301 Sec'],
                ['S-101', 'S-101 Struct'],
                ['M-101', 'M-101 MEP'],
              ] as [ActiveSheetId, string][]
            ).map(([sheetId, lbl]) => (
              <button
                key={sheetId}
                type="button"
                onClick={() => onSwitchSheet(sheetId)}
                className={`px-1.5 py-0.5 rounded font-mono text-[10px] font-semibold transition ${
                  activeSheet === sheetId
                    ? 'bg-cyan-600 text-white text-white-keep'
                    : 'text-slate-300 hover:bg-slate-800'
                }`}
              >
                {lbl}
              </button>
            ))}
          </div>
        ) : (
          <span className="font-mono text-cyan-400 font-semibold">{activeSheet}</span>
        )}
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
              setZoom(0.77);
              setPan({ x: 118, y: 175 });
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
        {(isStructural || isMEP) && (
          <button
            type="button"
            onClick={() => setShowFullSpecs((v) => !v)}
            className={`px-2 py-0.5 rounded-md text-[10px] font-mono border ${
              showFullSpecs
                ? 'bg-cyan-600 text-white border-cyan-500 font-semibold'
                : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
            }`}
            title="Toggle Clean Member Marks vs Full On-Canvas Engineering Specs"
          >
            {showFullSpecs ? 'Specs: Full' : 'Specs: Clean'}
          </button>
        )}
        {!isMEP && (
          <button
            type="button"
            onClick={() => setShowCornerAngles((v) => !v)}
            className={`px-2 py-0.5 rounded-md text-[10px] font-mono border ${
              showCornerAngles
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                : 'bg-slate-800 text-slate-400 border-slate-700'
            }`}
            title="Show/Hide Corner & Measurement Angle Callouts"
          >
            ∠ Angles
          </button>
        )}
        {!isStructural && !isMEP && solar.enabled && (
          <button
            onClick={() => setShowRoofPVOnArch((v) => !v)}
            className={`px-2 py-0.5 rounded-md text-[10px] font-mono border ${
              showRoofPVOnArch
                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                : 'bg-slate-800 text-slate-400 border-slate-700'
            }`}
            title="Show/Hide & Drag Rooftop Solar PV Array on A-101 Plan"
          >
            PV Roof: {showRoofPVOnArch ? 'ON' : 'OFF'}
          </button>
        )}
        {!isStructural && (
          <button
            type="button"
            onClick={() => setShowWiringPlan((v) => !v)}
            className={`px-2 py-0.5 rounded-md text-[10px] font-mono border ${
              showWiringPlan
                ? 'bg-amber-500/25 text-amber-200 border-amber-500/50'
                : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
            }`}
            title="Toggle Detailed Electrical & Solar Wiring Plan + Drag Inverter, MDB & Utility Meter"
          >
            ⚡ Wiring Plan{showWiringPlan ? ': ON' : ''}
          </button>
        )}
        {solar.enabled && ((isMEP && (mepFilter === 'all' || mepFilter === 'electrical' || mepFilter === 'solar')) || (!isStructural && !isMEP && showRoofPVOnArch)) && (
          <button
            onClick={() => setPvDragMode((m) => (m === 'array' ? 'panel' : 'array'))}
            className={`px-2 py-0.5 rounded-md text-[10px] font-mono border ${
              pvDragMode === 'panel'
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                : 'bg-slate-800 text-cyan-300 border-slate-700 hover:bg-slate-700'
            }`}
            title="Toggle Solar PV Drag Mode: Entire Array vs Individual Panel (or Hold Alt)"
          >
            PV Move: {pvDragMode === 'panel' ? 'Single' : 'Array'}
          </button>
        )}
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
          <pattern id="footingHatch" width="0.22" height="0.22" patternTransform="rotate(-45 0 0)" patternUnits="userSpaceOnUse">
            <line x1="0" y1="0" x2="0" y2="0.22" stroke="#0284c7" strokeWidth="0.014" strokeOpacity="0.35" />
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
          {project.grid.xAxes.map((ax, axIdx) => {
            const prevAx = axIdx > 0 ? project.grid.xAxes[axIdx - 1] : null;
            const stagger = prevAx !== null && Math.abs(ax.coord - prevAx.coord) < 0.72 && axIdx % 2 === 1;
            const bubbleY = stagger ? bb.minY - 2.52 : bb.minY - 1.98;
            return (
              <g key={`gx_${ax.label}`}>
                <line
                  x1={ax.coord}
                  y1={bubbleY + 0.3}
                  x2={ax.coord}
                  y2={bb.maxY + 1.45}
                  stroke={gridAxisLine}
                  strokeWidth={0.022}
                  strokeOpacity={isStructural ? 0.55 : 0.7}
                  strokeDasharray="0.3 0.15 0.06 0.15"
                />
                <circle cx={ax.coord} cy={bubbleY} r={0.28} fill={bubbleFill} stroke="#0284c7" strokeWidth={0.04} />
                <text
                  x={ax.coord}
                  y={bubbleY + 0.1}
                  textAnchor="middle"
                  fill={bubbleText}
                  fontSize={0.28}
                  fontFamily="monospace"
                  fontWeight="bold"
                >
                  {ax.label}
                </text>
              </g>
            );
          })}
          {project.grid.yAxes.map((ax, axIdx) => {
            const prevAx = axIdx > 0 ? project.grid.yAxes[axIdx - 1] : null;
            const stagger = prevAx !== null && Math.abs(ax.coord - prevAx.coord) < 0.72 && axIdx % 2 === 1;
            const bubbleX = stagger ? bb.minX - 2.52 : bb.minX - 1.98;
            return (
              <g key={`gy_${ax.label}`}>
                <line
                  x1={bubbleX + 0.3}
                  y1={ax.coord}
                  x2={bb.maxX + 1.45}
                  y2={ax.coord}
                  stroke={gridAxisLine}
                  strokeWidth={0.022}
                  strokeOpacity={isStructural ? 0.55 : 0.7}
                  strokeDasharray="0.3 0.15 0.06 0.15"
                />
                <circle cx={bubbleX} cy={ax.coord} r={0.28} fill={bubbleFill} stroke="#0284c7" strokeWidth={0.04} />
                <text
                  x={bubbleX}
                  y={ax.coord + 0.1}
                  textAnchor="middle"
                  fill={bubbleText}
                  fontSize={0.28}
                  fontFamily="monospace"
                  fontWeight="bold"
                >
                  {ax.label}
                </text>
              </g>
            );
          })}

          {/* Rooms Layer */}
          {level.rooms.map((r) => {
            const pts = r.polygon.map((p) => `${p.x},${p.y}`).join(' ');
            const isSel = selectedId === r.id;
            return (
              <g key={r.id}>
                <polygon
                  points={pts}
                  fill={isStructural || isMEP ? (canvasLight ? '#f1f5f9' : '#0f172a') : getRoomFloorColor(r, canvasLight)}
                  fillOpacity={isStructural || isMEP ? 0.45 : 0.78}
                  stroke={isSel ? '#0284c7' : 'none'}
                  strokeWidth={0.06}
                />
              </g>
            );
          })}

          {/* Architectural Sanitaryware & Furniture Symbols (Architectural mode only) */}
          {!isStructural &&
            !isMEP &&
            level.furniture.map((f) => {
              const isSel = selectedId === f.id;
              const strokeCol = isSel ? '#0284c7' : canvasLight ? '#475569' : '#64748b';
              const fillCol = canvasLight ? '#e2e8f0' : '#334155';
              return (
                <g
                  key={f.id}
                  transform={`translate(${f.position.x}, ${f.position.y}) rotate(${f.rotation})`}
                  opacity={0.85}
                >
                  {isSel && (
                    <rect
                      x={-f.width / 2 - 0.08}
                      y={-f.depth / 2 - 0.08}
                      width={f.width + 0.16}
                      height={f.depth + 0.16}
                      rx={0.08}
                      fill="none"
                      stroke="#0284c7"
                      strokeWidth={0.045}
                      strokeDasharray="0.12 0.08"
                    />
                  )}
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

          {/* Room Stamp / Structural Slab Span Callout Layer */}
          {level.rooms.map((r, rIdx) => {
            const c = polygonCentroid(r.polygon);
            const area = polygonArea(r.polygon);
            const roomCode = `RM-${level.index + 1}${String(rIdx + 1).padStart(2, '0')}`;
            const slabText = showFullSpecs
              ? `S${rIdx + 1}: ${Math.round(level.slabThickness * 1000)}mm · Ø10@150`
              : `S${rIdx + 1} · ${Math.round(level.slabThickness * 1000)}mm`;
            const pillW = showFullSpecs ? 2.45 : 1.38;
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
                ) : isStructural ? (
                  <g>
                    {/* Compact Centered Two-Way Slab Span Crosshairs (±0.52m) */}
                    <g stroke="#0284c7" strokeWidth={0.028} strokeDasharray="0.1 0.06" opacity={0.75}>
                      <line x1={c.x - 0.52} y1={c.y} x2={c.x + 0.52} y2={c.y} />
                      <line x1={c.x} y1={c.y - 0.52} x2={c.x} y2={c.y + 0.52} />
                      <polyline points={`${c.x - 0.44},${c.y - 0.06} ${c.x - 0.52},${c.y} ${c.x - 0.44},${c.y + 0.06}`} fill="none" strokeDasharray="none" />
                      <polyline points={`${c.x + 0.44},${c.y - 0.06} ${c.x + 0.52},${c.y} ${c.x + 0.44},${c.y + 0.06}`} fill="none" strokeDasharray="none" />
                      <polyline points={`${c.x - 0.06},${c.y - 0.44} ${c.x},${c.y - 0.52} ${c.x + 0.06},${c.y - 0.44}`} fill="none" strokeDasharray="none" />
                      <polyline points={`${c.x - 0.06},${c.y + 0.44} ${c.x},${c.y + 0.52} ${c.x + 0.06},${c.y + 0.44}`} fill="none" strokeDasharray="none" />
                    </g>
                    <text
                      x={c.x}
                      y={c.y - 0.24}
                      textAnchor="middle"
                      fill={roomSubColor}
                      fontSize={0.16}
                      fontFamily="sans-serif"
                      fontWeight="600"
                      opacity={0.55}
                    >
                      {r.name}
                    </text>
                    <rect
                      x={c.x - pillW / 2}
                      y={c.y - 0.13}
                      width={pillW}
                      height={0.28}
                      rx={0.07}
                      fill={canvasLight ? '#ffffff' : '#0f172a'}
                      fillOpacity={0.94}
                      stroke="#0284c7"
                      strokeWidth={0.025}
                    />
                    <text
                      x={c.x}
                      y={c.y + 0.06}
                      textAnchor="middle"
                      fill={canvasLight ? '#0369a1' : '#38bdf8'}
                      fontSize={0.16}
                      fontFamily="monospace"
                      fontWeight="bold"
                    >
                      {slabText}
                    </text>
                  </g>
                ) : (
                  <text
                    x={c.x}
                    y={c.y + 0.56}
                    textAnchor="middle"
                    fill={roomSubColor}
                    fontSize={0.18}
                    fontWeight="600"
                    fontFamily="sans-serif"
                    opacity={0.5}
                  >
                    {r.name}
                  </text>
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
          {isStructural && (() => {
            const beamMark = level.index === 0 ? 'PB-1' : 'FB-1';
            const beamDim = level.index === 0 ? '230×350' : '230×400';
            const placedBeamLabels: Point2D[] = [];
            const avgFootingMm = Math.round((structuralColumns[0]?.footingSize ?? 1.2) * 1000);
            const slabMm = Math.round(level.slabThickness * 1000);

            return (
              <>
                {level.walls
                  .filter((w) => w.isLoadBearing || w.isExterior)
                  .map((w) => {
                    const mx = (w.start.x + w.end.x) / 2;
                    const my = (w.start.y + w.end.y) / 2;
                    const mid = { x: mx, y: my };
                    const len = wallLength(w);
                    const clearOfCols = !structuralColumnPositions.some((cp) => dist(cp, mid) < 0.85);
                    const clearOfRooms = !roomCentroids.some((rc) => dist(rc, mid) < 0.9);
                    const clearOfPrevBeam = !placedBeamLabels.some((pb) => dist(pb, mid) < 1.8);
                    const showBeamTag = len >= 2.8 && clearOfCols && clearOfRooms && clearOfPrevBeam;
                    if (showBeamTag) placedBeamLabels.push(mid);
                    const beamLabel = showFullSpecs ? `${beamMark} (${beamDim})` : beamMark;
                    const tagW = showFullSpecs ? 1.56 : 0.66;

                    return (
                      <g key={`bm_${w.id}`}>
                        <line
                          x1={w.start.x}
                          y1={w.start.y}
                          x2={w.end.x}
                          y2={w.end.y}
                          stroke="#0284c7"
                          strokeWidth={0.28}
                          strokeOpacity={0.26}
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
                        {showBeamTag && (
                          <g transform={`translate(${mx}, ${my})`} pointerEvents="none">
                            <rect
                              x={-tagW / 2}
                              y={-0.13}
                              width={tagW}
                              height={0.24}
                              rx={0.05}
                              fill={canvasLight ? '#ffffff' : '#0f172a'}
                              fillOpacity={0.92}
                              stroke="#0284c7"
                              strokeWidth={0.02}
                            />
                            <text
                              y={0.045}
                              textAnchor="middle"
                              fill={canvasLight ? '#0369a1' : '#38bdf8'}
                              fontSize={0.14}
                              fontFamily="monospace"
                              fontWeight="bold"
                            >
                              {beamLabel}
                            </text>
                          </g>
                        )}
                      </g>
                    );
                  })}
                {structuralColumns.map((c) => {
                  const pccSize = c.footingSize + 0.2;
                  const isSel = selectedId === c.id;
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
                        strokeWidth={0.022}
                        strokeDasharray="0.08 0.06"
                      />
                      <rect
                        x={c.position.x - c.footingSize / 2}
                        y={c.position.y - c.footingSize / 2}
                        width={c.footingSize}
                        height={c.footingSize}
                        fill="url(#footingHatch)"
                        stroke={isSel ? '#f43f5e' : '#0284c7'}
                        strokeWidth={isSel ? 0.055 : 0.036}
                        strokeDasharray="0.12 0.08"
                      />
                      {(showFullSpecs || isSel) && (
                        <g transform={`translate(${c.position.x}, ${c.position.y + c.footingSize / 2 - 0.14})`} pointerEvents="none">
                          <rect
                            x={-0.88}
                            y={-0.11}
                            width={1.76}
                            height={0.22}
                            rx={0.04}
                            fill={canvasLight ? '#ffffff' : '#0f172a'}
                            fillOpacity={0.92}
                          />
                          <text
                            y={0.05}
                            textAnchor="middle"
                            fill={canvasLight ? '#0369a1' : '#7dd3fc'}
                            fontSize={0.14}
                            fontFamily="monospace"
                            fontWeight="600"
                          >
                            F-{c.label} {Math.round(c.footingSize * 1000)}² · Ø12@150
                          </text>
                        </g>
                      )}
                    </g>
                  );
                })}

                {/* On-Canvas Structural Notes & Legend Box (replaces repeated text overlays) */}
                {level.walls.length > 0 && (
                  <g transform={`translate(${bb.maxX + 2.1}, ${bb.minY + 0.4})`} pointerEvents="none">
                    <rect
                      width={4.6}
                      height={5.4}
                      rx={0.12}
                      fill={canvasLight ? '#ffffff' : '#0f172a'}
                      stroke={canvasLight ? '#cbd5e1' : '#334155'}
                      strokeWidth={0.04}
                    />
                    <text x={0.22} y={0.42} fill={canvasLight ? '#0369a1' : '#38bdf8'} fontSize={0.21} fontFamily="monospace" fontWeight="bold">
                      STRUCTURAL NOTES (ACI 318 / EC2)
                    </text>
                    <line x1={0.22} y1={0.58} x2={4.38} y2={0.58} stroke={canvasLight ? '#cbd5e1' : '#334155'} strokeWidth={0.02} />

                    <g transform="translate(0.24, 0.98)">
                      <rect x={0} y={-0.14} width={0.22} height={0.22} fill="#0284c7" />
                      <text x={0.34} y={0.03} fill={dimText} fontSize={0.18} fontFamily="monospace">
                        Cols (C1–C{structuralColumns.length}): 300×300mm RC
                      </text>
                      <text x={0.34} y={0.25} fill={roomSubColor} fontSize={0.16} fontFamily="monospace">
                        Rebar: 4Ø16 + Ø8@150 links · f&apos;c 25 MPa
                      </text>
                    </g>

                    <g transform="translate(0.24, 1.75)">
                      <rect x={0} y={-0.14} width={0.24} height={0.24} fill="url(#footingHatch)" stroke="#0284c7" strokeWidth={0.025} strokeDasharray="0.06 0.04" />
                      <text x={0.34} y={0.03} fill={dimText} fontSize={0.18} fontFamily="monospace">
                        Pad Footing (F-C): {avgFootingMm}²×400mm
                      </text>
                      <text x={0.34} y={0.25} fill={roomSubColor} fontSize={0.16} fontFamily="monospace">
                        Ø12@150 B/W + 100mm PCC M15 Blinding
                      </text>
                    </g>

                    <g transform="translate(0.24, 2.52)">
                      <rect x={0} y={-0.08} width={0.24} height={0.14} fill="#0284c7" fillOpacity={0.3} stroke="#0369a1" strokeWidth={0.02} />
                      <text x={0.34} y={0.03} fill={dimText} fontSize={0.18} fontFamily="monospace">
                        {beamMark}: {beamDim}mm {level.index === 0 ? 'Plinth / Tie Beam' : 'Floor Beam'}
                      </text>
                      <text x={0.34} y={0.25} fill={roomSubColor} fontSize={0.16} fontFamily="monospace">
                        2T16 Top + 3T16 Bot · T8@150 Stirrups
                      </text>
                    </g>

                    <g transform="translate(0.24, 3.29)">
                      <line x1={0} y1={-0.03} x2={0.24} y2={-0.03} stroke="#0284c7" strokeWidth={0.025} />
                      <line x1={0.12} y1={-0.15} x2={0.12} y2={0.09} stroke="#0284c7" strokeWidth={0.025} />
                      <text x={0.34} y={0.03} fill={dimText} fontSize={0.18} fontFamily="monospace">
                        Slab (S1–S{Math.max(1, level.rooms.length)}): {slabMm}mm Two-Way RC
                      </text>
                      <text x={0.34} y={0.25} fill={roomSubColor} fontSize={0.16} fontFamily="monospace">
                        Main &amp; Dist: Ø10@150 B1/B2 · Cover 25mm
                      </text>
                    </g>

                    <line x1={0.22} y1={4.0} x2={4.38} y2={4.0} stroke={canvasLight ? '#cbd5e1' : '#334155'} strokeWidth={0.02} />
                    <text x={0.24} y={4.36} fill={roomSubColor} fontSize={0.16} fontFamily="monospace">
                      Concrete Cover: 50mm Footing · 35mm Col
                    </text>
                    <text x={0.24} y={4.64} fill={roomSubColor} fontSize={0.16} fontFamily="monospace">
                      Steel Grade: fy = 500 MPa (B500B / Fe500)
                    </text>
                    <text x={0.24} y={5.04} fill={canvasLight ? '#0369a1' : '#7dd3fc'} fontSize={0.15} fontFamily="monospace" fontWeight="600">
                      Tip: Toggle &quot;Specs: Full&quot; for member labels
                    </text>
                  </g>
                )}
              </>
            );
          })()}

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
                  <>
                    <circle cx={w.start.x} cy={w.start.y} r={0.14} fill="#ffffff" stroke="#0284c7" strokeWidth={0.05} />
                    <circle cx={w.end.x} cy={w.end.y} r={0.14} fill="#ffffff" stroke="#0284c7" strokeWidth={0.05} />
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
                  </>
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
                    isStructural ? (
                      <g stroke={canvasLight ? '#94a3b8' : '#475569'} strokeWidth={0.03} opacity={0.35}>
                        <line x1={-op.width / 2} y1={-wall.thickness / 2} x2={-op.width / 2} y2={wall.thickness / 2} />
                        <line x1={op.width / 2} y1={-wall.thickness / 2} x2={op.width / 2} y2={wall.thickness / 2} />
                        <line x1={-op.width / 2} y1={0} x2={op.width / 2} y2={0} strokeDasharray="0.12 0.08" />
                      </g>
                    ) : (
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
                    )
                  ) : (
                    <g stroke={isSel ? '#0284c7' : canvasLight ? '#0284c7' : '#38bdf8'} strokeWidth={0.035} opacity={isStructural ? 0.3 : 1}>
                      <rect
                        x={-op.width / 2}
                        y={-wall.thickness / 2}
                        width={op.width}
                        height={wall.thickness}
                        fill={canvasLight ? '#bae6fd' : '#0c4a6e'}
                        fillOpacity={isStructural ? 0.35 : 0.65}
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
          {(isStructural ? structuralColumns : level.columns).map((col, colIdx, colArr) => {
            const isSel = selectedId === col.id;
            const prevNear = colIdx > 0 && colArr.slice(0, colIdx).some((p) => Math.abs(p.position.x - col.position.x) < 2.1 && Math.abs(p.position.y - col.position.y) < 1.2);
            const showColDetail = showFullSpecs || isSel;
            const colTag = showColDetail ? `${col.label} (${Math.round(col.width * 1000)}²)` : col.label;
            const pillW = showColDetail ? 1.15 : 0.44;
            const tagY = col.position.y - (prevNear ? 0.5 : 0.28);
            const tagX = col.position.x + col.width / 2 + 0.08 + pillW / 2;

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
                  <g transform={`translate(${tagX}, ${tagY})`} pointerEvents="none">
                    <rect
                      x={-pillW / 2}
                      y={-0.12}
                      width={pillW}
                      height={0.22}
                      rx={0.04}
                      fill={canvasLight ? '#ffffff' : '#0f172a'}
                      fillOpacity={0.94}
                      stroke={isSel ? '#f43f5e' : '#0284c7'}
                      strokeWidth={0.02}
                    />
                    <text
                      y={0.045}
                      textAnchor="middle"
                      fill={isSel ? '#e11d48' : canvasLight ? '#0369a1' : '#bae6fd'}
                      fontSize={0.145}
                      fontFamily="monospace"
                      fontWeight="bold"
                    >
                      {colTag}
                    </text>
                  </g>
                )}
              </g>
            );
          })}

          {/* Rooftop Solar PV Overlay on Architectural Plan (A-101) — Draggable */}
          {!isStructural && !isMEP && showRoofPVOnArch && solarLayout && solar.enabled && (() => {
            const arrayKwp = ((solar.panelCount * solar.panelWattage) / 1000).toFixed(2);
            const isArraySel = selectedId === 'solar_array';
            return (
              <g opacity={0.85}>
                <rect
                  x={solarLayout.bounds.minX - 0.16}
                  y={solarLayout.bounds.minY - 0.36}
                  width={solarLayout.bounds.width + 0.32}
                  height={solarLayout.bounds.depth + 0.52}
                  rx={0.08}
                  fill={canvasLight ? '#ecfdf5' : '#064e3b'}
                  fillOpacity={0.22}
                  stroke={isArraySel ? '#0284c7' : '#16a34a'}
                  strokeWidth={isArraySel ? 0.05 : 0.035}
                  strokeDasharray="0.16 0.1"
                />
                <text
                  x={solarLayout.bounds.minX}
                  y={solarLayout.bounds.minY - 0.14}
                  fill={isArraySel ? '#0284c7' : canvasLight ? '#15803d' : '#6ee7b7'}
                  fontSize={0.17}
                  fontFamily="monospace"
                  fontWeight="bold"
                >
                  ROOF PV: {solar.panelCount}×{solar.panelWattage}Wp ({arrayKwp}kWp) · Drag to Move
                </text>
                {solarLayout.panels.map((p) => {
                  const isPanelSel = selectedId === `solar_panel_${p.index}`;
                  return (
                    <g key={`arch_pv_${p.index}`} transform={`translate(${p.x}, ${p.y})`}>
                      <rect
                        x={-p.width / 2}
                        y={-p.depth / 2}
                        width={p.width}
                        height={p.depth}
                        fill={canvasLight ? '#1e3a8a' : '#172554'}
                        fillOpacity={isPanelSel ? 0.72 : 0.42}
                        stroke={isPanelSel ? '#f59e0b' : isArraySel ? '#22d3ee' : '#60a5fa'}
                        strokeWidth={isPanelSel ? 0.055 : 0.025}
                      />
                      <line x1={0} y1={-p.depth / 2} x2={0} y2={p.depth / 2} stroke="#93c5fd" strokeWidth={0.015} opacity={0.65} />
                      <line x1={-p.width / 2} y1={0} x2={p.width / 2} y2={0} stroke="#93c5fd" strokeWidth={0.015} opacity={0.65} />
                    </g>
                  );
                })}
              </g>
            );
          })()}

          {/* Detailed 2D Electrical & Solar Wiring Plan Overlay (on A-101 when ⚡ Wiring Plan toggled OR M-101 Electrical) */}
          {!isStructural &&
            (showWiringPlan || (isMEP && (mepFilter === 'all' || mepFilter === 'electrical' || mepFilter === 'solar'))) &&
            level.walls.length > 0 && (() => {
              const mdbP = coreElec.mdb.position;
              const mtrP = coreElec.meter.position;
              const invP = coreElec.inverter.position;
              const bessP = coreElec.bess.position;
              const gridEntry = { x: mtrP.x - 1.05, y: mtrP.y };
              const ptsStr = (pts: Point2D[]) => pts.map((p) => `${p.x},${p.y}`).join(' ');
              const longestMid = (pts: Point2D[]): Point2D => {
                if (pts.length < 2) return pts[0] ?? mdbP;
                let bestLen = -1;
                let mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
                for (let i = 1; i < pts.length; i++) {
                  const len = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
                  if (len > bestLen) {
                    bestLen = len;
                    mid = { x: (pts[i].x + pts[i - 1].x) / 2, y: (pts[i].y + pts[i - 1].y) / 2 };
                  }
                }
                return mid;
              };
              const mtrLbl = longestMid(equipRoutes.meterToMdb.points2D);
              const dcLbl = longestMid(equipRoutes.pvToInverter.points2D);
              const acLbl = longestMid(equipRoutes.inverterToMdb.points2D);
              const isMdbSel = selectedId === coreElec.mdb.id;
              const isMtrSel = selectedId === coreElec.meter.id;
              const isInvSel = selectedId === coreElec.inverter.id;
              const isBessSel = selectedId === coreElec.bess.id;

              return (
                <g>
                  {/* Sub-mains & room branch circuits overlay when Viewing Wiring Plan on A-101 */}
                  {showWiringPlan &&
                    !isMEP &&
                    level.mepCircuits
                      .filter((c) => c.system.startsWith('electrical_') && c.system !== 'electrical_pv' && c.system !== 'electrical_grid')
                      .map((ckt) => {
                        const col =
                          ckt.system === 'electrical_submain'
                            ? '#0891b2'
                            : ckt.system === 'electrical_light'
                            ? '#d97706'
                            : ckt.system === 'electrical_power'
                            ? '#ea580c'
                            : '#9333ea';
                        const pts = ckt.points;
                        const dPath = pts
                          .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`)
                          .join(' ');
                        return (
                          <g key={`wp_${ckt.id}`}>
                            <path
                              d={dPath}
                              fill="none"
                              stroke={col}
                              strokeWidth={ckt.system === 'electrical_submain' ? 0.056 : 0.044}
                              strokeDasharray={ckt.system === 'electrical_submain' ? undefined : '0.14 0.07'}
                            />
                            {ckt.system !== 'electrical_submain' && pts.slice(1).map((p, idx) => (
                              <circle key={idx} cx={p.x} cy={p.y} r={0.07} fill={col} opacity={0.85} />
                            ))}
                          </g>
                        );
                      })}

                  {/* Per-Room Sub-Distribution Boards on A-101 Wiring Overlay */}
                  {showWiringPlan &&
                    !isMEP &&
                    level.mepNodes
                      .filter((n) => n.kind === 'sub_db')
                      .map((sdb) => (
                        <g key={`wp_sdb_${sdb.id}`} transform={`translate(${sdb.position.x}, ${sdb.position.y})`}>
                          <rect x={-0.17} y={-0.09} width={0.34} height={0.18} fill={canvasLight ? '#cffafe' : '#083344'} stroke="#0891b2" strokeWidth={0.035} />
                          <polygon points="-0.17,-0.09 0.17,0.09 -0.17,0.09" fill="#0891b2" />
                          {sdb.label && (
                            <text y={-0.16} textAnchor="middle" fill={canvasLight ? '#0e7490' : '#22d3ee'} fontSize={0.135} fontFamily="monospace" fontWeight="bold">
                              {sdb.label}
                            </text>
                          )}
                        </g>
                      ))}

                  {/* Incoming Grid SWA Intake -> Utility kWh Meter -> Wall-Routed MDB Feeder */}
                  <line x1={gridEntry.x} y1={gridEntry.y} x2={mtrP.x} y2={mtrP.y} stroke="#0284c7" strokeWidth={0.065} strokeDasharray="0.2 0.08" />
                  <polyline
                    points={ptsStr(equipRoutes.meterToMdb.points2D)}
                    fill="none"
                    stroke="#0284c7"
                    strokeWidth={0.065}
                  />
                  {showWiringPlan && (
                    <>
                      <text
                        x={gridEntry.x + 0.1}
                        y={mtrP.y - 0.14}
                        fill="#0284c7"
                        fontSize={0.14}
                        fontFamily="monospace"
                        fontWeight="bold"
                      >
                        GRID 4×16mm² SWA → MTR
                      </text>
                      <text
                        x={mtrLbl.x}
                        y={mtrLbl.y - 0.14}
                        textAnchor="middle"
                        fill="#0284c7"
                        fontSize={0.14}
                        fontFamily="monospace"
                        fontWeight="bold"
                      >
                        SWA MAIN ({equipRoutes.meterToMdb.lengthM}m)
                      </text>
                    </>
                  )}

                  {/* Draggable Utility Meter Symbol */}
                  <g transform={`translate(${mtrP.x}, ${mtrP.y})`} style={{ cursor: 'grab' }}>
                    {isMtrSel && <circle r={0.42} fill="none" stroke="#0284c7" strokeWidth={0.05} strokeDasharray="0.1 0.06" />}
                    <rect x={-0.25} y={-0.2} width={0.5} height={0.4} rx={0.05} fill={canvasLight ? '#e0f2fe' : '#082f49'} stroke="#0284c7" strokeWidth={0.045} />
                    <circle cx={0} cy={-0.02} r={0.11} fill="none" stroke="#0284c7" strokeWidth={0.03} />
                    <text y={0.02} textAnchor="middle" fill="#0369a1" fontSize={0.11} fontFamily="monospace" fontWeight="bold">
                      kWh
                    </text>
                    <text y={-0.27} textAnchor="middle" fill="#0369a1" fontSize={0.16} fontFamily="monospace" fontWeight="bold">
                      KWH-MTR
                    </text>
                  </g>

                  {/* Draggable Main Distribution Board (MDB) on A-101 Wiring Mode */}
                  {!isMEP && (
                    <g transform={`translate(${mdbP.x}, ${mdbP.y})`} style={{ cursor: 'grab' }}>
                      {isMdbSel && <circle r={0.42} fill="none" stroke="#d97706" strokeWidth={0.05} strokeDasharray="0.1 0.06" />}
                      <rect x={-0.28} y={-0.16} width={0.56} height={0.32} fill={canvasLight ? '#fef3c7' : '#451a03'} stroke="#d97706" strokeWidth={0.045} />
                      <polygon points="-0.28,-0.16 0.28,0.16 -0.28,0.16" fill="#d97706" />
                      <text y={-0.23} textAnchor="middle" fill={canvasLight ? '#92400e' : '#fde047'} fontSize={0.16} fontFamily="monospace" fontWeight="bold">
                        {coreElec.mdb.label ?? 'MDB-1'}
                      </text>
                    </g>
                  )}

                  {/* Detailed Roof-Slope & Wall-Hugging Solar String, Inverter AC Link & Draggable Junction Waypoints */}
                  {solar.enabled && solarLayout && (
                    <g>
                      <polyline
                        points={ptsStr(equipRoutes.pvToInverter.points2D)}
                        fill="none"
                        stroke="#e11d48"
                        strokeWidth={0.06}
                        strokeDasharray="0.16 0.08"
                      />
                      <polyline
                        points={ptsStr(equipRoutes.inverterToMdb.points2D)}
                        fill="none"
                        stroke="#16a34a"
                        strokeWidth={0.06}
                      />
                      {/* Rooftop PV Combiner Box (PV-JB) */}
                      <g transform={`translate(${equipRoutes.pvCombinerPos.x}, ${equipRoutes.pvCombinerPos.y})`}>
                        <rect x={-0.16} y={-0.12} width={0.32} height={0.24} rx={0.04} fill="#ffe4e6" stroke="#e11d48" strokeWidth={0.03} />
                        <text y={0.045} textAnchor="middle" fill="#be123c" fontSize={0.1} fontFamily="monospace" fontWeight="bold">
                          PV-JB
                        </text>
                      </g>
                      {/* Draggable DC Conduit Waypoints (Junction Boxes) */}
                      {equipRoutes.pvToInverter.waypoints.map((wp, idx) => (
                        <g key={`dc_wp_${idx}`} transform={`translate(${wp.x}, ${wp.y})`} style={{ cursor: 'move' }}>
                          <polygon points="0,-0.16 0.16,0 0,0.16 -0.16,0" fill="#ffe4e6" stroke="#e11d48" strokeWidth={0.035} />
                          <text y={-0.22} textAnchor="middle" fill="#e11d48" fontSize={0.11} fontFamily="monospace" fontWeight="bold">
                            DC-JB{idx + 1}
                          </text>
                        </g>
                      ))}
                      {/* Draggable AC Feeder Waypoints (Junction Boxes) */}
                      {equipRoutes.inverterToMdb.waypoints.map((wp, idx) => (
                        <g key={`ac_wp_${idx}`} transform={`translate(${wp.x}, ${wp.y})`} style={{ cursor: 'move' }}>
                          <polygon points="0,-0.16 0.16,0 0,0.16 -0.16,0" fill="#dcfce7" stroke="#16a34a" strokeWidth={0.035} />
                          <text y={0.3} textAnchor="middle" fill="#15803d" fontSize={0.11} fontFamily="monospace" fontWeight="bold">
                            AC-JB{idx + 1}
                          </text>
                        </g>
                      ))}
                      {showWiringPlan && (
                        <>
                          <text
                            x={dcLbl.x}
                            y={dcLbl.y - 0.15}
                            textAnchor="middle"
                            fill="#be123c"
                            fontSize={0.13}
                            fontFamily="monospace"
                            fontWeight="bold"
                          >
                            2×6mm² DC ({equipRoutes.pvToInverter.lengthM}m)
                          </text>
                          <text
                            x={acLbl.x}
                            y={acLbl.y + 0.22}
                            textAnchor="middle"
                            fill="#15803d"
                            fontSize={0.13}
                            fontFamily="monospace"
                            fontWeight="bold"
                          >
                            3×6mm² AC ({equipRoutes.inverterToMdb.lengthM}m)
                          </text>
                        </>
                      )}
                      {solar.batteryKWh > 0 && (
                        <>
                          <polyline
                            points={ptsStr(equipRoutes.inverterToBess.points2D)}
                            fill="none"
                            stroke="#7c3aed"
                            strokeWidth={0.05}
                            strokeDasharray="0.1 0.08"
                          />
                          <g transform={`translate(${bessP.x}, ${bessP.y})`} style={{ cursor: 'grab' }}>
                            {isBessSel && <circle r={0.4} fill="none" stroke="#7c3aed" strokeWidth={0.05} strokeDasharray="0.1 0.06" />}
                            <rect x={-0.24} y={-0.17} width={0.48} height={0.34} rx={0.04} fill={canvasLight ? '#f3e8ff' : '#3b0764'} stroke="#7c3aed" strokeWidth={0.035} />
                            <text y={0.05} textAnchor="middle" fill={canvasLight ? '#6b21a8' : '#e9d5ff'} fontSize={0.13} fontFamily="monospace" fontWeight="bold">
                              BESS
                            </text>
                          </g>
                        </>
                      )}
                      <g transform={`translate(${invP.x}, ${invP.y})`} style={{ cursor: 'grab' }}>
                        {isInvSel && <circle r={0.42} fill="none" stroke="#f59e0b" strokeWidth={0.05} strokeDasharray="0.1 0.06" />}
                        <rect x={-0.24} y={-0.17} width={0.48} height={0.34} rx={0.04} fill={canvasLight ? '#e0f2fe' : '#0c4a6e'} stroke={isInvSel ? '#f59e0b' : '#0284c7'} strokeWidth={0.035} />
                        <text y={0.05} textAnchor="middle" fill={canvasLight ? '#0369a1' : '#bae6fd'} fontSize={0.13} fontFamily="monospace" fontWeight="bold">
                          INV
                        </text>
                      </g>
                    </g>
                  )}
                </g>
              );
            })()}

          {/* Standard Coordinated MEP, Fire & Stormwater Overlay (M-101) */}
          {isMEP && (
            <>
              {level.mepCircuits
                .filter(
                  (ckt) =>
                    ckt.system !== 'electrical_grid' &&
                    ckt.system !== 'electrical_pv' &&
                    matchesMepFilter(ckt.system)
                )
                .map((ckt) => {
                  const color =
                    ckt.system === 'electrical_submain'
                      ? '#0891b2'
                      : ckt.system === 'electrical_light'
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
                  const d = ckt.points
                    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`)
                    .join(' ');
                  const midPt = ckt.points.length >= 2 ? { x: (ckt.points[0].x + ckt.points[1].x) / 2, y: (ckt.points[0].y + ckt.points[1].y) / 2 } : null;
                  return (
                    <g key={ckt.id}>
                      <path
                        d={d}
                        fill="none"
                        stroke={color}
                        strokeWidth={
                          ckt.system === 'electrical_submain'
                            ? 0.058
                            : ckt.system === 'electrical_pv' || ckt.system === 'hvac_refrigerant'
                            ? 0.065
                            : 0.048
                        }
                        strokeDasharray={
                          ckt.system === 'electrical_submain'
                            ? undefined
                            : ckt.system === 'hvac_condensate'
                            ? '0.09 0.08'
                            : ckt.system.startsWith('electrical') || ckt.system === 'hvac_refrigerant'
                            ? '0.14 0.08'
                            : undefined
                        }
                      />
                      {(showWiringPlan || showFullSpecs) && midPt && ckt.system.startsWith('electrical') && (
                        <text
                          x={midPt.x}
                          y={midPt.y - 0.1}
                          textAnchor="middle"
                          fill={color}
                          fontSize={0.12}
                          fontFamily="monospace"
                          fontWeight="bold"
                        >
                          {ckt.id}
                        </text>
                      )}
                    </g>
                  );
                })}

              {/* Rooftop Solar PV Array (in M-101, INV/BESS/Meter/DC-AC wiring already rendered above!) */}
              {solar.enabled &&
                solarLayout &&
                (mepFilter === 'all' || mepFilter === 'electrical' || mepFilter === 'solar') && (() => {
                  const arrayKwp = ((solar.panelCount * solar.panelWattage) / 1000).toFixed(2);
                  const arrX = solarLayout.bounds.minX;
                  const arrY = solarLayout.bounds.minY;
                  const isArraySel = selectedId === 'solar_array';
                  return (
                    <g>
                      {/* PV Array Dotted Roof Mounting Boundary */}
                      <rect
                        x={solarLayout.bounds.minX - 0.18}
                        y={solarLayout.bounds.minY - 0.36}
                        width={solarLayout.bounds.width + 0.36}
                        height={solarLayout.bounds.depth + 0.52}
                        rx={0.08}
                        fill={canvasLight ? '#ecfdf5' : '#064e3b'}
                        fillOpacity={0.35}
                        stroke={isArraySel ? '#0284c7' : '#16a34a'}
                        strokeWidth={isArraySel ? 0.055 : 0.035}
                        strokeDasharray="0.16 0.1"
                      />
                      <text
                        x={arrX}
                        y={arrY - 0.14}
                        fill={isArraySel ? '#0284c7' : canvasLight ? '#15803d' : '#6ee7b7'}
                        fontSize={0.18}
                        fontFamily="monospace"
                        fontWeight="bold"
                      >
                        PV ARRAY: {solar.panelCount}×{solar.panelWattage}Wp ({arrayKwp}kWp) · Drag to Move
                      </text>
                      {solarLayout.panels.map((p) => {
                        const isPanelSel = selectedId === `solar_panel_${p.index}`;
                        return (
                          <g key={`pv_p_${p.index}`} transform={`translate(${p.x}, ${p.y})`}>
                            <rect
                              x={-p.width / 2}
                              y={-p.depth / 2}
                              width={p.width}
                              height={p.depth}
                              fill={canvasLight ? '#1e3a8a' : '#172554'}
                              fillOpacity={0.86}
                              stroke={isPanelSel ? '#f59e0b' : isArraySel ? '#22d3ee' : '#93c5fd'}
                              strokeWidth={isPanelSel ? 0.055 : 0.025}
                            />
                            <line x1={0} y1={-p.depth / 2} x2={0} y2={p.depth / 2} stroke="#60a5fa" strokeWidth={0.015} opacity={0.7} />
                            <line x1={-p.width / 2} y1={0} x2={p.width / 2} y2={0} stroke="#60a5fa" strokeWidth={0.015} opacity={0.7} />
                          </g>
                        );
                      })}
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
                  {/* Roof Perimeter Eave Gutter, RWP Downpipes & Rainwater Collection / Redirect */}
                  {(() => {
                    const drainage = getRoofDrainageConfig(project.roof);
                    if (!drainage.gutterEnabled) return null;
                    const ov = project.roof.overhang;
                    const gMeta = GUTTER_PROFILE_META[drainage.gutterProfile];
                    const cMeta = WATER_COLLECTION_META[drainage.waterCollectionMode];
                    const midX = (bb.minX + bb.maxX) / 2;
                    const midY = (bb.minY + bb.maxY) / 2;
                    const rwpCandidates = [
                      { x: bb.maxX + 0.14, y: bb.minY - 0.14 },
                      { x: bb.minX - 0.14, y: bb.maxY + 0.14 },
                      { x: bb.maxX + 0.14, y: bb.maxY + 0.14 },
                      { x: bb.minX - 0.14, y: bb.minY - 0.14 },
                      { x: midX, y: bb.maxY + 0.14 },
                      { x: midX, y: bb.minY - 0.14 },
                      { x: bb.maxX + 0.14, y: midY },
                      { x: bb.minX - 0.14, y: midY },
                    ].slice(0, Math.max(2, Math.min(8, drainage.downpipeCount)));
                    const destX = bb.maxX + 1.35;
                    const destY = bb.minY + 1.25;
                    return (
                      <g>
                        {/* Perimeter Gutter Line around roof eave */}
                        <rect
                          x={bb.minX - ov - 0.08}
                          y={bb.minY - ov - 0.08}
                          width={bb.width + (ov + 0.08) * 2}
                          height={bb.depth + (ov + 0.08) * 2}
                          fill="none"
                          stroke="#0284c7"
                          strokeWidth={0.055}
                          strokeDasharray="0.22 0.1"
                          opacity={0.75}
                        />
                        <text
                          x={midX}
                          y={bb.minY - ov - 0.22}
                          textAnchor="middle"
                          fill="#0369a1"
                          fontSize={0.16}
                          fontFamily="monospace"
                          fontWeight="bold"
                        >
                          PERIMETER GUTTER ({gMeta.shortLabel.toUpperCase()}) · {drainage.downpipeCount}× Ø100 RWP
                        </text>
                        {rwpCandidates.map((rwp, idx) => (
                          <g key={`rwp_${idx}`} transform={`translate(${rwp.x}, ${rwp.y})`}>
                            <circle r={0.12} fill="#0284c7" stroke="#ffffff" strokeWidth={0.025} />
                            {(showFullSpecs || idx === 0) && (
                              <text x={0.18} y={0.06} fill="#0369a1" fontSize={0.15} fontFamily="monospace">
                                {idx === 0 && drainage.firstFlushDiverter ? 'RWP+FF' : 'RWP'}
                              </text>
                            )}
                          </g>
                        ))}
                        {/* Collector header to destination */}
                        <polyline
                          points={`${rwpCandidates[0].x},${rwpCandidates[0].y} ${destX},${rwpCandidates[0].y} ${destX},${destY}`}
                          fill="none"
                          stroke="#0284c7"
                          strokeWidth={0.045}
                          strokeDasharray="0.14 0.08"
                        />
                        <g transform={`translate(${destX}, ${destY})`}>
                          {drainage.waterCollectionMode === 'harvesting_tank' ? (
                            <circle r={0.55} fill={canvasLight ? '#e0f2fe' : '#082f49'} stroke="#0284c7" strokeWidth={0.05} />
                          ) : (
                            <rect x={-0.65} y={-0.45} width={1.3} height={0.9} rx={0.08} fill={canvasLight ? '#e0f2fe' : '#082f49'} stroke={cMeta.badgeColor} strokeWidth={0.05} />
                          )}
                          <text y={0.04} textAnchor="middle" fill={canvasLight ? '#0369a1' : '#7dd3fc'} fontSize={0.15} fontFamily="monospace" fontWeight="bold">
                            {cMeta.shortLabel.toUpperCase()}
                          </text>
                          {(drainage.waterCollectionMode === 'harvesting_tank' || drainage.waterCollectionMode === 'underground_cistern') && (
                            <text y={0.23} textAnchor="middle" fill={canvasLight ? '#0369a1' : '#38bdf8'} fontSize={0.14} fontFamily="monospace">
                              {drainage.harvestingTankLiters}L
                            </text>
                          )}
                        </g>
                      </g>
                    );
                  })()}
                </g>
              )}

              {/* Standard IEC 60617 / NFPA 72 / IPC Point Symbols */}
              {level.mepNodes
                .filter(
                  (n) =>
                    !n.kind.startsWith('solar_') &&
                    n.kind !== 'utility_meter' &&
                    matchesMepFilter(n.system === 'electrical' ? 'electrical_' : 'plumbing_', n.label)
                )
                .map((n) => {
                  const isSD = n.label === 'SD';
                  const isEF = n.label === 'EF';
                  const isMepSel = selectedId === n.id;
                  return (
                    <g key={n.id} transform={`translate(${n.position.x}, ${n.position.y})`}>
                      {isMepSel && (
                        <circle
                          r={0.38}
                          fill="none"
                          stroke="#0284c7"
                          strokeWidth={0.05}
                          strokeDasharray="0.1 0.06"
                        />
                      )}
                      {n.kind === 'mdb' ? (
                        <g>
                          <rect x={-0.28} y={-0.16} width={0.56} height={0.32} fill={canvasLight ? '#fef3c7' : '#451a03'} stroke="#d97706" strokeWidth={0.045} />
                          <polygon points="-0.28,-0.16 0.28,0.16 -0.28,0.16" fill="#d97706" />
                        </g>
                      ) : n.kind === 'sub_db' ? (
                        <g>
                          <rect x={-0.17} y={-0.09} width={0.34} height={0.18} fill={canvasLight ? '#cffafe' : '#083344'} stroke="#0891b2" strokeWidth={0.035} />
                          <polygon points="-0.17,-0.09 0.17,0.09 -0.17,0.09" fill="#0891b2" />
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
                          y={n.kind === 'ceiling_fan' ? -0.42 : n.kind === 'ac_condenser' ? -0.32 : n.kind === 'sub_db' ? -0.16 : -0.23}
                          textAnchor="middle"
                          fill={
                            n.kind === 'sub_db'
                              ? canvasLight
                                ? '#0e7490'
                                : '#22d3ee'
                              : n.kind === 'ac_split' || n.kind === 'ac_condenser'
                              ? '#7e22ce'
                              : n.kind === 'ceiling_fan'
                              ? '#0f766e'
                              : canvasLight
                              ? n.system === 'electrical'
                                ? '#92400e'
                                : '#0369a1'
                              : '#fde047'
                          }
                          fontSize={n.kind === 'sub_db' ? 0.135 : 0.18}
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
                <rect width={4.2} height={7.0} rx={0.12} fill={canvasLight ? '#ffffff' : '#0f172a'} stroke={canvasLight ? '#cbd5e1' : '#334155'} strokeWidth={0.04} />
                <text x={0.2} y={0.42} fill={canvasLight ? '#0369a1' : '#38bdf8'} fontSize={0.23} fontFamily="monospace" fontWeight="bold">
                  MEP SYMBOLS (IEC/IPC/ASHRAE)
                </text>
                <line x1={0.2} y1={0.58} x2={4.0} y2={0.58} stroke={canvasLight ? '#cbd5e1' : '#334155'} strokeWidth={0.02} />
                {[
                  { y: 1.0, col: '#d97706', label: '⊗ Ceiling Luminaire (LED)' },
                  { y: 1.45, col: '#ea580c', label: '⊥ Twin Switched Socket' },
                  { y: 1.9, col: '#d97706', label: 'MDB Main Distribution Board' },
                  { y: 2.35, col: '#0891b2', label: 'DB Room Sub-Board (RCBO)' },
                  { y: 2.8, col: '#e11d48', label: 'SD Smoke Detector (NFPA72)' },
                  { y: 3.25, col: '#9333ea', label: 'AC / EF Split FCU & Exhaust' },
                  { y: 3.7, col: '#0284c7', label: 'CDU Marine Blue-Fin Condenser' },
                  { y: 4.15, col: '#0d9488', label: 'CF BLDC Ceiling Fan / Drain' },
                  { y: 4.6, col: '#0284c7', label: 'CW Cold Water Ø25 PPR' },
                  { y: 5.05, col: '#16a34a', label: 'SAN Soil Drain Ø110 @ 1:60' },
                  { y: 5.5, col: '#16a34a', label: 'IC Inspection Chamber' },
                  { y: 5.95, col: '#0284c7', label: 'RWP Rainwater Pipe Ø100' },
                  { y: 6.4, col: '#1e3a8a', label: 'PV/INV/BESS Solar Array' },
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

          {/* Corner & Custom Wall Junction Angle Callouts (90° / θ°) */}
          {showCornerAngles && !isMEP && cornerAngles.map((ca, idx) => {
            const r = 0.42;
            const p1x = ca.x + Math.cos(ca.a1) * r;
            const p1y = ca.y + Math.sin(ca.a1) * r;
            const p2x = ca.x + Math.cos(ca.a2) * r;
            const p2y = ca.y + Math.sin(ca.a2) * r;
            const midA = (ca.a1 + ca.a2) / 2;
            const tx = ca.x + Math.cos(midA) * (ca.isRightAngle ? 0.66 : 0.72);
            const ty = ca.y + Math.sin(midA) * (ca.isRightAngle ? 0.66 : 0.72);
            const sqX = ca.x + Math.cos(ca.a1) * r + Math.cos(ca.a2) * r;
            const sqY = ca.y + Math.sin(ca.a1) * r + Math.sin(ca.a2) * r;
            const angleStroke = canvasLight ? '#b45309' : '#fbbf24';
            return (
              <g key={`ang_${idx}`} opacity={0.85} pointerEvents="none">
                {ca.isRightAngle ? (
                  <polyline
                    points={`${p1x},${p1y} ${sqX},${sqY} ${p2x},${p2y}`}
                    fill="none"
                    stroke={angleStroke}
                    strokeWidth={0.025}
                  />
                ) : (
                  <path
                    d={`M ${p1x} ${p1y} A ${r} ${r} 0 0 1 ${p2x} ${p2y}`}
                    fill="none"
                    stroke={angleStroke}
                    strokeWidth={0.028}
                  />
                )}
                <text
                  x={tx}
                  y={ty + 0.05}
                  textAnchor="middle"
                  fill={angleStroke}
                  fontSize={0.16}
                  fontFamily="monospace"
                  fontWeight="bold"
                >
                  {ca.isRightAngle ? '90°' : `${ca.deg}°`}
                </text>
              </g>
            );
          })}

          {/* Section Cut Lines (A-A & B-B) — Architectural Plan only, clear of overall dims & grid bubbles */}
          {!isStructural &&
            !isMEP &&
            (project.sections.length > 0
              ? project.sections.slice(0, 2)
              : [
                  {
                    id: 'sec_a',
                    label: 'A-A',
                    start: { x: bb.minX - 2.45, y: (bb.minY + bb.maxY) / 2 },
                    end: { x: bb.maxX + 1.55, y: (bb.minY + bb.maxY) / 2 },
                  },
                ]
            ).map((sec) => {
              const isHoriz = Math.abs(sec.end.x - sec.start.x) >= Math.abs(sec.end.y - sec.start.y);
              let x1 = sec.start.x;
              let y1 = sec.start.y;
              let x2 = sec.end.x;
              let y2 = sec.end.y;
              if (isHoriz) {
                if (x1 <= x2) {
                  x1 = Math.min(x1, bb.minX - 2.45);
                  x2 = Math.max(x2, bb.maxX + 1.55);
                } else {
                  x1 = Math.max(x1, bb.maxX + 1.55);
                  x2 = Math.min(x2, bb.minX - 2.45);
                }
              } else {
                if (y1 <= y2) {
                  y1 = Math.min(y1, bb.minY - 2.55);
                  y2 = Math.max(y2, bb.maxY + 1.25);
                } else {
                  y1 = Math.max(y1, bb.maxY + 1.25);
                  y2 = Math.min(y2, bb.minY - 2.55);
                }
              }
              return (
                <g
                  key={sec.id}
                  style={{ cursor: onSwitchSheet ? 'pointer' : undefined }}
                  onPointerDown={(e) => {
                    if (!onSwitchSheet) return;
                    e.stopPropagation();
                    onSwitchSheet('A-301');
                  }}
                >
                  <line
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    stroke="#e11d48"
                    strokeWidth={0.04}
                    strokeDasharray="0.45 0.15 0.1 0.15"
                  />
                  <circle cx={x1} cy={y1} r={0.28} fill="#be123c" />
                  <text x={x1} y={y1 + 0.1} textAnchor="middle" fill="#fff" fontSize={0.24} fontWeight="bold">
                    {sec.label.split('-')[0]}
                  </text>
                  <circle cx={x2} cy={y2} r={0.28} fill="#be123c" />
                  <text x={x2} y={y2 + 0.1} textAnchor="middle" fill="#fff" fontSize={0.24} fontWeight="bold">
                    {sec.label.split('-')[0]}
                  </text>
                </g>
              );
            })}

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

              {/* Tier 3 Bottom & Right: Exterior Wall/Opening Pier Segment Chains (Architectural Plan only) */}
              {!isStructural && !isMEP && southPierPoints.length >= 2 && (
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
              {!isStructural && !isMEP && eastPierPoints.length >= 2 && (
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

              {/* Cardinal Elevation Callouts (N/E/S/W -> Clickable to open Sheet A-201) */}
              {!isStructural && !isMEP && (
                <g fill={bubbleFill} stroke="#0284c7" strokeWidth={0.035} fontFamily="monospace" fontSize={0.17}>
                  {[
                    { x: bb.minX + bb.width * 0.25, y: bb.minY - 2.38, lbl: 'N/A201' },
                    { x: (bb.minX + bb.maxX) / 2, y: bb.maxY + 2.0, lbl: 'S/A201' },
                    { x: bb.maxX + 1.65, y: (bb.minY + bb.maxY) / 2, lbl: 'E/A201' },
                    { x: bb.minX - 2.45, y: bb.minY + bb.depth * 0.25, lbl: 'W/A201' },
                  ].map((el) => (
                    <g
                      key={el.lbl}
                      transform={`translate(${el.x}, ${el.y})`}
                      style={{ cursor: onSwitchSheet ? 'pointer' : undefined }}
                      onPointerDown={(e) => {
                        if (!onSwitchSheet) return;
                        e.stopPropagation();
                        onSwitchSheet('A-201');
                      }}
                    >
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

          {/* Active Interactive Wall Preview & Measure Tool with Length, Deltas & Bearing Angle */}
          {[
            drawStart ? { key: 'draw_prev', a: drawStart, b: cursorWorld, color: '#0284c7', isDraw: true } : null,
            measurePts ? { key: 'meas_prev', a: measurePts.a, b: measurePts.b, color: '#10b981', isDraw: false } : null,
          ]
            .filter((item): item is { key: string; a: Point2D; b: Point2D; color: string; isDraw: boolean } => Boolean(item))
            .map(({ key, a, b, color, isDraw }) => {
              const dx = b.x - a.x;
              const dy = b.y - a.y;
              const len = dist(a, b);
              const rawRad = Math.atan2(dy, dx);
              const bearingDeg = ((Math.atan2(-dy, dx) * 180) / Math.PI + 360) % 360;
              const arcR = Math.min(0.85, Math.max(0.3, len * 0.35));
              const endAx = a.x + Math.cos(rawRad) * arcR;
              const endAy = a.y + Math.sin(rawRad) * arcR;
              const sweep = dy >= 0 ? 1 : 0;
              return (
                <g key={key} pointerEvents="none">
                  <circle cx={a.x} cy={a.y} r={0.12} fill={color} />
                  {!isDraw && <circle cx={b.x} cy={b.y} r={0.12} fill={color} />}
                  <line
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    stroke={color}
                    strokeWidth={isDraw ? 0.1 : 0.06}
                    strokeDasharray={isDraw ? '0.2 0.1' : undefined}
                  />
                  {isDraw && activeTool === 'room_rect' && (
                    <rect
                      x={Math.min(a.x, b.x)}
                      y={Math.min(a.y, b.y)}
                      width={Math.abs(dx)}
                      height={Math.abs(dy)}
                      fill={color}
                      fillOpacity={0.12}
                      stroke={color}
                      strokeWidth={0.05}
                    />
                  )}
                  {len > 0.2 && (
                    <>
                      <line
                        x1={a.x}
                        y1={a.y}
                        x2={a.x + arcR + 0.35}
                        y2={a.y}
                        stroke={color}
                        strokeWidth={0.025}
                        strokeDasharray="0.12 0.08"
                        opacity={0.75}
                      />
                      <path
                        d={`M ${a.x + arcR} ${a.y} A ${arcR} ${arcR} 0 0 ${sweep} ${endAx} ${endAy}`}
                        fill="none"
                        stroke={color}
                        strokeWidth={0.03}
                      />
                    </>
                  )}
                  <text
                    x={(a.x + b.x) / 2}
                    y={(a.y + b.y) / 2 - 0.3}
                    textAnchor="middle"
                    fill={color}
                    fontSize={0.26}
                    fontFamily="monospace"
                    fontWeight="bold"
                  >
                    {len.toFixed(2)}m · ∠{bearingDeg.toFixed(1)}°
                  </text>
                  {len > 0.35 && (
                    <text
                      x={(a.x + b.x) / 2}
                      y={(a.y + b.y) / 2 + 0.36}
                      textAnchor="middle"
                      fill={color}
                      fontSize={0.18}
                      fontFamily="monospace"
                    >
                      ΔX {Math.abs(dx).toFixed(2)}m · ΔY {Math.abs(dy).toFixed(2)}m
                    </text>
                  )}
                </g>
              );
            })}

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
