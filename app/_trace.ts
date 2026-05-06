// Trace St Kilda loss-making scenario to understand the $1.74M residual in R2.
import { runCalculations } from './src/engine/index';
import { cloneStandardBuildSCurves } from './src/engine/sCurves';
import type { AdminConfig, MainInputs } from './src/types';

const LAND_PRICE = 32_300_000;
const STAMP_DUTY_VIC = 110_000 + Math.max(0, LAND_PRICE - 2_000_000) * 0.065;

const admin: AdminConfig = {
  projectName: 'StKilda v1', modelStartDate: 45292, monthsPerPeriod: 1, lastActualsPeriod: 45292,
  tolerance: 50, daysPerYear: 365, monthsPerYear: 12, currency: '$',
  sCurveOptions: ['Evenly Split', 'Parabolic', '21 Month Build'],
  manualSCurves: [[],[],[]], buildSCurves: cloneStandardBuildSCurves(),
  contingencyGSTMode: 'gst-inclusive', applyGSTWithholding: true, itcRecoveryLagMonths: 1,
};
const inputs: MainInputs = {
  preliminary: { dateOfFirstPeriod: 45292, cashFlowPeriod: 'Monthly', projectLots: 150, projectGFA: 17000, siteArea: 3800, projectStartMonth: 1, projectSpanMonths: 39, projectEndMonth: 39, equityDistStartMonth: 33, equityDistSpanMonths: 7 },
  landPurchase: { landPurchasePrice: LAND_PRICE, prsvUplift: 0, prsvMonth: 0, prsvSpan: 0, gstRate: 0.10, gstApplicableLand: false, addGSTOnLandPrice: false, stampDutyState: 'VIC', stampDutyAmount: Math.round(STAMP_DUTY_VIC), interestOnDeposit: 0, profitShareToLandOwner: 0,
    paymentStages: [{ id:'ld', description:'Land deposit (10%)', percentOfLand: 0.10, amount: 0, lumpSum: 0, monthStart: 1, monthSpan: 1 }, { id:'lb', description:'Land balance (90%)', percentOfLand: 0.90, amount: 0, lumpSum: 0, monthStart: 4, monthSpan: 1 }],
    acquisitionCosts: [{ id:'stamp', description:'Stamp duty', amount: Math.round(STAMP_DUTY_VIC), monthStart: 4, monthSpan: 1, percentOfLand: 0, lumpSum: 0, addGST: false }, { id:'reg', description:'Title transfer', amount: 280_000, monthStart: 4, monthSpan: 1, percentOfLand: 0, lumpSum: 0, addGST: true }],
  },
  developmentCosts: [
    { code:'2001', description:'DA', costType:'Development & Project Management Fees', units:1, baseRate:520_000, totalCosts:520_000, sCurve:'Evenly Split', monthStart:1, monthSpan:9, addGST:true, ctd:0, ctc:520_000 },
    { code:'2002', description:'Architect & engineering', costType:'Development & Project Management Fees', units:1, baseRate:2_800_000, totalCosts:2_800_000, sCurve:'Evenly Split', monthStart:4, monthSpan:18, addGST:true, ctd:0, ctc:2_800_000 },
    { code:'2003', description:'Council headworks', costType:'Development & Project Management Fees', units:1, baseRate:850_000, totalCosts:850_000, sCurve:'Evenly Split', monthStart:9, monthSpan:6, addGST:true, ctd:0, ctc:850_000 },
  ],
  constructionCosts: [{ code:'4001', description:'Build', costType:'Total Construction Costs', units:17_000, baseRate:4_000, totalCosts:68_000_000, sCurve:'21 Month Build', monthStart:10, monthSpan:21, addGST:true, ctd:0, ctc:68_000_000 }],
  constructionContingencyPercent: 0.05,
  marketingCosts: [
    { code:'3001', description:'Display suite', costType:'Marketing & Advertising', units:1, baseRate:720_000, totalCosts:720_000, sCurve:'Evenly Split', monthStart:24, monthSpan:12, addGST:true, ctd:0, ctc:720_000 },
    { code:'3002', description:'Digital + print', costType:'Marketing & Advertising', units:1, baseRate:480_000, totalCosts:480_000, sCurve:'Evenly Split', monthStart:28, monthSpan:11, addGST:true, ctd:0, ctc:480_000 },
  ],
  otherStandardCosts: [
    { code:'5001', description:'Legal', costType:'Standard Costs', units:1, baseRate:360_000, totalCosts:360_000, sCurve:'Evenly Split', monthStart:1, monthSpan:39, addGST:true, ctd:0, ctc:360_000 },
    { code:'5002', description:'Insurance', costType:'Standard Costs', units:1, baseRate:540_000, totalCosts:540_000, sCurve:'Evenly Split', monthStart:1, monthSpan:39, addGST:true, ctd:0, ctc:540_000 },
    { code:'5003', description:'Council rates', costType:'Standard Costs', units:1, baseRate:290_000, totalCosts:290_000, sCurve:'Evenly Split', monthStart:1, monthSpan:39, addGST:false, ctd:0, ctc:290_000 },
  ],
  pmFees: [{ code:'6001', description:'PM fee', costType:'Development & Project Management Fees', units:1, baseRate:0, totalCosts:0, feeRatePercent:0.03, sCurve:'Evenly Split', monthStart:1, monthSpan:39, addGST:true, ctd:0, ctc:0 }],
  sellingCosts: [{ code:'S-RES', description:'St Kilda apartments', salesCommission:0.025, preCommissionPercent:0.50, depositPercent:0.10, sCurve:'Evenly Split', addGST:false }],
  frontEndSellingCosts: [], backEndSellingCosts: [], lettingFees: [],
  grvItems: [{ code:'G-RES', description:'St Kilda apartments', revenueType:'Residential', units:150, totalArea:12_750, currentSalePrice:140_250_000, gstIncluded:true, preSaleExchangeMonth:0, preSaleSpan:0, settlementMonth:33, settlementSpan:6 } as any],
  rentalIncome: [], otherIncome: [],
  equityDeveloper: { name:'Dev', fixedAmount:42_000_000, percentage:0.82, interestRate:0, interestCompound:0, repayEquityBeforeDebt:0, equityContribution:42_000_000, profitShare:0.80, drawdownPriority:1 },
  equityJV: { name:'JV', fixedAmount:9_000_000, percentage:0.18, interestRate:0, interestCompound:0, repayEquityBeforeDebt:0, equityContribution:9_000_000, profitShare:0.20, drawdownPriority:1 },
  equityPreferred: { name:'', fixedAmount:0, percentage:0, interestRate:0, interestCompound:0, repayEquityBeforeDebt:0, equityContribution:0, profitShare:0, drawdownPriority:1 },
  equityAdditional: { name:'', fixedAmount:0, percentage:0, interestRate:0, interestCompound:0, repayEquityBeforeDebt:0, equityContribution:0, profitShare:0, drawdownPriority:1 },
  landLoan: { name:'L', facilityLimit:25_000_000, startMonth:1, maturityMonth:9, interestRate:0.10, bbsy:0.0370, margin:0.0630, establishmentFeePercent:0.015, lineFeePercent:0, interestPaymentFrequency:1, isCapitalised:true, ltcTarget:0.65, lvrTarget:0.65, drawdownPriority:1 },
  seniorFacility: { name:'S', facilityLimit:95_000_000, startMonth:10, maturityMonth:36, interestRate:0.082, bbsy:0.0370, margin:0.0450, establishmentFeePercent:0.0150, lineFeePercent:0.0050, interestPaymentFrequency:1, isCapitalised:true, ltcTarget:0.70, lvrTarget:0.65, drawdownPriority:2 },
  seniorFacility2: { name:'', facilityLimit:0, startMonth:1, maturityMonth:39, interestRate:0, bbsy:0, margin:0, establishmentFeePercent:0, lineFeePercent:0, interestPaymentFrequency:1, isCapitalised:true, ltcTarget:0.70, lvrTarget:0.65, drawdownPriority:2 },
  mezzanine: { name:'', facilityLimit:0, startMonth:1, maturityMonth:39, interestRate:0, bbsy:0, margin:0, establishmentFeePercent:0, lineFeePercent:0, interestPaymentFrequency:1, isCapitalised:true, ltcTarget:0.85, lvrTarget:0.80, drawdownPriority:3 },
  residualStockFacility: { name:'', facilityLimit:0, startMonth:1, maturityMonth:39, interestRate:0, bbsy:0, margin:0, establishmentFeePercent:0, lineFeePercent:0, interestPaymentFrequency:1, isCapitalised:true, ltcTarget:0.7, lvrTarget:0.65, drawdownPriority:1 },
  otherFinancingCosts: [],
};
const r = runCalculations(admin, inputs);
const cf = r.cashflows;
const tot = (k: keyof typeof cf[0]) => cf.reduce((s,c)=>s+((c as any)[k]||0),0);
console.log('feasibility totalCost:', r.feasibility.totalCost);
console.log('feasibility totalProfit:', r.feasibility.totalProfit);
console.log('seniorFinCosts:', r.feasibility.seniorFinanceCosts);
console.log('---');
console.log('sum settlements:', tot('grvSettlements'));
console.log('sum gstOnRevenue:', tot('gstOnRevenue'));
console.log('sum gstWithholding:', tot('gstWithholding'));
console.log('sum gstOnCosts:', tot('gstOnCosts'));
console.log('sum itcRecovery:', tot('itcRecovery'));
console.log('---');
console.log('sum senior drawdown:', tot('seniorDrawdown'));
console.log('sum senior repayment:', tot('seniorRepayment'));
console.log('sum senior interest:', tot('seniorInterest'));
console.log('sum senior fees:', tot('seniorFees'));
console.log('senior end balance:', cf[cf.length-1].seniorBalance);
console.log('---');
console.log('sum land drawdown:', tot('landLoanDrawdown'));
console.log('sum land repayment:', tot('landLoanRepayment'));
console.log('sum land interest:', tot('landLoanInterest'));
console.log('sum land fees:', tot('landLoanFees'));
console.log('land end balance:', cf[cf.length-1].landLoanBalance);
console.log('---');
console.log('sum equity inject:', tot('equityInjection'));
console.log('sum equity repat:', tot('equityRepatriation'));
console.log('sum profit dist:', tot('profitDistribution'));
console.log('---');
console.log('sum netCashflow:', tot('netCashflow'));
// "Cap-int delta"
const seniorPrincipalDrawn = tot('seniorDrawdown') - tot('seniorInterest');
const seniorPrincipalRepaid = tot('seniorRepayment') - tot('seniorInterest'); // approx
console.log('senior principal drawn (= total drawdown - cap interest):', seniorPrincipalDrawn);
console.log('senior interest accrued:', tot('seniorInterest'));
console.log('---');
// Check: drawdown - repayment per period over time
let cum_snr = 0, cum_land = 0;
let firstNonzero = -1;
for (let i = 0; i < cf.length; i++) {
  const d = cf[i].seniorDrawdown - cf[i].seniorRepayment;
  cum_snr += d;
}
console.log('cumulative senior (draw-repay):', cum_snr, '(should = ending balance)');
