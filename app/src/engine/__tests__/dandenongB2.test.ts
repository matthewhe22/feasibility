/**
 * Dandenong B2 — Cashflow & Table 9 dates offset bug.
 *
 * Symptom on prod: with `dateOfFirstPeriod = 46388` configured, Cashflow /
 * Table 9 month labels rendered ~12 months earlier than the configured
 * serial. Root cause: the prior local-time-anchored Excel-serial → JS-Date
 * converter combined with mixed local-time / UTC method usage in the
 * timeline (setDate / getMonth) was fragile across timezones with DST.
 *
 * Fix: anchor the converter at UTC and use UTC methods consistently in
 * the timeline + label formatter. This test asserts the canonical
 * Excel-serial → calendar-date mapping AND verifies the timeline produces
 * stable labels for both the legacy default (45017 / Apr-23) and the
 * Dandenong configuration (46388 / Jan-27).
 *
 * Run: cd app && npx tsx src/engine/__tests__/dandenongB2.test.ts
 */
import { excelDateToDate, dateToExcelSerial, formatMonthYear, addMonths } from '../../utils';
import { generateTimeline } from '../timeline';
import type { AdminConfig, MainInputs } from '../../types';

let passed = 0, failed = 0;
const failures: string[] = [];
function assert(cond: boolean, msg: string): void {
  if (cond) passed++; else { failed++; failures.push(msg); }
}

// ── 1. Canonical Excel serial → calendar date mapping (UTC) ────────────────
{
  const cases: Array<[number, number, number, string]> = [
    // serial,  expected year, month (1-12), label
    [44927, 2023, 1, 'Jan-23'],   // modelStartDate default
    [45017, 2023, 4, 'Apr-23'],   // dateOfFirstPeriod default
    [46388, 2027, 1, 'Jan-27'],   // Dandenong configured value
    [46478, 2027, 4, 'Apr-27'],   // Apr-27 reference point
    [1,     1899, 12, 'Dec-99'],  // serial 1 = Dec 31, 1899 (Excel epoch)
    [60,    1900, 2, 'Feb-00'],   // serial 60 = Feb 28 1900 (post-leap-fix)
  ];
  for (const [serial, expY, expM, expLabel] of cases) {
    const d = excelDateToDate(serial);
    assert(d.getUTCFullYear() === expY, `B2: serial ${serial} year is ${expY} (got ${d.getUTCFullYear()})`);
    assert(d.getUTCMonth() + 1 === expM, `B2: serial ${serial} month is ${expM} (got ${d.getUTCMonth() + 1})`);
    assert(formatMonthYear(d) === expLabel, `B2: serial ${serial} label is "${expLabel}" (got "${formatMonthYear(d)}")`);
  }
}

// ── 2. Round-trip excelDateToDate → dateToExcelSerial ──────────────────────
{
  for (const s of [1, 60, 44927, 45017, 46388, 46478, 60000]) {
    const round = dateToExcelSerial(excelDateToDate(s));
    assert(round === s, `B2: round-trip ${s} → date → serial = ${round} (expected ${s})`);
  }
}

// ── 3. addMonths is UTC-stable across DST boundaries ───────────────────────
{
  // Apr 1, 2027 + 1 month = May 1, 2027 (no DST in UTC).
  const d = excelDateToDate(46478);  // Apr 1, 2027
  const next = addMonths(d, 1);
  assert(next.getUTCFullYear() === 2027 && next.getUTCMonth() === 4,
    `B2: addMonths Apr-27 + 1 = May-27 (got ${formatMonthYear(next)})`);
  // Jan 1, 2027 + 12 months = Jan 1, 2028 — used to compound DST drift in
  // the local-time implementation, now stable.
  const plusYr = addMonths(excelDateToDate(46388), 12);
  assert(plusYr.getUTCFullYear() === 2028 && plusYr.getUTCMonth() === 0,
    `B2: addMonths Jan-27 + 12 = Jan-28 (got ${formatMonthYear(plusYr)})`);
}

// ── 4. Timeline labels for dateOfFirstPeriod=46388 (Dandenong shape) ───────
{
  const admin: AdminConfig = {
    projectName: 'Dandenong B2', modelStartDate: 44927, monthsPerPeriod: 1,
    lastActualsPeriod: 44927, tolerance: 10, daysPerYear: 365, monthsPerYear: 12,
    currency: '$', sCurveOptions: ['Evenly Split'], manualSCurves: [[], [], []],
    buildSCurves: {}, contingencyGSTMode: 'none',
  };
  const inputs: MainInputs = {
    preliminary: { dateOfFirstPeriod: 46388, cashFlowPeriod: 'Monthly',
      projectLots: 1, projectGFA: 1000, siteArea: 500,
      projectStartMonth: 1, projectSpanMonths: 5, projectEndMonth: 5,
      equityDistStartMonth: 1, equityDistSpanMonths: 1,
    },
    landPurchase: { landPurchasePrice: 0, prsvUplift: 0, prsvMonth: 0, prsvSpan: 0, gstRate: 0.1, gstApplicableLand: false, addGSTOnLandPrice: false, stampDutyState: 'NSW', stampDutyAmount: 0, interestOnDeposit: 0, profitShareToLandOwner: 0, paymentStages: [], acquisitionCosts: [] },
    developmentCosts: [], constructionCosts: [], constructionContingencyPercent: 0,
    marketingCosts: [], otherStandardCosts: [], pmFees: [], sellingCosts: [],
    frontEndSellingCosts: [], backEndSellingCosts: [], lettingFees: [],
    grvItems: [], rentalIncome: [], otherIncome: [],
    equityDeveloper: { name: '', equityCap: 0, percentage: 0, interestRate: 0, interestCompound: 0, repayEquityBeforeDebt: 0, equityContribution: 0, profitShare: 0, drawdownPriority: 1 },
    equityJV: { name: '', equityCap: 0, percentage: 0, interestRate: 0, interestCompound: 0, repayEquityBeforeDebt: 0, equityContribution: 0, profitShare: 0, drawdownPriority: 1 },
    equityPreferred: { name: '', equityCap: 0, percentage: 0, interestRate: 0, interestCompound: 0, repayEquityBeforeDebt: 0, equityContribution: 0, profitShare: 0, drawdownPriority: 1 },
    equityAdditional: { name: '', equityCap: 0, percentage: 0, interestRate: 0, interestCompound: 0, repayEquityBeforeDebt: 0, equityContribution: 0, profitShare: 0, drawdownPriority: 1 },
    landLoan: { name: '', facilityLimit: 0, startMonth: 1, maturityMonth: 5, interestRate: 0, bbsy: 0, margin: 0, establishmentFeePercent: 0, lineFeePercent: 0, interestPaymentFrequency: 1, isCapitalised: true, ltcTarget: 0, lvrTarget: 0, drawdownPriority: 1 },
    mezzanine: { name: '', facilityLimit: 0, startMonth: 1, maturityMonth: 5, interestRate: 0, bbsy: 0, margin: 0, establishmentFeePercent: 0, lineFeePercent: 0, interestPaymentFrequency: 1, isCapitalised: true, ltcTarget: 0, lvrTarget: 0, drawdownPriority: 1 },
    seniorFacility: { name: '', facilityLimit: 0, startMonth: 1, maturityMonth: 5, interestRate: 0, bbsy: 0, margin: 0, establishmentFeePercent: 0, lineFeePercent: 0, interestPaymentFrequency: 1, isCapitalised: true, ltcTarget: 0, lvrTarget: 0, drawdownPriority: 1 },
    seniorFacility2: { name: '', facilityLimit: 0, startMonth: 1, maturityMonth: 5, interestRate: 0, bbsy: 0, margin: 0, establishmentFeePercent: 0, lineFeePercent: 0, interestPaymentFrequency: 1, isCapitalised: true, ltcTarget: 0, lvrTarget: 0, drawdownPriority: 1 },
    residualStockFacility: { name: '', facilityLimit: 0, startMonth: 1, maturityMonth: 5, interestRate: 0, bbsy: 0, margin: 0, establishmentFeePercent: 0, lineFeePercent: 0, interestPaymentFrequency: 1, isCapitalised: true, ltcTarget: 0, lvrTarget: 0, drawdownPriority: 1 },
    otherFinancingCosts: [],
  } as unknown as MainInputs;

  const periods = generateTimeline(admin, inputs);
  const expected = ['Jan-27', 'Feb-27', 'Mar-27', 'Apr-27', 'May-27'];
  for (let i = 0; i < expected.length; i++) {
    assert(periods[i]?.label === expected[i],
      `B2 timeline label[${i}]: expected ${expected[i]}, got ${periods[i]?.label}`);
  }
  // No 12-month-off drift: period 4 (i=3) is Apr-27 NOT Apr-26 or Apr-28.
  assert(periods[3]?.label === 'Apr-27',
    `B2: period 4 with dateOfFirstPeriod=46388 is Apr-27 (not 12 months off)`);
}

// ── 5. Same with the legacy default (Apr-23 baseline) ──────────────────────
{
  const admin: AdminConfig = {
    projectName: 'B2 default baseline', modelStartDate: 44927, monthsPerPeriod: 1,
    lastActualsPeriod: 44927, tolerance: 10, daysPerYear: 365, monthsPerYear: 12,
    currency: '$', sCurveOptions: ['Evenly Split'], manualSCurves: [[], [], []],
    buildSCurves: {}, contingencyGSTMode: 'none',
  };
  const inputs: MainInputs = {
    preliminary: { dateOfFirstPeriod: 45017, cashFlowPeriod: 'Monthly',
      projectLots: 1, projectGFA: 1000, siteArea: 500,
      projectStartMonth: 1, projectSpanMonths: 3, projectEndMonth: 3,
      equityDistStartMonth: 1, equityDistSpanMonths: 1,
    },
    landPurchase: { landPurchasePrice: 0, prsvUplift: 0, prsvMonth: 0, prsvSpan: 0, gstRate: 0.1, gstApplicableLand: false, addGSTOnLandPrice: false, stampDutyState: 'NSW', stampDutyAmount: 0, interestOnDeposit: 0, profitShareToLandOwner: 0, paymentStages: [], acquisitionCosts: [] },
    developmentCosts: [], constructionCosts: [], constructionContingencyPercent: 0,
    marketingCosts: [], otherStandardCosts: [], pmFees: [], sellingCosts: [],
    frontEndSellingCosts: [], backEndSellingCosts: [], lettingFees: [],
    grvItems: [], rentalIncome: [], otherIncome: [],
    equityDeveloper: { name: '', equityCap: 0, percentage: 0, interestRate: 0, interestCompound: 0, repayEquityBeforeDebt: 0, equityContribution: 0, profitShare: 0, drawdownPriority: 1 },
    equityJV: { name: '', equityCap: 0, percentage: 0, interestRate: 0, interestCompound: 0, repayEquityBeforeDebt: 0, equityContribution: 0, profitShare: 0, drawdownPriority: 1 },
    equityPreferred: { name: '', equityCap: 0, percentage: 0, interestRate: 0, interestCompound: 0, repayEquityBeforeDebt: 0, equityContribution: 0, profitShare: 0, drawdownPriority: 1 },
    equityAdditional: { name: '', equityCap: 0, percentage: 0, interestRate: 0, interestCompound: 0, repayEquityBeforeDebt: 0, equityContribution: 0, profitShare: 0, drawdownPriority: 1 },
    landLoan: { name: '', facilityLimit: 0, startMonth: 1, maturityMonth: 3, interestRate: 0, bbsy: 0, margin: 0, establishmentFeePercent: 0, lineFeePercent: 0, interestPaymentFrequency: 1, isCapitalised: true, ltcTarget: 0, lvrTarget: 0, drawdownPriority: 1 },
    mezzanine: { name: '', facilityLimit: 0, startMonth: 1, maturityMonth: 3, interestRate: 0, bbsy: 0, margin: 0, establishmentFeePercent: 0, lineFeePercent: 0, interestPaymentFrequency: 1, isCapitalised: true, ltcTarget: 0, lvrTarget: 0, drawdownPriority: 1 },
    seniorFacility: { name: '', facilityLimit: 0, startMonth: 1, maturityMonth: 3, interestRate: 0, bbsy: 0, margin: 0, establishmentFeePercent: 0, lineFeePercent: 0, interestPaymentFrequency: 1, isCapitalised: true, ltcTarget: 0, lvrTarget: 0, drawdownPriority: 1 },
    seniorFacility2: { name: '', facilityLimit: 0, startMonth: 1, maturityMonth: 3, interestRate: 0, bbsy: 0, margin: 0, establishmentFeePercent: 0, lineFeePercent: 0, interestPaymentFrequency: 1, isCapitalised: true, ltcTarget: 0, lvrTarget: 0, drawdownPriority: 1 },
    residualStockFacility: { name: '', facilityLimit: 0, startMonth: 1, maturityMonth: 3, interestRate: 0, bbsy: 0, margin: 0, establishmentFeePercent: 0, lineFeePercent: 0, interestPaymentFrequency: 1, isCapitalised: true, ltcTarget: 0, lvrTarget: 0, drawdownPriority: 1 },
    otherFinancingCosts: [],
  } as unknown as MainInputs;
  const periods = generateTimeline(admin, inputs);
  assert(periods[0]?.label === 'Apr-23', `B2 baseline: period 1 is Apr-23 (got ${periods[0]?.label})`);
  assert(periods[2]?.label === 'Jun-23', `B2 baseline: period 3 is Jun-23 (got ${periods[2]?.label})`);
}

console.log(`\nDANDENONG-B2 TESTS: ${passed} passed, ${failed} failed (${passed+failed} total)`);
if (failed > 0) {
  console.log('Failures:'); for (const f of failures) console.log('  -', f);
  (globalThis as unknown as { process: { exit(c: number): never } }).process.exit(1);
}
