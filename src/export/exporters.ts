import { BOQReport, calculateBOQ } from '../engine/boqCalculator';
import {
  computeTotalFloorArea,
  levelBoundingBox,
  polygonArea,
  polygonCentroid,
  wallAngleRad,
  wallLength,
} from '../engine/geometry';
import { computeElectricalSLD, computePlumbingRiser } from '../engine/mepEngine';
import { computeEngineeringSchedules, getOpeningMarkMap } from '../engine/standardsEngine';
import { BuildingProject } from '../model/types';

export interface ExportResult {
  filename: string;
  mime: string;
  sizeBytes: number;
  contentPreview: string;
  fullContent: string;
  isBase64?: boolean;
  savedPath?: string;
  downloadUrl?: string;
  timestamp: string;
}

type ExportListener = (result: ExportResult) => void;
const exportListeners = new Set<ExportListener>();

export function onExportComplete(listener: ExportListener): () => void {
  exportListeners.add(listener);
  return () => {
    exportListeners.delete(listener);
  };
}

function emitExportResult(res: ExportResult) {
  exportListeners.forEach((fn) => fn(res));
}

function safeProjectCode(project: BuildingProject): string {
  return project.meta.projectCode.replace(/[^a-zA-Z0-9_-]/g, '_') || 'ARCHSTUDIO';
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function createExportBlob(content: string, mime: string, isBase64 = false): Blob {
  if (isBase64) {
    const cleanB64 = content.replace(/^data:[^;]+;base64,/, '');
    const binary = atob(cleanB64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new Blob([bytes], { type: mime });
  }
  const hasUtf8Type = mime.includes('charset=');
  const fullMime = hasUtf8Type ? mime : `${mime};charset=utf-8`;
  const payload = mime.startsWith('text/csv') ? `\uFEFF${content}` : content;
  return new Blob([payload], { type: fullMime });
}

export function retriggerBrowserDownload(result: ExportResult) {
  const blob = createExportBlob(result.fullContent, result.mime, Boolean(result.isBase64));
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = result.filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    if (a.parentNode) a.parentNode.removeChild(a);
  }, 250);
  // Delay revoking object URL so browser/webview download handlers finish reading it
  setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
}

export async function triggerDownload(
  filename: string,
  content: string,
  mime = 'text/plain',
  isBase64 = false
): Promise<ExportResult> {
  const blob = createExportBlob(content, mime, isBase64);
  const sizeBytes = blob.size;
  const blobUrl = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    if (a.parentNode) a.parentNode.removeChild(a);
  }, 250);
  setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);

  let savedPath: string | undefined;
  let downloadUrl: string | undefined;

  try {
    const resp = await fetch('/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename,
        content,
        encoding: isBase64 ? 'base64' : 'utf8',
      }),
    });
    if (resp.ok) {
      const json = (await resp.json()) as { ok?: boolean; savedPath?: string; filename?: string };
      if (json.ok && json.savedPath) {
        savedPath = json.savedPath;
        downloadUrl = `/api/export?file=${encodeURIComponent(json.filename || filename)}`;
      }
    }
  } catch {
    // Static / production web deployments do not have /api/export; browser download still runs
  }

  const preview = isBase64
    ? `[Binary PNG Image — ${Math.round(sizeBytes / 1024)} KB]`
    : content.slice(0, 600);

  const result: ExportResult = {
    filename,
    mime,
    sizeBytes,
    contentPreview: preview,
    fullContent: content,
    isBase64,
    savedPath,
    downloadUrl,
    timestamp: new Date().toLocaleTimeString(),
  };

  emitExportResult(result);
  return result;
}

export function exportProjectToJSON(project: BuildingProject): Promise<ExportResult> {
  const safeName = safeProjectCode(project);
  return triggerDownload(`${safeName}_BIM.json`, JSON.stringify(project, null, 2), 'application/json');
}

export function exportBOQToCSV(project: BuildingProject, report?: BOQReport): Promise<ExportResult> {
  const r = report ?? calculateBOQ(project);
  const rows: string[] = [
    `"Project","${project.meta.title.replace(/"/g, '""')}"`,
    `"Code","${project.meta.projectCode}"`,
    `"Gross Floor Area (m2)","${r.grossFloorAreaM2}"`,
    `"Estimated Total (${project.meta.currency})","${r.grandTotal}"`,
    '',
    '"Item Code","Division","Description","Unit","Quantity","Unit Rate","Total Cost"',
    ...r.items.map(
      (it) =>
        `"${it.code}","${it.division}","${it.description.replace(/"/g, '""')}","${it.unit}",${it.quantity},${it.unitRate},${it.totalCost}`
    ),
    '',
    `"Subtotal","","","","","",${r.subtotal}`,
    `"Contingency (${r.contingencyPct}%)","","","","","",${r.contingencyAmount}`,
    `"GRAND TOTAL (${project.meta.currency})","","","","","",${r.grandTotal}`,
  ];
  const safeName = safeProjectCode(project);
  return triggerDownload(`${safeName}_BOQ.csv`, rows.join('\n'), 'text/csv');
}

export function exportLevelToDXF(project: BuildingProject, levelIndex = 0): Promise<ExportResult> {
  const level = project.levels[levelIndex] ?? project.levels[0];
  const bb = levelBoundingBox(level);
  const openingMarks = getOpeningMarkMap(project);
  const lines: string[] = [
    '0',
    'SECTION',
    '2',
    'HEADER',
    '9',
    '$INSUNITS',
    '70',
    '6', // meters
    '0',
    'ENDSEC',
    '0',
    'SECTION',
    '2',
    'ENTITIES',
  ];

  const addLine = (layer: string, x1: number, y1: number, x2: number, y2: number) => {
    // Flip Y for CAD Cartesian convention (+Y north)
    lines.push(
      '0',
      'LINE',
      '8',
      layer,
      '10',
      x1.toFixed(4),
      '20',
      (-y1).toFixed(4),
      '30',
      '0.0',
      '11',
      x2.toFixed(4),
      '21',
      (-y2).toFixed(4),
      '31',
      '0.0'
    );
  };

  const addBox = (layer: string, cx: number, cy: number, w: number, d: number) => {
    const hw = w / 2;
    const hd = d / 2;
    addLine(layer, cx - hw, cy - hd, cx + hw, cy - hd);
    addLine(layer, cx + hw, cy - hd, cx + hw, cy + hd);
    addLine(layer, cx + hw, cy + hd, cx - hw, cy + hd);
    addLine(layer, cx - hw, cy + hd, cx - hw, cy - hd);
  };

  const addText = (layer: string, x: number, y: number, h: number, text: string) => {
    lines.push(
      '0',
      'TEXT',
      '8',
      layer,
      '10',
      x.toFixed(4),
      '20',
      (-y).toFixed(4),
      '30',
      '0.0',
      '40',
      h.toFixed(3),
      '1',
      text
    );
  };

  // Structural Grid Axes (S-GRID) & Bay Dimensions (A-ANNO-DIMS)
  const sortedX = [...project.grid.xAxes].sort((a, b) => a.coord - b.coord);
  const sortedY = [...project.grid.yAxes].sort((a, b) => a.coord - b.coord);
  for (const gx of sortedX) {
    addLine('S-GRID', gx.coord, bb.minY - 1.5, gx.coord, bb.maxY + 1.5);
    addText('S-GRID', gx.coord - 0.12, bb.minY - 1.9, 0.25, gx.label);
  }
  for (const gy of sortedY) {
    addLine('S-GRID', bb.minX - 1.5, gy.coord, bb.maxX + 1.5, gy.coord);
    addText('S-GRID', bb.minX - 2.0, gy.coord + 0.08, 0.25, gy.label);
  }

  for (let i = 0; i < sortedX.length - 1; i++) {
    const x1 = sortedX[i].coord;
    const x2 = sortedX[i + 1].coord;
    const dimY = bb.maxY + 1.0;
    addLine('A-ANNO-DIMS', x1, dimY, x2, dimY);
    addLine('A-ANNO-DIMS', x1 - 0.08, dimY - 0.08, x1 + 0.08, dimY + 0.08);
    addLine('A-ANNO-DIMS', x2 - 0.08, dimY - 0.08, x2 + 0.08, dimY + 0.08);
    addText('A-ANNO-DIMS', (x1 + x2) / 2 - 0.28, dimY + 0.22, 0.16, `${Math.round((x2 - x1) * 1000)}`);
  }
  for (let i = 0; i < sortedY.length - 1; i++) {
    const y1 = sortedY[i].coord;
    const y2 = sortedY[i + 1].coord;
    const dimX = bb.maxX + 1.0;
    addLine('A-ANNO-DIMS', dimX, y1, dimX, y2);
    addLine('A-ANNO-DIMS', dimX - 0.08, y1 - 0.08, dimX + 0.08, y1 + 0.08);
    addLine('A-ANNO-DIMS', dimX - 0.08, y2 - 0.08, dimX + 0.08, y2 + 0.08);
    addText('A-ANNO-DIMS', dimX + 0.14, (y1 + y2) / 2, 0.16, `${Math.round((y2 - y1) * 1000)}`);
  }
  if (bb.width > 0) {
    const dimY = bb.maxY + 1.65;
    addLine('A-ANNO-DIMS', bb.minX, dimY, bb.maxX, dimY);
    addLine('A-ANNO-DIMS', bb.minX, bb.maxY + 0.2, bb.minX, dimY + 0.15);
    addLine('A-ANNO-DIMS', bb.maxX, bb.maxY + 0.2, bb.maxX, dimY + 0.15);
    addText('A-ANNO-DIMS', (bb.minX + bb.maxX) / 2 - 0.55, dimY + 0.24, 0.18, `${Math.round(bb.width * 1000)} mm`);
  }
  if (bb.depth > 0) {
    const dimX = bb.maxX + 1.75;
    addLine('A-ANNO-DIMS', dimX, bb.minY, dimX, bb.maxY);
    addLine('A-ANNO-DIMS', bb.maxX + 0.2, bb.minY, dimX + 0.15, bb.minY);
    addLine('A-ANNO-DIMS', bb.maxX + 0.2, bb.maxY, dimX + 0.15, bb.maxY);
    addText('A-ANNO-DIMS', dimX + 0.16, (bb.minY + bb.maxY) / 2, 0.18, `${Math.round(bb.depth * 1000)} mm`);
  }

  // Architectural Walls (A-WALL-EXTR / A-WALL-INTR) & Beam Centerlines (S-BEAM)
  for (const w of level.walls) {
    const wallLayer = w.isExterior ? 'A-WALL-EXTR' : 'A-WALL-INTR';
    const dx = w.end.x - w.start.x;
    const dy = w.end.y - w.start.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = (-dy / len) * (w.thickness / 2);
    const ny = (dx / len) * (w.thickness / 2);
    addLine(wallLayer, w.start.x + nx, w.start.y + ny, w.end.x + nx, w.end.y + ny);
    addLine(wallLayer, w.start.x - nx, w.start.y - ny, w.end.x - nx, w.end.y - ny);
    addLine(wallLayer, w.start.x + nx, w.start.y + ny, w.start.x - nx, w.start.y - ny);
    addLine(wallLayer, w.end.x + nx, w.end.y + ny, w.end.x - nx, w.end.y - ny);
    if (w.isExterior || w.isLoadBearing) {
      addLine('S-BEAM', w.start.x, w.start.y, w.end.x, w.end.y);
    }
  }

  // Doors (A-DOOR), Windows (A-GLAZ) & Schedule Marks (A-ANNO-DIMS)
  for (const op of level.openings) {
    const wall = level.walls.find((w) => w.id === op.wallId);
    if (!wall) continue;
    const cx = wall.start.x + (wall.end.x - wall.start.x) * op.offset;
    const cy = wall.start.y + (wall.end.y - wall.start.y) * op.offset;
    const len = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y) || 1;
    const ux = (wall.end.x - wall.start.x) / len;
    const uy = (wall.end.y - wall.start.y) / len;
    const vx = -uy * op.swingDirection;
    const vy = ux * op.swingDirection;
    const half = op.width / 2;

    if (op.kind === 'door') {
      const hingeX = cx - ux * half;
      const hingeY = cy - uy * half;
      const openX = hingeX + vx * op.width;
      const openY = hingeY + vy * op.width;
      addLine('A-DOOR', hingeX, hingeY, cx + ux * half, cy + uy * half);
      addLine('A-DOOR', hingeX, hingeY, openX, openY);
      // Quarter-circle door swing chord approximation (4 segments)
      let prevX = cx + ux * half;
      let prevY = cy + uy * half;
      for (let s = 1; s <= 4; s++) {
        const a = (Math.PI / 2) * (s / 4);
        const px = hingeX + (ux * Math.cos(a) + vx * Math.sin(a)) * op.width;
        const py = hingeY + (uy * Math.cos(a) + vy * Math.sin(a)) * op.width;
        addLine('A-DOOR', prevX, prevY, px, py);
        prevX = px;
        prevY = py;
      }
    } else {
      const wt = wall.thickness * 0.35;
      addLine('A-GLAZ', cx - ux * half - uy * wt, cy - uy * half + ux * wt, cx + ux * half - uy * wt, cy + uy * half + ux * wt);
      addLine('A-GLAZ', cx - ux * half + uy * wt, cy - uy * half - ux * wt, cx + ux * half + uy * wt, cy + uy * half - ux * wt);
    }

    const mark = openingMarks.get(op.id) ?? op.label ?? (op.kind === 'door' ? 'D' : 'W');
    addText('A-ANNO-DIMS', cx - uy * 0.32, cy + ux * 0.32, 0.14, mark);
  }

  // Columns (S-COLS) & Pad Footings (S-FNDN)
  for (const col of level.columns) {
    addBox('S-COLS', col.position.x, col.position.y, col.width, col.depth);
    addText('S-COLS', col.position.x + col.width / 2 + 0.05, col.position.y, 0.16, col.label);
    if (level.index === 0) {
      addBox('S-FNDN', col.position.x, col.position.y, col.footingSize, col.footingSize);
      addText(
        'S-FNDN',
        col.position.x - col.footingSize / 2 + 0.05,
        col.position.y + col.footingSize / 2 + 0.14,
        0.13,
        `F-${col.label}`
      );
    }
  }

  // MEP Circuits & Nodes (AIA Electrical & Plumbing Layers)
  const mepCircuitLayer = (sys: string) => {
    if (sys === 'electrical_light') return 'E-LITE';
    if (sys.startsWith('electrical')) return 'E-POWR';
    if (sys === 'plumbing_drain') return 'P-SANR';
    return 'P-DOMW';
  };
  for (const ckt of level.mepCircuits) {
    const layer = mepCircuitLayer(ckt.system);
    for (let i = 0; i < ckt.points.length - 1; i++) {
      addLine(layer, ckt.points[i].x, ckt.points[i].y, ckt.points[i + 1].x, ckt.points[i + 1].y);
    }
  }
  for (const node of level.mepNodes) {
    const k = String(node.kind);
    const layer =
      node.system === 'electrical'
        ? k.includes('light') || k.includes('switch') || k.includes('smoke')
          ? 'E-LITE'
          : 'E-POWR'
        : k.includes('wc') || k.includes('sink') || k.includes('trap')
          ? 'P-SANR'
          : 'P-DOMW';
    addBox(layer, node.position.x, node.position.y, 0.22, 0.22);
    addText(layer, node.position.x + 0.15, node.position.y, 0.12, node.label || node.kind.toUpperCase());
  }

  // Room Tags (A-AREA-IDEN)
  level.rooms.forEach((r, idx) => {
    if (r.polygon.length === 0) return;
    const c = polygonCentroid(r.polygon);
    const area = polygonArea(r.polygon).toFixed(1);
    const roomCode = `RM-${level.index + 1}0${idx + 1}`;
    addText('A-AREA-IDEN', c.x - 0.8, c.y, 0.22, `${roomCode} ${r.name} (${area}m2)`);
  });

  lines.push('0', 'ENDSEC', '0', 'EOF');
  const safeName = safeProjectCode(project);
  return triggerDownload(`${safeName}_L${level.index + 1}.dxf`, lines.join('\n'), 'application/dxf');
}

function cloneSVGWithExplicitBounds(svgEl: SVGSVGElement): SVGSVGElement {
  const clone = svgEl.cloneNode(true) as SVGSVGElement;
  if (!clone.getAttribute('xmlns')) {
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  }
  const rect = svgEl.getBoundingClientRect();
  const vbAttr = clone.getAttribute('viewBox');
  const parsedW = vbAttr ? parseFloat(vbAttr.split(/[\s,]+/)[2] || '0') : 0;
  const parsedH = vbAttr ? parseFloat(vbAttr.split(/[\s,]+/)[3] || '0') : 0;

  const w = Math.max(400, Math.round(rect.width || parsedW || 1200));
  const h = Math.max(300, Math.round(rect.height || parsedH || 800));

  if (!vbAttr) {
    clone.setAttribute('viewBox', `0 0 ${w} ${h}`);
  }
  if (!clone.getAttribute('width')) {
    clone.setAttribute('width', String(parsedW > 0 ? parsedW : w));
  }
  if (!clone.getAttribute('height')) {
    clone.setAttribute('height', String(parsedH > 0 ? parsedH : h));
  }
  return clone;
}

export async function exportSVGElement(
  svgElement: SVGSVGElement | null,
  filename: string
): Promise<ExportResult | null> {
  const serializer = new XMLSerializer();
  if (svgElement) {
    const normalized = cloneSVGWithExplicitBounds(svgElement);
    const source = serializer.serializeToString(normalized);
    return triggerDownload(filename, `<?xml version="1.0" encoding="UTF-8"?>\n${source}`, 'image/svg+xml');
  }

  const domSvgs = Array.from(document.querySelectorAll('main svg')) as SVGSVGElement[];
  if (domSvgs.length === 0) return null;

  if (domSvgs.length === 1) {
    const normalized = cloneSVGWithExplicitBounds(domSvgs[0]);
    const source = serializer.serializeToString(normalized);
    return triggerDownload(filename, `<?xml version="1.0" encoding="UTF-8"?>\n${source}`, 'image/svg+xml');
  }

  // Compose multiple viewport SVGs (e.g., 4 architectural elevations on A-201) into one SVG sheet
  const cellW = 620;
  const cellH = 340;
  const cols = 2;
  const rows = Math.ceil(domSvgs.length / cols);
  const totalW = cols * cellW;
  const totalH = rows * cellH;
  const nestedParts = domSvgs.map((el, idx) => {
    const colIdx = idx % cols;
    const rowIdx = Math.floor(idx / cols);
    const normalized = cloneSVGWithExplicitBounds(el);
    normalized.setAttribute('x', String(colIdx * cellW + 10));
    normalized.setAttribute('y', String(rowIdx * cellH + 10));
    normalized.setAttribute('width', String(cellW - 20));
    normalized.setAttribute('height', String(cellH - 20));
    return serializer.serializeToString(normalized);
  });

  const composite = `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${totalH}" viewBox="0 0 ${totalW} ${totalH}" style="background:#f8fafc">\n${nestedParts.join('\n')}\n</svg>`;
  return triggerDownload(filename, `<?xml version="1.0" encoding="UTF-8"?>\n${composite}`, 'image/svg+xml');
}

export async function exportViewportPNG(
  project: BuildingProject,
  activeSheet: string
): Promise<ExportResult | null> {
  const canvas = document.querySelector('main canvas') as HTMLCanvasElement | null;
  if (!canvas) return null;
  const dataUrl = canvas.toDataURL('image/png');
  const safeName = safeProjectCode(project);
  return triggerDownload(`${safeName}_${activeSheet}.png`, dataUrl, 'image/png', true);
}

function appendBoxOBJ(
  lines: string[],
  vertexCursor: { count: number },
  cx: number,
  cy: number,
  cz: number,
  sx: number,
  sy: number,
  sz: number,
  rotYRad = 0
) {
  const hx = sx / 2;
  const hy = sy / 2;
  const hz = sz / 2;
  const cos = Math.cos(rotYRad);
  const sin = Math.sin(rotYRad);

  const localVerts: [number, number, number][] = [
    [-hx, -hy, -hz],
    [hx, -hy, -hz],
    [hx, hy, -hz],
    [-hx, hy, -hz],
    [-hx, -hy, hz],
    [hx, -hy, hz],
    [hx, hy, hz],
    [-hx, hy, hz],
  ];

  const base = vertexCursor.count + 1;
  for (const [lx, ly, lz] of localVerts) {
    const wx = cx + lx * cos - lz * sin;
    const wy = cy + ly;
    const wz = cz + lx * sin + lz * cos;
    lines.push(`v ${wx.toFixed(4)} ${wy.toFixed(4)} ${wz.toFixed(4)}`);
  }
  vertexCursor.count += 8;

  const faces = [
    [0, 3, 2, 1],
    [4, 5, 6, 7],
    [0, 1, 5, 4],
    [2, 3, 7, 6],
    [0, 4, 7, 3],
    [1, 2, 6, 5],
  ];
  for (const [a, b, c, d] of faces) {
    lines.push(`f ${base + a} ${base + b} ${base + c} ${base + d}`);
  }
}

export function export3DToOBJ(project: BuildingProject): Promise<ExportResult> {
  const lines: string[] = [
    `# ArchStudio BIM 3D Wavefront OBJ Export`,
    `# Project: ${project.meta.title} (${project.meta.projectCode})`,
    `o ${safeProjectCode(project)}_Building`,
  ];
  const cursor = { count: 0 };

  for (const lvl of project.levels) {
    const bb = levelBoundingBox(lvl);
    const baseY = lvl.elevation;
    lines.push(`g Level_${lvl.index + 1}_${lvl.name.replace(/\s+/g, '_')}`);

    if (lvl.walls.length > 0) {
      appendBoxOBJ(
        lines,
        cursor,
        (bb.minX + bb.maxX) / 2,
        baseY - lvl.slabThickness / 2,
        (bb.minY + bb.maxY) / 2,
        bb.width + 0.2,
        lvl.slabThickness,
        bb.depth + 0.2
      );
    }

    for (const col of lvl.columns) {
      appendBoxOBJ(
        lines,
        cursor,
        col.position.x,
        baseY + lvl.floorToFloorHeight / 2,
        col.position.y,
        col.width,
        lvl.floorToFloorHeight,
        col.depth
      );
    }

    for (const wall of lvl.walls) {
      const len = wallLength(wall);
      if (len < 0.05) continue;
      const angle = -wallAngleRad(wall);
      const midX = (wall.start.x + wall.end.x) / 2;
      const midZ = (wall.start.y + wall.end.y) / 2;
      appendBoxOBJ(lines, cursor, midX, baseY + wall.height / 2, midZ, len, wall.height, wall.thickness, -angle);
    }
  }

  const topLvl = project.levels[project.levels.length - 1];
  if (topLvl && topLvl.walls.length > 0) {
    const rBB = levelBoundingBox(topLvl);
    const eaveY = topLvl.elevation + topLvl.floorToFloorHeight;
    const ov = project.roof.overhang;
    const w = rBB.width + ov * 2;
    const d = rBB.depth + ov * 2;
    const cx = (rBB.minX + rBB.maxX) / 2;
    const cz = (rBB.minY + rBB.maxY) / 2;
    lines.push('g Roof_Assembly');
    if (project.roof.type === 'flat') {
      appendBoxOBJ(lines, cursor, cx, eaveY + 0.11, cz, w, 0.22, d);
    } else {
      const hw = w / 2;
      const hd = d / 2;
      const rise = Math.max(0.4, (Math.min(w, d) / 2) * Math.tan((project.roof.pitchDeg * Math.PI) / 180));
      const ridgeHalf = project.roof.type === 'hip' ? Math.max(0.2, hw - hd * 0.85) : hw;
      const base = cursor.count + 1;
      const pts: [number, number, number][] = [
        [cx - hw, eaveY, cz + hd],
        [cx + hw, eaveY, cz + hd],
        [cx + hw, eaveY, cz - hd],
        [cx - hw, eaveY, cz - hd],
        [cx - ridgeHalf, eaveY + rise, cz],
        [cx + ridgeHalf, eaveY + rise, cz],
      ];
      for (const [px, py, pz] of pts) {
        lines.push(`v ${px.toFixed(4)} ${py.toFixed(4)} ${pz.toFixed(4)}`);
      }
      cursor.count += 6;
      lines.push(`f ${base} ${base + 1} ${base + 5} ${base + 4}`);
      lines.push(`f ${base + 2} ${base + 3} ${base + 4} ${base + 5}`);
      lines.push(`f ${base + 1} ${base + 2} ${base + 5}`);
      lines.push(`f ${base + 3} ${base} ${base + 4}`);
    }
  }

  const safeName = safeProjectCode(project);
  return triggerDownload(`${safeName}_3D_Model.obj`, lines.join('\n'), 'text/plain');
}

function buildPlanSVGMarkup(project: BuildingProject): string {
  const levels = project.levels;
  return levels
    .map((lvl) => {
      const bb = levelBoundingBox(lvl);
      const pad = 2.4;
      const vx = bb.minX - pad;
      const vy = bb.minY - pad;
      const vw = Math.max(8, bb.width + pad * 2);
      const vh = Math.max(6, bb.depth + pad * 2);

      const gridMarkup = [
        ...project.grid.xAxes.map(
          (g) =>
            `<line x1="${g.coord}" y1="${vy + 0.4}" x2="${g.coord}" y2="${vy + vh - 0.4}" stroke="#94a3b8" stroke-width="0.03" stroke-dasharray="0.2 0.15"/>
             <circle cx="${g.coord}" cy="${vy + 0.3}" r="0.24" fill="#fff" stroke="#0284c7" stroke-width="0.04"/>
             <text x="${g.coord}" y="${vy + 0.37}" font-size="0.22" text-anchor="middle" fill="#0369a1" font-family="monospace">${escapeHtml(g.label)}</text>`
        ),
        ...project.grid.yAxes.map(
          (g) =>
            `<line x1="${vx + 0.4}" y1="${g.coord}" x2="${vx + vw - 0.4}" y2="${g.coord}" stroke="#94a3b8" stroke-width="0.03" stroke-dasharray="0.2 0.15"/>
             <circle cx="${vx + 0.3}" cy="${g.coord}" r="0.24" fill="#fff" stroke="#0284c7" stroke-width="0.04"/>
             <text x="${vx + 0.3}" y="${g.coord + 0.07}" font-size="0.22" text-anchor="middle" fill="#0369a1" font-family="monospace">${escapeHtml(g.label)}</text>`
        ),
      ].join('');

      const roomMarkup = lvl.rooms
        .map((r) => {
          const pts = r.polygon.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
          const c = polygonCentroid(r.polygon);
          const area = polygonArea(r.polygon).toFixed(1);
          return `<polygon points="${pts}" fill="#f1f5f9" fill-opacity="0.7" stroke="#cbd5e1" stroke-width="0.03"/>
                  <text x="${c.x.toFixed(2)}" y="${c.y.toFixed(2)}" font-size="0.28" font-weight="bold" text-anchor="middle" fill="#0f172a" font-family="sans-serif">${escapeHtml(r.name)}</text>
                  <text x="${c.x.toFixed(2)}" y="${(c.y + 0.35).toFixed(2)}" font-size="0.22" text-anchor="middle" fill="#475569" font-family="monospace">${area} m²</text>`;
        })
        .join('');

      const wallMarkup = lvl.walls
        .map(
          (w) =>
            `<line x1="${w.start.x}" y1="${w.start.y}" x2="${w.end.x}" y2="${w.end.y}" stroke="${w.isExterior ? '#0f172a' : '#334155'}" stroke-width="${w.thickness}" stroke-linecap="square"/>`
        )
        .join('');

      const colMarkup = lvl.columns
        .map(
          (c) =>
            `<rect x="${c.position.x - c.width / 2}" y="${c.position.y - c.depth / 2}" width="${c.width}" height="${c.depth}" fill="#0284c7" stroke="#0f172a" stroke-width="0.02"/>`
        )
        .join('');

      const opMarkup = lvl.openings
        .map((op) => {
          const w = lvl.walls.find((x) => x.id === op.wallId);
          if (!w) return '';
          const cx = w.start.x + (w.end.x - w.start.x) * op.offset;
          const cy = w.start.y + (w.end.y - w.start.y) * op.offset;
          const deg = (wallAngleRad(w) * 180) / Math.PI;
          const color = op.kind === 'door' ? '#d97706' : '#0284c7';
          return `<g transform="translate(${cx.toFixed(2)},${cy.toFixed(2)}) rotate(${deg.toFixed(1)})">
                    <rect x="${(-op.width / 2).toFixed(2)}" y="-0.1" width="${op.width.toFixed(2)}" height="0.2" fill="#fff" stroke="${color}" stroke-width="0.04"/>
                  </g>`;
        })
        .join('');

      return `
        <div class="plan-card">
          <h3>Level ${lvl.index + 1}: ${escapeHtml(lvl.name)} (Elevation +${lvl.elevation.toFixed(2)}m · F2F ${lvl.floorToFloorHeight.toFixed(2)}m)</h3>
          <svg viewBox="${vx.toFixed(2)} ${vy.toFixed(2)} ${vw.toFixed(2)} ${vh.toFixed(2)}" width="100%" height="360" style="background:#ffffff;border:1px solid #cbd5e1;border-radius:6px">
            ${gridMarkup}
            ${roomMarkup}
            ${wallMarkup}
            ${opMarkup}
            ${colMarkup}
          </svg>
        </div>`;
    })
    .join('');
}

export function exportFullDrawingSetHTML(project: BuildingProject): Promise<ExportResult> {
  const boq = calculateBOQ(project);
  const sld = computeElectricalSLD(project);
  const plumb = computePlumbingRiser(project);
  const sched = computeEngineeringSchedules(project);
  const totalArea = computeTotalFloorArea(project);
  const cur = escapeHtml(project.meta.currency);

  const badgeStyle = (status: string) =>
    status === 'PASS'
      ? 'background:#dcfce7;color:#166534;padding:2px 6px;border-radius:4px;font-weight:700;font-family:monospace;font-size:10px'
      : 'background:#fef3c7;color:#92400e;padding:2px 6px;border-radius:4px;font-weight:700;font-family:monospace;font-size:10px';

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(project.meta.projectCode)} - Full Engineering Drawing Set</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #0f172a; background: #f8fafc; margin: 0; padding: 24px; }
    .toolbar { position: sticky; top: 0; background: #0f172a; color: #fff; padding: 12px 18px; border-radius: 8px; display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; z-index: 10; }
    .btn { background: #0284c7; color: #fff; border: none; padding: 8px 14px; border-radius: 6px; font-weight: 600; cursor: pointer; }
    .sheet { background: #fff; border: 1px solid #cbd5e1; border-radius: 8px; padding: 24px; margin-bottom: 24px; page-break-after: always; break-after: page; }
    .sheet-hdr { display: flex; justify-content: space-between; border-bottom: 2px solid #0f172a; padding-bottom: 10px; margin-bottom: 16px; }
    .sheet-code { font-family: monospace; font-size: 18px; font-weight: 700; color: #0369a1; }
    .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 18px; }
    .kpi { border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px 12px; background: #f8fafc; }
    .kpi-lbl { font-size: 11px; color: #64748b; text-transform: uppercase; font-family: monospace; }
    .kpi-val { font-size: 17px; font-weight: 700; font-family: monospace; margin-top: 4px; }
    table { width: 100%; border-collapse: collapse; font-size: 11.5px; margin-top: 8px; margin-bottom: 14px; }
    th, td { border: 1px solid #cbd5e1; padding: 5px 8px; text-align: left; }
    th { background: #f1f5f9; font-family: monospace; font-size: 10.5px; }
    .num { text-align: right; font-family: monospace; }
    .plan-card { margin-bottom: 18px; }
    h3 { font-size: 13px; margin: 14px 0 6px 0; color: #0f172a; font-family: monospace; text-transform: uppercase; }
    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    @media print { .no-print { display: none !important; } body { background: #fff; padding: 0; } .sheet { border: none; margin: 0; } }
  </style>
</head>
<body>
  <div class="toolbar no-print">
    <div><strong>ArchStudio BIM</strong> · Standards-Compliant Engineering Drawing Set (${escapeHtml(project.meta.projectCode)})</div>
    <button class="btn" onclick="window.print()">Print / Save as PDF</button>
  </div>

  <section class="sheet">
    <div class="sheet-hdr">
      <div>
        <div class="sheet-code">SHEET A-000 · COVER, TRANSMITTAL INDEX & CODE COMPLIANCE</div>
        <h1 style="margin:4px 0 0;font-size:20px">${escapeHtml(project.meta.title)}</h1>
      </div>
      <div style="text-align:right;font-family:monospace;font-size:12px">
        <div>Code: ${escapeHtml(project.meta.projectCode)} · Rev ${escapeHtml(project.meta.revision)}</div>
        <div>Client: ${escapeHtml(project.meta.client)} · ${escapeHtml(project.meta.date)}</div>
      </div>
    </div>
    <div class="kpis">
      <div class="kpi"><div class="kpi-lbl">Gross Floor Area</div><div class="kpi-val">${totalArea.toFixed(1)} m²</div></div>
      <div class="kpi"><div class="kpi-lbl">Glazing Ratio (IBC)</div><div class="kpi-val">${sched.glazingToFloorPct}% (${sched.totalWindowGlazingM2} m²)</div></div>
      <div class="kpi"><div class="kpi-lbl">Electrical Demand</div><div class="kpi-val">${sld.diversifiedLoadKW} kW / ${sld.designCurrentAmps} A</div></div>
      <div class="kpi"><div class="kpi-lbl">Est. Construction Cost</div><div class="kpi-val">${cur}${boq.grandTotal.toLocaleString()}</div></div>
    </div>
    <h3>Drawing Transmittal Index</h3>
    <table>
      <thead><tr><th>Sheet</th><th>Title</th><th>Applicable Standards</th><th>Status</th></tr></thead>
      <tbody>
        <tr><td>A-000</td><td>Cover Sheet, General Notes & Code Compliance Matrix</td><td>ISO 128 · AIA CAD · IBC 2024</td><td>Issued for Construction</td></tr>
        <tr><td>A-101</td><td>Architectural Floor Plans, Door/Window & Room Schedules</td><td>ISO 128 · IBC 2024 §1208 · ADA</td><td>Issued for Construction</td></tr>
        <tr><td>S-101</td><td>Structural Foundation, Column, RC Beam & BS 8666 BBS</td><td>ACI 318-19 · Eurocode 2 · BS 8666</td><td>Issued for Construction</td></tr>
        <tr><td>E-101</td><td>Electrical SLD, Voltage Drop & Fault Protection Schedule</td><td>IEC 60617 · IEC 60364 · BS 7671</td><td>Issued for Construction</td></tr>
        <tr><td>P-101</td><td>Plumbing Supply, Inspection Chambers & EN 12056 Stormwater</td><td>IPC · BS EN 806 · EN 12056-3</td><td>Issued for Construction</td></tr>
        <tr><td>Q-101</td><td>Bill of Quantities & Raw Material Take-Off</td><td>CSI MasterFormat / SMM7</td><td>Tender Ready</td></tr>
      </tbody>
    </table>

    <h3>International Standards & Code Compliance Matrix</h3>
    <table>
      <thead><tr><th>Standard / Code</th><th>Discipline</th><th>Engineering Requirement</th><th>Calculated / Model Value</th><th>Status</th></tr></thead>
      <tbody>
        ${sched.complianceChecks
          .map(
            (chk) =>
              `<tr><td><strong>${escapeHtml(chk.code)}</strong></td><td>${escapeHtml(chk.discipline)}</td><td>${escapeHtml(chk.requirement)}</td><td style="font-family:monospace">${escapeHtml(chk.actual)}</td><td><span style="${badgeStyle(chk.status)}">${chk.status}</span></td></tr>`
          )
          .join('')}
      </tbody>
    </table>

    <p style="font-family:monospace;font-size:11px;margin-top:12px;line-height:1.5;color:#334155">
      <strong>GENERAL NOTES:</strong> Drawing drafting conventions per ISO 128 &amp; BS 8888. Structural concrete C25/30 (min 25 MPa), rebar B500B (fy=500 MPa), cover 25mm slabs / 40mm columns / 50mm footings over 100mm C15 PCC blinding; safe bearing capacity 150 kN/m² at -0.90m NGL.
      Electrical supply ${escapeHtml(sld.supplySystem)} (${escapeHtml(sld.mainBreakerSpec)}, PF ${sld.powerFactor}, SPD: ${escapeHtml(sld.spdSpec)}, max ΔV ${sld.maxVoltageDropPct}%). Plumbing supply ${escapeHtml(plumb.supplyMainPipe)},
      peak demand ${plumb.peakFlowLps} L/s (${plumb.totalWSFU} WSFU / ${plumb.totalDFU} DFU), Soil stack ${escapeHtml(plumb.soilStackPipe)}, Stormwater ${plumb.stormwaterRunoffLps} L/s via ${plumb.rainwaterDownpipesCount}× ${escapeHtml(plumb.rainwaterPipeSpec)}.
    </p>
  </section>

  <section class="sheet">
    <div class="sheet-hdr">
      <div class="sheet-code">SHEET A-101 · ARCHITECTURAL FLOOR PLANS & SCHEDULES</div>
      <div style="font-family:monospace;font-size:12px">Scale: ${escapeHtml(project.meta.scale)} · ISO 128</div>
    </div>
    ${buildPlanSVGMarkup(project)}
    <div class="grid-2">
      <div>
        <h3>Door Schedule (IBC §1010)</h3>
        <table>
          <thead><tr><th>Mark</th><th>Type</th><th class="num">W×H (mm)</th><th>Fire Rating</th><th class="num">Qty</th></tr></thead>
          <tbody>
            ${sched.doors
              .map(
                (d) =>
                  `<tr><td><strong>${escapeHtml(d.mark)}</strong></td><td>${escapeHtml(d.style)}</td><td class="num">${d.widthMm}×${d.heightMm}</td><td>${escapeHtml(d.fireRating)}</td><td class="num">${d.count}</td></tr>`
              )
              .join('')}
          </tbody>
        </table>
      </div>
      <div>
        <h3>Window & Glazing Schedule</h3>
        <table>
          <thead><tr><th>Mark</th><th>Type</th><th class="num">W×H / Sill (mm)</th><th>Glazing (U-val)</th><th class="num">Qty</th></tr></thead>
          <tbody>
            ${sched.windows
              .map(
                (w) =>
                  `<tr><td><strong>${escapeHtml(w.mark)}</strong></td><td>${escapeHtml(w.style)}</td><td class="num">${w.widthMm}×${w.heightMm} / S:${w.sillMm}</td><td>${escapeHtml(w.glazingSpec)} (${w.uValue})</td><td class="num">${w.count}</td></tr>`
              )
              .join('')}
          </tbody>
        </table>
      </div>
    </div>
    <h3>Room Finish & IBC 1208 Minimum Area Schedule</h3>
    <table>
      <thead><tr><th>Room Code</th><th>Level</th><th>Room Name</th><th class="num">Area (m²)</th><th>Floor Finish</th><th>Status</th></tr></thead>
      <tbody>
        ${sched.rooms
          .map(
            (r) =>
              `<tr><td><strong>${escapeHtml(r.code)}</strong></td><td>${escapeHtml(r.levelName)}</td><td>${escapeHtml(r.name)}</td><td class="num">${r.areaM2}</td><td>${escapeHtml(r.floorFinish)}</td><td><span style="${badgeStyle(r.compliance)}">${r.compliance}</span></td></tr>`
          )
          .join('')}
      </tbody>
    </table>
  </section>

  <section class="sheet">
    <div class="sheet-hdr">
      <div class="sheet-code">SHEET S-101 · STRUCTURAL FOUNDATION, BEAM & BAR BENDING SCHEDULE</div>
      <div style="font-family:monospace;font-size:12px">ACI 318-19 · Eurocode 2 · BS 8666 · RC Columns: ${sched.columns.length}</div>
    </div>
    <h3>Column & Pad Footing Schedule (incl. 100mm PCC Blinding)</h3>
    <table>
      <thead><tr><th>Level</th><th>Col Tag</th><th>Size (mm)</th><th class="num">Axial (kN)</th><th>Main Rebar</th><th>Footing</th><th>Pad Size (mm)</th><th>PCC</th><th>Footing Mesh</th></tr></thead>
      <tbody>
        ${sched.columns
          .map(
            (c) =>
              `<tr><td>${escapeHtml(c.levelName)}</td><td><strong>${escapeHtml(c.colMark)}</strong></td><td class="num">${escapeHtml(c.colSizeMm)}</td><td class="num">${c.axialLoadKN}</td><td>${escapeHtml(c.mainBars)}</td><td>${escapeHtml(c.footingMark)}</td><td>${escapeHtml(c.footingSizeMm)}</td><td>${escapeHtml(c.pccBlindingMm)}</td><td>${escapeHtml(c.bottomMesh)}</td></tr>`
          )
          .join('')}
      </tbody>
    </table>
    <h3>RC Plinth & Floor Beam / Lintel Schedule</h3>
    <table>
      <thead><tr><th>Beam Mark</th><th>Location</th><th>Size (mm)</th><th>Grade</th><th>Top Steel</th><th>Bottom Steel</th><th>Stirrups</th><th class="num">Max Span (m)</th><th>L/d</th><th>Check</th></tr></thead>
      <tbody>
        ${sched.beams
          .map(
            (b) =>
              `<tr><td><strong>${escapeHtml(b.mark)}</strong></td><td>${escapeHtml(b.location)}</td><td class="num">${escapeHtml(b.sizeMm)}</td><td>${escapeHtml(b.concreteGrade)}</td><td>${escapeHtml(b.topSteel)}</td><td>${escapeHtml(b.bottomSteel)}</td><td>${escapeHtml(b.stirrups)}</td><td class="num">${b.maxSpanM}</td><td class="num">${b.spanDepthRatio}</td><td><span style="${badgeStyle(b.status)}">${b.status}</span></td></tr>`
          )
          .join('')}
      </tbody>
    </table>
    <h3>BS 8666 Bar Bending Schedule (BBS)</h3>
    <table>
      <thead><tr><th>Bar Mark</th><th>Dia</th><th>Shape Code</th><th>Structural Member</th><th class="num">Total Bars</th><th class="num">Cut Length (m)</th><th class="num">Total Weight (kg)</th></tr></thead>
      <tbody>
        ${sched.bbs
          .map(
            (bar) =>
              `<tr><td><strong>${escapeHtml(bar.barMark)}</strong></td><td>T${bar.diameterMm}</td><td>SC ${bar.shapeCode}</td><td>${escapeHtml(bar.member)}</td><td class="num">${bar.totalBars}</td><td class="num">${bar.cutLengthM}</td><td class="num">${bar.totalWeightKg}</td></tr>`
          )
          .join('')}
      </tbody>
    </table>
  </section>

  <section class="sheet">
    <div class="sheet-hdr">
      <div class="sheet-code">SHEETS E-101 & P-101 · MEP ENGINEERING SCHEDULES</div>
      <div style="font-family:monospace;font-size:12px">${escapeHtml(sld.supplySystem)} · Max ΔV: ${sld.maxVoltageDropPct}% · ${plumb.peakFlowLps} L/s (${plumb.totalWSFU} WSFU)</div>
    </div>
    <h3>Electrical Circuit Load, Voltage Drop & Fault Protection Schedule (IEC 60364 / BS 7671)</h3>
    <p style="font-family:monospace;font-size:11px;margin:4px 0 8px">
      Main Incoming: ${escapeHtml(sld.mainBreakerSpec)} | SPD: ${escapeHtml(sld.spdSpec)} | PF: ${sld.powerFactor} | Phase Balance: L1 ${sld.phaseBalance.L1_kW}kW / L2 ${sld.phaseBalance.L2_kW}kW / L3 ${sld.phaseBalance.L3_kW}kW
    </p>
    <table>
      <thead><tr><th>Ckt</th><th>Description</th><th>Phase</th><th class="num">Load (W)</th><th class="num">Amps</th><th>Breaker / RCD</th><th>Cable</th><th class="num">Len (m)</th><th class="num">ΔV (%)</th><th class="num">Max Zs (Ω)</th></tr></thead>
      <tbody>
        ${sld.circuits
          .map(
            (c) =>
              `<tr><td><strong>${escapeHtml(c.circuitId)}</strong></td><td>${escapeHtml(c.name)}</td><td>${escapeHtml(c.phase)}</td><td class="num">${c.loadWatts}</td><td class="num">${c.designAmps}</td><td>${escapeHtml(c.breakerRating)} (${c.breakingCapacityKA}kA / ${c.rcdSensitivitymA}mA)</td><td>${escapeHtml(c.cableSpec)}</td><td class="num">${c.cableLengthM}</td><td class="num">${c.voltageDropPct}%</td><td class="num">${c.zsMaxOhms}</td></tr>`
          )
          .join('')}
      </tbody>
    </table>
    <div class="grid-2">
      <div>
        <h3>Plumbing Fixture & Demand (${plumb.dailyWaterDemandLiters} L/day · ${plumb.designVelocityMps} m/s)</h3>
        <table>
          <thead><tr><th>Fixture Type</th><th class="num">Count</th><th class="num">DFU Each</th><th class="num">Total DFU</th></tr></thead>
          <tbody>
            ${plumb.fixtureSummary
              .map(
                (f) =>
                  `<tr><td>${escapeHtml(f.label)}</td><td class="num">${f.count}</td><td class="num">${f.dfuEach}</td><td class="num">${f.totalDfu}</td></tr>`
              )
              .join('')}
          </tbody>
        </table>
      </div>
      <div>
        <h3>Inspection Chambers & Stormwater (BS EN 12056-3)</h3>
        <p style="font-family:monospace;font-size:11px;margin:4px 0 6px">
          Roof Catchment: ${plumb.roofCatchmentM2} m² @ ${plumb.rainfallIntensityMmh} mm/hr · Runoff: ${plumb.stormwaterRunoffLps} L/s (${plumb.rainwaterDownpipesCount}× ${escapeHtml(plumb.rainwaterPipeSpec)})
        </p>
        <table>
          <thead><tr><th>Manhole / IC</th><th>Size (mm)</th><th class="num">Invert Level (m)</th><th>Location / Service</th></tr></thead>
          <tbody>
            ${plumb.inspectionChambers
              .map(
                (ic) =>
                  `<tr><td><strong>${escapeHtml(ic.id)}</strong></td><td>${escapeHtml(ic.sizeMm)}</td><td class="num">${ic.invertLevelM.toFixed(2)}</td><td>${escapeHtml(ic.location)}</td></tr>`
              )
              .join('')}
          </tbody>
        </table>
      </div>
    </div>
  </section>

  <section class="sheet">
    <div class="sheet-hdr">
      <div class="sheet-code">SHEET Q-101 · BILL OF QUANTITIES (BOQ)</div>
      <div style="font-family:monospace;font-size:12px">Grand Total: ${cur}${boq.grandTotal.toLocaleString()}</div>
    </div>
    <p style="font-family:monospace;font-size:11px;margin-top:0">
      Raw Materials: ${boq.rawMaterials.cementBags50Kg} Cement Bags (50kg) · ${boq.rawMaterials.riverSandM3} m³ Sand ·
      ${boq.rawMaterials.coarseAggregateM3} m³ Aggregate · ${boq.rawMaterials.bricksOrBlocksCount.toLocaleString()} Bricks ·
      ${boq.rawMaterials.rebarSteelKg.toLocaleString()} kg Rebar
    </p>
    <table>
      <thead><tr><th>Code</th><th>Division</th><th>Description</th><th>Unit</th><th class="num">Qty</th><th class="num">Rate (${cur})</th><th class="num">Amount (${cur})</th></tr></thead>
      <tbody>
        ${boq.items
          .map(
            (it) =>
              `<tr><td>${escapeHtml(it.code)}</td><td>${escapeHtml(it.division)}</td><td>${escapeHtml(it.description)}</td><td>${escapeHtml(it.unit)}</td><td class="num">${it.quantity.toLocaleString()}</td><td class="num">${it.unitRate.toFixed(2)}</td><td class="num">${it.totalCost.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td></tr>`
          )
          .join('')}
        <tr><td colspan="6" class="num"><strong>Subtotal</strong></td><td class="num"><strong>${cur}${boq.subtotal.toLocaleString()}</strong></td></tr>
        <tr><td colspan="6" class="num">Contingency (${boq.contingencyPct}%)</td><td class="num">${cur}${boq.contingencyAmount.toLocaleString()}</td></tr>
        <tr><td colspan="6" class="num"><strong>GRAND TOTAL</strong></td><td class="num"><strong>${cur}${boq.grandTotal.toLocaleString()}</strong></td></tr>
      </tbody>
    </table>
  </section>
</body>
</html>`;

  const safeName = safeProjectCode(project);
  return triggerDownload(`${safeName}_Full_Drawing_Set.html`, html, 'text/html');
}
