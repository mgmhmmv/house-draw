import type { RefObject } from 'react';
import type { ActiveSheetId, BuildingProject, CADTool, SelectableElementKind, SketchStroke } from '../../model/types';
import { PlanCanvas } from '../drawing/plan/PlanCanvas';
import { Viewport3D } from '../../components/Viewport3D';
import { ElevationsAndSectionsView } from '../../components/ElevationsAndSectionsView';
import { SchematicsView } from '../../components/SchematicsView';
import { BOQView } from '../../components/BOQView';
import '../../app-legacy.css';

interface Props {
  model: BuildingProject;
  sheet: ActiveSheetId;
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
}

/**
 * The drawing itself. These are the engine's own views; the workspace around them is new.
 * They render on paper (light) in both app themes, like a printed sheet.
 */
export function SheetView(p: Props) {
  let view: React.ReactNode;
  switch (p.sheet) {
    case '3D-VIEW':
      view = <Viewport3D project={p.model} onUpdateProject={p.onCommit} isLight />;
      break;
    case 'A-201':
    case 'A-301':
      view = <ElevationsAndSectionsView project={p.model} mode={p.sheet} onUpdateProject={p.onCommit} isLight />;
      break;
    case 'E-101':
    case 'P-101':
    case 'H-101':
      view = <SchematicsView project={p.model} mode={p.sheet} onUpdateProject={p.onCommit} isLight />;
      break;
    case 'Q-101':
      view = <BOQView project={p.model} onUpdateProject={p.onCommit} isLight />;
      break;
    default:
      view = (
        <PlanCanvas
          model={p.model}
          sheet={p.sheet}
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
        />
      );
  }
  return <div className="theme-light h-full w-full">{view}</div>;
}
