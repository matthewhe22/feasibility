import { firecrawlScrapeUrl, firecrawlSearch, type StoredFirecrawlSettings } from './firecrawl';
import { suburbSlug } from './rvDirectories';

/**
 * realestate.com.au SUBURB PROFILE figures — the canonical source for the RV
 * Research median house price (MHP) and median unit price (MUP).
 *
 * realestate.com.au publishes two different medians per suburb: the suburb
 * profile ("Median price snapshot", e.g. Grovedale $746,000 for "September
 * 2025 - September 2026") and a "Market insights" box on its for-sale search
 * pages (Grovedale $747,250 "based on 260 sales in the past 12 months"), which
 * is refreshed on a different cycle. A search for a suburb's median returns
 * mostly the for-sale pages, so leaving the choice to the model reported the
 * market-insights figure. Here the profile page is fetched by URL and its
 * figures are read with fixed patterns — no model interpretation — and the
 * endpoint overrides the model's numbers with them.
 */

export interface ReaProfileFigures {
  url: string;
  medianHousePrice: number | null;
  /** e.g. "September 2025 - September 2026" */
  housePeriod: string | null;
  /** Percent, e.g. 9.7 for "Up 9.7%", -8.7 for "Down -8.7%". */
  houseGrowth12mPct: number | null;
  medianUnitPrice: number | null;
  unitPeriod: string | null;
  unitGrowth12mPct: number | null;
  /** "Property market insights": MEDIAN days on market over the past 12
   *  months (REA publishes a median, not an average) and the number sold. */
  houseDaysOnMarket: number | null;
  houseSold12m: number | null;
  unitDaysOnMarket: number | null;
  unitSold12m: number | null;
}

/** https://www.realestate.com.au/vic/grovedale-3216/ */
export function reaProfileUrl(state: string, suburb: string, postcode: string): string {
  return `https://www.realestate.com.au/${state.trim().toLowerCase()}/${suburbSlug(suburb)}-${postcode.trim()}/`;
}

/** The text of one "Median price snapshot for {kind}" block, up to the next heading. */
function snapshotBlock(markdown: string, kind: 'houses' | 'units'): string | null {
  const re = new RegExp(`^#+\\s*Median price snapshot for ${kind}\\s*$`, 'mi');
  const m = re.exec(markdown);
  if (!m) return null;
  const rest = markdown.slice(m.index + m[0].length);
  const next = rest.search(/^#+\s/m);
  return next >= 0 ? rest.slice(0, next) : rest;
}

function readBlock(block: string | null): { price: number | null; period: string | null; growth: number | null } {
  if (!block) return { price: null, period: null, growth: null };
  // The median sits under "Median price" before "Past 12 month growth"; "–" means none.
  const head = block.split(/Past 12 month growth/i)[0] ?? '';
  const priceMatch = /\$\s*([\d,]+)/.exec(head);
  const price = priceMatch ? Number(priceMatch[1]!.replace(/,/g, '')) : null;
  const periodMatch = /([A-Z][a-z]+ \d{4})\s*[-–]\s*([A-Z][a-z]+ \d{4})/.exec(head);
  const growthMatch = /Past 12 month growth\s*(Up|Down)?\s*([-+]?\d+(?:\.\d+)?)\s*%/i.exec(block);
  let growth: number | null = null;
  if (growthMatch) {
    const n = Math.abs(Number(growthMatch[2]));
    const down = /down/i.test(growthMatch[1] ?? '') || growthMatch[2]!.startsWith('-');
    growth = down ? -n : n;
  }
  return {
    price: price !== null && Number.isFinite(price) && price > 0 ? price : null,
    period: periodMatch ? `${periodMatch[1]} - ${periodMatch[2]}` : null,
    growth,
  };
}

/** The "Property market insights for {kind}" block, up to the next heading. */
function insightsBlock(markdown: string, kind: 'houses' | 'units'): string | null {
  const re = new RegExp(`^#+\\s*Property market insights for ${kind}\\s*$`, 'mi');
  const m = re.exec(markdown);
  if (!m) return null;
  const rest = markdown.slice(m.index + m[0].length);
  const next = rest.search(/^#+\s/m);
  return next >= 0 ? rest.slice(0, next) : rest;
}

/** "23 days median days on market" / "266 sold in the past 12 months"; "–" means none. */
function readInsights(block: string | null): { dom: number | null; sold: number | null } {
  if (!block) return { dom: null, sold: null };
  const dom = /(\d[\d,]*)\s*days?\s+median days on market/i.exec(block);
  const sold = /(\d[\d,]*)\s+sold(?:\s+sold)?\s+in the past 12 months/i.exec(block);
  return {
    dom: dom ? Number(dom[1]!.replace(/,/g, '')) : null,
    sold: sold ? Number(sold[1]!.replace(/,/g, '')) : null,
  };
}

/** Read the house and unit snapshots off a scraped suburb-profile page. */
export function parseReaProfile(markdown: string, url: string): ReaProfileFigures | null {
  const house = readBlock(snapshotBlock(markdown, 'houses'));
  const unit = readBlock(snapshotBlock(markdown, 'units'));
  if (house.price === null && unit.price === null) return null;
  const houseIns = readInsights(insightsBlock(markdown, 'houses'));
  const unitIns = readInsights(insightsBlock(markdown, 'units'));
  return {
    url,
    medianHousePrice: house.price,
    housePeriod: house.period,
    houseGrowth12mPct: house.growth,
    medianUnitPrice: unit.price,
    unitPeriod: unit.period,
    unitGrowth12mPct: unit.growth,
    houseDaysOnMarket: houseIns.dom,
    houseSold12m: houseIns.sold,
    unitDaysOnMarket: unitIns.dom,
    unitSold12m: unitIns.sold,
  };
}

/** True when `url` is the suburb-profile page for this suburb (any postcode). */
export function isProfileUrlFor(url: string, state: string, suburb: string): boolean {
  const re = new RegExp(`^https://www\\.realestate\\.com\\.au/${state.toLowerCase()}/${suburbSlug(suburb)}-\\d{4}/?$`, 'i');
  return re.test(url.split('?')[0] ?? url);
}

/**
 * Fetch one suburb's profile figures. Tries the URL built from the postcode
 * first; if there is no postcode, or that page isn't a profile (a wrong
 * postcode 404s), one search finds the real profile URL. Best-effort: null on
 * any failure, and the caller keeps the model's figure for that suburb.
 */
export async function fetchReaProfile(
  firecrawl: StoredFirecrawlSettings,
  s: { suburb: string; state: string; postcode?: string | undefined },
): Promise<ReaProfileFigures | null> {
  const tryUrl = async (url: string) => {
    const md = await firecrawlScrapeUrl(firecrawl, url, 30000).catch(() => null);
    return md ? parseReaProfile(md, url) : null;
  };

  if (s.postcode && /^\d{4}$/.test(s.postcode.trim())) {
    const direct = await tryUrl(reaProfileUrl(s.state, s.suburb, s.postcode));
    if (direct) return direct;
  }
  try {
    const found = await firecrawlSearch(
      { ...firecrawl, scrapeContent: false, maxResults: 5 },
      `site:realestate.com.au ${s.suburb} ${s.state} suburb profile median price`,
    );
    const hit = found.results.find(r => isProfileUrlFor(r.url, s.state, s.suburb));
    return hit ? await tryUrl(hit.url.split('?')[0]!) : null;
  } catch {
    return null;
  }
}
