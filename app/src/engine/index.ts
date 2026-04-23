import type { AdminConfig, MainInputs, DashboardData, MonthlyCashflow } from '../types';
import { generateTimeline } from './timeline';
import { spreadCosts, spreadLandPayments, clearSCurveWarnings, getSCurveWarnings } from './costSpreading';
import { spreadSettlements, spreadDeposits, spreadIncome, spreadBackEndCommissions, calculateSellingCommissions, totalGRV, totalNRV } from './revenue';
import { solveFunding, clearFundingWarnings, getFundingWarnings } from './funding';
import { sum, calculateIRR } from '../utils';

export function runCalculations(admin: AdminConfig, inputs: MainInputs): DashboardData {
  // Reset warnings for this run
  clearSCurveWarnings();
  clearFundingWarnings();

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
  // PM fee = rate × (all costs excluding PM fee itself, inclusive of GST on those costs).
  // Compute preliminary GST on non-PM cost items so it can be included in the base
  // (matching Excel's GST-inclusive base). PM fee GST is added in the full GST pass below.
  let prelimGSTOnCosts = 0;
  const nonPMCostItems = [
    ...inputs.developmentCosts,
    ...inputs.constructionCosts,
    ...inputs.marketingCosts,
    ...inputs.otherStandardCosts,
    ...inputs.otherFinancingCosts,
  ];
  for (const item of nonPMCostItems) {
    if (item.addGST !== false) {
      prelimGSTOnCosts += item.totalCosts * gstRate;
    }
  }
  prelimGSTOnCosts += contingencyTotal * gstRate;
  prelimGSTOnCosts += commissions.frontEnd * gstRate;
  prelimGSTOnCosts += commissions.backEnd * gstRate;

  const totalCostsExcPM =
    sum(landPayments) + sum(prsvPayments) + sum(acquisitionCosts) +
    sum(devCosts) + sum(constCosts) + sum(contingency) +
    sum(marketingCosts) + sum(otherStdCosts) + sum(otherFinCosts) +
    sum(frontEndCommByPeriod) + sum(backEndCommByPeriod) +
    prelimGSTOnCosts;
  // PM fee rate comes from the item's `units` field (e.g. 0.02 = 2%)
  const pmFeeRate = (inputs.pmFees.length > 0 && inputs.pmFees[0].units > 0)
    ? inputs.pmFees[0].units
    : 0.02;
  let dynamicPMFeeTotal = pmFeeRate * totalCostsExcPM;
  let pmFeesWithTotal = inputs.pmFees.map((f, idx) =>
    idx === 0 ? { ...f, totalCosts: dynamicPMFeeTotal } : f
  );
  let pmFees = spreadCosts(pmFeesWithTotal, periods, admin.manualSCurves, buildSCurves);

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

  // GST on revenue — margin scheme: deduct the land cost attributable to non-GST
  // revenue items from the residential GST base.  Deduction = landPurchasePrice ×
  // (nonGSTGRV / totalGRV), distributed proportionally across GST-inclusive items.
  const totalGRVAllItems = inputs.grvItems.reduce((s, g) => s + g.currentSalePrice, 0);
  const totalGSTIncludedGRV = inputs.grvItems
    .filter(g => g.gstIncluded && g.currentSalePrice > 0)
    .reduce((s, g) => s + g.currentSalePrice, 0);
  const nonGSTGRV = totalGRVAllItems - totalGSTIncludedGRV;
  const marginSchemeDeduction = totalGRVAllItems > 0
    ? inputs.landPurchase.landPurchasePrice * nonGSTGRV / totalGRVAllItems
    : 0;
  const marginSchemeFactor = totalGSTIncludedGRV > 0
    ? 1 - marginSchemeDeduction / totalGSTIncludedGRV
    : 1;

  for (const item of inputs.grvItems) {
    if (item.gstIncluded && item.currentSalePrice > 0) {
      const gstAmount = item.currentSalePrice * gstRate / (1 + gstRate) * marginSchemeFactor;
      const settleSpread = spreadSettlements([item], periods);
      for (let i = 0; i < n; i++) {
        gstOnRevenue[i] += settleSpread[i] / item.currentSalePrice * gstAmount;
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
  // Also add ITC recovery (ATO refunds GST paid on costs each period) so the
  // waterfall treats costs on an ex-GST basis, matching the formula profit calc.
  const totalMonthlyRevenue = settlements.map((s, i) => s + rentalInc[i] + otherInc[i] + gstOnCosts[i]);

  // Two-pass PM fee: preliminary solve estimates finance costs so they can be
  // included in the PM fee base (matching Excel's GST+finance inclusive base).
  const prelimFunding = solveFunding(
    periods, monthlyCostsExcFinance, totalMonthlyRevenue, monthlyGSTNet, gstOnRevenue,
    inputs, admin.daysPerYear, admin.tolerance,
  );
  const prelimFinCosts =
    prelimFunding.totalSeniorInterest  + prelimFunding.totalSeniorFees +
    prelimFunding.totalSenior2Interest + prelimFunding.totalSenior2Fees +
    prelimFunding.totalSenior3Interest + prelimFunding.totalSenior3Fees +
    prelimFunding.totalLandLoanInterest + prelimFunding.totalLandLoanFees +
    prelimFunding.totalMezzInterest    + prelimFunding.totalMezzFees +
    prelimFunding.totalAddl1Interest   + prelimFunding.totalAddl1Fees +
    prelimFunding.totalAddl2Interest   + prelimFunding.totalAddl2Fees +
    prelimFunding.totalAddl3Interest   + prelimFunding.totalAddl3Fees;

  const oldPmFees = [...pmFees];
  dynamicPMFeeTotal = pmFeeRate * (totalCostsExcPM + prelimFinCosts);
  pmFeesWithTotal = inputs.pmFees.map((f, idx) =>
    idx === 0 ? { ...f, totalCosts: dynamicPMFeeTotal } : f
  );
  pmFees = spreadCosts(pmFeesWithTotal, periods, admin.manualSCurves, buildSCurves);

  const pmFeeHasGST = inputs.pmFees.length === 0 || inputs.pmFees[0].addGST !== false;
  for (let i = 0; i < n; i++) {
    const deltaPM = pmFees[i] - oldPmFees[i];
    const deltaGST = pmFeeHasGST ? deltaPM * gstRate : 0;
    gstOnCosts[i] += deltaGST;
    monthlyCostsExcFinance[i] += deltaPM + deltaGST;
    totalMonthlyRevenue[i] += deltaGST; // ITC recovery tracks GST on costs
  }

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
    itcRecovery: gstOnCosts[i],
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
    addl1Drawdown: funding.addl1Drawdowns[i],
    addl1Repayment: funding.addl1Repayments[i],
    addl1Interest: funding.addl1Interest[i],
    addl1Fees: funding.addl1Fees[i],
    addl2Drawdown: funding.addl2Drawdowns[i],
    addl2Repayment: funding.addl2Repayments[i],
    addl2Interest: funding.addl2Interest[i],
    addl2Fees: funding.addl2Fees[i],
    addl3Drawdown: funding.addl3Drawdowns[i],
    addl3Repayment: funding.addl3Repayments[i],
    addl3Interest: funding.addl3Interest[i],
    addl3Fees: funding.addl3Fees[i],
    equityInjection: funding.equityInjections[i],
    equityRepatriation: funding.equityRepatriations[i],
    profitDistribution: funding.profitDistributions[i],
    landLoanBalance: funding.landLoanBalance[i],
    seniorBalance: funding.seniorBalance[i],
    senior2Balance: funding.senior2Balance[i],
    senior3Balance: funding.senior3Balance[i],
    mezzBalance: funding.mezzBalance[i],
    addl1Balance: funding.addl1Balance[i],
    addl2Balance: funding.addl2Balance[i],
    addl3Balance: funding.addl3Balance[i],
    equityBalance: 0,
    netCashflow: 0,
    cumulativeCashflow: 0,
  }));

  // Capitalisation flags — capitalised interest/fees accrete to the loan balance
  // and are NOT cash outflows in the period they accrue.  They inflate the balance
  // which is then swept out through repayments when revenue arrives, so they must
  // be excluded from the net cashflow formula to preserve net = 0 each period.
  // Calculate net cashflow — includes all cash financing flows so that it represents
  // the true change in the project bank account each period.
  // Net should be ≈ 0 every period: drawdowns fund costs, revenue repays debt.
  // Capitalised interest/fees are now tracked as drawdowns in the waterfall, so they
  // must also be deducted here as costs — the two entries cancel, preserving net ≈ 0.
  let cumCF = 0;
  for (const cf of cashflows) {
    cf.netCashflow =
      // Operating inflows
      cf.grvSettlements + cf.rentalIncome + cf.otherIncome
      // ITC recovery: ATO refunds GST paid on costs (net effect = $0 on gstOnCosts)
      + cf.itcRecovery
      // Financing inflows (drawdowns + equity injections; capitalised amounts included here)
      + cf.landLoanDrawdown + cf.seniorDrawdown + cf.senior2Drawdown + cf.senior3Drawdown
      + cf.mezzDrawdown + cf.addl1Drawdown + cf.addl2Drawdown + cf.addl3Drawdown
      + cf.equityInjection
      // Operating costs (base costs + GST paid to vendors + GST remitted to ATO)
      - cf.landCosts - cf.acquisitionCosts - cf.developmentCosts
      - cf.constructionCosts - cf.contingency - cf.marketingCosts
      - cf.otherStandardCosts - cf.pmFees - cf.sellingCostsFrontEnd
      - cf.sellingCostsBackEnd - cf.otherFinancingCosts - cf.gstOnCosts
      - cf.gstOnRevenue
      // Financing costs — always deducted (capitalised amounts cancel against their drawdown entry)
      - cf.landLoanInterest - cf.landLoanFees
      - cf.seniorInterest  - cf.seniorFees
      - cf.senior2Interest - cf.senior2Fees
      - cf.senior3Interest - cf.senior3Fees
      - cf.mezzInterest    - cf.mezzFees
      - cf.addl1Interest   - cf.addl1Fees
      - cf.addl2Interest   - cf.addl2Fees
      - cf.addl3Interest   - cf.addl3Fees
      // Financing outflows (principal repayments + equity returns)
      - cf.landLoanRepayment - cf.seniorRepayment - cf.senior2Repayment - cf.senior3Repayment
      - cf.mezzRepayment - cf.addl1Repayment - cf.addl2Repayment - cf.addl3Repayment
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
  const totalAddlFinCosts     = funding.totalAddl1Interest + funding.totalAddl1Fees
                              + funding.totalAddl2Interest + funding.totalAddl2Fees
                              + funding.totalAddl3Interest + funding.totalAddl3Fees;

  // Standard costs = dev costs + other std
  const standardCosts = totalDevCosts + totalOtherStd;

  // totalCost excludes GST on costs (recovered as ITC) and excludes GST on revenue
  // (deducted separately in totalProfit below, matching Excel's approach).
  const totalCost = totalLand + totalStampDuty + totalBuildCosts + totalContingency +
    totalSeniorFinCosts + totalLandLoanFinCosts + totalMezzFinCosts + totalAddlFinCosts + totalOtherFin +
    standardCosts + totalMarketing + commissions.total + totalPMFees;

  const totalRentalIncome = sum(rentalInc);
  const totalOtherIncome = sum(otherInc);
  // Use sum(settlements) rather than totalGRV so that GRV items without a
  // settlement date are excluded — they are not in the waterfall revenue and
  // would otherwise cause totalProfit > sum(profitDistributions).
  const totalSettlementsRevenue = sum(settlements);
  // Deduct GST on revenue (remitted to ATO) separately — matches Excel where
  // cost items are shown ex-GST and the net GST burden is gstOnRevenue only
  // (ITC fully offsets gstOnCosts, so gstOnCosts is not a net cost).
  const totalProfit = totalSettlementsRevenue + totalRentalIncome + totalOtherIncome - totalGSTOnRevenue - totalCost;

  // Preferred equity coupon (accrued over project duration at simple interest)
  const prefEquityBalance = inputs.equityPreferred?.fixedAmount ?? 0;
  const prefEquityRate = inputs.equityPreferred?.interestRate ?? 0;
  const projectDuration = inputs.preliminary.projectSpanMonths;
  const years = projectDuration / 12;
  const loanCouponInterest = prefEquityBalance > 0 && prefEquityRate > 0
    ? prefEquityBalance * prefEquityRate * years
    : 0;

  // JV equity coupon (same simple-interest approach as preferred equity)
  const jvEquityBalance = funding.totalJVEquityInjected > 0 ? (inputs.equityJV?.fixedAmount ?? 0) : 0;
  const jvEquityRate = inputs.equityJV?.interestRate ?? 0;
  const jvCouponInterest = jvEquityBalance > 0 && jvEquityRate > 0
    ? jvEquityBalance * jvEquityRate * years
    : 0;

  const totalProfitAfterCoupon = totalProfit - loanCouponInterest - jvCouponInterest;

  // NRV
  const backEndSelling = commissions.backEnd;
  const nrvValue = totalNRV(inputs.grvItems, gstRate, backEndSelling);

  // Capital stack uses facility limit (committed amount) + accrued interest/fees
  // to match Excel reporting — not peak drawn balance.
  const seniorAmount  = funding.seniorFacilityLimit  + funding.totalSeniorInterest  + funding.totalSeniorFees;
  const senior2Amount = funding.senior2FacilityLimit + funding.totalSenior2Interest + funding.totalSenior2Fees;
  const senior3Amount = funding.senior3FacilityLimit + funding.totalSenior3Interest + funding.totalSenior3Fees;
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
  // Cash-on-Cash = (profit + equity) / equity — matches Excel equity multiple definition
  const cashOnCash = equityContrib > 0 ? (totalProfitAfterCoupon + equityContrib) / equityContrib : 0;
  // Annualised CoC = compound annual return: (1 + totalReturn)^(1/years) - 1
  const annualCoC = equityContrib > 0 && years > 0
    ? Math.pow(1 + totalProfitAfterCoupon / equityContrib, 1 / years) - 1
    : 0;
  const roi = totalCost > 0 ? totalProfit / totalCost : 0;

  // IRR - total equity cashflows (used for kpis and total equityReturns row)
  const equityCFs = cashflows.map(cf => -cf.equityInjection + cf.equityRepatriation + cf.profitDistribution);
  const irr = calculateIRR(equityCFs, 0.015);

  // Per-entity IRR using actual waterfall cashflows (not proportional estimates)
  const jvIrr = funding.totalJVEquityInjected > 0 ? calculateIRR(
    cashflows.map((_, i) =>
      -funding.equityJVInjections[i]
      + funding.equityJVRepatriations[i]
      + funding.jvProfitDistributions[i]
    ), 0.015,
  ) : 0;

  const devIrr = (funding.totalEquityInjected - funding.totalJVEquityInjected) > 0 ? calculateIRR(
    cashflows.map((_, i) =>
      -(funding.equityInjections[i]    - funding.equityJVInjections[i])
      + (funding.equityRepatriations[i] - funding.equityJVRepatriations[i])
      + (funding.profitDistributions[i] - funding.jvProfitDistributions[i])
    ), 0.015,
  ) : irr;

  // Key dates
  const constructionStart = inputs.constructionCosts[0]?.monthStart || 33;
  const constructionSpan = inputs.constructionCosts[0]?.monthSpan || 41;
  const settlementMonths = inputs.grvItems.map(g => g.settlementMonth).filter(m => m > 0);
  const lastSettlement = settlementMonths.length > 0 ? Math.max(...settlementMonths) : 0;
  const presaleMonths = inputs.grvItems
    .filter(g => g.preSaleExchangeMonth > 0 && g.revenueType === 'Residential')
    .map(g => g.preSaleExchangeMonth);
  const salesStart = presaleMonths.length > 0 ? Math.min(...presaleMonths) : 0;

  function monthLabel(monthNum: number): string {
    if (monthNum <= 0 || monthNum > periods.length) return 'N/A';
    return periods[monthNum - 1]?.label || 'N/A';
  }

  const seniorAllIn  = (inputs.seniorFacility?.establishmentFeePercent  ?? 0) + (inputs.seniorFacility?.lineFeePercent  ?? 0) + (inputs.seniorFacility?.margin  ?? 0) + (inputs.seniorFacility?.bbsy  ?? 0);
  const senior2AllIn = (inputs.seniorFacility2?.establishmentFeePercent ?? 0) + (inputs.seniorFacility2?.lineFeePercent ?? 0) + (inputs.seniorFacility2?.margin ?? 0) + (inputs.seniorFacility2?.bbsy ?? 0);
  const senior3AllIn = (inputs.seniorFacility3?.establishmentFeePercent ?? 0) + (inputs.seniorFacility3?.lineFeePercent ?? 0) + (inputs.seniorFacility3?.margin ?? 0) + (inputs.seniorFacility3?.bbsy ?? 0);
  const landAllIn    = inputs.landLoan?.interestRate  ?? 0;
  const mezzAllIn    = inputs.mezzanine?.interestRate ?? 0;

  // Interest-only metric (no fees) — matches Excel's "Peak Interest/Month" which shows
  // the maximum periodic interest charge across all facilities, excluding line/establishment fees.
  const maxMonthlyInterest = Math.max(...cashflows.map(cf =>
    cf.seniorInterest + cf.senior2Interest + cf.senior3Interest
    + cf.landLoanInterest + cf.mezzInterest
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
      developmentCosts: totalDevCosts,
      otherStandardCosts: totalOtherStd,
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
      seniorPrincipal: funding.seniorFacilityLimit,
      seniorInterest:  funding.totalSeniorInterest  + funding.totalSeniorFees,
      seniorTotal:     funding.seniorFacilityLimit  + funding.totalSeniorInterest  + funding.totalSeniorFees,
      senior2Principal: funding.senior2FacilityLimit,
      senior2Interest:  funding.totalSenior2Interest + funding.totalSenior2Fees,
      senior2Total:     funding.senior2FacilityLimit + funding.totalSenior2Interest + funding.totalSenior2Fees,
      senior3Principal: funding.senior3FacilityLimit,
      senior3Interest:  funding.totalSenior3Interest + funding.totalSenior3Fees,
      senior3Total:     funding.senior3FacilityLimit + funding.totalSenior3Interest + funding.totalSenior3Fees,
      mezzPrincipal: funding.mezzFacilitySize,
      mezzInterest:  funding.totalMezzInterest + funding.totalMezzFees,
      mezzTotal:     funding.mezzFacilitySize  + funding.totalMezzInterest + funding.totalMezzFees,
      totalPrincipal: funding.seniorFacilityLimit + funding.senior2FacilityLimit + funding.senior3FacilityLimit + funding.mezzFacilitySize,
      totalInterest:  funding.totalSeniorInterest  + funding.totalSeniorFees
                    + funding.totalSenior2Interest + funding.totalSenior2Fees
                    + funding.totalSenior3Interest + funding.totalSenior3Fees
                    + funding.totalMezzInterest    + funding.totalMezzFees,
      totalDebt: funding.seniorFacilityLimit  + funding.totalSeniorInterest  + funding.totalSeniorFees
               + funding.senior2FacilityLimit + funding.totalSenior2Interest + funding.totalSenior2Fees
               + funding.senior3FacilityLimit + funding.totalSenior3Interest + funding.totalSenior3Fees
               + funding.mezzFacilitySize     + funding.totalMezzInterest    + funding.totalMezzFees,
    },
    debtRates: {
      seniorEstablishment: inputs.seniorFacility?.establishmentFeePercent  ?? 0,
      seniorLineFee: inputs.seniorFacility?.lineFeePercent  ?? 0,
      seniorMargin: inputs.seniorFacility?.margin  ?? 0,
      seniorBBSY: inputs.seniorFacility?.bbsy  ?? 0,
      seniorAllIn,
      senior2Establishment: inputs.seniorFacility2?.establishmentFeePercent ?? 0,
      senior2LineFee: inputs.seniorFacility2?.lineFeePercent ?? 0,
      senior2Margin: inputs.seniorFacility2?.margin ?? 0,
      senior2BBSY: inputs.seniorFacility2?.bbsy ?? 0,
      senior2AllIn,
      senior3Establishment: inputs.seniorFacility3?.establishmentFeePercent ?? 0,
      senior3LineFee: inputs.seniorFacility3?.lineFeePercent ?? 0,
      senior3Margin: inputs.seniorFacility3?.margin ?? 0,
      senior3BBSY: inputs.seniorFacility3?.bbsy ?? 0,
      senior3AllIn,
      mezzEstablishment: inputs.mezzanine?.establishmentFeePercent ?? 0,
      mezzLineFee: inputs.mezzanine?.lineFeePercent ?? 0,
      mezzMargin: inputs.mezzanine?.interestRate ?? 0,
      mezzBBSY: 0,
      mezzAllIn,
      landEstablishment: inputs.landLoan?.establishmentFeePercent ?? 0,
      landLineFee: inputs.landLoan?.lineFeePercent ?? 0,
      landMargin: inputs.landLoan?.interestRate ?? 0,
      landBBSY: 0,
      landAllIn,
    },
    keyDates: {
      contractStartDate: monthLabel(1),
      establishJV: monthLabel(projectDuration),
      salesCommencement: monthLabel(salesStart),
      landSettlement: monthLabel(inputs.landLoan?.startMonth ?? 0),
      constructionStart: monthLabel(constructionStart),
      constructionCompletion: monthLabel(constructionStart + constructionSpan - 1),
      salesSettlementCompleted: monthLabel(lastSettlement),
      projectDurationMonths: projectDuration,
      constructionTimeMonths: constructionSpan,
      planningDesignMonths: constructionStart - 1,
      landToSettlementMonths: lastSettlement - (inputs.landLoan?.startMonth ?? 0),
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
        fundingContribPercent: equityContrib > 0 ? funding.totalJVEquityInjected / equityContrib : 0,
        totalEquityContributed: funding.totalJVEquityInjected,
        irr: jvIrr,
        equityRepatriation1st: 0,
        equityRepatriation2nd: sum(funding.equityJVRepatriations),
        totalEquityRepatriation: sum(funding.equityJVRepatriations),
        establishmentFee: 0,
        couponInterest: jvCouponInterest,
        couponInterestPercent: inputs.equityJV?.interestRate ?? 0,
        profitShareBalance: sum(funding.jvProfitDistributions),
        profitSharePercent: inputs.equityJV?.profitShare ?? 0,
        totalProfitShare: sum(funding.jvProfitDistributions),
      },
      developer: {
        entity: 'Developer',
        fundingContribPercent: equityContrib > 0 ? (equityContrib - funding.totalJVEquityInjected) / equityContrib : 1,
        totalEquityContributed: equityContrib - funding.totalJVEquityInjected,
        irr: devIrr,
        equityRepatriation1st: 0,
        equityRepatriation2nd: sum(funding.equityRepatriations) - sum(funding.equityJVRepatriations),
        totalEquityRepatriation: sum(funding.equityRepatriations) - sum(funding.equityJVRepatriations),
        establishmentFee: 0,
        couponInterest: loanCouponInterest,
        couponInterestPercent: inputs.equityKokoda?.interestRate ?? 0,
        profitShareBalance: sum(funding.profitDistributions) - sum(funding.jvProfitDistributions),
        profitSharePercent: inputs.equityKokoda?.profitShare ?? 0,
        totalProfitShare: sum(funding.profitDistributions) - sum(funding.jvProfitDistributions),
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
    warnings: [...getSCurveWarnings(), ...getFundingWarnings()],
  };
}
