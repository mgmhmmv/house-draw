import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  CloudOff,
  Columns3,
  Copy,
  DoorOpen,
  Download,
  FileCode2,
  FileJson,
  FileSpreadsheet,
  FileText,
  History,
  Eye,
  Armchair,
  RotateCcw,
  Image as ImageIcon,
  ImagePlus,
  Layers,
  Loader2,
  MousePointer2,
  PanelRight,
  PanelLeft,
  PenLine,
  PenTool,
  Plus,
  Redo2,
  Ruler,
  SlidersHorizontal,
  Sparkles,
  Square,
  SquareStack,
  Undo2,
  X,
} from 'lucide-react';
import {
  getHVACConfig,
  getSolarConfig,
  type BuildingProject,
  type CADTool,
  type SelectableElementKind,
  type SketchStroke,
} from '../../model/types';
import { autoGenerateStructuralGrid, autoPlaceStructuralColumns, uid } from '../../engine/geometry';
import { autoPopulateMEPForLevel } from '../../engine/mepEngine';
import { convertSketchStrokesToBIM } from '../../ai/sketchRecognizer';
import {
  export3DToOBJ,
  exportBOQToCSV,
  exportFullDrawingSetHTML,
  exportLevelToDXF,
  exportProjectToJSON,
  exportSVGElement,
  exportViewportPNG,
} from '../../export/exporters';
import { api, STAGES, type ProjectStatus, type ProjectVersion } from '../lib/api';
import { useIsDesktop } from '../lib/hooks';
import { Link, useRouter } from '../lib/router';
import { Button, cx, Dialog, Field, IconButton, Input, Kbd, Menu, MenuItem, Spinner, STATUS_META, StatusPill, toast } from '../ui';
import { Assistant, type AssistantHandle } from './Assistant';
import { HistoryPanel } from './HistoryPanel';
import { LibraryPanel } from './LibraryPanel';
import type { AssetDef } from '../drawing/assets/catalog';
import { Inspector, type Selection } from './Inspector';
import { SheetView } from './SheetView';
import { SHEET_GROUPS, SHEETS, sheetBySlug, type SheetDef } from './sheets';
import { useProjectDoc, type SaveState } from './useProjectDoc';

const TOOLS: { id: CADTool; label: string; key: string; icon: typeof PenTool }[] = [
  { id: 'select', label: 'Select', key: 'V', icon: MousePointer2 },
  { id: 'wall', label: 'Wall', key: 'W', icon: PenTool },
  { id: 'room_rect', label: 'Room', key: 'R', icon: Square },
  { id: 'door', label: 'Door', key: 'D', icon: DoorOpen },
  { id: 'window', label: 'Window', key: 'N', icon: SquareStack },
  { id: 'column', label: 'Column', key: 'C', icon: Columns3 },
  { id: 'measure', label: 'Measure', key: 'M', icon: Ruler },
  { id: 'sketch_wall', label: 'Sketch', key: 'S', icon: PenLine },
];

type Panel = 'properties' | 'assistant' | 'history' | 'library';
type MobileSheet = null | 'sheets' | 'properties' | 'assistant' | 'project' | 'history' | 'library';

export default function Workspace({ projectId, sheetParam }: { projectId: string; sheetParam?: string }) {
  const doc = useProjectDoc(projectId);
  const { navigate } = useRouter();
  const isDesktop = useIsDesktop();

  const sheet = sheetBySlug(sheetParam);
  const [levelIndex, setLevelIndex] = useState(0);
  const [tool, setTool] = useState<CADTool>('select');
  const [selection, setSelection] = useState<Selection | null>(null);
  const [sketch, setSketch] = useState<SketchStroke[]>([]);
  const [trace, setTrace] = useState<string | null>(null);
  const [traceOpacity, setTraceOpacity] = useState(0.4);
  const [panel, setPanel] = useState<Panel>('properties');
  const [panelOpen, setPanelOpen] = useState(true);
  /** The sheet menu on the left can fold down to an icon rail; remembered per browser. */
  const [navOpen, setNavOpen] = useState(() => {
    try {
      return localStorage.getItem('as_nav') !== 'closed';
    } catch {
      return true;
    }
  });
  const toggleNav = () =>
    setNavOpen((o) => {
      try {
        localStorage.setItem('as_nav', o ? 'closed' : 'open');
      } catch {
        /* storage blocked */
      }
      return !o;
    });
  const [mobileSheet, setMobileSheet] = useState<MobileSheet>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const assistantRef = useRef<AssistantHandle>(null);
  const traceInput = useRef<HTMLInputElement>(null);

  /** An older version shown read-only on the canvas, from History. */
  const [preview, setPreview] = useState<{ version: ProjectVersion; model: BuildingProject } | null>(null);
  const [restoreArmed, setRestoreArmed] = useState(false);
  /** A library item being placed on the plan. */
  const [placing, setPlacing] = useState<{ def: AssetDef; rotation: number } | null>(null);

  const model = doc.model;
  const levels = model?.levels ?? [];
  const safeLevel = Math.min(levelIndex, Math.max(0, levels.length - 1));

  const goSheet = useCallback(
    (s: SheetDef) => {
      navigate(`/p/${projectId}/${s.slug}`, { replace: true });
      setSelection(null);
      setMobileSheet(null);
    },
    [navigate, projectId]
  );

  const onSelect = useCallback((id: string | null, kind?: SelectableElementKind) => {
    setSelection(id && kind ? { id, kind } : null);
    if (id) setPanel('properties');
  }, []);

  const commit = doc.commit;
  /** Canvas and inspector edits; blocked while an old version is being previewed. */
  const edit = useCallback(
    (next: BuildingProject) => {
      if (preview) return toast('Previewing an older version · go back to the current one to edit');
      commit(next);
    },
    [preview, commit]
  );

  const openPreview = useCallback(
    async (v: ProjectVersion) => {
      if (preview?.version.version === v.version) return setPreview(null);
      try {
        const m = await api.versionModel(projectId, v.version);
        setPreview({ version: v, model: m });
        setRestoreArmed(false);
        setSelection(null);
        setTool('select');
        setMobileSheet(null);
      } catch {
        toast('Could not load that version.');
      }
    },
    [projectId, preview]
  );
  // Choosing a drawing tool ends placing.
  useEffect(() => {
    if (tool !== 'select') setPlacing(null);
  }, [tool]);

  /** Start placing a library item; the plan is where things are placed. */
  const pickAsset = useCallback(
    (def: AssetDef) => {
      setPreview(null);
      setSelection(null);
      setTool('select');
      setPlacing((pl) => (pl?.def.id === def.id ? null : { def, rotation: 0 }));
      setMobileSheet(null);
      if (!sheet.plan || sheet.id !== 'A-101') {
        const plan = SHEETS.find((x) => x.id === 'A-101');
        if (plan) navigate(`/p/${projectId}/${plan.slug}`, { replace: true });
      }
    },
    [sheet, navigate, projectId]
  );

  const restoreVersion = useCallback(
    async (v: number) => {
      await doc.restore(v);
      setPreview(null);
    },
    [doc]
  );

  /* ── Model actions ─────────────────────────────────────────────── */

  const deleteSelection = useCallback(() => {
    if (!model || !selection) return;
    const next = structuredClone(model);
    const lvl = next.levels[safeLevel];
    const { id, kind } = selection;
    if (kind === 'wall') {
      lvl.walls = lvl.walls.filter((w) => w.id !== id);
      lvl.openings = lvl.openings.filter((o) => o.wallId !== id);
    } else if (kind === 'opening') lvl.openings = lvl.openings.filter((o) => o.id !== id);
    else if (kind === 'room') lvl.rooms = lvl.rooms.filter((r) => r.id !== id);
    else if (kind === 'column') lvl.columns = lvl.columns.filter((c) => c.id !== id);
    else if (kind === 'furniture') lvl.furniture = lvl.furniture.filter((f) => f.id !== id);
    else if (kind === 'mep_node') lvl.mepNodes = lvl.mepNodes.filter((n) => n.id !== id);
    else if (kind === 'solar_panel') {
      const s = getSolarConfig(next);
      const offsets = { ...(s.panelOffsets ?? {}) };
      delete offsets[Number(id.replace('solar_panel_', ''))];
      next.solar = { ...s, panelOffsets: offsets };
    } else if (kind === 'solar_array') next.solar = { ...getSolarConfig(next), enabled: false };
    commit(next);
    setSelection(null);
    toast('Deleted · ⌘Z to undo');
  }, [model, selection, safeLevel, commit]);

  const convertSketch = useCallback(() => {
    if (!model || !sketch.length) return;
    const res = convertSketchStrokesToBIM(model, safeLevel, sketch);
    commit(res.project, { label: `Sketch → ${res.wallsAdded} walls` });
    setSketch([]);
    setTool('select');
    assistantRef.current?.log('Turn sketch into walls', `Made ${res.wallsAdded} walls, ${res.openingsAdded} openings and found ${Math.max(0, res.roomsDetected)} rooms.`);
    toast(`${res.wallsAdded} walls created from your sketch`);
  }, [model, sketch, safeLevel, commit]);

  const syncEngineering = useCallback(() => {
    if (!model) return;
    const next = structuredClone(model);
    const solarOn = getSolarConfig(next).enabled;
    const hvac = getHVACConfig(next);
    next.levels = next.levels.map((l) => autoPopulateMEPForLevel({ ...l, columns: autoPlaceStructuralColumns(l) }, solarOn, hvac.enabled, hvac.ceilingFansEnabled));
    next.grid = autoGenerateStructuralGrid(next.levels[0]);
    commit(next, { label: 'Regenerated structure & MEP' });
    assistantRef.current?.log('Regenerate structure & MEP', 'Recalculated the column grid, footings, electrical and solar circuits, cooling units and plumbing.');
    toast('Structure and MEP regenerated');
  }, [model, commit]);

  const addLevel = useCallback(() => {
    if (!model) return;
    const next = structuredClone(model);
    const top = next.levels[next.levels.length - 1];
    let lvl = structuredClone(top);
    lvl.id = uid('lvl');
    lvl.index = next.levels.length;
    lvl.name = next.levels.length === 1 ? 'First Floor' : `Floor ${next.levels.length + 1}`;
    lvl.elevation = Number((top.elevation + top.floorToFloorHeight).toFixed(2));
    const hvac = getHVACConfig(next);
    lvl = autoPopulateMEPForLevel(lvl, getSolarConfig(next).enabled, hvac.enabled, hvac.ceilingFansEnabled);
    next.levels.push(lvl);
    commit(next);
    setLevelIndex(next.levels.length - 1);
    toast(`${lvl.name} added`);
  }, [model, commit]);

  const runExport = async (kind: 'json' | 'dxf' | 'obj' | 'csv' | 'set' | 'image') => {
    if (!model) return;
    const code = (model.meta.projectCode || 'ARCHSTUDIO').replace(/[^\w-]/g, '_');
    try {
      if (kind === 'json') await exportProjectToJSON(model);
      else if (kind === 'dxf') await exportLevelToDXF(model, safeLevel);
      else if (kind === 'obj') await export3DToOBJ(model);
      else if (kind === 'csv') await exportBOQToCSV(model);
      else if (kind === 'set') await exportFullDrawingSetHTML(model);
      else if (sheet.id === '3D-VIEW') await exportViewportPNG(model, sheet.id);
      else await exportSVGElement(sheet.plan ? svgRef.current : document.querySelector('main svg'), `${code}_${sheet.code}.svg`);
      toast('Download started');
    } catch {
      toast('Export failed');
    }
  };

  /* ── Keyboard ──────────────────────────────────────────────────── */

  const keys = useRef({ deleteSelection, undo: doc.undo, redo: doc.redo, sheet, selection, placing });
  keys.current = { deleteSelection, undo: doc.undo, redo: doc.redo, sheet, selection, placing };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable="true"]')) return;
      const k = keys.current;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) k.redo();
        else k.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        k.redo();
        return;
      }
      if (mod || e.altKey) return;
      if (k.placing && (e.key === 'r' || e.key === 'R')) {
        e.preventDefault();
        setPlacing((pl) => (pl ? { ...pl, rotation: (pl.rotation + (e.shiftKey ? 270 : 90)) % 360 } : pl));
        return;
      }
      if ((e.key === 'Backspace' || e.key === 'Delete') && k.selection) {
        e.preventDefault();
        k.deleteSelection();
      } else if (e.key === 'Escape') {
        setSelection(null);
        setTool('select');
        setPlacing(null);
      } else if (e.key === '/') {
        e.preventDefault();
        setPanel('assistant');
        setPanelOpen(true);
        setTimeout(() => assistantRef.current?.focus(), 30);
      } else if (k.sheet.plan) {
        const tl = TOOLS.find((x) => x.key.toLowerCase() === e.key.toLowerCase());
        if (tl) setTool(tl.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!preview) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setPreview(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [preview]);

  useEffect(() => {
    if (doc.project) document.title = `${doc.project.name} · ArchStudio`;
    return () => {
      document.title = 'ArchStudio';
    };
  }, [doc.project]);

  /* ── Loading / error ───────────────────────────────────────────── */

  if (doc.loadError) {
    return (
      <div className="flex h-screen-safe flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-ink-2">{doc.loadError}</p>
        <Link to="/" className="text-sm font-medium text-accent">
          Back to projects
        </Link>
      </div>
    );
  }
  if (!model || !doc.project) {
    return (
      <div className="flex h-screen-safe items-center justify-center">
        <Spinner />
      </div>
    );
  }

  const project = doc.project;

  const inspector = (
    <Inspector model={model} levelIndex={safeLevel} selection={selection} onCommit={edit} onDelete={preview ? () => {} : deleteSelection} />
  );
  const assistant = (
    <Assistant
      ref={assistantRef}
      projectId={projectId}
      model={model}
      onCommit={(next, opts) => {
        setPreview(null);
        return commit(next, opts);
      }}
      sketchCount={sketch.length}
      onConvertSketch={convertSketch}
      onOpenHistory={() => {
        if (isDesktop) {
          setPanel('history');
          setPanelOpen(true);
        } else setMobileSheet('history');
      }}
      onSyncEngineering={syncEngineering}
    />
  );

  const history = (
    <HistoryPanel projectId={projectId} current={project.version} onRestore={restoreVersion} onPreview={openPreview} previewing={preview?.version.version ?? null} />
  );

  const library = <LibraryPanel onPick={pickAsset} placingId={placing?.def.id ?? null} />;

  const exportMenu = (
    <Menu
      trigger={(t) =>
        isDesktop ? (
          <Button size="sm" variant="ghost" icon={<Download className="h-4 w-4" />} {...t}>
            Export
          </Button>
        ) : (
          <IconButton label="Export" size="sm" {...t}>
            <Download className="h-4 w-4" />
          </IconButton>
        )
      }
    >
      {(close) => (
        <>
          <MenuItem icon={<ImageIcon />} onClick={() => (close(), runExport('image'))}>
            This sheet ({sheet.id === '3D-VIEW' ? 'PNG' : 'SVG'})
          </MenuItem>
          <MenuItem icon={<FileText />} onClick={() => (close(), runExport('set'))}>
            Full drawing set (HTML, print to PDF)
          </MenuItem>
          <div className="my-1 h-px bg-line" />
          <MenuItem icon={<FileCode2 />} onClick={() => (close(), runExport('dxf'))}>
            CAD plan (DXF)
          </MenuItem>
          <MenuItem icon={<SquareStack />} onClick={() => (close(), runExport('obj'))}>
            3D model (OBJ)
          </MenuItem>
          <MenuItem icon={<FileSpreadsheet />} onClick={() => (close(), runExport('csv'))}>
            Bill of quantities (CSV)
          </MenuItem>
          <MenuItem icon={<FileJson />} onClick={() => (close(), runExport('json'))}>
            Project data (JSON)
          </MenuItem>
        </>
      )}
    </Menu>
  );

  const canvas = (
    <main className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-[#f8fafc]">
      <SheetView
        model={preview?.model ?? model}
        projectId={projectId}
        stage={project.status}
        onStage={(st) => doc.updateMeta({ status: st }).then(() => toast(`Stage: ${STATUS_META[st].label}`)).catch(() => toast('Could not change the stage'))}
        sheet={sheet.id}
        levelIndex={preview ? Math.min(safeLevel, preview.model.levels.length - 1) : safeLevel}
        tool={tool}
        selectedId={selection?.id ?? null}
        onSelect={onSelect}
        onCommit={edit}
        sketchStrokes={sketch}
        onAddSketchStroke={(s) => setSketch((xs) => [...xs, s])}
        traceImageUrl={trace}
        traceOpacity={traceOpacity}
        svgRef={svgRef}
        placing={preview ? null : placing}
      />

      {preview && (
        <div className="absolute inset-x-3 top-3 z-30 mx-auto flex max-w-xl flex-wrap items-center gap-2 rounded-[14px] border border-accent/40 bg-surface/95 px-3 py-2 shadow-float backdrop-blur animate-fade-up">
          <Eye className="h-4 w-4 shrink-0 text-accent" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium">Previewing v{preview.version.version}</p>
            <p className="truncate text-2xs text-ink-3">{preview.version.label || 'Edited'} · read-only</p>
          </div>
          <Button size="sm" variant="ghost" onClick={() => setPreview(null)}>
            Back to current
          </Button>
          <Button
            size="sm"
            variant={restoreArmed ? 'primary' : 'secondary'}
            icon={<RotateCcw className="h-3.5 w-3.5" />}
            onClick={() => {
              if (!restoreArmed) {
                setRestoreArmed(true);
                window.setTimeout(() => setRestoreArmed(false), 4000);
                return;
              }
              restoreVersion(preview.version.version)
                .then(() => toast(`Restored version ${preview.version.version}`))
                .catch(() => toast('Could not restore that version.'));
            }}
          >
            {restoreArmed ? 'Click to confirm' : 'Restore'}
          </Button>
        </div>
      )}

      {sheet.plan && !preview && (
        <>
          <ToolDock
            tool={tool}
            setTool={setTool}
            onTrace={() => traceInput.current?.click()}
            isDesktop={isDesktop}
          />
          {(sketch.length > 0 || trace) && (
            <div className="absolute left-1/2 top-3 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full border border-line bg-surface/95 py-1 pl-4 pr-1 text-[13px] shadow-float backdrop-blur animate-fade-up">
              {sketch.length > 0 ? (
                <>
                  <span className="text-ink-2">
                    {sketch.length} sketch {sketch.length === 1 ? 'stroke' : 'strokes'}
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => setSketch([])}>
                    Clear
                  </Button>
                  <Button size="sm" variant="primary" icon={<Sparkles className="h-3.5 w-3.5" />} onClick={convertSketch}>
                    Make walls
                  </Button>
                </>
              ) : (
                <>
                  <span className="text-ink-2">Trace image</span>
                  <input
                    type="range"
                    min={0.1}
                    max={0.9}
                    step={0.05}
                    value={traceOpacity}
                    onChange={(e) => setTraceOpacity(Number(e.target.value))}
                    className="w-24 accent-[rgb(var(--accent))]"
                    aria-label="Trace opacity"
                  />
                  <IconButton label="Remove trace image" size="sm" onClick={() => setTrace(null)}>
                    <X className="h-4 w-4" />
                  </IconButton>
                </>
              )}
            </div>
          )}
        </>
      )}
      <input
        ref={traceInput}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) {
            setTrace(URL.createObjectURL(f));
            setTool('sketch_wall');
            toast('Sketch over the image, then make walls');
          }
          e.target.value = '';
        }}
      />
    </main>
  );

  const levelPicker = sheet.plan && (
    <LevelPicker levels={levels.map((l) => l.name)} index={safeLevel} onPick={setLevelIndex} onAdd={addLevel} />
  );

  /* ── Desktop ───────────────────────────────────────────────────── */

  if (isDesktop) {
    return (
      <div className="flex h-screen-safe flex-col bg-page">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-surface px-3">
          <IconButton label="All projects" size="sm" onClick={() => navigate('/')}>
            <ArrowLeft className="h-4 w-4" />
          </IconButton>
          <IconButton label={navOpen ? 'Collapse sheet menu' : 'Expand sheet menu'} size="sm" active={!navOpen} onClick={toggleNav}>
            <PanelLeft className="h-4 w-4" />
          </IconButton>
          <button onClick={() => setDetailsOpen(true)} className="flex min-w-0 items-center gap-2 rounded-ctl px-2 py-1.5 hover:bg-sunken/70">
            <span className="truncate text-[15px] font-semibold tracking-tight">{project.name}</span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-ink-3" />
          </button>
          <StatusPill status={project.status} />
          <SaveIndicator state={doc.saveState} onRetry={doc.saveNow} onKeepMine={() => void doc.keepMine().then((ok) => ok && toast('Saved · the other version is in History'))} />

          <div className="ml-auto flex items-center gap-1">
            <IconButton label="Undo (⌘Z)" size="sm" disabled={!doc.canUndo} onClick={doc.undo}>
              <Undo2 className="h-4 w-4" />
            </IconButton>
            <IconButton label="Redo (⇧⌘Z)" size="sm" disabled={!doc.canRedo} onClick={doc.redo}>
              <Redo2 className="h-4 w-4" />
            </IconButton>
            <IconButton
              label="History"
              size="sm"
              active={panelOpen && panel === 'history'}
              onClick={() => {
                if (panelOpen && panel === 'history') setPanelOpen(false);
                else {
                  setPanel('history');
                  setPanelOpen(true);
                }
              }}
            >
              <History className="h-4 w-4" />
            </IconButton>
            <div className="mx-1.5 h-5 w-px bg-line" />
            {exportMenu}
            <Button
              size="sm"
              variant={panelOpen && panel === 'assistant' ? 'primary' : 'secondary'}
              icon={<Sparkles className="h-4 w-4" />}
              onClick={() => {
                if (panelOpen && panel === 'assistant') setPanelOpen(false);
                else {
                  setPanel('assistant');
                  setPanelOpen(true);
                }
              }}
            >
              Ask AI
            </Button>
            <IconButton label={panelOpen ? 'Hide panel' : 'Show panel'} size="sm" active={panelOpen} onClick={() => setPanelOpen(!panelOpen)}>
              <PanelRight className="h-4 w-4" />
            </IconButton>
          </div>
        </header>

        <div className="flex min-h-0 flex-1">
          {navOpen ? (
            <aside className="flex w-[232px] shrink-0 flex-col overflow-y-auto border-r border-line bg-raised px-3 py-4">
              <SheetNav current={sheet} onPick={goSheet} />
              {sheet.plan && (
                <div className="mt-6">
                  <p className="px-3 pb-2 text-2xs font-medium uppercase tracking-wide text-ink-3">Levels</p>
                  <LevelList levels={levels.map((l) => l.name)} index={safeLevel} onPick={setLevelIndex} onAdd={addLevel} />
                </div>
              )}
              <div className="mt-auto space-y-1.5 px-3 pt-6 text-2xs text-ink-3">
                <div className="flex items-center justify-between">
                  <span>Ask AI</span>
                  <Kbd>/</Kbd>
                </div>
                <div className="flex items-center justify-between">
                  <span>Undo</span>
                  <Kbd>⌘Z</Kbd>
                </div>
              </div>
            </aside>
          ) : (
            <aside className="flex w-14 shrink-0 flex-col items-center gap-0.5 overflow-y-auto border-r border-line bg-raised py-3">
              {SHEET_GROUPS.map((g, gi) => (
                <div key={g.label} className={cx('flex flex-col items-center gap-0.5', gi > 0 && 'mt-2 border-t border-line pt-2')}>
                  {g.sheets.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => goSheet(s)}
                      title={`${s.name} · ${s.code}`}
                      aria-label={s.name}
                      className={cx('flex h-9 w-9 items-center justify-center rounded-ctl', s.id === sheet.id ? 'bg-surface text-accent shadow-card' : 'text-ink-2 hover:bg-sunken/70 hover:text-ink')}
                    >
                      <s.icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
                    </button>
                  ))}
                </div>
              ))}
              {sheet.plan && levels.length > 1 && (
                <div className="mt-2 flex flex-col items-center gap-0.5 border-t border-line pt-2">
                  {levels.map((l, i) => (
                    <button
                      key={l.id}
                      onClick={() => setLevelIndex(i)}
                      title={l.name}
                      className={cx('flex h-7 w-7 items-center justify-center rounded-md font-mono text-2xs', i === safeLevel ? 'bg-accent text-accent-ink' : 'bg-sunken text-ink-3 hover:text-ink')}
                    >
                      {i}
                    </button>
                  ))}
                </div>
              )}
            </aside>
          )}

          {canvas}

          {panelOpen && (
            <aside className="flex w-[360px] shrink-0 flex-col border-l border-line bg-surface animate-slide-in">
              <div className="flex h-12 shrink-0 items-center gap-1 border-b border-line px-3">
                <PanelTab active={panel === 'properties'} onClick={() => setPanel('properties')} icon={<SlidersHorizontal className="h-4 w-4" />}>
                  Properties
                </PanelTab>
                <PanelTab active={panel === 'assistant'} onClick={() => setPanel('assistant')} icon={<Sparkles className="h-4 w-4" />}>
                  AI
                </PanelTab>
                <PanelTab active={panel === 'library'} onClick={() => setPanel('library')} icon={<Armchair className="h-4 w-4" />}>
                  Library
                </PanelTab>
                <PanelTab active={panel === 'history'} onClick={() => setPanel('history')} icon={<History className="h-4 w-4" />}>
                  History
                </PanelTab>
              </div>
              <div className={cx('min-h-0 flex-1', panel === 'properties' ? 'overflow-y-auto' : 'hidden')}>{inspector}</div>
              <div className={cx('min-h-0 flex-1', panel === 'assistant' ? 'flex flex-col' : 'hidden')}>{assistant}</div>
              {panel === 'history' && <div className="min-h-0 flex-1 overflow-y-auto p-3">{history}</div>}
              {panel === 'library' && <div className="min-h-0 flex-1">{library}</div>}
            </aside>
          )}
        </div>

        <ProjectDetailsDialog open={detailsOpen} onClose={() => setDetailsOpen(false)} doc={doc} />
      </div>
    );
  }

  /* ── Phone & tablet ────────────────────────────────────────────── */

  return (
    <div className="flex h-screen-safe flex-col bg-page">
      <header className="flex h-14 shrink-0 items-center gap-1 border-b border-line bg-surface px-2">
        <IconButton label="All projects" size="sm" onClick={() => navigate('/')}>
          <ArrowLeft className="h-5 w-5" />
        </IconButton>
        <button onClick={() => setMobileSheet('project')} className="min-w-0 flex-1 px-1 text-left">
          <div className="truncate text-[15px] font-semibold leading-tight tracking-tight">{project.name}</div>
          <div className="flex items-center gap-1 text-2xs text-ink-3">
            {sheet.name}
            <SaveIndicator state={doc.saveState} onRetry={doc.saveNow} onKeepMine={() => void doc.keepMine()} compact />
          </div>
        </button>
        <IconButton label="Library" size="sm" active={!!placing} onClick={() => (placing ? setPlacing(null) : setMobileSheet('library'))}>
          <Armchair className="h-[18px] w-[18px]" />
        </IconButton>
        <IconButton label="History" size="sm" onClick={() => setMobileSheet('history')}>
          <History className="h-[18px] w-[18px]" />
        </IconButton>
        <IconButton label="Undo" size="sm" disabled={!doc.canUndo} onClick={doc.undo}>
          <Undo2 className="h-[18px] w-[18px]" />
        </IconButton>
        <IconButton label="Redo" size="sm" disabled={!doc.canRedo} onClick={doc.redo}>
          <Redo2 className="h-[18px] w-[18px]" />
        </IconButton>
        {exportMenu}
      </header>

      <div className="flex h-12 shrink-0 items-center gap-1.5 overflow-x-auto border-b border-line bg-surface px-3 no-scrollbar">
        {SHEETS.map((s) => (
          <button
            key={s.id}
            onClick={() => goSheet(s)}
            className={cx(
              'h-8 shrink-0 rounded-full px-3.5 text-[13px] font-medium transition-colors',
              s.id === sheet.id ? 'bg-ink text-page' : 'text-ink-2 hover:bg-sunken'
            )}
          >
            {s.short}
          </button>
        ))}
      </div>

      <div className="relative flex min-h-0 flex-1">
        {canvas}
        {levelPicker && <div className="absolute bottom-[92px] left-3 z-20">{levelPicker}</div>}
      </div>

      <nav className="shrink-0 border-t border-line bg-surface pb-safe">
        <div className="mx-auto flex h-16 max-w-md items-center justify-around">
          <BottomTab icon={<Layers className="h-[22px] w-[22px]" />} label="Sheets" onClick={() => setMobileSheet('sheets')} />
          <BottomTab icon={<SlidersHorizontal className="h-[22px] w-[22px]" />} label={selection ? 'Selected' : 'Properties'} dot={!!selection} onClick={() => setMobileSheet('properties')} />
          <button onClick={() => setMobileSheet('assistant')} className="flex h-12 items-center gap-2 rounded-full bg-ink px-5 text-[13px] font-medium text-page shadow-float">
            <Sparkles className="h-4 w-4" /> Ask AI
          </button>
        </div>
      </nav>

      <BottomSheet open={mobileSheet === 'sheets'} onClose={() => setMobileSheet(null)} title="Sheets">
        <div className="px-3 pb-4">
          <SheetNav current={sheet} onPick={goSheet} />
        </div>
      </BottomSheet>
      <BottomSheet open={mobileSheet === 'properties'} onClose={() => setMobileSheet(null)} title={selection ? 'Selection' : 'Building'}>
        {inspector}
      </BottomSheet>
      <BottomSheet open={mobileSheet === 'assistant'} onClose={() => setMobileSheet(null)} title="AI Architect" tall>
        {assistant}
      </BottomSheet>
      <BottomSheet open={mobileSheet === 'project'} onClose={() => setMobileSheet(null)} title="Project">
        <ProjectDetailsForm doc={doc} onDone={() => setMobileSheet(null)} />
      </BottomSheet>
      <BottomSheet open={mobileSheet === 'library'} onClose={() => setMobileSheet(null)} title="Library" tall>
        <div className="h-[70vh]">{library}</div>
      </BottomSheet>
      <BottomSheet open={mobileSheet === 'history'} onClose={() => setMobileSheet(null)} title="History" tall>
        <div className="px-3 pb-6">{history}</div>
      </BottomSheet>
    </div>
  );
}

/* ── Pieces ────────────────────────────────────────────────────────── */

function SheetNav({ current, onPick }: { current: SheetDef; onPick: (s: SheetDef) => void }) {
  return (
    <nav className="space-y-5">
      {SHEET_GROUPS.map((g) => (
        <div key={g.label}>
          <p className="px-3 pb-2 text-2xs font-medium uppercase tracking-wide text-ink-3">{g.label}</p>
          <div className="space-y-0.5">
            {g.sheets.map((s) => {
              const active = s.id === current.id;
              return (
                <button
                  key={s.id}
                  onClick={() => onPick(s)}
                  className={cx(
                    'flex h-10 w-full items-center gap-3 rounded-ctl px-3 text-left text-sm transition-colors lg:h-9',
                    active ? 'bg-surface font-medium text-ink shadow-card' : 'text-ink-2 hover:bg-sunken/70 hover:text-ink'
                  )}
                >
                  <s.icon className={cx('h-[18px] w-[18px]', active ? 'text-accent' : '')} strokeWidth={1.75} />
                  <span className="flex-1 truncate">{s.name}</span>
                  <span className="font-mono text-2xs text-ink-3">{s.code}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

function LevelList({ levels, index, onPick, onAdd }: { levels: string[]; index: number; onPick: (i: number) => void; onAdd: () => void }) {
  return (
    <div className="space-y-0.5">
      {levels
        .map((name, i) => ({ name, i }))
        .reverse()
        .map(({ name, i }) => (
          <button
            key={i}
            onClick={() => onPick(i)}
            className={cx(
              'flex h-9 w-full items-center gap-3 rounded-ctl px-3 text-left text-sm transition-colors',
              i === index ? 'bg-surface font-medium shadow-card' : 'text-ink-2 hover:bg-sunken/70'
            )}
          >
            <span className={cx('flex h-5 w-5 items-center justify-center rounded-md font-mono text-2xs', i === index ? 'bg-accent text-accent-ink' : 'bg-sunken text-ink-3')}>
              {i}
            </span>
            {name}
          </button>
        ))}
      <button onClick={onAdd} className="flex h-9 w-full items-center gap-3 rounded-ctl px-3 text-sm text-ink-3 hover:bg-sunken/70 hover:text-ink">
        <Plus className="h-4 w-4" /> Add level
      </button>
    </div>
  );
}

function LevelPicker({ levels, index, onPick, onAdd }: { levels: string[]; index: number; onPick: (i: number) => void; onAdd: () => void }) {
  return (
    <Menu
      align="start"
      trigger={(t) => (
        <button {...t} className="flex h-9 items-center gap-2 rounded-full border border-line bg-surface/95 px-3.5 text-[13px] font-medium shadow-float backdrop-blur">
          <Layers className="h-4 w-4 text-ink-3" />
          {levels[index]}
          <ChevronDown className="h-3.5 w-3.5 text-ink-3" />
        </button>
      )}
    >
      {(close) => (
        <>
          {levels.map((name, i) => (
            <MenuItem key={i} icon={i === index ? <Check /> : <span className="block h-4 w-4" />} onClick={() => (close(), onPick(i))}>
              {name}
            </MenuItem>
          ))}
          <div className="my-1 h-px bg-line" />
          <MenuItem icon={<Plus />} onClick={() => (close(), onAdd())}>
            Add level
          </MenuItem>
        </>
      )}
    </Menu>
  );
}

function ToolDock({ tool, setTool, onTrace, isDesktop }: { tool: CADTool; setTool: (t: CADTool) => void; onTrace: () => void; isDesktop: boolean }) {
  return (
    <div className="absolute inset-x-0 bottom-4 z-20 flex justify-center px-3 pointer-events-none">
      <div className="pointer-events-auto flex max-w-full items-center gap-0.5 overflow-x-auto rounded-[16px] border border-line bg-surface/95 p-1 shadow-float backdrop-blur no-scrollbar">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTool(t.id)}
            title={`${t.label} (${t.key})`}
            aria-label={t.label}
            aria-pressed={tool === t.id}
            className={cx(
              'group relative flex shrink-0 flex-col items-center justify-center rounded-[12px] transition-colors',
              isDesktop ? 'h-11 w-11' : 'h-12 w-12',
              tool === t.id ? 'bg-ink text-page' : 'text-ink-2 hover:bg-sunken hover:text-ink'
            )}
          >
            <t.icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
            {!isDesktop && <span className="mt-0.5 text-[9px] font-medium">{t.label}</span>}
          </button>
        ))}
        <div className="mx-1 h-6 w-px shrink-0 bg-line" />
        <button
          onClick={onTrace}
          title="Trace over an image"
          aria-label="Trace over an image"
          className={cx('flex shrink-0 items-center justify-center rounded-[12px] text-ink-2 hover:bg-sunken hover:text-ink', isDesktop ? 'h-11 w-11' : 'h-12 w-12')}
        >
          <ImagePlus className="h-[18px] w-[18px]" strokeWidth={1.75} />
        </button>
      </div>
    </div>
  );
}

function PanelTab({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: ReactNode; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cx('flex h-8 min-w-0 items-center gap-1.5 rounded-ctl px-2.5 text-[13px] font-medium transition-colors', active ? 'bg-sunken text-ink' : 'text-ink-3 hover:text-ink')}
    >
      {icon}
      {children}
    </button>
  );
}

function SaveIndicator({ state, onRetry, onKeepMine, compact }: { state: SaveState; onRetry: () => void; onKeepMine: () => void; compact?: boolean }) {
  const content: Record<SaveState, ReactNode> = {
    saved: (
      <>
        <Check className="h-3.5 w-3.5" /> {!compact && 'Saved'}
      </>
    ),
    unsaved: <>{compact ? '·' : 'Unsaved changes'}</>,
    saving: (
      <>
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> {!compact && 'Saving'}
      </>
    ),
    error: (
      <button onClick={onRetry} className="inline-flex items-center gap-1 text-danger">
        <CloudOff className="h-3.5 w-3.5" /> Not saved · Retry
      </button>
    ),
    conflict: (
      <span className="inline-flex items-center gap-1.5 text-warn">
        <CloudOff className="h-3.5 w-3.5" /> {!compact && 'Changed in another tab'}
        <button onClick={onKeepMine} className="rounded-full bg-warn/15 px-2 py-0.5 font-medium hover:bg-warn/25" title="Save this tab's design. The other version stays in History.">
          Keep mine
        </button>
        <button onClick={() => window.location.reload()} className="rounded-full px-1.5 py-0.5 font-medium hover:bg-warn/10" title="Load the latest saved design">
          Reload
        </button>
      </span>
    ),
  };
  return <span className="inline-flex items-center gap-1 text-2xs text-ink-3">{content[state]}</span>;
}

function BottomTab({ icon, label, onClick, dot }: { icon: ReactNode; label: string; onClick: () => void; dot?: boolean }) {
  return (
    <button onClick={onClick} className="relative flex w-20 flex-col items-center gap-1 text-2xs font-medium text-ink-2">
      {icon}
      {label}
      {dot && <span className="absolute right-5 top-0 h-2 w-2 rounded-full bg-accent" />}
    </button>
  );
}

function BottomSheet({ open, onClose, title, children, tall }: { open: boolean; onClose: () => void; title: string; children: ReactNode; tall?: boolean }) {
  // Kept mounted when closed so the assistant keeps its draft and scroll.
  return (
    <div className={cx('fixed inset-0 z-40', open ? '' : 'pointer-events-none invisible')} aria-hidden={!open}>
      <div className={cx('absolute inset-0 bg-black/25 transition-opacity', open ? 'opacity-100' : 'opacity-0')} onClick={onClose} />
      <div
        role="dialog"
        aria-label={title}
        className={cx(
          'absolute inset-x-0 bottom-0 flex flex-col rounded-t-sheet bg-surface shadow-float transition-transform duration-300 ease-out',
          tall ? 'h-[88dvh]' : 'max-h-[80dvh]',
          open ? 'translate-y-0' : 'translate-y-full'
        )}
      >
        <div className="flex shrink-0 items-center justify-between px-5 pb-2 pt-3">
          <span className="absolute left-1/2 top-2 h-1 w-10 -translate-x-1/2 rounded-full bg-line-strong" />
          <h2 className="pt-3 text-[15px] font-semibold">{title}</h2>
          <IconButton label="Close" size="sm" onClick={onClose} className="mt-2">
            <X className="h-4 w-4" />
          </IconButton>
        </div>
        <div className={cx('min-h-0 flex-1 pb-safe', tall ? 'flex flex-col' : 'overflow-y-auto')}>{children}</div>
      </div>
    </div>
  );
}

type Doc = ReturnType<typeof useProjectDoc>;

function ProjectDetailsForm({ doc, onDone }: { doc: Doc; onDone: () => void }) {
  const p = doc.project!;
  const [name, setName] = useState(p.name);
  const [client, setClient] = useState(p.client);
  const [location, setLocation] = useState(p.location);
  const [status, setStatus] = useState<ProjectStatus>(p.status);
  const [busy, setBusy] = useState(false);
  const statuses = STAGES;

  const save = async () => {
    setBusy(true);
    try {
      await doc.updateMeta({ name: name.trim() || p.name, client, location, status });
      toast('Project updated');
      onDone();
    } catch {
      toast('Could not update the project');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 px-5 pb-5">
      <Field label="Project name">
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Client">
          <Input value={client} onChange={(e) => setClient(e.target.value)} />
        </Field>
        <Field label="Site location">
          <Input value={location} onChange={(e) => setLocation(e.target.value)} />
        </Field>
      </div>
      <div>
        <span className="mb-1.5 block text-[13px] font-medium text-ink-2">Stage</span>
        <div className="flex flex-wrap gap-1.5">
          {statuses.map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={cx(
                'inline-flex h-8 items-center gap-2 rounded-full border px-3 text-[13px] transition-colors',
                status === s ? 'border-ink bg-ink text-page' : 'border-line text-ink-2 hover:border-line-strong'
              )}
            >
              <span className={cx('h-1.5 w-1.5 rounded-full', STATUS_META[s].dot)} />
              {STATUS_META[s].label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 pt-2">
        <button
          onClick={() => {
            navigator.clipboard?.writeText(window.location.href);
            toast('Link copied');
          }}
          className="inline-flex items-center gap-1.5 text-[13px] text-ink-3 hover:text-ink"
        >
          <Copy className="h-3.5 w-3.5" /> Copy link
        </button>
        <Button variant="primary" loading={busy} onClick={save}>
          Save
        </Button>
      </div>
    </div>
  );
}

function ProjectDetailsDialog({ open, onClose, doc }: { open: boolean; onClose: () => void; doc: Doc }) {
  return (
    <Dialog open={open} onClose={onClose} title="Project details">
      {open && (
        <div className="-mx-5">
          <ProjectDetailsForm doc={doc} onDone={onClose} />
        </div>
      )}
    </Dialog>
  );
}

