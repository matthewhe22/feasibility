/**
 * Second-pass enrichment for competitor units: read the missing internal area
 * and date off each unit's OWN listing page.
 *
 * Why this exists. The search pass only ever surfaces pages a query ranks for,
 * which for retirement villages is the aggregator's per-suburb DIRECTORY page
 * (villages.com.au/retirement-villages/{state}/{suburb}). That page carries a
 * village's headline price, beds and baths — but not a unit's internal area,
 * and often not its listing date either. Those live on the individual unit's
 * listing page, which nothing was ever fetching. No amount of prompt pressure
 * could extract a figure that was never in the model's context; the page had to
 * actually be fetched.
 *
 * So: once the first pass has produced units with `sourceUrl`s, scrape those
 * specific pages and run one focused extraction over them.
 *
 * Bounded and best-effort throughout — a capped number of scrapes, one extra
 * model call, and any failure leaves the unit exactly as it was.
 */
import { firecrawlScrapeUrl, type StoredFirecrawlSettings } from './firecrawl';
import { runAIResearch } from './aiClient';
import type { AIProvider } from './aiSettings';
import { toNumber } from './normalizeUnits';

/** Max listing pages fetched per request — each is one Firecrawl scrape. */
const MAX_ENRICH = 10;
/** How much of each scraped page to hand the model. */
const PAGE_BUDGET = 6000;

interface EnrichableUnit {
  villageName?: unknown;
  unitNumber?: unknown;
  sourceUrl?: unknown;
  internalSqm?: unknown;
  landSqm?: unknown;
  date?: unknown;
  note?: unknown;
  [key: string]: unknown;
}

const SYSTEM_EXTRACT = `You extract two specific facts from Australian property listing pages:
the unit's INTERNAL AREA in square metres, and the record's published DATE.

For each numbered page you are given, return an entry with:
  - "index": the page number as given.
  - "internalSqm": the internal / living / floor area in m², as a NUMBER ONLY
    (no units, no "approx"). Labels vary: "internal area", "living area",
    "floor area", "approx. area", "m²", "sqm", "square metres". It may sit in a
    specifications table, a floor-plan caption, or plain body text. If the page
    only gives a land/site/block area, that is NOT internal area — put it in
    "landSqm" instead and leave internalSqm null.
  - "landSqm": land / site area in m² as a number, or null.
  - "date": the record's real published date (sold date, or listing / "first
    listed" / "on market since" date) as ISO yyyy-mm-dd, or yyyy-mm if only the
    month is given. NEVER substitute today's date or invent one — null if the
    page does not publish a date.

Return ONLY valid JSON: { "units": [ { "index": <n>, "internalSqm": <number|null>,
"landSqm": <number|null>, "date": "<iso|null>" } ] }
Use null for anything the page does not state. Never guess a number.`;

/**
 * Fill in missing internalSqm / date on units by scraping their own listing
 * pages. Returns the units array (same order, same length) with those fields
 * filled where the page supplied them; everything else is untouched.
 */
export async function enrichUnitsFromListingPages(
  units: unknown,
  firecrawl: Pick<StoredFirecrawlSettings, 'apiKey' | 'apiBaseUrl'> | null,
  provider: { provider: AIProvider; model: string; apiKey: string } | undefined,
): Promise<unknown> {
  if (!Array.isArray(units) || !firecrawl || !provider) return units;

  const rows = units as EnrichableUnit[];

  // Only units that are actually missing something AND have a page to read.
  const targets: Array<{ rowIndex: number; url: string }> = [];
  for (let i = 0; i < rows.length; i++) {
    const u = rows[i];
    if (!u || typeof u !== 'object') continue;
    const needsArea = toNumber(u.internalSqm) === null;
    const needsDate = !u.date;
    const url = typeof u.sourceUrl === 'string' ? u.sourceUrl : '';
    // A bare domain is the aggregator's home page, not a unit's listing page.
    const isSpecificPage = /^https?:\/\/[^/]+\/.+/.test(url);
    if ((needsArea || needsDate) && isSpecificPage) targets.push({ rowIndex: i, url });
    if (targets.length >= MAX_ENRICH) break;
  }
  if (targets.length === 0) return units;

  const scraped = await Promise.all(
    targets.map(async t => ({ ...t, markdown: await firecrawlScrapeUrl(firecrawl, t.url) })),
  );
  const usable = scraped.filter((s): s is typeof s & { markdown: string } => typeof s.markdown === 'string');
  if (usable.length === 0) return units;

  const prompt = usable
    .map((s, n) => `--- PAGE ${n + 1} (${s.url}) ---\n${s.markdown.slice(0, PAGE_BUDGET)}`)
    .join('\n\n');

  let extracted: Array<Record<string, unknown>>;
  try {
    const result = await runAIResearch({
      provider: provider.provider,
      model: provider.model,
      apiKey: provider.apiKey,
      systemPrompt: SYSTEM_EXTRACT,
      userPrompt: `Extract internal area and date from each page below.\n\n${prompt}`,
      useGrounding: false, // the pages are already supplied; no search needed
    });
    extracted = Array.isArray(result.json.units) ? (result.json.units as Array<Record<string, unknown>>) : [];
  } catch {
    return units; // enrichment must never break the research response
  }

  const out = rows.map(r => ({ ...r }));
  for (const entry of extracted) {
    const idx = toNumber(entry.index);
    if (idx === null) continue;
    const target = usable[idx - 1]; // model is given 1-based page numbers
    if (!target) continue;
    const row = out[target.rowIndex];
    if (!row) continue;

    const area = toNumber(entry.internalSqm);
    if (area !== null && toNumber(row.internalSqm) === null) row.internalSqm = area;

    const land = toNumber(entry.landSqm);
    if (land !== null && toNumber(row.landSqm) === null) row.landSqm = land;

    if (!row.date && typeof entry.date === 'string' && entry.date.trim() && entry.date !== 'null') {
      row.date = entry.date;
    }
  }
  return out;
}
