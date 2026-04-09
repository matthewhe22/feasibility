import type { Period, MainInputs } from '../types';
import { sum } from '../utils';

interface FundingResult {
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
  totalMezzInterest: number;
  totalMezzFees: number;
  totalLandLoanInterest: number;
  totalLandLoanFees: number;
  totalEquityInjected: number;
  peakDebt: number;
  seniorFacilitySize: number;
  mezzFacilitySize: number;
}

// Calculate interest for a period on a facility balance
function periodInterest(balance: number, rate: number, daysInPeriod: number, daysPerYear: number): number {
  if (balance <= 0 || rate <= 0) return 0;
  return balance * rate * daysInPeriod / daysPerYear;
}

/**
 * Core debt solving function with iterative convergence.
 *
 * The circular dependency: facility size depends on total costs,
 * total costs include interest, interest depends on facility size.
 *
 * We iterate until the facility size converges within tolerance.
 */
export function solveFunding(
  periods: Period[],
  monthlyCostsExcFinance: number[], // All costs except financing
  monthlyRevenue: number[], // All revenue (settlements)
  _monthlyGSTNet: number[], // Net GST movement
  inputs: MainInputs,
  daysPerYear: number,
  tolerance: number,
  maxIterations = 50,
): FundingResult {
  const n = periods.length;

  // Facility configs
  const senior = inputs.seniorFacility;
  const mezz = inputs.mezzanine;

  // Initial estimate of facility sizes

  // Initial estimate of facility sizes (without interest)
  let prevSeniorSize = senior.facilityLimit;
  let prevMezzSize = mezz.facilityLimit;

  let result: FundingResult = createEmptyResult(n);

  for (let iter = 0; iter < maxIterations; iter++) {
    result = runFundingWaterfall(
      periods, monthlyCostsExcFinance, monthlyRevenue, _monthlyGSTNet,
      inputs, prevSeniorSize, prevMezzSize, daysPerYear,
    );

    // Check convergence
    const seniorDiff = Math.abs(result.seniorFacilitySize - prevSeniorSize);
    const mezzDiff = Math.abs(result.mezzFacilitySize - prevMezzSize);

    if (seniorDiff < tolerance && mezzDiff < tolerance) {
      break;
    }

    prevSeniorSize = result.seniorFacilitySize;
    prevMezzSize = result.mezzFacilitySize;
  }

  return result;
}

function runFundingWaterfall(
  periods: Period[],
  monthlyCostsExcFinance: number[],
  monthlyRevenue: number[],
  _monthlyGSTNet: number[],
  inputs: MainInputs,
  seniorFacilitySize: number,
  _mezzFacilitySize: number,
  daysPerYear: number,
): FundingResult {
  const n = periods.length;
  const landLoan = inputs.landLoan;
  const senior = inputs.seniorFacility;

  // Initialize arrays
  const llBalance = new Array(n).fill(0);
  const llDrawdowns = new Array(n).fill(0);
  const llRepayments = new Array(n).fill(0);
  const llInterest = new Array(n).fill(0);
  const llFees = new Array(n).fill(0);

  const snrBalance = new Array(n).fill(0);
  const snrDrawdowns = new Array(n).fill(0);
  const snrRepayments = new Array(n).fill(0);
  const snrInterest = new Array(n).fill(0);
  const snrFees = new Array(n).fill(0);

  const mzBalance = new Array(n).fill(0);
  const mzDrawdowns = new Array(n).fill(0);
  const mzRepayments = new Array(n).fill(0);
  const mzInterest = new Array(n).fill(0);
  const mzFees = new Array(n).fill(0);

  const eqInjections = new Array(n).fill(0);
  const eqRepatriations = new Array(n).fill(0);
  const profitDist = new Array(n).fill(0);

  // Equity config
  const equityFixedAmount = inputs.equityKokoda.fixedAmount + inputs.equityJV.fixedAmount;

  // Total NRV for LVR calc
  const totalGRV = inputs.grvItems.reduce((s, g) => s + g.currentSalePrice, 0);
  const gstOnResidential = inputs.grvItems
    .filter(g => g.gstIncluded)
    .reduce((s, g) => s + g.currentSalePrice * inputs.landPurchase.gstRate / (1 + inputs.landPurchase.gstRate), 0);
  const backEndSelling = inputs.grvItems.reduce((s, g, i) => {
    const sc = inputs.sellingCosts[i];
    if (!sc) return s;
    return s + g.currentSalePrice * sc.salesCommission * (1 - sc.preCommissionPercent);
  }, 0);
  const nrv = totalGRV - gstOnResidential - backEndSelling;

  // Total development costs (for LTC)
  const totalDevCosts = sum(monthlyCostsExcFinance);

  // Determine equity cap: min of fixed amount and percentage-based
  const equityFromPct = totalDevCosts * inputs.equityKokoda.percentage;
  const equityCap = equityFixedAmount > 0 ? equityFixedAmount : equityFromPct;

  // Calculate senior facility limit from LTC/LVR constraints
  const ltcLimit = totalDevCosts * senior.ltcTarget;
  const lvrLimit = nrv * senior.lvrTarget;
  const seniorLimit = Math.min(seniorFacilitySize, ltcLimit, lvrLimit);

  // Land loan
  const llStartIdx = landLoan.startMonth - 1;
  const llAmount = landLoan.facilityLimit;
  let llRunningBalance = 0;
  const llEstFee = llAmount * landLoan.establishmentFeePercent;

  // Senior
  const snrStartIdx = senior.startMonth - 1;
  const snrAllInRate = senior.margin + senior.bbsy;
  const snrEstFee = seniorLimit * senior.establishmentFeePercent;
  let snrRunningBalance = 0;
  let totalSnrDrawn = 0;

  // Track cumulative funding need
  let cumulativeCostNeed = 0;
  let cumulativeRevenue = 0;
  let cumulativeEquity = 0;
  let cumulativeSenior = 0;
  let cumulativeLandLoan = 0;
  let peakDebt = 0;
  let totalSeniorInterest = 0;
  let totalSeniorFees = 0;
  let totalLandInterest = 0;
  let totalLandFees = 0;
  let seniorRepaid = false;

  // Phase 1: Forward pass - drawdowns and interest
  for (let i = 0; i < n; i++) {
    const days = periods[i].daysInPeriod;

    // Accumulate costs and revenue
    cumulativeCostNeed += monthlyCostsExcFinance[i];
    cumulativeRevenue += monthlyRevenue[i];

    // === Land Loan ===
    if (i === llStartIdx && llAmount > 0) {
      llDrawdowns[i] = llAmount;
      cumulativeLandLoan += llAmount;
      llFees[i] = llEstFee;
      totalLandFees += llEstFee;
    }

    if (llRunningBalance > 0 || llDrawdowns[i] > 0) {
      llRunningBalance += llDrawdowns[i];
      const interest = periodInterest(llRunningBalance, landLoan.interestRate, days, daysPerYear);
      llInterest[i] = interest;
      totalLandInterest += interest;

      // Land loan repaid when senior starts
      if (i >= snrStartIdx && llRunningBalance > 0) {
        llRepayments[i] = llRunningBalance;
        llRunningBalance = 0;
      }
    }
    llBalance[i] = llRunningBalance;

    // === Funding need this period ===
    const netNeed = cumulativeCostNeed + totalLandInterest + totalLandFees
      + totalSeniorInterest + totalSeniorFees
      - cumulativeRevenue - cumulativeEquity - cumulativeSenior - cumulativeLandLoan;

    // === Equity injection (before senior starts) ===
    if (i < snrStartIdx || seniorLimit === 0) {
      if (netNeed > 0 && cumulativeEquity < equityCap) {
        const eqNeeded = Math.min(netNeed, equityCap - cumulativeEquity);
        eqInjections[i] = eqNeeded;
        cumulativeEquity += eqNeeded;
      }
    }

    // === Senior Facility ===
    if (i >= snrStartIdx && !seniorRepaid) {
      // Refinance land loan
      if (i === snrStartIdx && llRepayments[i] > 0) {
        snrDrawdowns[i] += llRepayments[i];
      }

      // Draw down for remaining costs
      const netNeedAfterEquity = cumulativeCostNeed + totalLandInterest + totalLandFees
        + totalSeniorInterest + totalSeniorFees
        - cumulativeRevenue - cumulativeEquity - cumulativeSenior - cumulativeLandLoan;

      if (netNeedAfterEquity > 0) {
        const available = seniorLimit - totalSnrDrawn;
        const draw = Math.min(netNeedAfterEquity, available);
        if (draw > 0) {
          snrDrawdowns[i] += draw;
        }
      }

      totalSnrDrawn += snrDrawdowns[i];
      cumulativeSenior += snrDrawdowns[i];
      snrRunningBalance += snrDrawdowns[i];

      // Senior interest
      const snrInt = periodInterest(snrRunningBalance, snrAllInRate, days, daysPerYear);
      snrInterest[i] = snrInt;
      totalSeniorInterest += snrInt;
      snrRunningBalance += snrInt; // Capitalised

      // Line fee
      const lineFee = periodInterest(seniorLimit, senior.lineFeePercent, days, daysPerYear);
      snrFees[i] = lineFee + (i === snrStartIdx ? snrEstFee : 0);
      totalSeniorFees += snrFees[i];
      snrRunningBalance += snrFees[i]; // Capitalised

      // Revenue received - repay senior
      if (monthlyRevenue[i] > 0 && snrRunningBalance > 0) {
        const repay = Math.min(monthlyRevenue[i], snrRunningBalance);
        snrRepayments[i] = repay;
        snrRunningBalance -= repay;
        if (snrRunningBalance <= 0) {
          snrRunningBalance = 0;
          seniorRepaid = true;
        }
      }
    }

    snrBalance[i] = Math.max(0, snrRunningBalance);
    peakDebt = Math.max(peakDebt, snrRunningBalance + llRunningBalance);

    // Additional equity if needed after senior maxed out
    if (i >= snrStartIdx) {
      const totalFunded = cumulativeEquity + cumulativeSenior + cumulativeLandLoan + cumulativeRevenue;
      const totalNeeded = cumulativeCostNeed + totalLandInterest + totalLandFees + totalSeniorInterest + totalSeniorFees;
      const gap = totalNeeded - totalFunded;
      if (gap > 0) {
        eqInjections[i] += gap;
        cumulativeEquity += gap;
      }
    }
  }

  // Phase 2: Exit waterfall (after all settlements)
  const lastRevenueIdx = monthlyRevenue.reduce((last, v, i) => v > 0 ? i : last, 0);
  const exitIdx = Math.min(lastRevenueIdx + 1, n - 1);

  // Remaining funds after senior repayment
  const totalFundsAvailable = cumulativeRevenue - sum(snrRepayments);
  const equityToReturn = cumulativeEquity;
  const profit = totalFundsAvailable - equityToReturn;

  if (exitIdx < n) {
    eqRepatriations[exitIdx] = equityToReturn;
    profitDist[exitIdx] = Math.max(0, profit);
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
    totalMezzInterest: sum(mzInterest),
    totalMezzFees: sum(mzFees),
    totalLandLoanInterest: totalLandInterest,
    totalLandLoanFees: totalLandFees,
    totalEquityInjected: cumulativeEquity,
    peakDebt,
    seniorFacilitySize: totalSnrDrawn > 0 ? Math.max(...snrBalance) : seniorLimit,
    mezzFacilitySize: calcMezzFacilitySize(mzBalance),
  };
}

function calcMezzFacilitySize(balances: number[]): number {
  return Math.max(0, ...balances);
}

function createEmptyResult(n: number): FundingResult {
  const z = () => new Array(n).fill(0);
  return {
    landLoanBalance: z(), landLoanDrawdowns: z(), landLoanRepayments: z(),
    landLoanInterest: z(), landLoanFees: z(),
    seniorBalance: z(), seniorDrawdowns: z(), seniorRepayments: z(),
    seniorInterest: z(), seniorFees: z(),
    mezzBalance: z(), mezzDrawdowns: z(), mezzRepayments: z(),
    mezzInterest: z(), mezzFees: z(),
    equityInjections: z(), equityRepatriations: z(), profitDistributions: z(),
    totalSeniorInterest: 0, totalSeniorFees: 0,
    totalMezzInterest: 0, totalMezzFees: 0,
    totalLandLoanInterest: 0, totalLandLoanFees: 0,
    totalEquityInjected: 0, peakDebt: 0,
    seniorFacilitySize: 0, mezzFacilitySize: 0,
  };
}
