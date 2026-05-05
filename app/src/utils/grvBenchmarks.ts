/**
 * GRV (Gross Realisable Value) sales price benchmark database.
 *
 * Curated from publicly-available Australian property research and
 * sales data publications:
 *
 *   Residential
 *    - CoreLogic — Hedonic Home Value Index (monthly)
 *    - Domain — House Price Reports (quarterly)
 *    - PropTrack (REA Group) — Home Price Index (monthly)
 *    - ABS — Residential Property Price Indexes: Eight Capital Cities (quarterly)
 *    - Knight Frank Australia — Prime Residential Index
 *    - Charter Keck Cramer — Apartment Market Insights
 *
 *   Commercial / Office / Retail / Industrial
 *    - JLL Research Australia — Capital Markets reports (quarterly)
 *    - Knight Frank Capital Markets — Sector Spotlights
 *    - Colliers International — Capital Markets / Office / Retail Insights
 *    - Cushman & Wakefield Australia — Marketbeat (quarterly)
 *    - CBRE Australia — ViewPoint research / Capital Markets
 *    - Savills Australia — Spotlight reports
 *
 *   Hotels
 *    - JLL Hotels & Hospitality — Australia Hotel Investment Highlights
 *    - Colliers Hotels — Australian Hotel Market Outlook
 *    - HVS Australia — Australia Hotel Valuation Index
 *    - STR Australia — Australia hotel performance data
 *
 * METHODOLOGY:
 *  • Base $/unit rates are 2024-25 dollars, Brisbane-equivalent (or stated
 *    capital city), GST-INCLUSIVE for residential (margin scheme), GST-EXCLUSIVE
 *    for commercial/office/retail/industrial/hotel sale.
 *  • Multi-factor model:
 *      base × stateFactor × locationFactor × qualityFactor × escalation(targetYear)
 *  • Annual escalation factors derived from 10-year average (2014–2024) CoreLogic /
 *    JLL / Knight Frank trend data — see ESCALATION_RATES.
 *  • These are *sanity-check* ranges only. Use a project-specific valuation
 *    (registered valuer, CBRE / JLL / Colliers / Knight Frank / Savills /
 *    Cushman & Wakefield) before relying on the figures.
 *  • Historical/projected prices apply a single annual rate; in reality cycles
 *    are non-linear (booms and corrections). The escalation method is best for
 *    projecting <= 5 years forward / backward.
 */

export type GRVAssetType =
  // Residential
  | 'apartments-high-rise'   // Apartment in 15+ storey tower
  | 'apartments-mid-rise'    // Apartment in 4-14 storey building
  | 'apartments-low-rise'    // Apartment / unit in 1-3 storey walk-up
  | 'townhouses'             // Attached townhouse / villa
  | 'detached-houses'        // Single dwelling (house & land)
  | 'land-lot'               // Englobo / titled land lot (residential)
  // Commercial
  | 'office-prime'           // A-grade / premium office
  | 'office-secondary'       // B/C-grade office
  | 'retail-strip'           // Strip / streetfront retail
  | 'retail-mall'            // Sub-regional / regional shopping centre
  | 'industrial-warehouse'   // Tilt-up / logistics
  // Hospitality
  | 'hotel-5-star'
  | 'hotel-4-star'
  | 'hotel-3-star';

export type State = 'NSW' | 'VIC' | 'QLD' | 'WA' | 'SA' | 'ACT' | 'TAS' | 'NT';

export type PricingBasis =
  | 'per-sqm-saleable'  // $/m² of saleable internal area (apartments)
  | 'per-sqm-nla'       // $/m² of Net Lettable Area (commercial)
  | 'per-lot'           // $/dwelling lot (townhouses/houses)
  | 'per-sqm-land'      // $/m² of titled land
  | 'per-key';          // $/key (hotel)

export interface GRVBenchmark {
  assetType: GRVAssetType;
  label: string;
  pricingBasis: PricingBasis;
  /** Brisbane-equivalent base, low-end, 2024-25 dollars (GST-incl. residential, GST-excl. commercial) */
  baseLow: number;
  /** Brisbane-equivalent base, high-end, 2024-25 dollars */
  baseHigh: number;
  baseYear: number;
  source: string;
  /** Notes on the basis — GST treatment, area definition, exclusions */
  basisNote: string;
}

/**
 * Brisbane-equivalent base bands, 2024-25 dollars.
 *
 * All apartment / townhouse / house numbers are GST-INCLUSIVE because new
 * residential is a taxable supply (margin scheme typically applied — Division 75
 * GSTA). Commercial / office / retail / industrial / hotel numbers are
 * GST-EXCLUSIVE (going-concern or standard-rated supply between registered
 * vendor and purchaser).
 */
export const GRV_BENCHMARKS: GRVBenchmark[] = [
  // ── Residential apartments ──────────────────────────────────────────────
  {
    assetType: 'apartments-high-rise', label: 'Apartments — high-rise (15+ storeys)',
    pricingBasis: 'per-sqm-saleable',
    baseLow: 9500, baseHigh: 14500, baseYear: 2025,
    source: 'CoreLogic 2025; Charter Keck Cramer Apartment Insights 2024 H2',
    basisNote: '$/m² of saleable internal area (excl. balcony). GST-incl. (margin scheme). Includes one carpark for ≥2-bed units; excludes additional carparks ($75–120k each).',
  },
  {
    assetType: 'apartments-mid-rise', label: 'Apartments — mid-rise (4–14 storeys)',
    pricingBasis: 'per-sqm-saleable',
    baseLow: 8000, baseHigh: 11500, baseYear: 2025,
    source: 'CoreLogic 2025; Domain Apartment Report Q4-2024',
    basisNote: '$/m² of saleable internal area. GST-incl. (margin scheme).',
  },
  {
    assetType: 'apartments-low-rise', label: 'Apartments — low-rise (1–3 storeys, walk-up)',
    pricingBasis: 'per-sqm-saleable',
    baseLow: 6500, baseHigh: 9500, baseYear: 2025,
    source: 'CoreLogic 2025; PropTrack 2025',
    basisNote: '$/m² of saleable internal area. GST-incl. (margin scheme).',
  },
  // ── Townhouses / houses ────────────────────────────────────────────────
  {
    assetType: 'townhouses', label: 'Townhouses (attached, 2–3 storey)',
    pricingBasis: 'per-lot',
    baseLow: 750000, baseHigh: 1100000, baseYear: 2025,
    source: 'CoreLogic 2025; Domain House Price Report Q4-2024',
    basisNote: '$/dwelling. GST-incl. (margin scheme). 3-bed/2-bath standard finish, 150–180 m² internal.',
  },
  {
    assetType: 'detached-houses', label: 'Detached houses (house & land)',
    pricingBasis: 'per-lot',
    baseLow: 800000, baseHigh: 1300000, baseYear: 2025,
    source: 'CoreLogic Hedonic HVI 2025; ABS RPPI Q4-2024',
    basisNote: '$/dwelling. GST-incl. (margin scheme on new builds; existing houses may be input-taxed if private vendor). Brisbane median.',
  },
  {
    assetType: 'land-lot', label: 'Land (titled residential lot)',
    pricingBasis: 'per-sqm-land',
    baseLow: 700, baseHigh: 1400, baseYear: 2025,
    source: 'CoreLogic Land Index 2025; HIA-CoreLogic Residential Land Report Q4-2024',
    basisNote: '$/m² of land. GST treatment depends on vendor / use. Englobo land: lower; serviced lots: higher.',
  },
  // ── Office ─────────────────────────────────────────────────────────────
  {
    assetType: 'office-prime', label: 'Office — Prime / A-grade',
    pricingBasis: 'per-sqm-nla',
    baseLow: 7500, baseHigh: 11000, baseYear: 2025,
    source: 'JLL Capital Markets Q4-2024; Knight Frank Office Market Indicators 2024 H2',
    basisNote: '$/m² Net Lettable Area, capital value (sale price). GST-excl. (going concern between registered parties). Reflects 6.0–7.5% cap rate Brisbane CBD.',
  },
  {
    assetType: 'office-secondary', label: 'Office — Secondary / B-C grade',
    pricingBasis: 'per-sqm-nla',
    baseLow: 4500, baseHigh: 7000, baseYear: 2025,
    source: 'Colliers Office Market Outlook 2025; Cushman & Wakefield Marketbeat Q4-2024',
    basisNote: '$/m² NLA. GST-excl. (going concern). Reflects 7.5–9.0% cap rate.',
  },
  // ── Retail ─────────────────────────────────────────────────────────────
  {
    assetType: 'retail-strip', label: 'Retail — strip / streetfront',
    pricingBasis: 'per-sqm-nla',
    baseLow: 6000, baseHigh: 11000, baseYear: 2025,
    source: 'Colliers Retail Insights 2024 H2; Knight Frank Retail Market Review 2024',
    basisNote: '$/m² NLA. GST-excl. (going concern with sitting tenant). Cap rate 5.5–7.0% prime / 7.5–9.0% secondary.',
  },
  {
    assetType: 'retail-mall', label: 'Retail — sub-regional / regional centre',
    pricingBasis: 'per-sqm-nla',
    baseLow: 5500, baseHigh: 9500, baseYear: 2025,
    source: 'JLL Retail Investment Review 2024; Cushman & Wakefield Marketbeat Retail Q4-2024',
    basisNote: '$/m² GLA. GST-excl. (going concern). Cap rate 6.0–7.5%.',
  },
  // ── Industrial ─────────────────────────────────────────────────────────
  {
    assetType: 'industrial-warehouse', label: 'Industrial / logistics warehouse',
    pricingBasis: 'per-sqm-nla',
    baseLow: 2500, baseHigh: 4500, baseYear: 2025,
    source: 'JLL Industrial Market Overview Q4-2024; CBRE ViewPoint Industrial 2025',
    basisNote: '$/m² GLA. GST-excl. Reflects 5.25–6.50% cap rate prime / 6.5–7.5% secondary.',
  },
  // ── Hotels ─────────────────────────────────────────────────────────────
  {
    assetType: 'hotel-5-star', label: 'Hotel — 5-star / luxury',
    pricingBasis: 'per-key',
    baseLow: 700000, baseHigh: 1300000, baseYear: 2025,
    source: 'JLL Hotels & Hospitality Australia 2024; Colliers Hotels Outlook 2025',
    basisNote: '$/key (per room). GST-excl. (going concern with operator). Capital city CBD.',
  },
  {
    assetType: 'hotel-4-star', label: 'Hotel — 4-star / upscale',
    pricingBasis: 'per-key',
    baseLow: 400000, baseHigh: 700000, baseYear: 2025,
    source: 'JLL Hotels & Hospitality Australia 2024; HVS Australia Hotel Valuation Index 2024',
    basisNote: '$/key. GST-excl. (going concern).',
  },
  {
    assetType: 'hotel-3-star', label: 'Hotel — 3-star / midscale / serviced apts',
    pricingBasis: 'per-key',
    baseLow: 250000, baseHigh: 450000, baseYear: 2025,
    source: 'Colliers Hotels Outlook 2025; HVS 2024',
    basisNote: '$/key. GST-excl. (going concern).',
  },
];

/**
 * State / city location adjustment factor — Brisbane = 1.00.
 *
 * Note: GRV state factors are *steeper* than construction state factors because
 * sales prices respond to demand/scarcity, not just labour costs. Sydney
 * apartments are ~70% above Brisbane on $/m²; Sydney detached houses ~110%
 * above Brisbane on $/dwelling (CoreLogic 2024).
 */
export const STATE_FACTORS_GRV: Record<State, number> = {
  NSW: 1.65, // Sydney metro
  VIC: 1.20, // Melbourne metro
  QLD: 1.00, // Brisbane (base)
  WA:  0.92, // Perth
  SA:  0.82, // Adelaide
  ACT: 0.98, // Canberra
  TAS: 0.70, // Hobart
  NT:  0.68, // Darwin
};

/** Sub-market location grade (within the chosen state). */
export type LocationGrade =
  | 'cbd-prestige'   // Premium CBD / harbour / waterfront
  | 'cbd'            // Standard CBD
  | 'inner-ring'     // Inner suburbs (5–10km from CBD)
  | 'middle-ring'    // Middle suburbs (10–20km)
  | 'outer-ring'     // Outer suburbs (20km+)
  | 'regional';      // Major regional city

export const LOCATION_FACTORS: Record<LocationGrade, number> = {
  'cbd-prestige': 1.40,
  'cbd':          1.15,
  'inner-ring':   1.00,
  'middle-ring':  0.85,
  'outer-ring':   0.72,
  'regional':     0.65,
};

/** Asset finish / quality grade — applies to per-unit / per-m² rate. */
export type QualityGrade = 'budget' | 'standard' | 'premium' | 'luxury';
export const QUALITY_FACTORS_GRV: Record<QualityGrade, number> = {
  budget:   0.85,
  standard: 1.00,
  premium:  1.20,
  luxury:   1.55,
};

/**
 * Annual price escalation rate (% p.a.) by asset type.
 * 10-year averages 2014–2024 — used to project a 2025 base price into a
 * different target year (historical or future).
 *
 * Note: real markets are cyclical (booms & corrections); a single linear rate
 * is best for ≤ 5-year horizons. For longer horizons the user should provide
 * a custom rate.
 */
export interface EscalationData {
  assetType: GRVAssetType;
  annualGrowth: number;
  source: string;
}

export const ESCALATION_RATES: EscalationData[] = [
  { assetType: 'apartments-high-rise',  annualGrowth: 0.035, source: 'CoreLogic 10-yr avg 2014–2024' },
  { assetType: 'apartments-mid-rise',   annualGrowth: 0.040, source: 'CoreLogic 10-yr avg 2014–2024' },
  { assetType: 'apartments-low-rise',   annualGrowth: 0.045, source: 'CoreLogic 10-yr avg 2014–2024' },
  { assetType: 'townhouses',            annualGrowth: 0.060, source: 'CoreLogic 10-yr avg 2014–2024' },
  { assetType: 'detached-houses',       annualGrowth: 0.070, source: 'CoreLogic 10-yr avg 2014–2024' },
  { assetType: 'land-lot',              annualGrowth: 0.075, source: 'HIA-CoreLogic Residential Land Report 10-yr' },
  { assetType: 'office-prime',          annualGrowth: 0.025, source: 'JLL / Knight Frank capital values 10-yr' },
  { assetType: 'office-secondary',      annualGrowth: 0.015, source: 'JLL 10-yr avg' },
  { assetType: 'retail-strip',          annualGrowth: 0.030, source: 'Colliers Retail 10-yr avg' },
  { assetType: 'retail-mall',           annualGrowth: 0.020, source: 'JLL Retail 10-yr avg' },
  { assetType: 'industrial-warehouse',  annualGrowth: 0.075, source: 'JLL Industrial 10-yr avg (incl. recent surge)' },
  { assetType: 'hotel-5-star',          annualGrowth: 0.030, source: 'JLL Hotels 10-yr avg (excl. COVID dip)' },
  { assetType: 'hotel-4-star',          annualGrowth: 0.030, source: 'JLL Hotels 10-yr avg' },
  { assetType: 'hotel-3-star',          annualGrowth: 0.025, source: 'JLL Hotels 10-yr avg' },
];

/** Required user-supplied metrics for a meaningful GRV benchmark. */
export const REQUIRED_GRV_METRICS = [
  { name: 'Asset type / class',                  why: 'Apartment vs detached vs office vs hotel pricing bases differ ($/m²–$/lot–$/key)' },
  { name: 'State / city',                        why: 'Sydney apartments are +65% above Brisbane; Hobart -30% (CoreLogic 2024)' },
  { name: 'Sub-market / location grade',         why: 'CBD-prestige vs outer-ring spans -30% to +40% on the same asset type' },
  { name: 'Quality / finish grade',              why: 'Budget → Luxury spans -15% to +55% on price' },
  { name: 'Saleable area / lots / keys',         why: 'Drives total GRV via $/m² × m² or $/lot × lots' },
  { name: 'Target year (today / future / past)', why: 'Apartments grew ~3.5% p.a., houses ~7% p.a. on 10-yr average — projection horizon material' },
  { name: 'GST treatment',                       why: 'Margin-scheme residential prices are GST-incl.; commercial going-concern is GST-excl. — must align with model' },
];

/** Typical area assumptions per unit — used when no per-unit area is supplied. */
export const TYPICAL_UNIT_AREAS_M2 = {
  'apartments-high-rise': { studio: 45, oneBed: 55, twoBed: 80, threeBed: 110, default: 75 },
  'apartments-mid-rise':  { studio: 45, oneBed: 60, twoBed: 85, threeBed: 115, default: 78 },
  'apartments-low-rise':  { studio: 50, oneBed: 65, twoBed: 90, threeBed: 120, default: 82 },
  'townhouses':           { default: 165 },
  'detached-houses':      { default: 220 },
};

export interface GRVBenchmarkInputs {
  assetType: GRVAssetType;
  state: State;
  locationGrade: LocationGrade;
  quality: QualityGrade;
  /** Year for which the price is wanted (e.g. 2025 = today, 2028 = projected) */
  targetYear: number;
  /** Optional: m² per unit (only required for $/m² bases). */
  unitArea?: number | undefined;
  /** Optional: number of units / keys / lots. */
  units?: number | undefined;
  /** Optional: total saleable area (overrides unitArea × units when provided). */
  totalSaleableArea?: number | undefined;
  /** Optional: override annual escalation rate (decimal). */
  customEscalation?: number | undefined;
}

export interface GRVBenchmarkResult {
  pricingBasis: PricingBasis;
  /** Per-unit / per-m² recommended price band (low – high). */
  perUnitLow: number;
  perUnitHigh: number;
  perUnitMid: number;
  /** Total GRV recommended band (perUnit × area-or-units). */
  totalLow: number | null;
  totalHigh: number | null;
  totalMid: number | null;
  /** Composition factors that produced the result (for transparency). */
  factors: {
    base: [number, number];
    baseYear: number;
    targetYear: number;
    annualEscalation: number;
    yearsApplied: number;
    escalationFactor: number;
    stateFactor: number;
    locationFactor: number;
    qualityFactor: number;
  };
  source: string;
  basisNote: string;
}

/**
 * Compute a recommended GRV (sale price) range for the given asset profile
 * and target valuation year.
 */
export function computeGRVBenchmark(inputs: GRVBenchmarkInputs): GRVBenchmarkResult | null {
  const base = GRV_BENCHMARKS.find(b => b.assetType === inputs.assetType);
  if (!base) return null;

  const sf = STATE_FACTORS_GRV[inputs.state] ?? 1;
  const lf = LOCATION_FACTORS[inputs.locationGrade] ?? 1;
  const qf = QUALITY_FACTORS_GRV[inputs.quality] ?? 1;

  // Escalation
  const escalRow = ESCALATION_RATES.find(e => e.assetType === inputs.assetType);
  const annualEscalation = inputs.customEscalation !== undefined && Number.isFinite(inputs.customEscalation)
    ? inputs.customEscalation
    : (escalRow?.annualGrowth ?? 0.04);
  const yearsApplied = inputs.targetYear - base.baseYear;
  const escalationFactor = Math.pow(1 + annualEscalation, yearsApplied);

  const multiplier = sf * lf * qf * escalationFactor;
  const perUnitLow  = Math.round(base.baseLow  * multiplier);
  const perUnitHigh = Math.round(base.baseHigh * multiplier);
  const perUnitMid  = Math.round((perUnitLow + perUnitHigh) / 2);

  // Total — basis-dependent
  let totalLow: number | null = null;
  let totalHigh: number | null = null;
  let totalMid: number | null = null;

  switch (base.pricingBasis) {
    case 'per-sqm-saleable':
    case 'per-sqm-nla':
    case 'per-sqm-land': {
      const area = inputs.totalSaleableArea
        ?? (inputs.unitArea && inputs.units ? inputs.unitArea * inputs.units : 0);
      if (area > 0) {
        totalLow  = Math.round(perUnitLow  * area);
        totalHigh = Math.round(perUnitHigh * area);
        totalMid  = Math.round(perUnitMid  * area);
      }
      break;
    }
    case 'per-lot':
    case 'per-key':
      if (inputs.units && inputs.units > 0) {
        totalLow  = Math.round(perUnitLow  * inputs.units);
        totalHigh = Math.round(perUnitHigh * inputs.units);
        totalMid  = Math.round(perUnitMid  * inputs.units);
      }
      break;
  }

  return {
    pricingBasis: base.pricingBasis,
    perUnitLow, perUnitHigh, perUnitMid,
    totalLow, totalHigh, totalMid,
    factors: {
      base: [base.baseLow, base.baseHigh],
      baseYear: base.baseYear,
      targetYear: inputs.targetYear,
      annualEscalation,
      yearsApplied,
      escalationFactor,
      stateFactor: sf,
      locationFactor: lf,
      qualityFactor: qf,
    },
    source: base.source,
    basisNote: base.basisNote,
  };
}

/** Friendly label for a pricing basis. */
export function pricingBasisLabel(basis: PricingBasis): string {
  switch (basis) {
    case 'per-sqm-saleable': return '$/m² saleable area';
    case 'per-sqm-nla':      return '$/m² NLA';
    case 'per-sqm-land':     return '$/m² land';
    case 'per-lot':          return '$/lot';
    case 'per-key':          return '$/key';
  }
}
