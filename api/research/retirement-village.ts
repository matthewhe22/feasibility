import type { VercelRequest, VercelResponse } from '@vercel/node';
import { setCors } from '../_lib/auth';
import { getAdminSupabase, isSupabaseConfigured } from '../_lib/supabase';
import { resolveProviderChain, quotaFailoverHint, isCapacityFailure } from '../_lib/aiSettings';
import { resolveCotalitySettings, fetchCotalityContext } from '../_lib/cotality';
import {
  resolveWebSearchConfig,
  createWebSearchRunner,
  webSearchCacheTag,
  buildWebSearchPromptBlock,
  webSearchNote,
  type WebSearchConfig,
  type WebSearchContext,
} from '../_lib/webSearch';
import { runAIResearch, mergeSources, AIResearchError, type AIResearchSource } from '../_lib/aiClient';
import { researchCacheKey, getCachedResearch, setCachedResearch } from '../_lib/researchCache';
import { geocodeAuSuburbs } from '../_lib/geocode';
import { buildSuburbMapImage } from '../_lib/staticMap';
import { normalizeUnitRows, normalizeSuburbRows } from '../_lib/normalizeUnits';
import { enrichUnitsFromListingPages } from '../_lib/enrichUnits';
import { scopeCompetitorUnits, soldCutoff } from '../_lib/competitorScope';
import { verifyCompetitorDistances } from '../_lib/competitorDistance';
import { fetchReaProfile, type ReaProfileFigures } from '../_lib/reaSuburbProfile';
import { directoryTargets, fetchDirectoryPages, suburbSlug, type DirectoryPagesContext } from '../_lib/rvDirectories';

/**
 * POST /api/research/retirement-village
 *
 * Retirement-village property research, combining the configured AI model
 * (with web-search grounding) and — when configured — real Cotality property
 * data.
 *
 * mode='suburbs'      → locate the village, find surrounding/related suburbs,
 *                       and return median house price (MHP), median unit price
 *                       (MUP) and median $/m² per suburb, plus the averages.
 * mode='competitors'  → find competing retirement villages within a proximity
 *                       radius and list their recently sold / listed units with
 *                       price, date, beds, baths, study where available.
 *
 * Body: { mode, villageName, state?, suburb?, postcode?, proximityKm? }
 */

interface RVRequest {
  mode: 'suburbs' | 'competitors';
  villageName: string;
  state?: string;
  suburb?: string;
  postcode?: string;
  proximityKm?: number;
  /**
   * Suburbs within the proximity radius, supplied by the client from a prior
   * "suburbs" mode result. Lets "competitors" mode search each one directly
   * (villages.com.au publishes a directory page per suburb) instead of relying
   * on one generic radius query to somehow surface every nearby suburb.
   */
  nearbySuburbs?: string[];
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function twelveMonthsAgoIsoDate(): string {
  return soldCutoff(new Date());
}

const SYSTEM_SUBURB_LOCATOR = `You are an Australian geography assistant. Given a retirement village, identify
its suburb, state and postcode, plus the surrounding/related suburbs within
roughly 5-8 km. This is a LOCATION lookup only — no pricing, no web search
needed; use your own geographic knowledge. Return ONLY valid JSON matching the
schema — no preamble.`;

function buildSuburbLocatorPrompt(req: RVRequest): string {
  const loc = [req.suburb, req.state, req.postcode].filter(Boolean).join(', ');
  return [
    `Identify the location of the retirement village: "${req.villageName}".`,
    loc ? `Known location context: ${loc}.` : `Location not provided — resolve it from the village name.`,
    `List the village's own suburb plus 4-7 surrounding/related suburbs (~5-8 km).`,
    `Return JSON only: { "village": {"name","suburb","state","postcode"},`,
    `"suburbs": [ {"suburb","state","postcode","distanceKm": <number|null>} ] }`,
  ].join('\n');
}

/**
 * Cheap pre-step for "suburbs" mode: resolve the confirmed suburb list BEFORE
 * building search queries, so each suburb gets its own targeted
 * site:realestate.com.au query instead of one generic query trying to cover
 * however many suburbs the model eventually decides to report on (previously
 * the mismatch here meant most returned suburbs had no source page at all —
 * only the ones a single shared query happened to surface got real figures).
 * Uses only the head provider (no failover) since this is a low-stakes,
 * ungrounded geography lookup — on any failure, falls back to just the
 * subject's own suburb so the caller degrades to the pre-existing behaviour
 * rather than blocking the request.
 */
async function resolveSuburbList(
  body: RVRequest,
  headProvider: { provider: import('../_lib/aiSettings').AIProvider; model: string; apiKey: string },
): Promise<Array<{ suburb: string; state?: string; postcode?: string; distanceKm?: number | null }>> {
  const fallback = body.suburb ? [{ suburb: body.suburb, state: body.state, postcode: body.postcode }] : [];
  try {
    const result = await runAIResearch({
      provider: headProvider.provider,
      model: headProvider.model,
      apiKey: headProvider.apiKey,
      systemPrompt: SYSTEM_SUBURB_LOCATOR,
      userPrompt: buildSuburbLocatorPrompt(body),
      useGrounding: false, // geography lookup — no search needed, keep it cheap
    });
    const rows = Array.isArray(result.json.suburbs) ? (result.json.suburbs as Array<Record<string, unknown>>) : [];
    const parsed = rows
      .map(r => ({
        suburb: typeof r.suburb === 'string' ? r.suburb : '',
        state: typeof r.state === 'string' ? r.state : body.state,
        postcode: typeof r.postcode === 'string' ? r.postcode : body.postcode,
        distanceKm: typeof r.distanceKm === 'number' ? r.distanceKm : null,
      }))
      .filter(r => r.suburb);
    return parsed.length ? parsed : fallback;
  } catch {
    return fallback;
  }
}

const SYSTEM_SUBURBS = `You are an Australian residential property research analyst.
Today's date is ${todayIsoDate()}. You have no other sense of "now" — use this date,
not your training cutoff, to judge how current any figure is.

Given a retirement village, you (1) identify its location (suburb, state, postcode),
(2) determine the surrounding / related suburbs (the village's own suburb plus
adjacent suburbs within roughly 5–8 km), and (3) report current median dwelling
prices for each.

You MUST:
  1. Use realestate.com.au (REA) suburb profile pages as the PRIMARY price source,
     and a supplied Cotality data block as the SECOND source — do not search or
     cite Domain, ABS, or any other portal. Every supplied live-search result
     below is already scoped to realestate.com.au. When a REALESTATE.COM.AU SUBURB
     PROFILE FIGURES block is supplied, its figures are THE answer for those
     suburbs — use them exactly. Never use the "market insights" median shown on
     realestate.com.au for-sale search pages; it is a different calculation.
  2. Where REA has no figure for a suburb (or for a field), use the Cotality
     block's figure if it has one and say so in that row's "historySource" /
     "summary"; otherwise return null rather than substituting another source.
  3. For each suburb return: median HOUSE price, median UNIT/apartment price, and
     median $/m² of living area where available (else null). Quote the figure
     EXACTLY as published by the single source you cite for it — never average
     or blend numbers from two different portals into a new figure that matches
     neither. If the supplied results disagree by more than a few percent, pick
     the one from the most authoritative/most recent source and say which portal
     it came from in "summary"; don't split the difference.
  4. Also report the median HOUSE price as it stood 12 MONTHS AGO and 6 MONTHS AGO
     (relative to the current figure's period), and the growth % over each.
       - 12 months: REA suburb profiles publish "Past 12 month growth" beside the
         median (e.g. "Up 7.1%") — return it in houseGrowth12mPct. REA does not
         print the prior median; leave medianHousePrice12mAgo null unless a
         source states it (the server derives it from the growth figure).
       - 6 months: REA publishes NO 6-month figure (its trend is a chart). Take
         the 6-month-ago median / change from the Cotality block if it has one;
         otherwise leave both 6-month fields null. Never estimate either.
       - Set "historySource" per suburb to where these came from, e.g.
         "realestate.com.au 12-month growth; Cotality 6-month".
  5. Set "asOf" to the actual period the figure is reported for (e.g. rolling
     12-month window ending in a stated month, or a stated quarter) — read it off
     the source, never guess or default to a plausible-sounding recent quarter.
  6. If the most recent figure you can substantiate is more than 2 quarters old
     relative to today (${todayIsoDate()}), still report it but say so plainly in
     "summary" (e.g. "data is N months old; no more recent figure was found").
  7. Compute the simple average of the per-suburb medians (ignoring nulls).
  8. State all prices in AUD. If a figure is unavailable, use null — never invent.
  9. Return ONLY valid JSON matching the requested schema — no preamble.
If Cotality and REA disagree on a current median, report REA's and mention the
Cotality figure in "summary".`;

const SYSTEM_COMPETITORS = `You are an Australian retirement-living market analyst.
Today's date is ${todayIsoDate()}. Use this date, not your training cutoff, to judge
how current a listing or sale is, and to sort/label results accurately.
Given a retirement village and a proximity radius, you identify COMPETING
retirement villages within that radius and list their unit sale / listing evidence.

villages.com.au publishes ONE directory page per suburb, of the form
https://www.villages.com.au/retirement-villages/{state}/{suburb-slug} (e.g.
https://www.villages.com.au/retirement-villages/nsw/bateau-bay), listing every
village in that suburb with unit availability and pricing. When live search
results below include one of these pages, treat it as a primary source and pull
every unit/listing it shows — don't stop at a search-snippet summary of it.

Trusted sources you should search DIRECTLY and prefer (in roughly this order):
  Third-party retirement-living aggregators / listing portals
   - villages.com.au (DCM Media retirement village directory + listings) —
     check the SUBJECT village's own suburb page AND every suburb within the
     proximity radius, not just one
   - downsizing.com.au (retirement & over-50s listings)
   - seniorshousingonline.com.au
   - agedcareguide.com.au / agedcareonline.com.au (village directories)
   - oversixtyfive / retirement living directories
  General real-estate portals (filter to retirement / over-55s / lifestyle)
   - realestate.com.au (incl. sold-price history)
   - domain.com.au
   - property.com.au (Cotality consumer) / onthehouse.com.au
  Operator / village websites (current "for sale" pages)
   - Keyton (ex-Lendlease Retirement), Aveo, Stockland, Australian Unity,
     Levande, RetireAustralia, IRT, Ryman Healthcare, Anglicare, Bolton Clarke,
     and other local operators
  Data providers
   - CoreLogic / Cotality where available

You MUST:
  1. Use your web search capability to find CURRENT data, searching the third-party
     sites above by name (especially villages.com.au and downsizing.com.au) — these
     aggregators are often the best source for retirement-unit listing prices.
     SALES: include every sale dated within the past 12 months from today
     (${todayIsoDate()}) that you can substantiate — do not stop at the first few
     found. Do NOT include any sale older than 12 months — those are out of scope
     and will be discarded. A sale whose date is not published may be included
     with date null (it will be flagged), but never one you know is older.
     LISTINGS: include every CURRENT listing you find (on the market now), with no
     time bound on when it was listed; do not include withdrawn or expired listings.
     PROXIMITY: only villages/operators within the stated radius of the subject
     village. Give every row a distanceKm (straight-line from the subject village)
     and leave out any village beyond the radius — a directory page for one suburb
     often lists villages from further afield too.
  2. Be EXHAUSTIVE — this is the most important instruction. List EVERY unit you can
     substantiate across ALL competing villages in the radius — both past-12-months
     SALES and current LISTINGS. Do not truncate to a handful of examples, do not
     stop at the first village, and do not return only one unit per village. Search
     each competing village individually for its sold history and its current
     "for sale" / vacancy page. There is NO maximum row count and no target count —
     if the supplied live search results substantiate 20 units, return 20 units, not
     a subset of them; returning fewer than what's substantiated is a failure, not a
     safe default. If a villages.com.au (or similar directory) page listing multiple
     villages is supplied below, it is the full page content, not a snippet —
     enumerate EVERY village named on it, and every unit/price shown for each, not
     just the first one or two.
  3. For each unit return every field in the schema you can substantiate:
       - operator (the owner/operator brand, e.g. Keyton, Aveo, Australian Unity,
         Levande, RetireAustralia, IRT, Stockland — NOT the village name)
       - villageName, unitNumber (e.g. "14" or "2/21" — from the listing/address),
         address, suburb, distanceKm
       - priceType ("sold" or "listing"), price, date (ISO yyyy-mm-dd, or yyyy-mm
         when only the month is known). "date" is the REAL published date of that
         record, and nothing else:
           * SOLD: the settlement/sale date from the sold record.
           * LISTING: the date it was listed / "first listed" / "on market since".
         NEVER substitute today's date, the date you searched, or any other
         stand-in — a reader compares these dates to judge how current the
         evidence is, and a search date masquerading as a listing date destroys
         that. If the page publishes no date, set date to null and note
         "listing date not published" in that row's "note".
       - bedrooms, bathrooms, study (true/false), carSpaces
       - internalSqm — the internal/living area in m². LOOK FOR IT SPECIFICALLY:
         listing pages label it "internal area", "living area", "floor area",
         "approx. area", "m²", "sqm" or "square metres", often in a specifications
         table, the floor-plan caption, or the body text rather than the headline.
         The scraped page content supplied below is the FULL page, not a snippet —
         read it through for these before concluding there is no area. If only a
         total/land/site area is published, put that in landSqm and leave
         internalSqm null; never put a land area in internalSqm.
       - landSqm (for villas / land-lease / any published land or site area)
       - unitType, tenure (licence / loan-lease / leasehold / strata / rental)
       - dmfSummary (deferred management fee terms, e.g. "30% over 5 years, no capital gain share")
       - recurringFee + recurringFeePeriod (general services levy, e.g. 487.06 + "month")
       - note (anything else material: refurbishment liability, capital gain share,
         exit terms, condition, inclusions)
       - source (site name) and sourceUrl (the SPECIFIC listing/sold-record URL, not a
         site homepage)
     Use null for any field you cannot substantiate — never invent, never estimate a
     number you did not find. An entry with only some fields populated is still valuable.
  4. Sort units by date descending (most recent first); undated entries last.
  5. Retirement-village units are usually sold under licence / loan-lease / DMF
     arrangements, so the headline figure is an INGOING price, not a freehold price.
     Capture it as the price and record the arrangement in tenure / dmfSummary.
  6. Do NOT include the SUBJECT village itself (the one named in the request) or any
     of its units — this is a competitor analysis. Other villages run by the same
     operator are competitors and stay in.
  7. Return ONLY valid JSON matching the requested schema — no preamble. To keep the
     reply short enough to list every unit, OMIT any key whose value would be null.`;

function buildSuburbsPrompt(req: RVRequest, confirmedSuburbs: Array<{ suburb: string; state?: string; postcode?: string; distanceKm?: number | null }>): string {
  const loc = [req.suburb, req.state, req.postcode].filter(Boolean).join(', ');
  const confirmedList = confirmedSuburbs
    .map(s => `${s.suburb}${s.state ? `, ${s.state}` : ''}${s.postcode ? ` ${s.postcode}` : ''}${s.distanceKm != null ? ` (~${s.distanceKm} km)` : ''}`)
    .join('; ');
  return [
    `Research the retirement village: "${req.villageName}".`,
    loc ? `Known location context: ${loc}.` : `Location not provided — resolve it from the village name.`,
    confirmedList
      ? `Report on EXACTLY these suburbs — a live search was already run for each one, so use ` +
        `those results below rather than substituting or adding others: ${confirmedList}.`
      : `1. Identify the village's suburb, state and postcode.\n2. List the village's own suburb plus the surrounding/related suburbs (≈5–8 km).`,
    `3. For each suburb provide the current median house price, median unit price, and`,
    `   median $/m² (living area) where published — sourced from realestate.com.au ONLY,`,
    `   no other portal. If realestate.com.au has no published figure for one of these`,
    `   suburbs, return null for it — do not drop the suburb from the list.`,
    `4. For each suburb also give the median HOUSE price 12 months ago and 6 months ago, read off`,
    `   realestate.com.au's price-trend / history data for that suburb, and the growth % over each`,
    `   period (null where not published — never estimate).`,
    `5. Compute the average of the per-suburb medians.`,
    ``,
    `Return JSON only, matching this schema:`,
    `{`,
    `  "village": { "name": "...", "suburb": "...", "state": "...", "postcode": "..." },`,
    `  "suburbs": [`,
    `    { "suburb": "...", "state": "...", "postcode": "...", "distanceKm": <number|null>,`,
    `      "medianHousePrice": <number|null>, "medianUnitPrice": <number|null>,`,
    `      "medianDollarPerSqm": <number|null>, "asOf": "<period e.g. 2026-Q1 or null>",`,
    `      "medianHousePrice12mAgo": <number|null>, "medianHousePrice6mAgo": <number|null>,`,
    `      "houseGrowth12mPct": <number|null, e.g. 4.2 for +4.2%>, "houseGrowth6mPct": <number|null>,`,
    `      "historySource": "<where the 12/6-month figures came from | null>" }`,
    `  ],`,
    `  "averages": { "avgMedianHousePrice": <number|null>, "avgMedianUnitPrice": <number|null>, "avgDollarPerSqm": <number|null> },`,
    `  "summary": "2-4 sentences incl. data period, basis, and source names",`,
    `  "sources": [ { "title": "...", "url": "...", "snippet": "..." } ]`,
    `}`,
  ].join('\n');
}

function buildCompetitorsPrompt(req: RVRequest): string {
  const loc = [req.suburb, req.state, req.postcode].filter(Boolean).join(', ');
  const radius = req.proximityKm && req.proximityKm > 0 ? req.proximityKm : 5;
  const nearby = (req.nearbySuburbs ?? []).map(s => s.trim()).filter(Boolean);
  return [
    `Find retirement villages competing with "${req.villageName}" within ${radius} km.`,
    `Exclude "${req.villageName}" itself and its own units — list competitors only.`,
    loc ? `Known location context: ${loc}.` : `Resolve the subject village's location from its name.`,
    nearby.length
      ? `Suburbs already confirmed within the radius (from prior research) — check the villages.com.au ` +
        `directory page for EACH of these individually, plus the subject's own suburb, not just one: ` +
        `${nearby.join(', ')}.`
      : `First identify which suburbs fall within ${radius} km, then check villages.com.au's directory page ` +
        `for each of those suburbs individually, not just the subject's own suburb.`,
    ``,
    `List EVERY unit you can substantiate for EVERY competing village (and its operator) within`,
    `${radius} km — SALES dated within the past 12 months only (since ${twelveMonthsAgoIsoDate()};`,
    `today is ${todayIsoDate()}) and ALL CURRENT LISTINGS. Exclude sales older than that and any`,
    `village beyond ${radius} km (a sale with no published date may stay, date null). Check each village's own "for sale"`,
    `page as well as the aggregators and portals, and include every sale from the last 12`,
    `months where published. Do not limit the list to a few examples or to one unit per`,
    `village — if 20 units are substantiated by the live search results, return all 20,`,
    `not a shorter subset. Most recent first.`,
    ``,
    `For EVERY row, work hardest on these two fields — they were coming back empty:`,
    `  • "date": the record's REAL published date. Sold → the sale date. Listing →`,
    `    the published listing / "first listed" date. Never substitute today's date`,
    `    or the search date; if the page publishes none, use null and say so in`,
    `    "note".`,
    `  • "internalSqm": search each listing page's specifications table, floor-plan`,
    `    caption and body text for "internal area" / "living area" / "floor area" /`,
    `    "m²" / "sqm". Only leave it null after actually checking the full page. Put a`,
    `    land/site area in "landSqm", never in "internalSqm".`,
    `Open the SPECIFIC unit's own listing page for these — a village summary page`,
    `usually omits both, while the individual unit page usually publishes them.`,
    ``,
    `Return JSON only, matching this schema:`,
    `{`,
    `  "subject": { "name": "...", "suburb": "...", "state": "...", "postcode": "..." },`,
    `  "proximityKm": ${radius},`,
    `  "units": [`,
    `    { "operator": "<owner/operator brand | null>", "villageName": "...",`,
    `      "unitNumber": "<e.g. 14 or 2/21 | null>", "address": "<or null>", "suburb": "<or null>",`,
    `      "distanceKm": <number|null>,`,
    `      "priceType": "sold" | "listing", "price": <number|null>, "date": "<yyyy-mm-dd|yyyy-mm|null>",`,
    `      "bedrooms": <number|null>, "bathrooms": <number|null>, "study": <true|false|null>,`,
    `      "carSpaces": <number|null>, "internalSqm": <number|null>, "landSqm": <number|null>,`,
    `      "unitType": "<e.g. ILU villa / apartment / serviced apartment | null>",`,
    `      "tenure": "<licence | loan-lease | leasehold | strata | rental | null>",`,
    `      "dmfSummary": "<deferred management fee terms | null>",`,
    `      "recurringFee": <number|null>, "recurringFeePeriod": "<week | month | quarter | year | null>",`,
    `      "note": "<other material detail | null>",`,
    `      "source": "<site name e.g. villages.com.au | null>", "sourceUrl": "<the specific listing/source URL | null>" }`,
    `  ],`,
    `  "summary": "2-4 sentences incl. how many villages/units found, date range, and source names (e.g. villages.com.au, downsizing.com.au)",`,
    `  "sources": [ { "title": "...", "url": "...", "snippet": "..." } ]`,
    `}`,
  ].join('\n');
}

/**
 * Replace each suburb row's current MHP / MUP, period and 12-month house growth
 * with the figures read off its realestate.com.au suburb-profile page. A prior
 * median the model supplied is cleared so it is re-derived from the profile's
 * growth (normalizeSuburbRows). 6-month figures (Cotality) are left alone.
 * Rows with no profile keep the model's figures, marked as such.
 */
function applyProfileFigures(rows: unknown[], profiles: Map<string, ReaProfileFigures>): unknown[] {
  return rows.map(r => {
    if (!r || typeof r !== 'object') return r;
    const row = r as Record<string, unknown>;
    const f = profiles.get(suburbSlug(String(row.suburb ?? '')));
    if (!f) return { ...row, mhpSource: 'web search (no suburb profile found)' };
    return {
      ...row,
      medianHousePrice: f.medianHousePrice,
      medianUnitPrice: f.medianUnitPrice ?? row.medianUnitPrice ?? null,
      asOf: f.housePeriod ?? row.asOf ?? null,
      houseGrowth12mPct: f.houseGrowth12mPct,
      medianHousePrice12mAgo: null,
      mhpSource: 'realestate.com.au suburb profile',
      profileUrl: f.url,
    };
  });
}

function suburbAveragesOf(rows: Array<Record<string, unknown>>) {
  const mean = (k: string) => {
    const v = rows.map(r => r[k]).filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
    return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
  };
  return {
    avgMedianHousePrice: mean('medianHousePrice'),
    avgMedianUnitPrice: mean('medianUnitPrice'),
    avgDollarPerSqm: mean('medianDollarPerSqm'),
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabase = isSupabaseConfigured() ? getAdminSupabase() : null;
  const resolved = await resolveProviderChain(supabase);
  if (!resolved) {
    return res.status(503).json({
      error: 'AI research is not configured. An admin can set the API key and model in Admin → AI Settings, or set GEMINI_API_KEY.',
    });
  }

  let body: RVRequest;
  try {
    body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) as RVRequest;
  } catch {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }
  if (!body || (body.mode !== 'suburbs' && body.mode !== 'competitors')) {
    return res.status(400).json({ error: 'mode must be "suburbs" or "competitors"' });
  }
  if (!body.villageName || !body.villageName.trim()) {
    return res.status(400).json({ error: 'villageName is required' });
  }

  const systemPrompt = body.mode === 'suburbs' ? SYSTEM_SUBURBS : SYSTEM_COMPETITORS;
  const head = resolved.chain[0];
  const refresh = (body as RVRequest & { refresh?: boolean }).refresh === true;

  // Resolve grounding *config* (cheap reads — no external API calls) so the
  // cache key can reflect it, WITHOUT performing the paid / rate-limited
  // Cotality + web-search lookups. Those run only on a cache miss below —
  // otherwise an identical (cached) request would still burn a search.
  let cotalitySettings: Awaited<ReturnType<typeof resolveCotalitySettings>> = null;
  try { cotalitySettings = await resolveCotalitySettings(supabase); } catch { /* ignore */ }

  // This endpoint always resolves web-search config and, when configured, injects
  // its results into the prompt for EVERY provider — including a natively-
  // grounded Gemini. Gemini's own Google-Search tool is adaptive (it can issue
  // its own follow-up queries) but only returns short grounding snippets; our
  // Firecrawl queries are narrower but scrape full page content (up to 8000
  // chars — see contentBudget in firecrawl.ts). Combining both gives Gemini a
  // guaranteed, deeply-scraped starting point (villages.com.au directory pages,
  // realestate.com.au/domain.com.au price guides) AND lets it search further on
  // its own — better coverage than either alone. This does mean a Gemini request
  // with grounding on now also spends Firecrawl credits, which the mutually-
  // exclusive design before this avoided; that trade was made deliberately for
  // this endpoint's accuracy needs.
  let webSearch: WebSearchConfig | null = null;
  try {
    webSearch = await resolveWebSearchConfig(supabase, resolved.webSearchPrimary, resolved.webSearchFallback);
  } catch { /* ignore */ }

  // Response cache — checked BEFORE any model / Cotality / web-search call, so
  // a cached request spends no search quota. Bypass with { refresh: true }.
  // `refresh` is left out of the key, so a refreshed answer replaces the
  // cached one instead of being stored beside it (a later normal run would
  // otherwise keep getting the old answer).
  const { refresh: _refresh, ...keyBody } = body as RVRequest & { refresh?: boolean };
  const cacheKey = researchCacheKey({
    endpoint: 'retirement-village',
    // Bumped when the figures' source changes, so answers built the old way
    // aren't served from cache. v2: MHP/MUP from REA suburb-profile pages.
    v: 2,
    body: keyBody,
    provider: head?.provider,
    model: head?.model,
    grounding: resolved.useGrounding,
    cotality: Boolean(cotalitySettings),
    webSearch: webSearch ? webSearchCacheTag(webSearch) : 'none',
  });
  if (!refresh) {
    const cached = getCachedResearch(cacheKey);
    if (cached) return res.status(200).json(cached);
  }

  // Cache miss: resolve the confirmed suburb list BEFORE building the main
  // prompt/queries — see resolveSuburbList's docstring for why. Done here
  // rather than earlier so a cache hit never spends this call.
  //
  // Competitors mode needs it too when the client has no section-1 result to
  // pass as `nearbySuburbs`: without a suburb list (and a state) no
  // villages.com.au / downsizing.com.au page could be targeted at all, so a
  // request carrying only a village name searched neither site.
  const radiusKm = body.proximityKm && body.proximityKm > 0 ? body.proximityKm : 5;
  // Also needed when the state is unknown: without it no directory URL can be
  // built, and the request falls back to many costly `site:` searches.
  const needsSuburbList = body.mode === 'suburbs' || !body.state || !(body.nearbySuburbs ?? []).some(s => s && s.trim());
  const confirmedSuburbs = needsSuburbList && head ? await resolveSuburbList(body, head) : [];
  let competitorState = body.state;
  let competitorSuburbs: string[] = [];
  if (body.mode === 'competitors') {
    const inRadius = confirmedSuburbs
      .filter(s => s.distanceKm == null || s.distanceKm <= radiusKm)
      .map(s => s.suburb);
    competitorState = competitorState || confirmedSuburbs.find(s => s.state)?.state;
    const seen = new Set<string>();
    competitorSuburbs = [body.suburb, ...(body.nearbySuburbs ?? []), ...inRadius]
      .filter((s): s is string => Boolean(s && s.trim()))
      .filter(s => {
        const k = suburbSlug(s);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .slice(0, 6); // cap: each suburb costs two directory scrapes
  }
  // Postcodes where known — realestate.com.au's sold pages are keyed by them.
  const postcodeFor = (sub: string) =>
    confirmedSuburbs.find(c => suburbSlug(c.suburb) === suburbSlug(sub))?.postcode
    ?? (body.suburb && suburbSlug(body.suburb) === suburbSlug(sub) ? body.postcode : undefined);
  // The subject's own suburb, for distance checks.
  const subjectSuburb = body.suburb || confirmedSuburbs.find(c => c.distanceKm === 0)?.suburb || confirmedSuburbs[0]?.suburb || competitorSuburbs[0];
  let userPrompt = body.mode === 'suburbs'
    ? buildSuburbsPrompt(body, confirmedSuburbs)
    : buildCompetitorsPrompt({ ...body, state: competitorState, nearbySuburbs: competitorSuburbs });

  // Suburbs mode: current MHP / MUP come ONLY from each suburb's
  // realestate.com.au suburb-profile page, fetched by URL and read with fixed
  // patterns (see reaSuburbProfile.ts) — not from whichever REA page a search
  // ranks. The figures are given to the model as authoritative and then
  // enforced on its answer below.
  const profiles = new Map<string, ReaProfileFigures>();
  if (body.mode === 'suburbs' && webSearch?.firecrawl) {
    const firecrawl = webSearch.firecrawl;
    const found = await Promise.all(confirmedSuburbs.slice(0, 8).map(async c => {
      const state = c.state ?? body.state;
      return state ? { c, fig: await fetchReaProfile(firecrawl, { suburb: c.suburb, state, postcode: c.postcode }) } : null;
    }));
    for (const f of found) if (f?.fig) profiles.set(suburbSlug(f.c.suburb), f.fig);
    if (profiles.size) {
      userPrompt +=
        `\n\n=== REALESTATE.COM.AU SUBURB PROFILE FIGURES (authoritative — use exactly) ===\n` +
        `Read from each suburb's realestate.com.au suburb-profile page ("Median price snapshot"). Report these ` +
        `exact medians, periods and 12-month growth. IGNORE the "market insights" median on realestate.com.au ` +
        `for-sale search pages — it is a different calculation.\n` +
        confirmedSuburbs
          .map(c => ({ c, f: profiles.get(suburbSlug(c.suburb)) }))
          .filter((x): x is { c: typeof x.c; f: ReaProfileFigures } => Boolean(x.f))
          .map(({ c, f }) =>
            `- ${c.suburb}: house ${f.medianHousePrice ?? 'n/a'} (${f.housePeriod ?? 'period n/a'}, 12-month growth ` +
            `${f.houseGrowth12mPct ?? 'n/a'}%); unit ${f.medianUnitPrice ?? 'n/a'} (${f.unitPeriod ?? 'period n/a'}) — ${f.url}`)
          .join('\n') +
        `\n=== END SUBURB PROFILE FIGURES ===`;
    }
  }

  // Cache miss: perform the (paid) grounding lookups, once.
  let cotalityNote: { used: boolean; url?: string; reason?: string } = { used: false };
  if (cotalitySettings) {
    try {
      // Suburbs mode: Cotality is the second source for every reported suburb
      // (the 6-month MHP in particular, which REA doesn't publish), so fetch it
      // per suburb rather than for the subject's suburb alone.
      const lookups = body.mode === 'suburbs' && confirmedSuburbs.length
        ? confirmedSuburbs.slice(0, 6).map(c => ({ suburb: c.suburb, state: c.state ?? body.state, postcode: c.postcode }))
        : [{ suburb: body.suburb, state: body.state, postcode: body.postcode }];
      const results = await Promise.all(lookups.map(async l => ({ l, ctx: await fetchCotalityContext(cotalitySettings!, l).catch(() => null) })));
      const found = results.filter((r): r is typeof r & { ctx: NonNullable<typeof r.ctx> } => Boolean(r.ctx));
      if (found.length) {
        userPrompt +=
          `\n\n=== COTALITY DATA (second source; cite as "Cotality") ===\n` +
          found.map(r => `--- ${r.l.suburb ?? r.l.postcode} — ${r.ctx.url} ---\n${r.ctx.data}`).join('\n\n') +
          `\n=== END COTALITY DATA ===`;
        cotalityNote = { used: true, url: found[0]!.ctx.url };
      } else if (cotalitySettings.propertyDataPath) {
        cotalityNote = { used: false, reason: 'Cotality configured but returned no data for these suburbs — used web research only.' };
      } else {
        cotalityNote = { used: false, reason: 'Cotality has no property data path set (Admin → Cotality Data), so the 6-month MHP can\'t be sourced.' };
      }
    } catch { /* never block AI research on Cotality */ }
  }

  // Live web search for the providers that need it. Lazy: the search only runs
  // once a provider that actually needs grounding is about to be called, and its
  // result is reused across failover attempts (one search per request maximum).
  const where = [body.suburb || competitorSuburbs[0], competitorState].filter(Boolean).join(' ');

  // Competitors mode has the same one-query-can't-cover-it problem, for the
  // proximity radius rather than a fixed suburb list: villages.com.au serves one
  // directory page PER SUBURB, so a single generic "villages near X" query
  // surfaces at most a couple of those pages. When the client has already run
  // "suburbs" mode it passes the confirmed nearby suburbs back in
  // `nearbySuburbs`; a site-targeted query is built for each (capped — every
  // query is a paid search call) so the radius is actually covered rather than
  // just the subject village's own suburb.
  //
  // With Firecrawl configured those directory pages (and downsizing.com.au's
  // equivalent) are scraped DIRECTLY by URL instead — see rvDirectories.ts —
  // and the `site:` queries below are only the fallback for when that isn't
  // possible (Tavily-only setup, or no state could be resolved).
  let directoryCtx: DirectoryPagesContext | null = null;
  if (body.mode === 'competitors') {
    directoryCtx = await fetchDirectoryPages(
      webSearch?.firecrawl ?? null,
      directoryTargets(competitorState, competitorSuburbs.map(sub => ({ suburb: sub, postcode: postcodeFor(sub) }))),
      body.villageName,
    );
    if (directoryCtx) userPrompt += `\n\n${directoryCtx.promptBlock}`;
  }
  const stateSlug = (competitorState || '').toLowerCase();
  const aggregatorQueries = directoryCtx ? [] : competitorSuburbs.flatMap(sub => {
    const slug = suburbSlug(sub);
    return [
      stateSlug && slug
        ? `site:villages.com.au/retirement-villages/${stateSlug}/${slug}`
        : `site:villages.com.au ${sub} ${competitorState ?? ''} retirement village`,
      `site:downsizing.com.au ${sub} ${competitorState ?? ''} retirement village for sale`,
    ];
  }).slice(0, 4); // fallback only — each query scrapes up to 8 pages

  // Suburbs mode: one site:realestate.com.au query PER suburb (house + unit,
  // separately — a combined "house and unit price" query mostly surfaces the
  // house price-guide page, since units are usually a distinct tab/URL on the
  // same portal, which is why unit medians kept coming back null) built from
  // `confirmedSuburbs` (resolveSuburbList, above) rather than a single generic
  // query trying to somehow cover however many suburbs get reported on. A
  // shared query can only return a handful of URLs total for the whole set, so
  // most suburbs never got a source page before — only the ones that query
  // happened to surface did. Capped at 6 suburbs (each is 2 Firecrawl queries).
  // Suburbs whose profile was read need no search; only the rest fall back to it.
  const suburbsForQueries = confirmedSuburbs.filter(c => !profiles.has(suburbSlug(c.suburb))).slice(0, 6);
  const searchQueries = body.mode === 'suburbs'
    ? suburbsForQueries.flatMap(s => {
        const sw = [s.suburb, s.state ?? body.state].filter(Boolean).join(' ');
        return [`site:realestate.com.au ${sw} median house price`, `site:realestate.com.au ${sw} median unit price`];
      })
    : [
        `retirement village near ${body.villageName} ${where} units for sale price recent`,
        ...aggregatorQueries,
      ].filter(Boolean).map(q => q.replace(/\s+/g, ' ').trim());

  // Force scraping (full rendered page → markdown) for this endpoint's Firecrawl
  // calls: suburb median prices on realestate.com.au, and unit listings on
  // villages.com.au, are rendered client-side and never appear in a
  // plain search snippet/meta-description — without scraping, a returned URL
  // still carries no usable figure. Also lift the per-query result cap so the
  // several parallel queries fired per request still surface enough distinct
  // pages.
  //
  // Competitor pages are long listing directories; after compaction (see
  // compactScrapedMarkdown) a dozen listings is ~10 KB, so they get a larger
  // per-page budget than the 8000-char default.
  const groundingConfig: WebSearchConfig | null = webSearch && webSearch.firecrawl
    ? {
        ...webSearch,
        firecrawl: {
          ...webSearch.firecrawl,
          scrapeContent: true,
          maxResults: Math.max(webSearch.firecrawl.maxResults, 8),
          ...(body.mode === 'competitors' ? { contentChars: 12000 } : {}),
        },
      }
    : webSearch;
  const search = createWebSearchRunner(groundingConfig, searchQueries.length === 1 ? searchQueries[0] : searchQueries);

  // Run with auto-failover across configured providers (active first); on a
  // quota 429 fall through to the next provider when enabled.
  const errors: string[] = [];
  for (let i = 0; i < resolved.chain.length; i++) {
    const p = resolved.chain[i];
    // Always injected when configured — for EVERY provider, Gemini (with its own
    // native grounding tool still attached below) included. See the comment
    // above `webSearch` for why the two are combined rather than mutually
    // exclusive on this endpoint.
    const searchCtx = webSearch ? await search.ensure() : null;
    const prompt = searchCtx ? `${userPrompt}\n\n${buildWebSearchPromptBlock(searchCtx)}` : userPrompt;
    // Set when Gemini's own grounding was refused mid-call and the injected
    // results stood in for it — tracked per attempt so the response reports
    // what THIS provider actually saw.
    let fallbackCtx: WebSearchContext | null = null;

    try {
      const result = await runAIResearch({
        provider: p.provider,
        model: p.model,
        apiKey: p.apiKey,
        systemPrompt,
        userPrompt: prompt,
        useGrounding: resolved.useGrounding,
        groundingFallback: webSearch && !searchCtx
          ? async () => {
              fallbackCtx = await search.ensure();
              return fallbackCtx ? buildWebSearchPromptBlock(fallbackCtx) : null;
            }
          : undefined,
      });

      const usedCtx: WebSearchContext | null = searchCtx ?? fallbackCtx;
      const searchNote = webSearchNote(usedCtx);
      const searchSources: AIResearchSource[] = [...(directoryCtx?.sources ?? []), ...(usedCtx ? usedCtx.sources : [])];
      // Legacy field: only truthy when Tavily was the tool that actually ran.
      const tavilyNote: { used: boolean; results?: number } = usedCtx && usedCtx.provider === 'tavily'
        ? { used: true, results: usedCtx.resultCount }
        : { used: false };

      const declared = (result.json.sources as AIResearchSource[] | undefined);
      const payload: Record<string, unknown> = {
        ...result.json,
        sources: mergeSources([...result.groundingSources, ...searchSources], declared),
        model: p.model,
        provider: result.provider,
        groundingUsed: result.groundingUsed || searchNote.used || Boolean(directoryCtx),
        // Raw Gemini-native flag, kept separate from the merged `groundingUsed`
        // above so the UI can tell "Gemini searched live AND Firecrawl was
        // injected" apart from either one alone.
        geminiNativeSearchUsed: result.provider === 'gemini' ? result.groundingUsed : undefined,
        configSource: p.source,
        cotality: cotalityNote,
        webSearch: searchNote,
        tavily: tavilyNote,
        // villages.com.au / downsizing.com.au directory pages scraped by URL.
        ...(body.mode === 'competitors' ? { directoryPages: { used: Boolean(directoryCtx), pages: directoryCtx?.pageCount ?? 0 } } : {}),
        timestamp: new Date().toISOString(),
      };
      if (i > 0) payload.failoverNote = `Primary provider (${resolved.chain[0].provider}) was rate-limited; served by ${p.provider} instead.`;

      // Coerce numeric fields before anything downstream reads them. Models
      // often return numbers as strings, with the unit attached ("85 m²",
      // "approx. 85 sqm", "$1.15M"); the UI and the export both test
      // `typeof x === 'number'`, so those were silently rendering as em dashes
      // — which is why internal area and $/m² came back empty even when the
      // figure had been found. See normalizeUnits.ts.
      if (payload._truncated) {
        delete payload._truncated;
        payload.truncated = true;
        payload.summary = `${typeof payload.summary === 'string' ? `${payload.summary} ` : ''}` +
          `(The model's reply hit its output limit, so the list may be incomplete — rows after the cut were lost.)`;
      }
      if (Array.isArray(payload.units)) payload.units = normalizeUnitRows(payload.units);
      if (Array.isArray(payload.suburbs) && profiles.size) {
        payload.suburbs = applyProfileFigures(payload.suburbs, profiles);
        payload.sources = mergeSources(
          [...profiles.values()].map(f => ({ title: 'realestate.com.au suburb profile', url: f.url })),
          payload.sources as AIResearchSource[],
        );
      }
      if (Array.isArray(payload.suburbs)) {
        payload.suburbs = normalizeSuburbRows(payload.suburbs);
        // Averages are recomputed from the final rows: the model's own averages
        // were taken over its figures, which the profile override may change.
        payload.averages = suburbAveragesOf(payload.suburbs as Array<Record<string, unknown>>);
      }

      // Internal area (and often the listing date) lives on a unit's OWN
      // listing page, not on the per-suburb directory page our searches rank
      // for — so no prompt could extract it, the page had to be fetched. Now
      // that the model has told us each unit's sourceUrl, read the missing
      // fields off those pages. Bounded + best-effort; see enrichUnits.ts.
      if (Array.isArray(payload.units)) {
        payload.units = normalizeUnitRows(
          await enrichUnitsFromListingPages(payload.units, groundingConfig?.firecrawl ?? null, p),
        );
        // After enrichment, which can fill in a missing sale date: keep only
        // sales from the last 12 months, current listings, and rows within the
        // radius. See competitorScope.ts.
        // Real suburb-centre distances first, so the radius filter below acts on
        // checked numbers rather than the model's estimates (or blanks).
        const verified = await verifyCompetitorDistances(
          payload.units,
          { suburb: subjectSuburb, state: competitorState, postcode: body.postcode },
          radiusKm,
        );
        payload.units = verified.units;
        const scoped = scopeCompetitorUnits(payload.units, radiusKm, new Date(), body.villageName);
        payload.units = scoped.units;
        payload.scope = scoped.note;
      }

      // Attach real coordinates for the surrounding-suburb map. Geocoding is
      // deterministic and free (OpenStreetMap Nominatim), so it's done here
      // rather than asking the LLM to recall lat/lng — that's exactly the kind
      // of numeric fact models get subtly wrong. Best-effort: a suburb that
      // fails to geocode just gets lat/lng: null and is dropped from the map,
      // not the whole response.
      //
      // Nominatim's public instance asks for ~1 request/second, so this is
      // strictly sequential (see geocode.ts) — capped at 8 suburbs to bound
      // added latency to under ~9s; a response typically has far fewer.
      if (body.mode === 'suburbs' && Array.isArray(payload.suburbs)) {
        const allRows = payload.suburbs as Array<{ suburb?: string; state?: string; postcode?: string; medianHousePrice?: number | null }>;
        const geocodeCap = 8; // bounds added latency; table still shows every row regardless
        const rows = allRows.slice(0, geocodeCap);
        let geocoded = allRows.map(r => ({ ...r, lat: null as number | null, lng: null as number | null }));
        try {
          const coords = await geocodeAuSuburbs(
            // Postcode included when known: it disambiguates suburb names that
            // repeat across (and within) states, which is what put a pin near
            // Sydney on a Central Coast map.
            rows.map(r => ({ suburb: String(r.suburb ?? ''), state: r.state, postcode: r.postcode })),
          );
          geocoded = allRows.map((r, idx) => ({
            ...r,
            lat: idx < geocodeCap ? coords[idx]?.lat ?? null : null,
            lng: idx < geocodeCap ? coords[idx]?.lng ?? null : null,
          }));
        } catch { /* geocoded already defaults every row to lat/lng: null */ }
        payload.suburbs = geocoded;

        // Real OSM map for the suburbs that geocoded: the stitched tiles as an
        // image plus the marker positions as data — the client draws the labels
        // (see staticMap.ts for why text isn't drawn here). Best-effort: null
        // means the Excel export falls back to its schematic.
        try {
          payload.map = await buildSuburbMapImage(
            geocoded
              .filter((r): r is typeof geocoded[number] & { lat: number; lng: number } => typeof r.lat === 'number' && typeof r.lng === 'number')
              .map(r => ({ suburb: String(r.suburb ?? ''), lat: r.lat, lng: r.lng, medianHousePrice: r.medianHousePrice })),
          );
        } catch {
          payload.map = null;
        }
      }

      setCachedResearch(cacheKey, payload);
      return res.status(200).json(payload);
    } catch (e) {
      const status = e instanceof AIResearchError ? e.status : 500;
      const msg = e instanceof Error ? e.message : 'Research failed.';
      errors.push(`${p.provider}: ${msg}`);
      // Fail over on a capacity failure (429 rate limit, 402 exhausted credits);
      // other errors would fail identically on the next provider.
      const capacity = isCapacityFailure(status);
      if (capacity && resolved.autoFailover && i < resolved.chain.length - 1) continue;
      return res.status(status).json({
        error: capacity ? `${msg}${quotaFailoverHint(resolved)}` : msg,
        ...(errors.length > 1 ? { attempted: errors } : {}),
      });
    }
  }
  return res.status(429).json({ error: `All configured AI providers are rate-limited or out of credits. ${errors.join(' | ')}`, attempted: errors });
}
