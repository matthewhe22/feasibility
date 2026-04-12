import type { AdminConfig, MainInputs, DashboardData, MonthlyCashflow } from '../types';
import { generateTimeline } from './timeline';
import { spreadCosts, spreadLandPayments, clearSCurveWarnings, getSCurveWarnings } from './costSpreading';
import { spreadSettlements, spreadDeposits, spreadIncome, spreadBackEndCommissions, calculateSellingCommissions, totalGRV, totalNRV } from './revenue';
import { solveFunding } from './funding';
import { sum, calculateIRR } from '../utils';

export function runCalculations(admin: AdminConfig, inputs: MainInputs): DashboardData {
  // Reset S-curve warnings for this run
  clearSCurveWarnings();

  const periods = generateTimeline(admin, inputs);
  const n = periods.length;
  const gstRate = inputs.landPurchase.gstRate;
  const buildSCurves = admin.buildSCurves ?? {};

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

  const devCosts = spreadCosts(inputs.developmentCosts, periods, admin.manualSCurves, buildSCurves);
  const constCosts = spreadCosts(inputs.constructionCosts, periods, admin.manualSCurves, buildSCurves);

  // Contingency
  const totalConstruction = sum(inputs.constructionCosts.map(c => c.totalCosts));
  const contingencyTotal = totalConstruction * inputs.constructionContingencyPercent;
  const contingency = constCosts.map(c => totalConstruction > 0 ? c / totalConstruction * contingencyTotal : 0);

  const marketingCosts = spreadCosts(inputs.marketingCosts, periods, admin.manualSCurves, buildSCurves);
  const otherStdCosts = spreadCosts(inputs.otherStandardCosts, periods, admin.manualSCurves, buildSCurves);
  const otherFinCosts = spreadCosts(inputs.otherFinancingCosts, periods, admin.manualSCurves, buildSCurves);

  // Selling costs — computed early so PM fee dynamic calculation can use commission totals
  const commissions = calculateSellingCommissions(inputs.grvItems, inputs.sellingCosts);
  // Spread front-end commissions across presale period
  const frontEndCommByPeriod = new Array(n).fill(0);
  if (commissions.frontEnd > 0) {
    const presaleItems = inputs.grvItems.filter(g => g.preSaleExchangeMonth > 0);
    if (presaleItems.length > 0) {
      const firstPresale = Math.min(...presaleItems.map(g => g.preSaleExchangeMonth));
      const lastPresale = Math.max(...presaleItems.map(g => g.preSaleExchangeMonth + g.preSaleSpan));
      const span = lastPresale - firstPresale;
      if (span > 0) {
        const perMonth = commissions.frontEnd / span;
        for (let i = firstPresale - 1; i < lastPresale - 1 && i < n; i++) {
          frontEndCommByPeriod[i] = perMonth;
        }
      }
    }
  }

  // Back-end commissions spread at settlement months
  const backEndCommByPeriod = spreadBackEndCommissions(inputs.grvItems, inputs.sellingCosts, periods);

  // ===== PM FEES (dynamic: rate × all other costs) =====
  // PM fee = rate × (all costs excluding PM fee itself)
  // We calculate all costs first, then compute PM fee total dynamically.
  const totalCostsExcPM =
    sum(landPayments) + sum(prsvPayments) + sum(acquisitionCosts) +
    sum(devCosts) + sum(constCosts) + sum(contingency) +
    sum(marketingCosts) + sum(otherStdCosts) + sum(otherFinCosts) +
    sum(frontEndCommByPeriod) + sum(backEndCommByPeriod);
  // PM fee rate comes from the item's `units` field (e.g. 0.02 = 2%)
  const pmFeeRate = (inputs.pmFees.length > 0 && inputs.pmFees[0].units > 0)
    ? inputs.pmFees[0].units
    : 0.02;
  const dynamicPMFeeTotal = pmFeeRate * totalCostsExcPM;
  const pmFeesWithTotal = inputs.pmFees.map((f, idx) =>
    idx === 0 ? { ...f, totalCosts: dynamicPMFeeTotal } : f
  );
  const pmFees = spreadCosts(pmFeesWithTotal, periods, admin.manualSCurves, buildSCurves);

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
    ...inputs.otherStandardCosts,
    ...inputs.otherFinancingCosts,
  ];
  for (const item of allCostItems) {
    if (item.addGST) {
      const spread = spreadCosts([item], periods, admin.manualSCurves, buildSCurves);
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
    gstOnRevenue,
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

  // Capitalisation flags — capitalised interest/fees accrete to the loan balance
  // and are NOT cash outflows in the period they accrue.  They inflate the balance
  // which is then swept out through repayments when revenue arrives, so they must
  // be excluded from the net cashflow formula to preserve net = 0 each period.
  const seniorCapitalised = inputs.seniorFacility.isCapitalised;
  const mezzCapitalised   = inputs.mezzanine.isCapitalised;

  // Calculate net cashflow — includes all cash financing flows so that it represents
  // the true change in the project bank account each period.
  // Net should be ≈ 0 every period: drawdowns fund costs, revenue repays debt.
  // Capitalised interest is excluded because it is a balance adjustment, not cash.
  let cumCF = 0;
  for (const cf of cashflows) {
    cf.netCashflow =
      // Operating inflows
      cf.grvSettlements + cf.rentalIncome + cf.otherIncome
      // Financing inflows (drawdowns + equity injections)
      + cf.landLoanDrawdown + cf.seniorDrawdown + cf.mezzDrawdown + cf.equityInjection
      // Operating costs (base costs + GST paid to vendors + GST remitted to ATO)
      - cf.landCosts - cf.acquisitionCosts - cf.developmentCosts
      - cf.constructionCosts - cf.contingency - cf.marketingCosts
      - cf.otherStandardCosts - cf.pmFees - cf.sellingCostsFrontEnd
      - cf.sellingCostsBackEnd - cf.otherFinancingCosts - cf.gstOnCosts
      - cf.gstOnRevenue
      // Cash financing costs (land loan is never capitalised)
      - cf.landLoanInterest
      // Senior/mezz interest & fees only if they are cash (non-capitalised)
      - (seniorCapitalised ? 0 : cf.seniorInterest + cf.seniorFees)
      - (mezzCapitalised   ? 0 : cf.mezzInterest   + cf.mezzFees)
      // Financing outflows (principal repayments + equity returns)
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
  // PM fee total is now dynamic (computed above)
  const totalPMFees = dynamicPMFeeTotal;
  const totalOtherFin = sum(inputs.otherFinancingCosts.map(c => c.totalCosts));

  // GST totals
  const totalGSTOnCosts = sum(gstOnCosts);

  // Senior finance costs = senior interest + senior fees only (land loan is a separate facility)
  const totalSeniorFinCosts = funding.totalSeniorInterest + funding.totalSeniorFees;
  const totalLandLoanFinCosts = funding.totalLandLoanInterest + funding.totalLandLoanFees;
  const totalMezzFinCosts = funding.totalMezzInterest + funding.totalMezzFees;

  // Standard costs = dev costs + other std
  const standardCosts = totalDevCosts + totalOtherStd;

  const totalCost = totalLand + totalStampDuty + totalBuildCosts + totalContingency +
    totalSeniorFinCosts + totalLandLoanFinCosts + totalMezzFinCosts + totalOtherFin +
    standardCosts + totalGSTOnCosts + totalMarketing + commissions.total + totalPMFees;

  const totalProfit = grv - totalCost;

  // Preferred equity coupon (accrued over project duration at simple interest)
  const prefEquityBalance = inputs.equityPreferred.fixedAmount;
  const prefEquityRate = inputs.equityPreferred.interestRate;
  const projectDuration = inputs.preliminary.projectSpanMonths;
  const years = projectDuration / 12;
  const loanCouponInterest = prefEquityBalance > 0 && prefEquityRate > 0
    ? prefEquityBalance * prefEquityRate * years
    : 0;
  const totalProfitAfterCoupon = totalProfit - loanCouponInterest;

  // NRV
  const backEndSelling = commissions.backEnd;
  const nrvValue = totalNRV(inputs.grvItems, gstRate, backEndSelling);

  // Capital stack — senior amount is principal drawn only (land loan already refinanced into senior)
  const seniorAmount = funding.seniorFacilitySize;
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
  // Cash-on-Cash = profit / equity (not equity multiple which would be (profit+equity)/equity)
  const cashOnCash = equityContrib > 0 ? totalProfitAfterCoupon / equityContrib : 0;
  // Annualised CoC = compound annual return: (1 + totalReturn)^(1/years) - 1
  const annualCoC = equityContrib > 0 && years > 0
    ? Math.pow(1 + totalProfitAfterCoupon / equityContrib, 1 / years) - 1
    : 0;
  const roi = totalCost > 0 ? totalProfit / totalCost : 0;

  // IRR - monthly equity cashflows
  const equityCFs = cashflows.map(cf => -cf.equityInjection + cf.equityRepatriation + cf.profitDistribution);
  const irr = calculateIRR(equityCFs, 0.015);

  // Key dates
  const constructionStart = inputs.constructionCosts[0]?.monthStart || 33;
  const constructionSpan = inputs.constructionCosts[0]?.monthSpan || 41;
  const settlementMonths = inputs.grvItems.map(g => g.settlementMonth).filter(m => m > 0);
  const lastSettlement = settlementMonths.length > 0 ? Math.max(...settlementMonths) : 0;
  const presaleMonths = inputs.grvItems.filter(g => g.preSaleExchangeMonth > 0).map(g => g.preSaleExchangeMonth);
  const salesStart = presaleMonths.length > 0 ? Math.min(...presaleMonths) : 0;

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
      seniorFinanceCosts: totalSeniorFinCosts + totalLandLoanFinCosts,
      mezzFinanceCosts: totalMezzFinCosts,
      otherFinancingCosts: totalOtherFin,
      standardCosts,
      gst: totalGSTOnCosts,
      marketingAndAdvertising: totalMarketing,
      salesCommissions: commissions.total,
      pmFee: totalPMFees,
      totalCost,
      totalProfit,
      loanCouponInterest,
      totalProfitAfterCoupon,
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
      developer: {
        entity: 'Developer',
        fundingContribPercent: inputs.equityKokoda.equityContribution,
        totalEquityContributed: equityContrib * inputs.equityKokoda.equityContribution,
        irr,
        equityRepatriation1st: 0,
        equityRepatriation2nd: equityContrib * inputs.equityKokoda.equityContribution,
        totalEquityRepatriation: equityContrib * inputs.equityKokoda.equityContribution,
        establishmentFee: 0,
        couponInterest: loanCouponInterest,
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
    warnings: getSCurveWarnings(),
  };
}
