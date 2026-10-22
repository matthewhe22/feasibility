import { firecrawlScrapeUrl, compactScrapedMarkdown, type StoredFirecrawlSettings } from './firecrawl';

/**
 * Direct scrape of the retirement-living aggregators' per-suburb directory pages
 * for RV competitor research.
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
  site: 'villages.com.au' | 'downsizing.com.au';
  suburb: string;
  url: string;
}

/** The directory URLs for each suburb, villages.com.au first. Empty without a state. */
export function directoryTargets(state: string | undefined, suburbs: string[]): DirectoryTarget[] {
  const st = (state || '').trim().toLowerCase();
  if (!st) return [];
  const out: DirectoryTarget[] = [];
  const seen = new Set<string>();
  for (const suburb of suburbs) {
    const slug = suburbSlug(suburb);
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    out.push({ site: 'villages.com.au', suburb, url: `https://www.villages.com.au/retirement-villages/${st}/${slug}` });
    out.push({ site: 'downsizing.com.au', suburb, url: `https://www.downsizing.com.au/property/sale/${st}/suburb-${slug}` });
  }
  return out;
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
): Promise<DirectoryPagesContext | null> {
  if (!firecrawl || targets.length === 0) return null;
  const pages = await Promise.all(
    targets.map(async t => {
      const md = await firecrawlScrapeUrl(firecrawl, t.url).catch(() => null);
      return md ? { ...t, text: compactScrapedMarkdown(md, t.url).slice(0, DIRECTORY_PAGE_BUDGET) } : null;
    }),
  );
  const usable = pages.filter((p): p is DirectoryTarget & { text: string } => Boolean(p && p.text.trim()));
  if (usable.length === 0) return null;
  return {
    promptBlock:
      `=== AGGREGATOR DIRECTORY PAGES (scraped live, full listing content) ===\n` +
      `Every listing on these pages is current evidence — enumerate EVERY village and EVERY unit/price shown, ` +
      `citing the listing's own URL where one is given (else the page URL).\n\n` +
      usable.map(p => `--- ${p.site} — ${p.suburb} (${p.url}) ---\n${p.text}`).join('\n\n') +
      `\n=== END DIRECTORY PAGES ===`,
    sources: usable.map(p => ({ title: `${p.site} — retirement living in ${p.suburb}`, url: p.url })),
    pageCount: usable.length,
  };
}
