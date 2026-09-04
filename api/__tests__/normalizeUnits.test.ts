/**
 * Tests for the numeric coercion applied to AI-returned rows.
 *
 * Run with:  npx tsx api/__tests__/normalizeUnits.test.ts
 *
 * The competitor table's internal-area and $/m² columns were rendering empty
 * because the model returned those fields as strings ("85", "85 m²") and every
 * consumer tested `typeof x === 'number'`. These pin the coercion, and in
 * particular the one genuinely dangerous case: an "m" that means "million" vs
 * an "m" that is the start of "m²".
 *
 * Lives under `__tests__` so Vercel's function detection skips it.
 */
import { toNumber, toMoney, toBoolean, normalizeUnitRows, normalizeSuburbRows } from '../_lib/normalizeUnits';

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

console.log('\nTO NUMBER (areas, counts)');
eq('plain number passes through', toNumber(85), 85);
eq('numeric string', toNumber('85'), 85);
eq('area with unit', toNumber('85 m²'), 85);
eq('area with sqm', toNumber('85 sqm'), 85);
eq('qualifier prefix', toNumber('approx. 85'), 85);
eq('tilde prefix', toNumber('~85'), 85);
eq('decimal', toNumber('85.5'), 85.5);
eq('thousands separator', toNumber('1,250'), 1250);
eq('range takes the first', toNumber('80-90'), 80);
eq('no digits → null', toNumber('n/a'), null);
eq('empty → null', toNumber(''), null);
eq('null → null', toNumber(null), null);
eq('undefined → null', toNumber(undefined), null);
eq('NaN → null', toNumber(NaN), null);
eq('Infinity → null', toNumber(Infinity), null);

console.log('\nTO MONEY (prices, fees)');
eq('plain number passes through', toMoney(1150000), 1150000);
eq('formatted price', toMoney('$1,150,000'), 1150000);
eq('millions suffix', toMoney('$1.15M'), 1150000);
eq('lowercase millions', toMoney('1.15m'), 1150000);
eq('thousands suffix', toMoney('850k'), 850000);
// The case that makes a naive suffix rule catastrophic:
eq('"85 m²" is NOT 85 million', toMoney('85 m²'), 85);
eq('"85 m2" is NOT 85 million', toMoney('85 m2'), 85);
eq('no digits → null', toMoney('POA'), null);
eq('null → null', toMoney(null), null);

console.log('\nTO BOOLEAN (study)');
eq('true passes through', toBoolean(true), true);
eq('"Yes"', toBoolean('Yes'), true);
eq('"no"', toBoolean('no'), false);
eq('"true"', toBoolean('true'), true);
eq('unrecognised → null', toBoolean('maybe'), null);
eq('null → null', toBoolean(null), null);

console.log('\nNORMALISE UNIT ROWS');
const units = normalizeUnitRows([
  {
    villageName: 'Wood Glen', price: '$1,150,000', internalSqm: '85 m²', landSqm: null,
    bedrooms: '3', bathrooms: '1', carSpaces: '1', distanceKm: '2.4',
    recurringFee: '487.06', study: 'No', unitType: 'ILU villa',
  },
]) as Array<Record<string, unknown>>;
eq('price coerced', units[0]?.price, 1150000);
eq('internal area coerced', units[0]?.internalSqm, 85);
eq('bedrooms coerced', units[0]?.bedrooms, 3);
eq('distance coerced', units[0]?.distanceKm, 2.4);
eq('levy coerced', units[0]?.recurringFee, 487.06);
eq('study coerced', units[0]?.study, false);
eq('non-numeric fields untouched', units[0]?.unitType, 'ILU villa');
eq('village name untouched', units[0]?.villageName, 'Wood Glen');
eq('null area stays null', units[0]?.landSqm, null);

console.log('\nNORMALISE SUBURB ROWS');
const suburbs = normalizeSuburbRows([
  { suburb: 'Bateau Bay', medianHousePrice: '$1,220,000', medianUnitPrice: '790000', distanceKm: '0' },
]) as Array<Record<string, unknown>>;
eq('median house coerced', suburbs[0]?.medianHousePrice, 1220000);
eq('median unit coerced', suburbs[0]?.medianUnitPrice, 790000);
eq('suburb name untouched', suburbs[0]?.suburb, 'Bateau Bay');

console.log('\nMALFORMED INPUT IS SAFE');
eq('non-array returned as-is', normalizeUnitRows(null), null);
eq('non-object entries survive', normalizeUnitRows(['x']), ['x']);

console.log('\n' + '═'.repeat(60));
console.log(`NORMALIZE UNITS TESTS: ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log('═'.repeat(60));
if (failed > 0) process.exit(1);
