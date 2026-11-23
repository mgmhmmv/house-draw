import type { PVModuleSpec } from './types';
/**
 * The PV module the app draws and wires: Luxen LuxPower Series 5, LNVU-590ND
 * (570–590 W mono bifacial, 144 half-cell N-type M10, glass/glass), from the maker's datasheet.
 * Sizes are in metres, electrical values at STC (1000 W/m², 25 °C cell, AM1.5G).
 */
export const PV_MODULE = {
  maker: 'Luxen Solar',
  series: 'LuxPower Series 5',
  model: 'LNVU-590ND',
  wattage: 590,
  /** Long side × short side × frame depth. */
  length: 2.278,
  width: 1.134,
  thickness: 0.03,
  weightKg: 31.5,
  cells: '144 half-cell N-type mono (6×24), bifacial',
  efficiencyPct: 22.84,
  vocV: 51.94,
  iscA: 14.43,
  vmpV: 43.0,
  impA: 13.72,
  /** Per °C. */
  tempCoeffVocPct: -0.25,
  tempCoeffPmaxPct: -0.29,
  tempCoeffIscPct: 0.045,
  maxSystemV: 1500,
  maxSeriesFuseA: 30,
  /** Gap between modules in a row (mid clamps). */
  clampGap: 0.02,
} as const;

/** Coolest cell temperature the string voltage is checked at (tropical sites, early morning). */
const T_MIN_C = 20;

/** String figures for `n` modules in series, for the project's module (the default otherwise). */
export function pvString(n: number, module?: PVModuleSpec) {
  const m = module ?? PV_MODULE;
  const coldFactor = 1 + ((m.tempCoeffVocPct ?? PV_MODULE.tempCoeffVocPct) / 100) * (T_MIN_C - 25);
  return {
    vocV: Number((n * m.vocV).toFixed(1)),
    vocColdV: Number((n * m.vocV * coldFactor).toFixed(1)),
    vmpV: Number((n * m.vmpV).toFixed(1)),
    iscA: m.iscA,
    impA: m.impA,
    /** String fuse / DC breaker at 1.56 × Isc (IEC 62548), rounded up to a standard size. */
    fuseA: [15, 20, 25, 30, 32].find((a) => a >= m.iscA * 1.56) ?? 32,
  };
}

export const PV_MODULE_LABEL = `${PV_MODULE.maker} ${PV_MODULE.model}`;

/** The project's module and its label. */
export const moduleOf = (solar: { module?: PVModuleSpec }): PVModuleSpec => solar.module ?? PV_MODULE;
export const moduleLabel = (solar: { module?: PVModuleSpec }) => (solar.module ? [solar.module.maker, solar.module.model].filter(Boolean).join(' ') : PV_MODULE_LABEL);
