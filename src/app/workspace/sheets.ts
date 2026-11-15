import { Box, Building, Calculator, Droplets, Fan, Grid3x3, LayoutDashboard, Layers, PlugZap, Scissors, type LucideIcon } from 'lucide-react';
import type { ActiveSheetId } from '../../model/types';

export interface SheetDef {
  id: ActiveSheetId;
  /** URL segment. */
  slug: string;
  name: string;
  short: string;
  code: string;
  icon: LucideIcon;
  /** Sheets drawn on the plan canvas take tools and a level. */
  plan?: boolean;
}

export const SHEET_GROUPS: { label: string; sheets: SheetDef[] }[] = [
  {
    label: 'Design',
    sheets: [
      { id: 'A-101', slug: 'plan', name: 'Floor plan', short: 'Plan', code: 'A-101', icon: LayoutDashboard, plan: true },
      { id: '3D-VIEW', slug: '3d', name: '3D model', short: '3D', code: '3D', icon: Box },
      { id: 'A-201', slug: 'elevations', name: 'Elevations', short: 'Elevations', code: 'A-201', icon: Building },
      { id: 'A-301', slug: 'sections', name: 'Sections', short: 'Sections', code: 'A-301', icon: Scissors },
    ],
  },
  {
    label: 'Engineering',
    sheets: [
      { id: 'S-101', slug: 'structure', name: 'Structure', short: 'Structure', code: 'S-101', icon: Grid3x3, plan: true },
      { id: 'M-101', slug: 'mep', name: 'MEP layout', short: 'MEP', code: 'M-101', icon: Layers, plan: true },
      { id: 'H-101', slug: 'hvac', name: 'HVAC & cooling', short: 'HVAC', code: 'H-101', icon: Fan },
      { id: 'E-101', slug: 'electrical', name: 'Electrical', short: 'Electrical', code: 'E-101', icon: PlugZap },
      { id: 'P-101', slug: 'plumbing', name: 'Plumbing', short: 'Plumbing', code: 'P-101', icon: Droplets },
    ],
  },
  {
    label: 'Cost',
    sheets: [{ id: 'Q-101', slug: 'boq', name: 'Bill of quantities', short: 'BOQ', code: 'Q-101', icon: Calculator }],
  },
];

export const SHEETS = SHEET_GROUPS.flatMap((g) => g.sheets);
export const sheetBySlug = (slug?: string) => SHEETS.find((s) => s.slug === slug) ?? SHEETS[0];
export const sheetById = (id: ActiveSheetId) => SHEETS.find((s) => s.id === id) ?? SHEETS[0];
