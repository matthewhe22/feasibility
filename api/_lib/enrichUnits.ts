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
 * Several units often share ONE page — every villages.com.au vacancy links to
 * its village's page with a `#vacancy-id` anchor. Each page is therefore
 * scraped once, and the model is told which units on it to fill (unit number,
 * price, bedrooms) so a figure is never copied onto the wrong unit. Pages are
 * compacted first: a villages.com.au village page opens with ~6 KB of
 * price-filter boilerplate, which used to fill the whole budget before the
 * first vacancy. The monthly levy, which village pages do publish, is read too.
 *
 * Bounded and best-effort throughout — a capped number of scrapes, one extra
 * model call, and any failure leaves the unit exactly as it was.
 */
import { firecrawlScrapeUrl, compactScrapedMarkdown, type StoredFirecrawlSettings } from './firecrawl';
import { runAIResearch } from './aiClient';
import type { AIProvider } from './aiSettings';
import { toNumber, toMoney } from './normalizeUnits';

/** Max distinct pages fetched per request — each is one Firecrawl scrape. */
const MAX_PAGES = 10;
/** How much of each compacted page to hand the model. */
const PAGE_BUDGET = 15000;

interface EnrichableUnit {
  villageName?: unknown;
  unitNumber?: unknown;
  sourceUrl?: unknown;
  internalSqm?: unknown;
  landSqm?: unknown;
  date?: unknown;
  price?: unknown;
  bedrooms?: unknown;
  recurringFee?: unknown;
  recurringFeePeriod?: unknown;
  note?: unknown;
  [key: string]: unknown;
}

const SYSTEM_EXTRACT = `You extract specific facts about named units from Australian property listing pages.

Each numbered page lists the units to fill from it, each with a reference such as
"1a" plus its unit number / price / bedrooms so you can find it on the page. A page
can describe several units — take each figure from the part of the page about THAT
unit, never from a neighbouring one. For each reference return:
  - "ref": the reference as given.
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
  - "recurringFee": the recurring levy / general services charge as a number
    (e.g. "Monthly Levy: $448.13" → 448.13), or null.
  - "recurringFeePeriod": "week" | "month" | "quarter" | "year", or null.

Return ONLY valid JSON: { "units": [ { "ref": "<ref>", "internalSqm": <number|null>,
"landSqm": <number|null>, "date": "<iso|null>", "recurringFee": <number|null>,
"recurringFeePeriod": "<period|null>" } ] }
Use null for anything the page does not state for that unit. Never guess a number.`;

/** The page a unit points at, without the in-page anchor. */
function pageOf(url: string): string {
  return url.split('#')[0] ?? url;
}

function describe(u: EnrichableUnit): string {
  const bits = [
    typeof u.unitNumber === 'string' && u.unitNumber ? `unit ${u.unitNumber}` : null,
    toMoney(u.price) !== null ? `$${toMoney(u.price)!.toLocaleString('en-AU')}` : null,
    toNumber(u.bedrooms) !== null ? `${toNumber(u.bedrooms)} bed` : null,
    typeof u.villageName === 'string' ? u.villageName : null,
  ].filter(Boolean);
  return bits.join(', ') || 'the unit on this page';
}

/**
 * Fill in missing internalSqm / date / levy on units by scraping their own
 * listing pages. Returns the units array (same order, same length) with those
 * fields filled where the page supplied them; everything else is untouched.
 */
export async function enrichUnitsFromListingPages(
  units: unknown,
  firecrawl: Pick<StoredFirecrawlSettings, 'apiKey' | 'apiBaseUrl'> | null,
  provider: { provider: AIProvider; model: string; apiKey: string } | undefined,
): Promise<unknown> {
  if (!Array.isArray(units) || !firecrawl || !provider) return units;

  const rows = units as EnrichableUnit[];

  // Group the units that are missing something by the page they point at.
  const pages = new Map<string, number[]>();
  for (let i = 0; i < rows.length; i++) {
    const u = rows[i];
    if (!u || typeof u !== 'object') continue;
    const needs = toNumber(u.internalSqm) === null || !u.date || toMoney(u.recurringFee) === null;
    const url = typeof u.sourceUrl === 'string' ? u.sourceUrl : '';
    // A bare domain is the aggregator's home page, not a unit's listing page.
    if (!needs || !/^https?:\/\/[^/]+\/.+/.test(url)) continue;
    const page = pageOf(url);
    if (!pages.has(page) && pages.size >= MAX_PAGES) continue;
    pages.set(page, [...(pages.get(page) ?? []), i]);
  }
  if (pages.size === 0) return units;

  const scraped = await Promise.all(
    [...pages].map(async ([url, rowIndexes]) => {
      const md = await firecrawlScrapeUrl(firecrawl, url);
      return { url, rowIndexes, text: md ? compactScrapedMarkdown(md, url).slice(0, PAGE_BUDGET) : null };
    }),
  );
  const usable = scraped.filter((s): s is typeof s & { text: string } => Boolean(s.text));
  if (usable.length === 0) return units;

  // ref ("2b") → row index
  const refs = new Map<string, number>();
  const prompt = usable.map((page, n) => {
    const list = page.rowIndexes.map((rowIndex, k) => {
      const ref = `${n + 1}${String.fromCharCode(97 + (k % 26))}${k >= 26 ? Math.floor(k / 26) : ''}`;
      refs.set(ref, rowIndex);
      return `  [${ref}] ${describe(rows[rowIndex]!)}`;
    }).join('\n');
    return `--- PAGE ${n + 1} (${page.url}) ---\nUnits to fill from this page:\n${list}\n\n${page.text}`;
  }).join('\n\n');

  let extracted: Array<Record<string, unknown>>;
  try {
    const result = await runAIResearch({
      provider: provider.provider,
      model: provider.model,
      apiKey: provider.apiKey,
      systemPrompt: SYSTEM_EXTRACT,
      userPrompt: `Extract the listed facts for each referenced unit.\n\n${prompt}`,
      useGrounding: false, // the pages are already supplied; no search needed
    });
    extracted = Array.isArray(result.json.units) ? (result.json.units as Array<Record<string, unknown>>) : [];
  } catch {
    return units; // enrichment must never break the research response
  }

  const out = rows.map(r => ({ ...r }));
  for (const entry of extracted) {
    const rowIndex = typeof entry.ref === 'string' ? refs.get(entry.ref.trim().toLowerCase()) : undefined;
    if (rowIndex === undefined) continue;
    const row = out[rowIndex];
    if (!row) continue;

    const area = toNumber(entry.internalSqm);
    if (area !== null && toNumber(row.internalSqm) === null) row.internalSqm = area;

    const land = toNumber(entry.landSqm);
    if (land !== null && toNumber(row.landSqm) === null) row.landSqm = land;

    if (!row.date && typeof entry.date === 'string' && entry.date.trim() && entry.date !== 'null') {
      row.date = entry.date;
    }

    const fee = toMoney(entry.recurringFee);
    if (fee !== null && toMoney(row.recurringFee) === null) {
      row.recurringFee = fee;
      if (typeof entry.recurringFeePeriod === 'string' && entry.recurringFeePeriod !== 'null') {
        row.recurringFeePeriod = entry.recurringFeePeriod;
      }
    }
  }
  return out;
}
