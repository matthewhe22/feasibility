/**
 * Tests for validating RV suburb-pricing rows against live REA suburb-profile
 * pages.
 *
 * Run with:  npx tsx api/__tests__/suburbValidation.test.ts
 *
 * Lives under `__tests__` so Vercel's function detection skips it.
 */
import { validateSuburbRows, monthsSincePeriodEnd } from '../_lib/suburbValidation';
import type { ReaProfileFigures } from '../_lib/reaSuburbProfile';

let passed = 0;
let failed = 0;

function eq(name: string, actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name} — got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
  }
}

const today = new Date(Date.UTC(2026, 9, 23)); // 2026-10-23
const profile = (over: Partial<ReaProfileFigures>): ReaProfileFigures => ({
  url: 'https://www.realestate.com.au/vic/x-3216/', medianHousePrice: null, housePeriod: 'September 2025 - September 2026',
  houseGrowth12mPct: null, medianUnitPrice: null, unitPeriod: null, unitGrowth12mPct: null, ...over,
});
const profiles = new Map<string, ReaProfileFigures>([
  ['grovedale', profile({ url: 'https://www.realestate.com.au/vic/grovedale-3216/', medianHousePrice: 746000, houseGrowth12mPct: 9.7, medianUnitPrice: 545700 })],
  ['charlemont', profile({ medianHousePrice: 660000, houseGrowth12mPct: 4.8 })], // no unit snapshot
  ['old-town', profile({ medianHousePrice: 500000, housePeriod: 'March 2025 - March 2026' })],
]);

const { rows, validation } = validateSuburbRows([
  { suburb: 'Grovedale', medianHousePrice: 747250, medianUnitPrice: '$545,700', medianHousePrice12mAgo: 600000 },
  { suburb: 'Charlemont', medianHousePrice: 660000, medianUnitPrice: 480000 },
  { suburb: 'Old Town', medianHousePrice: 500000 },
  { suburb: 'Nowhere', medianHousePrice: 900000 },
], profiles, today);
const r = rows as Array<Record<string, unknown>>;

console.log('\nOVERRIDE + CORRECTIONS');
eq('profile MHP replaces the AI figure', r[0]?.medianHousePrice, 746000);
eq('AI MHP that differed is recorded', validation.corrections[0], { suburb: 'Grovedale', field: 'medianHousePrice', aiValue: 747250, pageValue: 746000 });
eq('matching MUP ("$545,700" string) is not a correction', validation.corrections.filter(c => c.suburb === 'Grovedale').length, 1);
eq('stated prior median cleared so it is re-derived from the page growth', r[0]?.medianHousePrice12mAgo, null);
eq('period + growth from the page', [r[0]?.asOf, r[0]?.houseGrowth12mPct], ['September 2025 - September 2026', 9.7]);
eq('row marked verified with its page', [r[0]?.verified, r[0]?.profileUrl], [true, 'https://www.realestate.com.au/vic/grovedale-3216/']);
eq('page publishes no unit median → MUP null, not the AI figure', r[1]?.medianUnitPrice, null);
eq('…and the dropped AI MUP is reported', validation.corrections.find(c => c.suburb === 'Charlemont'), { suburb: 'Charlemont', field: 'medianUnitPrice', aiValue: 480000, pageValue: null });

console.log('\nUNVERIFIED + STALE');
eq('no profile → row kept as the AI gave it', [r[3]?.medianHousePrice, r[3]?.verified], [900000, false]);
eq('unverified listed', validation.unverified, ['Nowhere']);
eq('counts', [validation.suburbs, validation.verified], [4, 3]);
eq('period ending 7 months ago is stale', validation.stale, ['Old Town']);
eq('months since "September 2025 - September 2026"', monthsSincePeriodEnd('September 2025 - September 2026', today), 1);
eq('unparseable period → null', monthsSincePeriodEnd('2026-Q3', today), null);

console.log('\n' + '═'.repeat(60));
console.log(`SUBURB VALIDATION TESTS: ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log('═'.repeat(60));
if (failed > 0) process.exit(1);
