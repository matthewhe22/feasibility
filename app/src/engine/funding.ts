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
  let llAccruedInterest = 0; // quarterly land loan interest accumulator

  // Equity tracking (for cap enforcement and return ordering)
  let cumulativeEquity = 0;
  let totalEqRepatriated = 0;

  // Mezz is non-revolving: track total drawn for capacity limit
  let totalMezzDrawn = 0;

  // Reporting totals
  let totalSeniorInterest = 0;
  let totalSeniorFees = 0;
  let totalMezzInterest = 0;
  let totalMezzFees = 0;
  let totalLandInterest = 0;
  let totalLandFees = 0;
  let peakDebt = 0;
  let peakSnrBalance = 0; // for seniorFacilitySize (peak outstanding balance)

  const snrAllInRate = senior.margin + senior.bbsy;
  const mezzAllInRate = mezz.margin + mezz.bbsy;

  // ===== SINGLE PASS: Bank-balance approach =====
  //
  // Each period starts with bankBalance = 0 (all prior cash was swept).
  // Cash flows within the period adjust bankBalance; gap fill draws if negative;
  // surplus sweeps to repayments then equity return then profit.
  //
  // The senior facility is REVOLVING: repayments restore drawing capacity.
  // Available senior capacity = seniorLimit - snrRunningBalance (balance-based).
  // When snrRunningBalance falls (via repayment), capacity is automatically restored.
  //
  // Loop order:
  //   1. Save opening balances (for interest calculations)
  //   2. Land loan lump-sum draw + establishment fee
  //   3. Land loan interest (accrued quarterly on opening balance)
  //   4. Land loan repayment at snrStartIdx (flush accrued interest then principal)
  //   5. Operating costs deducted from bankBalance
  //   6. Senior & mezz interest/fees:
  //      – capitalised → accrete to running balance (no cash flow)
  //      – non-capitalised → deducted from bankBalance (cash outflow, covered by gap fill)
  //   7. Senior initialisation: refi land loan into senior; repatriate excess equity
  //   8. Revenue added to bankBalance
  //   9. Gap fill: draw from facilities (in configured priority) to cover bankBalance < 0
  //  10. Revenue sweep: if bankBalance > 0, repay debt → return equity → distribute profit
  //  11. Record closing balances

  for (let i = 0; i < n; i++) {
    const days = periods[i].daysInPeriod;
    const seniorActive = hasSenior && i >= snrStartIdx;

    // ── 1. Save opening balances (before any period activity) ──────────────────
    const llOpenBalance  = llRunningBalance;
    const snrOpenBalance = snrRunningBalance;
    const mzOpenBalance  = mzRunningBalance;

    // Period cash position — resets to zero each period (prior surplus was swept)
    let bankBalance = 0;

    // ── 2. Land loan lump-sum draw + establishment fee ─────────────────────────
    if (i === llStartIdx && landLoan.facilityLimit > 0) {
      llDrawdowns[i] = landLoan.facilityLimit;
      llRunningBalance += landLoan.facilityLimit;
      bankBalance += landLoan.facilityLimit;
      const estFee = landLoan.facilityLimit * landLoan.establishmentFeePercent;
      if (estFee > 0) {
        llFees[i] = estFee;
        totalLandFees += estFee;
        bankBalance -= estFee; // establishment fee is a cash outflow
      }
    }

    // ── 3. Land loan interest on opening balance (accrued quarterly) ───────────
    // Interest accrues on the opening balance; charged at quarter-end.
    // In the draw period, opening balance = 0, so no interest is due (correct).
    if (llOpenBalance > 0) {
      const accrued = periodInterest(llOpenBalance, landLoan.interestRate, days, daysPerYear);
      llAccruedInterest += accrued;

      const monthsSinceLLStart = i - llStartIdx;
      const freq = landLoan.interestPaymentFrequency > 0 ? landLoan.interestPaymentFrequency : 1;
      if ((monthsSinceLLStart + 1) % freq === 0) {
        llInterest[i] = llAccruedInterest;
        totalLandInterest += llAccruedInterest;
        bankBalance -= llAccruedInterest; // cash outflow
        llAccruedInterest = 0;
      }
    }

    // ── 4. Land loan repayment at senior start (refinanced into senior) ────────
    if (hasSenior && i === snrStartIdx && llRunningBalance > 0) {
      // Flush any remaining accrued interest before closing the land loan
      if (llAccruedInterest > 0) {
        llInterest[i] += llAccruedInterest;
        totalLandInterest += llAccruedInterest;
        bankBalance -= llAccruedInterest;
        llAccruedInterest = 0;
      }
      llRepayments[i] = llRunningBalance;
      bankBalance -= llRunningBalance; // cash outflow — funded by step 7 senior refi draw
      llRunningBalance = 0;
    }
    llBalance[i] = llRunningBalance;

    // ── 5. Operating costs ─────────────────────────────────────────────────────
    bankBalance -= monthlyCostsExcFinance[i];

    // ── 6. Senior & mezz interest/fees (on opening balances, before gap fill) ───
    //
    // Capitalised charges accrete to the running balance (no cash impact).
    // Non-capitalised charges are deducted from bankBalance — gap fill in step 9
    // will draw enough to cover them if bankBalance goes negative.

    // Senior interest on opening balance
    if (snrOpenBalance > 0) {
      const snrInt = periodInterest(snrOpenBalance, snrAllInRate, days, daysPerYear);
      snrInterest[i] = snrInt;
      totalSeniorInterest += snrInt;
      if (senior.isCapitalised) {
        snrRunningBalance += snrInt; // accretes to balance, no cash flow
      } else {
        bankBalance -= snrInt;
      }
    }

    // Senior fees: line fee on outstanding balance; establishment fee once at start
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
          bankBalance -= periodFees;
        }
      }
    }

    // Mezzanine interest on opening balance
    if (mzOpenBalance > 0) {
      const mzInt = periodInterest(mzOpenBalance, mezzAllInRate, days, daysPerYear);
      mzInterest[i] = mzInt;
      totalMezzInterest += mzInt;
      if (mezz.isCapitalised) {
        mzRunningBalance += mzInt;
      } else {
        bankBalance -= mzInt;
      }

      // Mezz line fee on opening balance
      const mzLineFee = periodInterest(mezzLimit, mezz.lineFeePercent, days, daysPerYear);
      if (mzLineFee > 0) {
        mzFees[i] += mzLineFee;
        totalMezzFees += mzLineFee;
        if (mezz.isCapitalised) {
          mzRunningBalance += mzLineFee;
        } else {
          bankBalance -= mzLineFee;
        }
      }
    }

    // Mezzanine establishment fee (once at facility start)
    if (hasMezz && i === mezzStartIdx) {
      const mzEstFee = mezzLimit * mezz.establishmentFeePercent;
      if (mzEstFee > 0) {
        mzFees[i] += mzEstFee;
        totalMezzFees += mzEstFee;
        if (mezz.isCapitalised) {
          mzRunningBalance += mzEstFee;
        } else {
          bankBalance -= mzEstFee;
        }
      }
    }

    // ── 7. Senior initialisation: land loan refi + excess equity repatriation ──
    if (hasSenior && i === snrStartIdx) {
      // Senior draws to fund the land loan repayment (step 4 deducted it)
      if (llRepayments[i] > 0) {
        snrDrawdowns[i] += llRepayments[i];
        snrRunningBalance += llRepayments[i];
        bankBalance += llRepayments[i]; // offsets step 4 deduction — net = 0
      }
      // If equity was over-injected before senior start, repatriate excess via senior draw
      if (cumulativeEquity > equityCap) {
        const excess = cumulativeEquity - equityCap;
        const snrAvail = Math.max(0, seniorLimit - snrRunningBalance);
        const draw = Math.min(excess, snrAvail);
        if (draw > 0) {
          snrDrawdowns[i] += draw;
          snrRunningBalance += draw;
          eqRepatriations[i] += draw;
          cumulativeEquity -= draw;
          // bankBalance: +draw (senior draw) then -draw (equity return) = net 0
        }
      }
    }

    // ── 8. Revenue: add to bankBalance ────────────────────────────────────────
    bankBalance += monthlyRevenue[i] - gstOnRevenue[i];

    // ── 9. Gap fill: draw from facilities to cover negative bankBalance ─────────
    //
    // Senior is REVOLVING — available capacity = seniorLimit - snrRunningBalance.
    // After settlement revenue repays senior in step 10, capacity is restored,
    // allowing senior to be redrawn in subsequent construction periods.
    if (bankBalance < 0) {
      for (const entry of drawdownSequence) {
        if (bankBalance >= 0) break;

        if (entry.type === 'senior' && seniorActive) {
          // Available = limit minus current outstanding balance (revolving)
          const avail = Math.max(0, seniorLimit - snrRunningBalance);
          if (avail > 0) {
            const draw = Math.min(-bankBalance, avail);
            snrDrawdowns[i] += draw;
            snrRunningBalance += draw;
            bankBalance += draw;
          }
        } else if (entry.type === 'mezz' && hasMezz && i >= mezzStartIdx) {
          // Mezz is non-revolving: capacity depletes with total draws
          const avail = Math.max(0, mezzLimit - totalMezzDrawn);
          if (avail > 0) {
            const draw = Math.min(-bankBalance, avail);
            mzDrawdowns[i] += draw;
            mzRunningBalance += draw;
            totalMezzDrawn += draw;
            bankBalance += draw;
          }
        } else if (entry.type === 'equity') {
          const avail = Math.max(0, equityCap - cumulativeEquity);
          if (avail > 0) {
            const draw = Math.min(-bankBalance, avail);
            eqInjections[i] += draw;
            cumulativeEquity += draw;
            bankBalance += draw;
          }
        }
      }

      // Equity backstop: inject uncapped equity if all configured facilities exhausted
      if (bankBalance < 0) {
        const backstop = -bankBalance;
        eqInjections[i] += backstop;
        cumulativeEquity += backstop;
        bankBalance = 0;
      }
    }

    // ── 10. Revenue sweep: surplus → senior → mezz → equity return → profit ────
    //
    // Repaying senior restores its revolving capacity (snrRunningBalance falls →
    // seniorLimit - snrRunningBalance rises), enabling redraws in future periods.
    if (bankBalance > 0) {
      if (snrRunningBalance > 0) {
        const repay = Math.min(bankBalance, snrRunningBalance);
        snrRepayments[i] = repay;
        snrRunningBalance -= repay;
        bankBalance -= repay;
      }
      if (bankBalance > 0 && mzRunningBalance > 0) {
        const repay = Math.min(bankBalance, mzRunningBalance);
        mzRepayments[i] = repay;
        mzRunningBalance -= repay;
        bankBalance -= repay;
      }
      if (bankBalance > 0) {
        const equityLeft = cumulativeEquity - totalEqRepatriated;
        if (equityLeft > 0) {
          const eqReturn = Math.min(bankBalance, equityLeft);
          eqRepatriations[i] += eqReturn;
          totalEqRepatriated += eqReturn;
          bankBalance -= eqReturn;
        }
        if (bankBalance > 0) {
          profitDist[i] = bankBalance;
          bankBalance = 0;
        }
      }
    }

    // ── 11. Record closing balances ────────────────────────────────────────────
    snrBalance[i] = Math.max(0, snrRunningBalance);
    mzBalance[i] = Math.max(0, mzRunningBalance);
    peakDebt = Math.max(peakDebt, snrRunningBalance + llRunningBalance + mzRunningBalance);
    peakSnrBalance = Math.max(peakSnrBalance, snrRunningBalance);
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
    seniorFacilitySize: peakSnrBalance,
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
