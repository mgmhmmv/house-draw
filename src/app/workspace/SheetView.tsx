import type { RefObject } from 'react';
import type { ActiveSheetId, BuildingProject, CADTool, SelectableElementKind, SketchStroke } from '../../model/types';
import { PlanCanvas } from '../drawing/plan/PlanCanvas';
import type { AssetDef } from '../drawing/assets/catalog';
import { ModelView, type ModelViewSelect } from '../drawing/three/ModelView';
import { ElevationSheet } from '../drawing/elevation/ElevationSheet';
import type { SheetInfo } from '../../export/sheet';
import { ElectricalSheet } from '../sheets/ElectricalSheet';
import { HvacSheet } from '../sheets/HvacSheet';
import { PlumbingSheet } from '../sheets/PlumbingSheet';
import { BoqSheet } from '../sheets/BoqSheet';
import { BillingSheet } from '../sheets/BillingSheet';
import type { SheetId } from './sheets';
import type { ProjectStatus } from '../lib/api';

interface Props {
  model: BuildingProject;
  sheet: SheetId;
  projectId: string;
  stage: ProjectStatus;
  onStage: (s: ProjectStatus) => void;
  levelIndex: number;
  tool: CADTool;
  selectedId: string | null;
  onSelect: (id: string | null, kind?: SelectableElementKind) => void;
  onCommit: (next: BuildingProject) => void;
  sketchStrokes: SketchStroke[];
  onAddSketchStroke: (s: SketchStroke) => void;
  traceImageUrl: string | null;
  traceOpacity: number;
  svgRef: RefObject<SVGSVGElement | null>;
  placing?: { def: AssetDef; rotation: number } | null;
  onPlaced?: (id: string, kind: SelectableElementKind) => void;
  select3d?: ModelViewSelect;
  paperInfo?: SheetInfo | null;
}

/**
 * The drawing itself. These are the engine's own views; the workspace around them is new.
 * They render on paper (light) in both app themes, like a printed sheet.
 */
export function SheetView(p: Props) {
  let view: React.ReactNode;
  switch (p.sheet) {
    case '3D-VIEW':
      view = <ModelView model={p.model} select={p.select3d} />;
      break;
    case 'A-201':
    case 'A-301':
      view = <ElevationSheet model={p.model} mode={p.sheet === 'A-201' ? 'elevations' : 'sections'} svgRef={p.svgRef} paperInfo={p.paperInfo} />;
      break;
    case 'E-101':
      view = <ElectricalSheet model={p.model} paperInfo={p.paperInfo} />;
      break;
    case 'P-101':
      view = <PlumbingSheet model={p.model} paperInfo={p.paperInfo} />;
      break;
    case 'H-101':
      view = <HvacSheet model={p.model} />;
      break;
    case 'BILL':
      view = <BillingSheet projectId={p.projectId} model={p.model} stage={p.stage} onStage={p.onStage} />;
      break;
    case 'Q-101':
      view = <BoqSheet model={p.model} onCommit={p.onCommit} />;
      break;
    default:
      view = (
        <PlanCanvas
          model={p.model}
          sheet={p.sheet as ActiveSheetId}
          levelIndex={p.levelIndex}
          tool={p.tool}
          selectedId={p.selectedId}
          onSelect={p.onSelect}
          onCommit={p.onCommit}
          sketchStrokes={p.sketchStrokes}
          onAddSketchStroke={p.onAddSketchStroke}
          traceImageUrl={p.traceImageUrl}
          traceOpacity={p.traceOpacity}
          svgRef={p.svgRef}
          placing={p.placing}
          onPlaced={p.onPlaced}
          paperInfo={p.paperInfo}
        />
      );
  }
  return <div className="h-full w-full">{view}</div>;
}
