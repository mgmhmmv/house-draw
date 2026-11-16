/**
 * Maavadiyaa drafting style. One place for paper, ink, line weights and room tints so every
 * sheet reads as part of the same set. Weights are screen pixels (non-scaling strokes);
 * text sizes are metres on the sheet (0.22 m ≈ 2.2 mm at 1:100).
 */
import type { RoomCategory } from '../../model/types';

export const INK = '#1A1917';
export const INK_2 = '#57534E';
export const INK_3 = '#8A857D';
export const LINE = '#D6D3CC';
export const PAPER = '#FBFAF7';
export const ACCENT = '#2F55D4';
export const ACCENT_SOFT = 'rgba(47, 85, 212, 0.10)';

export const WEIGHT = {
  cut: 1.4, // outline of cut walls and columns
  heavy: 1.2, // door leaves
  medium: 0.9, // window frames, stairs
  light: 0.6, // glass, swings, furniture
  hair: 0.45, // dimensions, grid
};

export const TEXT = {
  roomName: 0.26,
  roomArea: 0.18,
  dim: 0.17,
  tag: 0.16,
  bubble: 0.24,
};

/** Quiet, warm tints. Rooms read by use without the plan turning into a colouring book. */
export const ROOM_TINT: Record<RoomCategory, string> = {
  living: '#F4EEE3',
  dining: '#F3ECE1',
  kitchen: '#EDF2E8',
  bedroom: '#EAF0F8',
  bathroom: '#E6F2F2',
  hallway: '#F2F1ED',
  garage: '#EEEEEC',
  office: '#F0ECF6',
  utility: '#EFEEEA',
  porch: '#F5F1E8',
  balcony: '#F5F1E8',
};

export const MEP_COLOR = {
  electrical: '#C2781B',
  lighting: '#B8860B',
  power: '#C2781B',
  hvac: '#2A8C8C',
  plumbingCold: '#2F6FD4',
  plumbingHot: '#C9473B',
  drain: '#6B5B4B',
  solar: '#D1A21F',
};
