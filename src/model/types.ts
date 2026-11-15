export interface Point2D {
  x: number; // meters, East (+X) / West (-X)
  y: number; // meters, South (+Y) / North (-Y)
}

export type WallMaterial = 'brick' | 'cmu' | 'cinder_block' | 'coral_stone' | 'concrete' | 'timber' | 'drywall';
export type DoorStyle = 'single' | 'double' | 'sliding' | 'garage';
export type WindowStyle = 'casement' | 'sliding' | 'picture' | 'bay';
export type RoomCategory =
  | 'living'
  | 'kitchen'
  | 'dining'
  | 'bedroom'
  | 'bathroom'
  | 'hallway'
  | 'garage'
  | 'office'
  | 'utility'
  | 'porch'
  | 'balcony';

export type FloorFinish =
  | 'porcelain'
  | 'hardwood'
  | 'ceramic_antiskid'
  | 'concrete'
  | 'carpet'
  | 'herringbone_oak'
  | 'carrara_marble'
  | 'terrazzo';
export type RoofType = 'gable' | 'hip' | 'flat' | 'shed';
export type RoofMaterial =
  | 'standing_seam'
  | 'clay_tile'
  | 'asphalt_shingle'
  | 'concrete_slab'
  | 'natural_slate'
  | 'cedar_shake'
  | 'green_roof'
  | 'corrugated_metal'
  | 'marine_metal'
  | 'thatch_palm';

export type GutterProfile =
  | 'half_round_pvc'
  | 'k_style_alu'
  | 'box_concealed'
  | 'copper_half_round';

export type WaterCollectionMode =
  | 'harvesting_tank'
  | 'underground_cistern'
  | 'municipal_storm'
  | 'soakaway_pit'
  | 'garden_redirect';

export interface RoofDrainageConfig {
  gutterEnabled: boolean;
  gutterProfile: GutterProfile;
  downpipeCount: number;
  waterCollectionMode: WaterCollectionMode;
  harvestingTankLiters: number;
  firstFlushDiverter: boolean;
}

export const GUTTER_PROFILE_META: Record<
  GutterProfile,
  { label: string; shortLabel: string; spec: string; colorHex: string; ratePerM: number }
> = {
  half_round_pvc: {
    label: '150mm uPVC Half-Round Gutter',
    shortLabel: 'uPVC Half-Round',
    spec: 'Ø150mm UV-Stabilized uPVC + Ø100mm RWP',
    colorHex: '#e2e8f0',
    ratePerM: 22,
  },
  k_style_alu: {
    label: '150mm Powder-Coated K-Style Aluminum',
    shortLabel: 'K-Style Aluminum',
    spec: '150mm Marine-Grade Al K-Style + Rectangular RWP',
    colorHex: '#334155',
    ratePerM: 34,
  },
  box_concealed: {
    label: '200mm Concealed Box Parapet Gutter',
    shortLabel: 'Box Concealed',
    spec: '200×120mm Anodized Box Channel + Twin RWP',
    colorHex: '#475569',
    ratePerM: 46,
  },
  copper_half_round: {
    label: '150mm Architectural Marine Copper',
    shortLabel: 'Marine Copper',
    spec: '150mm Half-Round Patina Copper + Ø100mm Cu RWP',
    colorHex: '#b45309',
    ratePerM: 78,
  },
};

export const WATER_COLLECTION_META: Record<
  WaterCollectionMode,
  { label: string; shortLabel: string; desc: string; unitCost: number; badgeColor: string }
> = {
  harvesting_tank: {
    label: 'Rainwater Harvesting Tank (Above-Ground HDPE)',
    shortLabel: 'Harvesting Tank',
    desc: 'Collects roof runoff via first-flush diverter & leaf screen into UV-stabilized potable/utility HDPE storage tank.',
    unitCost: 1450,
    badgeColor: '#0284c7',
  },
  underground_cistern: {
    label: 'Underground RC Rainwater Cistern & Pump',
    shortLabel: 'Underground Cistern',
    desc: 'Redirects all downpipes into a buried reinforced concrete cistern with submersible filtration & booster pump.',
    unitCost: 2600,
    badgeColor: '#2563eb',
  },
  soakaway_pit: {
    label: 'Coral / Gravel Infiltration Soakaway Pit',
    shortLabel: 'Soakaway Pit',
    desc: 'Redirects stormwater into an excavated crushed-coral infiltration soakaway chamber for aquifer recharge.',
    unitCost: 680,
    badgeColor: '#0d9488',
  },
  municipal_storm: {
    label: 'Municipal Storm Drain Redirect (Silt Trap)',
    shortLabel: 'Storm Drain Redirect',
    desc: 'Routes roof downpipes through a 600×600mm silt-trap catch basin directly to the street storm sewer main.',
    unitCost: 540,
    badgeColor: '#475569',
  },
  garden_redirect: {
    label: 'Landscape Bioswale & Garden Irrigation Redirect',
    shortLabel: 'Garden Redirect',
    desc: 'Diverts gutter downpipes via splash blocks & perforated sub-surface distribution pipes into garden planter swales.',
    unitCost: 420,
    badgeColor: '#16a34a',
  },
};

export type ExteriorFacadeMaterial =
  | 'white_render'
  | 'exposed_brick'
  | 'charcoal_cladding'
  | 'stone_veneer'
  | 'timber_slats'
  | 'travertine_stone'
  | 'cement_plaster'
  | 'coral_render'
  | 'tropical_louvres';

export type InteriorWallMaterial =
  | 'matte_white'
  | 'warm_beige'
  | 'sage_green'
  | 'venetian_plaster'
  | 'exposed_concrete'
  | 'oak_paneling'
  | 'smooth_cement_plaster'
  | 'teak_paneling';

export type WindowFrameFinish = 'anthracite' | 'bronze' | 'silver_anodized' | 'timber_oak' | 'matte_black';
export type DoorFinishMaterial = 'walnut' | 'oak' | 'matte_black' | 'frosted_glass' | 'white_lacquer';

export type ClimateZone = 'maldives_tropical' | 'temperate' | 'arid_desert' | 'mediterranean';
export type HVACSystemType = 'inverter_split' | 'vrf_multi_split' | 'ducted_central';
export type CondenserProtection = 'marine_blue_fin' | 'epoxy_gold_fin' | 'standard';

export interface HVACConfig {
  enabled: boolean;
  climateZone: ClimateZone;
  systemType: HVACSystemType;
  refrigerant: 'R32' | 'R410A';
  condenserProtection: CondenserProtection;
  designOutdoorTempC: number;
  designIndoorTempC: number;
  designHumidityPct: number;
  ceilingFansEnabled: boolean;
  freshAirERV: boolean;
}

export type SolarRoofFace = 'south' | 'north' | 'east' | 'west' | 'flat_center';

export type WiringRouteMode =
  | 'auto'
  | 'north_wall'
  | 'south_wall'
  | 'west_wall'
  | 'east_wall'
  | 'corridor';

export type SelectableElementKind =
  | 'wall'
  | 'opening'
  | 'room'
  | 'column'
  | 'furniture'
  | 'mep_node'
  | 'solar_array'
  | 'solar_panel';

export interface SolarPVConfig {
  enabled: boolean;
  panelCount: number; // e.g. 12 panels
  panelWattage: number; // e.g. 450 Wp
  inverterKW: number; // e.g. 6.0 kW hybrid
  batteryKWh: number; // e.g. 10.0 kWh LiFePO4 (0 = no battery)
  offsetX?: number; // East (+) / West (-) offset in meters from default slope anchor
  offsetY?: number; // South (+) / North (-) offset in meters from default slope anchor
  rotationDeg?: number; // 0 | 90 | 180 | 270
  roofFace?: SolarRoofFace; // default 'south'
  columns?: number; // 0 or undefined = auto-fit to roof slope
  panelOffsets?: Record<number, Point2D>; // per-panel manual (x, y) offset in meters
  dcRouteMode?: WiringRouteMode; // PV array -> Inverter conduit route preset
  acRouteMode?: WiringRouteMode; // Inverter -> MDB feeder conduit route preset
  dcWaypoints?: Point2D[]; // manual 2D/3D adjustment waypoints along PV -> Inverter route
  acWaypoints?: Point2D[]; // manual 2D/3D adjustment waypoints along Inverter -> MDB route
  conduitElevationOffset?: number; // vertical trim offset (meters, -0.5 to +0.2) for trunking
}

export interface MaterialDesignConfig {
  exteriorFacade: ExteriorFacadeMaterial;
  interiorWalls: InteriorWallMaterial;
  windowFrame: WindowFrameFinish;
  doorMaterial: DoorFinishMaterial;
}

export interface Wall {
  id: string;
  start: Point2D;
  end: Point2D;
  thickness: number; // meters (e.g. 0.23m exterior, 0.12m partition)
  height: number; // meters (e.g. 3.0m)
  isExterior: boolean;
  isLoadBearing: boolean;
  material: WallMaterial;
}

export interface Opening {
  id: string;
  wallId: string;
  kind: 'door' | 'window';
  style: DoorStyle | WindowStyle;
  offset: number; // normalized 0..1 along wall centerline
  width: number; // meters
  height: number; // meters
  sillHeight: number; // meters from floor (0 for doors, ~0.9 for windows)
  swingDirection: 1 | -1; // left/right or inward/outward normal side
  label?: string; // e.g., D1, W1
}

export interface Room {
  id: string;
  name: string;
  category: RoomCategory;
  polygon: Point2D[];
  finish: FloorFinish;
  ceilingHeight: number; // meters
  color?: string;
}

export interface StructuralColumn {
  id: string;
  position: Point2D;
  width: number; // meters (X)
  depth: number; // meters (Y)
  label: string; // e.g. C1
  footingSize: number; // meters square pad footing
  rebarSpec: string; // e.g., "4Ø16 + Ø8@150"
}

export interface Staircase {
  id: string;
  origin: Point2D; // bottom-left corner in plan
  width: number;
  length: number;
  direction: 'N' | 'S' | 'E' | 'W';
  shape: 'straight' | 'l_shape' | 'u_shape';
  risers: number;
}

export interface FurnitureItem {
  id: string;
  type:
    | 'bed_double'
    | 'bed_single'
    | 'sofa'
    | 'dining_table'
    | 'kitchen_counter'
    | 'desk'
    | 'wc'
    | 'sink'
    | 'shower'
    | 'car';
  position: Point2D;
  rotation: number; // degrees
  width: number;
  depth: number;
}

export type MEPNodeKind =
  | 'mdb' // Main Distribution Board
  | 'sub_db' // Room Sub-Distribution Board (Room RCBO Enclosure)
  | 'utility_meter' // Utility Bi-Directional kWh Smart Meter & Service Cutout
  | 'light_ceiling'
  | 'switch_1g'
  | 'outlet_duplex'
  | 'ac_split'
  | 'ac_condenser'
  | 'ceiling_fan'
  | 'water_main'
  | 'water_heater'
  | 'plumb_wc'
  | 'plumb_basin'
  | 'plumb_sink'
  | 'plumb_shower'
  | 'floor_trap'
  | 'solar_pv'
  | 'solar_inv'
  | 'solar_bess';

export interface MEPNode {
  id: string;
  kind: MEPNodeKind;
  system: 'electrical' | 'plumbing';
  position: Point2D;
  circuitId?: string;
  wattage?: number; // for electrical
  dfu?: number; // drainage fixture units for plumbing
  label?: string;
  roomId?: string;
  wallSide?: 'north' | 'south' | 'west' | 'east';
}

export interface MEPCircuit {
  id: string;
  name: string;
  system:
    | 'electrical_grid'
    | 'electrical_submain'
    | 'electrical_light'
    | 'electrical_power'
    | 'electrical_hvac'
    | 'electrical_pv'
    | 'hvac_refrigerant'
    | 'hvac_condensate'
    | 'plumbing_cold'
    | 'plumbing_hot'
    | 'plumbing_drain';
  points: Point2D[];
  spec: string; // e.g., "2x2.5mm² + E PVC", "Ø25mm PPR"
}

export interface FloorLevel {
  id: string;
  index: number; // 0 = Ground, 1 = First, etc.
  name: string;
  elevation: number; // meters above ground datum (e.g. 0.45, 3.65)
  floorToFloorHeight: number; // e.g. 3.20m
  slabThickness: number; // e.g. 0.15m
  walls: Wall[];
  openings: Opening[];
  rooms: Room[];
  columns: StructuralColumn[];
  stairs: Staircase[];
  furniture: FurnitureItem[];
  mepNodes: MEPNode[];
  mepCircuits: MEPCircuit[];
}

export interface StructuralGrid {
  xAxes: { label: string; coord: number }[]; // e.g. A, B, C...
  yAxes: { label: string; coord: number }[]; // e.g. 1, 2, 3...
}

export interface RoofConfig {
  type: RoofType;
  pitchDeg: number; // e.g., 24°
  overhang: number; // meters (e.g., 0.6m)
  material: RoofMaterial;
  parapetHeight: number; // meters if flat roof
  gutterEnabled?: boolean;
  gutterProfile?: GutterProfile;
  downpipeCount?: number;
  waterCollectionMode?: WaterCollectionMode;
  harvestingTankLiters?: number;
  firstFlushDiverter?: boolean;
}

export function getRoofDrainageConfig(roof: RoofConfig): RoofDrainageConfig {
  return {
    gutterEnabled: roof.gutterEnabled ?? true,
    gutterProfile: roof.gutterProfile ?? 'half_round_pvc',
    downpipeCount: roof.downpipeCount ?? 4,
    waterCollectionMode: roof.waterCollectionMode ?? 'harvesting_tank',
    harvestingTankLiters: roof.harvestingTankLiters ?? 3500,
    firstFlushDiverter: roof.firstFlushDiverter ?? true,
  };
}

export interface SectionLine {
  id: string;
  label: string; // e.g. "A-A"
  start: Point2D;
  end: Point2D;
}

export interface ProjectMeta {
  title: string;
  projectCode: string;
  client: string;
  architect: string;
  location: string;
  revision: string;
  date: string;
  scale: string;
  plotWidth: number;
  plotDepth: number;
  currency: string;
}

export interface BOQRateConfig {
  siteClearingPerM2: number;
  excavationPerM3: number;
  pccBlindingPerM3: number;
  footingConcretePerM3: number;
  superConcretePerM3: number;
  rebarPerKg: number;
  formworkPerM2: number;
  brickWallPerM3: number;
  partitionWallPerM2: number;
  plasterPerM2: number;
  paintPerM2: number;
  tileFloorPerM2: number;
  hardwoodFloorPerM2: number;
  roofStructurePerM2: number;
  roofCladdingPerM2: number;
  doorUnit: number;
  windowPerM2: number;
  electricalPoint: number;
  plumbingPoint: number;
}

export interface BuildingProject {
  id: string;
  meta: ProjectMeta;
  grid: StructuralGrid;
  levels: FloorLevel[];
  roof: RoofConfig;
  sections: SectionLine[];
  rates: BOQRateConfig;
  solar?: SolarPVConfig;
  design?: MaterialDesignConfig;
  hvac?: HVACConfig;
}

export const DEFAULT_SOLAR_CONFIG: SolarPVConfig = {
  enabled: true,
  panelCount: 12,
  panelWattage: 450,
  inverterKW: 6.0,
  batteryKWh: 10.0,
  offsetX: 0,
  offsetY: 0,
  rotationDeg: 0,
  roofFace: 'south',
  columns: 0,
  panelOffsets: {},
};

export const DEFAULT_DESIGN_CONFIG: MaterialDesignConfig = {
  exteriorFacade: 'white_render',
  interiorWalls: 'matte_white',
  windowFrame: 'anthracite',
  doorMaterial: 'walnut',
};

export const DEFAULT_HVAC_CONFIG: HVACConfig = {
  enabled: true,
  climateZone: 'temperate',
  systemType: 'inverter_split',
  refrigerant: 'R32',
  condenserProtection: 'epoxy_gold_fin',
  designOutdoorTempC: 29,
  designIndoorTempC: 24,
  designHumidityPct: 50,
  ceilingFansEnabled: false,
  freshAirERV: false,
};

export const MALDIVES_HVAC_CONFIG: HVACConfig = {
  enabled: true,
  climateZone: 'maldives_tropical',
  systemType: 'inverter_split',
  refrigerant: 'R32',
  condenserProtection: 'marine_blue_fin',
  designOutdoorTempC: 33,
  designIndoorTempC: 24,
  designHumidityPct: 82,
  ceilingFansEnabled: true,
  freshAirERV: true,
};

export function getSolarConfig(project: BuildingProject): SolarPVConfig {
  return { ...DEFAULT_SOLAR_CONFIG, ...(project.solar ?? {}) };
}

export function getDesignConfig(project: BuildingProject): MaterialDesignConfig {
  return { ...DEFAULT_DESIGN_CONFIG, ...(project.design ?? {}) };
}

export function getHVACConfig(project: BuildingProject): HVACConfig {
  return { ...DEFAULT_HVAC_CONFIG, ...(project.hvac ?? {}) };
}

export type ActiveSheetId =
  | 'A-101' // Floor Plan + Sketch
  | '3D-VIEW' // Interactive 3D Render / Clay / X-Ray
  | 'A-201' // 4 Elevations (N, S, E, W)
  | 'A-301' // Architectural & Structural Cross-Section
  | 'S-101' // Structural Foundation & Framing Plan
  | 'M-101' // MEP Floor Layout Overlay
  | 'H-101' // HVAC & Cooling Load Schedule
  | 'E-101' // Electrical Single-Line Diagram & Load Schedule
  | 'P-101' // Plumbing Riser Schematic
  | 'Q-101'; // Bill of Quantities & Material Take-Off

export type CADTool =
  | 'select'
  | 'wall'
  | 'door'
  | 'window'
  | 'column'
  | 'room_rect'
  | 'measure'
  | 'sketch_wall'
  | 'sketch_door'
  | 'sketch_window';

export type Render3DMode = 'pbr' | 'clay' | 'xray' | 'blueprint';

export interface SketchStroke {
  id: string;
  kind: 'wall' | 'door' | 'window';
  points: Point2D[];
}
