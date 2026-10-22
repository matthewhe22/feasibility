/**
 * Tests for the competitor-evidence scope: sales from the last 12 months,
 * current listings, within the proximity radius.
 *
 * Run with:  npx tsx api/__tests__/competitorScope.test.ts
 *
 * Lives under `__tests__` so Vercel's function detection skips it.
 */
import { scopeCompetitorUnits, soldCutoff, comparableDate, sameVillage, isRental, dedupeUnits } from '../_lib/competitorScope';

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
  { villageName: 'E', priceType: 'sold', date: null, distanceKm: 1 },             // undated: kept, flagged
  { villageName: 'F', priceType: 'listing', date: '2023-01-01', distanceKm: 3 },  // keep: current listing
  { villageName: 'G', priceType: 'listing', date: null, distanceKm: null },       // keep: no distance to test
  { villageName: 'H', priceType: 'listing', date: null, distanceKm: 7.5 },        // beyond radius
  { villageName: 'I', priceType: 'sold', date: '2026-01-01', distanceKm: 9 },     // beyond radius
];
const r = scopeCompetitorUnits(units, 5, today);
const kept = r.units as Array<{ villageName: string; note?: string }>;
eq('kept rows', kept.map(u => u.villageName), ['A', 'B', 'C', 'E', 'F', 'G']);
eq('undated sale flagged', kept.find(u => u.villageName === 'E')?.note, 'Sale date not published');
eq('note', r.note, {
  radiusKm: 5, soldSince: '2025-10-22', excludedOldSales: 1, undatedSalesKept: 1, excludedOutsideRadius: 2,
  excludedSubject: 0, excludedRentals: 0, duplicatesMerged: 0,
});
const withNote = scopeCompetitorUnits([{ priceType: 'sold', date: null, note: 'Refurbished' }], 5, today).units as Array<{ note: string }>;
eq('flag appended to an existing note', withNote[0]?.note, 'Refurbished — sale date not published');
eq('non-array passes through', scopeCompetitorUnits(null, 5, today).units, null);

console.log('\nSUBJECT VILLAGE');
eq('operator brand + name = plain name', sameVillage('Australian Unity Elderslee', 'Elderslee Retirement Community'), true);
eq('identical', sameVillage('Kiah Lodge', 'Kiah Lodge Retirement Community'), true);
eq('different villages', sameVillage('Elderslee Retirement Community', 'Kiah Lodge Retirement Community'), false);
eq('same operator, different village', sameVillage('Australian Unity Elderslee', 'Australian Unity Kiah Lodge'), false);
eq('only generic words never match', sameVillage('Retirement Village', 'The Retirement Village'), false);
const subj = scopeCompetitorUnits([
  { villageName: 'Elderslee Retirement Community', priceType: 'listing', price: 400000 },
  { villageName: 'Kiah Lodge', priceType: 'listing', price: 430000 },
], 5, today, 'Australian Unity Elderslee');
eq('subject village rows dropped', (subj.units as Array<{ villageName: string }>).map(u => u.villageName), ['Kiah Lodge']);
eq('subject count', subj.note.excludedSubject, 1);

console.log('\nRENTALS');
eq('weekly rent price', isRental({ priceType: 'listing', price: 600 }), true);
eq('rental tenure', isRental({ priceType: 'listing', price: 350000, tenure: 'Rental' }), true);
eq('per week in note', isRental({ priceType: 'listing', price: null, note: '$550 per week' }), true);
eq('ingoing price is not a rental', isRental({ priceType: 'listing', price: 320000, tenure: 'licence' }), false);

console.log('\nDUPLICATES');
const dups = dedupeUnits([
  // Same unit on villages.com.au and downsizing.com.au: unit number on one, address on the other.
  { villageName: 'Elderslee Retirement Community', unitNumber: '61', priceType: 'listing', price: 400000, bedrooms: 1,
    sourceUrl: 'https://www.villages.com.au/nsw/cc/elderslee-4002#ee52' },
  { villageName: 'Elderslee', address: '61/15 Bias Ave, Bateau Bay', priceType: 'listing', price: 400000, bedrooms: 1,
    recurringFee: 448.13, sourceUrl: 'https://www.downsizing.com.au/property/sale/266803/x' },
  // Same village, same price, same site, no unit numbers: two real vacancies — kept apart.
  { villageName: 'Elderslee', priceType: 'listing', price: 400000, bedrooms: 1, sourceUrl: 'https://www.villages.com.au/nsw/cc/elderslee-4002#c5ef' },
  { villageName: 'Elderslee', priceType: 'listing', price: 400000, bedrooms: 1, sourceUrl: 'https://www.villages.com.au/nsw/cc/elderslee-4002#5e38' },
  // Different unit numbers at the same price: kept apart.
  { villageName: 'Kiah Lodge', unitNumber: '16/15', priceType: 'listing', price: 430000, sourceUrl: 'https://a.example/1' },
  { villageName: 'Kiah Lodge', unitNumber: '17/15', priceType: 'listing', price: 430000, sourceUrl: 'https://b.example/2' },
  // Listing vs sold of the same unit: different records, kept apart.
  { villageName: 'Kiah Lodge', unitNumber: '16/15', priceType: 'sold', price: 410000, sourceUrl: 'https://c.example/3' },
]) as Array<Record<string, unknown>>;
eq('one cross-site duplicate merged', dups.length, 6);
eq('merged row keeps the first source', dups[0]?.sourceUrl, 'https://www.villages.com.au/nsw/cc/elderslee-4002#ee52');
eq('merged row gains the levy from the duplicate', dups[0]?.recurringFee, 448.13);
eq('merged row notes the other site', dups[0]?.note, 'Also listed on downsizing.com.au');
const merged = scopeCompetitorUnits([
  { villageName: 'Wood Glen', unitNumber: '5/2', priceType: 'listing', price: 500000, sourceUrl: 'https://x.example/1' },
  { villageName: 'Wood Glen', unitNumber: '5/2', priceType: 'listing', price: 500000, sourceUrl: 'https://y.example/1' },
], 5, today);
eq('scope reports merged count', merged.note.duplicatesMerged, 1);

console.log('\n' + '═'.repeat(60));
console.log(`COMPETITOR SCOPE TESTS: ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log('═'.repeat(60));
if (failed > 0) process.exit(1);
