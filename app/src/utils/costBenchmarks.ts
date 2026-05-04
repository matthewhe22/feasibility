/**
 * Construction & professional cost benchmark database.
 *
 * Curated from publicly-available Australian Quantity Surveyor publications:
 *  - Rawlinsons Australian Construction Handbook 2024/25 (Edition 42)
 *  - Turner & Townsend International Construction Market Survey 2024
 *  - Altus Group Australia — Construction Cost Guide 2024
 *  - RLB (Rider Levett Bucknall) Quarterly Construction Cost Reports — Q4 2024 / Q1 2025
 *  - AIQS (Australian Institute of Quantity Surveyors) Practice Guide — Professional Fees 2023
 *
 * Rates are AUD per m² of GFA (Gross Floor Area), excluding GST, and exclude:
 *   land, statutory contributions, finance, marketing, professional services,
 *   developer profit & contingency. They represent the *direct construction
 *   contract value* (head contractor lump sum) typical for the asset class
 *   and city in 2024-25 dollars.
 *
 * Use these as a *sanity check* only — actual rates vary materially with site
 * conditions, height, basement levels, façade complexity, structural system,
 * mechanical services, and procurement timing.
 */

export type BuildingType =
  | 'high-rise-apartments'    // 15+ storeys
  | 'mid-rise-apartments'     // 4–14 storeys
  | 'low-rise-apartments'     // 1–3 storeys (walk-up)
  | 'townhouses'              // 2–3 storey attached
  | 'single-dwellings'        // detached houses
  | 'mixed-use-residential'   // residential over retail/commercial podium
  | 'commercial-office'       // A-grade office tower
  | 'retail-mall'             // shopping centre / arcade
  | 'retail-shell'            // shell-and-core retail tenancy
  | 'hotel-5-star'            // luxury full-service hotel
  | 'hotel-4-star'            // upscale hotel
  | 'hotel-3-star'            // midscale hotel / serviced apartments
  | 'industrial-warehouse'    // tilt-up warehouse / logistics
  | 'carpark-basement'        // structured / basement parking
  | 'carpark-above-ground';   // above-ground concrete deck parking

export type FinishQuality = 'budget' | 'standard' | 'premium' | 'luxury';
export type State = 'NSW' | 'VIC' | 'QLD' | 'WA' | 'SA' | 'ACT' | 'TAS' | 'NT';

/** Construction $/m² band keyed by building type. Range is base — adjusted for state, height, finish. */
export interface ConstructionBenchmark {
  buildingType: BuildingType;
  label: string;
  /** Mid-market (Brisbane / Adelaide) standard-finish base rate, $/m² GFA, ex-GST */
  baseLow: number;
  baseHigh: number;
  /** Year of survey reference */
  year: number;
  /** Typical storey range for this asset class */
  typicalStoreys: [number, number];
  /** Public source citation */
  source: string;
}

/** Base benchmark rates — Brisbane / Adelaide / standard finish, 2024-25 AUD/m² ex-GST. */
export const CONSTRUCTION_BENCHMARKS: ConstructionBenchmark[] = [
  // Residential
  { buildingType: 'high-rise-apartments',  label: 'High-rise apartments (15+ storeys)',         baseLow: 5800, baseHigh: 7800, year: 2025, typicalStoreys: [15, 60], source: 'Rawlinsons 2024/25; T&T ICMS 2024' },
  { buildingType: 'mid-rise-apartments',   label: 'Mid-rise apartments (4–14 storeys)',         baseLow: 4400, baseHigh: 6200, year: 2025, typicalStoreys: [4, 14],  source: 'Rawlinsons 2024/25; RLB Q1-2025' },
  { buildingType: 'low-rise-apartments',   label: 'Low-rise apartments / walk-up (1–3 storeys)', baseLow: 3400, baseHigh: 4800, year: 2025, typicalStoreys: [1, 3],   source: 'Rawlinsons 2024/25' },
  { buildingType: 'townhouses',            label: 'Townhouses (attached, 2–3 storey)',          baseLow: 2900, baseHigh: 4200, year: 2025, typicalStoreys: [2, 3],   source: 'Rawlinsons 2024/25' },
  { buildingType: 'single-dwellings',      label: 'Single dwellings (detached)',                baseLow: 2500, baseHigh: 4500, year: 2025, typicalStoreys: [1, 2],   source: 'Rawlinsons 2024/25' },
  // Mixed-use
  { buildingType: 'mixed-use-residential', label: 'Mixed-use (residential over podium retail)', baseLow: 5200, baseHigh: 7400, year: 2025, typicalStoreys: [6, 40],  source: 'Altus Group 2024; T&T ICMS 2024' },
  // Commercial / retail
  { buildingType: 'commercial-office',     label: 'Commercial office (A-grade tower)',          baseLow: 4800, baseHigh: 7600, year: 2025, typicalStoreys: [10, 60], source: 'Rawlinsons 2024/25; T&T ICMS 2024' },
  { buildingType: 'retail-mall',           label: 'Shopping centre / arcade',                   baseLow: 3800, baseHigh: 5800, year: 2025, typicalStoreys: [1, 4],   source: 'Rawlinsons 2024/25' },
  { buildingType: 'retail-shell',          label: 'Retail shell-and-core',                      baseLow: 2200, baseHigh: 3600, year: 2025, typicalStoreys: [1, 2],   source: 'Rawlinsons 2024/25' },
  // Hospitality
  { buildingType: 'hotel-5-star',          label: 'Hotel — 5-star / luxury',                    baseLow: 8000, baseHigh: 12500, year: 2025, typicalStoreys: [10, 50], source: 'Rawlinsons 2024/25; T&T ICMS 2024' },
  { buildingType: 'hotel-4-star',          label: 'Hotel — 4-star / upscale',                   baseLow: 5800, baseHigh: 8400, year: 2025, typicalStoreys: [6, 30],   source: 'Rawlinsons 2024/25' },
  { buildingType: 'hotel-3-star',          label: 'Hotel — 3-star / midscale / serviced apts',  baseLow: 4200, baseHigh: 6200, year: 2025, typicalStoreys: [4, 20],   source: 'Rawlinsons 2024/25' },
  // Industrial & parking
  { buildingType: 'industrial-warehouse',  label: 'Industrial warehouse (tilt-up)',             baseLow: 1400, baseHigh: 2400, year: 2025, typicalStoreys: [1, 2],   source: 'Rawlinsons 2024/25' },
  { buildingType: 'carpark-basement',      label: 'Carpark — basement / structured',            baseLow: 2400, baseHigh: 3800, year: 2025, typicalStoreys: [1, 4],   source: 'Rawlinsons 2024/25' },
  { buildingType: 'carpark-above-ground',  label: 'Carpark — above-ground deck',                baseLow: 1400, baseHigh: 2200, year: 2025, typicalStoreys: [1, 6],   source: 'Rawlinsons 2024/25' },
];

/** State location adjustment factor applied to base rate (Brisbane / Adelaide ≈ 1.00). */
export const STATE_FACTORS: Record<State, number> = {
  NSW: 1.18, // Sydney CBD premium
  VIC: 1.10, // Melbourne CBD
  QLD: 1.00, // Brisbane (base)
  WA:  1.04, // Perth — labour premium
  SA:  0.96, // Adelaide
  ACT: 1.06, // Canberra — limited contractor pool
  TAS: 0.92, // Hobart
  NT:  1.20, // Darwin — remote logistics premium
};

/** Finish-quality factor — applied to base rate. */
export const FINISH_FACTORS: Record<FinishQuality, number> = {
  budget:   0.85,
  standard: 1.00,
  premium:  1.18,
  luxury:   1.45,
};

/**
 * Height premium — high-rise structural / lift / wind / façade complexity adds 1–2% per
 * storey above 15 storeys (per Rawlinsons height-cost relationship).
 */
export function heightFactor(storeys: number): number {
  if (storeys <= 3)  return 0.96;
  if (storeys <= 8)  return 1.00;
  if (storeys <= 15) return 1.04;
  if (storeys <= 25) return 1.10;
  if (storeys <= 40) return 1.16;
  return 1.22; // 40+ storeys — super-tall premium
}

/** Site condition premium — basement levels, contamination, sloping site. */
export type SiteComplexity = 'simple' | 'moderate' | 'complex';
export const SITE_FACTORS: Record<SiteComplexity, number> = {
  simple:   1.00,
  moderate: 1.05,
  complex:  1.12,
};

export interface BenchmarkInputs {
  buildingType: BuildingType;
  storeys: number;
  state: State;
  finish: FinishQuality;
  siteComplexity: SiteComplexity;
  /** GFA in m² — used to derive total range. */
  gfa: number;
}

export interface BenchmarkResult {
  /** Recommended $/m² range (low–high). */
  rateLow: number;
  rateHigh: number;
  /** Recommended total construction cost range (rate × GFA). */
  totalLow: number;
  totalHigh: number;
  /** Mid-point rate / total. */
  rateMid: number;
  totalMid: number;
  /** Source citation for the band. */
  source: string;
  /** Composition factors that produced the result (for transparency). */
  factors: {
    base: [number, number];
    stateFactor: number;
    finishFactor: number;
    heightFactor: number;
    siteFactor: number;
  };
}

/**
 * Compute a recommended construction $/m² range based on project metrics.
 * Multiplies the base band by state / finish / height / site factors.
 */
export function computeConstructionBenchmark(inputs: BenchmarkInputs): BenchmarkResult | null {
  const base = CONSTRUCTION_BENCHMARKS.find(b => b.buildingType === inputs.buildingType);
  if (!base) return null;

  const sf = STATE_FACTORS[inputs.state];
  const ff = FINISH_FACTORS[inputs.finish];
  const hf = heightFactor(inputs.storeys);
  const cf = SITE_FACTORS[inputs.siteComplexity];

  const multiplier = sf * ff * hf * cf;
  const rateLow  = Math.round(base.baseLow  * multiplier);
  const rateHigh = Math.round(base.baseHigh * multiplier);
  const rateMid  = Math.round((rateLow + rateHigh) / 2);
  const totalLow  = Math.round(rateLow  * inputs.gfa);
  const totalHigh = Math.round(rateHigh * inputs.gfa);
  const totalMid  = Math.round(rateMid  * inputs.gfa);

  return {
    rateLow, rateHigh, rateMid,
    totalLow, totalHigh, totalMid,
    source: base.source,
    factors: {
      base: [base.baseLow, base.baseHigh],
      stateFactor: sf,
      finishFactor: ff,
      heightFactor: hf,
      siteFactor: cf,
    },
  };
}

/* ──────────────────────────────────────────────────────────────────────────
 * Professional / consultancy fee benchmarks (% of construction contract)
 * Source: AIQS Practice Guide 2023; Australian Institute of Architects (AIA)
 * Fee Schedule 2022; Engineers Australia Fee Guide 2023; T&T 2024.
 * ────────────────────────────────────────────────────────────────────────── */

export interface ProfessionalFeeBenchmark {
  category: string;
  /** % of construction contract — low end */
  percentLow: number;
  /** % of construction contract — high end */
  percentHigh: number;
  /** Optional fixed-fee indication for small projects */
  fixedFeeNote?: string;
  source: string;
}

export const PROFESSIONAL_FEE_BENCHMARKS: ProfessionalFeeBenchmark[] = [
  { category: 'Architect (full service incl. documentation)', percentLow: 0.040, percentHigh: 0.080, source: 'AIA Fee Schedule 2022' },
  { category: 'Architect (design only)',                       percentLow: 0.020, percentHigh: 0.035, source: 'AIA Fee Schedule 2022' },
  { category: 'Interior Design',                               percentLow: 0.005, percentHigh: 0.025, source: 'AIA / DIA 2023' },
  { category: 'Landscape Architect',                           percentLow: 0.003, percentHigh: 0.010, source: 'AILA Fee Guide 2023' },
  { category: 'Structural Engineer',                           percentLow: 0.012, percentHigh: 0.025, source: 'Engineers Australia 2023' },
  { category: 'Civil Engineer',                                percentLow: 0.005, percentHigh: 0.015, source: 'Engineers Australia 2023' },
  { category: 'Mechanical / Electrical / Hydraulic (MEPH)',    percentLow: 0.015, percentHigh: 0.035, source: 'Engineers Australia 2023' },
  { category: 'Façade Engineer',                               percentLow: 0.003, percentHigh: 0.012, source: 'Engineers Australia 2023' },
  { category: 'Geotechnical Engineer',                         percentLow: 0.002, percentHigh: 0.008, source: 'Engineers Australia 2023', fixedFeeNote: '$80k–$800k typical lump sum' },
  { category: 'Acoustic Engineer',                             percentLow: 0.001, percentHigh: 0.004, source: 'AAS 2023', fixedFeeNote: '$40k–$150k typical' },
  { category: 'Fire Engineer',                                 percentLow: 0.002, percentHigh: 0.006, source: 'Engineers Australia 2023', fixedFeeNote: '$80k–$350k typical' },
  { category: 'Wind Engineer (high-rise)',                     percentLow: 0.001, percentHigh: 0.003, source: 'Engineers Australia 2023', fixedFeeNote: '$60k–$250k typical' },
  { category: 'Quantity Surveyor',                             percentLow: 0.003, percentHigh: 0.008, source: 'AIQS Practice Guide 2023' },
  { category: 'Building Surveyor / Certifier',                 percentLow: 0.002, percentHigh: 0.006, source: 'AIBS 2023' },
  { category: 'Town Planner',                                  percentLow: 0.002, percentHigh: 0.008, source: 'PIA 2023' },
  { category: 'ESD / Sustainability Consultant',               percentLow: 0.002, percentHigh: 0.006, source: 'GBCA 2024' },
  { category: 'Project / Development Manager',                 percentLow: 0.015, percentHigh: 0.035, source: 'AIQS / T&T 2024' },
  { category: 'Superintendent',                                percentLow: 0.005, percentHigh: 0.015, source: 'AIQS 2023' },
  { category: 'Vertical Transport Consultant',                 percentLow: 0.001, percentHigh: 0.004, source: 'CIBSE 2023' },
  { category: 'Traffic Consultant',                            percentLow: 0.001, percentHigh: 0.004, source: 'PIA 2023' },
  { category: 'DDA / Access Consultant',                       percentLow: 0.001, percentHigh: 0.003, source: 'AIQS 2023' },
  { category: 'Total professional services (all-in)',          percentLow: 0.090, percentHigh: 0.180, source: 'AIQS 2023; T&T 2024' },
];

/** What metrics the user should provide to get a meaningful benchmark. */
export const REQUIRED_METRICS = [
  { name: 'Building type / asset class',       why: 'Apartments vs hotel vs office have fundamentally different rates ($/m²)' },
  { name: 'Number of storeys / building height', why: 'Structural, lift, façade and wind cost rises non-linearly above 15 storeys' },
  { name: 'Gross Floor Area (GFA, m²)',         why: 'Drives total contract size and unit-cost economies of scale' },
  { name: 'State / city',                       why: 'Sydney is +18% over Brisbane base; remote/Darwin +20% logistics premium' },
  { name: 'Finish quality',                     why: 'Budget → Luxury spans -15% to +45% on direct cost' },
  { name: 'Site complexity',                    why: 'Basement levels, contaminated soil, sloping/CBD site adds 5–12%' },
  { name: 'Construction year / market timing',  why: 'Tender escalation has averaged 5–8% p.a. 2022–2025; rates here are 2024-25 dollars' },
  { name: 'Building type mix (units, beds, lots)', why: 'Per-unit metrics ($/lot, $/key, $/space) cross-check the $/m² result' },
];

/** Common per-unit cross-check rates — used for sanity-checking $/m² result. */
export const PER_UNIT_BENCHMARKS = [
  { metric: 'Apartments — $/lot (mid-rise)',       low: 380000,  high: 650000,  source: 'Rawlinsons 2024/25' },
  { metric: 'Apartments — $/lot (high-rise)',      low: 550000,  high: 1100000, source: 'Rawlinsons 2024/25' },
  { metric: 'Townhouse — $/lot',                   low: 320000,  high: 520000,  source: 'Rawlinsons 2024/25' },
  { metric: 'Hotel — $/key (5-star)',              low: 750000,  high: 1400000, source: 'T&T ICMS 2024' },
  { metric: 'Hotel — $/key (4-star)',              low: 450000,  high: 750000,  source: 'T&T ICMS 2024' },
  { metric: 'Office — $/m² NLA (A-grade)',         low: 5500,    high: 8800,    source: 'RLB Q1-2025' },
  { metric: 'Carpark — $/space (basement)',        low: 65000,   high: 120000,  source: 'Rawlinsons 2024/25' },
  { metric: 'Carpark — $/space (above-ground)',    low: 35000,   high: 65000,   source: 'Rawlinsons 2024/25' },
];
