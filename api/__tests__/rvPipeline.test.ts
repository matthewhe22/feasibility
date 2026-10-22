/**
 * Tests for two RV-research safety nets: recovering a JSON reply cut off at the
 * model's output limit, and checking competitor distances against geocoded
 * suburb centres.
 *
 * Run with:  npx tsx api/__tests__/rvPipeline.test.ts
 *
 * Lives under `__tests__` so Vercel's function detection skips it.
 */
import { parseJsonResponse, repairTruncatedJson } from '../_lib/aiClient';
import { verifyCompetitorDistances, haversineKm } from '../_lib/competitorDistance';

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

async function main() {
  console.log('\nTRUNCATED REPLIES');
  const full = JSON.stringify({ subject: { name: 'X' }, units: [{ a: 1, s: 'q}"x' }, { a: 2 }, { a: 3, b: 'tru' }], summary: 's' });
  const cut = full.slice(0, full.indexOf('{"a":3') + 10);
  eq('complete rows kept, partial row dropped, flagged', parseJsonResponse(cut),
    { subject: { name: 'X' }, units: [{ a: 1, s: 'q}"x' }, { a: 2 }], _truncated: true });
  eq('cut inside a key after the array', parseJsonResponse('{"units":[{"a":1},{"a":2}],"summ'), { units: [{ a: 1 }, { a: 2 }], _truncated: true });
  eq('fenced + escaped quote/brace inside a string', parseJsonResponse('```json\n{"units":[{"a":"x\\"}"},'), { units: [{ a: 'x"}' }], _truncated: true });
  eq('complete JSON is not marked truncated', parseJsonResponse(full), JSON.parse(full));
  eq('nothing complete → null', repairTruncatedJson('{"units":[{"a":'), null);
  eq('no JSON at all → null', parseJsonResponse('Sorry, I cannot help'), null);

  console.log('\nDISTANCES');
  const coords: Record<string, { lat: number; lng: number }> = {
    'bateau bay': { lat: -33.381, lng: 151.476 },
    'killarney vale': { lat: -33.367, lng: 151.459 }, // ~2.2 km
    'gosford': { lat: -33.426, lng: 151.342 },        // ~13.4 km
  };
  const geocode = async (s: string) => coords[s.toLowerCase()] ?? null;
  eq('haversine sanity (Bateau Bay → Gosford ≈ 13 km)', Math.round(haversineKm(coords['bateau bay']!, coords['gosford']!)), 13);
  const r = await verifyCompetitorDistances([
    { villageName: 'A', suburb: 'Killarney Vale' },                 // missing → filled
    { villageName: 'B', suburb: 'Gosford', distanceKm: 4 },         // model says inside, clearly outside → corrected
    { villageName: 'C', suburb: 'Killarney Vale', distanceKm: 3 },  // plausible → kept
    { villageName: 'D', address: '7 Main Rd, Gosford NSW 2250' },   // suburb from address → filled
    { villageName: 'E', suburb: 'Nowhere' },                        // not geocodable → untouched
  ], { suburb: 'Bateau Bay', state: 'NSW' }, 5, geocode);
  const rows = r.units as Array<Record<string, unknown>>;
  eq('missing distance filled from suburb centres', [rows[0]?.distanceKm, rows[0]?.distanceBasis], [2.2, 'suburb-centre']);
  eq('implausible model distance corrected', rows[1]?.distanceKm, 13.4);
  eq('plausible model distance kept', [rows[2]?.distanceKm, rows[2]?.distanceBasis], [3, undefined]);
  eq('suburb read from the address', rows[3]?.distanceKm, 13.4);
  eq('ungeocodable row untouched', rows[4], { villageName: 'E', suburb: 'Nowhere' });
  eq('counts', [r.checked, r.corrected], [4, 1]);
  const noSubject = await verifyCompetitorDistances([{ suburb: 'Gosford' }], { suburb: undefined }, 5, geocode);
  eq('no subject suburb → unchanged', noSubject.units, [{ suburb: 'Gosford' }]);

  console.log('\n' + '═'.repeat(60));
  console.log(`RV PIPELINE TESTS: ${passed} passed, ${failed} failed (${passed + failed} total)`);
  console.log('═'.repeat(60));
  if (failed > 0) process.exit(1);
}
void main();
