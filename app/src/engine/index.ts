import type { AdminConfig, MainInputs, DashboardData, MonthlyCashflow } from '../types';
import { generateTimeline } from './timeline';
import { spreadCosts, spreadLandPayments } from './costSpreading';
import { spreadSettlements, spreadDeposits, spreadIncome, spreadBackEndCommissions, calculateSellingCommissions, totalGRV, totalNRV } from './revenue';
import { solveFunding } from './funding';
import { sum, calculateIRR } from '../utils';

export function runCalculations(admin: AdminConfig, inputs: MainInputs): DashboardData {
  const periods = generateTimeline(admin, inputs);
  const n = periods.length;
  const gstRate = inputs.landPurchase.gstRate;

  // ===== 1. SPREAD COSTS =====
  const landPayments = spreadLandPayments(
    inputs.landPurchase.paymentStages.map(s => ({
      amount: s.amount,
      monthStart: s.monthStart,
      monthSpan: s.monthSpan,
    })),
    periods,
  );

  // PRSV Uplift
  const prsvPayments = new Array(n).fill(0);
  if (inputs.landPurchase.prsvUplift > 0 && inputs.landPurchase.prsvMonth > 0) {
    const idx = inputs.landPurchase.prsvMonth - 1;
    if (idx < n) prsvPayments[idx] = inputs.landPurchase.prsvUplift;
  }

  const acquisitionCosts = spreadLandPayments(
    inputs.landPurchase.acquisitionCosts.map(a => ({
      amount: a.amount,
      monthStart: a.monthStart,
      monthSpan: a.monthSpan,
    })),
    periods,
  );

  const devCosts = spreadCosts(inputs.developmentCosts, periods, admin.manualSCurves);
  const constCosts = spreadCosts(inputs.constructionCosts, periods, admin.manualSCurves);

  // Contingency
  const totalConstruction = sum(inputs.constructionCosts.map(c => c.totalCosts));
  const contingencyTotal = totalConstruction * inputs.constructionContingencyPercent;
  const contingency = constCosts.map(c => totalConstruction > 0 ? c / totalConstruction * contingencyTotal : 0);

  const marketingCosts = spreadCosts(inputs.marketingCosts, periods, admin.manualSCurves);
  const otherStdCosts = spreadCosts(inputs.otherStandardCosts, periods, admin.manualSCurves);
  const pmFees = spreadCosts(inputs.pmFees, periods, admin.manualSCurves);
  const otherFinCosts = spreadCosts(inputs.otherFinancingCosts, periods, admin.manualSCurves);

  // Selling costs
  const commissions = calculateSellingCommissions(inputs.grvItems, inputs.sellingCosts);
  // Spread front-end commissions across presale period
  const frontEndCommByPeriod = new Array(n).fill(0);
  if (commissions.frontEnd > 0) {
    // Spread evenly across presale period
    const firstPresale = Math.min(...inputs.grvItems.filter(g => g.preSaleExchangeMonth > 0).map(g => g.preSaleExchangeMonth));
    const lastPresale = Math.max(...inputs.grvItems.filter(g => g.preSaleExchangeMonth > 0).map(g => g.preSaleExchangeMonth + g.preSaleSpan));
    const span = lastPresale - firstPresale;
    if (span > 0) {
      const perMonth = commissions.frontEnd / span;
      for (let i = firstPresale - 1; i < lastPresale - 1 && i < n; i++) {
        frontEndCommByPeriod[i] = perMonth;
      }
    }
  }

  // Back-end commissions spread at settlement months
  const backEndCommByPeriod = spreadBackEndCommissions(inputs.grvItems, inputs.sellingCosts, periods);

  // ===== 2. SPREAD REVENUE =====
  const settlements = spreadSettlements(inputs.grvItems, periods);
  const deposits = spreadDeposits(inputs.grvItems, periods);
  const rentalInc = spreadIncome(inputs.rentalIncome, periods);
  const otherInc = spreadIncome(inputs.otherIncome, periods);

  // ===== 3. GST =====
  const gstOnCosts = new Array(n).fill(0);
  const gstOnRevenue = new Array(n).fill(0);

  // GST on costs (items with addGST = true)
  const allCostItems = [
    ...inputs.developmentCosts,
    ...inputs.constructionCosts,
    ...inputs.marketingCosts,
    ...inputs.pmFees,
  ];
  for (const item of allCostItems) {
    if (item.addGST) {
      const spread = spreadCosts([item], periods);
      for (let i = 0; i < n; i++) {
        gstOnCosts[i] += spread[i] * gstRate;
      }
    }
  }
  // GST on contingency
  for (let i = 0; i < n; i++) {
    gstOnCosts[i] += contingency[i] * gstRate;
  }
  // GST on selling commissions (front-end at presale, back-end at settlement)
  for (let i = 0; i < n; i++) {
    gstOnCosts[i] += frontEndCommByPeriod[i] * gstRate;
    gstOnCosts[i] += backEndCommByPeriod[i] * gstRate;
  }

  // GST on revenue (residential only)
  for (const item of inputs.grvItems) {
    if (item.gstIncluded && item.currentSalePrice > 0) {
      const gstAmount = item.currentSalePrice * gstRate / (1 + gstRate);
      const settleSpread = spreadSettlements([item], periods);
      for (let i = 0; i < n; i++) {
        if (item.currentSalePrice > 0) {
          gstOnRevenue[i] += settleSpread[i] / item.currentSalePrice * gstAmount;
        }
      }
    }
  }

  const monthlyGSTNet = gstOnRevenue.map((r, i) => r - gstOnCosts[i]);

  // ===== 4. TOTAL COSTS (exc financing) =====
  const monthlyCostsExcFinance = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    monthlyCostsExcFinance[i] =
      landPayments[i] + prsvPayments[i] + acquisitionCosts[i] +
      devCosts[i] + constCosts[i] + contingency[i] +
      marketingCosts[i] + otherStdCosts[i] + pmFees[i] +
      otherFinCosts[i] + frontEndCommByPeriod[i] + backEndCommByPeriod[i] +
      gstOnCosts[i];
  }

  // ===== 5. FUNDING & DEBT SOLVING =====
  const funding = solveFunding(
    periods,
    monthlyCostsExcFinance,
    settlements,
    monthlyGSTNet,
    inputs,
    admin.daysPerYear,
    admin.tolerance,
  );

  // ===== 6. BUILD CASHFLOWS =====
  const cashflows: MonthlyCashflow[] = periods.map((period, i) => ({
    period,
    landCosts: landPayments[i] + prsvPayments[i],
    acquisitionCosts: acquisitionCosts[i],
    developmentCosts: devCosts[i],
    constructionCosts: constCosts[i],
    contingency: contingency[i],
    marketingCosts: marketingCosts[i],
    otherStandardCosts: otherStdCosts[i],
    pmFees: pmFees[i],
    sellingCostsFrontEnd: frontEndCommByPeriod[i],
    sellingCostsBackEnd: backEndCommByPeriod[i],
    lettingFees: 0,
    otherFinancingCosts: otherFinCosts[i],
    gstOnCosts: gstOnCosts[i],
    grvSettlements: settlements[i],
    grvDeposits: deposits[i],
    rentalIncome: rentalInc[i],
    otherIncome: otherInc[i],
    gstOnRevenue: gstOnRevenue[i],
    landLoanDrawdown: funding.landLoanDrawdowns[i],
    landLoanRepayment: funding.landLoanRepayments[i],
    landLoanInterest: funding.landLoanInterest[i],
    seniorDrawdown: funding.seniorDrawdowns[i],
    seniorRepayment: funding.seniorRepayments[i],
    seniorInterest: funding.seniorInterest[i],
    seniorFees: funding.seniorFees[i],
    mezzDrawdown: funding.mezzDrawdowns[i],
    mezzRepayment: funding.mezzRepayments[i],
    mezzInterest: funding.mezzInterest[i],
    mezzFees: funding.mezzFees[i],
    equityInjection: funding.equityInjections[i],
    equityRepatriation: funding.equityRepatriations[i],
    profitDistribution: funding.profitDistributions[i],
    landLoanBalance: funding.landLoanBalance[i],
    seniorBalance: funding.seniorBalance[i],
    mezzBalance: funding.mezzBalance[i],
    equityBalance: 0,
    netCashflow: 0,
    cumulativeCashflow: 0,
  }));

  // Calculate net cashflow — includes all financing flows so that it represents
  // the true change in cash balance each period (should net to ~0 each period
  // when all drawdowns, repayments, equity and costs are accounted for).
  let cumCF = 0;
  for (const cf of cashflows) {
    cf.netCashflow =
      // Operating inflows
      cf.grvSettlements + cf.rentalIncome + cf.otherIncome
      // Financing inflows (drawdowns + equity injections)
      + cf.landLoanDrawdown + cf.seniorDrawdown + cf.mezzDrawdown + cf.equityInjection
      // Operating costs
      - cf.landCosts - cf.acquisitionCosts - cf.developmentCosts
      - cf.constructionCosts - cf.contingency - cf.marketingCosts
      - cf.otherStandardCosts - cf.pmFees - cf.sellingCostsFrontEnd
      - cf.sellingCostsBackEnd - cf.otherFinancingCosts - cf.gstOnCosts
      - cf.gstOnRevenue
      // Financing costs
      - cf.landLoanInterest - cf.seniorInterest - cf.seniorFees
      - cf.mezzInterest - cf.mezzFees
      // Financing outflows (repayments + equity returns)
      - cf.landLoanRepayment - cf.seniorRepayment - cf.mezzRepayment
      - cf.equityRepatriation - cf.profitDistribution;
    cumCF += cf.netCashflow;
    cf.cumulativeCashflow = cumCF;
  }

  // ===== 7. AGGREGATE TOTALS =====
  const grv = totalGRV(inputs.grvItems);
  const totalLand = inputs.landPurchase.landPurchasePrice + inputs.landPurchase.prsvUplift;
  // acquisitionCosts already contains stamp duty — do not double-count stampDutyAmount
  const totalStampDuty = inputs.landPurchase.acquisitionCosts.reduce((s, a) => s + a.amount, 0);
  const totalBuildCosts = sum(inputs.constructionCosts.map(c => c.totalCosts));
  const totalContingency = contingencyTotal;
  const totalDevCosts = sum(inputs.developmentCosts.map(c => c.totalCosts));
  const totalMarketing = sum(inputs.marketingCosts.map(c => c.totalCosts));
  const totalOtherStd = sum(inputs.otherStandardCosts.map(c => c.totalCosts));
  const totalPMFees = sum(inputs.pmFees.map(c => c.totalCosts));
  const totalOtherFin = sum(inputs.otherFinancingCosts.map(c => c.totalCosts));

  // GST totals
  const totalGSTOnCosts = sum(gstOnCosts);

  const totalSeniorFinCosts = funding.totalSeniorInterest + funding.totalSeniorFees + funding.totalLandLoanInterest + funding.totalLandLoanFees;
  const totalMezzFinCosts = funding.totalMezzInterest + funding.totalMezzFees;

  // Standard costs = dev costs + other std
  const standardCosts = totalDevCosts + totalOtherStd;

  const totalCost = totalLand + totalStampDuty + totalBuildCosts + totalContingency +
    totalSeniorFinCosts + totalMezzFinCosts + totalOtherFin +
    standardCosts + totalGSTOnCosts + totalMarketing + commissions.total + totalPMFees;

  const totalProfit = grv - totalCost;

  // NRV
  const backEndSelling = commissions.backEnd;
  const nrvValue = totalNRV(inputs.grvItems, gstRate, backEndSelling);

  // Capital stack
  const seniorAmount = funding.seniorFacilitySize + funding.totalLandLoanInterest + funding.totalLandLoanFees;
  const mezzAmount = funding.mezzFacilitySize;
  const totalCapital = seniorAmount + mezzAmount + funding.totalEquityInjected;
  const seniorLTC = totalCost > 0 ? seniorAmount / totalCost : 0;
  const seniorLVR = nrvValue > 0 ? seniorAmount / nrvValue : 0;
  const mezzLTC = totalCost > 0 ? mezzAmount / totalCost : 0;
  const mezzLVR = nrvValue > 0 ? mezzAmount / nrvValue : 0;
  const equityLTC = totalCost > 0 ? funding.totalEquityInjected / totalCost : 0;
  const equityLVR = nrvValue > 0 ? funding.totalEquityInjected / nrvValue : 0;

  // KPIs
  const equityContrib = funding.totalEquityInjected;
  const projectDuration = inputs.preliminary.projectSpanMonths;
  const years = projectDuration / 12;
  const cashOnCash = equityContrib > 0 ? (totalProfit + equityContrib) / equityContrib : 0;
  const annualCoC = years > 0 ? cashOnCash / years : 0;
  const roi = totalCost > 0 ? totalProfit / totalCost : 0;

  // IRR - monthly equity cashflows
  const equityCFs = cashflows.map(cf => -cf.equityInjection + cf.equityRepatriation + cf.profitDistribution);
  const irr = calculateIRR(equityCFs, 0.015);

  // Key dates
  const constructionStart = inputs.constructionCosts[0]?.monthStart || 33;
  const constructionSpan = inputs.constructionCosts[0]?.monthSpan || 41;
  const lastSettlement = Math.max(...inputs.grvItems.map(g => g.settlementMonth));
  const salesStart = Math.min(...inputs.grvItems.filter(g => g.preSaleExchangeMonth > 0).map(g => g.preSaleExchangeMonth));

  function monthLabel(monthNum: number): string {
    if (monthNum <= 0 || monthNum > periods.length) return 'N/A';
    return periods[monthNum - 1]?.label || 'N/A';
  }

  // Debt rates
  const seniorAllIn = inputs.seniorFacility.margin + inputs.seniorFacility.bbsy;
  const landAllIn = inputs.landLoan.interestRate;
  const mezzAllIn = inputs.mezzanine.interestRate;

  // Peak interest holding cost
  const maxMonthlyInterest = Math.max(...cashflows.map(cf =>
    cf.seniorInterest + cf.seniorFees + cf.landLoanInterest + cf.mezzInterest + cf.mezzFees
  ));

  // GRV Summary
  const totalAptGRV = inputs.grvItems
    .filter(g => g.revenueType === 'Residential')
    .reduce((s, g) => s + g.currentSalePrice, 0);

  // GRV sold/exchanged: items whose presale exchange month falls within the actuals window
  const lastActualPeriodNum = periods.reduce((last, p) => p.isActual ? Math.max(last, p.periodNumber) : last, 0);
  const grvSoldExchanged = inputs.grvItems
    .filter(g => g.preSaleExchangeMonth > 0 && g.preSaleExchangeMonth <= lastActualPeriodNum)
    .reduce((s, g) => s + g.currentSalePrice, 0);

  return {
    feasibility: {
      totalGRV: grv,
      land: totalLand,
      stampDuty: totalStampDuty,
      buildCosts: totalBuildCosts + totalContingency,
      contingency: totalContingency,
      seniorFinanceCosts: totalSeniorFinCosts,
      mezzFinanceCosts: totalMezzFinCosts,
      otherFinancingCosts: totalOtherFin,
      standardCosts,
      gst: totalGSTOnCosts,
      marketingAndAdvertising: totalMarketing,
      salesCommissions: commissions.total,
      pmFee: totalPMFees,
      totalCost,
      totalProfit,
      loanCouponInterest: 0,
      totalProfitAfterCoupon: totalProfit,
    },
    kpis: {
      totalCashOnCash: cashOnCash,
      annualCashOnCash: annualCoC,
      roi,
      irr,
    },
    capitalStack: {
      seniorAmount,
      seniorLTC,
      seniorLVR,
      mezzAmount,
      mezzLTC,
      mezzLVR,
      equityAmount: equityContrib,
      equityLTC,
      equityLVR,
      total: totalCapital,
    },
    debtSummary: {
      seniorPrincipal: funding.seniorFacilitySize,
      seniorInterest: funding.totalSeniorInterest + funding.totalSeniorFees,
      seniorTotal: funding.seniorFacilitySize + funding.totalSeniorInterest + funding.totalSeniorFees,
      mezzPrincipal: funding.mezzFacilitySize,
      mezzInterest: funding.totalMezzInterest + funding.totalMezzFees,
      mezzTotal: funding.mezzFacilitySize + funding.totalMezzInterest + funding.totalMezzFees,
      totalPrincipal: funding.seniorFacilitySize + funding.mezzFacilitySize,
      totalInterest: funding.totalSeniorInterest + funding.totalSeniorFees + funding.totalMezzInterest + funding.totalMezzFees,
      totalDebt: funding.seniorFacilitySize + funding.totalSeniorInterest + funding.totalSeniorFees + funding.mezzFacilitySize + funding.totalMezzInterest + funding.totalMezzFees,
    },
    debtRates: {
      seniorEstablishment: inputs.seniorFacility.establishmentFeePercent,
      seniorLineFee: inputs.seniorFacility.lineFeePercent,
      seniorMargin: inputs.seniorFacility.margin,
      seniorBBSY: inputs.seniorFacility.bbsy,
      seniorAllIn: seniorAllIn,
      mezzEstablishment: inputs.mezzanine.establishmentFeePercent,
      mezzLineFee: inputs.mezzanine.lineFeePercent,
      mezzMargin: inputs.mezzanine.interestRate,
      mezzBBSY: 0,
      mezzAllIn: mezzAllIn,
      landEstablishment: inputs.landLoan.establishmentFeePercent,
      landLineFee: inputs.landLoan.lineFeePercent,
      landMargin: inputs.landLoan.interestRate,
      landBBSY: 0,
      landAllIn: landAllIn,
    },
    keyDates: {
      contractStartDate: monthLabel(1),
      establishJV: monthLabel(projectDuration),
      salesCommencement: monthLabel(salesStart),
      landSettlement: monthLabel(inputs.landLoan.startMonth),
      constructionStart: monthLabel(constructionStart),
      constructionCompletion: monthLabel(constructionStart + constructionSpan - 1),
      salesSettlementCompleted: monthLabel(lastSettlement),
      projectDurationMonths: projectDuration,
      constructionTimeMonths: constructionSpan,
      planningDesignMonths: constructionStart - 1,
      landToSettlementMonths: lastSettlement - inputs.landLoan.startMonth,
    },
    equityReturns: {
      total: {
        entity: 'Total',
        fundingContribPercent: 1,
        totalEquityContributed: equityContrib,
        irr,
        equityRepatriation1st: 0,
        equityRepatriation2nd: equityContrib,
        totalEquityRepatriation: equityContrib,
        establishmentFee: 0,
        couponInterest: 0,
        couponInterestPercent: 0,
        profitShareBalance: totalProfit,
        profitSharePercent: 1,
        totalProfitShare: totalProfit,
      },
      jvPartner: {
        entity: 'JV Partner',
        fundingContribPercent: inputs.equityJV.equityContribution,
        totalEquityContributed: equityContrib * inputs.equityJV.equityContribution,
        irr: 0,
        equityRepatriation1st: 0,
        equityRepatriation2nd: equityContrib * inputs.equityJV.equityContribution,
        totalEquityRepatriation: equityContrib * inputs.equityJV.equityContribution,
        establishmentFee: 0,
        couponInterest: 0,
        couponInterestPercent: inputs.equityJV.interestRate,
        profitShareBalance: totalProfit * inputs.equityJV.profitShare,
        profitSharePercent: inputs.equityJV.profitShare,
        totalProfitShare: totalProfit * inputs.equityJV.profitShare,
      },
      kokoda: {
        entity: 'Kokoda',
        fundingContribPercent: inputs.equityKokoda.equityContribution,
        totalEquityContributed: equityContrib * inputs.equityKokoda.equityContribution,
        irr,
        equityRepatriation1st: 0,
        equityRepatriation2nd: equityContrib * inputs.equityKokoda.equityContribution,
        totalEquityRepatriation: equityContrib * inputs.equityKokoda.equityContribution,
        establishmentFee: 0,
        couponInterest: 0,
        couponInterestPercent: inputs.equityKokoda.interestRate,
        profitShareBalance: totalProfit * inputs.equityKokoda.profitShare,
        profitSharePercent: inputs.equityKokoda.profitShare,
        totalProfitShare: totalProfit * inputs.equityKokoda.profitShare,
      },
    },
    otherIndicators: {
      peakInterestHoldingCostPerMonth: maxMonthlyInterest,
    },
    grvSummary: {
      totalApartmentGRV: totalAptGRV,
      grvSoldExchanged: grvSoldExchanged,
      unsoldGRV: totalAptGRV - grvSoldExchanged,
    },
    cashflows,
  };
}
