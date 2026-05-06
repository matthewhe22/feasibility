import type {
  AdminConfig, MainInputs, DashboardData, MonthlyCashflow,
  GSTCompliance, PeakExposure, DevelopmentCovenants, FacilityType,
  CalculationWarning, SolverDiagnostics,
} from '../types';
import { generateTimeline } from './timeline';
import { spreadCosts, spreadLandPayments, clearSCurveWarnings, getSCurveWarnings, buildCostVariance } from './costSpreading';
import {
  spreadSettlements, spreadDeposits, spreadIncome, spreadBackEndCommissions,
  calculateSellingCommissions, totalGRV, totalNRV, resolveSupplyType,
  clearRevenueWarnings, getRevenueWarnings,
} from './revenue';
import { solveFunding, clearFundingWarnings, getFundingWarnings } from './funding';
import { sum, calculateIRR, at } from '../utils';

export function runCalculations(admin: AdminConfig, inputs: MainInputs): DashboardData {
  // Reset warnings for this run
  clearSCurveWarnings();
  clearFundingWarnings();
  clearRevenueWarnings();

  const periods = generateTimeline(admin, inputs);
  const n = periods.length;
  const rawGstRate = inputs.landPurchase.gstRate;
  // Validate GST rate — must be >=0 and <1 (e.g. 0.10 for 10%).
  // Clamp invalid values to 0.10 and emit a warning so the user can correct.
  const localWarnings: string[] = [];
  let gstRate = rawGstRate;
  if (!Number.isFinite(gstRate) || gstRate < 0 || gstRate >= 1) {
    localWarnings.push(`Invalid gstRate ${rawGstRate} — clamped to 0.10 (10%). Enter a decimal between 0 and 1.`);
    gstRate = 0.10;
  }
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
  // PM fee rate comes from the dedicated feeRatePercent field on pmFees[0].
  // Historically the engine read the rate from the generic `units` column,
  // which the Inputs UI also exposes as a quantity. A user typing
  // `units=1, baseRate=500000` to express "$500K PM Fee" produced rate=1
  // (100% of all cost), which is the v2-UAT P0 PM Fee bug.
  //
  // Migration: useStore's persist.migrate (v2→v3) copies legacy values from
  // `units` into `feeRatePercent` *only* when `units` is in (0, 1) — a
  // plausible rate range. Outside that range we default to 0.02 (2%) and
  // emit a calculation warning so the user can correct it explicitly.
  const rawRate = inputs.pmFees[0]?.feeRatePercent;
  let pmFeeRate = 0.02;
  if (typeof rawRate === 'number' && Number.isFinite(rawRate) && rawRate > 0 && rawRate < 1) {
    pmFeeRate = rawRate;
  } else if (typeof rawRate === 'number' && rawRate !== 0) {
    localWarnings.push(
      `PM Fee rate ${rawRate} out of plausible range (0,1) — using 0.02 (2%) instead.`,
    );
  }
  let dynamicPMFeeTotal = pmFeeRate * totalCostsExcPM;
  let pmFeesWithTotal = inputs.pmFees.map((f, idx) =>
    idx === 0 ? { ...f, totalCosts: dynamicPMFeeTotal } : f
  );
  let pmFees = spreadCosts(pmFeesWithTotal, periods, admin.manualSCurves, buildSCurves);

  // ===== 2. SPREAD REVENUE =====
  const settlements = spreadSettlements(inputs.grvItems, periods);
  const deposits = spreadDeposits(inputs.grvItems, periods, inputs.sellingCosts);
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
        gstOnCosts[i] += (spread[i] ?? 0) * gstRate;
      }
    }
  }
  // Contingency GST mode: 'full' applies GST on reserve (legacy; assumes contingency
  // will be spent on creditable acquisitions). 'none' defers GST until actual spend.
  const contingencyGSTMode = admin.contingencyGSTMode ?? 'full';
  if (contingencyGSTMode === 'full') {
    for (let i = 0; i < n; i++) {
      gstOnCosts[i] += (contingency[i] ?? 0) * gstRate;
    }
  }
  // GST on selling commissions (front-end at presale, back-end at settlement)
  for (let i = 0; i < n; i++) {
    gstOnCosts[i] += (frontEndCommByPeriod[i] ?? 0) * gstRate;
    gstOnCosts[i] += (backEndCommByPeriod[i] ?? 0) * gstRate;
  }

  // GST on revenue — Division 75 GSTA margin scheme plus standard supplies.
  //
  // MARGIN SCHEME (Division 75 GSTA, GSTR 2006/1):
  //   Applies to gstIncluded residential items — the "margin" = sale price − consideration
  //   for the land acquisition. GST = margin × 1/11. Development and construction costs
  //   give rise to ITCs on creditable acquisitions separately (not deducted from the margin).
  //   Land cost is apportioned between taxable (margin-scheme) and non-taxable supplies
  //   by revenue proportion — residual attributable to taxable supplies reduces the margin.
  //   Reference: GSTR 2006/1 paras 76.3–76.5.
  //
  // STANDARD-RATED SUPPLIES (commercial/retail/hotel with gstIncluded=true marked as standard):
  //   GST = sale price × 1/11, ITC on costs is fully claimable.
  //
  // INPUT-TAXED & GOING-CONCERN SUPPLIES (gstIncluded=false):
  //   No GST on supply; no ITC attributable to these costs.
  // Use Number.isFinite + > 0 guards so that NaN/negative/Infinity sale prices in
  // user-supplied data cannot poison the GST margin-scheme math (NaN propagates).
  const totalGRVAllItems = inputs.grvItems.reduce(
    (s, g) => s + (Number.isFinite(g.currentSalePrice) && g.currentSalePrice > 0 ? g.currentSalePrice : 0),
    0,
  );
  // Margin-scheme supplies — routed by revenueType in resolveSupplyType so a
  // Commercial Office / Retail / Hotel item is NOT silently coerced into the
  // margin scheme just because gstIncluded is true.
  const marginSchemeGRV = inputs.grvItems
    .filter(g => Number.isFinite(g.currentSalePrice) && g.currentSalePrice > 0)
    .filter(g => resolveSupplyType(g) === 'margin-scheme')
    .reduce((s, g) => s + g.currentSalePrice, 0);
  const landPriceFinite = Number.isFinite(inputs.landPurchase.landPurchasePrice)
    ? Math.max(0, inputs.landPurchase.landPurchasePrice)
    : 0;
  // Land cost apportioned to margin-scheme supplies under Division 75 / GSTR
  // 2006/1: land × (margin-scheme GRV / total GRV). Capped at the margin-scheme
  // GRV itself so the taxable margin can never go negative.
  const marginSchemeDeduction = totalGRVAllItems > 0
    ? Math.min(marginSchemeGRV, landPriceFinite * marginSchemeGRV / totalGRVAllItems)
    : 0;
  const marginSchemeFactor = marginSchemeGRV > 0
    ? Math.max(0, 1 - marginSchemeDeduction / marginSchemeGRV)
    : 1;
  if (totalGRVAllItems === 0 && inputs.grvItems.length > 0) {
    localWarnings.push(
      'All GRV items have zero or invalid sale prices — GST/margin-scheme calculations skipped.',
    );
  }

  // GST withholding (TAA 1953 Sch 1, s.14-250) — purchaser of new residential premises withholds
  // 1/11 of the GST-exclusive price and remits directly to ATO. Models the cash effect:
  // developer receives net-of-withholding at settlement; ATO receives withholding.
  // R16 — withholding default. The s.14-250 GST-at-Settlement regime is
  // mandatory for new residential premises and potential residential land
  // (any margin-scheme supply in this model). If admin.applyGSTWithholding is
  // unset, default to true when the project contains any margin-scheme item,
  // false otherwise. Explicit user choice (true/false) is honoured.
  const hasMarginSchemeSupply = inputs.grvItems.some(g => resolveSupplyType(g) === 'margin-scheme');
  const applyWithholding = admin.applyGSTWithholding ?? hasMarginSchemeSupply;
  const gstWithholding = new Array(n).fill(0);
  const gstOnDeposits = new Array(n).fill(0);

  for (const item of inputs.grvItems) {
    if (!Number.isFinite(item.currentSalePrice) || item.currentSalePrice <= 0) continue;
    const supplyType = resolveSupplyType(item);
    // Only margin-scheme and standard supplies collect GST.
    if (supplyType !== 'margin-scheme' && supplyType !== 'standard') continue;
    const isMarginScheme = supplyType === 'margin-scheme';
    // Standard-rated: full 1/11; margin-scheme: applies only to the margin portion.
    const effectiveFactor = isMarginScheme ? marginSchemeFactor : 1;

    // Deposit percent for this item — needed before the settlement loop to avoid
    // double-counting: GST on the deposit is recognised at exchange (gstOnDeposits),
    // so settlement-period GST should only cover the remaining (1 − depositPct) portion.
    const hasPresale = item.preSaleExchangeMonth > 0 && item.preSaleSpan > 0;
    const configuredPct = inputs.sellingCosts[inputs.grvItems.indexOf(item)]?.depositPercent;
    const depositPct = hasPresale && (typeof configuredPct === 'number' && configuredPct > 0)
      ? configuredPct
      : (hasPresale ? 0.1 : 0);

    // Settlement GST — charged on the balance only (full price minus deposit already
    // taxed at exchange). Without this deduction, GST on the deposit is counted twice.
    const settleGSTAmount = item.currentSalePrice * (1 - depositPct) * gstRate / (1 + gstRate) * effectiveFactor;
    const settleSpread = spreadSettlements([item], periods);
    for (let i = 0; i < n; i++) {
      const periodShare = (settleSpread[i] ?? 0) / item.currentSalePrice;
      gstOnRevenue[i] += periodShare * settleGSTAmount;
    }

    // Withholding (TAA 1953 Sch 1, s.14-250) — applies to the full supply at settlement.
    // The purchaser withholds 1/11 of the full GST-exclusive price regardless of
    // how much was paid as deposit; this is correct per the ATO's remittance rules.
    const itemWithholds = item.withholdingApplies ?? isMarginScheme;
    if (applyWithholding && itemWithholds) {
      const withholdAmount = item.currentSalePrice * gstRate / (1 + gstRate) * effectiveFactor;
      for (let i = 0; i < n; i++) {
        const periodShare = (settleSpread[i] ?? 0) / item.currentSalePrice;
        gstWithholding[i] += periodShare * withholdAmount;
      }
    }

    // Deposit GST — GST liability attaches when deposits are received (GSTA s.9-70).
    // Allocate across presale span; together with settleGSTAmount above the total
    // equals item.currentSalePrice × effectiveFactor × 1/11.
    if (hasPresale) {
      const depositGST = item.currentSalePrice * depositPct * gstRate / (1 + gstRate) * effectiveFactor;
      const span = Math.max(1, item.preSaleSpan);
      const perMonth = depositGST / span;
      const startIdx = item.preSaleExchangeMonth - 1;
      for (let i = 0; i < span; i++) {
        const idx = startIdx + i;
        if (idx >= 0 && idx < n) gstOnDeposits[idx] += perMonth;
      }
    }
  }

  // R1: solveFunding's bankBalance subtracts gstOnRevenue per period; netCashflow
  // uses cf.gstOnRevenue which combines settlement-period AND deposit-period GST.
  // Pass the COMBINED array to the solver so the two views agree per period — this
  // is what closes the sum(netCashflow) ≈ 0 invariant. Without this, the solver
  // distributes profit based on a partial view (settle GST only) and netCashflow
  // ends up short by sum(gstOnDeposits).
  const gstOnRevenueWithDeposits = gstOnRevenue.map((r, i) => r + (gstOnDeposits[i] ?? 0));
  const monthlyGSTNet = gstOnRevenueWithDeposits.map((r, i) => r - gstOnCosts[i]);

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
  // ITC recovery: ATO refunds GST paid on costs each BAS cycle.
  // R17 — default itcRecoveryLagMonths = 1 (monthly BAS lodgement, refund
  // received the month after the GST was paid to vendors). Set to 0 to match
  // Excel's same-period legacy treatment, or 3 for quarterly BAS lodgers.
  // Same-period (0) is operationally impossible; the previous default
  // overstated developer cash by accelerating the refund.
  //
  // GST withholding (TAA 1953 Sch 1, s.14-250) is attribution-only for cashflow
  // purposes: the purchaser remits 1/11 of the price directly to the ATO, but
  // that amount is already part of gstOnRevenue (the full GST liability on the
  // supply). Subtracting BOTH gstWithholding from cash receipts AND gstOnRevenue
  // from the bank balance double-counts the same dollar. We model the developer
  // as if they collected gross price and remit gstOnRevenue via BAS; the
  // withholding line on the cashflow row is preserved as an information-only
  // memo of the attribution split. Closes Box Hill UAT R1 + R2.
  const itcLag = admin.itcRecoveryLagMonths ?? 1;
  const totalMonthlyRevenue = settlements.map((s, i) =>
    s + (rentalInc[i] ?? 0) + (otherInc[i] ?? 0)
    + (i >= itcLag ? (gstOnCosts[i - itcLag] ?? 0) : 0)
  );

  const equityDrawdownMode = admin.equityDrawdownMode ?? 'equity-first';

  // Two-pass PM fee: preliminary solve estimates finance costs so they can be
  // included in the PM fee base (matching Excel's GST+finance inclusive base).
  const prelimFunding = solveFunding(
    periods, monthlyCostsExcFinance, totalMonthlyRevenue, monthlyGSTNet, gstOnRevenueWithDeposits,
    inputs, admin.daysPerYear, admin.tolerance, 100, equityDrawdownMode,
  );
  const prelimFinCosts =
    prelimFunding.totalSeniorInterest  + prelimFunding.totalSeniorFees +
    prelimFunding.totalSenior2Interest + prelimFunding.totalSenior2Fees +
    prelimFunding.totalLandLoanInterest + prelimFunding.totalLandLoanFees +
    prelimFunding.totalMezzInterest    + prelimFunding.totalMezzFees;

  const oldPmFees = [...pmFees];
  dynamicPMFeeTotal = pmFeeRate * (totalCostsExcPM + prelimFinCosts);
  pmFeesWithTotal = inputs.pmFees.map((f, idx) =>
    idx === 0 ? { ...f, totalCosts: dynamicPMFeeTotal } : f
  );
  pmFees = spreadCosts(pmFeesWithTotal, periods, admin.manualSCurves, buildSCurves);

  const pmFeeHasGST = inputs.pmFees.length === 0 || inputs.pmFees[0]?.addGST !== false;
  for (let i = 0; i < n; i++) {
    const deltaPM = (pmFees[i] ?? 0) - (oldPmFees[i] ?? 0);
    const deltaGST = pmFeeHasGST ? deltaPM * gstRate : 0;
    gstOnCosts[i] += deltaGST;
    monthlyCostsExcFinance[i] += deltaPM + deltaGST;
    // Apply ITC lag: PM fee GST recovery is shifted by lag months
    const itcPeriod = i + itcLag;
    if (itcPeriod < n) totalMonthlyRevenue[itcPeriod] = (totalMonthlyRevenue[itcPeriod] ?? 0) + deltaGST;
  }

  const funding = solveFunding(
    periods,
    monthlyCostsExcFinance,
    totalMonthlyRevenue,
    monthlyGSTNet,
    gstOnRevenueWithDeposits,
    inputs,
    admin.daysPerYear,
    admin.tolerance,
    50,
    equityDrawdownMode,
  );

  // ===== 6. BUILD CASHFLOWS =====
  const cashflows: MonthlyCashflow[] = periods.map((period, i) => ({
    period,
    landCosts: at(landPayments, i) + at(prsvPayments, i),
    acquisitionCosts: at(acquisitionCosts, i),
    developmentCosts: at(devCosts, i),
    constructionCosts: at(constCosts, i),
    contingency: at(contingency, i),
    marketingCosts: at(marketingCosts, i),
    otherStandardCosts: at(otherStdCosts, i),
    pmFees: at(pmFees, i),
    sellingCostsFrontEnd: at(frontEndCommByPeriod, i),
    sellingCostsBackEnd: at(backEndCommByPeriod, i),
    lettingFees: 0,
    otherFinancingCosts: at(otherFinCosts, i),
    gstOnCosts: at(gstOnCosts, i),
    itcRecovery: (i >= itcLag) ? at(gstOnCosts, i - itcLag) : 0,
    grvSettlements: at(settlements, i),
    grvDeposits: at(deposits, i),
    rentalIncome: at(rentalInc, i),
    otherIncome: at(otherInc, i),
    gstOnRevenue: at(gstOnRevenue, i) + at(gstOnDeposits, i),
    gstOnDeposits: at(gstOnDeposits, i),
    gstWithholding: at(gstWithholding, i),
    landLoanDrawdown: at(funding.landLoanDrawdowns, i),
    landLoanRepayment: at(funding.landLoanRepayments, i),
    landLoanInterest: at(funding.landLoanInterest, i),
    landLoanFees: at(funding.landLoanFees, i),
    seniorDrawdown: at(funding.seniorDrawdowns, i),
    seniorRepayment: at(funding.seniorRepayments, i),
    seniorInterest: at(funding.seniorInterest, i),
    seniorFees: at(funding.seniorFees, i),
    senior2Drawdown: at(funding.senior2Drawdowns, i),
    senior2Repayment: at(funding.senior2Repayments, i),
    senior2Interest: at(funding.senior2Interest, i),
    senior2Fees: at(funding.senior2Fees, i),
    mezzDrawdown: at(funding.mezzDrawdowns, i),
    mezzRepayment: at(funding.mezzRepayments, i),
    mezzInterest: at(funding.mezzInterest, i),
    mezzFees: at(funding.mezzFees, i),
    equityInjection: at(funding.equityInjections, i),
    equityRepatriation: at(funding.equityRepatriations, i),
    profitDistribution: at(funding.profitDistributions, i),
    landLoanBalance: at(funding.landLoanBalance, i),
    seniorBalance: at(funding.seniorBalance, i),
    senior2Balance: at(funding.senior2Balance, i),
    mezzBalance: at(funding.mezzBalance, i),
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
      // ITC recovery: ATO refunds GST paid on costs (net effect = $0 on gstOnCosts
      // when itcLag=0; with lag, the offset happens in a later period)
      + cf.itcRecovery
      // Financing inflows (drawdowns + equity injections; capitalised amounts included here)
      + cf.landLoanDrawdown + cf.seniorDrawdown + cf.senior2Drawdown
      + cf.mezzDrawdown
      + cf.equityInjection
      // Operating costs (base costs + GST paid to vendors + GST remitted to ATO)
      - cf.landCosts - cf.acquisitionCosts - cf.developmentCosts
      - cf.constructionCosts - cf.contingency - cf.marketingCosts
      - cf.otherStandardCosts - cf.pmFees - cf.sellingCostsFrontEnd
      - cf.sellingCostsBackEnd - cf.otherFinancingCosts - cf.gstOnCosts
      - cf.gstOnRevenue
      // GST withholding is attribution-only — see comment on totalMonthlyRevenue
      // above. cf.gstOnRevenue already represents the full GST liability on the
      // supply (settlement + deposit). Subtracting cf.gstWithholding here would
      // double-count the portion of gstOnRevenue paid by the purchaser directly
      // to the ATO. Box Hill UAT R1 + R2.
      // Financing costs — always deducted (capitalised amounts cancel against their drawdown entry)
      - cf.landLoanInterest - cf.landLoanFees
      - cf.seniorInterest  - cf.seniorFees
      - cf.senior2Interest - cf.senior2Fees
      - cf.mezzInterest    - cf.mezzFees
      // Financing outflows (principal repayments + equity returns)
      - cf.landLoanRepayment - cf.seniorRepayment - cf.senior2Repayment
      - cf.mezzRepayment
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
  //
  // Includes BOTH settlement-period GST (gstOnRevenue) AND deposit-period GST
  // (gstOnDeposits) — GSTA s.9-70 attributes the GST liability when the deposit
  // is received. The per-period cashflow row aggregates the two as a single
  // gstOnRevenue field, so the feasibility total must match (Box Hill UAT bug 6).
  const totalGSTOnRevenue = sum(gstOnRevenue) + sum(gstOnDeposits);

  // Lender GST exemption: debt facility fees are modelled as GST-free assuming
  // the lender is an exempt financial institution (GSTA s.40-60). Non-bank lenders
  // may charge GST-inclusive fees; when lenderIsGSTExempt === false, gross up
  // the total fees by gstRate to reflect the additional cash cost (ITC not
  // recoverable on financial supply acquisitions under s.11-15(2)(a)).
  function feeUplift(facility: { lenderIsGSTExempt?: boolean } | undefined, fees: number): number {
    if (!facility) return 0;
    return facility.lenderIsGSTExempt === false ? fees * gstRate : 0;
  }
  const seniorFeeGSTUplift   = feeUplift(inputs.seniorFacility,  funding.totalSeniorFees);
  const senior2FeeGSTUplift  = feeUplift(inputs.seniorFacility2, funding.totalSenior2Fees);
  const mezzFeeGSTUplift     = feeUplift(inputs.mezzanine,       funding.totalMezzFees);
  const landFeeGSTUplift     = feeUplift(inputs.landLoan,        funding.totalLandLoanFees);

  const totalSeniorFinCosts   = funding.totalSeniorInterest  + funding.totalSeniorFees  + seniorFeeGSTUplift
                              + funding.totalSenior2Interest + funding.totalSenior2Fees + senior2FeeGSTUplift;
  const totalLandLoanFinCosts = funding.totalLandLoanInterest + funding.totalLandLoanFees + landFeeGSTUplift;
  const totalMezzFinCosts     = funding.totalMezzInterest + funding.totalMezzFees + mezzFeeGSTUplift;

  // Standard costs = dev costs + other std
  const standardCosts = totalDevCosts + totalOtherStd;

  // totalCost excludes GST on costs (recovered as ITC) and excludes GST on revenue
  // (deducted separately in totalProfit below, matching Excel's approach).
  const totalCost = totalLand + totalStampDuty + totalBuildCosts + totalContingency +
    totalSeniorFinCosts + totalLandLoanFinCosts + totalMezzFinCosts + totalOtherFin +
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

  // NRV — guard against negative values (e.g. selling costs exceed GRV) so LVR
  // constraints remain meaningful. A non-positive NRV is reported with a warning
  // and treated as 0 for downstream LVR math.
  const backEndSelling = commissions.backEnd;
  const rawNRV = totalNRV(inputs.grvItems, gstRate, backEndSelling);
  const nrvValue = rawNRV > 0 ? rawNRV : 0;
  if (rawNRV <= 0) {
    localWarnings.push(
      `Net Realisable Value is non-positive ($${Math.round(rawNRV).toLocaleString()}). ` +
      `LVR constraints cannot be applied — check revenue inputs and selling commissions.`
    );
  }

  // Capital stack uses facility LIMITS (committed principal) for all rows so the
  // numerators are dimensionally consistent. Previously the senior rows added
  // accrued interest+fees ("to match Excel reporting") while the mezz row stayed
  // at principal only — and totalCost (the denominator) already includes
  // totalSeniorFinCosts. Net effect: senior's interest+fees was double-counted,
  // inflating the stack to 102.28% on Box Hill (UAT bug 5, ~\$5.1M variance vs
  // Total Cost). With limits-only numerators the stack sums to ≤100%, where
  // <100% means underfunded — matching the existing equity-backstop warnings.
  const seniorAmount  = funding.seniorFacilityLimit;
  const senior2Amount = funding.senior2FacilityLimit;
  const mezzAmount    = funding.mezzFacilitySize;
  const totalCapital  = seniorAmount + senior2Amount + mezzAmount + funding.totalEquityInjected;
  const seniorLTC   = totalCost > 0 ? seniorAmount  / totalCost : 0;
  const seniorLVR   = nrvValue  > 0 ? seniorAmount  / nrvValue  : 0;
  const senior2LTC  = totalCost > 0 ? senior2Amount / totalCost : 0;
  const senior2LVR  = nrvValue  > 0 ? senior2Amount / nrvValue  : 0;
  const mezzLTC     = totalCost > 0 ? mezzAmount    / totalCost : 0;
  const mezzLVR     = nrvValue  > 0 ? mezzAmount    / nrvValue  : 0;
  // Capital stack equity LTC/LVR uses peak equity outstanding (max of
  // cumulative-injected − cumulative-repatriated across the timeline), to match
  // the senior/mezz convention of using committed facility limit (peak commitment).
  // Using cumulative totalEquityInjected here would inflate the stack when
  // equity is drawn and returned mid-project (e.g. deposit-GST timing under R1).
  const equityPeak = funding.peakEquity ?? funding.totalEquityInjected;
  const equityLTC   = totalCost > 0 ? equityPeak / totalCost : 0;
  const equityLVR   = nrvValue  > 0 ? equityPeak / nrvValue  : 0;

  // KPIs
  const equityContrib = funding.totalEquityInjected;
  // Cash-on-Cash Return = Total Profit (after coupon) / Equity. This is the
  // standard "return on equity capital" definition and is sign-aware: a
  // loss-making project (totalProfitAfterCoupon < 0) returns a NEGATIVE CCR,
  // matching ROI and Annual CCR. The previous "(profit + equity) / equity"
  // formulation was an *equity multiple* (cash returned / cash invested) which
  // is always non-negative as long as some capital comes back — it disagreed
  // in sign with Annual CCR and ROI on loss-making projects (Box Hill UAT bug 3).
  // The two are related by:  equityMultiple = cashOnCash + 1.
  const cashOnCash = equityContrib > 0 ? totalProfitAfterCoupon / equityContrib : 0;
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
      -at(funding.equityJVInjections, i)
      + at(funding.equityJVRepatriations, i)
      + at(funding.jvProfitDistributions, i)
    ), 0.015,
  ) : 0;

  const devIrr = (funding.totalEquityInjected - funding.totalJVEquityInjected) > 0 ? calculateIRR(
    cashflows.map((_, i) =>
      -(at(funding.equityInjections, i)    - at(funding.equityJVInjections, i))
      + (at(funding.equityRepatriations, i) - at(funding.equityJVRepatriations, i))
      + (at(funding.profitDistributions, i) - at(funding.jvProfitDistributions, i))
    ), 0.015,
  ) : irr;

  // Key dates
  const constructionStart = inputs.constructionCosts[0]?.monthStart || 33;
  const constructionSpan = inputs.constructionCosts[0]?.monthSpan || 41;
  const settlementMonths = inputs.grvItems.map(g => g.settlementMonth).filter(m => m > 0);
  const lastSettlement = settlementMonths.length > 0 ? Math.max(...settlementMonths) : 0;
  // Sales Commencement = first presale exchange across ANY revenue type.
  // Restricting to revenueType === 'Residential' caused mixed-use projects
  // to show "N/A" when items were labelled e.g. 'Retail F&B' or 'Apartments'
  // (Melbourne UAT Dh2). Use any item with a positive presale month.
  const presaleMonths = inputs.grvItems
    .filter(g => g.preSaleExchangeMonth > 0)
    .map(g => g.preSaleExchangeMonth);
  const salesStart = presaleMonths.length > 0 ? Math.min(...presaleMonths) : 0;

  function monthLabel(monthNum: number): string {
    if (monthNum <= 0 || monthNum > periods.length) return 'N/A';
    return periods[monthNum - 1]?.label || 'N/A';
  }

  // R6 — unified all-in interest rate formula across all four facility columns.
  //
  // Canonical: all-in = BBSY + Margin (the running interest rate charged on
  // outstanding balance). Establishment fees and line fees are pricing
  // components separate from the running rate — they appear on their own
  // rows in Table 8 and shouldn't be summed into the all-in. The previous
  // formulas were inconsistent: Senior/Senior #2 included est+line+margin+bbsy,
  // Mezz used legacy interestRate (margin only), Land used legacy interestRate
  // (margin+bbsy combined). Now all four use the same formula, with a fall-
  // through to the legacy interestRate field for projects saved before margin
  // and bbsy were broken out.
  function allInRate(f: import('../types').DebtFacility | undefined): number {
    if (!f) return 0;
    const margin = f.margin ?? 0;
    const bbsy   = f.bbsy   ?? 0;
    if (margin > 0 || bbsy > 0) return margin + bbsy;
    return f.interestRate ?? 0;  // back-compat for older saved projects
  }
  const seniorAllIn  = allInRate(inputs.seniorFacility);
  const senior2AllIn = allInRate(inputs.seniorFacility2);
  const landAllIn    = allInRate(inputs.landLoan);
  const mezzAllIn    = allInRate(inputs.mezzanine);

  // Interest-only metric (no fees) — matches Excel's "Peak Interest/Month" which shows
  // the maximum periodic interest charge across all facilities, excluding line/establishment fees.
  const maxMonthlyInterest = Math.max(...cashflows.map(cf =>
    cf.seniorInterest + cf.senior2Interest
    + cf.landLoanInterest + cf.mezzInterest
  ));

  // ===== PAYBACK PERIOD =====
  // First month where cumulative profit distributions + equity repatriations
  // exceed cumulative equity injected.
  let paybackPeriodMonths = 0;
  {
    let injected = 0;
    let returned = 0;
    for (let i = 0; i < cashflows.length; i++) {
      const cf = cashflows[i];
      if (!cf) continue;
      injected += cf.equityInjection;
      returned += cf.equityRepatriation + cf.profitDistribution;
      if (injected > 0 && returned >= injected) {
        paybackPeriodMonths = i + 1;
        break;
      }
    }
  }

  // ===== PEAK EXPOSURE =====
  // Peak debt / peak equity / peak-equity month are reported regardless of
  // facility type; LVR / LTC covenants live on `developmentCovenants` below.
  const peakExposure: PeakExposure = {
    peakDebt: funding.peakDebt,
    peakEquity: funding.peakEquity,
    peakEquityMonth: funding.peakEquityMonth,
  };

  // ===== DEVELOPMENT-LOAN COVENANTS (Table 12) =====
  // LVR (peak senior / GRV) + LTC (peak debt / total cost) + peak senior vs
  // facility limit. Defaults to 'development' for senior/mezz/land and
  // 'investment' for residual-stock per store/defaults.ts; saved projects
  // without facilityType are treated as 'development' (back-compat).
  const seniorTypeRaw = inputs.seniorFacility?.facilityType;
  const seniorType: FacilityType = seniorTypeRaw ?? 'development';
  const grvForCovenants = totalGRV(inputs.grvItems);
  let developmentCovenants: DevelopmentCovenants | undefined;
  if (seniorType === 'development') {
    const peakSeniorBalance = Math.max(...funding.seniorBalance, 0);
    const seniorLimit = inputs.seniorFacility?.facilityLimit ?? 0;
    const lvrTarget = inputs.seniorFacility?.lvrTarget ?? 0.65;
    const ltcTarget = inputs.seniorFacility?.ltcTarget ?? 0.7;
    const lvr = grvForCovenants > 0 ? peakSeniorBalance / grvForCovenants : 0;
    const ltc = totalCost > 0 ? funding.peakDebt / totalCost : 0;
    developmentCovenants = {
      lvr,
      ltc,
      peakDebt: funding.peakDebt,
      peakSenior: peakSeniorBalance,
      seniorLimit,
      peakSeniorPctLimit: seniorLimit > 0 ? peakSeniorBalance / seniorLimit : 0,
      lvrTarget,
      ltcTarget,
      meetsLVR: grvForCovenants > 0 && lvr <= lvrTarget,
      meetsLTC: totalCost > 0 && ltc <= ltcTarget,
      withinSeniorLimit: seniorLimit > 0 ? peakSeniorBalance <= seniorLimit : true,
    };
  }

  // ===== GST COMPLIANCE SCHEDULE =====
  let marginSchemeSupplies = 0;
  let standardRatedSupplies = 0;
  let inputTaxedSupplies = 0;
  let goingConcernSupplies = 0;
  let gstOnStandardSupplies = 0;
  for (const item of inputs.grvItems) {
    if (!Number.isFinite(item.currentSalePrice) || item.currentSalePrice <= 0) continue;
    const supplyType = resolveSupplyType(item);
    if (supplyType === 'margin-scheme') marginSchemeSupplies += item.currentSalePrice;
    else if (supplyType === 'standard') {
      standardRatedSupplies += item.currentSalePrice;
      gstOnStandardSupplies += item.currentSalePrice * gstRate / (1 + gstRate);
    }
    else if (supplyType === 'input-taxed') inputTaxedSupplies += item.currentSalePrice;
    else if (supplyType === 'going-concern') goingConcernSupplies += item.currentSalePrice;
  }
  const taxableMargin = Math.max(0, marginSchemeSupplies - marginSchemeDeduction);
  // GST on margin-scheme supplies = taxable margin × 1/11 (Division 75, GSTR 2006/1).
  // Use the pre-computed taxableMargin directly rather than re-applying marginSchemeFactor
  // to the gross supply value, which is an indirect approximation.
  const gstOnMarginSchemeSupplies = taxableMargin > 0
    ? taxableMargin * gstRate / (1 + gstRate)
    : 0;
  const gstWithholdingTotal = sum(gstWithholding);
  // R15 — input-taxed supplies + creditable acquisitions contradiction.
  // Per GSTA s.11-15(2)(a), an acquisition that relates to making input-taxed
  // supplies is NOT a creditable acquisition; ITC cannot be claimed on the
  // GST paid on those costs. The model doesn't apportion costs by supply mix,
  // so when a project contains BOTH input-taxed supplies AND non-zero
  // gstOnCosts, the developer's effective ITC claim is overstated by the
  // input-taxed proportion. Surface a warning so the user can apportion
  // manually (e.g. by setting addGST=false on cost items attributable to
  // input-taxed supplies).
  if (inputTaxedSupplies > 0 && totalGSTOnCosts > 0) {
    const inputTaxedShare = inputTaxedSupplies / Math.max(1, totalGRVAllItems);
    const overstatedITC = totalGSTOnCosts * inputTaxedShare;
    localWarnings.push(
      `GST input-taxed contradiction (s.11-15): project has $${Math.round(inputTaxedSupplies).toLocaleString()} of input-taxed supplies (${(inputTaxedShare * 100).toFixed(1)}% of GRV) but is claiming $${Math.round(totalGSTOnCosts).toLocaleString()} of ITC. Approximately $${Math.round(overstatedITC).toLocaleString()} of ITC may not be creditable — apportion costs by supply mix or set addGST=false on cost items attributable to input-taxed supplies.`
    );
  }
  // Creditable acquisitions = GST-inclusive value of creditable purchases (BAS G18).
  // ITC = G18 × gstRate/(1+gstRate), so G18 = ITC × (1+gstRate)/gstRate.
  const creditableAcquisitions = totalGSTOnCosts > 0 ? totalGSTOnCosts * (1 + gstRate) / gstRate : 0;
  const gstCompliance: GSTCompliance = {
    gstRate,
    marginSchemeSupplies,
    marginSchemeLandCost: marginSchemeDeduction,
    taxableMargin,
    gstOnMarginSchemeSupplies,
    standardRatedSupplies,
    gstOnStandardSupplies,
    inputTaxedSupplies,
    goingConcernSupplies,
    creditableAcquisitions,
    itcClaimable: totalGSTOnCosts,
    gstWithholdingTotal,
    // Withholding under TAA 1953 Sch 1, s.14-250 is remitted directly to the ATO
    // by the purchaser at settlement. The developer claims this as a CREDIT on
    // their BAS (Form NAT 74045) — so the net BAS payable is gross supplies minus
    // both ITC and the already-withheld amount. Was previously ADDED in error,
    // producing a $W swing equal to twice the withholding (Box Hill UAT bug 1).
    netGSTPayable: (gstOnMarginSchemeSupplies + gstOnStandardSupplies) - gstWithholdingTotal - totalGSTOnCosts,
  };

  // GRV Summary (Table 11). Previously totalAptGRV filtered for revenueType
  // === 'Residential' which produced $0 on any project where the user labelled
  // residential items differently (e.g. "Apartments" in a mixed-use scheme).
  // Now aggregates ALL GRV items so the Table 11 "Total Stock GRV" row never
  // shows $0 when the project has revenue items. Unsold GRV is clamped at 0.
  // (Melbourne UAT Dh1.)
  const totalAptGRV = inputs.grvItems
    .filter(g => Number.isFinite(g.currentSalePrice) && g.currentSalePrice > 0)
    .reduce((s, g) => s + g.currentSalePrice, 0);

  // GRV sold/exchanged: items whose presale exchange month falls within the actuals window
  const lastActualPeriodNum = periods.reduce((last, p) => p.isActual ? Math.max(last, p.periodNumber) : last, 0);
  // R13 — GRV Sold/Exchanged. An item is "sold/exchanged" when ANY of:
  //   1. Its presale exchange month falls in the actuals window (presale-led project), OR
  //   2. Its settlement month falls in the actuals window (project sells without a
  //      formal presale period — e.g. Box Hill subdivision lots that settle direct).
  // The pre-fix gate used (1) only, so projects with full settlements but no presales
  // reported $0 sold/exchanged at any historical state.
  const grvSoldExchanged = inputs.grvItems
    .filter(g => Number.isFinite(g.currentSalePrice) && g.currentSalePrice > 0)
    .filter(g =>
      (g.preSaleExchangeMonth > 0 && g.preSaleExchangeMonth <= lastActualPeriodNum) ||
      (g.settlementMonth > 0 && g.settlementMonth <= lastActualPeriodNum)
    )
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
      mezzPrincipal: funding.mezzFacilitySize,
      mezzInterest:  funding.totalMezzInterest + funding.totalMezzFees,
      mezzTotal:     funding.mezzFacilitySize  + funding.totalMezzInterest + funding.totalMezzFees,
      totalPrincipal: funding.seniorFacilityLimit + funding.senior2FacilityLimit + funding.mezzFacilitySize,
      totalInterest:  funding.totalSeniorInterest  + funding.totalSeniorFees
                    + funding.totalSenior2Interest + funding.totalSenior2Fees
                    + funding.totalMezzInterest    + funding.totalMezzFees,
      totalDebt: funding.seniorFacilityLimit  + funding.totalSeniorInterest  + funding.totalSeniorFees
               + funding.senior2FacilityLimit + funding.totalSenior2Interest + funding.totalSenior2Fees
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
      mezzEstablishment: inputs.mezzanine?.establishmentFeePercent ?? 0,
      mezzLineFee: inputs.mezzanine?.lineFeePercent ?? 0,
      // R7 — Mezz Margin/BBSY: mirror the Land-Loan fix from PR #27.
      // Read from facility.margin/.bbsy with fall-through to interestRate when
      // older saved projects only have the aggregate field set.
      mezzMargin: inputs.mezzanine?.margin ?? inputs.mezzanine?.interestRate ?? 0,
      mezzBBSY: inputs.mezzanine?.bbsy ?? 0,
      mezzAllIn,
      landEstablishment: inputs.landLoan?.establishmentFeePercent ?? 0,
      landLineFee: inputs.landLoan?.lineFeePercent ?? 0,
      // Display breakdown — DebtFacility carries margin and bbsy as separate
      // fields (FinancingInputs form binds both). Previously this cell mapped
      // landMargin to interestRate (the legacy all-in rate) and hardcoded BBSY
      // to 0, which displayed the right total but the wrong split. Box Hill
      // UAT bug 4. Falls back to interestRate split across margin only when
      // bbsy is unset, preserving back-compat with older saved projects.
      landMargin: inputs.landLoan?.margin ?? inputs.landLoan?.interestRate ?? 0,
      landBBSY: inputs.landLoan?.bbsy ?? 0,
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
      // Total row must equal the sum of JV + Developer rows, otherwise
      // Table 3 column sums don't add (UAT v2 issue #19). Previously this
      // row used feasibilityProfit (revenue − costs) while the per-entity
      // rows used waterfall sums — those are two different accounting
      // objects. profitShareBalance / totalProfitShare now both report
      // the waterfall total; feasibility profit is shown separately as a
      // memo row in InternalDashboard Table 3.
      total: {
        entity: 'Total',
        fundingContribPercent: 1,
        totalEquityContributed: equityContrib,
        irr,
        equityRepatriation1st: 0,
        equityRepatriation2nd: sum(funding.equityRepatriations),
        totalEquityRepatriation: sum(funding.equityRepatriations),
        establishmentFee: 0,
        couponInterest: 0,
        couponInterestPercent: 0,
        profitShareBalance: sum(funding.profitDistributions),
        profitSharePercent: 1,
        totalProfitShare: sum(funding.profitDistributions),
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
        couponInterestPercent: inputs.equityDeveloper?.interestRate ?? 0,
        profitShareBalance: sum(funding.profitDistributions) - sum(funding.jvProfitDistributions),
        profitSharePercent: inputs.equityDeveloper?.profitShare ?? 0,
        totalProfitShare: sum(funding.profitDistributions) - sum(funding.jvProfitDistributions),
      },
    },
    otherIndicators: {
      peakInterestHoldingCostPerMonth: maxMonthlyInterest,
      paybackPeriodMonths,
    },
    grvSummary: {
      totalApartmentGRV: totalAptGRV,
      grvSoldExchanged: grvSoldExchanged,
      // Clamp at 0 — sold-but-not-yet-recognised stock can otherwise produce
      // a negative "unsold" figure (UAT v2 #20 / Melbourne UAT Dh5).
      unsoldGRV: Math.max(0, totalAptGRV - grvSoldExchanged),
    },
    peakExposure,
    ...(developmentCovenants ? { developmentCovenants } : {}),
    gstCompliance,
    cashflows,
    warnings: [
      ...localWarnings,
      ...getSCurveWarnings(),
      ...getFundingWarnings(),
      ...getRevenueWarnings(),
    ],
    warningsDetail: ((): CalculationWarning[] => {
      const out: CalculationWarning[] = [];
      for (const m of localWarnings) {
        const cat: CalculationWarning['category'] =
          m.toLowerCase().includes('gst') ? 'gst'
          : m.toLowerCase().includes('net realisable') ? 'revenue'
          : 'general';
        out.push({ message: m, severity: 'warning', category: cat });
      }
      for (const m of getSCurveWarnings()) {
        out.push({ message: m, severity: 'warning', category: 'sCurve' });
      }
      for (const m of getFundingWarnings()) {
        const isSolver = m.toLowerCase().includes('solver');
        out.push({
          message: m,
          severity: isSolver ? 'error' : 'warning',
          category: isSolver ? 'solver' : 'funding',
        });
      }
      for (const m of getRevenueWarnings()) {
        out.push({ message: m, severity: 'warning', category: 'revenue' });
      }
      return out;
    })(),
    solver: ((): SolverDiagnostics => ({
      converged: funding.converged,
      iterations: funding.iterations,
      maxIterations: 50,
      finalDelta: funding.convergenceDelta,
      tolerance: admin.tolerance,
    }))(),
    costVariance: buildCostVariance(
      [
        ...inputs.developmentCosts,
        ...inputs.constructionCosts,
        ...inputs.marketingCosts,
        ...inputs.otherStandardCosts,
        ...inputs.otherFinancingCosts,
      ],
      periods,
    ),
  };
}
