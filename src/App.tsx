import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActiveSheetId,
  BuildingProject,
  CADTool,
  ClimateZone,
  CondenserProtection,
  DoorFinishMaterial,
  ExteriorFacadeMaterial,
  FloorFinish,
  getDesignConfig,
  getHVACConfig,
  getSolarConfig,
  HVACSystemType,
  InteriorWallMaterial,
  MALDIVES_HVAC_CONFIG,
  RoofMaterial,
  RoofType,
  RoomCategory,
  SketchStroke,
  WallMaterial,
  WindowFrameFinish,
} from './model/types';
import {
  createBlankEngineeringLot,
  createCompactEcoBungalow,
  createMaldivesTropicalVilla,
  createModernCourtyardHouse,
  createTwoStoryVilla,
} from './model/presets';
import { calculateBOQ } from './engine/boqCalculator';
import {
  autoGenerateStructuralGrid,
  autoPlaceStructuralColumns,
  computeTotalFloorArea,
  polygonArea,
  uid,
  wallLength,
} from './engine/geometry';
import { autoPopulateMEPForLevel } from './engine/mepEngine';
import { convertSketchStrokesToBIM } from './ai/sketchRecognizer';
import { AILLMConfig, runPromptArchitect } from './ai/promptEngine';
import {
  ExportResult,
  export3DToOBJ,
  exportBOQToCSV,
  exportLevelToDXF,
  exportProjectToJSON,
  exportSVGElement,
  exportViewportPNG,
  onExportComplete,
  retriggerBrowserDownload,
} from './export/exporters';
import { Canvas2DCAD } from './components/Canvas2DCAD';
import {
  FACADE_MATERIAL_OPTIONS,
  FLOOR_FINISH_OPTIONS,
  INTERIOR_WALL_OPTIONS,
  ROOF_MATERIAL_OPTIONS,
  Viewport3D,
} from './components/Viewport3D';
import { ElevationsAndSectionsView } from './components/ElevationsAndSectionsView';
import { SchematicsView } from './components/SchematicsView';
import { BOQView } from './components/BOQView';
import { FullDrawingSetModal } from './components/FullDrawingSetModal';
import {
  Box,
  Building2,
  Calculator,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Columns,
  Copy,
  Cpu,
  DoorOpen,
  Download,
  FileCode2,
  FileSpreadsheet,
  FileStack,
  ImagePlus,
  Layers,
  Moon,
  MousePointer2,
  Palette,
  PenTool,
  Plus,
  Redo2,
  Ruler,
  Send,
  Settings2,
  Sparkles,
  Square,
  Sun,
  Trash2,
  Undo2,
  Upload,
  Wand2,
  Wind,
  X,
  Zap,
  Droplets,
} from 'lucide-react';

const CAD_TOOLS: [CADTool, string, React.ElementType][] = [
  ['select', 'Select / Inspect', MousePointer2],
  ['wall', 'Draw Wall (2-Click)', PenTool],
  ['room_rect', 'Draw Room Box', Square],
  ['door', 'Place Door on Wall', DoorOpen],
  ['window', 'Place Window on Wall', Box],
  ['column', 'Place RC Column', Columns],
  ['measure', 'Measure Distance', Ruler],
];

const PROMPT_SUGGESTIONS = [
  'Create a 3 bedroom Maldives tropical house with cinder block, cement plastering & R32 inverter AC',
  'Create a 4 bedroom two story 15x11m house with garage and gable roof',
  'Add a 4x3.5m study room on the east side',
  'Change roof to flat roof with parapet',
  'Change roof to hip roof 28 deg',
  'Make exterior walls 250mm thick',
  'Add a second floor',
];

export function App() {
  const [project, setProject] = useState<BuildingProject>(() => createModernCourtyardHouse());
  const [history, setHistory] = useState<BuildingProject[]>([]);
  const [future, setFuture] = useState<BuildingProject[]>([]);

  const [activeSheet, setActiveSheet] = useState<ActiveSheetId>('A-101');
  const [activeLevelIndex, setActiveLevelIndex] = useState<number>(0);
  const [activeTool, setActiveTool] = useState<CADTool>('select');

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedKind, setSelectedKind] = useState<'wall' | 'opening' | 'room' | 'column' | null>(null);

  // Hand-drawn AI Sketch state
  const [sketchStrokes, setSketchStrokes] = useState<SketchStroke[]>([]);
  const [traceImageUrl, setTraceImageUrl] = useState<string | null>(null);
  const [traceOpacity, setTraceOpacity] = useState<number>(0.4);

  // Right sidebar state
  const [rightTab, setRightTab] = useState<'ai' | 'inspector'>('ai');
  const [promptInput, setPromptInput] = useState<string>('');
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [aiLogs, setAiLogs] = useState<
    { prompt: string; summary: string; reasoning?: string; engine?: string }[]
  >([
    {
      prompt: 'Initialized Project',
      summary: 'Loaded Modern 3-Bedroom Courtyard Residence with full structural, MEP, 3D & BOQ link.',
    },
  ]);
  const [llmConfig, setLlmConfig] = useState<AILLMConfig>(() => ({
    provider: 'claude',
    apiKey: typeof window !== 'undefined' ? window.localStorage.getItem('archstudio_claude_key') || '' : '',
    model: 'claude-sonnet-4-6',
  }));
  const [serverHasClaudeKey, setServerHasClaudeKey] = useState<boolean>(false);
  const [serverMaskedKey, setServerMaskedKey] = useState<string>('');
  const [keySaveStatus, setKeySaveStatus] = useState<string>('');
  const [showLLMSettings, setShowLLMSettings] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    return !window.localStorage.getItem('archstudio_claude_key');
  });
  const [showDrawingSetModal, setShowDrawingSetModal] = useState<boolean>(false);
  const [leftSidebarCollapsed, setLeftSidebarCollapsed] = useState<boolean>(false);
  const [rightSidebarCollapsed, setRightSidebarCollapsed] = useState<boolean>(false);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [activePreset, setActivePreset] = useState<string>('courtyard');
  const [openHeaderMenu, setOpenHeaderMenu] = useState<'arch' | 'mep' | 'export' | null>(null);
  const [lastExport, setLastExport] = useState<ExportResult | null>(null);
  const [recentExports, setRecentExports] = useState<ExportResult[]>([]);
  const [copiedExport, setCopiedExport] = useState<boolean>(false);
  const isLight = theme === 'light';

  const headerMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onPointerDown = (e: MouseEvent) => {
      if (headerMenuRef.current && !headerMenuRef.current.contains(e.target as Node)) {
        setOpenHeaderMenu(null);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenHeaderMenu(null);
    };
    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  useEffect(() => {
    return onExportComplete((res) => {
      setLastExport(res);
      setCopiedExport(false);
      setRecentExports((prev) => [res, ...prev.filter((x) => x.filename !== res.filename)].slice(0, 4));
    });
  }, []);

  useEffect(() => {
    fetch('/api/ai/config')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { hasKey?: boolean; maskedKey?: string } | null) => {
        if (data?.hasKey) {
          setServerHasClaudeKey(true);
          setServerMaskedKey(data.maskedKey || '');
          setShowLLMSettings(false);
        }
      })
      .catch(() => {});
  }, []);

  const handleSaveClaudeKey = async (rawKey: string) => {
    const trimmed = rawKey.trim();
    if (typeof window !== 'undefined') {
      if (trimmed) window.localStorage.setItem('archstudio_claude_key', trimmed);
      else window.localStorage.removeItem('archstudio_claude_key');
    }
    setLlmConfig((c) => ({ ...c, apiKey: trimmed, provider: 'claude' }));
    setKeySaveStatus('Saving...');
    try {
      const resp = await fetch('/api/ai/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: trimmed }),
      });
      if (resp.ok) {
        const data = (await resp.json()) as { hasKey?: boolean; maskedKey?: string };
        setServerHasClaudeKey(Boolean(data.hasKey));
        setServerMaskedKey(data.maskedKey || '');
        setKeySaveStatus(data.hasKey ? `Saved to .env.local (${data.maskedKey})` : 'Cleared');
        if (data.hasKey) setShowLLMSettings(false);
        return;
      }
      setKeySaveStatus(trimmed ? 'Saved in browser storage' : 'Cleared');
    } catch {
      setKeySaveStatus(trimmed ? 'Saved in browser storage' : 'Cleared');
    }
  };

  const svgRef = useRef<SVGSVGElement | null>(null);
  const jsonInputRef = useRef<HTMLInputElement | null>(null);
  const traceInputRef = useRef<HTMLInputElement | null>(null);

  const commitProject = (next: BuildingProject) => {
    setHistory((h) => [...h.slice(-24), project]);
    setFuture([]);
    setProject(next);
  };

  const handleUndo = () => {
    if (history.length === 0) return;
    const prev = history[history.length - 1];
    setHistory((h) => h.slice(0, -1));
    setFuture((f) => [project, ...f]);
    setProject(prev);
  };

  const handleRedo = () => {
    if (future.length === 0) return;
    const next = future[0];
    setFuture((f) => f.slice(1));
    setHistory((h) => [...h, project]);
    setProject(next);
  };

  const boqSummary = useMemo(() => calculateBOQ(project), [project]);
  const grossArea = useMemo(() => computeTotalFloorArea(project), [project]);
  const activeLevel = project.levels[activeLevelIndex] ?? project.levels[0];

  const is2DSheet = activeSheet === 'A-101' || activeSheet === 'S-101' || activeSheet === 'M-101';

  const handlePresetChange = (presetKey: string) => {
    setActivePreset(presetKey);
    let next: BuildingProject;
    if (presetKey === 'maldives') next = createMaldivesTropicalVilla();
    else if (presetKey === 'courtyard') next = createModernCourtyardHouse();
    else if (presetKey === 'villa') next = createTwoStoryVilla();
    else if (presetKey === 'eco') next = createCompactEcoBungalow();
    else next = createBlankEngineeringLot();

    commitProject(next);
    setActiveLevelIndex(0);
    setSelectedId(null);
    setSketchStrokes([]);
    setAiLogs((l) => [
      { prompt: `Loaded Template: ${next.meta.title}`, summary: 'Synchronized 2D CAD, 3D BIM, Schematics & BOQ.' },
      ...l,
    ]);
  };

  const handleRunPrompt = async (customPrompt?: string) => {
    const p = (customPrompt ?? promptInput).trim();
    if (!p) return;
    setIsGenerating(true);
    try {
      const res = await runPromptArchitect(project, p, llmConfig);
      commitProject(res.project);
      if (activeLevelIndex >= res.project.levels.length) {
        setActiveLevelIndex(0);
      }
      setAiLogs((prev) => [
        { prompt: p, summary: res.summary, reasoning: res.reasoning, engine: res.engineUsed },
        ...prev,
      ]);
      if (!customPrompt) setPromptInput('');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleConvertSketch = () => {
    if (sketchStrokes.length === 0) return;
    const res = convertSketchStrokesToBIM(project, activeLevelIndex, sketchStrokes);
    commitProject(res.project);
    setSketchStrokes([]);
    setActiveTool('select');
    setAiLogs((prev) => [
      {
        prompt: 'Hand-Drawing Sketch Recognition',
        summary: `Converted freehand sketch into ${res.wallsAdded} orthogonal walls, ${res.openingsAdded} openings, and ${Math.max(0, res.roomsDetected)} detected rooms.`,
      },
      ...prev,
    ]);
  };

  const handleSyncEngineering = () => {
    const next = structuredClone(project);
    const solarEnabled = getSolarConfig(next).enabled;
    const hvacCfg = getHVACConfig(next);
    next.levels = next.levels.map((l) => {
      const withCols = { ...l, columns: autoPlaceStructuralColumns(l) };
      return autoPopulateMEPForLevel(withCols, solarEnabled, hvacCfg.enabled, hvacCfg.ceilingFansEnabled);
    });
    next.grid = autoGenerateStructuralGrid(next.levels[0]);
    commitProject(next);
    setAiLogs((prev) => [
      {
        prompt: 'Auto-Sync Engineering Layers',
        summary: 'Recalculated Structural Column Grid, Pad Footings, Electrical & Solar PV Circuits, HVAC Units & Plumbing Risers.',
      },
      ...prev,
    ]);
  };

  const handleAddFloor = () => {
    const next = structuredClone(project);
    const top = next.levels[next.levels.length - 1];
    let cloned = structuredClone(top);
    cloned.id = uid('lvl');
    cloned.index = next.levels.length;
    cloned.name = next.levels.length === 1 ? 'First Floor' : `Floor ${next.levels.length + 1}`;
    cloned.elevation = Number((top.elevation + top.floorToFloorHeight).toFixed(2));
    const hvacCfg = getHVACConfig(next);
    cloned = autoPopulateMEPForLevel(
      cloned,
      getSolarConfig(next).enabled,
      hvacCfg.enabled,
      hvacCfg.ceilingFansEnabled
    );
    next.levels.push(cloned);
    commitProject(next);
    setActiveLevelIndex(next.levels.length - 1);
  };

  const handleDeleteSelected = () => {
    if (!selectedId || !selectedKind) return;
    const next = structuredClone(project);
    const lvl = next.levels[activeLevelIndex];
    if (selectedKind === 'wall') {
      lvl.walls = lvl.walls.filter((w) => w.id !== selectedId);
      lvl.openings = lvl.openings.filter((o) => o.wallId !== selectedId);
    } else if (selectedKind === 'opening') {
      lvl.openings = lvl.openings.filter((o) => o.id !== selectedId);
    } else if (selectedKind === 'room') {
      lvl.rooms = lvl.rooms.filter((r) => r.id !== selectedId);
    } else if (selectedKind === 'column') {
      lvl.columns = lvl.columns.filter((c) => c.id !== selectedId);
    }
    commitProject(next);
    setSelectedId(null);
    setSelectedKind(null);
  };

  const handleLoadJSON = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as BuildingProject;
        if (parsed && Array.isArray(parsed.levels)) {
          commitProject(parsed);
          setActiveLevelIndex(0);
        }
      } catch {
        // Ignore invalid JSON
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleTraceImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setTraceImageUrl(url);
    setActiveTool('sketch_wall');
    setActiveSheet('A-101');
  };

  const handleSheetVisualExport = async () => {
    const safeCode = project.meta.projectCode.replace(/[^a-zA-Z0-9_-]/g, '_') || 'ARCHSTUDIO';
    if (activeSheet === '3D-VIEW') {
      const png = await exportViewportPNG(project, activeSheet);
      if (!png) await export3DToOBJ(project);
      return;
    }
    if (activeSheet === 'Q-101') {
      await exportBOQToCSV(project, boqSummary);
      return;
    }
    await exportSVGElement(is2DSheet ? svgRef.current : null, `${safeCode}_${activeSheet}.svg`);
  };

  const handleCopyExportContent = async () => {
    if (!lastExport || lastExport.isBase64) return;
    try {
      await navigator.clipboard.writeText(lastExport.fullContent);
      setCopiedExport(true);
      setTimeout(() => setCopiedExport(false), 2000);
    } catch {
      // Ignore clipboard permission errors in restricted contexts
    }
  };

  // Look up selected element for Inspector
  const selWall = selectedKind === 'wall' ? activeLevel.walls.find((w) => w.id === selectedId) : null;
  const selOpening = selectedKind === 'opening' ? activeLevel.openings.find((o) => o.id === selectedId) : null;
  const selRoom = selectedKind === 'room' ? activeLevel.rooms.find((r) => r.id === selectedId) : null;
  const selCol = selectedKind === 'column' ? activeLevel.columns.find((c) => c.id === selectedId) : null;

  return (
    <div
      className={`flex flex-col h-screen w-screen overflow-hidden ${
        isLight ? 'theme-light bg-slate-50 text-slate-900' : 'bg-slate-950 text-slate-100'
      }`}
    >
      {/* Top Application Ribbon */}
      <header
        ref={headerMenuRef}
        className="no-print relative z-30 h-12 bg-slate-900 border-b border-slate-800 px-3 flex items-center justify-between gap-2.5 shrink-0"
      >
        {/* Left: Brand, Project Template & Floor Level */}
        <div className="flex items-center gap-1.5 min-w-0 shrink-0">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center shadow-lg shadow-cyan-500/20 shrink-0">
            <Building2 className="w-4 h-4 text-white-keep" />
          </div>
          <div className="leading-tight hidden xl:block whitespace-nowrap">
            <div className="text-xs font-bold tracking-wide text-white">ArchStudio BIM</div>
            <div className="text-[10px] text-cyan-400 font-mono hidden 2xl:block">AI CAD · 3D · MEP · BOQ</div>
          </div>

          <select
            aria-label="Project Template"
            onChange={(e) => handlePresetChange(e.target.value)}
            value={activePreset}
            className="ml-0.5 h-8 w-36 xl:w-44 bg-slate-950 border border-slate-700 rounded-lg px-2 text-xs font-medium text-slate-200 focus:outline-none focus:border-cyan-500 truncate cursor-pointer"
          >
            <option value="courtyard">Modern 3BR Courtyard (14×11m)</option>
            <option value="maldives">Maldives Tropical Residence (14.5×11m)</option>
            <option value="villa">Two-Story Family Villa (15×11m)</option>
            <option value="eco">Compact Eco Bungalow (10×8m)</option>
            <option value="blank">Blank Engineering Lot (Sketch New)</option>
          </select>

          <div className="flex items-center gap-0.5 bg-slate-950 border border-slate-800 rounded-lg p-0.5 h-8">
            {project.levels.length > 2 ? (
              <select
                aria-label="Active Floor Level"
                value={activeLevelIndex}
                onChange={(e) => setActiveLevelIndex(Number(e.target.value))}
                className="bg-transparent text-xs font-medium text-slate-200 px-1.5 py-0.5 focus:outline-none cursor-pointer"
              >
                {project.levels.map((lvl, idx) => (
                  <option key={lvl.id} value={idx}>
                    L{idx + 1} · {lvl.name.split(' ')[0]}
                  </option>
                ))}
              </select>
            ) : (
              project.levels.map((lvl, idx) => (
                <button
                  key={lvl.id}
                  onClick={() => setActiveLevelIndex(idx)}
                  className={`px-2 py-1 rounded-md text-[11px] font-medium transition ${
                    activeLevelIndex === idx
                      ? 'bg-cyan-600 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  L{idx + 1}
                </button>
              ))
            )}
            <button
              onClick={handleAddFloor}
              className="px-1.5 py-1 rounded-md text-[11px] font-semibold text-cyan-400 hover:bg-slate-800"
              title="Add Upper Floor Level"
            >
              +
            </button>
          </div>
        </div>

        {/* Center: Primary Views + Grouped Discipline Dropdowns */}
        {(() => {
          const archSubSheets: { id: ActiveSheetId; code: string; pillLabel: string; title: string; desc: string }[] = [
            { id: 'A-101', code: 'A-101', pillLabel: '2D Plan', title: '2D Floor Plan', desc: 'Room layout, dimensions & tags' },
            { id: 'A-201', code: 'A-201', pillLabel: 'A-201 Elev', title: 'Exterior Elevations', desc: 'North, South, East & West views' },
            { id: 'A-301', code: 'A-301', pillLabel: 'A-301 Sec', title: 'Cross-Section', desc: 'Roof, wall buildup & foundation cut' },
          ];
          const mepSubSheets: { id: ActiveSheetId; code: string; pillLabel: string; title: string; desc: string }[] = [
            { id: 'S-101', code: 'S-101', pillLabel: 'S-101 Struct', title: 'Structural Plan', desc: 'RC column grid, beams & footings' },
            { id: 'M-101', code: 'M-101', pillLabel: 'M-101 MEP', title: 'Coordinated MEP', desc: 'Power, lighting, AC, plumbing & PV' },
            { id: 'E-101', code: 'E-101', pillLabel: 'E-101 SLD', title: 'Electrical SLD', desc: 'Breakers, solar PV & load schedule' },
            { id: 'P-101', code: 'P-101', pillLabel: 'P-101 Plumb', title: 'Plumbing & Rainwater', desc: 'Cold supply, stacks & storm tank' },
            { id: 'H-101', code: 'H-101', pillLabel: 'H-101 HVAC', title: 'HVAC & AC Loads', desc: 'Cooling load, R32 riser & marine CDU' },
          ];
          const activeArch = activeSheet === 'A-201' || activeSheet === 'A-301';
          const activeArchItem = archSubSheets.find((a) => a.id === activeSheet);
          const activeMepItem = mepSubSheets.find((m) => m.id === activeSheet);

          return (
            <nav className="flex items-center gap-0.5 bg-slate-950 border border-slate-800 rounded-lg p-0.5 h-8 shrink-0">
              <button
                onClick={() => {
                  setActiveSheet('A-101');
                  setOpenHeaderMenu(null);
                }}
                title="Sheet A-101: 2D Architectural Floor Plan"
                className={`px-2 py-1 rounded-md text-xs font-medium whitespace-nowrap transition flex items-center gap-1 ${
                  activeSheet === 'A-101'
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/50'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/70 border border-transparent'
                }`}
              >
                <span className="font-mono text-[10px] opacity-75">A-101</span>
                <span>2D Plan</span>
              </button>

              <button
                onClick={() => {
                  setActiveSheet('3D-VIEW');
                  setOpenHeaderMenu(null);
                }}
                className={`px-2 py-1 rounded-md text-xs font-medium whitespace-nowrap transition flex items-center gap-1 ${
                  activeSheet === '3D-VIEW'
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/50'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/70 border border-transparent'
                }`}
              >
                <Box className="w-3.5 h-3.5 opacity-80" />
                <span>3D</span>
              </button>

              {/* Architectural Sheets Dropdown */}
              <div className="relative">
                <button
                  onClick={() => setOpenHeaderMenu((m) => (m === 'arch' ? null : 'arch'))}
                  aria-expanded={openHeaderMenu === 'arch'}
                  className={`px-2 py-1 rounded-md text-xs font-medium whitespace-nowrap transition flex items-center gap-1 ${
                    activeArch || openHeaderMenu === 'arch'
                      ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/50'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/70 border border-transparent'
                  }`}
                >
                  <span>{activeArch && activeArchItem ? activeArchItem.pillLabel : 'Arch'}</span>
                  <ChevronDown className="w-3 h-3 opacity-80" />
                </button>
                {openHeaderMenu === 'arch' && (
                  <div className="absolute left-0 top-full mt-2 w-64 rounded-xl bg-slate-900 border border-slate-700 shadow-2xl p-1.5 z-50 space-y-0.5">
                    <div className="px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider text-slate-400">
                      Architectural Drawings
                    </div>
                    {archSubSheets.map((item) => {
                      const isSel = activeSheet === item.id;
                      return (
                        <button
                          key={item.id}
                          onClick={() => {
                            setActiveSheet(item.id);
                            setOpenHeaderMenu(null);
                          }}
                          className={`w-full text-left px-2.5 py-2 rounded-lg flex items-start gap-2.5 transition ${
                            isSel
                              ? 'bg-cyan-500/20 text-cyan-300'
                              : 'hover:bg-slate-800 text-slate-200'
                          }`}
                        >
                          <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-800 text-cyan-400 shrink-0 mt-0.5">
                            {item.code}
                          </span>
                          <div className="min-w-0">
                            <div className="text-xs font-semibold leading-tight">{item.title}</div>
                            <div className="text-[10px] text-slate-400 truncate">{item.desc}</div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Engineering & MEP Dropdown */}
              <div className="relative">
                <button
                  onClick={() => setOpenHeaderMenu((m) => (m === 'mep' ? null : 'mep'))}
                  aria-expanded={openHeaderMenu === 'mep'}
                  className={`px-2 py-1 rounded-md text-xs font-medium whitespace-nowrap transition flex items-center gap-1 ${
                    activeMepItem || openHeaderMenu === 'mep'
                      ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/50'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/70 border border-transparent'
                  }`}
                >
                  <span>{activeMepItem ? activeMepItem.pillLabel : 'MEP & Eng'}</span>
                  {!activeMepItem && (
                    <span className="px-1 py-0.2 rounded bg-slate-800 text-[10px] font-mono text-slate-400">
                      5
                    </span>
                  )}
                  <ChevronDown className="w-3 h-3 opacity-80" />
                </button>
                {openHeaderMenu === 'mep' && (
                  <div className="absolute left-0 top-full mt-2 w-72 rounded-xl bg-slate-900 border border-slate-700 shadow-2xl p-1.5 z-50 space-y-0.5">
                    <div className="px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider text-slate-400">
                      Structural, MEP &amp; HVAC Engineering
                    </div>
                    {mepSubSheets.map((item) => {
                      const isSel = activeSheet === item.id;
                      return (
                        <button
                          key={item.id}
                          onClick={() => {
                            setActiveSheet(item.id);
                            setOpenHeaderMenu(null);
                          }}
                          className={`w-full text-left px-2.5 py-2 rounded-lg flex items-start gap-2.5 transition ${
                            isSel
                              ? 'bg-cyan-500/20 text-cyan-300'
                              : 'hover:bg-slate-800 text-slate-200'
                          }`}
                        >
                          <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-800 text-cyan-400 shrink-0 mt-0.5">
                            {item.code}
                          </span>
                          <div className="min-w-0">
                            <div className="text-xs font-semibold leading-tight">{item.title}</div>
                            <div className="text-[10px] text-slate-400 truncate">{item.desc}</div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <button
                onClick={() => {
                  setActiveSheet('Q-101');
                  setOpenHeaderMenu(null);
                }}
                title="Sheet Q-101: Bill of Quantities & Cost Take-off"
                className={`px-2 py-1 rounded-md text-xs font-medium whitespace-nowrap transition flex items-center gap-1 ${
                  activeSheet === 'Q-101'
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/50'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/70 border border-transparent'
                }`}
              >
                <span className="font-mono text-[10px] opacity-75">Q-101</span>
                <span>BOQ</span>
              </button>
            </nav>
          );
        })()}

        {/* Right: History Capsule, File & Export Dropdown, Theme & Drawing Set */}
        <div className="flex items-center gap-1.5 shrink-0">
          <div className="flex items-center bg-slate-950 border border-slate-800 rounded-lg p-0.5 h-8">
            <button
              onClick={handleUndo}
              disabled={history.length === 0}
              className="p-1.5 rounded-md hover:bg-slate-800 disabled:opacity-35 text-slate-300"
              title="Undo"
            >
              <Undo2 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={handleRedo}
              disabled={future.length === 0}
              className="p-1.5 rounded-md hover:bg-slate-800 disabled:opacity-35 text-slate-300"
              title="Redo"
            >
              <Redo2 className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="relative">
            <button
              onClick={() => setOpenHeaderMenu((m) => (m === 'export' ? null : 'export'))}
              aria-expanded={openHeaderMenu === 'export'}
              className="flex items-center gap-1.5 h-8 px-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 border border-slate-700 whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5 text-cyan-400" />
              <span>File &amp; Export</span>
              <ChevronDown className="w-3 h-3 opacity-80" />
            </button>
            {openHeaderMenu === 'export' && (
              <div className="absolute right-0 top-full mt-2 w-64 rounded-xl bg-slate-900 border border-slate-700 shadow-2xl p-1.5 z-50 space-y-0.5">
                <div className="px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider text-slate-400">
                  Project File
                </div>
                <button
                  onClick={() => {
                    exportProjectToJSON(project);
                    setOpenHeaderMenu(null);
                  }}
                  className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs text-slate-200 hover:bg-slate-800 flex items-center justify-between"
                >
                  <span className="flex items-center gap-2 font-medium">
                    <Download className="w-3.5 h-3.5 text-sky-400" /> Save BIM Project
                  </span>
                  <span className="font-mono text-[10px] text-slate-400">.JSON</span>
                </button>
                <button
                  onClick={() => {
                    jsonInputRef.current?.click();
                    setOpenHeaderMenu(null);
                  }}
                  className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs text-slate-200 hover:bg-slate-800 flex items-center justify-between"
                >
                  <span className="flex items-center gap-2 font-medium">
                    <Upload className="w-3.5 h-3.5 text-slate-400" /> Open / Load Project
                  </span>
                  <span className="font-mono text-[10px] text-slate-400">.JSON</span>
                </button>

                <div className="my-1 border-t border-slate-800" />
                <div className="px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider text-slate-400">
                  CAD, 3D &amp; QS Exports
                </div>
                <button
                  onClick={() => {
                    exportLevelToDXF(project, activeLevelIndex);
                    setOpenHeaderMenu(null);
                  }}
                  className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs text-slate-200 hover:bg-slate-800 flex items-center justify-between"
                >
                  <span className="flex items-center gap-2 font-medium">
                    <FileCode2 className="w-3.5 h-3.5 text-amber-400" /> Active Floor CAD
                  </span>
                  <span className="font-mono text-[10px] text-slate-400">.DXF</span>
                </button>
                <button
                  onClick={() => {
                    handleSheetVisualExport();
                    setOpenHeaderMenu(null);
                  }}
                  className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs text-slate-200 hover:bg-slate-800 flex items-center justify-between"
                >
                  <span className="flex items-center gap-2 font-medium">
                    <Download className="w-3.5 h-3.5 text-cyan-400" /> Active Sheet Snapshot
                  </span>
                  <span className="font-mono text-[10px] text-slate-400">
                    {activeSheet === '3D-VIEW' ? '.PNG' : activeSheet === 'Q-101' ? '.CSV' : '.SVG'}
                  </span>
                </button>
                <button
                  onClick={() => {
                    export3DToOBJ(project);
                    setOpenHeaderMenu(null);
                  }}
                  className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs text-slate-200 hover:bg-slate-800 flex items-center justify-between"
                >
                  <span className="flex items-center gap-2 font-medium">
                    <Box className="w-3.5 h-3.5 text-purple-400" /> 3D BIM Geometry
                  </span>
                  <span className="font-mono text-[10px] text-slate-400">.OBJ</span>
                </button>
                <button
                  onClick={() => {
                    exportBOQToCSV(project, boqSummary);
                    setOpenHeaderMenu(null);
                  }}
                  className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs text-slate-200 hover:bg-slate-800 flex items-center justify-between"
                >
                  <span className="flex items-center gap-2 font-medium">
                    <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" /> Bill of Quantities
                  </span>
                  <span className="font-mono text-[10px] text-slate-400">.CSV</span>
                </button>
              </div>
            )}
          </div>
          <input ref={jsonInputRef} type="file" accept=".json" onChange={handleLoadJSON} className="hidden" />

          <button
            onClick={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
            className="h-8 w-8 flex items-center justify-center rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700"
            title={isLight ? 'Switch to Dark Mode' : 'Switch to Light Mode'}
            aria-label="Toggle Light/Dark Theme"
          >
            {isLight ? <Moon className="w-3.5 h-3.5 text-slate-700" /> : <Sun className="w-3.5 h-3.5 text-amber-300" />}
          </button>

          <button
            onClick={() => {
              setOpenHeaderMenu(null);
              setShowDrawingSetModal(true);
            }}
            className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-white-keep text-xs font-semibold shadow-sm whitespace-nowrap shrink-0"
          >
            <FileStack className="w-3.5 h-3.5" /> Drawing Set
          </button>
        </div>
      </header>

      {/* Main 3-Column Workstation */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Left CAD & Hand-Drawing Tool Palette */}
        {is2DSheet &&
          (leftSidebarCollapsed ? (
            <aside className="no-print w-10 bg-slate-900/95 border-r border-slate-800 flex flex-col items-center py-2.5 gap-2 shrink-0">
              <button
                onClick={() => setLeftSidebarCollapsed(false)}
                aria-label="Expand Left Sidebar"
                title="Expand Left Sidebar"
                className="p-1.5 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
              <div className="w-6 border-t border-slate-800 my-0.5" />
              <div className="flex flex-col items-center gap-1">
                {CAD_TOOLS.map(([id, label, Icon]) => (
                  <button
                    key={id}
                    onClick={() => setActiveTool(id)}
                    title={label}
                    aria-label={label}
                    className={`p-1.5 rounded-md transition ${
                      activeTool === id
                        ? 'bg-cyan-600 text-white'
                        : 'text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                  </button>
                ))}
              </div>
            </aside>
          ) : (
            <aside className="no-print w-52 bg-slate-900/95 border-r border-slate-800 flex flex-col justify-between p-2.5 overflow-y-auto shrink-0">
              <div className="space-y-4">
                <div>
                  <div className="flex items-center justify-between px-1 mb-1.5">
                    <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
                      Precision CAD Tools
                    </div>
                    <button
                      onClick={() => setLeftSidebarCollapsed(true)}
                      aria-label="Collapse Left Sidebar"
                      title="Collapse Left Sidebar"
                      className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="grid grid-cols-1 gap-1">
                    {CAD_TOOLS.map(([id, label, Icon]) => (
                      <button
                        key={id}
                        onClick={() => setActiveTool(id)}
                        className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs font-medium transition ${
                          activeTool === id
                            ? 'bg-cyan-600 text-white'
                            : 'text-slate-300 hover:bg-slate-800'
                        }`}
                      >
                        <Icon className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate">{label}</span>
                      </button>
                    ))}
                  </div>
                </div>

              {/* AI Hand-Drawing Sketch Section */}
              <div className="pt-3 border-t border-slate-800">
                <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-purple-300 px-1 mb-1.5">
                  <Wand2 className="w-3 h-3" /> AI Hand-Sketch Pad
                </div>
                <div className="grid grid-cols-1 gap-1">
                  <button
                    onClick={() => setActiveTool('sketch_wall')}
                    className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs font-medium transition ${
                      activeTool === 'sketch_wall'
                        ? 'bg-purple-600 text-white'
                        : 'text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    <PenTool className="w-3.5 h-3.5" /> Freehand Wall Pen
                  </button>
                  <button
                    onClick={() => setActiveTool('sketch_door')}
                    className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs font-medium transition ${
                      activeTool === 'sketch_door'
                        ? 'bg-amber-600 text-white'
                        : 'text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    <DoorOpen className="w-3.5 h-3.5" /> Sketch Door Stroke
                  </button>
                  <button
                    onClick={() => setActiveTool('sketch_window')}
                    className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs font-medium transition ${
                      activeTool === 'sketch_window'
                        ? 'bg-sky-600 text-white'
                        : 'text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    <Box className="w-3.5 h-3.5" /> Sketch Window Stroke
                  </button>
                </div>

                {sketchStrokes.length > 0 && (
                  <div className="mt-2 space-y-1.5">
                    <button
                      onClick={handleConvertSketch}
                      className="w-full py-1.5 px-2 rounded-md bg-gradient-to-r from-purple-600 to-cyan-600 hover:from-purple-500 hover:to-cyan-500 text-white text-xs font-semibold shadow flex items-center justify-center gap-1.5"
                    >
                      <Sparkles className="w-3.5 h-3.5" /> Convert ({sketchStrokes.length}) → BIM
                    </button>
                    <button
                      onClick={() => setSketchStrokes([])}
                      className="w-full py-1 px-2 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px]"
                    >
                      Clear Sketch Strokes
                    </button>
                  </div>
                )}

                <div className="mt-2.5">
                  <button
                    onClick={() => traceInputRef.current?.click()}
                    className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded bg-slate-800/80 hover:bg-slate-800 border border-slate-700 text-[11px] text-slate-300"
                  >
                    <ImagePlus className="w-3.5 h-3.5 text-purple-400" /> Upload Sketch Underlay
                  </button>
                  <input
                    ref={traceInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleTraceImageUpload}
                    className="hidden"
                  />
                  {traceImageUrl && (
                    <div className="mt-2 px-1 space-y-1">
                      <div className="flex justify-between text-[10px] text-slate-400">
                        <span>Underlay Opacity</span>
                        <button onClick={() => setTraceImageUrl(null)} className="text-rose-400">
                          Remove
                        </button>
                      </div>
                      <input
                        type="range"
                        min={0.1}
                        max={0.9}
                        step={0.05}
                        value={traceOpacity}
                        onChange={(e) => setTraceOpacity(parseFloat(e.target.value))}
                        className="w-full accent-purple-500"
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-800 space-y-1.5">
              <button
                onClick={handleSyncEngineering}
                className="w-full flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-md bg-slate-800 hover:bg-slate-700 border border-cyan-500/30 text-cyan-300 text-xs font-medium"
              >
                <Zap className="w-3.5 h-3.5" /> Auto-Sync Grid & MEP
              </button>
              <button
                onClick={() => {
                  commitProject(createBlankEngineeringLot());
                  setActiveLevelIndex(0);
                  setActiveTool('sketch_wall');
                }}
                className="w-full flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-md bg-slate-950 hover:bg-slate-800 text-slate-400 text-[11px]"
              >
                <Plus className="w-3 h-3" /> Start Blank Sketch
              </button>
            </div>
          </aside>
        ))}

        {/* Center Main Viewport */}
        <main className="flex-1 min-w-0 min-h-0 relative">
          {is2DSheet && (
            <Canvas2DCAD
              project={project}
              activeLevelIndex={activeLevelIndex}
              activeSheet={activeSheet}
              activeTool={activeTool}
              selectedId={selectedId}
              onSelect={(id, kind) => {
                setSelectedId(id);
                setSelectedKind(kind ?? null);
                if (id) setRightTab('inspector');
              }}
              onUpdateProject={commitProject}
              sketchStrokes={sketchStrokes}
              onAddSketchStroke={(st) => setSketchStrokes((prev) => [...prev, st])}
              traceImageUrl={traceImageUrl}
              traceOpacity={traceOpacity}
              svgRef={svgRef}
              isLight={isLight}
            />
          )}
          {activeSheet === '3D-VIEW' && (
            <Viewport3D project={project} onUpdateProject={commitProject} isLight={isLight} />
          )}
          {(activeSheet === 'A-201' || activeSheet === 'A-301') && (
            <ElevationsAndSectionsView
              project={project}
              mode={activeSheet}
              onUpdateProject={commitProject}
              isLight={isLight}
            />
          )}
          {(activeSheet === 'E-101' || activeSheet === 'P-101' || activeSheet === 'H-101') && (
            <SchematicsView
              project={project}
              mode={activeSheet}
              onUpdateProject={commitProject}
              isLight={isLight}
            />
          )}
          {activeSheet === 'Q-101' && (
            <BOQView project={project} onUpdateProject={commitProject} isLight={isLight} />
          )}
        </main>

        {/* Right AI Architect & Engineering Inspector Panel */}
        {rightSidebarCollapsed ? (
          <aside className="no-print w-10 bg-slate-900 border-l border-slate-800 flex flex-col items-center py-2.5 gap-2 shrink-0">
            <button
              onClick={() => setRightSidebarCollapsed(false)}
              aria-label="Expand Right Sidebar"
              title="Expand Right Sidebar"
              className="p-1.5 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="w-6 border-t border-slate-800 my-0.5" />
            <button
              onClick={() => {
                setRightTab('ai');
                setRightSidebarCollapsed(false);
              }}
              aria-label="AI Architect"
              title="Open AI Architect"
              className={`p-1.5 rounded-md transition ${
                rightTab === 'ai' ? 'bg-cyan-600 text-white' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => {
                setRightTab('inspector');
                setRightSidebarCollapsed(false);
              }}
              aria-label="BIM Inspector"
              title="Open BIM Inspector"
              className={`p-1.5 rounded-md transition ${
                rightTab === 'inspector' ? 'bg-cyan-600 text-white' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              <Settings2 className="w-3.5 h-3.5" />
            </button>
          </aside>
        ) : (
          <aside className="no-print w-80 bg-slate-900 border-l border-slate-800 flex flex-col shrink-0 overflow-hidden">
            <div className="flex items-center border-b border-slate-800">
              <div className="grid grid-cols-2 flex-1 text-xs font-semibold">
                <button
                  onClick={() => setRightTab('ai')}
                  className={`py-2.5 flex items-center justify-center gap-1.5 border-b-2 transition ${
                    rightTab === 'ai'
                      ? 'border-cyan-400 text-cyan-300 bg-slate-950/40'
                      : 'border-transparent text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Sparkles className="w-3.5 h-3.5" /> AI Architect
                </button>
                <button
                  onClick={() => setRightTab('inspector')}
                  className={`py-2.5 flex items-center justify-center gap-1.5 border-b-2 transition ${
                    rightTab === 'inspector'
                      ? 'border-cyan-400 text-cyan-300 bg-slate-950/40'
                      : 'border-transparent text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Settings2 className="w-3.5 h-3.5" /> BIM Inspector
                </button>
              </div>
              <button
                onClick={() => setRightSidebarCollapsed(true)}
                aria-label="Collapse Right Sidebar"
                title="Collapse Right Sidebar"
                className="p-1.5 mr-1 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition shrink-0"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>

          {rightTab === 'ai' ? (
            <div className="flex-1 flex flex-col p-3 overflow-hidden gap-3">
              {/* Claude / Local BIM Reasoning Engine Config */}
              <div className="flex items-center justify-between text-[11px] bg-slate-950/70 border border-slate-800 rounded-md px-2.5 py-1.5 gap-1">
                <div className="flex items-center gap-1.5 text-slate-300 min-w-0">
                  <Cpu className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span className="truncate font-semibold text-emerald-300">
                    {llmConfig.provider === 'claude'
                      ? 'Claude Architectural Reasoning'
                      : llmConfig.provider === 'gemini'
                      ? 'Gemini Cloud + Solver'
                      : 'Local Spine Solver'}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {llmConfig.provider === 'claude' && (
                    <span
                      className={`px-1.5 py-0.5 rounded text-[9px] font-bold border ${
                        serverHasClaudeKey || Boolean(llmConfig.apiKey?.trim())
                          ? isLight
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                            : 'bg-emerald-950/60 text-emerald-300 border-emerald-700/60'
                          : isLight
                          ? 'bg-amber-50 text-amber-800 border-amber-300'
                          : 'bg-amber-950/60 text-amber-300 border-amber-700/60'
                      }`}
                    >
                      {serverHasClaudeKey
                        ? `Key Ready (${serverMaskedKey || 'env'})`
                        : llmConfig.apiKey?.trim()
                        ? 'Key Ready'
                        : 'Key Needed'}
                    </span>
                  )}
                  <button
                    onClick={() => setShowLLMSettings((s) => !s)}
                    className="text-cyan-400 hover:underline font-medium"
                  >
                    Config
                  </button>
                </div>
              </div>

              {showLLMSettings && (
                <div className="bg-slate-950 border border-slate-700 rounded-md p-2.5 text-xs space-y-2">
                  <label className="block">
                    <span className="text-[11px] text-slate-400">AI Reasoning Engine</span>
                    <select
                      value={llmConfig.provider}
                      onChange={(e) =>
                        setLlmConfig((c) => ({ ...c, provider: e.target.value as AILLMConfig['provider'] }))
                      }
                      className="w-full mt-1 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs"
                    >
                      <option value="claude">Anthropic Claude Reasoning (Recommended)</option>
                      <option value="local">Offline Architectural Spine Solver (Zero Key)</option>
                      <option value="gemini">Google Gemini API (Optional)</option>
                    </select>
                  </label>
                  {llmConfig.provider === 'claude' && (
                    <>
                      <label className="block">
                        <span className="text-[11px] text-slate-400">Claude Model</span>
                        <select
                          value={llmConfig.model || 'claude-sonnet-4-6'}
                          onChange={(e) => setLlmConfig((c) => ({ ...c, model: e.target.value }))}
                          className="w-full mt-1 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs"
                        >
                          <option value="claude-sonnet-4-6">Claude Sonnet 4.6 (Recommended)</option>
                          <option value="claude-sonnet-4-5-20250929">Claude Sonnet 4.5</option>
                          <option value="claude-sonnet-4-20250514">Claude Sonnet 4</option>
                          <option value="claude-haiku-4-5-20251001">Claude Haiku 4.5 (Fast)</option>
                        </select>
                      </label>
                      <div className="space-y-1">
                        <span className="text-[11px] text-slate-400 block">Anthropic Claude API Key</span>
                        <div className="flex gap-1.5">
                          <input
                            type="password"
                            placeholder={
                              serverHasClaudeKey
                                ? `Saved on server (${serverMaskedKey})`
                                : 'Paste sk-ant-... API key'
                            }
                            value={llmConfig.apiKey || ''}
                            onChange={(e) => setLlmConfig((c) => ({ ...c, apiKey: e.target.value }))}
                            className="flex-1 min-w-0 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs"
                          />
                          <button
                            type="button"
                            onClick={() => handleSaveClaudeKey(llmConfig.apiKey || '')}
                            className="px-2.5 py-1 rounded bg-cyan-600 hover:bg-cyan-500 text-white text-[11px] font-semibold shrink-0 transition"
                          >
                            Save Key
                          </button>
                        </div>
                        {keySaveStatus && (
                          <div className="text-[10px] text-emerald-400 font-mono">{keySaveStatus}</div>
                        )}
                      </div>
                    </>
                  )}
                  {llmConfig.provider === 'gemini' && (
                    <input
                      type="password"
                      placeholder="Paste Gemini API Key (optional)"
                      value={llmConfig.apiKey || ''}
                      onChange={(e) => setLlmConfig((c) => ({ ...c, apiKey: e.target.value }))}
                      className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs"
                    />
                  )}
                </div>
              )}

              {/* Prompt Input Box */}
              <div className="space-y-2">
                <textarea
                  rows={3}
                  value={promptInput}
                  onChange={(e) => setPromptInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleRunPrompt();
                    }
                  }}
                  placeholder="Describe a new building or edit current design (e.g., 'Create a 4 bedroom two story 15x11m house with garage' or 'Add a 4x3.5m study room')..."
                  className="w-full bg-slate-950 border border-slate-700 focus:border-cyan-500 rounded-lg p-2.5 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none resize-none"
                />
                <button
                  onClick={() => handleRunPrompt()}
                  disabled={isGenerating || !promptInput.trim()}
                  className="w-full py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition"
                >
                  <Send className="w-3.5 h-3.5" />
                  {isGenerating ? 'Synthesizing BIM...' : 'Generate / Apply Changes'}
                </button>
              </div>

              {/* Quick Prompt Chips */}
              <div>
                <div className="text-[10px] font-mono uppercase text-slate-400 mb-1.5">
                  One-Click Engineering Prompts
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {PROMPT_SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => handleRunPrompt(s)}
                      className="text-left text-[11px] bg-slate-800/80 hover:bg-slate-700 border border-slate-700/80 rounded px-2 py-1 text-slate-300 transition"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              {/* Activity & Engineering Change Log */}
              <div className="flex-1 overflow-y-auto border-t border-slate-800 pt-2.5 space-y-2">
                <div className="text-[10px] font-mono uppercase text-slate-400">AI Engineering Change Log</div>
                {aiLogs.map((log, i) => (
                  <div key={i} className="bg-slate-950/70 border border-slate-800 rounded p-2 text-xs space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-semibold text-cyan-300 text-[11px] truncate">{log.prompt}</div>
                      {log.engine && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-mono uppercase shrink-0">
                          {log.engine}
                        </span>
                      )}
                    </div>
                    {log.reasoning && (
                      <div
                        className={`text-[11px] border-l-2 border-indigo-500 px-2 py-1 rounded-r leading-relaxed ${
                          isLight ? 'text-slate-700 bg-indigo-50' : 'text-indigo-200 bg-indigo-950/40'
                        }`}
                      >
                        <span className={`font-semibold ${isLight ? 'text-indigo-700' : 'text-indigo-300'}`}>
                          Claude Reasoning:{' '}
                        </span>
                        {log.reasoning}
                      </div>
                    )}
                    <div className="text-slate-300 leading-relaxed">{log.summary}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            /* BIM Properties Inspector */
            <div className="flex-1 overflow-y-auto p-3 space-y-4 text-xs">
              {selectedId && (selWall || selOpening || selRoom || selCol) ? (
                <div className="bg-slate-950 border border-cyan-500/40 rounded-lg p-3 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-bold text-cyan-300 uppercase">
                      Selected {selectedKind}
                    </span>
                    <button
                      onClick={handleDeleteSelected}
                      className="flex items-center gap-1 px-2 py-1 rounded bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 text-[11px]"
                    >
                      <Trash2 className="w-3 h-3" /> Delete
                    </button>
                  </div>

                  {selWall && (
                    <div className="space-y-2">
                      <div className="text-slate-400 font-mono">Length: {wallLength(selWall).toFixed(2)} m</div>
                      <label className="block">
                        <span className="text-slate-400">Thickness (m)</span>
                        <input
                          type="number"
                          step="0.01"
                          min="0.08"
                          max="0.5"
                          value={selWall.thickness}
                          onChange={(e) => {
                            const next = structuredClone(project);
                            const w = next.levels[activeLevelIndex].walls.find((x) => x.id === selWall.id);
                            if (w) w.thickness = parseFloat(e.target.value) || 0.2;
                            commitProject(next);
                          }}
                          className="w-full mt-1 bg-slate-900 border border-slate-700 rounded px-2 py-1 font-mono"
                        />
                      </label>
                      <label className="block">
                        <span className="text-slate-400">Wall Height (m)</span>
                        <input
                          type="number"
                          step="0.05"
                          min="2.0"
                          max="6.0"
                          value={selWall.height}
                          onChange={(e) => {
                            const next = structuredClone(project);
                            const w = next.levels[activeLevelIndex].walls.find((x) => x.id === selWall.id);
                            if (w) w.height = parseFloat(e.target.value) || 3.0;
                            commitProject(next);
                          }}
                          className="w-full mt-1 bg-slate-900 border border-slate-700 rounded px-2 py-1 font-mono"
                        />
                      </label>
                      <label className="block">
                        <span className="text-slate-400">Structural Wall Material</span>
                        <select
                          value={selWall.material}
                          onChange={(e) => {
                            const next = structuredClone(project);
                            const w = next.levels[activeLevelIndex].walls.find((x) => x.id === selWall.id);
                            if (w) w.material = e.target.value as WallMaterial;
                            commitProject(next);
                          }}
                          className="w-full mt-1 bg-slate-900 border border-slate-700 rounded px-2 py-1"
                        >
                          <option value="cinder_block">Hollow Cinder Block (200/150mm · Maldives)</option>
                          <option value="coral_stone">Natural Coral Stone Masonry</option>
                          <option value="brick">Fired Kiln Brick</option>
                          <option value="cmu">Hollow Concrete Block (CMU)</option>
                          <option value="concrete">Reinforced Concrete (RC)</option>
                          <option value="timber">Engineered Timber Stud</option>
                          <option value="drywall">Gypsum Drywall Partition</option>
                        </select>
                      </label>
                      <label className="flex items-center gap-2 pt-1">
                        <input
                          type="checkbox"
                          checked={selWall.isExterior}
                          onChange={(e) => {
                            const next = structuredClone(project);
                            const w = next.levels[activeLevelIndex].walls.find((x) => x.id === selWall.id);
                            if (w) w.isExterior = e.target.checked;
                            commitProject(next);
                          }}
                        />
                        <span>Exterior Envelope Wall</span>
                      </label>
                    </div>
                  )}

                  {selOpening && (
                    <div className="space-y-2">
                      <label className="block">
                        <span className="text-slate-400">Width (m)</span>
                        <input
                          type="number"
                          step="0.1"
                          min="0.5"
                          max="4.5"
                          value={selOpening.width}
                          onChange={(e) => {
                            const next = structuredClone(project);
                            const o = next.levels[activeLevelIndex].openings.find((x) => x.id === selOpening.id);
                            if (o) o.width = parseFloat(e.target.value) || 0.9;
                            commitProject(next);
                          }}
                          className="w-full mt-1 bg-slate-900 border border-slate-700 rounded px-2 py-1 font-mono"
                        />
                      </label>
                      <label className="block">
                        <span className="text-slate-400">Height (m)</span>
                        <input
                          type="number"
                          step="0.05"
                          min="0.4"
                          max="3.0"
                          value={selOpening.height}
                          onChange={(e) => {
                            const next = structuredClone(project);
                            const o = next.levels[activeLevelIndex].openings.find((x) => x.id === selOpening.id);
                            if (o) o.height = parseFloat(e.target.value) || 2.1;
                            commitProject(next);
                          }}
                          className="w-full mt-1 bg-slate-900 border border-slate-700 rounded px-2 py-1 font-mono"
                        />
                      </label>
                      <label className="block">
                        <span className="text-slate-400">Wall Offset (0..1)</span>
                        <input
                          type="range"
                          min="0.08"
                          max="0.92"
                          step="0.02"
                          value={selOpening.offset}
                          onChange={(e) => {
                            const next = structuredClone(project);
                            const o = next.levels[activeLevelIndex].openings.find((x) => x.id === selOpening.id);
                            if (o) o.offset = parseFloat(e.target.value);
                            commitProject(next);
                          }}
                          className="w-full accent-cyan-500"
                        />
                      </label>
                    </div>
                  )}

                  {selRoom && (
                    <div className="space-y-2">
                      <div className="text-slate-400 font-mono">Area: {polygonArea(selRoom.polygon).toFixed(2)} m²</div>
                      <label className="block">
                        <span className="text-slate-400">Room Name</span>
                        <input
                          type="text"
                          value={selRoom.name}
                          onChange={(e) => {
                            const next = structuredClone(project);
                            const r = next.levels[activeLevelIndex].rooms.find((x) => x.id === selRoom.id);
                            if (r) r.name = e.target.value;
                            commitProject(next);
                          }}
                          className="w-full mt-1 bg-slate-900 border border-slate-700 rounded px-2 py-1"
                        />
                      </label>
                      <label className="block">
                        <span className="text-slate-400">Zone Category</span>
                        <select
                          value={selRoom.category}
                          onChange={(e) => {
                            const next = structuredClone(project);
                            const r = next.levels[activeLevelIndex].rooms.find((x) => x.id === selRoom.id);
                            if (r) r.category = e.target.value as RoomCategory;
                            commitProject(next);
                          }}
                          className="w-full mt-1 bg-slate-900 border border-slate-700 rounded px-2 py-1"
                        >
                          {['living', 'kitchen', 'dining', 'bedroom', 'bathroom', 'hallway', 'garage', 'office', 'utility', 'porch'].map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="block">
                        <span className="text-slate-400">Room Floor Finish</span>
                        <select
                          value={selRoom.finish}
                          onChange={(e) => {
                            const next = structuredClone(project);
                            const r = next.levels[activeLevelIndex].rooms.find((x) => x.id === selRoom.id);
                            if (r) r.finish = e.target.value as FloorFinish;
                            commitProject(next);
                          }}
                          className="w-full mt-1 bg-slate-900 border border-slate-700 rounded px-2 py-1"
                        >
                          {FLOOR_FINISH_OPTIONS.map((opt) => (
                            <option key={opt.id} value={opt.id}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  )}

                  {selCol && (
                    <div className="space-y-1 font-mono text-[11px] text-slate-300">
                      <div>Column Tag: {selCol.label}</div>
                      <div>Size: {Math.round(selCol.width * 1000)}×{Math.round(selCol.depth * 1000)} mm</div>
                      <div>Footing: {selCol.footingSize}×{selCol.footingSize} m</div>
                      <div>Rebar: {selCol.rebarSpec}</div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="bg-slate-950/60 border border-slate-800 rounded p-3 text-slate-400">
                  Click any Wall, Door, Window, Room, or Column in the 2D CAD view to inspect or edit its parameters.
                </div>
              )}

              {/* Building Roof & Envelope Settings */}
              <div className="space-y-2.5 border-t border-slate-800 pt-3">
                <div className="text-[11px] font-mono font-semibold text-slate-300 uppercase flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-cyan-400" /> Roof & Building Parameters
                </div>
                <label className="block">
                  <span className="text-slate-400">Roof Type</span>
                  <select
                    value={project.roof.type}
                    onChange={(e) => {
                      const next = structuredClone(project);
                      next.roof.type = e.target.value as RoofType;
                      commitProject(next);
                    }}
                    className="w-full mt-1 bg-slate-950 border border-slate-700 rounded px-2 py-1"
                  >
                    <option value="hip">Hip Roof</option>
                    <option value="gable">Gable Roof</option>
                    <option value="flat">Flat Parapet Roof</option>
                    <option value="shed">Shed / Mono-Pitch</option>
                  </select>
                </label>
                <label className="block">
                  <span className="text-slate-400">Roof Pitch ({project.roof.pitchDeg}°)</span>
                  <input
                    type="range"
                    min={2}
                    max={42}
                    value={project.roof.pitchDeg}
                    onChange={(e) => {
                      const next = structuredClone(project);
                      next.roof.pitchDeg = parseInt(e.target.value, 10);
                      commitProject(next);
                    }}
                    className="w-full accent-cyan-500"
                  />
                </label>
                <label className="block">
                  <span className="text-slate-400">Roof Cladding Material</span>
                  <select
                    value={project.roof.material}
                    onChange={(e) => {
                      const next = structuredClone(project);
                      next.roof.material = e.target.value as RoofMaterial;
                      commitProject(next);
                    }}
                    className="w-full mt-1 bg-slate-950 border border-slate-700 rounded px-2 py-1"
                  >
                    {ROOF_MATERIAL_OPTIONS.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {/* Solar PV & Battery Storage (IEC 62446) */}
              {(() => {
                const solar = getSolarConfig(project);
                const design = getDesignConfig(project);
                const hvac = getHVACConfig(project);
                const dcKwp = ((solar.panelCount * solar.panelWattage) / 1000).toFixed(2);
                return (
                  <>
                    <div className="p-2.5 rounded bg-slate-800/40 border border-slate-800 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="font-semibold text-amber-400 flex items-center gap-1.5">
                          <Sun className="w-3.5 h-3.5" /> Solar PV &amp; BESS
                        </div>
                        <button
                          onClick={() => {
                            const next = structuredClone(project);
                            const nextSolar = { ...getSolarConfig(next), enabled: !solar.enabled };
                            const nextHvac = getHVACConfig(next);
                            next.solar = nextSolar;
                            next.levels = next.levels.map((l) =>
                              autoPopulateMEPForLevel(l, nextSolar.enabled, nextHvac.enabled, nextHvac.ceilingFansEnabled)
                            );
                            commitProject(next);
                          }}
                          className={`px-2 py-0.5 rounded text-[10px] font-bold border transition ${
                            solar.enabled
                              ? 'bg-emerald-600 text-white border-emerald-500'
                              : 'bg-slate-900 text-slate-400 border-slate-700'
                          }`}
                        >
                          {solar.enabled ? 'PV ON' : 'PV OFF'}
                        </button>
                      </div>
                      <div className="flex items-center justify-between text-[11px] font-mono text-slate-400">
                        <span>Array: {dcKwp} kWp</span>
                        <span>Inverter: {solar.inverterKW} kW</span>
                      </div>
                      {solar.enabled && (
                        <>
                          <label className="block">
                            <span className="text-slate-400">
                              PV Panels ({solar.panelCount} × {solar.panelWattage}Wp)
                            </span>
                            <input
                              type="range"
                              min={4}
                              max={24}
                              step={2}
                              value={solar.panelCount}
                              onChange={(e) => {
                                const next = structuredClone(project);
                                next.solar = { ...getSolarConfig(next), panelCount: Number(e.target.value) };
                                commitProject(next);
                              }}
                              className="w-full accent-amber-500 mt-1"
                            />
                          </label>
                          <div className="grid grid-cols-2 gap-2">
                            <label className="block">
                              <span className="text-slate-400">Hybrid Inverter</span>
                              <select
                                value={solar.inverterKW}
                                onChange={(e) => {
                                  const next = structuredClone(project);
                                  next.solar = { ...getSolarConfig(next), inverterKW: Number(e.target.value) };
                                  commitProject(next);
                                }}
                                className="w-full mt-1 bg-slate-950 border border-slate-700 rounded px-2 py-1"
                              >
                                {[5, 6, 8, 10].map((kw) => (
                                  <option key={kw} value={kw}>
                                    {kw} kW Hybrid
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className="block">
                              <span className="text-slate-400">LiFePO4 BESS</span>
                              <select
                                value={solar.batteryKWh}
                                onChange={(e) => {
                                  const next = structuredClone(project);
                                  next.solar = { ...getSolarConfig(next), batteryKWh: Number(e.target.value) };
                                  commitProject(next);
                                }}
                                className="w-full mt-1 bg-slate-950 border border-slate-700 rounded px-2 py-1"
                              >
                                {[0, 5, 10, 15, 20].map((kwh) => (
                                  <option key={kwh} value={kwh}>
                                    {kwh === 0 ? 'Grid-Tie Only' : `${kwh} kWh`}
                                  </option>
                                ))}
                              </select>
                            </label>
                          </div>
                          <div className="grid grid-cols-2 gap-1.5 pt-1">
                            <button
                              onClick={() => setActiveSheet('E-101')}
                              className="px-2 py-1 rounded bg-slate-900 border border-slate-700 hover:border-amber-500 text-[10px] font-medium"
                            >
                              Open SLD (E-101)
                            </button>
                            <button
                              onClick={() => setActiveSheet('M-101')}
                              className="px-2 py-1 rounded bg-slate-900 border border-slate-700 hover:border-amber-500 text-[10px] font-medium"
                            >
                              Solar Wiring (M-101)
                            </button>
                          </div>
                        </>
                      )}
                    </div>

                    {/* Interior & Exterior Material Design */}
                    <div className="p-2.5 rounded bg-slate-800/40 border border-slate-800 space-y-2">
                      <div className="font-semibold text-indigo-400 flex items-center gap-1.5">
                        <Palette className="w-3.5 h-3.5" /> Interior &amp; Exterior Materials
                      </div>
                      <label className="block">
                        <span className="text-slate-400">Exterior Facade Cladding</span>
                        <select
                          value={design.exteriorFacade}
                          onChange={(e) => {
                            const next = structuredClone(project);
                            next.design = {
                              ...getDesignConfig(next),
                              exteriorFacade: e.target.value as ExteriorFacadeMaterial,
                            };
                            commitProject(next);
                          }}
                          className="w-full mt-1 bg-slate-950 border border-slate-700 rounded px-2 py-1"
                        >
                          {FACADE_MATERIAL_OPTIONS.map((opt) => (
                            <option key={opt.id} value={opt.id}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="block">
                        <span className="text-slate-400">Interior Wall Finish</span>
                        <select
                          value={design.interiorWalls}
                          onChange={(e) => {
                            const next = structuredClone(project);
                            next.design = {
                              ...getDesignConfig(next),
                              interiorWalls: e.target.value as InteriorWallMaterial,
                            };
                            commitProject(next);
                          }}
                          className="w-full mt-1 bg-slate-950 border border-slate-700 rounded px-2 py-1"
                        >
                          {INTERIOR_WALL_OPTIONS.map((opt) => (
                            <option key={opt.id} value={opt.id}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        <label className="block">
                          <span className="text-slate-400">Window Frame</span>
                          <select
                            value={design.windowFrame}
                            onChange={(e) => {
                              const next = structuredClone(project);
                              next.design = {
                                ...getDesignConfig(next),
                                windowFrame: e.target.value as WindowFrameFinish,
                              };
                              commitProject(next);
                            }}
                            className="w-full mt-1 bg-slate-950 border border-slate-700 rounded px-2 py-1"
                          >
                            <option value="anthracite">Anthracite RAL 7016</option>
                            <option value="matte_black">Matte Black Alu</option>
                            <option value="bronze">Anodized Bronze</option>
                            <option value="silver_anodized">Brushed Silver</option>
                            <option value="timber_oak">White Oak Frame</option>
                          </select>
                        </label>
                        <label className="block">
                          <span className="text-slate-400">Interior Doors</span>
                          <select
                            value={design.doorMaterial}
                            onChange={(e) => {
                              const next = structuredClone(project);
                              next.design = {
                                ...getDesignConfig(next),
                                doorMaterial: e.target.value as DoorFinishMaterial,
                              };
                              commitProject(next);
                            }}
                            className="w-full mt-1 bg-slate-950 border border-slate-700 rounded px-2 py-1"
                          >
                            <option value="walnut">American Walnut</option>
                            <option value="oak">Natural European Oak</option>
                            <option value="matte_black">Matte Charcoal</option>
                            <option value="white_lacquer">Satin White Lacquer</option>
                            <option value="frosted_glass">Frosted Glass Alu</option>
                          </select>
                        </label>
                      </div>
                      <label className="block">
                        <span className="text-slate-400">Apply Dry-Room Floor Finish (Level)</span>
                        <select
                          defaultValue=""
                          onChange={(e) => {
                            if (!e.target.value) return;
                            const finish = e.target.value as FloorFinish;
                            const next = structuredClone(project);
                            next.levels[activeLevelIndex].rooms.forEach((rm) => {
                              if (rm.category !== 'bathroom' && rm.category !== 'garage' && rm.category !== 'porch') {
                                rm.finish = finish;
                              }
                            });
                            commitProject(next);
                          }}
                          className="w-full mt-1 bg-slate-950 border border-slate-700 rounded px-2 py-1"
                        >
                          <option value="">-- Select to Apply to Dry Rooms --</option>
                          {FLOOR_FINISH_OPTIONS.map((opt) => (
                            <option key={opt.id} value={opt.id}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>

                    {/* Air Conditioning, HVAC & Maldives Tropical Climate Standard */}
                    <div className="p-2.5 rounded bg-slate-800/40 border border-slate-800 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="font-semibold text-cyan-400 flex items-center gap-1.5">
                          <Wind className="w-3.5 h-3.5" /> HVAC &amp; Climate (ASHRAE / MNBC)
                        </div>
                        <button
                          onClick={() => {
                            const next = structuredClone(project);
                            const merged = { ...getHVACConfig(next), enabled: !hvac.enabled };
                            next.hvac = merged;
                            next.levels = next.levels.map((l) =>
                              autoPopulateMEPForLevel(l, solar.enabled, merged.enabled, merged.ceilingFansEnabled)
                            );
                            commitProject(next);
                          }}
                          className={`px-2 py-0.5 rounded text-[10px] font-bold border transition ${
                            hvac.enabled
                              ? 'bg-emerald-600 text-white border-emerald-500'
                              : 'bg-slate-900 text-slate-400 border-slate-700'
                          }`}
                        >
                          {hvac.enabled ? 'AC ON' : 'AC OFF'}
                        </button>
                      </div>
                      <label className="block">
                        <span className="text-slate-400">Climate Preset Standard</span>
                        <select
                          value={hvac.climateZone}
                          onChange={(e) => {
                            const zone = e.target.value as ClimateZone;
                            const next = structuredClone(project);
                            const cur = getHVACConfig(next);
                            const merged =
                              zone === 'maldives_tropical'
                                ? { ...MALDIVES_HVAC_CONFIG, enabled: cur.enabled }
                                : zone === 'arid_desert'
                                ? {
                                    ...cur,
                                    climateZone: zone,
                                    designOutdoorTempC: 42,
                                    designHumidityPct: 30,
                                    condenserProtection: 'epoxy_gold_fin' as CondenserProtection,
                                  }
                                : zone === 'mediterranean'
                                ? {
                                    ...cur,
                                    climateZone: zone,
                                    designOutdoorTempC: 31,
                                    designHumidityPct: 65,
                                    condenserProtection: 'epoxy_gold_fin' as CondenserProtection,
                                  }
                                : {
                                    ...cur,
                                    climateZone: zone,
                                    designOutdoorTempC: 29,
                                    designHumidityPct: 58,
                                    condenserProtection: 'standard' as CondenserProtection,
                                  };
                            next.hvac = merged;
                            next.levels = next.levels.map((l) =>
                              autoPopulateMEPForLevel(l, solar.enabled, merged.enabled, merged.ceilingFansEnabled)
                            );
                            commitProject(next);
                          }}
                          className="w-full mt-1 bg-slate-950 border border-slate-700 rounded px-2 py-1"
                        >
                          <option value="maldives_tropical">Maldives Equatorial (33°C / 82% RH · MNBC)</option>
                          <option value="arid_desert">Arid Desert (42°C / 30% RH)</option>
                          <option value="mediterranean">Mediterranean Coastal (31°C / 65% RH)</option>
                          <option value="temperate">Temperate Standard (29°C / 58% RH)</option>
                        </select>
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        <label className="block">
                          <span className="text-slate-400">AC System Type</span>
                          <select
                            value={hvac.systemType}
                            onChange={(e) => {
                              const next = structuredClone(project);
                              next.hvac = { ...getHVACConfig(next), systemType: e.target.value as HVACSystemType };
                              commitProject(next);
                            }}
                            className="w-full mt-1 bg-slate-950 border border-slate-700 rounded px-2 py-1"
                          >
                            <option value="inverter_split">Inverter Split (R32)</option>
                            <option value="vrf_multi_split">VRF Multi-Split</option>
                            <option value="ducted_central">Ducted Central</option>
                          </select>
                        </label>
                        <label className="block">
                          <span className="text-slate-400">Condenser Fin</span>
                          <select
                            value={hvac.condenserProtection}
                            onChange={(e) => {
                              const next = structuredClone(project);
                              next.hvac = {
                                ...getHVACConfig(next),
                                condenserProtection: e.target.value as CondenserProtection,
                              };
                              commitProject(next);
                            }}
                            className="w-full mt-1 bg-slate-950 border border-slate-700 rounded px-2 py-1"
                          >
                            <option value="marine_blue_fin">Marine Blue-Fin</option>
                            <option value="epoxy_gold_fin">Epoxy Gold-Fin</option>
                            <option value="standard">Standard Al Fin</option>
                          </select>
                        </label>
                      </div>
                      <label className="flex items-center gap-2 text-[11px] text-slate-300">
                        <input
                          type="checkbox"
                          checked={hvac.ceilingFansEnabled}
                          onChange={(e) => {
                            const next = structuredClone(project);
                            const merged = { ...getHVACConfig(next), ceilingFansEnabled: e.target.checked };
                            next.hvac = merged;
                            next.levels = next.levels.map((l) =>
                              autoPopulateMEPForLevel(l, solar.enabled, merged.enabled, merged.ceilingFansEnabled)
                            );
                            commitProject(next);
                          }}
                        />
                        <span>Include Tropical BLDC Ceiling Fans</span>
                      </label>
                      <div className="grid grid-cols-2 gap-1.5 pt-1">
                        <button
                          onClick={() => {
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
                              const walls = l.walls.map((w) => ({
                                ...w,
                                material: 'cinder_block' as const,
                                thickness: w.isExterior ? 0.2 : 0.15,
                              }));
                              return autoPopulateMEPForLevel({ ...l, walls }, solar.enabled, true, true);
                            });
                            commitProject(next);
                          }}
                          className="px-2 py-1 rounded bg-slate-900 border border-slate-700 hover:border-cyan-500 text-[10px] font-medium"
                        >
                          Maldives Material Spec
                        </button>
                        <button
                          onClick={() => setActiveSheet('H-101')}
                          className="px-2 py-1 rounded bg-slate-900 border border-slate-700 hover:border-cyan-500 text-[10px] font-medium"
                        >
                          HVAC Schedule (H-101)
                        </button>
                      </div>
                    </div>
                  </>
                );
              })()}

              {/* Project Title Block Metadata */}
              <div className="space-y-2.5 border-t border-slate-800 pt-3">
                <div className="text-[11px] font-mono font-semibold text-slate-300 uppercase">
                  Title Block Metadata
                </div>
                <label className="block">
                  <span className="text-slate-400">Project Title</span>
                  <input
                    type="text"
                    value={project.meta.title}
                    onChange={(e) => {
                      const next = structuredClone(project);
                      next.meta.title = e.target.value;
                      commitProject(next);
                    }}
                    className="w-full mt-1 bg-slate-950 border border-slate-700 rounded px-2 py-1"
                  />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="text-slate-400">Code</span>
                    <input
                      type="text"
                      value={project.meta.projectCode}
                      onChange={(e) => {
                        const next = structuredClone(project);
                        next.meta.projectCode = e.target.value;
                        commitProject(next);
                      }}
                      className="w-full mt-1 bg-slate-950 border border-slate-700 rounded px-2 py-1 font-mono"
                    />
                  </label>
                  <label className="block">
                    <span className="text-slate-400">Currency</span>
                    <input
                      type="text"
                      value={project.meta.currency}
                      onChange={(e) => {
                        const next = structuredClone(project);
                        next.meta.currency = e.target.value || '$';
                        commitProject(next);
                      }}
                      className="w-full mt-1 bg-slate-950 border border-slate-700 rounded px-2 py-1 font-mono"
                    />
                  </label>
                </div>
              </div>
            </div>
          )}
        </aside>
        )}
      </div>

      {/* Bottom Live Engineering Telemetry Bar */}
      <footer className="no-print h-8 bg-slate-950 border-t border-slate-800 px-3 flex items-center justify-between text-[11px] font-mono text-slate-400 shrink-0">
        <div className="flex items-center gap-4">
          <span className="text-emerald-400 flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" /> BIM Synced
          </span>
          <span>
            GFA: <strong className="text-slate-200">{grossArea.toFixed(1)} m²</strong>
          </span>
          <span>
            Floors: <strong className="text-slate-200">{project.levels.length}</strong>
          </span>
          <span className="hidden sm:inline">
            Walls: <strong className="text-slate-200">{activeLevel.walls.length}</strong> · Openings:{' '}
            <strong className="text-slate-200">{activeLevel.openings.length}</strong> · Columns:{' '}
            <strong className="text-slate-200">{activeLevel.columns.length}</strong>
          </span>
        </div>

        <div className="flex items-center gap-4">
          <button
            onClick={() => setActiveSheet('E-101')}
            className="hidden md:flex items-center gap-1 text-amber-300 hover:underline"
          >
            <Zap className="w-3 h-3" /> SLD
          </button>
          <button
            onClick={() => setActiveSheet('P-101')}
            className="hidden md:flex items-center gap-1 text-sky-300 hover:underline"
          >
            <Droplets className="w-3 h-3" /> Plumbing
          </button>
          <button
            onClick={() => setActiveSheet('H-101')}
            className="hidden md:flex items-center gap-1 text-cyan-300 hover:underline"
          >
            <Wind className="w-3 h-3" /> HVAC
          </button>
          <button
            onClick={() => setActiveSheet('Q-101')}
            className="flex items-center gap-1 text-emerald-300 font-semibold hover:underline"
          >
            <Calculator className="w-3 h-3" /> Est. BOQ: {project.meta.currency}
            {boqSummary.grandTotal.toLocaleString()}
          </button>
        </div>
      </footer>

      {showDrawingSetModal && (
        <FullDrawingSetModal
          project={project}
          onClose={() => setShowDrawingSetModal(false)}
          onJumpToSheet={(sheet) => setActiveSheet(sheet)}
        />
      )}

      {/* Export Status & Download Confirmation Banner */}
      {lastExport && (
        <div
          role="status"
          aria-live="polite"
          className="no-print fixed top-14 right-4 z-50 w-96 max-w-[calc(100vw-2rem)] bg-slate-900 border border-slate-700 rounded-xl shadow-2xl p-3.5 text-xs space-y-2.5"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-start gap-2 min-w-0">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <div className="min-w-0">
                <div className="font-semibold text-slate-100 truncate">
                  Exported {lastExport.filename}
                </div>
                <div className="text-[11px] font-mono text-slate-400">
                  {lastExport.sizeBytes >= 1024
                    ? `${(lastExport.sizeBytes / 1024).toFixed(1)} KB`
                    : `${lastExport.sizeBytes} B`}{' '}
                  · {lastExport.timestamp}
                </div>
              </div>
            </div>
            <button
              onClick={() => setLastExport(null)}
              className="p-1 rounded hover:bg-slate-800 text-slate-400"
              aria-label="Dismiss Export Notice"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {lastExport.savedPath ? (
            <div className="bg-slate-950 border border-slate-800 rounded p-2 font-mono text-[11px] text-slate-300 break-all">
              <span className="text-emerald-400 font-semibold">Saved to disk: </span>
              {lastExport.savedPath}
            </div>
          ) : (
            <div className="bg-slate-950 border border-slate-800 rounded p-2 text-[11px] text-slate-300">
              Browser file download started. Use the actions below if your browser paused the download.
            </div>
          )}

          <div className="flex items-center gap-2">
            {lastExport.downloadUrl ? (
              <a
                href={lastExport.downloadUrl}
                download={lastExport.filename}
                onClick={() => retriggerBrowserDownload(lastExport)}
                className="flex-1 flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-md bg-cyan-600 hover:bg-cyan-500 text-white text-white-keep font-medium transition"
              >
                <Download className="w-3.5 h-3.5" /> Download File
              </a>
            ) : (
              <button
                onClick={() => retriggerBrowserDownload(lastExport)}
                className="flex-1 flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-md bg-cyan-600 hover:bg-cyan-500 text-white text-white-keep font-medium transition"
              >
                <Download className="w-3.5 h-3.5" /> Download File
              </button>
            )}
            {!lastExport.isBase64 && (
              <button
                onClick={handleCopyExportContent}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-medium transition"
              >
                <Copy className="w-3.5 h-3.5" /> {copiedExport ? 'Copied!' : 'Copy Content'}
              </button>
            )}
          </div>

          {recentExports.length > 1 && (
            <div className="pt-2 border-t border-slate-800 flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] font-mono text-slate-400">Recent:</span>
              {recentExports.slice(1).map((item) => (
                <button
                  key={item.filename}
                  onClick={() => setLastExport(item)}
                  className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[10px] font-mono text-cyan-300 border border-slate-700 truncate max-w-[140px]"
                  title={item.filename}
                >
                  {item.filename}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default App;
