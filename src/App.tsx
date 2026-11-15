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
  getRoofDrainageConfig,
  getSolarConfig,
  GUTTER_PROFILE_META,
  GutterProfile,
  HVACSystemType,
  InteriorWallMaterial,
  MALDIVES_HVAC_CONFIG,
  RoofMaterial,
  RoofType,
  RoomCategory,
  SelectableElementKind,
  SketchStroke,
  SolarRoofFace,
  WallMaterial,
  WATER_COLLECTION_META,
  WaterCollectionMode,
  WindowFrameFinish,
  WiringRouteMode,
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
  computeSolarArrayLayout,
  computeTotalFloorArea,
  levelBoundingBox,
  polygonArea,
  uid,
  wallLength,
} from './engine/geometry';
import {
  autoPopulateMEPForLevel,
  computePVAndEquipmentRoutes,
  getCoreElectricalNodes,
  relocateMEPNode,
} from './engine/mepEngine';
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
  Pencil,
  Plus,
  Redo2,
  RotateCcw,
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

const PROJECT_PRESET_OPTIONS: {
  id: string;
  label: string;
  dimensions: string;
  subtitle: string;
}[] = [
  { id: 'courtyard', label: 'Modern 3BR Courtyard', dimensions: '14×11m', subtitle: 'Single-story courtyard residence' },
  { id: 'maldives', label: 'Maldives Tropical Residence', dimensions: '14.5×11m', subtitle: 'MNBC coastal cinder block & R32' },
  { id: 'villa', label: 'Two-Story Family Villa', dimensions: '15×11m', subtitle: 'Double-level RC frame villa' },
  { id: 'eco', label: 'Compact Eco Bungalow', dimensions: '10×8m', subtitle: 'Efficient compact layout' },
  { id: 'blank', label: 'Blank Engineering Lot', dimensions: 'Custom', subtitle: 'Empty plot for fresh sketch' },
];

type ProjectMetaTextKey =
  | 'title'
  | 'projectCode'
  | 'client'
  | 'architect'
  | 'location'
  | 'revision'
  | 'date'
  | 'scale'
  | 'currency';

const PROJECT_META_FIELDS: {
  key: ProjectMetaTextKey;
  label: string;
  placeholder: string;
  mono?: boolean;
  fullWidth?: boolean;
}[] = [
  { key: 'title', label: 'Project Title', placeholder: 'e.g. Maldives Tropical Residence', fullWidth: true },
  { key: 'projectCode', label: 'Project Code', placeholder: 'MV-2026-301', mono: true },
  { key: 'revision', label: 'Revision', placeholder: 'R1', mono: true },
  { key: 'client', label: 'Client / Developer', placeholder: 'Client name' },
  { key: 'architect', label: 'Lead Architect / Engineer', placeholder: 'Architect / Engineer' },
  { key: 'location', label: 'Site Location', placeholder: 'City / Atoll / Country', fullWidth: true },
  { key: 'date', label: 'Issue Date', placeholder: '2026-05-01', mono: true },
  { key: 'scale', label: 'Drawing Sheet Scale', placeholder: '1:100 @ A3', mono: true },
  { key: 'currency', label: 'BOQ Currency', placeholder: '$ or MVR', mono: true },
];

export function App() {
  const [project, setProject] = useState<BuildingProject>(() => createModernCourtyardHouse());
  const [history, setHistory] = useState<BuildingProject[]>([]);
  const [future, setFuture] = useState<BuildingProject[]>([]);

  const [activeSheet, setActiveSheet] = useState<ActiveSheetId>('A-101');
  const [activeLevelIndex, setActiveLevelIndex] = useState<number>(0);
  const [activeTool, setActiveTool] = useState<CADTool>('select');

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedKind, setSelectedKind] = useState<SelectableElementKind | null>(null);

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
  const [showProjectDetailsModal, setShowProjectDetailsModal] = useState<boolean>(false);
  const [focusElecUnit, setFocusElecUnit] = useState<'mdb' | 'utility_meter' | 'solar_inv' | 'solar_bess'>('mdb');
  const [leftSidebarCollapsed, setLeftSidebarCollapsed] = useState<boolean>(false);
  const [rightSidebarCollapsed, setRightSidebarCollapsed] = useState<boolean>(false);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [activePreset, setActivePreset] = useState<string>('courtyard');
  const [openHeaderMenu, setOpenHeaderMenu] = useState<'arch' | 'mep' | 'export' | null>(null);
  const [lastExport, setLastExport] = useState<ExportResult | null>(null);
  const [recentExports, setRecentExports] = useState<ExportResult[]>([]);
  const [copiedExport, setCopiedExport] = useState<boolean>(false);
  const [historyToast, setHistoryToast] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const showToast = (msg: string) => {
    setHistoryToast(msg);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setHistoryToast(null), 2600);
  };
  const isLight = theme === 'light';

  const headerMenuRef = useRef<HTMLDivElement | null>(null);
  const kbRef = useRef<{
    handleUndo: () => void;
    handleRedo: () => void;
    handleResetProject: () => void;
    handleDeleteSelected: () => void;
    selectedId: string | null;
  }>({
    handleUndo: () => {},
    handleRedo: () => {},
    handleResetProject: () => {},
    handleDeleteSelected: () => {},
    selectedId: null,
  });

  useEffect(() => {
    const onPointerDown = (e: MouseEvent) => {
      if (headerMenuRef.current && !headerMenuRef.current.contains(e.target as Node)) {
        setOpenHeaderMenu(null);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isTextInput =
        target instanceof HTMLTextAreaElement ||
        Boolean(target?.isContentEditable) ||
        (target instanceof HTMLInputElement &&
          !['range', 'checkbox', 'radio', 'button', 'color', 'file'].includes(target.type));

      if ((e.metaKey || e.ctrlKey) && !e.altKey && !isTextInput) {
        const key = e.key.toLowerCase();
        if (!e.shiftKey && key === 'z') {
          e.preventDefault();
          kbRef.current.handleUndo();
          return;
        }
        if ((e.shiftKey && key === 'z') || (!e.shiftKey && key === 'y')) {
          e.preventDefault();
          kbRef.current.handleRedo();
          return;
        }
      }

      if (
        (e.key === 'Delete' || e.key === 'Backspace') &&
        !e.metaKey &&
        !e.ctrlKey &&
        !isTextInput &&
        !(target instanceof HTMLSelectElement)
      ) {
        if (kbRef.current.selectedId) {
          e.preventDefault();
          kbRef.current.handleDeleteSelected();
          return;
        }
      }

      if (e.key === 'Escape') {
        setOpenHeaderMenu(null);
        setShowProjectDetailsModal(false);
        setShowDrawingSetModal(false);
        setSelectedId(null);
        setSelectedKind(null);
        setActiveTool('select');
      }
    };
    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
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
    setHistory((h) => [...h.slice(-49), project]);
    setFuture([]);
    setProject(next);
  };

  const updateProjectMeta = <K extends keyof BuildingProject['meta']>(
    field: K,
    value: BuildingProject['meta'][K]
  ) => {
    const next = structuredClone(project);
    next.meta[field] = value;
    commitProject(next);
  };

  const updateFloorLevel = (
    idx: number,
    patch: Partial<Pick<BuildingProject['levels'][number], 'name' | 'elevation' | 'floorToFloorHeight'>>
  ) => {
    const next = structuredClone(project);
    const target = next.levels[idx];
    if (!target) return;
    Object.assign(target, patch);
    commitProject(next);
  };

  const canUndo = history.length > 0 || sketchStrokes.length > 0;

  const handleUndo = () => {
    if (sketchStrokes.length > 0) {
      setSketchStrokes((s) => s.slice(0, -1));
      showToast('Undid sketch stroke (⌘Z)');
      return;
    }
    if (history.length === 0) return;
    const prev = history[history.length - 1];
    setHistory((h) => h.slice(0, -1));
    setFuture((f) => [project, ...f]);
    setProject(prev);
    setActiveLevelIndex((idx) => Math.min(idx, Math.max(0, prev.levels.length - 1)));
    showToast(`Undid last action (⌘Z) · ${history.length - 1} left`);
  };

  const handleRedo = () => {
    if (future.length === 0) return;
    const next = future[0];
    setFuture((f) => f.slice(1));
    setHistory((h) => [...h.slice(-49), project]);
    setProject(next);
    setActiveLevelIndex((idx) => Math.min(idx, Math.max(0, next.levels.length - 1)));
    showToast('Redid action (⇧⌘Z)');
  };

  const createPresetByKey = (presetKey: string): BuildingProject => {
    if (presetKey === 'maldives') return createMaldivesTropicalVilla();
    if (presetKey === 'courtyard') return createModernCourtyardHouse();
    if (presetKey === 'villa') return createTwoStoryVilla();
    if (presetKey === 'eco') return createCompactEcoBungalow();
    return createBlankEngineeringLot();
  };

  const handleResetProject = () => {
    const fresh = createPresetByKey(activePreset);
    commitProject(fresh);
    setActiveLevelIndex(0);
    setSelectedId(null);
    setSelectedKind(null);
    setSketchStrokes([]);
    setActiveTool('select');
    setAiLogs((l) => [
      { prompt: `Reset Template: ${fresh.meta.title}`, summary: 'Restored default template geometry, structural grid, MEP & BOQ (undoable with ⌘Z).' },
      ...l,
    ]);
    showToast('Reset project to default template (press ⌘Z to undo)');
  };

  const boqSummary = useMemo(() => calculateBOQ(project), [project]);
  const grossArea = useMemo(() => computeTotalFloorArea(project), [project]);
  const activeLevel = project.levels[activeLevelIndex] ?? project.levels[0];

  const is2DSheet = activeSheet === 'A-101' || activeSheet === 'S-101' || activeSheet === 'M-101';

  const handlePresetChange = (presetKey: string) => {
    setActivePreset(presetKey);
    const next = createPresetByKey(presetKey);

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
    } else if (selectedKind === 'furniture') {
      lvl.furniture = lvl.furniture.filter((f) => f.id !== selectedId);
    } else if (selectedKind === 'mep_node') {
      lvl.mepNodes = lvl.mepNodes.filter((n) => n.id !== selectedId);
    } else if (selectedKind === 'solar_panel') {
      const panelIdx = Number(selectedId.replace('solar_panel_', ''));
      const curSolar = getSolarConfig(next);
      const nextOffsets = { ...(curSolar.panelOffsets ?? {}) };
      delete nextOffsets[panelIdx];
      next.solar = { ...curSolar, panelOffsets: nextOffsets };
    } else if (selectedKind === 'solar_array') {
      next.solar = { ...getSolarConfig(next), enabled: false };
    }
    commitProject(next);
    setSelectedId(null);
    setSelectedKind(null);
    showToast('Deleted selected element (⌘Z to undo)');
  };

  kbRef.current = {
    handleUndo,
    handleRedo,
    handleResetProject,
    handleDeleteSelected,
    selectedId,
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
  const selFurniture = selectedKind === 'furniture' ? activeLevel.furniture.find((f) => f.id === selectedId) : null;
  const selMepNode = selectedKind === 'mep_node' ? activeLevel.mepNodes.find((n) => n.id === selectedId) : null;
  const selSolarPanelIndex =
    selectedKind === 'solar_panel' && selectedId?.startsWith('solar_panel_')
      ? Number(selectedId.replace('solar_panel_', ''))
      : null;

  return (
    <div
      className={`flex flex-col h-screen w-screen overflow-hidden ${
        isLight ? 'theme-light bg-slate-50 text-slate-900' : 'bg-slate-950 text-slate-100'
      }`}
    >
      {/* Top Application Ribbon */}
      <header
        ref={headerMenuRef}
        className="no-print relative z-30 h-12 bg-slate-900 border-b border-slate-800 px-2.5 flex items-center justify-between gap-1.5 shrink-0"
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

          <div className="ml-0.5 flex items-center gap-1 h-8 bg-slate-950 border border-slate-700/80 rounded-lg pl-2 pr-1">
            <button
              type="button"
              onClick={() => setShowProjectDetailsModal(true)}
              className="flex items-center gap-1.5 min-w-0 max-w-[130px] 2xl:max-w-[200px] text-left focus:outline-none"
              title={`${project.meta.title} (${project.meta.projectCode}) — Click to edit project details`}
            >
              <span className="text-xs font-semibold text-slate-100 truncate leading-none">
                {project.meta.title}
              </span>
              <span className="hidden 2xl:inline-block text-[10px] font-mono text-cyan-400 bg-cyan-500/20 border border-cyan-500/30 px-1.5 py-0.5 rounded leading-none shrink-0">
                {project.meta.projectCode}
              </span>
            </button>
            <button
              type="button"
              aria-label="Edit Project Details"
              title="Edit Project Details, Title Block & Template"
              onClick={() => setShowProjectDetailsModal(true)}
              className="w-6 h-6 rounded-md flex items-center justify-center text-slate-400 hover:text-cyan-300 hover:bg-slate-800 transition-colors shrink-0"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
          </div>

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

        {/* Right: History & Reset Capsule, File & Export Dropdown, Theme & Drawing Set */}
        <div className="flex items-center gap-1.5 shrink-0">
          <div className="flex items-center bg-slate-950 border border-slate-800 rounded-lg p-0.5 h-8 gap-0.5">
            <button
              type="button"
              onClick={handleUndo}
              disabled={!canUndo}
              className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium hover:bg-slate-800 disabled:opacity-35 text-slate-200 transition whitespace-nowrap"
              title="Undo last action (⌘Z / Ctrl+Z)"
            >
              <Undo2 className="w-3.5 h-3.5" />
              <span>Undo</span>
              <span className="font-mono text-[10px] opacity-70">⌘Z</span>
              {history.length > 0 && (
                <span className="px-1 rounded bg-cyan-500/20 text-cyan-300 font-mono text-[10px] leading-tight">
                  {history.length}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={handleRedo}
              disabled={future.length === 0}
              className="p-1.5 rounded-md hover:bg-slate-800 disabled:opacity-35 text-slate-300 transition"
              title="Redo (⇧⌘Z / Ctrl+Y)"
              aria-label="Redo"
            >
              <Redo2 className="w-3.5 h-3.5" />
            </button>
            <span className="h-4 w-px bg-slate-800 mx-0.5" />
            <button
              type="button"
              onClick={handleResetProject}
              className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium hover:bg-rose-500/15 hover:text-rose-300 text-slate-300 transition whitespace-nowrap"
              title="Reset project to default template (undoable with ⌘Z)"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset</span>
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
            className="flex items-center gap-1.5 h-8 px-2.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-white-keep text-xs font-semibold shadow-sm whitespace-nowrap shrink-0"
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
              onSwitchSheet={(sheet) => setActiveSheet(sheet)}
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
              onSwitchSheet={(sheet) => setActiveSheet(sheet)}
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
              {selectedId &&
              (selWall ||
                selOpening ||
                selRoom ||
                selCol ||
                selFurniture ||
                selMepNode ||
                selectedKind === 'solar_array' ||
                selSolarPanelIndex !== null) ? (
                <div className="bg-slate-950 border border-cyan-500/40 rounded-lg p-3 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-bold text-cyan-300 uppercase">
                      {selSolarPanelIndex !== null
                        ? `Solar Panel #${selSolarPanelIndex + 1}`
                        : selectedKind === 'solar_array'
                        ? 'Solar PV Array'
                        : selectedKind === 'mep_node'
                        ? 'MEP / Equipment'
                        : `Selected ${selectedKind}`}
                    </span>
                    <button
                      onClick={handleDeleteSelected}
                      className="flex items-center gap-1 px-2 py-1 rounded bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 text-[11px]"
                    >
                      <Trash2 className="w-3 h-3" />{' '}
                      {selectedKind === 'solar_panel'
                        ? 'Reset Panel'
                        : selectedKind === 'solar_array'
                        ? 'Disable PV'
                        : 'Delete'}
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
                    <div className="space-y-2 font-mono text-[11px] text-slate-300">
                      <div>Column Tag: {selCol.label} · {Math.round(selCol.width * 1000)}×{Math.round(selCol.depth * 1000)} mm</div>
                      <div>Rebar: {selCol.rebarSpec}</div>
                      <div className="grid grid-cols-2 gap-2">
                        <label className="block">
                          <span className="text-slate-400">Pos X (m)</span>
                          <input
                            type="number"
                            step="0.1"
                            value={selCol.position.x}
                            onChange={(e) => {
                              const next = structuredClone(project);
                              const col = next.levels[activeLevelIndex].columns.find((c) => c.id === selCol.id);
                              if (col) col.position.x = parseFloat(e.target.value) || 0;
                              commitProject(next);
                            }}
                            className="w-full mt-1 bg-slate-900 border border-slate-700 rounded px-2 py-1"
                          />
                        </label>
                        <label className="block">
                          <span className="text-slate-400">Pos Y (m)</span>
                          <input
                            type="number"
                            step="0.1"
                            value={selCol.position.y}
                            onChange={(e) => {
                              const next = structuredClone(project);
                              const col = next.levels[activeLevelIndex].columns.find((c) => c.id === selCol.id);
                              if (col) col.position.y = parseFloat(e.target.value) || 0;
                              commitProject(next);
                            }}
                            className="w-full mt-1 bg-slate-900 border border-slate-700 rounded px-2 py-1"
                          />
                        </label>
                      </div>
                      <label className="block">
                        <span className="text-slate-400">Footing Size (m)</span>
                        <input
                          type="number"
                          step="0.1"
                          min="0.6"
                          max="3.0"
                          value={selCol.footingSize}
                          onChange={(e) => {
                            const next = structuredClone(project);
                            const col = next.levels[activeLevelIndex].columns.find((c) => c.id === selCol.id);
                            if (col) col.footingSize = parseFloat(e.target.value) || 1.2;
                            commitProject(next);
                          }}
                          className="w-full mt-1 bg-slate-900 border border-slate-700 rounded px-2 py-1"
                        />
                      </label>
                    </div>
                  )}

                  {selFurniture && (
                    <div className="space-y-2">
                      <div className="text-slate-400 font-mono uppercase text-[10px]">
                        Fixture: {selFurniture.type.replace('_', ' ')}
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <label className="block">
                          <span className="text-slate-400">Pos X (m)</span>
                          <input
                            type="number"
                            step="0.1"
                            value={selFurniture.position.x}
                            onChange={(e) => {
                              const next = structuredClone(project);
                              const f = next.levels[activeLevelIndex].furniture.find((x) => x.id === selFurniture.id);
                              if (f) f.position.x = parseFloat(e.target.value) || 0;
                              commitProject(next);
                            }}
                            className="w-full mt-1 bg-slate-900 border border-slate-700 rounded px-2 py-1 font-mono"
                          />
                        </label>
                        <label className="block">
                          <span className="text-slate-400">Pos Y (m)</span>
                          <input
                            type="number"
                            step="0.1"
                            value={selFurniture.position.y}
                            onChange={(e) => {
                              const next = structuredClone(project);
                              const f = next.levels[activeLevelIndex].furniture.find((x) => x.id === selFurniture.id);
                              if (f) f.position.y = parseFloat(e.target.value) || 0;
                              commitProject(next);
                            }}
                            className="w-full mt-1 bg-slate-900 border border-slate-700 rounded px-2 py-1 font-mono"
                          />
                        </label>
                      </div>
                      <div>
                        <span className="text-slate-400 block mb-1">Rotation ({selFurniture.rotation}°)</span>
                        <div className="grid grid-cols-4 gap-1">
                          {[0, 90, 180, 270].map((deg) => (
                            <button
                              key={deg}
                              onClick={() => {
                                const next = structuredClone(project);
                                const f = next.levels[activeLevelIndex].furniture.find((x) => x.id === selFurniture.id);
                                if (f) f.rotation = deg;
                                commitProject(next);
                              }}
                              className={`py-1 rounded font-mono text-[10px] border ${
                                selFurniture.rotation === deg
                                  ? 'bg-cyan-600 text-white border-cyan-500'
                                  : 'bg-slate-900 text-slate-300 border-slate-700'
                              }`}
                            >
                              {deg}°
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <label className="block">
                          <span className="text-slate-400">Width (m)</span>
                          <input
                            type="number"
                            step="0.1"
                            min="0.3"
                            max="5"
                            value={selFurniture.width}
                            onChange={(e) => {
                              const next = structuredClone(project);
                              const f = next.levels[activeLevelIndex].furniture.find((x) => x.id === selFurniture.id);
                              if (f) f.width = parseFloat(e.target.value) || 0.8;
                              commitProject(next);
                            }}
                            className="w-full mt-1 bg-slate-900 border border-slate-700 rounded px-2 py-1 font-mono"
                          />
                        </label>
                        <label className="block">
                          <span className="text-slate-400">Depth (m)</span>
                          <input
                            type="number"
                            step="0.1"
                            min="0.3"
                            max="5"
                            value={selFurniture.depth}
                            onChange={(e) => {
                              const next = structuredClone(project);
                              const f = next.levels[activeLevelIndex].furniture.find((x) => x.id === selFurniture.id);
                              if (f) f.depth = parseFloat(e.target.value) || 0.8;
                              commitProject(next);
                            }}
                            className="w-full mt-1 bg-slate-900 border border-slate-700 rounded px-2 py-1 font-mono"
                          />
                        </label>
                      </div>
                    </div>
                  )}

                  {selMepNode && (
                    <div className="space-y-2">
                      <div className="text-slate-400 font-mono text-[10px] uppercase">
                        {selMepNode.kind.replace('_', ' ')} · {selMepNode.system}
                      </div>
                      <label className="block">
                        <span className="text-slate-400">Equipment Tag / Label</span>
                        <input
                          type="text"
                          value={selMepNode.label ?? ''}
                          onChange={(e) => {
                            const next = structuredClone(project);
                            const n = next.levels[activeLevelIndex].mepNodes.find((x) => x.id === selMepNode.id);
                            if (n) n.label = e.target.value;
                            commitProject(next);
                          }}
                          className="w-full mt-1 bg-slate-900 border border-slate-700 rounded px-2 py-1 font-mono"
                        />
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        <label className="block">
                          <span className="text-slate-400">Pos X (m)</span>
                          <input
                            type="number"
                            step="0.1"
                            value={selMepNode.position.x}
                            onChange={(e) => {
                              const next = structuredClone(project);
                              const lvl = next.levels[activeLevelIndex];
                              const sl = getSolarConfig(next).enabled ? computeSolarArrayLayout(next) : null;
                              relocateMEPNode(
                                lvl,
                                selMepNode.id,
                                { x: parseFloat(e.target.value) || 0, y: selMepNode.position.y },
                                sl ? { x: sl.bounds.minX, y: sl.bounds.centerY } : undefined
                              );
                              commitProject(next);
                            }}
                            className="w-full mt-1 bg-slate-900 border border-slate-700 rounded px-2 py-1 font-mono"
                          />
                        </label>
                        <label className="block">
                          <span className="text-slate-400">Pos Y (m)</span>
                          <input
                            type="number"
                            step="0.1"
                            value={selMepNode.position.y}
                            onChange={(e) => {
                              const next = structuredClone(project);
                              const lvl = next.levels[activeLevelIndex];
                              const sl = getSolarConfig(next).enabled ? computeSolarArrayLayout(next) : null;
                              relocateMEPNode(
                                lvl,
                                selMepNode.id,
                                { x: selMepNode.position.x, y: parseFloat(e.target.value) || 0 },
                                sl ? { x: sl.bounds.minX, y: sl.bounds.centerY } : undefined
                              );
                              commitProject(next);
                            }}
                            className="w-full mt-1 bg-slate-900 border border-slate-700 rounded px-2 py-1 font-mono"
                          />
                        </label>
                      </div>
                    </div>
                  )}

                  {(selectedKind === 'solar_array' || selSolarPanelIndex !== null) && (() => {
                    const s = getSolarConfig(project);
                    const pOff = selSolarPanelIndex !== null ? s.panelOffsets?.[selSolarPanelIndex] ?? { x: 0, y: 0 } : null;
                    return (
                      <div className="space-y-2">
                        <div className="grid grid-cols-2 gap-2">
                          <label className="block">
                            <span className="text-slate-400">Roof Slope</span>
                            <select
                              value={s.roofFace ?? 'south'}
                              onChange={(e) => {
                                const next = structuredClone(project);
                                next.solar = {
                                  ...getSolarConfig(next),
                                  roofFace: e.target.value as SolarRoofFace,
                                  offsetX: 0,
                                  offsetY: 0,
                                };
                                commitProject(next);
                              }}
                              className="w-full mt-1 bg-slate-900 border border-slate-700 rounded px-2 py-1"
                            >
                              <option value="south">South Slope</option>
                              <option value="north">North Slope</option>
                              <option value="east">East Slope</option>
                              <option value="west">West Slope</option>
                              <option value="flat_center">Roof Center</option>
                            </select>
                          </label>
                          <label className="block">
                            <span className="text-slate-400">Columns</span>
                            <select
                              value={s.columns ?? 0}
                              onChange={(e) => {
                                const next = structuredClone(project);
                                next.solar = { ...getSolarConfig(next), columns: Number(e.target.value) };
                                commitProject(next);
                              }}
                              className="w-full mt-1 bg-slate-900 border border-slate-700 rounded px-2 py-1"
                            >
                              <option value={0}>Auto-Fit</option>
                              {[2, 3, 4, 5, 6, 7, 8].map((c) => (
                                <option key={c} value={c}>
                                  {c} Cols
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <label className="block">
                            <span className="text-slate-400">Array Offset X (m)</span>
                            <input
                              type="number"
                              step="0.1"
                              value={s.offsetX ?? 0}
                              onChange={(e) => {
                                const next = structuredClone(project);
                                next.solar = { ...getSolarConfig(next), offsetX: parseFloat(e.target.value) || 0 };
                                commitProject(next);
                              }}
                              className="w-full mt-1 bg-slate-900 border border-slate-700 rounded px-2 py-1 font-mono"
                            />
                          </label>
                          <label className="block">
                            <span className="text-slate-400">Array Offset Y (m)</span>
                            <input
                              type="number"
                              step="0.1"
                              value={s.offsetY ?? 0}
                              onChange={(e) => {
                                const next = structuredClone(project);
                                next.solar = { ...getSolarConfig(next), offsetY: parseFloat(e.target.value) || 0 };
                                commitProject(next);
                              }}
                              className="w-full mt-1 bg-slate-900 border border-slate-700 rounded px-2 py-1 font-mono"
                            />
                          </label>
                        </div>

                        {selSolarPanelIndex !== null && pOff && (
                          <div className="p-2 rounded bg-slate-900 border border-amber-500/40 space-y-1.5">
                            <div className="text-[10px] font-mono font-bold text-amber-300">
                              PANEL #{selSolarPanelIndex + 1} INDIVIDUAL OFFSET
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <label className="block">
                                <span className="text-slate-400">dX (m)</span>
                                <input
                                  type="number"
                                  step="0.1"
                                  value={pOff.x}
                                  onChange={(e) => {
                                    const next = structuredClone(project);
                                    const cur = getSolarConfig(next);
                                    next.solar = {
                                      ...cur,
                                      panelOffsets: {
                                        ...(cur.panelOffsets ?? {}),
                                        [selSolarPanelIndex]: { x: parseFloat(e.target.value) || 0, y: pOff.y },
                                      },
                                    };
                                    commitProject(next);
                                  }}
                                  className="w-full mt-0.5 bg-slate-950 border border-slate-700 rounded px-2 py-1 font-mono"
                                />
                              </label>
                              <label className="block">
                                <span className="text-slate-400">dY (m)</span>
                                <input
                                  type="number"
                                  step="0.1"
                                  value={pOff.y}
                                  onChange={(e) => {
                                    const next = structuredClone(project);
                                    const cur = getSolarConfig(next);
                                    next.solar = {
                                      ...cur,
                                      panelOffsets: {
                                        ...(cur.panelOffsets ?? {}),
                                        [selSolarPanelIndex]: { x: pOff.x, y: parseFloat(e.target.value) || 0 },
                                      },
                                    };
                                    commitProject(next);
                                  }}
                                  className="w-full mt-0.5 bg-slate-950 border border-slate-700 rounded px-2 py-1 font-mono"
                                />
                              </label>
                            </div>
                          </div>
                        )}

                        <div className="flex gap-1.5 pt-1">
                          <button
                            onClick={() => {
                              const next = structuredClone(project);
                              const cur = getSolarConfig(next);
                              next.solar = { ...cur, rotationDeg: ((cur.rotationDeg ?? 0) + 90) % 360 };
                              commitProject(next);
                            }}
                            className="flex-1 px-2 py-1 rounded bg-slate-900 border border-slate-700 hover:border-cyan-500 text-[10px] font-medium"
                          >
                            Rotate 90° ({s.rotationDeg ?? 0}°)
                          </button>
                          <button
                            onClick={() => {
                              const next = structuredClone(project);
                              next.solar = {
                                ...getSolarConfig(next),
                                offsetX: 0,
                                offsetY: 0,
                                rotationDeg: 0,
                                columns: 0,
                                panelOffsets: {},
                              };
                              commitProject(next);
                            }}
                            className="px-2 py-1 rounded bg-slate-900 border border-slate-700 hover:border-rose-500 text-[10px] text-rose-300 font-medium"
                          >
                            Reset All
                          </button>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              ) : (
                <div className="bg-slate-950/60 border border-slate-800 rounded p-3 text-slate-400">
                  Click or drag any Wall, Door, Window, Room, Column, Furniture fixture, Solar PV Panel/Array, or MEP node in the 2D CAD view to inspect or reposition it.
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
                <label className="block">
                  <span className="text-slate-400">Eave Overhang ({project.roof.overhang.toFixed(2)} m)</span>
                  <input
                    type="range"
                    min={0.2}
                    max={1.2}
                    step={0.05}
                    value={project.roof.overhang}
                    onChange={(e) => {
                      const next = structuredClone(project);
                      next.roof.overhang = parseFloat(e.target.value);
                      commitProject(next);
                    }}
                    className="w-full accent-cyan-500"
                  />
                </label>

                {/* Roof Gutters, Downpipes & Rainwater Collection / Redirect Options */}
                {(() => {
                  const drainage = getRoofDrainageConfig(project.roof);
                  const collectMeta = WATER_COLLECTION_META[drainage.waterCollectionMode];
                  return (
                    <div className="p-2.5 rounded bg-slate-800/40 border border-slate-800 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-mono font-semibold text-sky-300 uppercase">
                          Gutters & Rainwater Redirect
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            const next = structuredClone(project);
                            next.roof.gutterEnabled = !drainage.gutterEnabled;
                            commitProject(next);
                          }}
                          className={`px-2 py-0.5 rounded font-mono text-[10px] ${
                            drainage.gutterEnabled
                              ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                              : 'bg-slate-800 text-slate-400'
                          }`}
                        >
                          {drainage.gutterEnabled ? 'ON' : 'OFF'}
                        </button>
                      </div>
                      {drainage.gutterEnabled && (
                        <>
                          <label className="block">
                            <span className="text-slate-400">Gutter Profile</span>
                            <select
                              value={drainage.gutterProfile}
                              onChange={(e) => {
                                const next = structuredClone(project);
                                next.roof.gutterProfile = e.target.value as GutterProfile;
                                commitProject(next);
                              }}
                              className="w-full mt-0.5 bg-slate-950 border border-slate-700 rounded px-2 py-1"
                            >
                              {(Object.keys(GUTTER_PROFILE_META) as GutterProfile[]).map((gp) => (
                                <option key={gp} value={gp}>
                                  {GUTTER_PROFILE_META[gp].label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="block">
                            <span className="text-slate-400">Water Collection / Redirect</span>
                            <select
                              value={drainage.waterCollectionMode}
                              onChange={(e) => {
                                const next = structuredClone(project);
                                next.roof.waterCollectionMode = e.target.value as WaterCollectionMode;
                                commitProject(next);
                              }}
                              className="w-full mt-0.5 bg-slate-950 border border-slate-700 rounded px-2 py-1"
                            >
                              {(Object.keys(WATER_COLLECTION_META) as WaterCollectionMode[]).map((wm) => (
                                <option key={wm} value={wm}>
                                  {WATER_COLLECTION_META[wm].label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <div className="text-[10px] text-slate-400 leading-snug bg-slate-950/60 border border-slate-800 rounded p-1.5">
                            {collectMeta.desc}
                          </div>
                          <div className="grid grid-cols-2 gap-1.5">
                            <label className="block">
                              <span className="text-slate-400">Downpipes (RWP)</span>
                              <select
                                value={drainage.downpipeCount}
                                onChange={(e) => {
                                  const next = structuredClone(project);
                                  next.roof.downpipeCount = parseInt(e.target.value, 10);
                                  commitProject(next);
                                }}
                                className="w-full mt-0.5 bg-slate-950 border border-slate-700 rounded px-2 py-1 font-mono"
                              >
                                {[2, 4, 6, 8].map((n) => (
                                  <option key={n} value={n}>
                                    {n}× Ø100
                                  </option>
                                ))}
                              </select>
                            </label>
                            {(drainage.waterCollectionMode === 'harvesting_tank' ||
                              drainage.waterCollectionMode === 'underground_cistern') && (
                              <label className="block">
                                <span className="text-slate-400">Tank Volume</span>
                                <select
                                  value={drainage.harvestingTankLiters}
                                  onChange={(e) => {
                                    const next = structuredClone(project);
                                    next.roof.harvestingTankLiters = parseInt(e.target.value, 10);
                                    commitProject(next);
                                  }}
                                  className="w-full mt-0.5 bg-slate-950 border border-slate-700 rounded px-2 py-1 font-mono"
                                >
                                  {[1500, 3500, 5000, 10000].map((v) => (
                                    <option key={v} value={v}>
                                      {v.toLocaleString()} L
                                    </option>
                                  ))}
                                </select>
                              </label>
                            )}
                          </div>
                          <label className="flex items-center gap-2 text-[11px] text-slate-300 cursor-pointer pt-0.5">
                            <input
                              type="checkbox"
                              checked={drainage.firstFlushDiverter}
                              onChange={(e) => {
                                const next = structuredClone(project);
                                next.roof.firstFlushDiverter = e.target.checked;
                                commitProject(next);
                              }}
                              className="accent-sky-500"
                            />
                            First-Flush Diverter & Leaf Screen
                          </label>
                        </>
                      )}
                    </div>
                  );
                })()}
              </div>

              {/* Electrical Panels, Utility Meter, Inverter Relocation & Wiring Plan */}
              {(() => {
                const groundLvl = project.levels[0];
                if (!groundLvl) return null;
                const core = getCoreElectricalNodes(groundLvl);
                const gBB = levelBoundingBox(groundLvl);
                const solarCfg = getSolarConfig(project);
                const unitNode =
                  focusElecUnit === 'mdb'
                    ? core.mdb
                    : focusElecUnit === 'utility_meter'
                    ? core.meter
                    : focusElecUnit === 'solar_inv'
                    ? core.inverter
                    : core.bess;
                const moveUnitTo = (nx: number, ny: number) => {
                  const next = structuredClone(project);
                  const lvl0 = next.levels[0];
                  if (!lvl0) return;
                  const sl = getSolarConfig(next).enabled ? computeSolarArrayLayout(next) : null;
                  relocateMEPNode(
                    lvl0,
                    focusElecUnit,
                    { x: Number(nx.toFixed(2)), y: Number(ny.toFixed(2)) },
                    sl ? { x: sl.bounds.minX, y: sl.bounds.centerY } : undefined
                  );
                  commitProject(next);
                };
                const snapWall = (side: 'west' | 'north' | 'east' | 'south') => {
                  const slot = focusElecUnit === 'mdb' ? 0.55 : focusElecUnit === 'utility_meter' ? 1.4 : focusElecUnit === 'solar_inv' ? 2.35 : 3.15;
                  const inOut = focusElecUnit === 'mdb' ? 0.35 : -0.14;
                  if (side === 'west') moveUnitTo(gBB.minX + inOut, gBB.minY + slot);
                  else if (side === 'north') moveUnitTo(gBB.minX + slot, gBB.minY + inOut);
                  else if (side === 'east') moveUnitTo(gBB.maxX - inOut, gBB.minY + slot);
                  else moveUnitTo((gBB.minX + gBB.maxX) / 2 - 1.2 + slot * 0.5, gBB.maxY - inOut);
                };
                const routes = computePVAndEquipmentRoutes(project, 0);
                const dcRouteMode: WiringRouteMode = solarCfg.dcRouteMode ?? 'auto';
                const acRouteMode: WiringRouteMode = solarCfg.acRouteMode ?? 'auto';
                const conduitElev = solarCfg.conduitElevationOffset ?? 0;
                const updateSolarWiring = (patch: Partial<typeof solarCfg>) => {
                  const next = structuredClone(project);
                  next.solar = { ...getSolarConfig(next), ...patch };
                  commitProject(next);
                };
                const resnapWires = () => {
                  const next = structuredClone(project);
                  next.solar = {
                    ...getSolarConfig(next),
                    dcWaypoints: undefined,
                    acWaypoints: undefined,
                  };
                  const lvl0 = next.levels[0];
                  if (lvl0) {
                    const rt = computePVAndEquipmentRoutes(next, 0);
                    relocateMEPNode(lvl0, core.inverter.id, core.inverter.position, rt.pvCombinerPos);
                  }
                  commitProject(next);
                };
                const routeOpts: [WiringRouteMode, string][] = [
                  ['auto', 'Auto Wall'],
                  ['north_wall', 'North Wall'],
                  ['south_wall', 'South Wall'],
                  ['west_wall', 'West Wall'],
                  ['east_wall', 'East Wall'],
                  ['corridor', 'Corridor'],
                ];

                return (
                  <div className="p-2.5 rounded bg-slate-800/40 border border-slate-800 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-mono font-semibold text-amber-300 uppercase flex items-center gap-1.5">
                        <Zap className="w-3.5 h-3.5" /> Panels, Meter &amp; Wiring
                      </span>
                      <div className="flex gap-1">
                        <button
                          type="button"
                          onClick={() => setActiveSheet('M-101')}
                          className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700 hover:border-amber-400 text-[10px] font-mono text-amber-300"
                          title="Open 2D MEP Wiring Plan"
                        >
                          2D Plan
                        </button>
                        <button
                          type="button"
                          onClick={() => setActiveSheet('3D-VIEW')}
                          className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700 hover:border-cyan-400 text-[10px] font-mono text-cyan-300"
                          title="Open 3D View (toggle ⚡ 3D Wiring Plan)"
                        >
                          3D View
                        </button>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-1">
                      {(
                        [
                          ['mdb', 'Main DB (MDB)'],
                          ['utility_meter', 'Utility Meter'],
                          ...(solarCfg.enabled ? [['solar_inv', 'Solar Inverter'], ['solar_bess', 'BESS Battery']] : []),
                        ] as ['mdb' | 'utility_meter' | 'solar_inv' | 'solar_bess', string][]
                      ).map(([k, lbl]) => (
                        <button
                          key={k}
                          type="button"
                          onClick={() => setFocusElecUnit(k)}
                          className={`px-2 py-1 rounded text-[10px] font-medium border transition ${
                            focusElecUnit === k
                              ? 'bg-amber-600 text-white border-amber-500 font-semibold'
                              : 'bg-slate-950 text-slate-300 border-slate-800 hover:bg-slate-800'
                          }`}
                        >
                          {lbl}
                        </button>
                      ))}
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      <label className="block">
                        <span className="text-slate-400">Pos X (m)</span>
                        <input
                          type="number"
                          step="0.2"
                          value={unitNode.position.x}
                          onChange={(e) => moveUnitTo(parseFloat(e.target.value) || 0, unitNode.position.y)}
                          className="w-full mt-0.5 bg-slate-950 border border-slate-700 rounded px-2 py-1 font-mono"
                        />
                      </label>
                      <label className="block">
                        <span className="text-slate-400">Pos Y (m)</span>
                        <input
                          type="number"
                          step="0.2"
                          value={unitNode.position.y}
                          onChange={(e) => moveUnitTo(unitNode.position.x, parseFloat(e.target.value) || 0)}
                          className="w-full mt-0.5 bg-slate-950 border border-slate-700 rounded px-2 py-1 font-mono"
                        />
                      </label>
                    </div>
                    <div className="grid grid-cols-4 gap-1">
                      {(['west', 'north', 'east', 'south'] as const).map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => snapWall(s)}
                          className="py-1 rounded bg-slate-900 border border-slate-700 hover:border-amber-400 text-[10px] text-slate-300 capitalize"
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                    <div className="space-y-1.5 pt-1.5 border-t border-slate-800/80">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-mono text-slate-400 uppercase">Conduit Routing</span>
                        <button
                          type="button"
                          onClick={resnapWires}
                          className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700 hover:border-amber-400 text-[10px] font-mono text-amber-300"
                          title="Reset manual waypoint bends and snap to walls"
                        >
                          Re-Snap Wires
                        </button>
                      </div>
                      {solarCfg.enabled && (
                        <label className="block">
                          <div className="flex justify-between text-[10px] text-rose-300 mb-0.5">
                            <span>PV → INV Route</span>
                            <span className="font-mono">{routes.pvToInverter.lengthM}m</span>
                          </div>
                          <select
                            value={dcRouteMode}
                            onChange={(e) =>
                              updateSolarWiring({ dcRouteMode: e.target.value as WiringRouteMode, dcWaypoints: undefined })
                            }
                            className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-[11px]"
                          >
                            {routeOpts.map(([v, l]) => (
                              <option key={v} value={v}>
                                {l}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                      <label className="block">
                        <div className="flex justify-between text-[10px] text-emerald-300 mb-0.5">
                          <span>INV → MDB Route</span>
                          <span className="font-mono">{routes.inverterToMdb.lengthM}m</span>
                        </div>
                        <select
                          value={acRouteMode}
                          onChange={(e) =>
                            updateSolarWiring({ acRouteMode: e.target.value as WiringRouteMode, acWaypoints: undefined })
                          }
                          className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-[11px]"
                        >
                          {routeOpts.map(([v, l]) => (
                            <option key={v} value={v}>
                              {l}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="block">
                        <div className="flex justify-between text-[10px] text-slate-400">
                          <span>Conduit Trunk Height</span>
                          <span className="font-mono">
                            {conduitElev >= 0 ? '+' : ''}
                            {conduitElev.toFixed(2)}m
                          </span>
                        </div>
                        <input
                          type="range"
                          min={-0.5}
                          max={0.2}
                          step={0.05}
                          value={conduitElev}
                          onChange={(e) => updateSolarWiring({ conduitElevationOffset: parseFloat(e.target.value) })}
                          className="w-full accent-amber-500"
                        />
                      </label>
                    </div>
                    <div className="text-[10px] font-mono text-slate-400 bg-slate-950/60 border border-slate-800 rounded p-1.5 flex justify-between">
                      <span>MTR→MDB: {routes.meterToMdb.lengthM}m</span>
                      <span>{solarCfg.enabled ? `PV→INV: ${routes.pvToInverter.lengthM}m` : 'Grid Only'}</span>
                    </div>
                  </div>
                );
              })()}

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

                          {/* Manual Solar PV Placement Controls */}
                          <div className="pt-1.5 border-t border-slate-700/60 space-y-2">
                            <div className="grid grid-cols-2 gap-2">
                              <label className="block">
                                <span className="text-slate-400">Roof Slope</span>
                                <select
                                  value={solar.roofFace ?? 'south'}
                                  onChange={(e) => {
                                    const next = structuredClone(project);
                                    next.solar = {
                                      ...getSolarConfig(next),
                                      roofFace: e.target.value as SolarRoofFace,
                                      offsetX: 0,
                                      offsetY: 0,
                                    };
                                    commitProject(next);
                                  }}
                                  className="w-full mt-1 bg-slate-950 border border-slate-700 rounded px-2 py-1"
                                >
                                  <option value="south">South Slope</option>
                                  <option value="north">North Slope</option>
                                  <option value="east">East Slope</option>
                                  <option value="west">West Slope</option>
                                  <option value="flat_center">Roof Center</option>
                                </select>
                              </label>
                              <label className="block">
                                <span className="text-slate-400">Array Cols</span>
                                <select
                                  value={solar.columns ?? 0}
                                  onChange={(e) => {
                                    const next = structuredClone(project);
                                    next.solar = { ...getSolarConfig(next), columns: Number(e.target.value) };
                                    commitProject(next);
                                  }}
                                  className="w-full mt-1 bg-slate-950 border border-slate-700 rounded px-2 py-1"
                                >
                                  <option value={0}>Auto-Fit</option>
                                  {[2, 3, 4, 5, 6, 7, 8].map((c) => (
                                    <option key={c} value={c}>
                                      {c} Cols
                                    </option>
                                  ))}
                                </select>
                              </label>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <label className="block">
                                <span className="text-slate-400">
                                  Offset X ({(solar.offsetX ?? 0).toFixed(1)}m)
                                </span>
                                <input
                                  type="range"
                                  min={-6}
                                  max={6}
                                  step={0.1}
                                  value={solar.offsetX ?? 0}
                                  onChange={(e) => {
                                    const next = structuredClone(project);
                                    next.solar = { ...getSolarConfig(next), offsetX: Number(e.target.value) };
                                    commitProject(next);
                                  }}
                                  className="w-full accent-cyan-500 mt-1"
                                />
                              </label>
                              <label className="block">
                                <span className="text-slate-400">
                                  Offset Y ({(solar.offsetY ?? 0).toFixed(1)}m)
                                </span>
                                <input
                                  type="range"
                                  min={-6}
                                  max={6}
                                  step={0.1}
                                  value={solar.offsetY ?? 0}
                                  onChange={(e) => {
                                    const next = structuredClone(project);
                                    next.solar = { ...getSolarConfig(next), offsetY: Number(e.target.value) };
                                    commitProject(next);
                                  }}
                                  className="w-full accent-cyan-500 mt-1"
                                />
                              </label>
                            </div>
                            <div className="grid grid-cols-2 gap-1.5">
                              <button
                                onClick={() => {
                                  const next = structuredClone(project);
                                  const cur = getSolarConfig(next);
                                  next.solar = { ...cur, rotationDeg: ((cur.rotationDeg ?? 0) + 90) % 360 };
                                  commitProject(next);
                                }}
                                className="px-2 py-1 rounded bg-slate-900 border border-slate-700 hover:border-cyan-500 text-[10px] font-medium"
                              >
                                Rotate 90° ({solar.rotationDeg ?? 0}°)
                              </button>
                              <button
                                onClick={() => {
                                  const next = structuredClone(project);
                                  next.solar = {
                                    ...getSolarConfig(next),
                                    offsetX: 0,
                                    offsetY: 0,
                                    rotationDeg: 0,
                                    columns: 0,
                                    panelOffsets: {},
                                  };
                                  commitProject(next);
                                }}
                                className="px-2 py-1 rounded bg-slate-900 border border-slate-700 hover:border-rose-500 text-[10px] text-rose-300 font-medium"
                              >
                                Reset Position
                              </button>
                            </div>
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

              {/* Project Details Shortcut */}
              <div className="border-t border-slate-800 pt-3">
                <button
                  type="button"
                  onClick={() => setShowProjectDetailsModal(true)}
                  className="w-full py-2 px-3 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-700/80 flex items-center justify-between text-xs text-slate-200 transition-colors"
                >
                  <span className="flex items-center gap-2 font-medium truncate">
                    <Pencil className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                    <span className="truncate">Edit Project Details & Title Block</span>
                  </span>
                  <span className="text-[10px] font-mono text-slate-400 shrink-0">{project.meta.projectCode}</span>
                </button>
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

      {showProjectDetailsModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Project Details & Template"
          onClick={() => setShowProjectDetailsModal(false)}
          className="no-print fixed inset-0 z-50 bg-black/65 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-3xl max-h-[88vh] flex flex-col overflow-hidden shadow-2xl"
          >
            {/* Modal Header */}
            <div className="px-5 py-3.5 bg-slate-950 border-b border-slate-800 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-cyan-500/20 border border-cyan-500/30 flex items-center justify-center shrink-0">
                  <Pencil className="w-4 h-4 text-cyan-400" />
                </div>
                <div className="min-w-0">
                  <h3 className="font-semibold text-slate-100 text-sm truncate">
                    Project Details &amp; Title Block
                  </h3>
                  <p className="text-xs text-slate-400 truncate">
                    {project.meta.projectCode} · {project.meta.title} · {grossArea.toFixed(1)} m² GFA
                  </p>
                </div>
              </div>
              <button
                type="button"
                aria-label="Close Project Details"
                onClick={() => setShowProjectDetailsModal(false)}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Scrollable Body */}
            <div className="p-5 overflow-y-auto space-y-6 text-xs">
              {/* Section 1: Starter Project Templates */}
              <section className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="text-[11px] font-mono font-semibold text-slate-300 uppercase tracking-wider">
                    Project Template / Preset
                  </div>
                  <span className="text-[11px] text-slate-400">
                    Switching presets loads a fresh synchronized model (Undo supported)
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {PROJECT_PRESET_OPTIONS.map((preset) => {
                    const isActive = activePreset === preset.id;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => handlePresetChange(preset.id)}
                        className={`text-left p-2.5 rounded-lg border transition-all ${
                          isActive
                            ? 'bg-cyan-500/20 border-cyan-500/50 text-slate-100 shadow-sm'
                            : 'bg-slate-950 border-slate-800 hover:border-slate-600 text-slate-200'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold truncate">{preset.label}</span>
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-cyan-400 shrink-0">
                            {preset.dimensions}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-400 mt-1 truncate">{preset.subtitle}</div>
                      </button>
                    );
                  })}
                </div>
              </section>

              {/* Section 2: Project Identity & Title Block Metadata */}
              <section className="space-y-3 border-t border-slate-800 pt-5">
                <div className="text-[11px] font-mono font-semibold text-slate-300 uppercase tracking-wider">
                  Title Block &amp; Engineering Metadata
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {PROJECT_META_FIELDS.map((field) => (
                    <label
                      key={field.key}
                      className={`block ${field.fullWidth ? 'sm:col-span-2' : ''}`}
                    >
                      <span className="text-[11px] font-medium text-slate-400">{field.label}</span>
                      <input
                        type="text"
                        value={project.meta[field.key]}
                        placeholder={field.placeholder}
                        onChange={(e) => {
                          const raw = e.target.value;
                          updateProjectMeta(
                            field.key,
                            field.key === 'currency' ? raw : raw
                          );
                        }}
                        onBlur={(e) => {
                          if (field.key === 'currency' && !e.target.value.trim()) {
                            updateProjectMeta('currency', '$');
                          }
                        }}
                        className={`w-full mt-1 bg-slate-950 border border-slate-700 focus:border-cyan-500 focus:outline-none rounded-lg px-2.5 py-1.5 text-slate-100 ${
                          field.mono ? 'font-mono' : ''
                        }`}
                      />
                    </label>
                  ))}
                </div>
              </section>

              {/* Section 3: Site Plot Dimensions & Floor Levels */}
              <section className="space-y-3 border-t border-slate-800 pt-5">
                <div className="flex items-center justify-between">
                  <div className="text-[11px] font-mono font-semibold text-slate-300 uppercase tracking-wider">
                    Site Plot &amp; Floor Levels
                  </div>
                  <button
                    type="button"
                    onClick={handleAddFloor}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-white-keep text-[11px] font-medium transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add Floor Level
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="text-[11px] font-medium text-slate-400">Plot Width (m)</span>
                    <input
                      type="number"
                      step={0.5}
                      min={4}
                      max={150}
                      value={project.meta.plotWidth}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        if (Number.isFinite(val)) {
                          updateProjectMeta('plotWidth', Math.max(4, Math.min(150, val)));
                        }
                      }}
                      className="w-full mt-1 bg-slate-950 border border-slate-700 focus:border-cyan-500 focus:outline-none rounded-lg px-2.5 py-1.5 font-mono text-slate-100"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[11px] font-medium text-slate-400">Plot Depth (m)</span>
                    <input
                      type="number"
                      step={0.5}
                      min={4}
                      max={150}
                      value={project.meta.plotDepth}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        if (Number.isFinite(val)) {
                          updateProjectMeta('plotDepth', Math.max(4, Math.min(150, val)));
                        }
                      }}
                      className="w-full mt-1 bg-slate-950 border border-slate-700 focus:border-cyan-500 focus:outline-none rounded-lg px-2.5 py-1.5 font-mono text-slate-100"
                    />
                  </label>
                </div>

                <div className="space-y-2">
                  {project.levels.map((lvl, idx) => (
                    <div
                      key={lvl.id}
                      className="grid grid-cols-12 gap-2 items-center bg-slate-950 border border-slate-800 rounded-lg p-2.5"
                    >
                      <div className="col-span-2 sm:col-span-1 flex items-center">
                        <button
                          type="button"
                          onClick={() => setActiveLevelIndex(idx)}
                          className={`px-2 py-1 rounded text-[11px] font-mono font-semibold ${
                            activeLevelIndex === idx
                              ? 'bg-cyan-600 text-white text-white-keep'
                              : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                          }`}
                          title="Switch to this floor"
                        >
                          L{idx + 1}
                        </button>
                      </div>
                      <label className="col-span-10 sm:col-span-5 block">
                        <span className="text-[10px] text-slate-400">Level Name</span>
                        <input
                          type="text"
                          value={lvl.name}
                          onChange={(e) => updateFloorLevel(idx, { name: e.target.value })}
                          className="w-full mt-0.5 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-100"
                        />
                      </label>
                      <label className="col-span-6 sm:col-span-3 block">
                        <span className="text-[10px] text-slate-400">Elevation (m)</span>
                        <input
                          type="number"
                          step={0.1}
                          value={lvl.elevation}
                          onChange={(e) => {
                            const val = Number(e.target.value);
                            if (Number.isFinite(val)) updateFloorLevel(idx, { elevation: val });
                          }}
                          className="w-full mt-0.5 bg-slate-900 border border-slate-700 rounded px-2 py-1 font-mono text-slate-100"
                        />
                      </label>
                      <label className="col-span-6 sm:col-span-3 block">
                        <span className="text-[10px] text-slate-400">Height (m)</span>
                        <input
                          type="number"
                          step={0.1}
                          min={2.2}
                          max={8}
                          value={lvl.floorToFloorHeight}
                          onChange={(e) => {
                            const val = Number(e.target.value);
                            if (Number.isFinite(val)) {
                              updateFloorLevel(idx, { floorToFloorHeight: Math.max(2.2, Math.min(8, val)) });
                            }
                          }}
                          className="w-full mt-0.5 bg-slate-900 border border-slate-700 rounded px-2 py-1 font-mono text-slate-100"
                        />
                      </label>
                    </div>
                  ))}
                </div>
              </section>
            </div>

            {/* Modal Footer */}
            <div className="px-5 py-3 bg-slate-950 border-t border-slate-800 flex items-center justify-between shrink-0">
              <span className="text-[11px] text-slate-400">
                Changes sync live across Title Blocks, CAD Sheets, 3D Model &amp; BOQ
              </span>
              <button
                type="button"
                onClick={() => setShowProjectDetailsModal(false)}
                className="px-4 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-white-keep text-xs font-medium transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>
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

      {historyToast && (
        <div
          role="status"
          aria-live="polite"
          className="no-print fixed bottom-9 left-1/2 -translate-x-1/2 z-50 px-3.5 py-1.5 rounded-full bg-slate-900/95 border border-cyan-500/50 text-cyan-300 text-xs font-medium shadow-xl backdrop-blur pointer-events-none flex items-center gap-2"
        >
          <Undo2 className="w-3.5 h-3.5 shrink-0" />
          <span>{historyToast}</span>
        </div>
      )}
    </div>
  );
}

export default App;
