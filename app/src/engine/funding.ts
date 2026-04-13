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
  _monthlyGSTNet: number[],
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
      periods, monthlyCostsExcFinance, monthlyRevenue, _monthlyGSTNet, gstOnRevenue,
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
  _monthlyGSTNet: number[],
  _gstOnRevenue: number[],
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

  // Track equity returned so far (incremental as revenue arrives)
  let totalEqRepatriated = 0;

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

  // ===== SINGLE PASS: Drawdowns + Interest (on opening balance) + Repayments =====
  //
  // Key ordering principle for "interest on opening balance":
  //   Interest for period i is charged on the balance at the START of period i —
  //   i.e., before any draws or repayments occur in period i.  New drawdowns in
  //   period i do not incur interest until period i+1.
  //
  // Loop order:
  //   1. Save opening balances
  //   2. Land loan lump-sum draw (at llStartIdx)
  //   3. Land loan interest on opening balance (not on post-draw balance)
  //   4. Land loan repayment at snrStartIdx (flush accrued + repay principal)
  //   5. Accumulate period operating costs
  //   6. Senior & mezz interest/fees on opening balances BEFORE gap fill
  //      – non-capitalised → added to cumulativeFinanceCosts so gap fill covers them
  //      – capitalised → accrete to running balance (repaid later via revenue)
  //   7. Senior initialisation (land loan refi + excess equity repatriation)
  //   8. Gap fill (drawdowns to cover costs + non-capitalised finance charges)
  //   9. Revenue repayments (sweep excess cash to debt → equity → profit)
  //  10. Record closing balances

  for (let i = 0; i < n; i++) {
    const days = periods[i].daysInPeriod;
    const seniorActive = hasSenior && i >= snrStartIdx;

    // ── 1. Save opening balances (before any period activity) ──────────────────
    const llOpenBalance  = llRunningBalance;
    const snrOpenBalance = snrRunningBalance;
    const mzOpenBalance  = mzRunningBalance;

    // ── 2. Land loan lump-sum draw ─────────────────────────────────────────────
    if (i === llStartIdx && landLoan.facilityLimit > 0) {
      llDrawdowns[i] = landLoan.facilityLimit;
      cumulativeLandLoan += landLoan.facilityLimit;
      llRunningBalance += landLoan.facilityLimit;
      const estFee = landLoan.facilityLimit * landLoan.establishmentFeePercent;
      llFees[i] = estFee;
      totalLandFees += estFee;
      cumulativeFinanceCosts += estFee;
    }

    // ── 3. Land loan interest on opening balance ───────────────────────────────
    // Interest accrues monthly on the opening balance; charged at quarter-end.
    // In the period the land loan is first drawn, opening balance = 0 so no
    // interest is due in that period (correct: first interest quarter starts next period).
    if (llOpenBalance > 0) {
      const accrued = periodInterest(llOpenBalance, landLoan.interestRate, days, daysPerYear);
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

    // ── 4. Land loan repayment at senior start (refinanced into senior) ────────
    if (hasSenior && i === snrStartIdx && llRunningBalance > 0) {
      // Flush any remaining accrued interest
      if (llAccruedInterest > 0) {
        llInterest[i] += llAccruedInterest;
        totalLandInterest += llAccruedInterest;
        cumulativeFinanceCosts += llAccruedInterest;
        llAccruedInterest = 0;
      }
      llRepayments[i] = llRunningBalance;
      // Remove land loan from cumulative funding — it is being replaced by the
      // senior refi draw added in step 7.  Without this, both cumulativeLandLoan
      // and cumulativeSenior (refi draw) would count the same principal, inflating
      // totalFunded by the full land-loan amount and blocking gap-fill draws for
      // several periods (the "dead zone").
      cumulativeLandLoan -= llRunningBalance;
      llRunningBalance = 0;
    }
    llBalance[i] = llRunningBalance;

    // ── 5. Accumulate period operating costs ───────────────────────────────────
    cumulativeCosts += monthlyCostsExcFinance[i];

    // ── 6. Senior & mezz interest/fees on opening balances (BEFORE gap fill) ───
    //
    // Charging interest on the opening balance (before this period's draws) is the
    // correct financial convention.  Non-capitalised charges are added to
    // cumulativeFinanceCosts so the gap fill in step 8 will draw enough to cover them.
    // Capitalised charges accrete to the running balance; they are not cash flows and
    // do not trigger additional gap-fill drawdowns.

    // Senior interest (on opening balance, before gap fill draws)
    if (snrOpenBalance > 0) {
      const snrInt = periodInterest(snrOpenBalance, snrAllInRate, days, daysPerYear);
      snrInterest[i] = snrInt;
      totalSeniorInterest += snrInt;
      if (senior.isCapitalised) {
        snrRunningBalance += snrInt;
      } else {
        cumulativeFinanceCosts += snrInt;
      }
    }

    // Senior fees: line fee on opening balance; establishment fee at start
    if (seniorActive) {
      let periodFees = 0;
      if (snrOpenBalance > 0) {
        periodFees += periodInterest(seniorLimit, senior.lineFeePercent, days, daysPerYear);
      }
      if (i === snrStartIdx) {
        periodFees += seniorLimit * senior.establishmentFeePercent;
      }
      if (periodFees > 0) {
        snrFees[i] = periodFees;
        totalSeniorFees += periodFees;
        if (senior.isCapitalised) {
          snrRunningBalance += periodFees;
        } else {
          cumulativeFinanceCosts += periodFees;
        }
      }
    }

    // Mezzanine interest (on opening balance)
    if (mzOpenBalance > 0) {
      const mzInt = periodInterest(mzOpenBalance, mezzAllInRate, days, daysPerYear);
      mzInterest[i] = mzInt;
      totalMezzInterest += mzInt;
      if (mezz.isCapitalised) {
        mzRunningBalance += mzInt;
      } else {
        cumulativeFinanceCosts += mzInt;
      }

      // Line fee on opening balance
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

    // Mezzanine establishment fee (at start of facility)
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

    // ── 7. Senior initialization (land loan refi + excess equity repatriation) ─
    if (hasSenior && i === snrStartIdx) {
      if (llRepayments[i] > 0) {
        snrDrawdowns[i] += llRepayments[i];
        // Credit the refi draw into cumulativeSenior immediately so the gap-fill
        // in step 8 sees the correct totalFunded (land-loan slot transferred to
        // senior slot, net change = 0).  The flush in step 10 must not double-add
        // this amount — it subtracts llRepayments[i] again there.
        cumulativeSenior += llRepayments[i];
      }
      if (cumulativeEquity > equityCap) {
        const excessEquity = cumulativeEquity - equityCap;
        snrDrawdowns[i] += excessEquity;
        eqRepatriations[i] += excessEquity;
        cumulativeEquity -= excessEquity;
      }
    }

    // ── 8. Gap filling via user-configured drawdown sequence ──────────────────
    {
      const totalNeed = cumulativeCosts + cumulativeFinanceCosts;
      const totalFunded = cumulativeEquity + cumulativeMezz + cumulativeSenior + cumulativeLandLoan;
      let remainGap = Math.max(0, totalNeed - totalFunded);

      if (remainGap > 0) {
        const snrInitDrawnThisPeriod = snrDrawdowns[i];

        for (const entry of drawdownSequence) {
          if (remainGap <= 0) break;

          if (entry.type === 'senior' && hasSenior && i >= snrStartIdx) {
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

        // Equity backstop: inject uncapped equity if all configured facilities exhausted
        if (remainGap > 0) {
          eqInjections[i] += remainGap;
          cumulativeEquity += remainGap;
        }
      }
    }

    // Flush senior cumulative tracking for this period (init + gap-fill draws).
    // At snrStartIdx the refi draw was already credited to cumulativeSenior in
    // step 7, so subtract it here to avoid double-counting.
    if (hasSenior && i >= snrStartIdx) {
      const refiAlreadyCounted = (i === snrStartIdx) ? llRepayments[i] : 0;
      totalSnrDrawn += snrDrawdowns[i];
      cumulativeSenior += snrDrawdowns[i] - refiAlreadyCounted;
      snrRunningBalance += snrDrawdowns[i];
    }

    // ── 9. Revenue repayments (sweep excess cash → debt → equity → profit) ─────
    // Excess = revenue net of GST, plus GST Input Tax Credits (ITC) received from
    // ATO, minus operating costs (including GST paid to suppliers).
    //
    // GST accounting:
    //   - monthlyCostsExcFinance includes gstOnCosts (GST paid to suppliers)
    //   - The ATO refunds gstOnCosts back to the project as ITCs
    //   - The project remits gstOnRevenue to ATO (GST collected from buyers)
    //   - Net GST cash to/from ATO = gstOnRevenue - gstOnCosts = _monthlyGSTNet[i]
    //
    // Correct formula:  revenue − net_GST_to_ATO − operating_costs
    //   = monthlyRevenue[i] − _monthlyGSTNet[i] − monthlyCostsExcFinance[i]
    //
    // Without _monthlyGSTNet the ITC refunds are never swept to profit, leaving a
    // permanent positive residual in the cumulative cashflow.
    const periodNetCash = monthlyRevenue[i] - _monthlyGSTNet[i] - monthlyCostsExcFinance[i];
    let revAvailable = Math.max(0, periodNetCash);

    if (revAvailable > 0 && snrRunningBalance > 0) {
      const repay = Math.min(revAvailable, snrRunningBalance);
      snrRepayments[i] = repay;
      snrRunningBalance -= repay;
      revAvailable -= repay;
    }
    if (revAvailable > 0 && mzRunningBalance > 0) {
      const repay = Math.min(revAvailable, mzRunningBalance);
      mzRepayments[i] = repay;
      mzRunningBalance -= repay;
      revAvailable -= repay;
    }
    if (revAvailable > 0) {
      const equityLeft = cumulativeEquity - totalEqRepatriated;
      if (equityLeft > 0) {
        const eqReturn = Math.min(revAvailable, equityLeft);
        eqRepatriations[i] += eqReturn;
        totalEqRepatriated += eqReturn;
        revAvailable -= eqReturn;
      }
      if (revAvailable > 0) {
        profitDist[i] += revAvailable;
      }
    }

    // ── 10. Record closing balances ────────────────────────────────────────────
    snrBalance[i] = Math.max(0, snrRunningBalance);
    mzBalance[i] = Math.max(0, mzRunningBalance);
    peakDebt = Math.max(peakDebt, snrRunningBalance + llRunningBalance + mzRunningBalance);
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
    seniorFacilitySize: totalSnrDrawn,
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
