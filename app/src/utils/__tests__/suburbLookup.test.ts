import { lookupSuburb, __stateFromPostcodeForTests } from '../suburbLookup';

let passed = 0, failed = 0;
const failures: string[] = [];
function assert(cond: boolean, msg: string): void {
  if (cond) { passed++; return; }
  failed++; failures.push(msg);
}

// Disambiguation: Paddington exists in NSW and QLD. Address must pick the right state.
const padNsw = lookupSuburb('1 Oxford Street, Paddington NSW 2021');
assert(padNsw?.state === 'NSW', `paddington NSW resolves to NSW (got ${padNsw?.state})`);

const padQld = lookupSuburb('123 Latrobe Tce, Paddington QLD 4064');
assert(padQld?.state === 'QLD', `paddington QLD resolves to QLD (got ${padQld?.state})`);

// Postcode-only disambiguation (no state token).
const padPostcode = lookupSuburb('Paddington 4064');
assert(padPostcode?.state === 'QLD', `paddington 4064 picks QLD from postcode (got ${padPostcode?.state})`);

// Richmond exists in VIC, NSW, QLD — verify VIC entry.
const richVic = lookupSuburb('5 Bridge Road, Richmond VIC 3121');
assert(richVic?.state === 'VIC', `richmond VIC resolves to VIC (got ${richVic?.state})`);

// Locality-segment guard: a road or building name containing a known suburb
// must NOT be picked when the actual suburb is something else.
const newtownRoad = lookupSuburb('5 Newtown Road, Glebe NSW 2037');
assert(newtownRoad?.suburb === 'glebe', `glebe wins over newtown when newtown is just a street name (got ${newtownRoad?.suburb})`);

// Locality-segment guard with collision: don't misattribute when a known
// suburb appears in the street portion.
const bondiOnRichmondRd = lookupSuburb('12 Richmond Road, Bondi NSW 2026');
assert(bondiOnRichmondRd?.suburb === 'bondi', `bondi wins over richmond when richmond is just a street (got ${bondiOnRichmondRd?.suburb})`);

// Multi-word suburb wins over single-word substring.
const surfers = lookupSuburb('1 Esplanade, Surfers Paradise QLD 4217');
assert(surfers?.suburb === 'surfers paradise', `multi-word "surfers paradise" matches (got ${surfers?.suburb})`);

// Postcode → state mapping basics.
assert(__stateFromPostcodeForTests('2000') === 'NSW', 'postcode 2000 → NSW');
assert(__stateFromPostcodeForTests('3000') === 'VIC', 'postcode 3000 → VIC');
assert(__stateFromPostcodeForTests('4000') === 'QLD', 'postcode 4000 → QLD');
assert(__stateFromPostcodeForTests('5000') === 'SA',  'postcode 5000 → SA');
assert(__stateFromPostcodeForTests('6000') === 'WA',  'postcode 6000 → WA');
assert(__stateFromPostcodeForTests('7000') === 'TAS', 'postcode 7000 → TAS');
assert(__stateFromPostcodeForTests('2600') === 'ACT', 'postcode 2600 → ACT');
assert(__stateFromPostcodeForTests('0800') === 'NT',  'postcode 0800 → NT');
assert(__stateFromPostcodeForTests('9999') === 'QLD', 'postcode 9999 (PO box) → QLD');
assert(__stateFromPostcodeForTests('not-a-postcode') === null, 'garbage → null');

// Casual input without state/postcode still seeds via looser pass.
const casual = lookupSuburb('Bondi Beach');
assert(casual?.suburb === 'bondi beach', `casual input "Bondi Beach" still matches (got ${casual?.suburb})`);

// Empty / null inputs.
assert(lookupSuburb('') === null, 'empty string returns null');
assert(lookupSuburb(null) === null, 'null returns null');
assert(lookupSuburb(undefined) === null, 'undefined returns null');

// Unknown suburb returns null.
assert(lookupSuburb('Nowhereville XYZ 9999') === null, 'unknown suburb returns null');

console.log(`\nSUBURB-LOOKUP TESTS: ${passed} passed, ${failed} failed (${passed + failed} total)`);
if (failed > 0) {
  for (const f of failures) console.log('  x', f);
  (globalThis as { process?: { exit: (n: number) => never } }).process?.exit(1);
}
