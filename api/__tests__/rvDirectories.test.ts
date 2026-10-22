/**
 * Tests for the scraped-page compaction and the aggregator directory URLs used
 * by RV competitor research.
 *
 * Run with:  npx tsx api/__tests__/rvDirectories.test.ts
 *
 * villages.com.au / downsizing.com.au listings never reached the model: both
 * pages were scraped, but the per-page character cut landed inside price-filter
 * dropdowns (villages.com.au) or image carousels (downsizing.com.au), before the
 * first listing. The fixtures below reproduce those page shapes.
 *
 * Lives under `__tests__` so Vercel's function detection skips it.
 */
import { compactScrapedMarkdown } from '../_lib/firecrawl';
import { directoryTargets, suburbSlug, reaSoldUrl, truncatedVillagePages, MAX_SOLD_PAGES } from '../_lib/rvDirectories';

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
function check(name: string, cond: boolean) {
  eq(name, cond, true);
}

const PRICES = ['$200,000', '$250,000', '$300,000', '$350,000', '$400,000', '$450,000', '$2,000,000+'];

// villages.com.au: dropdown boilerplate, then village tables.
const VILLAGES_PAGE = 'https://www.villages.com.au/retirement-villages/nsw/bateau-bay';
const villagesMd = [
  '- Min. Price', '', 'Any price', '',
  `Any priceLess than $200,000${PRICES.join('')}`,
  '', '  - Any price', '  - Less than $200,000', ...PRICES.map(p => `  - ${p}`),
  '', 'Max. Price', ...PRICES.map(p => `- ${p}`),
  '',
  '### [Elderslee Retirement Community, Bateau Bay](https://www.villages.com.au/nsw/cc/elderslee-4002)',
  `[Shortlist](${VILLAGES_PAGE}#) [View Property](https://www.villages.com.au/nsw/cc/elderslee-4002)`,
  '| $400,000 | [Retirement](https://www.villages.com.au/nsw/cc/elderslee-4002#ee52) | 1 | 1 | 0 | [View](https://www.villages.com.au/nsw/cc/elderslee-4002#ee52) |',
  '| $463,000 | [Retirement](https://www.villages.com.au/nsw/cc/elderslee-4002#6180) | 2 | 1 | 0 | [View](https://www.villages.com.au/nsw/cc/elderslee-4002#6180) |',
].join('\n');

console.log('\nCOMPACT — villages.com.au');
const v = compactScrapedMarkdown(villagesMd, VILLAGES_PAGE);
check('price-dropdown option lines removed', !/^\s*-\s*\$200,000\s*$/m.test(v));
check('glued dropdown line removed', !v.includes('Any priceLess than'));
check('listing price rows kept', v.includes('| $400,000 |') && v.includes('| $463,000 |'));
check('first content is the village, not the dropdown', v.indexOf('Elderslee') < 60);
check('unit anchor URL kept once', v.split('elderslee-4002#ee52').length - 1 === 1);
check('in-page "Shortlist" link reduced to text', v.includes('Shortlist') && !v.includes(`${VILLAGES_PAGE}#)`));
check('listing table prices kept even though they look like options', v.includes('$400,000'));

// downsizing.com.au: image carousel (CDN URLs with nested parentheses) per listing.
const DS_PAGE = 'https://www.downsizing.com.au/property/sale/nsw/suburb-bateau-bay';
const listing = 'https://www.downsizing.com.au/property/sale/266803/over-55s-unit';
const img = (n: number) => `[![Over 55s unit](https://img.downsizing.com.au/x${n}=/fit-in/1920x1080/filters:format(jpeg):max_bytes(204800)/https://img.example/${n})](${listing})`;
const downsizingMd = [
  ...Array.from({ length: 10 }, (_, n) => img(n)), '',
  `[Previous](${DS_PAGE}#ctl) [Next](${DS_PAGE}#ctl)`, '',
  `#### [Over 55s unit](${listing})`, '', `#### [61/15 Bias Ave, Bateau Bay 2261](${listing})`, '',
  '#### $400,000', '',
  '![bed](https://www.downsizing.com.au/images/icons/bed@3x.png)1', '',
  '![bathtub](https://www.downsizing.com.au/images/icons/bathtub@3x.png)1', '',
  `[Share](${DS_PAGE}#propertyActionModal "property-action-modal")Save`,
].join('\n');

console.log('\nCOMPACT — downsizing.com.au');
const d = compactScrapedMarkdown(downsizingMd, DS_PAGE);
check('carousel images (nested-paren URLs) removed', !d.includes('img.downsizing.com.au') && !d.includes('max_bytes'));
check('much smaller than the raw page', d.length < downsizingMd.length / 3);
check('price kept', d.includes('#### $400,000'));
check('address kept', d.includes('61/15 Bias Ave'));
check('icon labels kept beside their numbers', d.includes('bed1') && d.includes('bathtub1'));
check('listing URL kept (first occurrence)', d.includes(`](${listing})`));
eq('listing URL not repeated', d.split(listing).length - 1, 1);
check('in-page link with title reduced to text', d.includes('ShareSave') && !d.includes('propertyActionModal'));

console.log('\nCOMPACT — safety');
eq('plain text untouched', compactScrapedMarkdown('Median price $1,220,000 as of Sep 2026'), 'Median price $1,220,000 as of Sep 2026');
eq('collapses blank runs', compactScrapedMarkdown('a\n\n\n\n\nb'), 'a\n\nb');

console.log('\nDIRECTORY TARGETS');
eq('slug', suburbSlug(' Bateau Bay '), 'bateau-bay');
eq('slug strips punctuation', suburbSlug("O'Connor"), 'o-connor');
const t = directoryTargets('NSW', [{ suburb: 'Bateau Bay', postcode: '2261' }, 'Killarney Vale', 'bateau bay']);
eq('three pages per suburb, duplicates dropped', t.length, 6);
eq('villages.com.au URL', t[0]?.url, 'https://www.villages.com.au/retirement-villages/nsw/bateau-bay');
eq('downsizing.com.au URL', t[1]?.url, 'https://www.downsizing.com.au/property/sale/nsw/suburb-bateau-bay');
eq('REA sold URL, newest first', t[2]?.url, 'https://www.realestate.com.au/sold/property-retire-in-bateau+bay,+nsw+2261/list-1?activeSort=solddate');
eq('second suburb', t[3]?.url, 'https://www.villages.com.au/retirement-villages/nsw/killarney-vale');
eq('REA sold URL without postcode', reaSoldUrl('nsw', { suburb: 'Killarney Vale' }), 'https://www.realestate.com.au/sold/property-retire-in-killarney+vale,+nsw/list-1?activeSort=solddate');
const many = directoryTargets('NSW', ['A1', 'B2', 'C3', 'D4', 'E5']);
eq('REA sold pages capped (they cost ~5 credits)', many.filter(x => x.site === 'realestate.com.au sold').length, MAX_SOLD_PAGES);

console.log('\nTRUNCATED VILLAGE ENTRIES');
const dir = [
  '[5 Available](https://www.villages.com.au/nsw/cc/wood-glen-retirement-village-4337#vacancies-list)',
  '[See all vacancies](https://www.villages.com.au/nsw/cc/wood-glen-retirement-village-4337#vacancies-list)',
  '[See all vacancies](https://www.villages.com.au/nsw/cc/glengara-retirement-village-4345#vacancies-list)',
  '[1 Available](https://www.villages.com.au/nsw/cc/kiah-lodge-3998#vacancies-list)',
].join('\n');
eq('only villages cut at five are followed up', truncatedVillagePages(dir), [
  'https://www.villages.com.au/nsw/cc/wood-glen-retirement-village-4337',
  'https://www.villages.com.au/nsw/cc/glengara-retirement-village-4345',
]);
eq('no state → no targets', directoryTargets(undefined, ['Bateau Bay']).length, 0);

console.log('\n' + '═'.repeat(60));
console.log(`RV DIRECTORY TESTS: ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log('═'.repeat(60));
if (failed > 0) process.exit(1);
