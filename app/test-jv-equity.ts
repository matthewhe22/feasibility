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
    fixedAmount: 50000000,  // JV will contribute $50M
    equityContribution: 0.2,  // JV contributes 20% of total equity
    profitShare: 0.15,  // JV gets 15% of profit
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

console.log('TEST: Equity JV Partner Functionality\n');
console.log('JV Configuration:');
console.log(`  Fixed Amount (contribution): ${fmt(inputs.equityJV.fixedAmount)}`);
console.log(`  Equity Contribution %: ${(inputs.equityJV.equityContribution * 100).toFixed(1)}%`);
console.log(`  Profit Share %: ${(inputs.equityJV.profitShare * 100).toFixed(1)}%`);
console.log(`  Interest Rate: ${(inputs.equityJV.interestRate * 100).toFixed(2)}%`);
console.log(`  Interest Compound: ${inputs.equityJV.interestCompound === 1 ? 'Yes' : 'No'}`);
console.log(`  Repay Before Debt: ${(inputs.equityJV.repayEquityBeforeDebt * 100).toFixed(1)}%`);
console.log(`  Drawdown Priority: ${inputs.equityJV.drawdownPriority}\n`);

const data = runCalculations(admin, inputs);
const er = data.equityReturns;
const cs = data.capitalStack;
const cf = data.feasibility;

console.log('=== OUTPUT: Equity Returns Summary ===\n');
console.log('Total Project:');
console.log(`  Total Equity Contributed: ${fmt(er.total.totalEquityContributed)}`);
console.log(`  Total Profit: ${fmt(cf.totalProfit)}`);
console.log(`  Total Profit Share: ${fmt(er.total.totalProfitShare)}`);
console.log(`  IRR: ${(er.total.irr * 100).toFixed(2)}%\n`);

console.log('JV Partner:');
console.log(`  Funding Contribution %: ${(er.jvPartner.fundingContribPercent * 100).toFixed(2)}%`);
console.log(`  Total Equity Contributed: ${fmt(er.jvPartner.totalEquityContributed)}`);
console.log(`  Total Equity Repatriation: ${fmt(er.jvPartner.totalEquityRepatriation)}`);
console.log(`  Profit Share %: ${(er.jvPartner.profitSharePercent * 100).toFixed(2)}%`);
console.log(`  Total Profit Share: ${fmt(er.jvPartner.totalProfitShare)}`);
console.log(`  IRR: ${(er.jvPartner.irr * 100).toFixed(2)}%\n`);

console.log('Developer (Kokoda):');
console.log(`  Funding Contribution %: ${(er.developer.fundingContribPercent * 100).toFixed(2)}%`);
console.log(`  Total Equity Contributed: ${fmt(er.developer.totalEquityContributed)}`);
console.log(`  Total Equity Repatriation: ${fmt(er.developer.totalEquityRepatriation)}`);
console.log(`  Profit Share %: ${(er.developer.profitSharePercent * 100).toFixed(2)}%`);
console.log(`  Total Profit Share: ${fmt(er.developer.totalProfitShare)}`);
console.log(`  Coupon Interest: ${fmt(er.developer.couponInterest)}`);
console.log(`  IRR: ${(er.developer.irr * 100).toFixed(2)}%\n`);

console.log('Capital Stack:');
console.log(`  Equity Amount: ${fmt(cs.equityAmount)}`);
console.log(`  Equity LTC: ${(cs.equityLTC * 100).toFixed(2)}%`);
console.log(`  Equity LVR: ${(cs.equityLVR * 100).toFixed(2)}%\n`);

// Check equity cap calculation
console.log('=== VERIFICATION ===\n');
console.log(`Expected JV Equity in capital stack: ${fmt(inputs.equityJV.fixedAmount)}`);
console.log(`Actual Equity in capital stack: ${fmt(cs.equityAmount)}`);
console.log(`JV contribution % of total: ${(er.jvPartner.fundingContribPercent * 100).toFixed(2)}%`);
console.log(`JV profit share % of total: ${(er.jvPartner.profitSharePercent * 100).toFixed(2)}%`);
console.log(`JV total profit: ${fmt(er.jvPartner.totalProfitShare)}`);
console.log(`Expected JV profit (15% of ${fmt(cf.totalProfit)}): ${fmt(cf.totalProfit * inputs.equityJV.profitShare)}`);

const cashflows = data.cashflows;
const totalEquityInj = cashflows.reduce((s, c) => s + c.equityInjection, 0);
const jvInjections = cashflows.filter((_, i) => i < 5).map((c, i) => ({ month: i+1, inj: c.equityInjection }));
console.log(`\nTotal Equity Injections (waterfall): ${fmt(totalEquityInj)}`);
console.log(`First 5 month equity injections:`);
jvInjections.forEach(j => console.log(`  M${j.month}: ${fmt(j.inj)}`));

console.log('\nDone.');
