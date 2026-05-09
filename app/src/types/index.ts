// ===== TIMELINE =====
export interface TimelineConfig {
  modelStartDate: number; // Excel serial date
  monthsPerPeriod: number;
  lastActualsPeriod: number; // Excel serial date
  totalPeriods: number;
}

export interface Period {
  index: number; // 0-based
  periodNumber: number; // 1-based
  startDate: Date;
  endDate: Date;
  daysInPeriod: number;
  isActual: boolean;
  isForecast: boolean;
  label: string; // e.g. "Jan-25"
}

// ===== COST ITEMS =====
export type CostType =
  | 'Land Purchase, PRSV & Acquisition Costs'
  | 'Development Costs'
  | 'Total Construction Costs'
  | 'Marketing & Advertising'
  | 'Other Standard Costs'
  | 'Development & Project Management Fees'
  | 'Selling & Leasing Costs'
  | 'Other Financing Costs'
  | 'Letting Fees & Incentives';

export type SCurveType =
  | 'Evenly Split'
  | 'Manual S-curve 1'
  | 'Manual S-curve 2'
  | 'Manual S-curve 3'
  | string; // e.g. "41 Month Build"

export interface LandPaymentStage {
  id: string;
  description: string;
  percentOfLand: number;
  amount: number;
  lumpSum: number;
  monthStart: number;
  monthSpan: number;
}

export interface AcquisitionCostItem {
  id: string;
  description: string;
  percentOfLand: number;
  amount: number;
  lumpSum: number;
  monthStart: number;
  monthSpan: number;
  addGST: boolean;
}

export interface CostLineItem {
  code: string;
  description: string;
  costType: CostType;
  units: number;
  baseRate: number;
  totalCosts: number;
  sCurve: SCurveType;
  monthStart: number;
  monthSpan: number;
  addGST: boolean;
  ctd: number;
  ctc: number;
  actuals?: number[] | undefined; // per-period actual spend (0-based period index); overrides forecast for actual periods
  /**
   * PM-fee specific. Rate applied to total non-PM costs (incl. GST on those
   * costs) to derive the PM fee total. Decimal — 0.02 = 2%. Only meaningful on
   * `pmFees[0]`; ignored on every other cost section.
   *
   * Why a dedicated field: the v1 engine read the PM fee rate from the
   * generic `units` column. The Inputs UI labels that column "Units" and on
   * edit recomputes `totalCosts = units × baseRate`. A user expressing
   * "PM Fee = $500K" naturally typed `units=1, baseRate=500000` — and the
   * engine then read units=1 as a 100% rate, producing the v2-UAT $94–98M PM
   * fee bug. With `feeRatePercent` separated out, the rate is no longer
   * overloaded onto Units and the Inputs UI can validate it as 0..1.
   */
  feeRatePercent?: number;
}

export interface ConstructionCostItem extends CostLineItem {
  contingencyPercent?: number;
}

export interface SellingCostConfig {
  code: string;
  description: string;
  salesCommission: number;
  preCommissionPercent: number;
  depositPercent: number;
  sCurve: SCurveType;
  addGST: boolean;
}

// ===== REVENUE =====
export type RevenueType =
  | 'Residential'
  | 'Retail F&B'
  | 'Commercial Office'
  | 'Hotel'
  | 'Management Rights'
  | 'Settlement Adjustments'
  | 'Gross Rental Income'
  | 'Other Income'
  | '-';

/**
 * GST supply-type classification for revenue items.
 *  - 'margin-scheme':   New residential premises sold under Division 75 (margin only)
 *  - 'standard':        Standard-rated supply (commercial/retail/hotel) – GST on full price, ITC on costs
 *  - 'input-taxed':     Input-taxed supply (long-term residential rental >60 days same tenant) – no GST, no ITC
 *  - 'going-concern':   Going concern (GSTA s.38-325) – GST-free, but vendor+purchaser must both be registered
 */
export type GSTSupplyType = 'margin-scheme' | 'standard' | 'input-taxed' | 'going-concern';

export interface RevenueLineItem {
  code: string;
  description: string;
  revenueType: RevenueType;
  units: number;
  totalArea: number;
  currentSalePrice: number;
  preSaleExchangeMonth: number;
  preSaleSpan: number;
  settlementMonth: number;
  settlementSpan: number;
  gstIncluded: boolean;
  /** GST supply classification. Defaults: gstIncluded=true → 'margin-scheme'; false → 'standard' for commercial, 'input-taxed' otherwise */
  supplyType?: GSTSupplyType;
  /** Subject to GST vendor-withholding under TAA 1953 Sch 1, s.14-250 (new residential premises). Defaults to true for margin-scheme residential. */
  withholdingApplies?: boolean;
  actuals?: number[] | undefined; // per-period actual revenue (0-based period index); overrides forecast for actual periods
}



// Rental/other income items. Default treatment is input-taxed (GSTA s.40-70) with
// no GST on income and no ITC on costs. Set supplyType='standard' for
// short-term / holiday letting or hotel accommodation which is standard-rated.
export interface RentalIncomeItem {
  code: string;
  description: string;
  revenueType: string;
  units: number;
  baseRate: number;
  sCurve: SCurveType;
  monthStart: number;
  monthSpan: number;
  /** GST treatment of this income stream. Default 'input-taxed'. */
  supplyType?: GSTSupplyType;
  actuals?: number[] | undefined; // per-period actual income (0-based period index); overrides forecast for actual periods
}

// ===== FINANCING =====
export interface EquityConfig {
  name: string;
  /** Equity cap — maximum cumulative equity drawdown for this entity ($).
   *  When > 0, this is the hard ceiling the funding solver respects under
   *  equity-first / senior-first / pro-rata modes. When 0 AND `percentage` > 0,
   *  the cap is computed as `percentage × totalCostsExcFin`. Renamed from
   *  `fixedAmount` in v7 — schema migration backfills automatically. */
  equityCap: number;
  percentage: number;
  interestRate: number;
  interestCompound: number; // 1=compound, 0=simple
  repayEquityBeforeDebt: number;
  equityContribution: number;
  profitShare: number;
  drawdownPriority: number; // 1 = drawn first, higher = drawn later; equity default 3
}

/**
 * Line fee calculation basis.
 *  - 'peak-drawn':        Charge on the peak drawn balance (converged via iterative solver).
 *                         Typical for facilities where the fee reflects the maximum drawn amount.
 *  - 'committed-limit':   Charge on the full approved facility limit for every active period.
 *                         Term-sheet convention where lender reserves capital on the full commitment.
 *  - 'undrawn-commitment': Charge on the undrawn portion (limit - drawn) — commitment fee style.
 */
export type LineFeeBasis = 'peak-drawn' | 'committed-limit' | 'undrawn-commitment';

/**
 * Loan product type. Drives the dashboard covenant view (LVR / LTC / peak debt
 * vs facility limit for a development loan; differentiated targets for residual
 * stock / investment facilities).
 *
 *  - 'development': construction or pre-revenue facility — sized by feasibility,
 *    LVR (peak senior / GRV), LTC (peak debt / total cost) and peak debt vs
 *    facility limit.
 *  - 'investment' / 'residual-stock': term / hold facility against built stock.
 */
export type FacilityType = 'development' | 'investment' | 'residual-stock';

export interface DebtFacility {
  name: string;
  /** Loan product type. Optional for back-compat — undefined defaults to
   *  'development' for senior/mezz/land facilities and 'investment' for
   *  residual-stock. See engine/index.ts. */
  facilityType?: FacilityType;
  facilityLimit: number;
  startMonth: number;
  maturityMonth: number;
  interestRate: number;
  bbsy: number;
  margin: number;
  establishmentFeePercent: number;
  lineFeePercent: number;
  interestPaymentFrequency: number; // months
  isCapitalised: boolean;
  ltcTarget: number;
  lvrTarget: number;
  drawdownPriority: number; // 1 = drawn first, higher = drawn later; senior default 1, mezz default 2
  /** Line fee basis. Defaults to 'peak-drawn' (converges via solver). Some term sheets use 'committed-limit' or 'undrawn-commitment'. */
  lineFeeBasis?: LineFeeBasis;
  /** Whether the lender is a GST-exempt financial institution (GSTA s.40-60). Defaults to true. */
  lenderIsGSTExempt?: boolean;
  // Per-period actual values (0-based index = period index).
  // In actual periods these override the model-calculated values for reporting;
  // the waterfall calculation itself is unchanged (no redistribution).
  actualsDrawdown?: number[] | undefined;
  actualsRepayment?: number[] | undefined;
  actualsInterest?: number[] | undefined;
  actualsFees?: number[] | undefined; // combined line fee + establishment fee for the period
}

// ===== ADMIN =====
export interface AdminConfig {
  projectName: string;
  /** Free-text version label for the saved project (e.g. "Initial baseline", "Post review v2"). Used by the dashboard version-comparison feature. */
  versionName?: string;
  /** Short version/revision tag displayed in the app header (e.g. "1.0", "rev 3"). */
  projectVersion?: string;
  modelStartDate: number;
  monthsPerPeriod: number;
  lastActualsPeriod: number;
  tolerance: number;
  daysPerYear: number;
  monthsPerYear: number;
  currency: string;
  sCurveOptions: string[];
  manualSCurves: number[][]; // 3 manual s-curves, each array of monthly %
  buildSCurves: Record<number, number[]>; // keyed by build duration (12–60), monthly weights
  /** Months to delay ITC recovery after the GST cost is incurred (0 = same-period, standard for feasibility; 1-3 for realistic quarterly BAS lag) */
  itcRecoveryLagMonths?: number;
  /** Whether TAA 1953 Sch 1, s.14-250 vendor-withholding applies to new residential settlements. Defaults to false (assume net settlement modelled) */
  applyGSTWithholding?: boolean;
  /** Contingency reserve GST treatment. 'none' = no GST (reserve until spent on invoiced supplies), 'full' = apply gstRate on contingency (legacy) */
  contingencyGSTMode?: 'none' | 'full';
  /** Equity drawdown mode:
   *  - 'equity-first' (default, current behaviour): each period the gap-fill loop
   *    fills from the lowest drawdownPriority first, so equity (priority 1) drains
   *    fully before senior (priority 4) starts gap-filling. Backwards-compatible.
   *  - 'pro-rata': split the period gap proportionally between developer equity and
   *    senior, weighted by remaining covenant headroom on each.
   *  - 'senior-first' (recommended for standard Australian dev finance): once
   *    construction starts (i >= senior.startMonth), debt facilities fill the gap
   *    BEFORE equity (senior → senior2 → mezz, in their existing relative order).
   *    Equity only steps in when all debt is at LTC/LVR/facility cap. Pre-construction
   *    periods are unchanged — equity covers land + DA per the existing priority order. */
  equityDrawdownMode?: 'equity-first' | 'pro-rata' | 'senior-first';
  /** M3 — Cash-sweep order for the revenue waterfall. Default ['senior','mezz','equity']
   *  is the legal priority. ['mezz','senior','equity'] is the high-rate-first cash sweep
   *  sometimes seen on retail fund mandates. Equity is always last by convention.
   *  Note: the LEGAL priority on default remains senior-first regardless of this setting. */
  repaymentSequence?: ('senior' | 'mezz' | 'equity')[];
  /** Branding: custom application title shown in header and browser tab */
  appName?: string | undefined;
  /** Branding: base64-encoded logo image (data URL) displayed in header top-left */
  logoDataUrl?: string | undefined;
  /** Branding: base64-encoded favicon image (data URL) applied to browser tab */
  faviconDataUrl?: string | undefined;
  /** Branding: CSS colour for the page background (e.g. '#f3f4f6') */
  appBgColor?: string | undefined;
}

// ===== MAIN INPUTS =====
export interface ProjectPreliminary {
  dateOfFirstPeriod: number;
  cashFlowPeriod: string;
  projectLots: number;
  projectGFA: number;
  siteArea: number;
  projectStartMonth: number;
  projectSpanMonths: number;
  projectEndMonth: number;
  equityDistStartMonth: number;
  equityDistSpanMonths: number;
}

/**
 * Stamp duty concession/surcharge applied to the QLD/NSW/VIC duty calculation.
 *  - 'none':            Standard transfer duty (default)
 *  - 'home-concession': 50% concession for owner-occupier residential (QLD Duties Act 2001 s.87)
 *  - 'first-home':      First Home Owner Grant concession (full exemption)
 *  - 'foreign-surcharge': Additional foreign acquirer surcharge on top of standard duty
 */
export type StampDutyConcession = 'none' | 'home-concession' | 'first-home' | 'foreign-surcharge';

export interface LandPurchaseInputs {
  landPurchasePrice: number;
  prsvUplift: number;
  prsvMonth: number;
  prsvSpan: number;
  /** Whether PRSV uplift is contingent (excluded from capital stack / TDC) or a firm commitment */
  prsvIsContingent?: boolean;
  gstRate: number;
  gstApplicableLand: boolean;
  addGSTOnLandPrice: boolean;
  stampDutyState: string;
  stampDutyAmount: number;
  /** Concession or surcharge applied to transfer duty. Default 'none' (standard rate). */
  stampDutyConcession?: StampDutyConcession;
  /** Whether the stamp duty value is manually entered (true) or derived from calculateStampDuty (false). */
  stampDutyManual?: boolean;
  interestOnDeposit: number;
  profitShareToLandOwner: number;
  paymentStages: LandPaymentStage[];
  acquisitionCosts: AcquisitionCostItem[];
}

/**
 * Minimum equity requirement — term-sheet cross-check input.
 *
 * Many senior construction term sheets (e.g. Goldman Sachs indicative terms)
 * require a minimum sponsor equity contribution as a percentage of TDC. This
 * is a CROSS-CHECK against the model's converged equity draws, not a sizing
 * constraint — the funding solver still uses `equityCap` (max equity) to
 * bound drawdowns. When `actualEquityCash < requiredEquity` the engine
 * emits a `[FUNDING]` warning and the Checks tab flips that row to FAIL.
 *
 *  - mode      'percent' | 'amount' — value is a fraction of basis or a $ value.
 *  - value     0 disables the check (warning + Checks-row both go quiet/N/A).
 *  - basis     'tdc'                       — TDC excluding capitalised finance costs.
 *              'tdc-incl-finance-costs'    — TDC including the converged senior /
 *                                            senior2 / mezz / land-loan finance costs.
 *              Most term sheets reference "TDC" inclusive of finance costs.
 *
 * Backwards-compatible: introduced in v8 schema migration with default
 * `{ mode: 'percent', value: 0, basis: 'tdc-incl-finance-costs' }` so all
 * existing fixtures and saved projects are no-ops on this check.
 */
export interface MinEquityRequirement {
  mode: 'percent' | 'amount';
  value: number;
  basis: 'tdc' | 'tdc-incl-finance-costs';
}

export interface MainInputs {
  preliminary: ProjectPreliminary;
  landPurchase: LandPurchaseInputs;
  developmentCosts: CostLineItem[];
  constructionCosts: CostLineItem[];
  constructionContingencyPercent: number;
  marketingCosts: CostLineItem[];
  otherStandardCosts: CostLineItem[];
  pmFees: CostLineItem[];
  sellingCosts: SellingCostConfig[];
  frontEndSellingCosts: CostLineItem[];
  backEndSellingCosts: CostLineItem[];
  lettingFees: CostLineItem[];
  grvItems: RevenueLineItem[];
  rentalIncome: RentalIncomeItem[];
  otherIncome: RentalIncomeItem[];
  equityDeveloper: EquityConfig;
  equityJV: EquityConfig;
  equityPreferred: EquityConfig;
  equityAdditional: EquityConfig;
  landLoan: DebtFacility;
  mezzanine: DebtFacility;
  seniorFacility: DebtFacility;
  seniorFacility2: DebtFacility;
  residualStockFacility: DebtFacility;
  otherFinancingCosts: CostLineItem[];
  /** Term-sheet equity floor — emits a [FUNDING] warning + Checks-tab FAIL when
   *  the converged actual cash equity (developer + JV draws) falls below the
   *  required amount. v8 default `{ mode: 'percent', value: 0, basis: 'tdc-incl-finance-costs' }`
   *  disables the check (back-compat for v7 fixtures). Optional in the type so
   *  hand-rolled test fixtures (which bypass the migration) compile without
   *  noise; engine + UI + Checks-tab all treat `undefined` as the disabled
   *  default. See MinEquityRequirement. */
  minEquityRequirement?: MinEquityRequirement;
}

// ===== CALCULATION RESULTS =====
export interface MonthlyCashflow {
  period: Period;
  // Costs
  landCosts: number;
  acquisitionCosts: number;
  developmentCosts: number;
  constructionCosts: number;
  contingency: number;
  marketingCosts: number;
  otherStandardCosts: number;
  pmFees: number;
  sellingCostsFrontEnd: number;
  sellingCostsBackEnd: number;
  lettingFees: number;
  otherFinancingCosts: number;
  gstOnCosts: number;
  itcRecovery: number;       // ATO refund of GST paid on costs (Input Tax Credit)
  // Revenue
  grvSettlements: number;
  grvDeposits: number;
  rentalIncome: number;
  otherIncome: number;
  gstOnRevenue: number;
  /** GST on deposits received during presale period (BAS liability in period received, GSTA s.9-70) */
  gstOnDeposits?: number;
  /** GST withholding retained by purchaser at settlement (TAA 1953 Sch 1, s.14-250). Cash reduction, remitted direct to ATO. */
  gstWithholding?: number;
  // Funding
  landLoanDrawdown: number;
  landLoanRepayment: number;
  landLoanInterest: number;
  landLoanFees: number;
  /** LL2 — Memo of the senior-takeout transaction at construction start. */
  landLoanTakeoutBySenior?: number;
  seniorDrawdown: number;
  seniorRepayment: number;
  seniorInterest: number;
  seniorFees: number;
  senior2Drawdown: number;
  senior2Repayment: number;
  senior2Interest: number;
  senior2Fees: number;
  mezzDrawdown: number;
  mezzRepayment: number;
  mezzInterest: number;
  mezzFees: number;
  equityInjection: number;
  equityRepatriation: number;
  profitDistribution: number;
  // Balances
  landLoanBalance: number;
  seniorBalance: number;
  senior2Balance: number;
  mezzBalance: number;
  equityBalance: number;
  netCashflow: number;
  cumulativeCashflow: number;
}

// ===== DASHBOARD =====
export interface FeasibilitySummary {
  totalGRV: number;
  totalSettlementsRevenue: number;
  land: number;
  stampDuty: number;
  buildCosts: number;
  contingency: number;
  seniorFinanceCosts: number;
  mezzFinanceCosts: number;
  otherFinancingCosts: number;
  /** Development costs only (codes 2001-2099), excludes other standard costs */
  developmentCosts: number;
  /** Other standard costs only (codes 5001-5020) */
  otherStandardCosts: number;
  /** Total = developmentCosts + otherStandardCosts */
  standardCosts: number;
  /** GST paid to vendors on costs (input tax credits claimable via BAS) */
  gst: number;
  /** GST embedded in sale prices and remitted to ATO */
  gstOnRevenue: number;
  /** Net GST payable to ATO = gstOnRevenue - gst */
  gstNet: number;
  marketingAndAdvertising: number;
  salesCommissions: number;
  pmFee: number;
  totalCost: number;
  totalProfit: number;
  loanCouponInterest: number;
  totalProfitAfterCoupon: number;
}

export interface KPIs {
  totalCashOnCash: number;
  annualCashOnCash: number;
  roi: number;
  irr: number;
}

export interface CapitalStack {
  seniorAmount: number;
  seniorLTC: number;
  seniorLVR: number;
  senior2Amount: number;
  senior2LTC: number;
  senior2LVR: number;
  mezzAmount: number;
  mezzLTC: number;
  mezzLVR: number;
  equityAmount: number;
  equityLTC: number;
  equityLVR: number;
  total: number;
}

export interface DebtSummary {
  seniorPrincipal: number;
  seniorInterest: number;
  seniorTotal: number;
  senior2Principal: number;
  senior2Interest: number;
  senior2Total: number;
  mezzPrincipal: number;
  mezzInterest: number;
  mezzTotal: number;
  totalPrincipal: number;
  totalInterest: number;
  totalDebt: number;
}

export interface DebtRates {
  seniorEstablishment: number;
  seniorLineFee: number;
  seniorMargin: number;
  seniorBBSY: number;
  seniorAllIn: number;
  senior2Establishment: number;
  senior2LineFee: number;
  senior2Margin: number;
  senior2BBSY: number;
  senior2AllIn: number;
  mezzEstablishment: number;
  mezzLineFee: number;
  mezzMargin: number;
  mezzBBSY: number;
  mezzAllIn: number;
  landEstablishment: number;
  landLineFee: number;
  landMargin: number;
  landBBSY: number;
  landAllIn: number;
}

export interface KeyDates {
  contractStartDate: string;
  establishJV: string;
  salesCommencement: string;
  landSettlement: string;
  constructionStart: string;
  constructionCompletion: string;
  salesSettlementCompleted: string;
  projectDurationMonths: number;
  constructionTimeMonths: number;
  planningDesignMonths: number;
  landToSettlementMonths: number;
}

export interface EquityReturnSummary {
  entity: string;
  fundingContribPercent: number;
  totalEquityContributed: number;
  irr: number;
  equityRepatriation1st: number;
  equityRepatriation2nd: number;
  totalEquityRepatriation: number;
  establishmentFee: number;
  couponInterest: number;
  couponInterestPercent: number;
  profitShareBalance: number;
  profitSharePercent: number;
  totalProfitShare: number;
}

/**
 * Covenant summary for a development loan. Surfaced on Table 12. LVR (peak
 * senior / GRV), LTC (peak debt / total cost) and peak senior vs facility
 * limit are the relevant covenants for a pre-revenue construction project —
 */
export interface DevelopmentCovenants {
  /** Peak senior debt balance / total GRV. */
  lvr: number;
  /**
   * Senior LTC = peak senior balance / total project cost. Compared
   * against the senior facility's own `ltcTarget`. Dandenong B1 — this
   * was previously `peak total debt / total cost`, which conflated
   * senior + mezz + land into a single ratio and made `meetsLTC`
   * spuriously fail when the combined stack exceeded the senior 75%
   * target even though each facility was individually within covenant.
   */
  ltc: number;
  /** Peak total debt across all facilities (informational). */
  peakDebt: number;
  /** Peak senior balance (informational). */
  peakSenior: number;
  /** Senior facility approved limit. */
  seniorLimit: number;
  /** Peak senior / senior limit — utilisation gate. */
  peakSeniorPctLimit: number;
  /** Senior facility's lvrTarget (typical 0.65). */
  lvrTarget: number;
  /** Senior facility's ltcTarget (typical 0.7). */
  ltcTarget: number;
  /** lvr <= lvrTarget (senior). */
  meetsLVR: boolean;
  /** ltc <= ltcTarget (senior LTC vs senior target — per-facility, post-B1). */
  meetsLTC: boolean;
  /** Peak senior balance <= senior limit (no overdraw). */
  withinSeniorLimit: boolean;
  // === B1 per-facility mezz covenant (optional — only when mezz is in the stack)
  /** True when a mezz facility is sized > 0 OR carries a non-zero peak balance. */
  mezzPresent: boolean;
  /** Mezz LTC = peak mezz balance / total project cost. */
  mezzLTC?: number;
  /** Mezz facility's own ltcTarget (e.g. 0.85). */
  mezzLTCTarget?: number;
  /** Peak mezz balance (informational). */
  peakMezz?: number;
  /** mezzLTC <= mezzLTCTarget — independent of senior. */
  meetsMezzLTC?: boolean;
}

/**
 * Peak debt / equity / peak-equity-month exposure summary. Always emitted
 * by the engine; surfaced on Table 12 alongside the LVR / LTC covenants
 * (in DevelopmentCovenants).
 */
export interface PeakExposure {
  /** Peak aggregate debt balance reached across all facilities */
  peakDebt: number;
  /** Peak equity drawn (maximum cumulative equity injection, net of repatriations) */
  peakEquity: number;
  /** Month number (1-based) where peak equity was reached */
  peakEquityMonth: number;
}

/**
 * GST & margin scheme compliance schedule — supports ATO audit defence for
 * taxpayers applying Division 75 (margin scheme) and claiming ITCs on
 * creditable acquisitions.
 */
export interface GSTCompliance {
  gstRate: number;
  /** Total sale price of margin-scheme supplies (gstIncluded residential) */
  marginSchemeSupplies: number;
  /** Land cost apportioned to margin-scheme supplies (reduces taxable margin) */
  marginSchemeLandCost: number;
  /** Net taxable margin (sale price − apportioned land cost) */
  taxableMargin: number;
  /** GST output on margin scheme = taxableMargin × 1/11 */
  gstOnMarginSchemeSupplies: number;
  /** Total sale price of standard-rated supplies */
  standardRatedSupplies: number;
  /** GST output on standard-rated supplies = price × 1/11 (embedded in sale price) */
  gstOnStandardSupplies: number;
  /** Total sale price of input-taxed supplies (no GST) */
  inputTaxedSupplies: number;
  /** Total sale price of going-concern supplies (GST-free) */
  goingConcernSupplies: number;
  /** Creditable acquisitions (ITC claimable) */
  creditableAcquisitions: number;
  /** Input tax credits claimable */
  itcClaimable: number;
  /** GST withheld by purchasers on residential settlements (remitted direct to ATO) */
  gstWithholdingTotal: number;
  /** Net GST payable to ATO = (GST outputs + withholdings) − ITC claimable */
  netGSTPayable: number;
}

/**
 * Solver diagnostics — exposed to the UI so users can see whether the iterative
 * debt solver converged, how many iterations it ran, and the final delta.
 * If `converged === false`, finance costs and facility sizes may be inaccurate.
 */
export interface SolverDiagnostics {
  converged: boolean;
  iterations: number;
  /**
   * CR3 — Iteration count at which convergence was achieved, or `null` if the
   * solver hit the iteration cap. Tests should assert
   * `convergedIn < maxIterations` on known-good fixtures so a future change
   * pushing convergence into the high-40s (still passing) is caught early.
   */
  convergedIn: number | null;
  maxIterations: number;
  /** Final absolute finance-cost delta (dollars) when the solver exited. */
  finalDelta: number;
  /** Tolerance ($) used for convergence comparison. */
  tolerance: number;
}

export type WarningSeverity = 'error' | 'warning' | 'info';
export type WarningCategory = 'solver' | 'gst' | 'sCurve' | 'revenue' | 'funding' | 'general';

export interface CalculationWarning {
  message: string;
  severity: WarningSeverity;
  category: WarningCategory;
}

export interface DashboardData {
  feasibility: FeasibilitySummary;
  kpis: KPIs;
  capitalStack: CapitalStack;
  debtSummary: DebtSummary;
  debtRates: DebtRates;
  keyDates: KeyDates;
  equityReturns: {
    total: EquityReturnSummary;
    jvPartner: EquityReturnSummary;
    developer: EquityReturnSummary;
  };
  otherIndicators: {
    peakInterestHoldingCostPerMonth: number;
    /** Number of months from project start until cumulative profit distributions exceed initial equity */
    paybackPeriodMonths: number;
  };
  grvSummary: {
    totalApartmentGRV: number;
    grvSoldExchanged: number;
    unsoldGRV: number;
  };
  /** Peak debt / equity / peak-month exposure. Always populated. */
  peakExposure: PeakExposure;
  /** LVR / LTC / facility-limit covenants. Populated when the senior facility
   *  is a development loan; surfaced on Table 12. */
  developmentCovenants?: DevelopmentCovenants;
  gstCompliance?: GSTCompliance;
  cashflows: MonthlyCashflow[];
  /** Plain-string warnings (legacy — kept for backward compat with existing UI). */
  warnings: string[];
  /** Structured warnings with severity + category — new UI uses this for filtering / grouping. */
  warningsDetail?: CalculationWarning[];
  /** Iterative debt-solver diagnostics. */
  solver?: SolverDiagnostics;
  /** Per-line-item cost variance: budget vs actuals, cost-to-date, cost-to-complete. */
  costVariance: CostLineVariance[];
  /**
   * V8 — Minimum-equity cross-check telemetry from the converged final solve.
   * Single source of truth for the [FUNDING] warning + Checks-tab "Equity meets
   * minimum requirement" row. The two consumers MUST read these numbers
   * verbatim — recomputing the basis from `feasibility.totalCost` (input-side
   * ex-GST rollup) disagrees with the engine's cash-basis-incl-GST computation
   * on any GST-bearing project. When `inputs.minEquityRequirement.value === 0`,
   * `required: 0` and `shortfall: 0` (check disabled).
   */
  minEquityCheck: {
    required: number;
    actual: number;
    basisAmount: number;
    basisName: 'TDC' | 'TDC + financing costs';
    shortfall: number;
  };
  /**
   * Bug B — Equity-cap overshoot telemetry from the converged final solve.
   * Single source of truth for the [FUNDING] / [INFO] warning + Checks-tab
   * "Equity within user cap" row. Populated for BOTH entities (developer,
   * jv) regardless of whether either fired — `severity: 'pass'` means the
   * draw came in at or under the user-set cap (or the entity is uncapped /
   * inactive). When `equityDeveloper.equityCap === 0` (or `equityJV.equityCap
   * === 0`) the entity is treated as uncapped and `severity: 'pass'` is set
   * regardless of drawn amount — no warning emitted.
   */
  equityCapCheck: {
    developer: {
      drawn: number;
      cap: number;
      overshoot: number;
      overshootPct: number;
      severity: 'pass' | 'info' | 'warn' | 'fail';
      fundingGap: number;
    };
    jv: {
      drawn: number;
      cap: number;
      overshoot: number;
      overshootPct: number;
      severity: 'pass' | 'info' | 'warn' | 'fail';
      fundingGap: number;
    };
  };
}

/** Budget control metrics for a single cost line item. */
export interface CostLineVariance {
  code: string;
  description: string;
  budget: number;
  /** Sum of actuals for all isActual periods. */
  ctd: number;
  /** Remaining budget: max(0, budget − ctd). */
  ctc: number;
  /** Positive = over budget so far; negative = under budget. */
  varianceToDate: number;
}
