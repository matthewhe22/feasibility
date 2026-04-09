import type { Period, MainInputs } from '../types';
import { sum } from '../utils';

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
  inputs: MainInputs,
  daysPerYear: number,
  tolerance: number,
  maxIterations = 50,
): FundingResult {
  const n = periods.length;

  // Start with no finance costs, iterate
  let prevSeniorFinCosts = 0;
  let prevMezzFinCosts = 0;
  let result: FundingResult = createEmptyResult(n);

  for (let iter = 0; iter < maxIterations; iter++) {
    // TDC = costs exc finance + current estimate of finance costs
    const tdc = sum(monthlyCostsExcFinance) + prevSeniorFinCosts + prevMezzFinCosts;

    result = runFundingWaterfall(
      periods, monthlyCostsExcFinance, monthlyRevenue,
      inputs, tdc, daysPerYear,
    );

    const newSeniorFinCosts = result.totalSeniorInterest + result.totalSeniorFees
      + result.totalLandLoanInterest + result.totalLandLoanFees;
    const newMezzFinCosts = result.totalMezzInterest + result.totalMezzFees;

    const seniorDiff = Math.abs(newSeniorFinCosts - prevSeniorFinCosts);
    const mezzDiff = Math.abs(newMezzFinCosts - prevMezzFinCosts);

    if (seniorDiff < tolerance && mezzDiff < tolerance) {
      break;
    }

    prevSeniorFinCosts = newSeniorFinCosts;
    prevMezzFinCosts = newMezzFinCosts;
  }

  return result;
}

function runFundingWaterfall(
  periods: Period[],
  monthlyCostsExcFinance: number[],
  monthlyRevenue: number[],
  inputs: MainInputs,
  tdc: number, // Total Development Costs including finance (for LTC)
  daysPerYear: number,
): FundingResult {
  const n = periods.length;
  const landLoan = inputs.landLoan;
  const senior = inputs.seniorFacility;
  const mezz = inputs.mezzanine;

  // ===== Compute NRV for LVR =====
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

  // ===== Facility limits from LTC/LVR =====
  // LTC is on TDC INCLUDING finance costs (circular - resolved by iteration)
  const seniorLtcLimit = senior.ltcTarget > 0 ? tdc * senior.ltcTarget : Infinity;
  const seniorLvrLimit = senior.lvrTarget > 0 ? nrv * senior.lvrTarget : Infinity;
  const seniorLimit = Math.min(senior.facilityLimit, seniorLtcLimit, seniorLvrLimit);

  const mezzLtcLimit = mezz.ltcTarget > 0 ? tdc * mezz.ltcTarget : Infinity;
  const mezzLvrLimit = mezz.lvrTarget > 0 ? nrv * mezz.lvrTarget : Infinity;
  const mezzLimit = Math.min(mezz.facilityLimit, mezzLtcLimit, mezzLvrLimit);

  // ===== Equity cap =====
  const equityFixedKokoda = inputs.equityKokoda.fixedAmount;
  const equityFixedJV = inputs.equityJV.fixedAmount;
  const equityPctKokoda = inputs.equityKokoda.percentage;
  const totalCostsExcFin = sum(monthlyCostsExcFinance);
  const equityFromPct = totalCostsExcFin * equityPctKokoda;
  const equityCap = (equityFixedKokoda + equityFixedJV) > 0
    ? (equityFixedKokoda + equityFixedJV)
    : equityFromPct;

  // ===== Timeline flags =====
  // Senior starts when its startMonth is reached
  const snrStartIdx = senior.startMonth > 0 ? senior.startMonth - 1 : -1;
  const mezzStartIdx = mezz.startMonth > 0 ? mezz.startMonth - 1 : -1;
  const hasMezz = mezz.facilityLimit > 0 && mezzStartIdx >= 0;
  const hasSenior = senior.facilityLimit > 0 && snrStartIdx >= 0;

  // ===== Initialize arrays =====
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

  // ===== Running state =====
  let llRunningBalance = 0;
  let snrRunningBalance = 0;
  let mzRunningBalance = 0;

  let cumulativeCosts = 0;
  let cumulativeEquity = 0;
  let cumulativeMezz = 0;
  let cumulativeSenior = 0;
  let cumulativeLandLoan = 0;
  let cumulativeFinanceCosts = 0; // interest + fees accumulated

  let totalSeniorInterest = 0;
  let totalSeniorFees = 0;
  let totalMezzInterest = 0;
  let totalMezzFees = 0;
  let totalLandInterest = 0;
  let totalLandFees = 0;
  let peakDebt = 0;

  let totalSnrDrawn = 0;
  let totalMezzDrawn = 0;

  // ===== PHASE 1: Forward pass - Drawdowns =====
  for (let i = 0; i < n; i++) {
    const days = periods[i].daysInPeriod;

    // Accumulate costs
    cumulativeCosts += monthlyCostsExcFinance[i];

    // === LAND LOAN ===
    const llStartIdx = landLoan.startMonth > 0 ? landLoan.startMonth - 1 : -1;
    if (i === llStartIdx && landLoan.facilityLimit > 0) {
      llDrawdowns[i] = landLoan.facilityLimit;
      cumulativeLandLoan += landLoan.facilityLimit;
      const estFee = landLoan.facilityLimit * landLoan.establishmentFeePercent;
      llFees[i] = estFee;
      totalLandFees += estFee;
      cumulativeFinanceCosts += estFee;
    }

    // Land loan interest
    if (llRunningBalance > 0 || llDrawdowns[i] > 0) {
      llRunningBalance += llDrawdowns[i];
      const interest = periodInterest(llRunningBalance, landLoan.interestRate, days, daysPerYear);
      llInterest[i] = interest;
      totalLandInterest += interest;
      cumulativeFinanceCosts += interest;

      // Land loan repaid when senior starts (refinanced into senior)
      if (hasSenior && i >= snrStartIdx && llRunningBalance > 0) {
        llRepayments[i] = llRunningBalance;
        llRunningBalance = 0;
      }
    }
    llBalance[i] = llRunningBalance;

    // === TOTAL FUNDING NEED ===
    // What needs to be funded = cumulative costs + finance costs - cumulative funding sources
    const totalNeed = cumulativeCosts + cumulativeFinanceCosts;
    const totalFunded = cumulativeEquity + cumulativeMezz + cumulativeSenior + cumulativeLandLoan;
    const gap = totalNeed - totalFunded;

    // === EQUITY ===
    // Equity funds everything before mezzanine/senior starts.
    // Even beyond the equity cap if needed (excess gets repatriated later).
    const mezzActive = hasMezz && i >= mezzStartIdx;
    const seniorActive = hasSenior && i >= snrStartIdx;

    if (gap > 0 && !seniorActive && !mezzActive) {
      // Before any debt facility starts, equity funds everything
      eqInjections[i] = gap;
      cumulativeEquity += gap;
    } else if (gap > 0 && !seniorActive && mezzActive) {
      // Mezz is active but senior isn't - equity funds up to cap, mezz funds rest
      if (cumulativeEquity < equityCap) {
        const eqNeeded = Math.min(gap, equityCap - cumulativeEquity);
        eqInjections[i] += eqNeeded;
        cumulativeEquity += eqNeeded;
      }
      // Remaining gap goes to mezzanine
      const remainGap = totalNeed - (cumulativeEquity + cumulativeMezz + cumulativeSenior + cumulativeLandLoan);
      if (remainGap > 0 && totalMezzDrawn < mezzLimit) {
        const mezzDraw = Math.min(remainGap, mezzLimit - totalMezzDrawn);
        mzDrawdowns[i] = mezzDraw;
        totalMezzDrawn += mezzDraw;
        cumulativeMezz += mezzDraw;
        mzRunningBalance += mezzDraw;
      }
    }

    // === MEZZANINE INTEREST (before senior, if active) ===
    if (mzRunningBalance > 0) {
      const mezzRate = mezz.margin + mezz.bbsy;
      const mzInt = periodInterest(mzRunningBalance, mezzRate, days, daysPerYear);
      mzInterest[i] = mzInt;
      totalMezzInterest += mzInt;
      cumulativeFinanceCosts += mzInt;
      if (mezz.isCapitalised) {
        mzRunningBalance += mzInt; // Capitalised
      }

      // Line fee
      const mzLineFee = periodInterest(mezzLimit, mezz.lineFeePercent, days, daysPerYear);
      if (mzLineFee > 0) {
        mzFees[i] += mzLineFee;
        totalMezzFees += mzLineFee;
        cumulativeFinanceCosts += mzLineFee;
        if (mezz.isCapitalised) mzRunningBalance += mzLineFee;
      }

      // Establishment fee (first period only)
      if (i === mezzStartIdx) {
        const mzEstFee = mezzLimit * mezz.establishmentFeePercent;
        mzFees[i] += mzEstFee;
        totalMezzFees += mzEstFee;
        cumulativeFinanceCosts += mzEstFee;
        if (mezz.isCapitalised) mzRunningBalance += mzEstFee;
      }
    }
    mzBalance[i] = Math.max(0, mzRunningBalance);

    // === SENIOR FACILITY ===
    if (seniorActive) {
      // First period: refinance land loan into senior
      if (i === snrStartIdx && llRepayments[i] > 0) {
        snrDrawdowns[i] += llRepayments[i];
      }

      // Repatriation of excess equity: when senior kicks in, equity above cap is returned
      // and senior takes over that funding
      if (i === snrStartIdx && cumulativeEquity > equityCap) {
        const excessEquity = cumulativeEquity - equityCap;
        // Senior refinances the excess equity
        snrDrawdowns[i] += excessEquity;
        // Repatriate excess equity to investors
        eqRepatriations[i] += excessEquity;
        cumulativeEquity -= excessEquity;
      }

      // Recalculate gap after equity repatriation and land loan refinance
      const curTotalNeed = cumulativeCosts + cumulativeFinanceCosts;
      const curTotalFunded = cumulativeEquity + cumulativeMezz + cumulativeSenior + cumulativeLandLoan;
      const seniorGap = curTotalNeed - curTotalFunded;

      // Draw from senior for remaining costs
      if (seniorGap > 0) {
        const available = seniorLimit - totalSnrDrawn;
        const draw = Math.min(seniorGap, Math.max(0, available));
        if (draw > 0) {
          snrDrawdowns[i] += draw;
        }
      }

      totalSnrDrawn += snrDrawdowns[i];
      cumulativeSenior += snrDrawdowns[i];
      snrRunningBalance += snrDrawdowns[i];

      // Senior interest (capitalised)
      const snrAllInRate = senior.margin + senior.bbsy;
      const snrInt = periodInterest(snrRunningBalance, snrAllInRate, days, daysPerYear);
      snrInterest[i] = snrInt;
      totalSeniorInterest += snrInt;
      cumulativeFinanceCosts += snrInt;
      snrRunningBalance += snrInt; // Capitalised

      // Senior line fee (on facility limit, capitalised)
      const lineFee = periodInterest(seniorLimit, senior.lineFeePercent, days, daysPerYear);
      const estFee = (i === snrStartIdx) ? seniorLimit * senior.establishmentFeePercent : 0;
      snrFees[i] = lineFee + estFee;
      totalSeniorFees += snrFees[i];
      cumulativeFinanceCosts += snrFees[i];
      snrRunningBalance += snrFees[i]; // Capitalised

      // Additional equity if senior is maxed out and there's still a gap
      const postSnrNeed = cumulativeCosts + cumulativeFinanceCosts;
      const postSnrFunded = cumulativeEquity + cumulativeMezz + cumulativeSenior + cumulativeLandLoan;
      const postSnrGap = postSnrNeed - postSnrFunded;
      if (postSnrGap > 0) {
        eqInjections[i] += postSnrGap;
        cumulativeEquity += postSnrGap;
      }
    }

    snrBalance[i] = Math.max(0, snrRunningBalance);
    peakDebt = Math.max(peakDebt, snrRunningBalance + llRunningBalance + mzRunningBalance);
  }

  // ===== PHASE 2: Exit waterfall (revenue repays debt then equity) =====
  // Revenue settlements repay in order: Senior → Mezz → then accumulate for equity/profit
  let availableFunds = 0;
  for (let i = 0; i < n; i++) {
    availableFunds += monthlyRevenue[i];

    // Senior repayment
    if (snrBalance[i] > 0 && availableFunds > 0) {
      const repay = Math.min(availableFunds, snrRunningBalance);
      if (repay > 0 && monthlyRevenue[i] > 0) {
        // Only repay in periods with revenue
        const actualRepay = Math.min(monthlyRevenue[i], snrBalance[i]);
        if (actualRepay > 0) {
          snrRepayments[i] = actualRepay;
          snrRunningBalance -= actualRepay;
          snrBalance[i] = Math.max(0, snrRunningBalance);
          // Recalculate subsequent balances
          for (let j = i + 1; j < n; j++) {
            snrBalance[j] = snrBalance[j]; // Already set in forward pass
          }
        }
      }
    }
  }

  // Simpler exit: recalculate balances after repayments
  // Reset and replay repayments
  snrRunningBalance = 0;
  mzRunningBalance = 0;
  for (let i = 0; i < n; i++) {
    snrRunningBalance += snrDrawdowns[i] + snrInterest[i] + snrFees[i];
    mzRunningBalance += mzDrawdowns[i] + mzInterest[i] + mzFees[i];

    // Repay senior from revenue
    if (monthlyRevenue[i] > 0 && snrRunningBalance > 0) {
      const repay = Math.min(monthlyRevenue[i], snrRunningBalance);
      snrRepayments[i] = repay;
      snrRunningBalance -= repay;
    }

    // Repay mezz from remaining revenue
    const remainingRev = monthlyRevenue[i] - snrRepayments[i];
    if (remainingRev > 0 && mzRunningBalance > 0) {
      const repay = Math.min(remainingRev, mzRunningBalance);
      mzRepayments[i] = repay;
      mzRunningBalance -= repay;
    }

    snrBalance[i] = Math.max(0, snrRunningBalance);
    mzBalance[i] = Math.max(0, mzRunningBalance);
  }

  // Equity repatriation and profit distribution at project end
  const totalRevenueReceived = sum(monthlyRevenue);
  const totalDebtRepaid = sum(snrRepayments) + sum(mzRepayments);
  const fundsForEquity = totalRevenueReceived - totalDebtRepaid;

  const lastRevenueIdx = monthlyRevenue.reduce((last, v, i) => v > 0 ? i : last, 0);
  const exitIdx = Math.min(lastRevenueIdx + 1, n - 1);

  if (exitIdx < n) {
    // Return equity (only the net equity still in the project, not already repatriated)
    const alreadyRepatriated = sum(eqRepatriations);
    const netEquityToReturn = cumulativeEquity - alreadyRepatriated;
    if (netEquityToReturn > 0) {
      eqRepatriations[exitIdx] += Math.min(netEquityToReturn, fundsForEquity);
    }
    const remainForProfit = fundsForEquity - netEquityToReturn;
    if (remainForProfit > 0) {
      profitDist[exitIdx] = remainForProfit;
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
    totalMezzInterest,
    totalMezzFees,
    totalLandLoanInterest: totalLandInterest,
    totalLandLoanFees: totalLandFees,
    totalEquityInjected: cumulativeEquity,
    peakDebt,
    seniorFacilitySize: seniorLimit,
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
