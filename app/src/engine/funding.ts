import type { Period, MainInputs, DebtFacility } from '../types';
import { sum } from '../utils';

// Collect warnings for equity backstop overruns — reset per engine run
const _fundingWarnings: string[] = [];
export function clearFundingWarnings(): void { _fundingWarnings.length = 0; }
export function getFundingWarnings(): string[] {
  // De-dupe by exact string. solveFunding iterates internally (up to maxIterations
  // ~50) and is called twice from runCalculations (prelim + final), so per-period
  // warnings can be pushed dozens of times. Each unique message should appear once.
  return [...new Set(_fundingWarnings)];
}

// Zero-value facility used as a safe fallback when an optional facility is missing
// (e.g. when loading a project saved before Senior Facility #2 was added).
const EMPTY_FACILITY: DebtFacility = {
  name: '', facilityLimit: 0, startMonth: 0, maturityMonth: 0,
  interestRate: 0, bbsy: 0, margin: 0, establishmentFeePercent: 0,
  lineFeePercent: 0, interestPaymentFrequency: 0, isCapitalised: false,
  ltcTarget: 0, lvrTarget: 0, drawdownPriority: 99,
};

// ===== DRAWDOWN SEQUENCE =====

export type DrawdownFacilityType = 'equity' | 'equityJV' | 'senior' | 'senior2' | 'mezz';

export interface DrawdownSequenceEntry {
  type: DrawdownFacilityType;
  name: string;
  priority: number;
}

/**
 * Returns the drawdown sequence for the main funding sources — senior debt (1/2),
 * mezzanine debt, and equity — sorted by their user-configured drawdownPriority
 * (1 = drawn first, higher = drawn later).
 *
 * The land loan is excluded because it is drawn as a fixed lump sum at a specific
 * date and is not part of the flexible gap-filling waterfall.
 */
export function computeDrawdownSequence(inputs: MainInputs): DrawdownSequenceEntry[] {
  const sf   = inputs.seniorFacility;
  const sf2  = inputs.seniorFacility2;
  const mz   = inputs.mezzanine;
  const eq   = inputs.equityDeveloper;
  const eqJV = inputs.equityJV;

  const jvActive = eqJV && (eqJV.fixedAmount > 0 || eqJV.equityContribution > 0);

  const entries: DrawdownSequenceEntry[] = [
    ...(sf  ? [{ type: 'senior'     as DrawdownFacilityType, name: sf.name,  priority: sf.drawdownPriority  ?? 1 }] : []),
    ...(sf2 ? [{ type: 'senior2'    as DrawdownFacilityType, name: sf2.name, priority: sf2.drawdownPriority ?? 5 }] : []),
    ...(mz  ? [{ type: 'mezz'       as DrawdownFacilityType, name: mz.name,  priority: mz.drawdownPriority  ?? 2 }] : []),
    ...(eq  ? [{ type: 'equity'     as DrawdownFacilityType, name: eq.name,  priority: eq.drawdownPriority  ?? 3 }] : []),
    ...(jvActive ? [{ type: 'equityJV' as DrawdownFacilityType, name: eqJV.name, priority: eqJV.drawdownPriority ?? 4 }] : []),
  ];
  // Sort by priority, then by a deterministic facility-type order for ties.
  // This guarantees draw-down order is reproducible across runs even when two
  // facilities share the same priority.
  return entries.sort((a, b) =>
    a.priority - b.priority || DRAWDOWN_TYPE_ORDER[a.type] - DRAWDOWN_TYPE_ORDER[b.type],
  );
}

/**
 * Deterministic tie-breaker order for facilities sharing the same priority value.
 * Senior debt first → mezzanine → equity. Using `satisfies` makes adding a new
 * DrawdownFacilityType a compile-time error here, so the exhaustive ordering
 * can never silently drop a facility.
 */
const DRAWDOWN_TYPE_ORDER = {
  senior: 0,
  senior2: 1,
  mezz: 2,
  equity: 3,
  equityJV: 4,
} as const satisfies Record<DrawdownFacilityType, number>;

/**
 * Compile-time exhaustiveness assertion — call from the default branch of a
 * switch over DrawdownFacilityType to guarantee TypeScript flags missing cases.
 * If a new facility type is added without handling, this throws at runtime AND
 * fails the typecheck (because `value` would not be `never`).
 */
export function assertNeverDrawdown(value: never): never {
  throw new Error(`Unhandled DrawdownFacilityType: ${JSON.stringify(value)}`);
}

export interface FundingResult {
  // Monthly arrays
  landLoanBalance: number[];
  landLoanDrawdowns: number[];
  landLoanRepayments: number[];
  landLoanInterest: number[];
  landLoanFees: number[];

  seniorBalance: number[];
  seniorDrawdowns: number[];
  seniorRepayments: number[];
  seniorInterest: number[];
  seniorFees: number[];

  senior2Balance: number[];
  senior2Drawdowns: number[];
  senior2Repayments: number[];
  senior2Interest: number[];
  senior2Fees: number[];

  mezzBalance: number[];
  mezzDrawdowns: number[];
  mezzRepayments: number[];
  mezzInterest: number[];
  mezzFees: number[];

  equityInjections: number[];
  equityRepatriations: number[];
  profitDistributions: number[];
  equityJVInjections: number[];
  equityJVRepatriations: number[];
  jvProfitDistributions: number[];

  // Totals
  totalSeniorInterest: number;
  totalSeniorFees: number;
  totalSenior2Interest: number;
  totalSenior2Fees: number;
  totalMezzInterest: number;
  totalMezzFees: number;
  totalLandLoanInterest: number;
  totalLandLoanFees: number;
  totalEquityInjected: number;
  totalJVEquityInjected: number;
  peakDebt: number;
  peakEquity: number;
  peakEquityMonth: number; // 1-based
  seniorFacilitySize: number;
  seniorFacilityLimit: number;
  senior2FacilitySize: number;
  senior2FacilityLimit: number;
  mezzFacilitySize: number;
  /** Whether the iterative solver converged within tolerance */
  converged: boolean;
  /** Number of iterations actually performed */
  iterations: number;
  /** Final absolute finance-cost delta when solver exited (for diagnostics) */
  convergenceDelta: number;
}

function periodInterest(balance: number, rate: number, daysInPeriod: number, daysPerYear: number): number {
  if (balance <= 0 || rate <= 0 || daysInPeriod <= 0 || daysPerYear <= 0) return 0;
  return balance * rate * daysInPeriod / daysPerYear;
}

/**
 * Returns the line fee basis balance for a given facility configuration.
 *   - 'peak-drawn'         (default): peak drawn balance from the prior solver iteration
 *   - 'committed-limit':   the full committed/approved limit (conservative term-sheet convention)
 *   - 'undrawn-commitment': undrawn portion = max(0, limit − currentDrawn)
 */
function resolveLineFeeBase(
  facility: DebtFacility,
  committedLimit: number,
  currentDrawn: number,
  peakDrawnPrev: number,
): number {
  const basis = facility.lineFeeBasis ?? 'peak-drawn';
  if (basis === 'committed-limit') return committedLimit;
  if (basis === 'undrawn-commitment') return Math.max(0, committedLimit - currentDrawn);
  return peakDrawnPrev;
}

/**
 * Iterative debt solver.
 * The circular dependency: TDC includes finance costs, facility size depends on TDC via LTC,
 * facility size determines interest, interest is part of finance costs in TDC.
 */
export function solveFunding(
  periods: Period[],
  monthlyCostsExcFinance: number[],
  monthlyRevenue: number[],
  _monthlyGSTNet: number[],
  gstOnRevenue: number[],
  inputs: MainInputs,
  daysPerYear: number,
  tolerance: number,
  maxIterations = 50,
  equityDrawdownMode: 'equity-first' | 'pro-rata' = 'equity-first',
): FundingResult {
  const n = periods.length;

  let prevSeniorFinCosts = 0;
  let prevMezzFinCosts = 0;
  let prevSenior2FinCosts = 0;
  // Peak drawn balances from prior iteration — used as the line fee basis.
  // Converges to the actual peak debt for each facility.
  let prevPeakSnrBalance  = 0;
  let prevPeakSnr2Balance = 0;
  let prevPeakMezzBalance = 0;
  let result: FundingResult = createEmptyResult(n);
  let converged = false;
  let iterationsRun = 0;
  let finalDelta = Infinity;

  for (let iter = 0; iter < maxIterations; iter++) {
    iterationsRun = iter + 1;
    const tdc = sum(monthlyCostsExcFinance)
      + prevSeniorFinCosts + prevMezzFinCosts
      + prevSenior2FinCosts;

    result = runFundingWaterfall(
      periods, monthlyCostsExcFinance, monthlyRevenue, _monthlyGSTNet, gstOnRevenue,
      inputs, tdc, daysPerYear,
      prevPeakSnrBalance, prevPeakSnr2Balance, prevPeakMezzBalance,
      equityDrawdownMode,
    );

    const newSeniorFinCosts = result.totalSeniorInterest + result.totalSeniorFees
      + result.totalLandLoanInterest + result.totalLandLoanFees;
    const newMezzFinCosts = result.totalMezzInterest + result.totalMezzFees;
    const newSenior2FinCosts = result.totalSenior2Interest + result.totalSenior2Fees;

    const seniorDiff  = Math.abs(newSeniorFinCosts  - prevSeniorFinCosts);
    const mezzDiff    = Math.abs(newMezzFinCosts    - prevMezzFinCosts);
    const senior2Diff = Math.abs(newSenior2FinCosts - prevSenior2FinCosts);
    finalDelta = Math.max(seniorDiff, mezzDiff, senior2Diff);

    if (finalDelta < tolerance) {
      converged = true;
      break;
    }

    prevSeniorFinCosts  = newSeniorFinCosts;
    prevMezzFinCosts    = newMezzFinCosts;
    prevSenior2FinCosts = newSenior2FinCosts;
    prevPeakSnrBalance  = result.seniorFacilitySize;
    prevPeakSnr2Balance = result.senior2FacilitySize;
    prevPeakMezzBalance = result.mezzFacilitySize;
  }

  result.converged = converged;
  result.iterations = iterationsRun;
  result.convergenceDelta = finalDelta;

  if (!converged) {
    _fundingWarnings.push(
      `Debt solver did not converge within ${maxIterations} iterations — ` +
      `final delta $${Math.round(finalDelta).toLocaleString()} exceeds tolerance $${tolerance}. ` +
      `Finance costs and facility sizes may be inaccurate; increase maxIterations or tolerance.`
    );
  }

  // Apply financing actuals overlay (post-convergence, does not affect waterfall logic).
  applyFinancingActualsOverlay(result, periods, inputs);

  return result;
}

/**
 * Overlays user-entered financing actuals onto the model-calculated result arrays
 * for actual periods only. The waterfall balances and forecast periods are unchanged.
 */
function applyFinancingActualsOverlay(
  result: FundingResult,
  periods: Period[],
  inputs: MainInputs,
): void {
  const landLoan = inputs.landLoan ?? EMPTY_FACILITY;
  const senior   = inputs.seniorFacility  ?? EMPTY_FACILITY;
  const senior2  = inputs.seniorFacility2 ?? EMPTY_FACILITY;
  const mezz     = inputs.mezzanine       ?? EMPTY_FACILITY;

  let anyActuals = false;

  for (let i = 0; i < periods.length; i++) {
    if (!periods[i]?.isActual) continue;

    // Land loan
    const llD = landLoan.actualsDrawdown?.[i];  if (llD  != null) { result.landLoanDrawdowns[i]  = llD;  anyActuals = true; }
    const llR = landLoan.actualsRepayment?.[i]; if (llR != null) { result.landLoanRepayments[i] = llR;  anyActuals = true; }
    const llI = landLoan.actualsInterest?.[i];  if (llI != null) { result.landLoanInterest[i]   = llI;  anyActuals = true; }
    const llF = landLoan.actualsFees?.[i];      if (llF != null) { result.landLoanFees[i]       = llF;  anyActuals = true; }

    // Senior 1
    const s1D = senior.actualsDrawdown?.[i];  if (s1D != null) { result.seniorDrawdowns[i]  = s1D; anyActuals = true; }
    const s1R = senior.actualsRepayment?.[i]; if (s1R != null) { result.seniorRepayments[i] = s1R; anyActuals = true; }
    const s1I = senior.actualsInterest?.[i];  if (s1I != null) { result.seniorInterest[i]   = s1I; anyActuals = true; }
    const s1F = senior.actualsFees?.[i];      if (s1F != null) { result.seniorFees[i]       = s1F; anyActuals = true; }

    // Senior 2
    const s2D = senior2.actualsDrawdown?.[i];  if (s2D != null) { result.senior2Drawdowns[i]  = s2D; anyActuals = true; }
    const s2R = senior2.actualsRepayment?.[i]; if (s2R != null) { result.senior2Repayments[i] = s2R; anyActuals = true; }
    const s2I = senior2.actualsInterest?.[i];  if (s2I != null) { result.senior2Interest[i]   = s2I; anyActuals = true; }
    const s2F = senior2.actualsFees?.[i];      if (s2F != null) { result.senior2Fees[i]       = s2F; anyActuals = true; }

    // Mezzanine
    const mzD = mezz.actualsDrawdown?.[i];  if (mzD != null) { result.mezzDrawdowns[i]  = mzD; anyActuals = true; }
    const mzR = mezz.actualsRepayment?.[i]; if (mzR != null) { result.mezzRepayments[i] = mzR; anyActuals = true; }
    const mzI = mezz.actualsInterest?.[i];  if (mzI != null) { result.mezzInterest[i]   = mzI; anyActuals = true; }
    const mzF = mezz.actualsFees?.[i];      if (mzF != null) { result.mezzFees[i]       = mzF; anyActuals = true; }
  }

  // Recompute running totals from the overlaid arrays so dashboard figures reflect actuals.
  if (anyActuals) {
    result.totalLandLoanInterest = sum(result.landLoanInterest);
    result.totalLandLoanFees     = sum(result.landLoanFees);
    result.totalSeniorInterest   = sum(result.seniorInterest);
    result.totalSeniorFees       = sum(result.seniorFees);
    result.totalSenior2Interest  = sum(result.senior2Interest);
    result.totalSenior2Fees      = sum(result.senior2Fees);
    result.totalMezzInterest     = sum(result.mezzInterest);
    result.totalMezzFees         = sum(result.mezzFees);
  }
}

function runFundingWaterfall(
  periods: Period[],
  monthlyCostsExcFinance: number[],
  monthlyRevenue: number[],
  _monthlyGSTNet: number[],
  gstOnRevenue: number[],
  inputs: MainInputs,
  tdc: number,
  daysPerYear: number,
  peakSnrBalancePrev = 0,
  peakSnr2BalancePrev = 0,
  peakMezzBalancePrev = 0,
  equityDrawdownMode: 'equity-first' | 'pro-rata' = 'equity-first',
): FundingResult {
  const n = periods.length;
  const landLoan = inputs.landLoan        ?? EMPTY_FACILITY;
  const senior   = inputs.seniorFacility  ?? EMPTY_FACILITY;
  const senior2  = inputs.seniorFacility2 ?? EMPTY_FACILITY;
  const mezz     = inputs.mezzanine       ?? EMPTY_FACILITY;

  const drawdownSequence = computeDrawdownSequence(inputs);

  // ===== NRV for LVR =====
  const totalGRV = inputs.grvItems.reduce((s, g) => s + g.currentSalePrice, 0);
  const gstOnResidential = inputs.grvItems
    .filter(g => g.gstIncluded)
    .reduce((s, g) => s + g.currentSalePrice * inputs.landPurchase.gstRate / (1 + inputs.landPurchase.gstRate), 0);
  const backEndSelling = inputs.grvItems.reduce((s, g, idx) => {
    const sc = inputs.sellingCosts[idx];
    if (!sc) return s;
    return s + g.currentSalePrice * sc.salesCommission * (1 - sc.preCommissionPercent);
  }, 0);
  const frontEndSelling = inputs.grvItems.reduce((s, g, idx) => {
    const sc = inputs.sellingCosts[idx];
    if (!sc) return s;
    return s + g.currentSalePrice * sc.salesCommission * sc.preCommissionPercent;
  }, 0);
  const nrv = totalGRV - gstOnResidential - backEndSelling - frontEndSelling;

  // ===== Facility limits (LTC / LVR) =====
  const seniorLtcLimit  = senior.ltcTarget  > 0 ? tdc * senior.ltcTarget  : Infinity;
  const seniorLvrLimit  = senior.lvrTarget  > 0 ? nrv * senior.lvrTarget  : Infinity;
  const seniorLimit     = Math.min(senior.facilityLimit,  seniorLtcLimit,  seniorLvrLimit);

  const senior2LtcLimit = senior2.ltcTarget > 0 ? tdc * senior2.ltcTarget : Infinity;
  const senior2LvrLimit = senior2.lvrTarget > 0 ? nrv * senior2.lvrTarget : Infinity;
  const senior2Limit    = Math.min(senior2.facilityLimit, senior2LtcLimit, senior2LvrLimit);

  const mezzLtcLimit    = mezz.ltcTarget    > 0 ? tdc * mezz.ltcTarget    : Infinity;
  const mezzLvrLimit    = mezz.lvrTarget    > 0 ? nrv * mezz.lvrTarget    : Infinity;
  const mezzLimit       = Math.min(mezz.facilityLimit,    mezzLtcLimit,    mezzLvrLimit);

  // ===== Equity caps (per entity) =====
  const totalCostsExcFin  = sum(monthlyCostsExcFinance);
  const equityFixedDeveloper = inputs.equityDeveloper.fixedAmount;
  const equityPctDeveloper   = inputs.equityDeveloper.percentage;
  const developerCap = equityFixedDeveloper > 0 ? equityFixedDeveloper : totalCostsExcFin * equityPctDeveloper;

  const isJVActive = inputs.equityJV && (inputs.equityJV.fixedAmount > 0 || inputs.equityJV.equityContribution > 0);
  const equityFixedJV = inputs.equityJV?.fixedAmount ?? 0;
  const equityPctJV   = inputs.equityJV?.percentage  ?? 0;
  const jvCap = isJVActive ? (equityFixedJV > 0 ? equityFixedJV : totalCostsExcFin * equityPctJV) : 0;

  // Total cap (used for excess-equity repatriation at senior start)
  const totalEquityCap = developerCap + jvCap;

  // ===== Timeline flags =====
  const snrStartIdx  = senior.startMonth  > 0 ? senior.startMonth  - 1 : -1;
  const snr2StartIdx = senior2.startMonth > 0 ? senior2.startMonth - 1 : -1;
  const mezzStartIdx = mezz.startMonth    > 0 ? mezz.startMonth    - 1 : -1;

  // Maturity indices (0-indexed inclusive end). When maturityMonth is 0 or
  // not set, the facility runs to the end of the timeline.
  const snrEndIdx  = senior.maturityMonth  > 0 ? senior.maturityMonth  - 1 : n - 1;
  const snr2EndIdx = senior2.maturityMonth > 0 ? senior2.maturityMonth - 1 : n - 1;

  const hasSenior  = senior.facilityLimit  > 0 && snrStartIdx  >= 0;
  const hasSenior2 = senior2.facilityLimit > 0 && snr2StartIdx >= 0;
  const hasMezz    = mezz.facilityLimit    > 0 && mezzStartIdx >= 0;
  const llStartIdx = landLoan.startMonth   > 0 ? landLoan.startMonth - 1 : -1;

  // ===== Initialize arrays =====
  const llBalance    = new Array(n).fill(0);
  const llDrawdowns  = new Array(n).fill(0);
  const llRepayments = new Array(n).fill(0);
  const llInterest   = new Array(n).fill(0);
  const llFees       = new Array(n).fill(0);

  const snrBalance    = new Array(n).fill(0);
  const snrDrawdowns  = new Array(n).fill(0);
  const snrRepayments = new Array(n).fill(0);
  const snrInterest   = new Array(n).fill(0);
  const snrFees       = new Array(n).fill(0);

  const snr2Balance    = new Array(n).fill(0);
  const snr2Drawdowns  = new Array(n).fill(0);
  const snr2Repayments = new Array(n).fill(0);
  const snr2Interest   = new Array(n).fill(0);
  const snr2Fees       = new Array(n).fill(0);

  const mzBalance    = new Array(n).fill(0);
  const mzDrawdowns  = new Array(n).fill(0);
  const mzRepayments = new Array(n).fill(0);
  const mzInterest   = new Array(n).fill(0);
  const mzFees       = new Array(n).fill(0);

  const eqInjections    = new Array(n).fill(0);
  const eqRepatriations = new Array(n).fill(0);
  const profitDist      = new Array(n).fill(0);
  const jvInjections    = new Array(n).fill(0);
  const jvRepatriations = new Array(n).fill(0);
  const jvProfitDist    = new Array(n).fill(0);

  // Equity/profit distributions are gated: no distributions before equityDistStartMonth.
  // Surplus cash accumulates in the project bank account and carries forward.
  const eqDistStartIdx = (inputs.preliminary.equityDistStartMonth ?? 0) - 1;

  // ===== Running state =====
  let heldBankBalance     = 0; // surplus cash held when distributions are gated
  let llRunningBalance    = 0;
  let snrRunningBalance   = 0;
  let snr2RunningBalance  = 0;
  let mzRunningBalance    = 0;
  let llAccruedInterest   = 0;

  let cumulativeEquity    = 0;
  let jvCumulative        = 0;
  let totalEqRepatriated  = 0;
  let totalJVRepatriated  = 0;
  let totalMezzDrawn      = 0;

  let totalSeniorInterest  = 0;
  let totalSeniorFees      = 0;
  let totalSenior2Interest = 0;
  let totalSenior2Fees     = 0;
  let totalMezzInterest    = 0;
  let totalMezzFees        = 0;
  let totalLandInterest    = 0;
  let totalLandFees        = 0;
  let peakDebt             = 0;
  let peakSnrBalance       = 0;
  let peakSnr2Balance      = 0;
  let peakMezzBalance      = 0;
  let peakEquityDrawn      = 0;
  let peakEquityMonth      = 0;

  const snrAllInRate  = senior.margin  + senior.bbsy;
  const snr2AllInRate = senior2.margin + senior2.bbsy;
  const mezzAllInRate = mezz.margin    + mezz.bbsy;

  // ===== SINGLE PASS =====
  for (let i = 0; i < n; i++) {
    const days         = periods[i]?.daysInPeriod ?? 0;
    // seniorActive: facility is within its committed term → line fees charged + drawdowns allowed.
    // seniorDrawActive: drawdowns allowed beyond maturity (extension period) but no more line fees.
    const seniorActive      = hasSenior  && i >= snrStartIdx  && i <= snrEndIdx;
    const senior2Active     = hasSenior2 && i >= snr2StartIdx && i <= snr2EndIdx;
    const seniorDrawActive  = hasSenior  && i >= snrStartIdx;
    const senior2DrawActive = hasSenior2 && i >= snr2StartIdx;

    // ── 1. Opening balances ────────────────────────────────────────────────────
    const llOpenBalance   = llRunningBalance;
    const snrOpenBalance  = snrRunningBalance;
    const snr2OpenBalance = snr2RunningBalance;
    const mzOpenBalance   = mzRunningBalance;

    // Carry forward any surplus held from prior periods (distributions gated)
    let bankBalance = heldBankBalance;
    heldBankBalance = 0;

    // ── 2. Land loan lump-sum draw + establishment fee ─────────────────────────
    // Debt facility fees (establishment, line fees) are modelled as GST-free.
    // This assumes the lender is an exempt financial institution (GSTA s.40-60).
    // For non-bank facilities, verify whether fees are GST-inclusive in the term sheet.
    if (i === llStartIdx && landLoan.facilityLimit > 0) {
      // D2: A land loan drawn the same period as senior is repaid immediately
      // (step 4 below), so no interest accrues. That's correct for the modelled
      // sequence but typically reflects a misconfiguration: a land loan is
      // intended as a 3-6 month bridge before construction draws on senior.
      // Surface a warning so the user can reconcile their term-sheet timing.
      if (hasSenior && landLoan.startMonth >= (senior.startMonth ?? landLoan.startMonth + 1)) {
        _fundingWarnings.push(
          `Land Loan starts month ${landLoan.startMonth} but Senior starts month ${senior.startMonth} — land loan is repaid same period it is drawn, so no land-loan interest accrues. Confirm the bridge period (typical pattern: land-loan precedes senior by 3-6 months).`
        );
      }
      // R19 — Land-loan interest payment-frequency convention. Interest accrues
      // on the previous period's closing balance (llOpenBalance), so the
      // drawdown period itself never shows an interest charge — the open
      // balance is $0 at the start of the drawdown period. With monthly
      // payment frequency (=1), the first interest charge appears one period
      // after drawdown. With quarterly (=3), the first interest appears in
      // period drawdown+3 (the 3rd full period of accrual). This is the
      // accepted convention but visually confusing on the cashflow row, so
      // we surface an INFO note when the frequency > 1.
      if ((landLoan.interestPaymentFrequency ?? 1) > 1) {
        _fundingWarnings.push(
          `Land Loan interest payment frequency = ${landLoan.interestPaymentFrequency} months. Interest accrues monthly on the prior closing balance but is recognised in the cashflow only every ${landLoan.interestPaymentFrequency} periods (next charge: period ${landLoan.startMonth + landLoan.interestPaymentFrequency}). The drawdown period itself shows zero interest because the opening balance is zero.`
        );
      }
      llDrawdowns[i]     = landLoan.facilityLimit;
      llRunningBalance  += landLoan.facilityLimit;
      bankBalance       += landLoan.facilityLimit;
      const estFee = landLoan.facilityLimit * landLoan.establishmentFeePercent;
      if (estFee > 0) {
        llFees[i]      = estFee;
        totalLandFees += estFee;
        bankBalance   -= estFee;
      }
    }

    // ── 3. Land loan interest (accrued quarterly) ──────────────────────────────
    if (llOpenBalance > 0) {
      const accrued = periodInterest(llOpenBalance, landLoan.interestRate, days, daysPerYear);
      llAccruedInterest += accrued;

      const monthsSinceLLStart = i - llStartIdx;
      const freq = landLoan.interestPaymentFrequency > 0 ? landLoan.interestPaymentFrequency : 1;
      if ((monthsSinceLLStart + 1) % freq === 0) {
        llInterest[i]      = llAccruedInterest;
        totalLandInterest += llAccruedInterest;
        bankBalance       -= llAccruedInterest;
        llAccruedInterest  = 0;
      }
    }

    // ── 4. Land loan repayment at senior start (refinanced into senior) ────────
    if (hasSenior && i === snrStartIdx && llRunningBalance > 0) {
      if (llAccruedInterest > 0) {
        llInterest[i]     += llAccruedInterest;
        totalLandInterest += llAccruedInterest;
        bankBalance       -= llAccruedInterest;
        llAccruedInterest  = 0;
      }
      llRepayments[i]  = llRunningBalance;
      bankBalance     -= llRunningBalance;
      llRunningBalance = 0;
    }
    llBalance[i] = llRunningBalance;

    // ── 5. Operating costs ─────────────────────────────────────────────────────
    bankBalance -= monthlyCostsExcFinance[i] ?? 0;

    // ── 6. Interest & fees on all senior facilities and mezz ──────────────────

    // Senior 1
    if (snrOpenBalance > 0) {
      const snrInt = periodInterest(snrOpenBalance, snrAllInRate, days, daysPerYear);
      snrInterest[i]      = snrInt;
      totalSeniorInterest += snrInt;
      if (senior.isCapitalised) {
        snrRunningBalance += snrInt;
        snrDrawdowns[i]   += snrInt;
      } else {
        bankBalance -= snrInt;
      }
    }
    if (seniorActive) {
      let periodFees = 0;
      // Line fee basis: default 'peak-drawn' converges via the iterative solver.
      //   Some term sheets use 'committed-limit' (charge on approved facility size) or
      //   'undrawn-commitment' (charge only on the undrawn portion — commitment fee style).
      //   Configure via seniorFacility.lineFeeBasis. KEEP DEFAULT BEHAVIOR UNLESS
      //   TERM SHEET SPECIFIES OTHERWISE — see CLAUDE.md for methodology notes.
      const snrLineFeeBase = resolveLineFeeBase(senior, seniorLimit, snrRunningBalance, peakSnrBalancePrev);
      periodFees += periodInterest(snrLineFeeBase, senior.lineFeePercent, days, daysPerYear);
      if (i === snrStartIdx) {
        periodFees += seniorLimit * senior.establishmentFeePercent;
      }
      if (periodFees > 0) {
        snrFees[i]        = periodFees;
        totalSeniorFees  += periodFees;
        if (senior.isCapitalised) {
          snrRunningBalance += periodFees;
          snrDrawdowns[i]   += periodFees;
        } else {
          bankBalance -= periodFees;
        }
      }
    }

    // Senior 2
    if (snr2OpenBalance > 0) {
      const snr2Int = periodInterest(snr2OpenBalance, snr2AllInRate, days, daysPerYear);
      snr2Interest[i]      = snr2Int;
      totalSenior2Interest += snr2Int;
      if (senior2.isCapitalised) {
        snr2RunningBalance += snr2Int;
        snr2Drawdowns[i]   += snr2Int;
      } else {
        bankBalance -= snr2Int;
      }
    }
    if (senior2Active) {
      let periodFees = 0;
      const snr2LineFeeBase = resolveLineFeeBase(senior2, senior2Limit, snr2RunningBalance, peakSnr2BalancePrev);
      periodFees += periodInterest(snr2LineFeeBase, senior2.lineFeePercent, days, daysPerYear);
      if (i === snr2StartIdx) {
        periodFees += senior2Limit * senior2.establishmentFeePercent;
      }
      if (periodFees > 0) {
        snr2Fees[i]       = periodFees;
        totalSenior2Fees += periodFees;
        if (senior2.isCapitalised) {
          snr2RunningBalance += periodFees;
          snr2Drawdowns[i]   += periodFees;
        } else {
          bankBalance -= periodFees;
        }
      }
    }

    // Mezzanine interest
    if (mzOpenBalance > 0) {
      const mzInt = periodInterest(mzOpenBalance, mezzAllInRate, days, daysPerYear);
      mzInterest[i]      = mzInt;
      totalMezzInterest += mzInt;
      if (mezz.isCapitalised) {
        mzRunningBalance += mzInt;
        mzDrawdowns[i]   += mzInt;
        totalMezzDrawn   += mzInt; // capitalised interest increases effective drawn amount
      } else {
        bankBalance -= mzInt;
      }

      const mzLineFeeBase = resolveLineFeeBase(mezz, mezzLimit, mzRunningBalance, peakMezzBalancePrev);
      const mzLineFee = periodInterest(mzLineFeeBase, mezz.lineFeePercent, days, daysPerYear);
      if (mzLineFee > 0) {
        mzFees[i]       += mzLineFee;
        totalMezzFees   += mzLineFee;
        if (mezz.isCapitalised) {
          mzRunningBalance += mzLineFee;
          mzDrawdowns[i]   += mzLineFee;
          totalMezzDrawn   += mzLineFee; // capitalised fees also count toward limit
        } else {
          bankBalance -= mzLineFee;
        }
      }
    }
    if (hasMezz && i === mezzStartIdx) {
      const mzEstFee = mezzLimit * mezz.establishmentFeePercent;
      if (mzEstFee > 0) {
        mzFees[i]     += mzEstFee;
        totalMezzFees += mzEstFee;
        if (mezz.isCapitalised) {
          mzRunningBalance += mzEstFee;
          mzDrawdowns[i]   += mzEstFee;
        } else {
          bankBalance -= mzEstFee;
        }
      }
    }

    // ── 7. Senior 1 initialisation: land loan refi + excess equity repatriation ─
    if (hasSenior && i === snrStartIdx) {
      if (llRepayments[i] > 0) {
        snrDrawdowns[i]   += llRepayments[i];
        snrRunningBalance += llRepayments[i];
        bankBalance       += llRepayments[i];
      }
      if (cumulativeEquity > totalEquityCap) {
        const excess   = cumulativeEquity - totalEquityCap;
        const snrAvail = Math.max(0, seniorLimit - snrRunningBalance);
        const draw     = Math.min(excess, snrAvail);
        if (draw > 0) {
          snrDrawdowns[i]    += draw;
          snrRunningBalance  += draw;
          // Split repatriation pro-rata between JV and Developer
          const jvFrac = cumulativeEquity > 0 ? jvCumulative / cumulativeEquity : 0;
          const jvRep  = draw * jvFrac;
          jvRepatriations[i] += jvRep;
          eqRepatriations[i] += draw;
          jvCumulative       -= jvRep;
          cumulativeEquity   -= draw;
          totalJVRepatriated += jvRep;
          totalEqRepatriated += draw;
        }
      }
    }

    // ── 8. Revenue ────────────────────────────────────────────────────────────
    bankBalance += (monthlyRevenue[i] ?? 0) - (gstOnRevenue[i] ?? 0);

    // ── 9. Gap fill ────────────────────────────────────────────────────────────
    if (bankBalance < 0) {
      if (equityDrawdownMode === 'pro-rata' && seniorDrawActive) {
        // Pro-rata: split the gap proportionally between Developer equity and senior each period
        const gap = -bankBalance;
        const eqAvail  = Math.max(0, developerCap - (cumulativeEquity - jvCumulative));
        const snrAvail = Math.max(0, seniorLimit - snrRunningBalance);
        const totalAvail = eqAvail + snrAvail;
        if (totalAvail > 0) {
          const eqDraw  = Math.min(gap * (eqAvail  / totalAvail), eqAvail);
          const snrDraw = Math.min(gap * (snrAvail / totalAvail), snrAvail);
          if (eqDraw > 0) {
            eqInjections[i] += eqDraw;
            cumulativeEquity += eqDraw;
            bankBalance      += eqDraw;
          }
          if (snrDraw > 0) {
            snrDrawdowns[i]   += snrDraw;
            snrRunningBalance += snrDraw;
            bankBalance       += snrDraw;
          }
        }
        // JV equity and other facilities still fill in priority order after pro-rata
        for (const entry of drawdownSequence) {
          if (bankBalance >= 0) break;
          if (entry.type === 'equityJV' && isJVActive) {
            const avail = Math.max(0, jvCap - jvCumulative);
            if (avail > 0) {
              const draw = Math.min(-bankBalance, avail);
              jvInjections[i] += draw; eqInjections[i] += draw;
              jvCumulative += draw; cumulativeEquity += draw; bankBalance += draw;
            }
          }
        }
      } else {
        // Equity-first (default): draw in strict priority order
        for (const entry of drawdownSequence) {
          if (bankBalance >= 0) break;

          if (entry.type === 'senior' && seniorDrawActive) {
            const avail = Math.max(0, seniorLimit - snrRunningBalance);
            if (avail > 0) {
              const draw         = Math.min(-bankBalance, avail);
              snrDrawdowns[i]   += draw;
              snrRunningBalance += draw;
              bankBalance       += draw;
            }
          } else if (entry.type === 'senior2' && senior2DrawActive) {
            const avail = Math.max(0, senior2Limit - snr2RunningBalance);
            if (avail > 0) {
              const draw          = Math.min(-bankBalance, avail);
              snr2Drawdowns[i]   += draw;
              snr2RunningBalance += draw;
              bankBalance        += draw;
            }
          } else if (entry.type === 'mezz' && hasMezz && i >= mezzStartIdx) {
            const avail = Math.max(0, mezzLimit - totalMezzDrawn);
            if (avail > 0) {
              const draw         = Math.min(-bankBalance, avail);
              mzDrawdowns[i]    += draw;
              mzRunningBalance  += draw;
              totalMezzDrawn    += draw;
              bankBalance       += draw;
            }
          } else if (entry.type === 'equity') {
            const avail = Math.max(0, developerCap - (cumulativeEquity - jvCumulative));
            if (avail > 0) {
              const draw       = Math.min(-bankBalance, avail);
              eqInjections[i] += draw;
              cumulativeEquity += draw;
              bankBalance      += draw;
            }
          } else if (entry.type === 'equityJV' && isJVActive) {
            const avail = Math.max(0, jvCap - jvCumulative);
            if (avail > 0) {
              const draw         = Math.min(-bankBalance, avail);
              jvInjections[i]   += draw;
              eqInjections[i]   += draw;
              jvCumulative      += draw;
              cumulativeEquity  += draw;
              bankBalance       += draw;
            }
          }
        }
      }

      // Equity backstop — developer (Developer) is always the equity of last resort
      if (bankBalance < 0) {
        const backstop = -bankBalance;
        const developerUsed = cumulativeEquity - jvCumulative;
        const developerRemaining = Math.max(0, developerCap - developerUsed);
        if (backstop > developerRemaining + 1) {
          _fundingWarnings.push(
            `Period ${i + 1}: equity backstop $${Math.round(backstop).toLocaleString()} exceeds remaining Developer cap $${Math.round(developerRemaining).toLocaleString()} — project is underfunded`
          );
        }
        eqInjections[i] += backstop;
        cumulativeEquity += backstop;
        bankBalance       = 0;
      }
    }

    // ── 10. Revenue sweep: senior1 → senior2 → mezz → equity → profit ────────
    if (bankBalance > 0) {
      if (snrRunningBalance > 0) {
        const repay        = Math.min(bankBalance, snrRunningBalance);
        snrRepayments[i]   = repay;
        snrRunningBalance -= repay;
        bankBalance       -= repay;
      }
      if (bankBalance > 0 && snr2RunningBalance > 0) {
        const repay         = Math.min(bankBalance, snr2RunningBalance);
        snr2Repayments[i]   = repay;
        snr2RunningBalance -= repay;
        bankBalance        -= repay;
      }
      if (bankBalance > 0 && mzRunningBalance > 0) {
        const repay        = Math.min(bankBalance, mzRunningBalance);
        mzRepayments[i]    = repay;
        mzRunningBalance  -= repay;
        bankBalance       -= repay;
      }
      if (bankBalance > 0) {
        if (i < eqDistStartIdx && i < n - 1) {
          // Before the distribution window: hold surplus in the project account.
          // Exception: at the final period, release held balance regardless of window.
          heldBankBalance += bankBalance;
          bankBalance      = 0;
        } else {
          // Equity repatriation — pro-rata between JV and Developer based on outstanding
          const jvOutstanding     = Math.max(0, jvCumulative - totalJVRepatriated);
          const totalOutstanding  = Math.max(0, cumulativeEquity - totalEqRepatriated);
          if (totalOutstanding > 0) {
            const eqReturn  = Math.min(bankBalance, totalOutstanding);
            const jvFrac    = jvOutstanding / totalOutstanding;
            const jvRep     = eqReturn * jvFrac;
            jvRepatriations[i]  += jvRep;
            eqRepatriations[i]  += eqReturn;
            totalJVRepatriated  += jvRep;
            totalEqRepatriated  += eqReturn;
            bankBalance         -= eqReturn;
          }
          if (bankBalance > 0) {
            // Profit distribution — jvShr is stored as a decimal fraction (e.g. 0.15 = 15%).
            // Apply it directly; dev gets the remainder implicitly via profitDist - jvProfitDist.
            const jvShr    = inputs.equityJV?.profitShare ?? 0;
            const jvProfit = bankBalance * jvShr;
            jvProfitDist[i] += jvProfit;
            profitDist[i]   += bankBalance;
            bankBalance      = 0;
          }
        }
      }
    }

    // ── 11. Record closing balances ────────────────────────────────────────────
    snrBalance[i]   = Math.max(0, snrRunningBalance);
    snr2Balance[i]  = Math.max(0, snr2RunningBalance);
    mzBalance[i]    = Math.max(0, mzRunningBalance);

    // D1: Facility-cap overshoot. If capitalised interest has pushed a balance
    // above its committed limit, the model is implicitly relying on an
    // accordion the lender hasn't committed. Surface so the term sheet can be
    // restructured (or interest paid current rather than capitalised).
    if (mezzLimit > 0 && mzRunningBalance > mezzLimit + 1) {
      _fundingWarnings.push(
        `Period ${i + 1}: Mezz balance $${Math.round(mzRunningBalance).toLocaleString()} exceeds committed limit $${Math.round(mezzLimit).toLocaleString()} (capitalised interest pushed over cap). Restructure: pay mezz interest current, or increase the commitment.`
      );
    }
    if (seniorLimit > 0 && snrRunningBalance > seniorLimit + 1) {
      _fundingWarnings.push(
        `Period ${i + 1}: Senior #1 balance $${Math.round(snrRunningBalance).toLocaleString()} exceeds committed limit $${Math.round(seniorLimit).toLocaleString()}.`
      );
    }
    if (senior2Limit > 0 && snr2RunningBalance > senior2Limit + 1) {
      _fundingWarnings.push(
        `Period ${i + 1}: Senior #2 balance $${Math.round(snr2RunningBalance).toLocaleString()} exceeds committed limit $${Math.round(senior2Limit).toLocaleString()}.`
      );
    }

    peakDebt = Math.max(peakDebt,
      snrRunningBalance + snr2RunningBalance
      + llRunningBalance + mzRunningBalance);
    peakSnrBalance  = Math.max(peakSnrBalance,  snrRunningBalance);
    peakSnr2Balance = Math.max(peakSnr2Balance, snr2RunningBalance);
    peakMezzBalance = Math.max(peakMezzBalance, mzRunningBalance);

    // Peak equity outstanding (cumulative injections − repatriations at this period)
    const equityOutstanding = cumulativeEquity - totalEqRepatriated;
    if (equityOutstanding > peakEquityDrawn) {
      peakEquityDrawn = equityOutstanding;
      peakEquityMonth = i + 1;
    }
  }

  return {
    landLoanBalance: llBalance,
    landLoanDrawdowns: llDrawdowns,
    landLoanRepayments: llRepayments,
    landLoanInterest: llInterest,
    landLoanFees: llFees,

    seniorBalance: snrBalance,
    seniorDrawdowns: snrDrawdowns,
    seniorRepayments: snrRepayments,
    seniorInterest: snrInterest,
    seniorFees: snrFees,

    senior2Balance: snr2Balance,
    senior2Drawdowns: snr2Drawdowns,
    senior2Repayments: snr2Repayments,
    senior2Interest: snr2Interest,
    senior2Fees: snr2Fees,

    mezzBalance: mzBalance,
    mezzDrawdowns: mzDrawdowns,
    mezzRepayments: mzRepayments,
    mezzInterest: mzInterest,
    mezzFees: mzFees,

    equityInjections: eqInjections,
    equityRepatriations: eqRepatriations,
    profitDistributions: profitDist,
    equityJVInjections: jvInjections,
    equityJVRepatriations: jvRepatriations,
    jvProfitDistributions: jvProfitDist,

    totalSeniorInterest,
    totalSeniorFees,
    totalSenior2Interest,
    totalSenior2Fees,
    totalMezzInterest,
    totalMezzFees,
    totalLandLoanInterest: totalLandInterest,
    totalLandLoanFees: totalLandFees,
    totalEquityInjected: cumulativeEquity,
    totalJVEquityInjected: jvCumulative,
    peakDebt,
    peakEquity: peakEquityDrawn,
    peakEquityMonth,
    seniorFacilitySize:  peakSnrBalance,
    seniorFacilityLimit: hasSenior ? seniorLimit : 0,
    senior2FacilitySize: peakSnr2Balance,
    senior2FacilityLimit: hasSenior2 ? senior2Limit : 0,
    mezzFacilitySize: peakMezzBalance,
    // Populated in solveFunding():
    converged: false,
    iterations: 0,
    convergenceDelta: 0,
  };
}

function createEmptyResult(n: number): FundingResult {
  const z = () => new Array(n).fill(0);
  return {
    landLoanBalance: z(), landLoanDrawdowns: z(), landLoanRepayments: z(),
    landLoanInterest: z(), landLoanFees: z(),
    seniorBalance: z(), seniorDrawdowns: z(), seniorRepayments: z(),
    seniorInterest: z(), seniorFees: z(),
    senior2Balance: z(), senior2Drawdowns: z(), senior2Repayments: z(),
    senior2Interest: z(), senior2Fees: z(),
    mezzBalance: z(), mezzDrawdowns: z(), mezzRepayments: z(),
    mezzInterest: z(), mezzFees: z(),
    equityInjections: z(), equityRepatriations: z(), profitDistributions: z(),
    equityJVInjections: z(), equityJVRepatriations: z(), jvProfitDistributions: z(),
    totalSeniorInterest: 0, totalSeniorFees: 0,
    totalSenior2Interest: 0, totalSenior2Fees: 0,
    totalMezzInterest: 0, totalMezzFees: 0,
    totalLandLoanInterest: 0, totalLandLoanFees: 0,
    totalEquityInjected: 0, totalJVEquityInjected: 0,
    peakDebt: 0,
    peakEquity: 0, peakEquityMonth: 0,
    seniorFacilitySize: 0, seniorFacilityLimit: 0,
    senior2FacilitySize: 0, senior2FacilityLimit: 0,
    mezzFacilitySize: 0,
    converged: false, iterations: 0, convergenceDelta: Infinity,
  };
}
