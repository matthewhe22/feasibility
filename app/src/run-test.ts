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
const cs = d.capitalStack;

const totalProfitDist = wf.reduce((s, cf) => s + cf.profitDistribution, 0);
const totalSeniorInt = wf.reduce((s, cf) => s + cf.seniorInterest, 0);
const totalSeniorFees = wf.reduce((s, cf) => s + cf.seniorFees, 0);
const totalLandInt = wf.reduce((s, cf) => s + cf.landLoanInterest, 0);
const totalLandFees = wf.reduce((s, cf) => s + cf.landLoanFees, 0);
const totalEquityInj = wf.reduce((s, cf) => s + cf.equityInjection, 0);
const totalEquityRep = wf.reduce((s, cf) => s + cf.equityRepatriation, 0);
const totalSnrDrawdown = wf.reduce((s, cf) => s + cf.seniorDrawdown, 0);
const totalSnrRepayment = wf.reduce((s, cf) => s + cf.seniorRepayment, 0);
const seniorFinCosts = totalSeniorInt + totalSeniorFees;
const lastNetCF = wf[wf.length - 1]?.cumulativeCashflow ?? 0;
const totalNetCF = wf.reduce((s, cf) => s + cf.netCashflow, 0);

const pct = (a: number, b: number) => ((a - b) / Math.abs(b) * 100).toFixed(2) + '%';

console.log('=== TABLE 1: FEASIBILITY SUMMARY ===');
console.log(`Total Profit:         $${f.totalProfit.toFixed(0).padStart(15)} | Excel: $170,132,345 | Gap: ${pct(f.totalProfit, 170132345)}`);
console.log(`Senior Finance Costs: $${seniorFinCosts.toFixed(0).padStart(15)} | Excel: $59,352,838  | Gap: ${pct(seniorFinCosts, 59352838)}`);
console.log(`  Senior Interest:    $${totalSeniorInt.toFixed(0).padStart(15)} | Excel: $29,858,462  | Gap: ${pct(totalSeniorInt, 29858462)}`);
console.log(`  Senior Fees:        $${totalSeniorFees.toFixed(0).padStart(15)} | Excel: $29,494,376  | Gap: ${pct(totalSeniorFees, 29494376)}`);
console.log(`Land Loan Int+Fees:   $${(totalLandInt+totalLandFees).toFixed(0).padStart(15)} | Excel: $5,347,317   | Gap: ${pct(totalLandInt+totalLandFees, 5347317)}`);
console.log(`PM Fees:              $${f.pmFee.toFixed(0).padStart(15)} | Excel: $23,200,301  | Gap: ${pct(f.pmFee, 23200301)}`);
console.log(`GST on Revenue:       $${f.gstOnRevenue.toFixed(0).padStart(15)} | Excel: $87,581,043  | Gap: ${pct(f.gstOnRevenue, 87581043)}`);
console.log(`GST on Costs:         $${f.gst.toFixed(0).padStart(15)} | Excel: $70,051,745  | Gap: ${pct(f.gst, 70051745)}`);
console.log();
console.log('=== TABLE 2: KPIs ===');
console.log(`Total CoC:            ${kpi.totalCashOnCash.toFixed(3)}×          | Excel: 2.303×`);
console.log(`IRR:                  ${(kpi.irr * 100).toFixed(2)}%           | Excel: 23.02%`);
console.log(`ROI:                  ${(kpi.roi * 100).toFixed(2)}%           | Excel: 17.90%`);
console.log();
console.log('=== TABLE 3: EQUITY ===');
console.log(`Total Equity Inj:     $${totalEquityInj.toFixed(0).padStart(15)} | Excel: $130,419,982`);
console.log(`Total Equity Rep:     $${totalEquityRep.toFixed(0).padStart(15)} | Excel: $130,419,982`);
console.log(`Profit Share:         $${totalProfitDist.toFixed(0).padStart(15)} | Excel: $169,955,601`);
console.log();
console.log('=== CASHFLOW CHECK ===');
console.log(`Senior Drawdown:      $${totalSnrDrawdown.toFixed(0).padStart(15)} | Excel: $767,034,632`);
console.log(`Senior Repayment:     $${totalSnrRepayment.toFixed(0).padStart(15)} | Excel: $826,387,470`);
console.log(`Net Cashflow Total:   $${totalNetCF.toFixed(0).padStart(15)} | Should be ≈0`);
console.log(`Cumulative Final:     $${lastNetCF.toFixed(0).padStart(15)} | Should be ≈0`);
