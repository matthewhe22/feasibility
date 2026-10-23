/**
 * Tests for reading realestate.com.au suburb-profile figures.
 *
 * Run with:  npx tsx api/__tests__/reaSuburbProfile.test.ts
 *
 * RV suburb research reported Grovedale's MHP as $747,250 — the "market
 * insights" median from REA's for-sale search pages — instead of the suburb
 * profile's $746,000. The profile page is now the only MHP/MUP source, read by
 * these fixed patterns. Fixtures follow the real scraped page layout.
 *
 * Lives under `__tests__` so Vercel's function detection skips it.
 */
import { parseReaProfile, reaProfileUrl, isProfileUrlFor } from '../_lib/reaSuburbProfile';

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

// Shape of the scraped https://www.realestate.com.au/vic/grovedale-3216/ page.
const grovedale = [
  '# Grovedale', '', 'Barwon, VIC 3216', '', '## House price guide', '', '- Buy', '- Rent', '', 'Bedrooms', '',
  '### Median price snapshot for houses', '', 'Median price', '', '$746,000', 'September 2025 - September 2026', '',
  'Past 12 month growth', '', 'Up 9.7%', '',
  '## 5 year median price trend', '', "OCT '21OCT '22OCT '23OCT '24OCT '25$600k$700k$800k", '',
  '### Median price snapshot for 2 bed houses', '', 'Median price', '', '$610,000', 'September 2025 - September 2026', '',
  'Past 12 month growth', '', 'Down -3.2%', '',
  '### Median price snapshot for 3 bed houses', '', 'Median price', '', '$730,000', '',
  '## Unit and apartment price guide', '',
  '### Median price snapshot for units', '', 'Median price', '', '$545,700', 'September 2025 - September 2026', '',
  'Past 12 month growth', '', 'Up 7.0%', '',
  '## 5 year median price trend', '',
  '### Median price snapshot for 1 bed units', '', 'Median price', '', '–', '', 'Past 12 month growth', '', '–',
].join('\n');

console.log('\nPARSE SUBURB PROFILE');
const g = parseReaProfile(grovedale, 'https://www.realestate.com.au/vic/grovedale-3216/');
eq('house median is the profile figure ($746,000, not $747,250)', g?.medianHousePrice, 746000);
eq('house period', g?.housePeriod, 'September 2025 - September 2026');
eq('house 12-month growth', g?.houseGrowth12mPct, 9.7);
eq('unit median', g?.medianUnitPrice, 545700);
eq('unit growth', g?.unitGrowth12mPct, 7);
eq('bedroom-specific snapshots are not mistaken for the suburb median', g?.medianHousePrice !== 610000, true);

const falling = parseReaProfile(
  '### Median price snapshot for houses\n\nMedian price\n\n$1,210,000\nSeptember 2025 - September 2026\n\nPast 12 month growth\n\nDown -8.7%\n\n## next',
  'u',
);
eq('negative growth ("Down -8.7%")', falling?.houseGrowth12mPct, -8.7);
eq('no units block → null unit median', falling?.medianUnitPrice, null);
eq('"Down 2.5%" without a minus sign is still negative', parseReaProfile(
  '### Median price snapshot for houses\nMedian price\n$500,000\nPast 12 month growth\nDown 2.5%', 'u')?.houseGrowth12mPct, -2.5);

const noHouses = parseReaProfile('### Median price snapshot for houses\n\nMedian price\n\n–\n\nPast 12 month growth\n\n–\n', 'u');
eq('no published figures → null (caller keeps the model figure)', noHouses, null);
eq('a for-sale page (market insights only) is not a profile', parseReaProfile(
  '## Market insights\nThe median house price in Grovedale is **$747,250** based on 260 sales', 'u'), null);

console.log('\nURLS');
eq('profile URL', reaProfileUrl('VIC', 'Grovedale', '3216'), 'https://www.realestate.com.au/vic/grovedale-3216/');
eq('multi-word suburb', reaProfileUrl('nsw', 'Bateau Bay', '2261'), 'https://www.realestate.com.au/nsw/bateau-bay-2261/');
eq('recognises a profile URL', isProfileUrlFor('https://www.realestate.com.au/vic/grovedale-3216/', 'VIC', 'Grovedale'), true);
eq('rejects a for-sale page', isProfileUrlFor('https://www.realestate.com.au/buy/in-grovedale,+vic+3216/list-1', 'VIC', 'Grovedale'), false);
eq('rejects another suburb', isProfileUrlFor('https://www.realestate.com.au/vic/marshall-3216/', 'VIC', 'Grovedale'), false);

console.log('\n' + '═'.repeat(60));
console.log(`REA SUBURB PROFILE TESTS: ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log('═'.repeat(60));
if (failed > 0) process.exit(1);
