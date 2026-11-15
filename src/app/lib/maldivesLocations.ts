// Copied from IslePOS (v3.isleretail/src/lib/maldivesLocations.ts) so ArchStudio offers the same
// atoll and island lists as IslePOS. Keep the two in step.

// Maldives Atolls and Islands data
// Every inhabited island by atoll, with the Elections Commission's island code
// (em-data.json): A1, A2… with no gaps. People writing an address often use
// the national (police) numbering instead, which leaves gaps for uninhabited
// islands — Baarah is A14 here and A16 there. Reading addresses accepts both
// (lib/maldivesPlace, POLICE_ISLAND_CODES); this list keeps the codes the app
// shows and prints. Names are spelt as the global dropdown list in the
// database has them, which is what every picker shows.

export interface IslandData {
  name: string;
  code: string;
}

// Atoll codes based on administrative divisions
export const ATOLL_CODES: Record<string, string> = {
  'Haa Alif': 'HA', 'Haa Dhaalu': 'HDH', 'Shaviyani': 'SH', 'Noonu': 'N',
  'Raa': 'R', 'Baa': 'B', 'Lhaviyani': 'LH', 'Kaafu': 'K',
  'Alif Alif': 'AA', 'Alif Dhaalu': 'ADH', 'Vaavu': 'V', 'Meemu': 'M',
  'Faafu': 'F', 'Dhaalu': 'DH', 'Thaa': 'TH', 'Laamu': 'L',
  'Gaafu Alif': 'GA', 'Gaafu Dhaalu': 'GDH', 'Gnaviyani': 'GN', 'Addu City': 'S',
};

export const MALDIVES_ATOLLS_DATA: Record<string, IslandData[]> = {
  'Haa Alif': [
    { name: 'Thuraakunu', code: 'A1' }, { name: 'Uligamu', code: 'A2' },
    { name: 'Mulhadhoo', code: 'A3' }, { name: 'Hoarafushi', code: 'A4' },
    { name: 'Ihavandhoo', code: 'A5' }, { name: 'Kelaa', code: 'A6' },
    { name: 'Vashafaru', code: 'A7' }, { name: 'Dhidhdhoo', code: 'A8' },
    { name: 'Filladhoo', code: 'A9' }, { name: 'Maarandhoo', code: 'A10' },
    { name: 'Thakandhoo', code: 'A11' }, { name: 'Utheemu', code: 'A12' },
    { name: 'Muraidhoo', code: 'A13' }, { name: 'Baarah', code: 'A14' },
  ],
  'Haa Dhaalu': [
    { name: 'Kulhudhuffushi', code: 'B1' }, { name: 'Hanimaadhoo', code: 'B2' }, { name: 'Finey', code: 'B3' },
    { name: 'Naivaadhoo', code: 'B4' }, { name: 'Nolhivaranfaru', code: 'B5' },
    { name: 'Nellaidhoo', code: 'B6' }, { name: 'Nolhivaran', code: 'B7' },
    { name: 'Kurinbi', code: 'B8' }, { name: 'Hirimaradhoo', code: 'B9' }, { name: 'Kumundhoo', code: 'B10' },
    { name: 'Neykurendhoo', code: 'B11' }, { name: 'Vaikaradhoo', code: 'B12' },
    { name: 'Makunudhoo', code: 'B13' },
  ],
  'Shaviyani': [
    { name: 'Kanditheemu', code: 'C1' }, { name: 'Noomaraa', code: 'C2' },
    { name: 'Goidhoo', code: 'C3' }, { name: 'Feydhoo', code: 'C4' },
    { name: 'Feevah', code: 'C5' }, { name: 'Bileffahi', code: 'C6' },
    { name: 'Foakaidhoo', code: 'C7' }, { name: 'Narudhoo', code: 'C8' },
    { name: 'Maroshi', code: 'C9' }, { name: 'Lhaimagu', code: 'C10' },
    { name: 'Komandoo', code: 'C11' }, { name: 'Maaungoodhoo', code: 'C12' },
    { name: 'Funadhoo', code: 'C13' }, { name: 'Milandhoo', code: 'C14' },
  ],
  'Noonu': [
    { name: 'Henbandhoo', code: 'D1' }, { name: 'Kendhikulhudhoo', code: 'D2' },
    { name: 'Maalhendhoo', code: 'D3' }, { name: 'Kudafari', code: 'D4' },
    { name: 'Landhoo', code: 'D5' }, { name: 'Maafaru', code: 'D6' },
    { name: 'Lhohi', code: 'D7' }, { name: 'Miladhoo', code: 'D8' },
    { name: 'Magoodhoo', code: 'D9' }, { name: 'Manadhoo', code: 'D10' },
    { name: 'Holhudhoo', code: 'D11' }, { name: 'Foddhoo', code: 'D12' },
    { name: 'Velidhoo', code: 'D13' },
  ],
  'Raa': [
    { name: 'Alifushi', code: 'E1' }, { name: 'Vaadhoo', code: 'E2' },
    { name: 'Rasgetheemu', code: 'E3' }, { name: 'Angolhitheemu', code: 'E4' },
    { name: 'Hulhudhuffaaru', code: 'E5' }, { name: 'Ungoofaaru', code: 'E6' },
    { name: 'Dhuvaafaru', code: 'E7' }, { name: 'Maakurathu', code: 'E8' },
    { name: 'Rasmaadhoo', code: 'E9' }, { name: 'Innamaadhoo', code: 'E10' },
    { name: 'Maduvvari', code: 'E11' }, { name: 'Inguraidhoo', code: 'E12' },
    { name: 'Meedhoo', code: 'E13' }, { name: 'Fainu', code: 'E14' },
    { name: 'Kinolhas', code: 'E15' },
  ],
  'Baa': [
    { name: 'Kudarikilu', code: 'F1' }, { name: 'Kamadhoo', code: 'F2' },
    { name: 'Kendhoo', code: 'F3' }, { name: 'Kihaadhoo', code: 'F4' },
    { name: 'Dhonfanu', code: 'F5' }, { name: 'Dharavandhoo', code: 'F6' },
    { name: 'Maalhos', code: 'F7' }, { name: 'Eydhafushi', code: 'F8' },
    { name: 'Thulhaadhoo', code: 'F9' }, { name: 'Hithaadhoo', code: 'F10' },
    { name: 'Fulhadhoo', code: 'F11' }, { name: 'Fehendhoo', code: 'F12' },
    { name: 'Goidhoo', code: 'F13' },
  ],
  'Lhaviyani': [
    { name: 'Hinnavaru', code: 'G1' }, { name: 'Naifaru', code: 'G2' },
    { name: 'Kurendhoo', code: 'G3' }, { name: 'Olhuvelifushi', code: 'G4' },
    { name: 'Maafilaafushi', code: 'G5' },
  ],
  'Kaafu': [
    { name: 'Kaashidhoo', code: 'H1' }, { name: 'Gaafaru', code: 'H2' },
    { name: 'Dhiffushi', code: 'H3' }, { name: 'Thulusdhoo', code: 'H4' },
    { name: 'Huraa', code: 'H5' }, { name: 'Himmafushi', code: 'H6' },
    { name: 'Gulhi', code: 'H7' }, { name: 'Maafushi', code: 'H8' },
    { name: 'Guraidhoo', code: 'H9' },
  ],
  'Alif Alif': [
    { name: 'Thoddoo', code: 'U1' }, { name: 'Rasdhoo', code: 'U2' },
    { name: 'Ukulhas', code: 'U3' }, { name: 'Mathiveri', code: 'U4' },
    { name: 'Bodufolhudhoo', code: 'U5' }, { name: 'Feridhoo', code: 'U6' },
    { name: 'Maalhos', code: 'U7' }, { name: 'Himandhoo', code: 'U8' },
  ],
  'Alif Dhaalu': [
    { name: 'Hangnaameedhoo', code: 'I1' }, { name: 'Omadhoo', code: 'I2' },
    { name: 'Kunburudhoo', code: 'I3' }, { name: 'Mahibadhoo', code: 'I4' },
    { name: 'Mandhoo', code: 'I5' }, { name: 'Dhangethi', code: 'I6' },
    { name: 'Dhigurah', code: 'I7' }, { name: 'Fenfushi', code: 'I8' },
    { name: 'Dhidhdhoo', code: 'I9' }, { name: 'Maamigili', code: 'I10' },
  ],
  'Vaavu': [
    { name: 'Fulidhoo', code: 'J1' }, { name: 'Thinadhoo', code: 'J2' },
    { name: 'Felidhoo', code: 'J3' }, { name: 'Keyodhoo', code: 'J4' },
    { name: 'Rakeedhoo', code: 'J5' },
  ],
  'Meemu': [
    { name: 'Raimmandhoo', code: 'K1' }, { name: 'Veyvah', code: 'K2' },
    { name: 'Mulah', code: 'K3' }, { name: 'Muli', code: 'K4' },
    { name: 'Naalaafushi', code: 'K5' }, { name: 'Kolhufushi', code: 'K6' },
    { name: 'Dhiggaru', code: 'K7' }, { name: 'Maduvvari', code: 'K8' },
  ],
  'Faafu': [
    { name: 'Feeali', code: 'L1' }, { name: 'Bilehdhoo', code: 'L2' },
    { name: 'Magoodhoo', code: 'L3' }, { name: 'Dharanboodhoo', code: 'L4' },
    { name: 'Nilandhoo', code: 'L5' },
  ],
  'Dhaalu': [
    { name: 'Meedhoo', code: 'M1' }, { name: 'Bandidhoo', code: 'M2' },
    { name: 'Rinbudhoo', code: 'M3' },
    { name: 'Hulhudheli', code: 'M4' }, { name: 'Maenboodhoo', code: 'M6' },
    { name: 'Kudahuvadhoo', code: 'M7' },
  ],
  'Thaa': [
    { name: 'Buruni', code: 'N1' }, { name: 'Vilufushi', code: 'N2' },
    { name: 'Madifushi', code: 'N3' }, { name: 'Dhiyamigili', code: 'N4' },
    { name: 'Guraidhoo', code: 'N5' }, { name: 'Kandoodhoo', code: 'N6' },
    { name: 'Vandhoo', code: 'N7' }, { name: 'Hirilandhoo', code: 'N8' },
    { name: 'Gaadhiffushi', code: 'N9' }, { name: 'Thimarafushi', code: 'N10' },
    { name: 'Veymandoo', code: 'N11' }, { name: 'Kinbidhoo', code: 'N12' },
    { name: 'Omadhoo', code: 'N13' },
  ],
  'Laamu': [
    { name: 'Isdhoo', code: 'O1' }, { name: 'Dhanbidhoo', code: 'O2' },
    { name: 'Maabaidhoo', code: 'O3' }, { name: 'Mundoo', code: 'O4' },
    { name: 'Gan', code: 'O5' }, { name: 'Maavah', code: 'O6' },
    { name: 'Fonadhoo', code: 'O7' }, { name: 'Maamendhoo', code: 'O9' },
    { name: 'Hithadhoo', code: 'O10' }, { name: 'Kunahandhoo', code: 'O11' },
    { name: 'Kalaidhoo', code: 'O12' },
  ],
  'Gaafu Alif': [
    { name: 'Kolamaafushi', code: 'P1' }, { name: 'Villingili', code: 'P2' },
    { name: 'Maamendhoo', code: 'P3' }, { name: 'Nilandhoo', code: 'P4' },
    { name: 'Dhaandhoo', code: 'P5' }, { name: 'Dhevvadhoo', code: 'P6' },
    { name: 'Kondey', code: 'P7' }, { name: 'Gemanafushi', code: 'P8' },
    { name: 'Kanduhulhudhoo', code: 'P9' },
  ],
  'Gaafu Dhaalu': [
    { name: 'Thinadhoo', code: 'Q1' },
    { name: 'Madaveli', code: 'Q2' }, { name: 'Hoadedhdhoo', code: 'Q3' },
    { name: 'Nadella', code: 'Q4' },
    { name: 'Gadhdhoo', code: 'Q5' }, { name: 'Rathafandhoo', code: 'Q6' },
    { name: 'Vaadhoo', code: 'Q7' }, { name: 'Fiyoaree', code: 'Q8' },
    { name: 'Fares-Maathodaa', code: 'Q9' },
  ],
  'Gnaviyani': [{ name: 'Fuvahmulah', code: 'R1' }],
  'Addu City': [
    { name: 'Hithadhoo', code: 'S1' }, { name: 'Maradhoo', code: 'S7' },
    { name: 'Maradhoo-Feydhoo', code: 'S8' }, { name: 'Feydhoo', code: 'S9' },
    { name: 'Hulhudhoo', code: 'S11' }, { name: 'Meedhoo', code: 'S12' },
  ],
};

// Legacy format
export const MALDIVES_ATOLLS: Record<string, string[]> = Object.fromEntries(
  Object.entries(MALDIVES_ATOLLS_DATA).map(([atoll, islands]) => [
    atoll, islands.map(island => island.name)
  ])
);

export const ATOLL_NAMES = Object.keys(MALDIVES_ATOLLS_DATA);

export const ISLAND_DISTRICTS: Record<string, Record<string, string[]>> = {
  'Kaafu': {
    "Male'": ['Galolhu (G)', 'Henveyru (H)', 'Maafannu (M)', 'Macchangolhi (MA)'],
    "Hulhumale'": ['Phase 1', 'Phase 2', 'Phase 3'],
    // A ward of the capital with no districts of its own: listed so it can be picked.
    "Vilimale'": [],
  },
};

export function getIslandsByAtoll(atoll: string): IslandData[] {
  return MALDIVES_ATOLLS_DATA[atoll] || [];
}

/**
 * Every island in an atoll, including the ones that only exist as districts.
 *
 * MALDIVES_ATOLLS_DATA lists Kaafu's outer islands but not Male' or
 * Hulhumale' — they appear only as keys in ISLAND_DISTRICTS, because the thing
 * that mattered about them was their district breakdown. That leaves the
 * capital, where most registered businesses actually are, missing from any
 * picker built on the island list alone.
 *
 * getIslandsByAtoll is left as it was so existing callers keep the list they
 * already show; this is for pickers that need the whole atoll.
 */
export function getAllIslandsByAtoll(atoll: string): string[] {
  const listed = (MALDIVES_ATOLLS_DATA[atoll] ?? []).map((i) => i.name);
  const districtOnly = Object.keys(ISLAND_DISTRICTS[atoll] ?? {}).filter(
    (name) => !listed.includes(name),
  );
  // District-only islands first: they are the populated ones.
  return [...districtOnly, ...listed];
}

export function formatIslandWithAtoll(island: string, atoll: string): string {
  return `${island}, ${atoll}`;
}

export function hasDistricts(atoll: string, island: string): boolean {
  return !!(ISLAND_DISTRICTS[atoll]?.[island]?.length);
}

export function getDistrictsByIsland(atoll: string, island: string): string[] {
  return ISLAND_DISTRICTS[atoll]?.[island] || [];
}

export function formatLocationWithDistrict(island: string, atoll: string, district?: string): string {
  if (district) return `${island} - ${district}, ${atoll}`;
  return formatIslandWithAtoll(island, atoll);
}

export function findAtollForIsland(island: string): string | undefined {
  for (const [atoll, islands] of Object.entries(MALDIVES_ATOLLS_DATA)) {
    if (islands.some(i => i.name === island)) return atoll;
  }
  return undefined;
}
