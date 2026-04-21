/**
 * Test script: runs the calculation engine with default inputs (KK Feaso Model v43)
 * and outputs all Internal Dashboard and Cashflow metrics for reconciliation.
 */
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

function fmt(n: number): string {
  return n.toLocaleString('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });
}
function fmtp(n: number): string {
  return (n * 100).toFixed(4) + '%';
}
function fmtr(n: number): string {
  return n.toFixed(4);
}

console.log('Running calculation engine...\n');
const data = runCalculations(admin, inputs);
const f = data.feasibility;
const k = data.kpis;
const cs = data.capitalStack;
const ds = data.debtSummary;
const dr = data.debtRates;
const kd = data.keyDates;
const er = data.equityReturns;
const cfs = data.cashflows;

console.log('=== TABLE 1: FEASIBILITY SUMMARY ===');
console.log(`Total GRV:                      ${fmt(f.totalGRV)}`);
console.log(`Total Settlements Revenue:      ${fmt(f.totalSettlementsRevenue)}`);
console.log(`Land:                           ${fmt(f.land)}`);
console.log(`Stamp Duty:                     ${fmt(f.stampDuty)}`);
console.log(`Build Costs (incl contingency): ${fmt(f.buildCosts)}`);
console.log(`  Construction only:            ${fmt(f.buildCosts - f.contingency)}`);
console.log(`  Contingency:                  ${fmt(f.contingency)}`);
console.log(`Senior Finance Costs:           ${fmt(f.seniorFinanceCosts)}`);
console.log(`Mezzanine Finance Costs:        ${fmt(f.mezzFinanceCosts)}`);
console.log(`Other Financing Costs:          ${fmt(f.otherFinancingCosts)}`);
console.log(`Standard Costs:                 ${fmt(f.standardCosts)}`);
console.log(`GST on Costs:                   ${fmt(f.gst)}`);
console.log(`GST on Revenue:                 ${fmt(f.gstOnRevenue)}`);
console.log(`Net GST Payable:                ${fmt(f.gstNet)}`);
console.log(`Marketing and Advertising:      ${fmt(f.marketingAndAdvertising)}`);
console.log(`Sales Commissions:              ${fmt(f.salesCommissions)}`);
console.log(`Project Management Fee:         ${fmt(f.pmFee)}`);
console.log(`Total Cost:                     ${fmt(f.totalCost)}`);
console.log(`Total Profit:                   ${fmt(f.totalProfit)}`);
console.log(`Total Profit (after coupon):    ${fmt(f.totalProfitAfterCoupon)}`);

console.log('\n=== TABLE 2: KPIs ===');
console.log(`Total Cash on Cash Return:      ${fmtr(k.totalCashOnCash)}`);
console.log(`Annual Cash on Cash Return:     ${fmtr(k.annualCashOnCash)}`);
console.log(`Return on Investment:           ${fmtp(k.roi)}`);
console.log(`IRR (monthly):                  ${fmtp(k.irr)}`);

console.log('\n=== TABLE 3: JV Equity Summary ===');
console.log(`Total Equity Contributed:       ${fmt(er.total.totalEquityContributed)}`);
console.log(`JV Partner Equity:              ${fmt(er.jvPartner.totalEquityContributed)}`);
console.log(`Developer Equity:               ${fmt(er.developer.totalEquityContributed)}`);
console.log(`Total Profit Share:             ${fmt(er.total.totalProfitShare)}`);
console.log(`Developer Profit Share:         ${fmt(er.developer.totalProfitShare)}`);

console.log('\n=== TABLE 6: CAPITAL STACK ===');
console.log(`Senior Facility #1:             ${fmt(cs.seniorAmount)}  LTC=${fmtp(cs.seniorLTC)}  LVR=${fmtp(cs.seniorLVR)}`);
console.log(`Senior Facility #2:             ${fmt(cs.senior2Amount)}`);
console.log(`Senior Facility #3:             ${fmt(cs.senior3Amount)}`);
console.log(`Mezzanine:                      ${fmt(cs.mezzAmount)}  LTC=${fmtp(cs.mezzLTC)}  LVR=${fmtp(cs.mezzLVR)}`);
console.log(`Equity:                         ${fmt(cs.equityAmount)}  LTC=${fmtp(cs.equityLTC)}  LVR=${fmtp(cs.equityLVR)}`);
console.log(`Total Capital:                  ${fmt(cs.total)}`);

console.log('\n=== TABLE 7: DEBT SUMMARY ===');
console.log(`Senior #1 Principal:            ${fmt(ds.seniorPrincipal)}`);
console.log(`Senior #1 Interest+Fees:        ${fmt(ds.seniorInterest)}`);
console.log(`Senior #1 Total:                ${fmt(ds.seniorTotal)}`);
console.log(`Total Principal:                ${fmt(ds.totalPrincipal)}`);
console.log(`Total Interest:                 ${fmt(ds.totalInterest)}`);
console.log(`Total Debt:                     ${fmt(ds.totalDebt)}`);

console.log('\n=== TABLE 8: DEBT RATES ===');
console.log(`Senior Establishment:           ${fmtp(dr.seniorEstablishment)}`);
console.log(`Senior Line Fee:                ${fmtp(dr.seniorLineFee)}`);
console.log(`Senior Margin:                  ${fmtp(dr.seniorMargin)}`);
console.log(`Senior BBSY:                    ${fmtp(dr.seniorBBSY)}`);
console.log(`Senior All-In:                  ${fmtp(dr.seniorAllIn)}`);
console.log(`Land Establishment:             ${fmtp(dr.landEstablishment)}`);
console.log(`Land Margin:                    ${fmtp(dr.landMargin)}`);
console.log(`Land All-In:                    ${fmtp(dr.landAllIn)}`);

console.log('\n=== TABLE 9: KEY DATES ===');
console.log(`Contract Start:                 ${kd.contractStartDate}`);
console.log(`Sales Commencement:             ${kd.salesCommencement}`);
console.log(`Land Settlement:                ${kd.landSettlement}`);
console.log(`Construction Start:             ${kd.constructionStart}`);
console.log(`Construction Completion:        ${kd.constructionCompletion}`);
console.log(`Sales Settlement Completed:     ${kd.salesSettlementCompleted}`);
console.log(`Project Duration:               ${kd.projectDurationMonths} months`);
console.log(`Construction Time:              ${kd.constructionTimeMonths} months`);
console.log(`Planning & Design Time:         ${kd.planningDesignMonths} months`);

console.log('\n=== TABLE 10: OTHER INDICATORS ===');
console.log(`Peak Interest per Month:        ${fmt(data.otherIndicators.peakInterestHoldingCostPerMonth)}`);

console.log('\n=== TABLE 11: GRV SUMMARY ===');
console.log(`Total Apartment GRV:            ${fmt(data.grvSummary.totalApartmentGRV)}`);
console.log(`GRV Sold/Exchanged:             ${fmt(data.grvSummary.grvSoldExchanged)}`);
console.log(`Unsold GRV:                     ${fmt(data.grvSummary.unsoldGRV)}`);

// Cashflow totals
const totalLandCosts = cfs.reduce((s, c) => s + c.landCosts, 0);
const totalAcqCosts = cfs.reduce((s, c) => s + c.acquisitionCosts, 0);
const totalDevCosts = cfs.reduce((s, c) => s + c.developmentCosts, 0);
const totalConstrCosts = cfs.reduce((s, c) => s + c.constructionCosts, 0);
const totalContingency = cfs.reduce((s, c) => s + c.contingency, 0);
const totalMarketing = cfs.reduce((s, c) => s + c.marketingCosts, 0);
const totalOtherStd = cfs.reduce((s, c) => s + c.otherStandardCosts, 0);
const totalPM = cfs.reduce((s, c) => s + c.pmFees, 0);
const totalFEComm = cfs.reduce((s, c) => s + c.sellingCostsFrontEnd, 0);
const totalBEComm = cfs.reduce((s, c) => s + c.sellingCostsBackEnd, 0);
const totalOtherFin = cfs.reduce((s, c) => s + c.otherFinancingCosts, 0);
const totalGSTCosts = cfs.reduce((s, c) => s + c.gstOnCosts, 0);
const totalSettlements = cfs.reduce((s, c) => s + c.grvSettlements, 0);
const totalDeposits = cfs.reduce((s, c) => s + c.grvDeposits, 0);
const totalRental = cfs.reduce((s, c) => s + c.rentalIncome, 0);
const totalOtherInc = cfs.reduce((s, c) => s + c.otherIncome, 0);
const totalGSTRev = cfs.reduce((s, c) => s + c.gstOnRevenue, 0);
const totalLLDrawdown = cfs.reduce((s, c) => s + c.landLoanDrawdown, 0);
const totalLLRepay = cfs.reduce((s, c) => s + c.landLoanRepayment, 0);
const totalLLInterest = cfs.reduce((s, c) => s + c.landLoanInterest, 0);
const totalLLFees = cfs.reduce((s, c) => s + c.landLoanFees, 0);
const totalSeniorDraw = cfs.reduce((s, c) => s + c.seniorDrawdown, 0);
const totalSeniorRepay = cfs.reduce((s, c) => s + c.seniorRepayment, 0);
const totalSeniorInt = cfs.reduce((s, c) => s + c.seniorInterest, 0);
const totalSeniorFees = cfs.reduce((s, c) => s + c.seniorFees, 0);
const totalEquityInj = cfs.reduce((s, c) => s + c.equityInjection, 0);
const totalEquityRepat = cfs.reduce((s, c) => s + c.equityRepatriation, 0);
const totalProfitDist = cfs.reduce((s, c) => s + c.profitDistribution, 0);
const finalCumCF = cfs.length > 0 ? cfs[cfs.length - 1].cumulativeCashflow : 0;
const netCFCheck = cfs.reduce((s, c) => s + c.netCashflow, 0);

console.log('\n=== CASHFLOW TOTALS ===');
console.log(`Land Costs:                     ${fmt(totalLandCosts)}`);
console.log(`Acquisition Costs:              ${fmt(totalAcqCosts)}`);
console.log(`Development Costs:              ${fmt(totalDevCosts)}`);
console.log(`Construction Costs:             ${fmt(totalConstrCosts)}`);
console.log(`Contingency:                    ${fmt(totalContingency)}`);
console.log(`Marketing Costs:                ${fmt(totalMarketing)}`);
console.log(`Other Standard Costs:           ${fmt(totalOtherStd)}`);
console.log(`PM Fees:                        ${fmt(totalPM)}`);
console.log(`Front-End Commissions:          ${fmt(totalFEComm)}`);
console.log(`Back-End Commissions:           ${fmt(totalBEComm)}`);
console.log(`Other Financing Costs:          ${fmt(totalOtherFin)}`);
console.log(`GST on Costs:                   ${fmt(totalGSTCosts)}`);
console.log(`Settlements Revenue:            ${fmt(totalSettlements)}`);
console.log(`Deposits Revenue:               ${fmt(totalDeposits)}`);
console.log(`Rental Income:                  ${fmt(totalRental)}`);
console.log(`Other Income:                   ${fmt(totalOtherInc)}`);
console.log(`GST on Revenue:                 ${fmt(totalGSTRev)}`);
console.log(`Land Loan Drawdown:             ${fmt(totalLLDrawdown)}`);
console.log(`Land Loan Repayment:            ${fmt(totalLLRepay)}`);
console.log(`Land Loan Interest:             ${fmt(totalLLInterest)}`);
console.log(`Land Loan Fees:                 ${fmt(totalLLFees)}`);
console.log(`Senior Drawdown:                ${fmt(totalSeniorDraw)}`);
console.log(`Senior Repayment:               ${fmt(totalSeniorRepay)}`);
console.log(`Senior Interest:                ${fmt(totalSeniorInt)}`);
console.log(`Senior Fees:                    ${fmt(totalSeniorFees)}`);
console.log(`Equity Injections:              ${fmt(totalEquityInj)}`);
console.log(`Equity Repatriations:           ${fmt(totalEquityRepat)}`);
console.log(`Profit Distributions:           ${fmt(totalProfitDist)}`);
console.log(`Net Cashflow Check (should be ~0): ${fmt(netCFCheck)}`);
console.log(`Final Cumulative CF:            ${fmt(finalCumCF)}`);

console.log('\n=== MONTHLY CASHFLOW (first 5 and last 5 periods) ===');
console.log('Period | LandCost | DevCost | ConstrCost | Settlements | NetCF | CumCF');
for (let i = 0; i < Math.min(5, cfs.length); i++) {
  const c = cfs[i];
  console.log(`M${(i+1).toString().padStart(2,'0')} | ${fmt(c.landCosts).padStart(15)} | ${fmt(c.developmentCosts).padStart(12)} | ${fmt(c.constructionCosts).padStart(13)} | ${fmt(c.grvSettlements).padStart(13)} | ${fmt(c.netCashflow).padStart(12)} | ${fmt(c.cumulativeCashflow).padStart(14)}`);
}
console.log('...');
for (let i = Math.max(0, cfs.length - 5); i < cfs.length; i++) {
  const c = cfs[i];
  console.log(`M${(i+1).toString().padStart(2,'0')} | ${fmt(c.landCosts).padStart(15)} | ${fmt(c.developmentCosts).padStart(12)} | ${fmt(c.constructionCosts).padStart(13)} | ${fmt(c.grvSettlements).padStart(13)} | ${fmt(c.netCashflow).padStart(12)} | ${fmt(c.cumulativeCashflow).padStart(14)}`);
}

console.log('\nDone.');
