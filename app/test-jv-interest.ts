import { runCalculations } from './src/engine/index';
import type { AdminConfig, MainInputs } from './src/types';
import {
  defaultLandPaymentStages, defaultAcquisitionCosts, defaultDevelopmentCosts,
  defaultConstructionCosts, defaultMarketingCosts, defaultOtherStandardCosts,
  defaultPMFees, defaultSellingCosts, defaultGRVItems, defaultRentalIncome,
  defaultOtherIncome, defaultEquityKokoda, defaultEquityJV, defaultEquityPreferred,
  defaultEquityAdditional, defaultLandLoan, defaultMezzanine, defaultSeniorFacility,
  defaultSeniorFacility2, defaultSeniorFacility3, defaultResidualStock,
  defaultAdditionalLoan, defaultOtherFinancingCosts,
} from './src/store/defaults';

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
    'Manual S-curve 1', 'Manual S-curve 2', 'Manual S-curve 3',
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
  equityJV: {
    ...defaultEquityJV,
    fixedAmount: 30000000,
    interestRate: 0.05,  // 5% interest on JV equity
    interestCompound: 1,  // Compound
    equityContribution: 0.25,
    profitShare: 0.2,
  },
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

function fmt(n: number): string {
  return n.toLocaleString('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });
}

console.log('TEST: JV Interest Rate and Coupon\n');
console.log('JV Configuration:');
console.log(`  JV Interest Rate: ${(inputs.equityJV.interestRate * 100).toFixed(2)}%`);
console.log(`  JV Interest Compound: ${inputs.equityJV.interestCompound === 1 ? 'Yes' : 'No'}`);

const data = runCalculations(admin, inputs);
const er = data.equityReturns;
const cf = data.feasibility;

console.log('\n=== JV Partner Equity Returns (Output) ===\n');
console.log(`  Coupon Interest Percent (from UI): ${(er.jvPartner.couponInterestPercent * 100).toFixed(2)}%`);
console.log(`  Coupon Interest Amount: ${fmt(er.jvPartner.couponInterest)}`);
console.log(`  Total Profit Share: ${fmt(er.jvPartner.totalProfitShare)}`);

console.log('\n=== ISSUE ===');
console.log('The couponInterestPercent in the output dashboard shows JV interest rate (5%),');
console.log('but the couponInterest amount is $0, not calculated anywhere.');
console.log('\nThis is only calculated for Preferred Equity in index.ts (line 333-340):');
console.log('  const prefEquityBalance = inputs.equityPreferred?.fixedAmount ?? 0;');
console.log('  const loanCouponInterest = prefEquityBalance > 0 && prefEquityRate > 0');
console.log('    ? prefEquityBalance * prefEquityRate * years : 0;');
console.log('\nJV interest is NOT calculated anywhere in the engine.');

console.log('\n=== VERIFICATION ===');
const jvEquity = inputs.equityJV.fixedAmount;
const years = inputs.preliminary.projectSpanMonths / 12;
const expectedJVInterest = jvEquity * inputs.equityJV.interestRate * years;
console.log(`Expected JV Interest (if calculated): ${fmt(expectedJVInterest)}`);
console.log(`  = ${fmt(jvEquity)} × ${(inputs.equityJV.interestRate * 100).toFixed(2)}% × ${years.toFixed(2)} years`);
console.log(`\nActual JV Interest in output: ${fmt(er.jvPartner.couponInterest)}`);

