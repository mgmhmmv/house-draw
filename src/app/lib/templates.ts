import type { BuildingProject } from '../../model/types';
import {
  createBlankEngineeringLot,
  createCompactEcoBungalow,
  createMaldivesTropicalVilla,
  createModernCourtyardHouse,
  createTwoStoryVilla,
} from '../../model/presets';
import { computeTotalFloorArea } from '../../engine/geometry';
import type { ProjectSummary } from './api';

export interface Template {
  id: string;
  name: string;
  blurb: string;
  size: string;
  create: () => BuildingProject;
}

export const TEMPLATES: Template[] = [
  { id: 'blank', name: 'Blank site', blurb: 'An empty plot. Sketch it or describe it to the AI.', size: 'Any size', create: createBlankEngineeringLot },
  { id: 'courtyard', name: 'Courtyard house', blurb: 'Single storey, three bedrooms around a court.', size: '14 × 11 m', create: createModernCourtyardHouse },
  { id: 'maldives', name: 'Tropical residence', blurb: 'Cinder block, hip roof, R32 cooling, solar ready.', size: '14.5 × 11 m', create: createMaldivesTropicalVilla },
  { id: 'villa', name: 'Two-storey villa', blurb: 'RC frame family villa over two levels.', size: '15 × 11 m', create: createTwoStoryVilla },
  { id: 'eco', name: 'Eco bungalow', blurb: 'Compact and efficient, easy to build.', size: '10 × 8 m', create: createCompactEcoBungalow },
];

export const templateById = (id: string) => TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0];

/** The handful of numbers a project card shows. Kept in D1 so the dashboard never loads models. */
export function summarize(model: BuildingProject): ProjectSummary {
  const rooms = model.levels.flatMap((l) => l.rooms);
  const pts = model.levels.flatMap((l) => l.walls.flatMap((w) => [w.start, w.end]));
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return {
    area: Math.round(computeTotalFloorArea(model) * 10) / 10,
    levels: model.levels.length,
    rooms: rooms.length,
    bedrooms: rooms.filter((r) => r.category === 'bedroom').length,
    width: pts.length ? Math.round((Math.max(...xs) - Math.min(...xs)) * 10) / 10 : 0,
    depth: pts.length ? Math.round((Math.max(...ys) - Math.min(...ys)) * 10) / 10 : 0,
    roof: model.roof?.type ?? '',
  };
}
