import { firecrawlScrapeUrl, compactScrapedMarkdown, type StoredFirecrawlSettings } from './firecrawl';
import { sameVillage } from './competitorScope';

/**
 * Direct scrape of the per-suburb retirement-living pages for RV competitor
 * research:
 *   - villages.com.au and downsizing.com.au directories — CURRENT listings;
 *   - realestate.com.au's sold retirement-living list, newest first — SOLD
 *     records (the two directories carry no sales at all);
 *   - villages.com.au village pages for any village whose directory entry is
 *     cut at five vacancies ("See all vacancies") — every vacancy, plus its
 *     monthly levy.
 *
 * villages.com.au and downsizing.com.au both publish one listing page per suburb
 * at a predictable URL. Searching for those pages (`site:` queries) only works
 * when the search engine happens to rank the right page, and only when a suburb
 * AND state were known when the query was built, so in practice most requests
 * never reached them. Fetching the known URLs directly costs one Firecrawl
 * credit per page and always lands on the listings.
 *
 * Best-effort: a page that fails, 404s (no villages in that suburb) or is empty
 * is just skipped.
 */

/** "Bateau Bay" → "bateau-bay", the slug both sites use. */
export function suburbSlug(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-+|-+$)/g, '');
}

export interface DirectoryTarget {
  site: 'villages.com.au' | 'downsizing.com.au' | 'realestate.com.au sold' | 'villages.com.au village';
  suburb: string;
  url: string;
}

export interface SuburbRef {
  suburb: string;
  postcode?: string | undefined;
}

/** REA sold pages cost ~5 Firecrawl credits each (the site needs the stealth
 *  proxy), so only the nearest few suburbs get one. */
export const MAX_SOLD_PAGES = 3;

/** realestate.com.au sold retirement-living list for a suburb, newest sale first. */
export function reaSoldUrl(state: string, s: SuburbRef): string {
  const place = s.suburb.trim().toLowerCase().replace(/[^a-z0-9]+/g, '+').replace(/(^\++|\++$)/g, '');
  const loc = `${place},+${state.toLowerCase()}${s.postcode ? `+${s.postcode}` : ''}`;
  return `https://www.realestate.com.au/sold/property-retire-in-${loc}/list-1?activeSort=solddate`;
}

/** The pages to scrape for each suburb (nearest first). Empty without a state. */
export function directoryTargets(state: string | undefined, suburbs: Array<string | SuburbRef>): DirectoryTarget[] {
  const st = (state || '').trim().toLowerCase();
  if (!st) return [];
  const out: DirectoryTarget[] = [];
  const seen = new Set<string>();
  let soldPages = 0;
  for (const entry of suburbs) {
    const ref: SuburbRef = typeof entry === 'string' ? { suburb: entry } : entry;
    const slug = suburbSlug(ref.suburb);
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    const suburb = ref.suburb;
    out.push({ site: 'villages.com.au', suburb, url: `https://www.villages.com.au/retirement-villages/${st}/${slug}` });
    out.push({ site: 'downsizing.com.au', suburb, url: `https://www.downsizing.com.au/property/sale/${st}/suburb-${slug}` });
    if (soldPages < MAX_SOLD_PAGES) {
      soldPages++;
      out.push({ site: 'realestate.com.au sold', suburb, url: reaSoldUrl(st, ref) });
    }
  }
  return out;
}

/** Most village pages followed up per request (one credit each). */
export const MAX_VILLAGE_PAGES = 6;

/**
 * Villages whose villages.com.au directory entry was cut short. The directory
 * shows at most five vacancies per village and then a "See all vacancies" link
 * to the village page, which lists them all. Read from the RAW markdown —
 * compaction strips repeat links.
 */
export function truncatedVillagePages(rawDirectoryMarkdown: string): string[] {
  const re = /\[See all vacancies\]\((https:\/\/www\.villages\.com\.au\/[^)#\s]+)#vacancies-list\)/gi;
  const urls = new Set<string>();
  for (const m of rawDirectoryMarkdown.matchAll(re)) if (m[1]) urls.add(m[1]);
  return [...urls];
}

/** "…/wood-glen-retirement-village-4337" → "Wood Glen Retirement Village". */
function villageNameFromUrl(url: string): string {
  const slug = url.split('/').pop() ?? '';
  return slug.replace(/-\d+$/, '').split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/** Characters of each compacted directory page that reach the prompt. A
 *  compacted page with a dozen listings is ~10 KB; this leaves headroom for
 *  larger suburbs without letting one page crowd out the rest. */
export const DIRECTORY_PAGE_BUDGET = 20000;

export interface DirectoryPagesContext {
  promptBlock: string;
  sources: Array<{ title: string; url: string }>;
  pageCount: number;
}

export async function fetchDirectoryPages(
  firecrawl: Pick<StoredFirecrawlSettings, 'apiKey' | 'apiBaseUrl'> | null,
  targets: DirectoryTarget[],
  /** The subject village — its own village page is never followed up. */
  subjectVillageName?: string,
): Promise<DirectoryPagesContext | null> {
  if (!firecrawl || targets.length === 0) return null;
  const scrape = async (t: DirectoryTarget) => {
    // realestate.com.au needs Firecrawl's slower stealth proxy.
    const timeoutMs = t.site === 'realestate.com.au sold' ? 30000 : 15000;
    const md = await firecrawlScrapeUrl(firecrawl, t.url, timeoutMs).catch(() => null);
    return md ? { ...t, raw: md, text: compactScrapedMarkdown(md, t.url).slice(0, DIRECTORY_PAGE_BUDGET) } : null;
  };
  const first = await Promise.all(targets.map(scrape));

  // Second round: village pages for directory entries cut at five vacancies.
  const villageUrls = [...new Set(
    first.filter(p => p?.site === 'villages.com.au').flatMap(p => truncatedVillagePages(p!.raw)),
  )]
    .filter(url => !subjectVillageName || !sameVillage(villageNameFromUrl(url), subjectVillageName))
    .slice(0, MAX_VILLAGE_PAGES);
  const second = await Promise.all(villageUrls.map(url =>
    scrape({ site: 'villages.com.au village', suburb: villageNameFromUrl(url), url })));

  const usable = [...first, ...second]
    .filter((p): p is DirectoryTarget & { raw: string; text: string } => Boolean(p && p.text.trim()));
  if (usable.length === 0) return null;
  return {
    promptBlock:
      `=== RETIREMENT-LIVING PAGES (scraped live, full listing content) ===\n` +
      `villages.com.au / downsizing.com.au pages are CURRENT listings; a "villages.com.au village" page lists ` +
      `every vacancy of one village (with its monthly levy); "realestate.com.au sold" pages are SOLD records, ` +
      `newest first, each with a "Sold on" date. Enumerate EVERY village and EVERY unit/price shown, citing the ` +
      `listing's own URL where one is given (else the page URL). The same unit often appears on more than one ` +
      `site — list it once.\n\n` +
      usable.map(p => `--- ${p.site} — ${p.suburb} (${p.url}) ---\n${p.text}`).join('\n\n') +
      `\n=== END DIRECTORY PAGES ===`,
    sources: usable.map(p => ({
      title: p.site === 'villages.com.au village' ? `villages.com.au — ${p.suburb} vacancies` : `${p.site} — retirement living in ${p.suburb}`,
      url: p.url,
    })),
    pageCount: usable.length,
  };
}
