/**
 * createTestProject.ts
 * Creates "Project Test" using all default inputs from the KK Feaso Model v43.
 * Run via: npx tsx src/utils/createTestProject.ts
 */
import { runCalculations } from '../engine/index';
import { createProject } from '../db/projectDb';
import type { AdminConfig, MainInputs } from '../types';
import {
  defaultLandPaymentStages, defaultAcquisitionCosts, defaultDevelopmentCosts,
  defaultConstructionCosts, defaultMarketingCosts, defaultOtherStandardCosts,
  defaultPMFees, defaultSellingCosts, defaultGRVItems, defaultRentalIncome,
  defaultOtherIncome, defaultEquityKokoda, defaultEquityJV, defaultEquityPreferred,
  defaultEquityAdditional, defaultLandLoan, defaultMezzanine, defaultSeniorFacility,
  defaultSeniorFacility2, defaultSeniorFacility3, defaultResidualStock,
  defaultAdditionalLoan, defaultOtherFinancingCosts,
} from '../store/defaults';

export const projectTestAdmin: AdminConfig = {
  projectName: 'Project Test',
  modelStartDate: 44927,          // Jan 2023
  monthsPerPeriod: 1,
  lastActualsPeriod: 45900,        // Sep 2025 (period 32)
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

export const projectTestInputs: MainInputs = {
  preliminary: {
    dateOfFirstPeriod: 45017,       // Apr 2023
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

async function main() {
  console.log('Creating "Project Test" with KK Feaso Model v43 inputs...');
  const dashboardData = runCalculations(projectTestAdmin, projectTestInputs);
  const id = await createProject(
    'Project Test',
    'Full sample model from KK Feaso Model Draft v43 — all inputs from Excel model loaded for reconciliation.',
    projectTestAdmin,
    projectTestInputs,
    dashboardData,
  );
  console.log(`✓ Project Test created with ID: ${id}`);
  console.log(`  Total GRV:    $${dashboardData.feasibility.totalGRV.toLocaleString()}`);
  console.log(`  Total Cost:   $${dashboardData.feasibility.totalCost.toLocaleString()}`);
  console.log(`  Total Profit: $${dashboardData.feasibility.totalProfit.toLocaleString()}`);
  console.log(`  IRR:          ${(dashboardData.kpis.irr * 100).toFixed(2)}%`);
}

// Only auto-run when executed directly in Node.js, not when imported in the browser
if (typeof window === 'undefined') {
  main().catch(console.error);
}
