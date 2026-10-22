/**
 * Tests for the competitor-evidence scope: sales from the last 12 months,
 * current listings, within the proximity radius.
 *
 * Run with:  npx tsx api/__tests__/competitorScope.test.ts
 *
 * Lives under `__tests__` so Vercel's function detection skips it.
 */
import { scopeCompetitorUnits, soldCutoff, comparableDate } from '../_lib/competitorScope';

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

const today = new Date(Date.UTC(2026, 9, 22)); // 2026-10-22

console.log('\nDATES');
eq('cutoff is 12 months back', soldCutoff(today), '2025-10-22');
eq('full date', comparableDate('2026-03-05'), '2026-03-05');
eq('month-only → end of month', comparableDate('2025-10'), '2025-10-31');
eq('February month-only', comparableDate('2024-02'), '2024-02-29');
eq('unparseable → null', comparableDate('March 2026'), null);
eq('null → null', comparableDate(null), null);

console.log('\nSCOPE');
const units = [
  { villageName: 'A', priceType: 'sold', date: '2026-05-01', distanceKm: 2 },     // keep
  { villageName: 'B', priceType: 'sold', date: '2025-10-22', distanceKm: 1 },     // keep (on cutoff)
  { villageName: 'C', priceType: 'sold', date: '2025-10', distanceKm: 1 },        // keep (cutoff month)
  { villageName: 'D', priceType: 'sold', date: '2025-09-30', distanceKm: 1 },     // old
  { villageName: 'E', priceType: 'sold', date: null, distanceKm: 1 },             // undated
  { villageName: 'F', priceType: 'listing', date: '2023-01-01', distanceKm: 3 },  // keep: current listing
  { villageName: 'G', priceType: 'listing', date: null, distanceKm: null },       // keep: no distance to test
  { villageName: 'H', priceType: 'listing', date: null, distanceKm: 7.5 },        // beyond radius
  { villageName: 'I', priceType: 'sold', date: '2026-01-01', distanceKm: 9 },     // beyond radius
];
const r = scopeCompetitorUnits(units, 5, today);
eq('kept rows', (r.units as Array<{ villageName: string }>).map(u => u.villageName), ['A', 'B', 'C', 'F', 'G']);
eq('note', r.note, { radiusKm: 5, soldSince: '2025-10-22', excludedOldSales: 1, excludedUndatedSales: 1, excludedOutsideRadius: 2 });
eq('non-array passes through', scopeCompetitorUnits(null, 5, today).units, null);

console.log('\n' + '═'.repeat(60));
console.log(`COMPETITOR SCOPE TESTS: ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log('═'.repeat(60));
if (failed > 0) process.exit(1);
