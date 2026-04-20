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
  // When a payment stage has a percentOfLand > 0, derive the cash amount from
  // the user-entered landPurchasePrice so the cashflow always sums to the land
  // price shown in the inputs — even after the user edits that field without
  // manually updating every stage amount.
  const landPayments = spreadLandPayments(
    inputs.landPurchase.paymentStages.map(s => ({
      amount: s.percentOfLand > 0
        ? s.percentOfLand * inputs.landPurchase.landPurchasePrice
        : s.amount,
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
  // NOTE: use explicit === true check so that legacy saved items where addGST is
  // undefined (field added after the project was first saved) still get GST applied.
  // Items that were intentionally set to false will remain GST-free.
  const allCostItems = [
    ...inputs.developmentCosts,
    ...inputs.constructionCosts,
    ...inputs.marketingCosts,
    // Use pmFeesWithTotal so the dynamic PM fee total is used for GST calculation
    ...pmFeesWithTotal,
    ...inputs.otherStandardCosts,
    ...inputs.otherFinancingCosts,
  ];
  for (const item of allCostItems) {
    // Treat undefined as true (apply GST) — explicit false means GST-free
    if (item.addGST !== false) {
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
  // Include rental and other income in the waterfall so these cash flows are
  // swept to debt repayment / profit distribution rather than left as a
  // positive residual in the cumulative cashflow.
  const totalMonthlyRevenue = settlements.map((s, i) => s + rentalInc[i] + otherInc[i]);
  const funding = solveFunding(
    periods,
    monthlyCostsExcFinance,
    totalMonthlyRevenue,
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
    landLoanFees: funding.landLoanFees[i],
    seniorDrawdown: funding.seniorDrawdowns[i],
    seniorRepayment: funding.seniorRepayments[i],
    seniorInterest: funding.seniorInterest[i],
    seniorFees: funding.seniorFees[i],
    senior2Drawdown: funding.senior2Drawdowns[i],
    senior2Repayment: funding.senior2Repayments[i],
    senior2Interest: funding.senior2Interest[i],
    senior2Fees: funding.senior2Fees[i],
    senior3Drawdown: funding.senior3Drawdowns[i],
    senior3Repayment: funding.senior3Repayments[i],
    senior3Interest: funding.senior3Interest[i],
    senior3Fees: funding.senior3Fees[i],
    mezzDrawdown: funding.mezzDrawdowns[i],
    mezzRepayment: funding.mezzRepayments[i],
    mezzInterest: funding.mezzInterest[i],
    mezzFees: funding.mezzFees[i],
    equityInjection: funding.equityInjections[i],
    equityRepatriation: funding.equityRepatriations[i],
    profitDistribution: funding.profitDistributions[i],
    landLoanBalance: funding.landLoanBalance[i],
    seniorBalance: funding.seniorBalance[i],
    senior2Balance: funding.senior2Balance[i],
    senior3Balance: funding.senior3Balance[i],
    mezzBalance: funding.mezzBalance[i],
    equityBalance: 0,
    netCashflow: 0,
    cumulativeCashflow: 0,
  }));

  // Capitalisation flags — capitalised interest/fees accrete to the loan balance
  // and are NOT cash outflows in the period they accrue.  They inflate the balance
  // which is then swept out through repayments when revenue arrives, so they must
  // be excluded from the net cashflow formula to preserve net = 0 each period.
  const seniorCapitalised  = inputs.seniorFacility.isCapitalised;
  const senior2Capitalised = inputs.seniorFacility2.isCapitalised;
  const senior3Capitalised = inputs.seniorFacility3.isCapitalised;
  const mezzCapitalised    = inputs.mezzanine.isCapitalised;

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
      + cf.landLoanDrawdown + cf.seniorDrawdown + cf.senior2Drawdown + cf.senior3Drawdown
      + cf.mezzDrawdown + cf.equityInjection
      // Operating costs (base costs + GST paid to vendors + GST remitted to ATO)
      - cf.landCosts - cf.acquisitionCosts - cf.developmentCosts
      - cf.constructionCosts - cf.contingency - cf.marketingCosts
      - cf.otherStandardCosts - cf.pmFees - cf.sellingCostsFrontEnd
      - cf.sellingCostsBackEnd - cf.otherFinancingCosts - cf.gstOnCosts
      - cf.gstOnRevenue
      // Cash financing costs (land loan is never capitalised)
      - cf.landLoanInterest - cf.landLoanFees
      // Senior/mezz interest & fees only if they are cash (non-capitalised)
      - (seniorCapitalised  ? 0 : cf.seniorInterest  + cf.seniorFees)
      - (senior2Capitalised ? 0 : cf.senior2Interest + cf.senior2Fees)
      - (senior3Capitalised ? 0 : cf.senior3Interest + cf.senior3Fees)
      - (mezzCapitalised    ? 0 : cf.mezzInterest    + cf.mezzFees)
      // Financing outflows (principal repayments + equity returns)
      - cf.landLoanRepayment - cf.seniorRepayment - cf.senior2Repayment - cf.senior3Repayment
      - cf.mezzRepayment - cf.equityRepatriation - cf.profitDistribution;
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
  // GST on revenue is remitted to the ATO — it is a cash outflow that reduces
  // what the developer actually receives from settlements.  Deducting it from
  // totalProfit ensures the dashboard figure equals sum(profitDistributions)
  // from the funding waterfall, which uses periodNetCash = revenue − gstOnRevenue − costs.
  const totalGSTOnRevenue = sum(gstOnRevenue);

  const totalSeniorFinCosts   = funding.totalSeniorInterest  + funding.totalSeniorFees
                              + funding.totalSenior2Interest + funding.totalSenior2Fees
                              + funding.totalSenior3Interest + funding.totalSenior3Fees;
  const totalLandLoanFinCosts = funding.totalLandLoanInterest + funding.totalLandLoanFees;
  const totalMezzFinCosts     = funding.totalMezzInterest + funding.totalMezzFees;

  // Standard costs = dev costs + other std
  const standardCosts = totalDevCosts + totalOtherStd;

  const totalCost = totalLand + totalStampDuty + totalBuildCosts + totalContingency +
    totalSeniorFinCosts + totalLandLoanFinCosts + totalMezzFinCosts + totalOtherFin +
    standardCosts + totalGSTOnCosts + totalMarketing + commissions.total + totalPMFees;

  const totalRentalIncome = sum(rentalInc);
  const totalOtherIncome = sum(otherInc);
  // Use sum(settlements) rather than totalGRV so that GRV items without a
  // settlement date are excluded — they are not in the waterfall revenue and
  // would otherwise cause totalProfit > sum(profitDistributions).
  const totalSettlementsRevenue = sum(settlements);
  const totalProfit = totalSettlementsRevenue + totalRentalIncome + totalOtherIncome - totalGSTOnRevenue - totalCost;

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

  const seniorAmount  = funding.seniorFacilitySize;
  const senior2Amount = funding.senior2FacilitySize;
  const senior3Amount = funding.senior3FacilitySize;
  const mezzAmount    = funding.mezzFacilitySize;
  const totalCapital  = seniorAmount + senior2Amount + senior3Amount + mezzAmount + funding.totalEquityInjected;
  const seniorLTC   = totalCost > 0 ? seniorAmount  / totalCost : 0;
  const seniorLVR   = nrvValue  > 0 ? seniorAmount  / nrvValue  : 0;
  const senior2LTC  = totalCost > 0 ? senior2Amount / totalCost : 0;
  const senior2LVR  = nrvValue  > 0 ? senior2Amount / nrvValue  : 0;
  const senior3LTC  = totalCost > 0 ? senior3Amount / totalCost : 0;
  const senior3LVR  = nrvValue  > 0 ? senior3Amount / nrvValue  : 0;
  const mezzLTC     = totalCost > 0 ? mezzAmount    / totalCost : 0;
  const mezzLVR     = nrvValue  > 0 ? mezzAmount    / nrvValue  : 0;
  const equityLTC   = totalCost > 0 ? funding.totalEquityInjected / totalCost : 0;
  const equityLVR   = nrvValue  > 0 ? funding.totalEquityInjected / nrvValue  : 0;

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

  const seniorAllIn  = inputs.seniorFacility.margin  + inputs.seniorFacility.bbsy;
  const senior2AllIn = inputs.seniorFacility2.margin + inputs.seniorFacility2.bbsy;
  const senior3AllIn = inputs.seniorFacility3.margin + inputs.seniorFacility3.bbsy;
  const landAllIn    = inputs.landLoan.interestRate;
  const mezzAllIn    = inputs.mezzanine.interestRate;

  const maxMonthlyInterest = Math.max(...cashflows.map(cf =>
    cf.seniorInterest  + cf.seniorFees
    + cf.senior2Interest + cf.senior2Fees
    + cf.senior3Interest + cf.senior3Fees
    + cf.landLoanInterest + cf.mezzInterest + cf.mezzFees
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
      totalSettlementsRevenue,
      land: totalLand,
      stampDuty: totalStampDuty,
      buildCosts: totalBuildCosts + totalContingency,
      contingency: totalContingency,
      seniorFinanceCosts: totalSeniorFinCosts + totalLandLoanFinCosts,
      mezzFinanceCosts: totalMezzFinCosts,
      otherFinancingCosts: totalOtherFin,
      standardCosts,
      gst: totalGSTOnCosts,
      gstOnRevenue: totalGSTOnRevenue,
      gstNet: totalGSTOnRevenue - totalGSTOnCosts,
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
      senior2Amount,
      senior2LTC,
      senior2LVR,
      senior3Amount,
      senior3LTC,
      senior3LVR,
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
      seniorInterest:  funding.totalSeniorInterest  + funding.totalSeniorFees,
      seniorTotal:     funding.seniorFacilitySize   + funding.totalSeniorInterest  + funding.totalSeniorFees,
      senior2Principal: funding.senior2FacilitySize,
      senior2Interest:  funding.totalSenior2Interest + funding.totalSenior2Fees,
      senior2Total:     funding.senior2FacilitySize  + funding.totalSenior2Interest + funding.totalSenior2Fees,
      senior3Principal: funding.senior3FacilitySize,
      senior3Interest:  funding.totalSenior3Interest + funding.totalSenior3Fees,
      senior3Total:     funding.senior3FacilitySize  + funding.totalSenior3Interest + funding.totalSenior3Fees,
      mezzPrincipal: funding.mezzFacilitySize,
      mezzInterest:  funding.totalMezzInterest + funding.totalMezzFees,
      mezzTotal:     funding.mezzFacilitySize  + funding.totalMezzInterest + funding.totalMezzFees,
      totalPrincipal: funding.seniorFacilitySize + funding.senior2FacilitySize + funding.senior3FacilitySize + funding.mezzFacilitySize,
      totalInterest:  funding.totalSeniorInterest  + funding.totalSeniorFees
                    + funding.totalSenior2Interest + funding.totalSenior2Fees
                    + funding.totalSenior3Interest + funding.totalSenior3Fees
                    + funding.totalMezzInterest    + funding.totalMezzFees,
      totalDebt: funding.seniorFacilitySize  + funding.totalSeniorInterest  + funding.totalSeniorFees
               + funding.senior2FacilitySize + funding.totalSenior2Interest + funding.totalSenior2Fees
               + funding.senior3FacilitySize + funding.totalSenior3Interest + funding.totalSenior3Fees
               + funding.mezzFacilitySize    + funding.totalMezzInterest    + funding.totalMezzFees,
    },
    debtRates: {
      seniorEstablishment: inputs.seniorFacility.establishmentFeePercent,
      seniorLineFee: inputs.seniorFacility.lineFeePercent,
      seniorMargin: inputs.seniorFacility.margin,
      seniorBBSY: inputs.seniorFacility.bbsy,
      seniorAllIn,
      senior2Establishment: inputs.seniorFacility2.establishmentFeePercent,
      senior2LineFee: inputs.seniorFacility2.lineFeePercent,
      senior2Margin: inputs.seniorFacility2.margin,
      senior2BBSY: inputs.seniorFacility2.bbsy,
      senior2AllIn,
      senior3Establishment: inputs.seniorFacility3.establishmentFeePercent,
      senior3LineFee: inputs.seniorFacility3.lineFeePercent,
      senior3Margin: inputs.seniorFacility3.margin,
      senior3BBSY: inputs.seniorFacility3.bbsy,
      senior3AllIn,
      mezzEstablishment: inputs.mezzanine.establishmentFeePercent,
      mezzLineFee: inputs.mezzanine.lineFeePercent,
      mezzMargin: inputs.mezzanine.interestRate,
      mezzBBSY: 0,
      mezzAllIn,
      landEstablishment: inputs.landLoan.establishmentFeePercent,
      landLineFee: inputs.landLoan.lineFeePercent,
      landMargin: inputs.landLoan.interestRate,
      landBBSY: 0,
      landAllIn,
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
