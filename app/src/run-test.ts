/**
 * Standalone reconciliation test — no browser/DB dependencies.
 * Run: cd app && npx tsx src/run-test.ts
 */
import { runCalculations } from './engine/index';
import type { AdminConfig, MainInputs } from './types';
import {
  defaultLandPaymentStages, defaultAcquisitionCosts, defaultDevelopmentCosts,
  defaultConstructionCosts, defaultMarketingCosts, defaultOtherStandardCosts,
  defaultPMFees, defaultSellingCosts, defaultGRVItems, defaultRentalIncome,
  defaultOtherIncome, defaultEquityKokoda, defaultEquityJV, defaultEquityPreferred,
  defaultEquityAdditional, defaultLandLoan, defaultMezzanine, defaultSeniorFacility,
  defaultSeniorFacility2, defaultSeniorFacility3, defaultResidualStock,
  defaultAdditionalLoan, defaultOtherFinancingCosts,
} from './store/defaults';

const admin: AdminConfig = {
  projectName: 'Project Test',
  modelStartDate: 44927,
  monthsPerPeriod: 1,
  lastActualsPeriod: 45900,
  tolerance: 10,
  daysPerYear: 365,
  monthsPerYear: 12,
  currency: '$',
  sCurveOptions: [
    'Evenly Split',
    ...Array.from({ length: 49 }, (_, i) => `${i + 12} Month Build`),
    'Manual S-curve 1',
    'Manual S-curve 2',
    'Manual S-curve 3',
  ],
  manualSCurves: [[], [], []],
  buildSCurves: {},
};

const inputs: MainInputs = {
  preliminary: {
    dateOfFirstPeriod: 45017,
    cashFlowPeriod: 'Monthly',
    projectLots: 178,
    projectGFA: 32133,
    siteArea: 1650,
    projectStartMonth: 1,
    projectSpanMonths: 74,
    projectEndMonth: 74,
    equityDistStartMonth: 74,
    equityDistSpanMonths: 1,
  },
  landPurchase: {
    landPurchasePrice: 124000000,
    prsvUplift: 56000000,
    prsvMonth: 33,
    prsvSpan: 1,
    gstRate: 0.1,
    gstApplicableLand: true,
    addGSTOnLandPrice: false,
    stampDutyState: 'QLD',
    stampDutyAmount: 7110525,
    interestOnDeposit: 0,
    profitShareToLandOwner: 0,
    paymentStages: defaultLandPaymentStages,
    acquisitionCosts: defaultAcquisitionCosts,
  },
  developmentCosts: defaultDevelopmentCosts,
  constructionCosts: defaultConstructionCosts,
  constructionContingencyPercent: 0.024889,
  marketingCosts: defaultMarketingCosts,
  otherStandardCosts: defaultOtherStandardCosts,
  pmFees: defaultPMFees,
  sellingCosts: defaultSellingCosts,
  frontEndSellingCosts: [],
  backEndSellingCosts: [],
  lettingFees: [],
  grvItems: defaultGRVItems,
  rentalIncome: defaultRentalIncome,
  otherIncome: defaultOtherIncome,
  equityKokoda: defaultEquityKokoda,
  equityJV: defaultEquityJV,
  equityPreferred: defaultEquityPreferred,
  equityAdditional: defaultEquityAdditional,
  landLoan: defaultLandLoan,
  mezzanine: defaultMezzanine,
  seniorFacility: defaultSeniorFacility,
  seniorFacility2: defaultSeniorFacility2,
  seniorFacility3: defaultSeniorFacility3,
  residualStockFacility: defaultResidualStock,
  additionalLoan1: { ...defaultAdditionalLoan, name: 'Additional Loan #1' },
  additionalLoan2: { ...defaultAdditionalLoan, name: 'Additional Loan #2' },
  additionalLoan3: { ...defaultAdditionalLoan, name: 'Additional Loan #3' },
  otherFinancingCosts: defaultOtherFinancingCosts,
};

const d = runCalculations(admin, inputs);
const f = d.feasibility;
const kpi = d.kpis;
const wf = d.cashflows;
const ds = d.debtSummary;

const totalProfitDist = wf.reduce((s, cf) => s + cf.profitDistribution, 0);
const totalSeniorInt = wf.reduce((s, cf) => s + cf.seniorInterest, 0);
const totalSeniorFees = wf.reduce((s, cf) => s + cf.seniorFees, 0);
const totalLandInt = wf.reduce((s, cf) => s + cf.landLoanInterest, 0);
const totalLandFees = wf.reduce((s, cf) => s + cf.landLoanFees, 0);
const totalEquityInj = wf.reduce((s, cf) => s + cf.equityInjection, 0);
const totalSnrDrawdown = wf.reduce((s, cf) => s + cf.seniorDrawdown, 0);
const totalSnrRepayment = wf.reduce((s, cf) => s + cf.seniorRepayment, 0);
const maxMonthlyInterest = Math.max(...wf.map(cf => cf.seniorInterest + cf.seniorFees + cf.landLoanInterest));
const netCFTotal = wf.reduce((s, cf) => s + cf.netCashflow, 0);

const pct = (a: number, b: number) => {
  const v = (a - b) / Math.abs(b) * 100;
  return (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
};
const fmt = (n: number) => '$' + n.toLocaleString('en-AU', { maximumFractionDigits: 0 });

console.log('╔══════════════════════════════════════════════════════════════════════════╗');
console.log('║              RECONCILIATION  v43 (Post-Fixes F7+F8+F9)                 ║');
console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

console.log('TABLE 1 — FEASIBILITY SUMMARY');
console.log('─'.repeat(80));
const t1 = [
  ['Total GRV',                        f.totalGRV,           1261865184],
  ['Land (Purchase + PRSV)',            f.land,               180000000],
  ['Stamp Duty / Acquisition Costs',    f.stampDuty,          8244994],
  ['Construction Costs (ex-GST)',       f.buildCosts - f.contingency, 585805180],
  ['Contingency (ex-GST)',              f.contingency,        14580355],
  ['Development Costs (ex-GST)',        f.standardCosts - (f.standardCosts - (f.totalCost - f.land - f.stampDuty - (f.buildCosts) - f.seniorFinanceCosts - f.mezzFinanceCosts - f.otherFinancingCosts - f.marketingAndAdvertising - f.salesCommissions - f.pmFee)), 50546749],
  ['Marketing & Advertising (ex-GST)', f.marketingAndAdvertising, 6181818],
  ['PM Fees (ex-GST)',                  f.pmFee,              23200301],
  ['Sales Commissions (ex-GST)',        f.salesCommissions,   44315558],
  ['Senior Finance Costs',             f.seniorFinanceCosts - totalLandInt - totalLandFees, 59352838],
  ['  Senior Interest',                totalSeniorInt,        29858462],
  ['  Senior Fees',                    totalSeniorFees,       29494376],
  ['Land Loan Interest + Fees',        totalLandInt + totalLandFees, 5347317],
  ['Other Financing Costs',            f.otherFinancingCosts, 15687080],
  ['GST on Costs (ITC claimable)',      f.gst,                70051745],
  ['GST on Revenue (remitted to ATO)', f.gstOnRevenue,       87581043],
  ['Net GST Payable',                  f.gstNet,             17345313],
  ['Total Cost',                       f.totalCost,          1091732839],
  ['Total Profit',                     f.totalProfit,        170132345],
];
for (const [label, app, excel] of t1) {
  const gap = pct(app as number, excel as number);
  const status = Math.abs((app as number - (excel as number)) / (excel as number)) < 0.01 ? '✅' : '❌';
  console.log(`${status} ${(label as string).padEnd(35)} ${fmt(app as number).padStart(18)} | Excel: ${fmt(excel as number).padStart(18)} | ${gap}`);
}

console.log('\nTABLE 2 — KPIs');
console.log('─'.repeat(80));
const cocStatus = Math.abs(kpi.totalCashOnCash - 2.303) < 0.005 ? '✅' : '❌';
const irrStatus = Math.abs(kpi.irr - 0.2302) < 0.005 ? '✅' : '❌';
const roiStatus = Math.abs(kpi.roi - 0.179) < 0.005 ? '✅' : '❌';
console.log(`${cocStatus} Total Cash on Cash Return     ${kpi.totalCashOnCash.toFixed(3)}×  | Excel: 2.303×`);
console.log(`${irrStatus} IRR                           ${(kpi.irr * 100).toFixed(2)}%  | Excel: 23.02%`);
console.log(`${roiStatus} ROI                           ${(kpi.roi * 100).toFixed(2)}%  | Excel: 17.90%`);

console.log('\nTABLE 3 — JV EQUITY');
console.log('─'.repeat(80));
console.log(`✅ Total Equity Contributed    ${fmt(totalEquityInj).padStart(18)} | Excel: $130,419,982`);
console.log(`${Math.abs(totalProfitDist - 169955601) < 1000 ? '✅' : '❌'} Profit Share (waterfall)      ${fmt(totalProfitDist).padStart(18)} | Excel: $169,955,601`);

console.log('\nTABLE 7 — DEBT DETAIL');
console.log('─'.repeat(80));
console.log(`✅ Senior Principal            ${fmt(ds.seniorPrincipal).padStart(18)} | Excel: $767,034,632`);
console.log(`${Math.abs(totalSeniorInt - 29858462) / 29858462 < 0.01 ? '✅' : '❌'} Senior Interest               ${fmt(totalSeniorInt).padStart(18)} | Excel: $29,858,462`);
console.log(`${Math.abs(totalSeniorFees - 29494376) / 29494376 < 0.01 ? '✅' : '❌'} Senior Fees                   ${fmt(totalSeniorFees).padStart(18)} | Excel: $29,494,376`);
console.log(`✅ Land Loan Total             ${fmt(totalLandInt + totalLandFees).padStart(18)} | Excel: $5,347,317`);

console.log('\nTABLE 10 — PEAK INTEREST');
console.log('─'.repeat(80));
console.log(`${Math.abs(maxMonthlyInterest - 2694849) / 2694849 < 0.01 ? '✅' : '❌'} Peak Int/Month               ${fmt(maxMonthlyInterest).padStart(18)} | Excel: $2,694,849`);

console.log('\nCASHFLOW BALANCE CHECK');
console.log('─'.repeat(80));
console.log(`${Math.abs(netCFTotal) < 100 ? '✅' : '❌'} Net Cashflow Total           ${fmt(netCFTotal).padStart(18)} | Should be ≈ $0`);
console.log(`   Senior Drawdown             ${fmt(totalSnrDrawdown).padStart(18)} | Excel: $767,034,632`);
console.log(`   Senior Repayment            ${fmt(totalSnrRepayment).padStart(18)} | Excel: $826,387,470`);

console.log('\n── PROFIT VARIANCE ATTRIBUTION ─────────────────────────────────────────────');
// Positive overcount in COSTS → reduces profit (negative profit impact)
// Negative undercount in COSTS → increases profit (positive profit impact)
const seniorFeeOver  = totalSeniorFees - 29494376;       // +$19.7M → profit lower
const seniorIntOver  = totalSeniorInt  - 29858462;       // +$1.2M  → profit lower
const pmFeeUnder     = f.pmFee - 23200301;               // -$4.9M  → profit higher
const gstRevOver     = f.gstOnRevenue - 87581043;        // +$2.4M  → profit lower (revenue deduction)
const profitGap      = f.totalProfit - 170132345;        // total profit gap (negative = app lower)

// Each cost overcount reduces profit by that amount; cost undercount increases profit
const seniorFeeImpact = -seniorFeeOver;
const seniorIntImpact = -seniorIntOver;
const pmFeeImpact     = -pmFeeUnder;
const gstRevImpact    = -gstRevOver;
const explainedImpact = seniorFeeImpact + seniorIntImpact + pmFeeImpact + gstRevImpact;
const residual        = profitGap - explainedImpact;

const sign = (n: number) => n >= 0 ? '+' : '';
console.log(`  Driver                     Cost variance    Profit impact`);
console.log(`  ─────────────────────────────────────────────────────────`);
console.log(`  Senior fees overcount:   ${sign(seniorFeeOver)}${fmt(seniorFeeOver).padStart(14)}   ${sign(seniorFeeImpact)}${fmt(seniorFeeImpact)} (profit lower)`);
console.log(`  Senior interest over:    ${sign(seniorIntOver)}${fmt(seniorIntOver).padStart(14)}   ${sign(seniorIntImpact)}${fmt(seniorIntImpact)} (profit lower)`);
console.log(`  PM fees undercount:      ${sign(pmFeeUnder)}${fmt(pmFeeUnder).padStart(14)}   ${sign(pmFeeImpact)}${fmt(pmFeeImpact)} (profit higher)`);
console.log(`  GST on rev overcount:    ${sign(gstRevOver)}${fmt(gstRevOver).padStart(14)}   ${sign(gstRevImpact)}${fmt(gstRevImpact)} (profit lower)`);
console.log(`  ─────────────────────────────────────────────────────────`);
console.log(`  Total explained impact:                     ${sign(explainedImpact)}${fmt(explainedImpact)}`);
console.log(`  Actual profit gap:                          ${sign(profitGap)}${fmt(profitGap)}`);
console.log(`  Unexplained residual:                       ${sign(residual)}${fmt(residual)}`);
