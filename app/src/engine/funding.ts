import type { Period, MainInputs, DebtFacility } from '../types';
import { sum } from '../utils';

// Zero-value facility used as a safe fallback when an optional facility is missing
// (e.g. when loading a project saved before Senior Facility #2/#3 were added).
const EMPTY_FACILITY: DebtFacility = {
  name: '', facilityLimit: 0, startMonth: 0, maturityMonth: 0,
  interestRate: 0, bbsy: 0, margin: 0, establishmentFeePercent: 0,
  lineFeePercent: 0, interestPaymentFrequency: 0, isCapitalised: false,
  ltcTarget: 0, lvrTarget: 0, drawdownPriority: 99,
};

// ===== DRAWDOWN SEQUENCE =====

export type DrawdownFacilityType = 'equity' | 'senior' | 'senior2' | 'senior3' | 'mezz';

export interface DrawdownSequenceEntry {
  type: DrawdownFacilityType;
  name: string;
  priority: number;
}

/**
 * Returns the drawdown sequence for the main funding sources — senior debt (1/2/3),
 * mezzanine debt, and equity — sorted by their user-configured drawdownPriority
 * (1 = drawn first, higher = drawn later).
 *
 * The land loan is excluded because it is drawn as a fixed lump sum at a specific
 * date and is not part of the flexible gap-filling waterfall.
 */
export function computeDrawdownSequence(inputs: MainInputs): DrawdownSequenceEntry[] {
  const sf  = inputs.seniorFacility;
  const sf2 = inputs.seniorFacility2;
  const sf3 = inputs.seniorFacility3;
  const mz  = inputs.mezzanine;
  const eq  = inputs.equityKokoda;

  const entries: DrawdownSequenceEntry[] = [
    ...(sf  ? [{ type: 'senior'  as DrawdownFacilityType, name: sf.name,  priority: sf.drawdownPriority  ?? 1 }] : []),
    ...(sf2 ? [{ type: 'senior2' as DrawdownFacilityType, name: sf2.name, priority: sf2.drawdownPriority ?? 5 }] : []),
    ...(sf3 ? [{ type: 'senior3' as DrawdownFacilityType, name: sf3.name, priority: sf3.drawdownPriority ?? 6 }] : []),
    ...(mz  ? [{ type: 'mezz'   as DrawdownFacilityType, name: mz.name,  priority: mz.drawdownPriority  ?? 2 }] : []),
    ...(eq  ? [{ type: 'equity' as DrawdownFacilityType, name: eq.name,  priority: eq.drawdownPriority  ?? 3 }] : []),
  ];
  return entries.sort((a, b) => a.priority - b.priority);
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

  senior3Balance: number[];
  senior3Drawdowns: number[];
  senior3Repayments: number[];
  senior3Interest: number[];
  senior3Fees: number[];

  mezzBalance: number[];
  mezzDrawdowns: number[];
  mezzRepayments: number[];
  mezzInterest: number[];
  mezzFees: number[];

  equityInjections: number[];
  equityRepatriations: number[];
  profitDistributions: number[];

  // Totals
  totalSeniorInterest: number;
  totalSeniorFees: number;
  totalSenior2Interest: number;
  totalSenior2Fees: number;
  totalSenior3Interest: number;
  totalSenior3Fees: number;
  totalMezzInterest: number;
  totalMezzFees: number;
  totalLandLoanInterest: number;
  totalLandLoanFees: number;
  totalEquityInjected: number;
  peakDebt: number;
  seniorFacilitySize: number;
  seniorFacilityLimit: number;
  senior2FacilitySize: number;
  senior2FacilityLimit: number;
  senior3FacilitySize: number;
  senior3FacilityLimit: number;
  mezzFacilitySize: number;
}

function periodInterest(balance: number, rate: number, daysInPeriod: number, daysPerYear: number): number {
  if (balance <= 0 || rate <= 0) return 0;
  return balance * rate * daysInPeriod / daysPerYear;
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
): FundingResult {
  const n = periods.length;

  let prevSeniorFinCosts = 0;
  let prevMezzFinCosts = 0;
  let prevSenior2FinCosts = 0;
  let prevSenior3FinCosts = 0;
  let result: FundingResult = createEmptyResult(n);

  for (let iter = 0; iter < maxIterations; iter++) {
    const tdc = sum(monthlyCostsExcFinance)
      + prevSeniorFinCosts + prevMezzFinCosts
      + prevSenior2FinCosts + prevSenior3FinCosts;

    result = runFundingWaterfall(
      periods, monthlyCostsExcFinance, monthlyRevenue, _monthlyGSTNet, gstOnRevenue,
      inputs, tdc, daysPerYear,
    );

    const newSeniorFinCosts = result.totalSeniorInterest + result.totalSeniorFees
      + result.totalLandLoanInterest + result.totalLandLoanFees;
    const newMezzFinCosts = result.totalMezzInterest + result.totalMezzFees;
    const newSenior2FinCosts = result.totalSenior2Interest + result.totalSenior2Fees;
    const newSenior3FinCosts = result.totalSenior3Interest + result.totalSenior3Fees;

    const seniorDiff  = Math.abs(newSeniorFinCosts  - prevSeniorFinCosts);
    const mezzDiff    = Math.abs(newMezzFinCosts    - prevMezzFinCosts);
    const senior2Diff = Math.abs(newSenior2FinCosts - prevSenior2FinCosts);
    const senior3Diff = Math.abs(newSenior3FinCosts - prevSenior3FinCosts);

    if (seniorDiff < tolerance && mezzDiff < tolerance
        && senior2Diff < tolerance && senior3Diff < tolerance) {
      break;
    }

    prevSeniorFinCosts  = newSeniorFinCosts;
    prevMezzFinCosts    = newMezzFinCosts;
    prevSenior2FinCosts = newSenior2FinCosts;
    prevSenior3FinCosts = newSenior3FinCosts;
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
  const senior3  = inputs.seniorFacility3 ?? EMPTY_FACILITY;
  const mezz     = inputs.mezzanine       ?? EMPTY_FACILITY;

  let anyActuals = false;

  for (let i = 0; i < periods.length; i++) {
    if (!periods[i].isActual) continue;

    // Land loan
    if (landLoan.actualsDrawdown?.[i]  != null) { result.landLoanDrawdowns[i]  = landLoan.actualsDrawdown[i];  anyActuals = true; }
    if (landLoan.actualsRepayment?.[i] != null) { result.landLoanRepayments[i] = landLoan.actualsRepayment[i]; anyActuals = true; }
    if (landLoan.actualsInterest?.[i]  != null) { result.landLoanInterest[i]   = landLoan.actualsInterest[i];  anyActuals = true; }
    if (landLoan.actualsFees?.[i]      != null) { result.landLoanFees[i]       = landLoan.actualsFees[i];      anyActuals = true; }

    // Senior 1
    if (senior.actualsDrawdown?.[i]  != null) { result.seniorDrawdowns[i]  = senior.actualsDrawdown[i];  anyActuals = true; }
    if (senior.actualsRepayment?.[i] != null) { result.seniorRepayments[i] = senior.actualsRepayment[i]; anyActuals = true; }
    if (senior.actualsInterest?.[i]  != null) { result.seniorInterest[i]   = senior.actualsInterest[i];  anyActuals = true; }
    if (senior.actualsFees?.[i]      != null) { result.seniorFees[i]       = senior.actualsFees[i];      anyActuals = true; }

    // Senior 2
    if (senior2.actualsDrawdown?.[i]  != null) { result.senior2Drawdowns[i]  = senior2.actualsDrawdown[i];  anyActuals = true; }
    if (senior2.actualsRepayment?.[i] != null) { result.senior2Repayments[i] = senior2.actualsRepayment[i]; anyActuals = true; }
    if (senior2.actualsInterest?.[i]  != null) { result.senior2Interest[i]   = senior2.actualsInterest[i];  anyActuals = true; }
    if (senior2.actualsFees?.[i]      != null) { result.senior2Fees[i]       = senior2.actualsFees[i];      anyActuals = true; }

    // Senior 3
    if (senior3.actualsDrawdown?.[i]  != null) { result.senior3Drawdowns[i]  = senior3.actualsDrawdown[i];  anyActuals = true; }
    if (senior3.actualsRepayment?.[i] != null) { result.senior3Repayments[i] = senior3.actualsRepayment[i]; anyActuals = true; }
    if (senior3.actualsInterest?.[i]  != null) { result.senior3Interest[i]   = senior3.actualsInterest[i];  anyActuals = true; }
    if (senior3.actualsFees?.[i]      != null) { result.senior3Fees[i]       = senior3.actualsFees[i];      anyActuals = true; }

    // Mezzanine
    if (mezz.actualsDrawdown?.[i]  != null) { result.mezzDrawdowns[i]  = mezz.actualsDrawdown[i];  anyActuals = true; }
    if (mezz.actualsRepayment?.[i] != null) { result.mezzRepayments[i] = mezz.actualsRepayment[i]; anyActuals = true; }
    if (mezz.actualsInterest?.[i]  != null) { result.mezzInterest[i]   = mezz.actualsInterest[i];  anyActuals = true; }
    if (mezz.actualsFees?.[i]      != null) { result.mezzFees[i]       = mezz.actualsFees[i];      anyActuals = true; }
  }

  // Recompute running totals from the overlaid arrays so dashboard figures reflect actuals.
  if (anyActuals) {
    result.totalLandLoanInterest = sum(result.landLoanInterest);
    result.totalLandLoanFees     = sum(result.landLoanFees);
    result.totalSeniorInterest   = sum(result.seniorInterest);
    result.totalSeniorFees       = sum(result.seniorFees);
    result.totalSenior2Interest  = sum(result.senior2Interest);
    result.totalSenior2Fees      = sum(result.senior2Fees);
    result.totalSenior3Interest  = sum(result.senior3Interest);
    result.totalSenior3Fees      = sum(result.senior3Fees);
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
): FundingResult {
  const n = periods.length;
  const landLoan = inputs.landLoan  ?? EMPTY_FACILITY;
  const senior   = inputs.seniorFacility  ?? EMPTY_FACILITY;
  const senior2  = inputs.seniorFacility2 ?? EMPTY_FACILITY;
  const senior3  = inputs.seniorFacility3 ?? EMPTY_FACILITY;
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
  const nrv = totalGRV - gstOnResidential - backEndSelling;

  // ===== Facility limits (LTC / LVR) =====
  const seniorLtcLimit  = senior.ltcTarget  > 0 ? tdc * senior.ltcTarget  : Infinity;
  const seniorLvrLimit  = senior.lvrTarget  > 0 ? nrv * senior.lvrTarget  : Infinity;
  const seniorLimit     = Math.min(senior.facilityLimit,  seniorLtcLimit,  seniorLvrLimit);

  const senior2LtcLimit = senior2.ltcTarget > 0 ? tdc * senior2.ltcTarget : Infinity;
  const senior2LvrLimit = senior2.lvrTarget > 0 ? nrv * senior2.lvrTarget : Infinity;
  const senior2Limit    = Math.min(senior2.facilityLimit, senior2LtcLimit, senior2LvrLimit);

  const senior3LtcLimit = senior3.ltcTarget > 0 ? tdc * senior3.ltcTarget : Infinity;
  const senior3LvrLimit = senior3.lvrTarget > 0 ? nrv * senior3.lvrTarget : Infinity;
  const senior3Limit    = Math.min(senior3.facilityLimit, senior3LtcLimit, senior3LvrLimit);

  const mezzLtcLimit    = mezz.ltcTarget    > 0 ? tdc * mezz.ltcTarget    : Infinity;
  const mezzLvrLimit    = mezz.lvrTarget    > 0 ? nrv * mezz.lvrTarget    : Infinity;
  const mezzLimit       = Math.min(mezz.facilityLimit,    mezzLtcLimit,    mezzLvrLimit);

  // ===== Equity cap =====
  const equityFixedKokoda = inputs.equityKokoda.fixedAmount;
  const equityFixedJV     = inputs.equityJV.fixedAmount;
  const equityPctKokoda   = inputs.equityKokoda.percentage;
  const totalCostsExcFin  = sum(monthlyCostsExcFinance);
  const equityFromPct     = totalCostsExcFin * equityPctKokoda;
  const equityCap = (equityFixedKokoda + equityFixedJV) > 0
    ? (equityFixedKokoda + equityFixedJV)
    : equityFromPct;

  // ===== Timeline flags =====
  const snrStartIdx  = senior.startMonth  > 0 ? senior.startMonth  - 1 : -1;
  const snr2StartIdx = senior2.startMonth > 0 ? senior2.startMonth - 1 : -1;
  const snr3StartIdx = senior3.startMonth > 0 ? senior3.startMonth - 1 : -1;
  const mezzStartIdx = mezz.startMonth    > 0 ? mezz.startMonth    - 1 : -1;

  // Maturity indices (0-indexed inclusive end). When maturityMonth is 0 or
  // not set, the facility runs to the end of the timeline.
  const snrEndIdx  = senior.maturityMonth  > 0 ? senior.maturityMonth  - 1 : n - 1;
  const snr2EndIdx = senior2.maturityMonth > 0 ? senior2.maturityMonth - 1 : n - 1;
  const snr3EndIdx = senior3.maturityMonth > 0 ? senior3.maturityMonth - 1 : n - 1;

  const hasSenior  = senior.facilityLimit  > 0 && snrStartIdx  >= 0;
  const hasSenior2 = senior2.facilityLimit > 0 && snr2StartIdx >= 0;
  const hasSenior3 = senior3.facilityLimit > 0 && snr3StartIdx >= 0;
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

  const snr3Balance    = new Array(n).fill(0);
  const snr3Drawdowns  = new Array(n).fill(0);
  const snr3Repayments = new Array(n).fill(0);
  const snr3Interest   = new Array(n).fill(0);
  const snr3Fees       = new Array(n).fill(0);

  const mzBalance    = new Array(n).fill(0);
  const mzDrawdowns  = new Array(n).fill(0);
  const mzRepayments = new Array(n).fill(0);
  const mzInterest   = new Array(n).fill(0);
  const mzFees       = new Array(n).fill(0);

  const eqInjections  = new Array(n).fill(0);
  const eqRepatriations = new Array(n).fill(0);
  const profitDist    = new Array(n).fill(0);

  // ===== Running state =====
  let llRunningBalance   = 0;
  let snrRunningBalance  = 0;
  let snr2RunningBalance = 0;
  let snr3RunningBalance = 0;
  let mzRunningBalance   = 0;
  let llAccruedInterest  = 0;

  let cumulativeEquity  = 0;
  let totalEqRepatriated = 0;
  let totalMezzDrawn    = 0;

  let totalSeniorInterest  = 0;
  let totalSeniorFees      = 0;
  let totalSenior2Interest = 0;
  let totalSenior2Fees     = 0;
  let totalSenior3Interest = 0;
  let totalSenior3Fees     = 0;
  let totalMezzInterest    = 0;
  let totalMezzFees        = 0;
  let totalLandInterest    = 0;
  let totalLandFees        = 0;
  let peakDebt             = 0;
  let peakSnrBalance       = 0;
  let peakSnr2Balance      = 0;
  let peakSnr3Balance      = 0;

  const snrAllInRate  = senior.margin  + senior.bbsy;
  const snr2AllInRate = senior2.margin + senior2.bbsy;
  const snr3AllInRate = senior3.margin + senior3.bbsy;
  const mezzAllInRate = mezz.margin    + mezz.bbsy;

  // ===== SINGLE PASS =====
  for (let i = 0; i < n; i++) {
    const days         = periods[i].daysInPeriod;
    // seniorActive: facility is within its committed term → line fees charged + drawdowns allowed.
    // seniorDrawActive: drawdowns allowed beyond maturity (extension period) but no more line fees.
    const seniorActive      = hasSenior  && i >= snrStartIdx  && i <= snrEndIdx;
    const senior2Active     = hasSenior2 && i >= snr2StartIdx && i <= snr2EndIdx;
    const senior3Active     = hasSenior3 && i >= snr3StartIdx && i <= snr3EndIdx;
    const seniorDrawActive  = hasSenior  && i >= snrStartIdx;
    const senior2DrawActive = hasSenior2 && i >= snr2StartIdx;
    const senior3DrawActive = hasSenior3 && i >= snr3StartIdx;

    // ── 1. Opening balances ────────────────────────────────────────────────────
    const llOpenBalance   = llRunningBalance;
    const snrOpenBalance  = snrRunningBalance;
    const snr2OpenBalance = snr2RunningBalance;
    const snr3OpenBalance = snr3RunningBalance;
    const mzOpenBalance   = mzRunningBalance;

    let bankBalance = 0;

    // ── 2. Land loan lump-sum draw + establishment fee ─────────────────────────
    if (i === llStartIdx && landLoan.facilityLimit > 0) {
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
    bankBalance -= monthlyCostsExcFinance[i];

    // ── 6. Interest & fees on all senior facilities and mezz ──────────────────

    // Senior 1
    if (snrOpenBalance > 0) {
      const snrInt = periodInterest(snrOpenBalance, snrAllInRate, days, daysPerYear);
      snrInterest[i]      = snrInt;
      totalSeniorInterest += snrInt;
      if (senior.isCapitalised) {
        snrRunningBalance += snrInt;
      } else {
        bankBalance -= snrInt;
      }
    }
    if (seniorActive) {
      let periodFees = 0;
      // Line fee charged on committed-but-undrawn balance (Excel: non-utilisation fee).
      // Undrawn = facilityLimit − opening drawn balance (before this period's draws).
      const snrUndrawn = Math.max(0, seniorLimit - snrOpenBalance);
      periodFees += periodInterest(snrUndrawn, senior.lineFeePercent, days, daysPerYear);
      if (i === snrStartIdx) {
        periodFees += seniorLimit * senior.establishmentFeePercent;
      }
      if (periodFees > 0) {
        snrFees[i]        = periodFees;
        totalSeniorFees  += periodFees;
        if (senior.isCapitalised) {
          snrRunningBalance += periodFees;
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
      } else {
        bankBalance -= snr2Int;
      }
    }
    if (senior2Active) {
      let periodFees = 0;
      const snr2Undrawn = Math.max(0, senior2Limit - snr2OpenBalance);
      periodFees += periodInterest(snr2Undrawn, senior2.lineFeePercent, days, daysPerYear);
      if (i === snr2StartIdx) {
        periodFees += senior2Limit * senior2.establishmentFeePercent;
      }
      if (periodFees > 0) {
        snr2Fees[i]       = periodFees;
        totalSenior2Fees += periodFees;
        if (senior2.isCapitalised) {
          snr2RunningBalance += periodFees;
        } else {
          bankBalance -= periodFees;
        }
      }
    }

    // Senior 3
    if (snr3OpenBalance > 0) {
      const snr3Int = periodInterest(snr3OpenBalance, snr3AllInRate, days, daysPerYear);
      snr3Interest[i]      = snr3Int;
      totalSenior3Interest += snr3Int;
      if (senior3.isCapitalised) {
        snr3RunningBalance += snr3Int;
      } else {
        bankBalance -= snr3Int;
      }
    }
    if (senior3Active) {
      let periodFees = 0;
      const snr3Undrawn = Math.max(0, senior3Limit - snr3OpenBalance);
      periodFees += periodInterest(snr3Undrawn, senior3.lineFeePercent, days, daysPerYear);
      if (i === snr3StartIdx) {
        periodFees += senior3Limit * senior3.establishmentFeePercent;
      }
      if (periodFees > 0) {
        snr3Fees[i]       = periodFees;
        totalSenior3Fees += periodFees;
        if (senior3.isCapitalised) {
          snr3RunningBalance += periodFees;
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
      } else {
        bankBalance -= mzInt;
      }

      const mzLineFee = periodInterest(mezzLimit, mezz.lineFeePercent, days, daysPerYear);
      if (mzLineFee > 0) {
        mzFees[i]       += mzLineFee;
        totalMezzFees   += mzLineFee;
        if (mezz.isCapitalised) {
          mzRunningBalance += mzLineFee;
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
      if (cumulativeEquity > equityCap) {
        const excess   = cumulativeEquity - equityCap;
        const snrAvail = Math.max(0, seniorLimit - snrRunningBalance);
        const draw     = Math.min(excess, snrAvail);
        if (draw > 0) {
          snrDrawdowns[i]    += draw;
          snrRunningBalance  += draw;
          eqRepatriations[i] += draw;
          cumulativeEquity   -= draw;
        }
      }
    }

    // ── 8. Revenue ────────────────────────────────────────────────────────────
    bankBalance += monthlyRevenue[i] - gstOnRevenue[i];

    // ── 9. Gap fill ────────────────────────────────────────────────────────────
    if (bankBalance < 0) {
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
        } else if (entry.type === 'senior3' && senior3DrawActive) {
          const avail = Math.max(0, senior3Limit - snr3RunningBalance);
          if (avail > 0) {
            const draw          = Math.min(-bankBalance, avail);
            snr3Drawdowns[i]   += draw;
            snr3RunningBalance += draw;
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
          const avail = Math.max(0, equityCap - cumulativeEquity);
          if (avail > 0) {
            const draw       = Math.min(-bankBalance, avail);
            eqInjections[i] += draw;
            cumulativeEquity += draw;
            bankBalance      += draw;
          }
        }
      }

      // Equity backstop
      if (bankBalance < 0) {
        const backstop   = -bankBalance;
        eqInjections[i] += backstop;
        cumulativeEquity += backstop;
        bankBalance       = 0;
      }
    }

    // ── 10. Revenue sweep: senior1 → senior2 → senior3 → mezz → equity → profit ─
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
      if (bankBalance > 0 && snr3RunningBalance > 0) {
        const repay         = Math.min(bankBalance, snr3RunningBalance);
        snr3Repayments[i]   = repay;
        snr3RunningBalance -= repay;
        bankBalance        -= repay;
      }
      if (bankBalance > 0 && mzRunningBalance > 0) {
        const repay        = Math.min(bankBalance, mzRunningBalance);
        mzRepayments[i]    = repay;
        mzRunningBalance  -= repay;
        bankBalance       -= repay;
      }
      if (bankBalance > 0) {
        const equityLeft = cumulativeEquity - totalEqRepatriated;
        if (equityLeft > 0) {
          const eqReturn     = Math.min(bankBalance, equityLeft);
          eqRepatriations[i] += eqReturn;
          totalEqRepatriated += eqReturn;
          bankBalance        -= eqReturn;
        }
        if (bankBalance > 0) {
          profitDist[i] = bankBalance;
          bankBalance   = 0;
        }
      }
    }

    // ── 11. Record closing balances ────────────────────────────────────────────
    snrBalance[i]  = Math.max(0, snrRunningBalance);
    snr2Balance[i] = Math.max(0, snr2RunningBalance);
    snr3Balance[i] = Math.max(0, snr3RunningBalance);
    mzBalance[i]   = Math.max(0, mzRunningBalance);

    peakDebt = Math.max(peakDebt,
      snrRunningBalance + snr2RunningBalance + snr3RunningBalance
      + llRunningBalance + mzRunningBalance);
    peakSnrBalance  = Math.max(peakSnrBalance,  snrRunningBalance);
    peakSnr2Balance = Math.max(peakSnr2Balance, snr2RunningBalance);
    peakSnr3Balance = Math.max(peakSnr3Balance, snr3RunningBalance);
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

    senior3Balance: snr3Balance,
    senior3Drawdowns: snr3Drawdowns,
    senior3Repayments: snr3Repayments,
    senior3Interest: snr3Interest,
    senior3Fees: snr3Fees,

    mezzBalance: mzBalance,
    mezzDrawdowns: mzDrawdowns,
    mezzRepayments: mzRepayments,
    mezzInterest: mzInterest,
    mezzFees: mzFees,

    equityInjections: eqInjections,
    equityRepatriations: eqRepatriations,
    profitDistributions: profitDist,

    totalSeniorInterest,
    totalSeniorFees,
    totalSenior2Interest,
    totalSenior2Fees,
    totalSenior3Interest,
    totalSenior3Fees,
    totalMezzInterest,
    totalMezzFees,
    totalLandLoanInterest: totalLandInterest,
    totalLandLoanFees: totalLandFees,
    totalEquityInjected: cumulativeEquity,
    peakDebt,
    seniorFacilitySize:  peakSnrBalance,
    seniorFacilityLimit: hasSenior ? seniorLimit : 0,
    senior2FacilitySize: peakSnr2Balance,
    senior2FacilityLimit: hasSenior2 ? senior2Limit : 0,
    senior3FacilitySize: peakSnr3Balance,
    senior3FacilityLimit: hasSenior3 ? senior3Limit : 0,
    mezzFacilitySize: hasMezz ? mezzLimit : 0,
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
    senior3Balance: z(), senior3Drawdowns: z(), senior3Repayments: z(),
    senior3Interest: z(), senior3Fees: z(),
    mezzBalance: z(), mezzDrawdowns: z(), mezzRepayments: z(),
    mezzInterest: z(), mezzFees: z(),
    equityInjections: z(), equityRepatriations: z(), profitDistributions: z(),
    totalSeniorInterest: 0, totalSeniorFees: 0,
    totalSenior2Interest: 0, totalSenior2Fees: 0,
    totalSenior3Interest: 0, totalSenior3Fees: 0,
    totalMezzInterest: 0, totalMezzFees: 0,
    totalLandLoanInterest: 0, totalLandLoanFees: 0,
    totalEquityInjected: 0, peakDebt: 0,
    seniorFacilitySize: 0, seniorFacilityLimit: 0,
    senior2FacilitySize: 0, senior2FacilityLimit: 0,
    senior3FacilitySize: 0, senior3FacilityLimit: 0,
    mezzFacilitySize: 0,
  };
}
