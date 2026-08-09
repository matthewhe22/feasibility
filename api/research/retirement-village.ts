import type { VercelRequest, VercelResponse } from '@vercel/node';
import { setCors } from '../_lib/auth';
import { getAdminSupabase, isSupabaseConfigured } from '../_lib/supabase';
import { resolveProviderChain, quotaFailoverHint, type ResolvedProvider } from '../_lib/aiSettings';
import { resolveCotalitySettings, fetchCotalityContext } from '../_lib/cotality';
import {
  resolveWebSearchConfig,
  createWebSearchRunner,
  needsWebSearchGrounding,
  webSearchCacheTag,
  buildWebSearchPromptBlock,
  webSearchNote,
  type WebSearchConfig,
  type WebSearchContext,
} from '../_lib/webSearch';
import { runAIResearch, mergeSources, AIResearchError, type AIResearchSource } from '../_lib/aiClient';
import { researchCacheKey, getCachedResearch, setCachedResearch } from '../_lib/researchCache';

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
}

const SYSTEM_SUBURBS = `You are an Australian residential property research analyst.
Given a retirement village, you (1) identify its location (suburb, state, postcode),
(2) determine the surrounding / related suburbs (the village's own suburb plus
adjacent suburbs within roughly 5–8 km), and (3) report current median dwelling
prices for each.

You MUST:
  1. Use your web search capability to find CURRENT (latest available) data.
  2. Prefer CoreLogic / Cotality, Domain, PropTrack (REA), and ABS suburb pages.
  3. For each suburb return: median HOUSE price, median UNIT/apartment price, and
     median $/m² of living area where available (else null).
  4. Compute the simple average of the per-suburb medians (ignoring nulls).
  5. State all prices in AUD. If a figure is unavailable, use null — never invent.
  6. Return ONLY valid JSON matching the requested schema — no preamble.
If a Cotality data block is supplied, treat it as the PRIMARY source and reconcile
web figures against it.`;

const SYSTEM_COMPETITORS = `You are an Australian retirement-living market analyst.
Given a retirement village and a proximity radius, you identify COMPETING
retirement villages within that radius and list their unit sale / listing evidence.

Trusted sources you should search DIRECTLY and prefer (in roughly this order):
  Third-party retirement-living aggregators / listing portals
   - villages.com.au (DCM Media retirement village directory + listings)
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
  2. Be EXHAUSTIVE. List EVERY unit you can substantiate across ALL competing villages
     in the radius — both past/comparable SALES and current LISTINGS. Do not truncate to
     a handful of examples, do not stop at the first village, and do not return only one
     unit per village. Search each competing village individually for its sold history
     and its current "for sale" / vacancy page. More substantiated rows is better.
  3. For each unit return every field in the schema you can substantiate:
       - operator (the owner/operator brand, e.g. Keyton, Aveo, Australian Unity,
         Levande, RetireAustralia, IRT, Stockland — NOT the village name)
       - villageName, unitNumber (e.g. "14" or "2/21" — from the listing/address),
         address, suburb, distanceKm
       - priceType ("sold" or "listing"), price, date (sold or listing date;
         ISO yyyy-mm-dd, or yyyy-mm when only the month is known)
       - bedrooms, bathrooms, study (true/false), carSpaces
       - internalSqm (internal/living area in m²) and, for villas/land-lease, landSqm
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
  6. Return ONLY valid JSON matching the requested schema — no preamble.`;

function buildSuburbsPrompt(req: RVRequest): string {
  const loc = [req.suburb, req.state, req.postcode].filter(Boolean).join(', ');
  return [
    `Research the retirement village: "${req.villageName}".`,
    loc ? `Known location context: ${loc}.` : `Location not provided — resolve it from the village name.`,
    ``,
    `1. Identify the village's suburb, state and postcode.`,
    `2. List the village's own suburb plus the surrounding/related suburbs (≈5–8 km).`,
    `3. For each suburb provide the current median house price, median unit price, and`,
    `   median $/m² (living area) where published.`,
    `4. Compute the average of the per-suburb medians.`,
    ``,
    `Return JSON only, matching this schema:`,
    `{`,
    `  "village": { "name": "...", "suburb": "...", "state": "...", "postcode": "..." },`,
    `  "suburbs": [`,
    `    { "suburb": "...", "state": "...", "postcode": "...", "distanceKm": <number|null>,`,
    `      "medianHousePrice": <number|null>, "medianUnitPrice": <number|null>,`,
    `      "medianDollarPerSqm": <number|null>, "asOf": "<period e.g. 2026-Q1 or null>" }`,
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
  return [
    `Find retirement villages competing with "${req.villageName}" within ${radius} km.`,
    loc ? `Known location context: ${loc}.` : `Resolve the subject village's location from its name.`,
    ``,
    `List EVERY unit you can substantiate for EVERY competing village within ${radius} km —`,
    `both past/comparable SALES and current LISTINGS. Check each village's own "for sale"`,
    `page as well as the aggregators and portals, and include the sold-price history where`,
    `published. Do not limit the list to a few examples or to one unit per village.`,
    `Most recent first.`,
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
  let userPrompt = body.mode === 'suburbs' ? buildSuburbsPrompt(body) : buildCompetitorsPrompt(body);
  const head = resolved.chain[0];
  const refresh = (body as RVRequest & { refresh?: boolean }).refresh === true;

  // Resolve grounding *config* (cheap reads — no external API calls) so the
  // cache key can reflect it, WITHOUT performing the paid / rate-limited
  // Cotality + web-search lookups. Those run only on a cache miss below —
  // otherwise an identical (cached) request would still burn a search.
  let cotalitySettings: Awaited<ReturnType<typeof resolveCotalitySettings>> = null;
  try { cotalitySettings = await resolveCotalitySettings(supabase); } catch { /* ignore */ }

  // Grounding is resolved for the WHOLE chain, not just the head. A Gemini head
  // grounds itself, but the providers behind it (reached when Gemini 429s) do
  // not — gating on the head alone meant a Firecrawl key was ignored on exactly
  // the requests that needed it, and every failover ran ungrounded.
  const needsSearch = (p: ResolvedProvider) => needsWebSearchGrounding(p.provider, resolved.useGrounding);
  let webSearch: WebSearchConfig | null = null;
  if (resolved.chain.some(needsSearch)) {
    try {
      webSearch = await resolveWebSearchConfig(supabase, resolved.webSearchPrimary, resolved.webSearchFallback);
    } catch { /* ignore */ }
  }

  // Response cache — checked BEFORE any model / Cotality / web-search call, so
  // a cached request spends no search quota. Bypass with { refresh: true }.
  const cacheKey = researchCacheKey({
    endpoint: 'retirement-village',
    body,
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

  // Cache miss: perform the (paid) grounding lookups, once.
  let cotalityNote: { used: boolean; url?: string; reason?: string } = { used: false };
  if (cotalitySettings) {
    try {
      const ctx = await fetchCotalityContext(cotalitySettings, { suburb: body.suburb, state: body.state, postcode: body.postcode });
      if (ctx) {
        userPrompt +=
          `\n\n=== AUTHORITATIVE COTALITY DATA (treat as PRIMARY source; cite as "Cotality") ===\n` +
          `Source: ${ctx.url}\n${ctx.data}\n=== END COTALITY DATA ===`;
        cotalityNote = { used: true, url: ctx.url };
      } else if (cotalitySettings.propertyDataPath) {
        cotalityNote = { used: false, reason: 'Cotality configured but returned no data for the supplied suburb/postcode — used web research only.' };
      }
    } catch { /* never block AI research on Cotality */ }
  }

  // Live web search for the providers that need it. Lazy: the search only runs
  // once a provider that actually needs grounding is about to be called, and its
  // result is reused across failover attempts (one search per request maximum).
  const where = [body.suburb, body.state].filter(Boolean).join(' ');
  const searchQuery = body.mode === 'suburbs'
    ? `${body.villageName} ${where} surrounding suburbs median house and unit price`.replace(/\s+/g, ' ').trim()
    : `retirement village near ${body.villageName} ${where} units for sale price recent`.replace(/\s+/g, ' ').trim();
  const search = createWebSearchRunner(webSearch, searchQuery);

  // Run with auto-failover across configured providers (active first); on a
  // quota 429 fall through to the next provider when enabled.
  const errors: string[] = [];
  for (let i = 0; i < resolved.chain.length; i++) {
    const p = resolved.chain[i];
    const searchCtx = needsSearch(p) ? await search.ensure() : null;
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
      const searchSources: AIResearchSource[] = usedCtx ? usedCtx.sources : [];
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
        groundingUsed: result.groundingUsed || searchNote.used,
        configSource: p.source,
        cotality: cotalityNote,
        webSearch: searchNote,
        tavily: tavilyNote,
        timestamp: new Date().toISOString(),
      };
      if (i > 0) payload.failoverNote = `Primary provider (${resolved.chain[0].provider}) was rate-limited; served by ${p.provider} instead.`;
      setCachedResearch(cacheKey, payload);
      return res.status(200).json(payload);
    } catch (e) {
      const status = e instanceof AIResearchError ? e.status : 500;
      const msg = e instanceof Error ? e.message : 'Research failed.';
      errors.push(`${p.provider}: ${msg}`);
      if (status === 429 && resolved.autoFailover && i < resolved.chain.length - 1) continue;
      return res.status(status).json({
        error: status === 429 ? `${msg}${quotaFailoverHint(resolved)}` : msg,
        ...(errors.length > 1 ? { attempted: errors } : {}),
      });
    }
  }
  return res.status(429).json({ error: `All configured AI providers are rate-limited. ${errors.join(' | ')}`, attempted: errors });
}
