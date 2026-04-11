import type { Period, MainInputs } from '../types';
import { sum } from '../utils';

// ===== DRAWDOWN SEQUENCE =====

export type DrawdownFacilityType = 'equity' | 'senior' | 'mezz';

export interface DrawdownSequenceEntry {
  type: DrawdownFacilityType;
  name: string;
  priority: number;
}

/**
 * Returns the drawdown sequence for the three main funding sources — senior debt,
 * mezzanine debt, and equity — sorted by their user-configured drawdownPriority
 * (1 = drawn first, higher = drawn later).
 *
 * The land loan is excluded because it is drawn as a fixed lump sum at a specific
 * date and is not part of the flexible gap-filling waterfall.
 */
export function computeDrawdownSequence(inputs: MainInputs): DrawdownSequenceEntry[] {
  const entries: DrawdownSequenceEntry[] = [
    {
      type: 'senior',
      name: inputs.seniorFacility.name,
      priority: inputs.seniorFacility.drawdownPriority ?? 1,
    },
    {
      type: 'mezz',
      name: inputs.mezzanine.name,
      priority: inputs.mezzanine.drawdownPriority ?? 2,
    },
    {
      type: 'equity',
      name: inputs.equityKokoda.name,
      priority: inputs.equityKokoda.drawdownPriority ?? 3,
    },
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
  monthlyGSTNet: number[],
  gstOnRevenue: number[],
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
    // TDC = costs exc finance + current estimate of all finance costs (including
    // capitalised interest, since TDC is used for LTC/LVR facility sizing only —
    // capitalised interest does not flow through the cash-gap drawdown mechanism).
    const tdc = sum(monthlyCostsExcFinance) + prevSeniorFinCosts + prevMezzFinCosts;

    result = runFundingWaterfall(
      periods, monthlyCostsExcFinance, monthlyRevenue, monthlyGSTNet, gstOnRevenue,
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
  monthlyGSTNet: number[],
  gstOnRevenue: number[],
  inputs: MainInputs,
  tdc: number, // Total Development Costs including finance (for LTC)
  daysPerYear: number,
): FundingResult {
  const n = periods.length;
  const landLoan = inputs.landLoan;
  const senior = inputs.seniorFacility;
  const mezz = inputs.mezzanine;

  // Pre-compute drawdown sequence (sorted by priority, ascending = drawn first)
  const drawdownSequence = computeDrawdownSequence(inputs);

  // ===== Compute NRV for LVR =====
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

  // ===== Facility limits from LTC/LVR =====
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
  const snrStartIdx = senior.startMonth > 0 ? senior.startMonth - 1 : -1;
  const mezzStartIdx = mezz.startMonth > 0 ? mezz.startMonth - 1 : -1;
  const hasMezz = mezz.facilityLimit > 0 && mezzStartIdx >= 0;
  const hasSenior = senior.facilityLimit > 0 && snrStartIdx >= 0;
  const llStartIdx = landLoan.startMonth > 0 ? landLoan.startMonth - 1 : -1;

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
  let llAccruedInterest = 0; // track quarterly land loan interest

  let cumulativeCosts = 0;
  let cumulativeEquity = 0;
  let cumulativeMezz = 0;
  let cumulativeSenior = 0;
  let cumulativeLandLoan = 0;
  let cumulativeFinanceCosts = 0;

  let totalSeniorInterest = 0;
  let totalSeniorFees = 0;
  let totalMezzInterest = 0;
  let totalMezzFees = 0;
  let totalLandInterest = 0;
  let totalLandFees = 0;
  let peakDebt = 0;

  let totalSnrDrawn = 0;
  let totalMezzDrawn = 0;

  const snrAllInRate = senior.margin + senior.bbsy;
  const mezzAllInRate = mezz.margin + mezz.bbsy;

  // ===== SINGLE PASS: Drawdowns + Repayments + Interest =====
  for (let i = 0; i < n; i++) {
    const days = periods[i].daysInPeriod;
    const seniorActive = hasSenior && i >= snrStartIdx;

    // === LAND LOAN ===
    if (i === llStartIdx && landLoan.facilityLimit > 0) {
      llDrawdowns[i] = landLoan.facilityLimit;
      cumulativeLandLoan += landLoan.facilityLimit;
      llRunningBalance += landLoan.facilityLimit;
      const estFee = landLoan.facilityLimit * landLoan.establishmentFeePercent;
      llFees[i] = estFee;
      totalLandFees += estFee;
      cumulativeFinanceCosts += estFee;
    }

    // Land loan interest — accrue monthly, charge at quarter-end boundaries
    if (llRunningBalance > 0) {
      const accrued = periodInterest(llRunningBalance, landLoan.interestRate, days, daysPerYear);
      llAccruedInterest += accrued;

      const monthsSinceLLStart = i - llStartIdx;
      const freq = landLoan.interestPaymentFrequency > 0 ? landLoan.interestPaymentFrequency : 1;
      const isQuarterEnd = (monthsSinceLLStart + 1) % freq === 0;

      if (isQuarterEnd) {
        llInterest[i] = llAccruedInterest;
        totalLandInterest += llAccruedInterest;
        cumulativeFinanceCosts += llAccruedInterest;
        llAccruedInterest = 0;
      }
    }

    // Land loan repaid when senior starts (refinanced into senior)
    // Flush any remaining accrued interest before recording repayment
    if (hasSenior && i === snrStartIdx && llRunningBalance > 0) {
      if (llAccruedInterest > 0) {
        llInterest[i] += llAccruedInterest;
        totalLandInterest += llAccruedInterest;
        cumulativeFinanceCosts += llAccruedInterest;
        llAccruedInterest = 0;
      }
      llRepayments[i] = llRunningBalance;
      llRunningBalance = 0;
    }
    llBalance[i] = llRunningBalance;

    // === ACCUMULATE COSTS ===
    cumulativeCosts += monthlyCostsExcFinance[i];

    // === SENIOR INITIALIZATION (at snrStartIdx only — land loan refi + excess equity repatriation) ===
    // These special draws are accumulated in snrDrawdowns[i] but cumulativeSenior is
    // updated below (after the gap fill) to preserve the original gap-calc behaviour.
    if (hasSenior && i === snrStartIdx) {
      // Refinance land loan into senior
      if (llRepayments[i] > 0) {
        snrDrawdowns[i] += llRepayments[i];
      }
      // Repatriate any equity that was injected above the cap back into senior
      if (cumulativeEquity > equityCap) {
        const excessEquity = cumulativeEquity - equityCap;
        snrDrawdowns[i] += excessEquity;
        eqRepatriations[i] += excessEquity;
        cumulativeEquity -= excessEquity;
      }
    }

    // === GAP FILLING via user-configured drawdown sequence ===
    // `snrDrawdowns[i]` may already contain the refinancing amount from above, but
    // `cumulativeSenior` has NOT been updated yet — this matches the original pattern
    // where the senior cumulative is flushed once after all draws for the period.
    {
      const totalNeed = cumulativeCosts + cumulativeFinanceCosts;
      const totalFunded = cumulativeEquity + cumulativeMezz + cumulativeSenior + cumulativeLandLoan;
      let remainGap = Math.max(0, totalNeed - totalFunded);

      if (remainGap > 0) {
        // Track senior draws added in the init block above so capacity is computed correctly
        const snrInitDrawnThisPeriod = snrDrawdowns[i];

        for (const entry of drawdownSequence) {
          if (remainGap <= 0) break;

          if (entry.type === 'senior' && hasSenior && i >= snrStartIdx) {
            // Remaining capacity accounts for refinancing already in snrDrawdowns[i]
            const available = Math.max(0, seniorLimit - totalSnrDrawn - snrInitDrawnThisPeriod);
            if (available > 0) {
              const draw = Math.min(remainGap, available);
              snrDrawdowns[i] += draw;
              remainGap -= draw;
            }
          } else if (entry.type === 'mezz' && hasMezz && i >= mezzStartIdx) {
            const available = Math.max(0, mezzLimit - totalMezzDrawn);
            if (available > 0) {
              const draw = Math.min(remainGap, available);
              mzDrawdowns[i] += draw;
              totalMezzDrawn += draw;
              cumulativeMezz += draw;
              mzRunningBalance += draw;
              remainGap -= draw;
            }
          } else if (entry.type === 'equity') {
            const available = Math.max(0, equityCap - cumulativeEquity);
            if (available > 0) {
              const draw = Math.min(remainGap, available);
              eqInjections[i] += draw;
              cumulativeEquity += draw;
              remainGap -= draw;
            }
          }
        }

        // Equity backstop: if all configured facilities are exhausted, inject uncapped equity
        if (remainGap > 0) {
          eqInjections[i] += remainGap;
          cumulativeEquity += remainGap;
        }
      }
    }

    // Flush senior cumulative tracking for this period (init draws + gap-fill draws)
    if (hasSenior && i >= snrStartIdx) {
      totalSnrDrawn += snrDrawdowns[i];
      cumulativeSenior += snrDrawdowns[i];
      snrRunningBalance += snrDrawdowns[i];
    }

    // === REVENUE REPAYMENTS (integrated - reduces balance for interest calc) ===
    // Only repay debt when there is excess cash in the period.
    // Excess = gross revenue minus GST paid to ATO on revenue, minus all operational
    // costs (which already include GST paid to vendors).
    // Non-capitalised cash interest (land loan) is already in the gap drawdown above,
    // so it is implicitly funded and does not need to be deducted again here.
    // We use gstOnRevenue[i] (not gstNet) so that cost-side GST refunds do not
    // artificially inflate available-for-repayment cash — the net cashflow formula
    // treats gstOnCosts as a real outflow, so the repayment formula must match.
    const periodNetCash = (monthlyRevenue[i] - gstOnRevenue[i]) - monthlyCostsExcFinance[i];
    let revAvailable = Math.max(0, periodNetCash);
    // Repay senior first
    if (revAvailable > 0 && snrRunningBalance > 0) {
      const repay = Math.min(revAvailable, snrRunningBalance);
      snrRepayments[i] = repay;
      snrRunningBalance -= repay;
      revAvailable -= repay;
    }
    // Then repay mezzanine
    if (revAvailable > 0 && mzRunningBalance > 0) {
      const repay = Math.min(revAvailable, mzRunningBalance);
      mzRepayments[i] = repay;
      mzRunningBalance -= repay;
      revAvailable -= repay;
    }

    // === INTEREST AND FEES (on balance AFTER drawdowns and repayments) ===
    //
    // Key rule for net-cashflow = 0:
    //   • Non-capitalised (cash) interest/fees → add to cumulativeFinanceCosts so the
    //     gap-fill drawdown in the SAME period covers them, AND subtract from net cashflow.
    //   • Capitalised interest/fees → accrete to running balance ONLY; do NOT add to
    //     cumulativeFinanceCosts (so no extra drawdown is triggered) and do NOT treat
    //     them as a cash outflow in the net cashflow formula.  The larger balance will be
    //     swept out via repayments when revenue arrives.
    //
    // Land-loan interest is always non-capitalised (computed before the gap fill above).

    // Senior interest
    if (snrRunningBalance > 0) {
      const snrInt = periodInterest(snrRunningBalance, snrAllInRate, days, daysPerYear);
      snrInterest[i] = snrInt;
      totalSeniorInterest += snrInt;
      if (senior.isCapitalised) {
        snrRunningBalance += snrInt;  // accretes to balance; not a cash flow
      } else {
        cumulativeFinanceCosts += snrInt;  // cash payment; gap will draw for it
      }
    }

    // Senior fees
    if (seniorActive) {
      let periodFees = 0;
      if (snrRunningBalance > 0) {
        periodFees += periodInterest(seniorLimit, senior.lineFeePercent, days, daysPerYear);
      }
      if (i === snrStartIdx) {
        periodFees += seniorLimit * senior.establishmentFeePercent;
      }
      if (periodFees > 0) {
        snrFees[i] = periodFees;
        totalSeniorFees += periodFees;
        if (senior.isCapitalised) {
          snrRunningBalance += periodFees;  // accretes; not a cash flow
        } else {
          cumulativeFinanceCosts += periodFees;
        }
      }
    }

    // Mezzanine interest
    if (mzRunningBalance > 0) {
      const mzInt = periodInterest(mzRunningBalance, mezzAllInRate, days, daysPerYear);
      mzInterest[i] = mzInt;
      totalMezzInterest += mzInt;
      if (mezz.isCapitalised) {
        mzRunningBalance += mzInt;
      } else {
        cumulativeFinanceCosts += mzInt;
      }

      // Line fee
      const mzLineFee = periodInterest(mezzLimit, mezz.lineFeePercent, days, daysPerYear);
      if (mzLineFee > 0) {
        mzFees[i] += mzLineFee;
        totalMezzFees += mzLineFee;
        if (mezz.isCapitalised) {
          mzRunningBalance += mzLineFee;
        } else {
          cumulativeFinanceCosts += mzLineFee;
        }
      }
    }

    // Mezzanine establishment fee (at start, regardless of balance)
    if (hasMezz && i === mezzStartIdx) {
      const mzEstFee = mezzLimit * mezz.establishmentFeePercent;
      if (mzEstFee > 0) {
        mzFees[i] += mzEstFee;
        totalMezzFees += mzEstFee;
        if (mezz.isCapitalised) {
          mzRunningBalance += mzEstFee;
        } else {
          cumulativeFinanceCosts += mzEstFee;
        }
      }
    }

    // === RECORD BALANCES ===
    snrBalance[i] = Math.max(0, snrRunningBalance);
    mzBalance[i] = Math.max(0, mzRunningBalance);
    peakDebt = Math.max(peakDebt, snrRunningBalance + llRunningBalance + mzRunningBalance);
  }

  // ===== EQUITY REPATRIATION & PROFIT at project end =====
  const totalRevenueReceived = sum(monthlyRevenue.map((r, i) => Math.max(0, r - monthlyGSTNet[i])));
  const totalDebtRepaid = sum(snrRepayments) + sum(mzRepayments);
  const fundsForEquity = totalRevenueReceived - totalDebtRepaid;

  const lastRevenueIdx = monthlyRevenue.reduce((last, v, idx) => v > 0 ? idx : last, 0);
  const exitIdx = Math.min(lastRevenueIdx + 1, n - 1);

  if (exitIdx < n) {
    // Return equity - cumulativeEquity is already net of any mid-project repatriations
    const netEquityToReturn = cumulativeEquity;
    if (netEquityToReturn > 0 && fundsForEquity > 0) {
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
