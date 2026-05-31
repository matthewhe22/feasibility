import type { VercelRequest, VercelResponse } from '@vercel/node';
import { setCors } from '../_lib/auth';
import { getAdminSupabase, isSupabaseConfigured } from '../_lib/supabase';
import { resolveProviderChain } from '../_lib/aiSettings';
import { resolveCotalitySettings, fetchCotalityContext } from '../_lib/cotality';
import { resolveTavilySettings, fetchTavilyContext } from '../_lib/tavily';
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
  2. For each unit return: village name, price, whether it is a SOLD price or a current
     LISTING price, the date (sold date or listing date, ISO yyyy-mm-dd or yyyy-mm if only
     month known), bedrooms, bathrooms, study (true/false), unit type, address/suburb,
     and the specific source/listing URL it came from. Use null for any field you cannot
     substantiate — never invent.
  3. Sort units by date descending (most recent first).
  4. Note that retirement-village units are often sold under licence / loan-lease /
     DMF arrangements — capture the headline ingoing/listing price and note the tenure in
     the unit's "note" field if known.
  5. Return ONLY valid JSON matching the requested schema — no preamble.`;

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
    `For each competing village within ${radius} km, list its recently SOLD or currently`,
    `LISTED units with price, date, bedrooms, bathrooms, study, unit type, and address/suburb`,
    `where available. Most recent first.`,
    ``,
    `Return JSON only, matching this schema:`,
    `{`,
    `  "subject": { "name": "...", "suburb": "...", "state": "...", "postcode": "..." },`,
    `  "proximityKm": ${radius},`,
    `  "units": [`,
    `    { "villageName": "...", "address": "<or null>", "suburb": "<or null>", "distanceKm": <number|null>,`,
    `      "priceType": "sold" | "listing", "price": <number|null>, "date": "<yyyy-mm-dd|yyyy-mm|null>",`,
    `      "bedrooms": <number|null>, "bathrooms": <number|null>, "study": <true|false|null>,`,
    `      "unitType": "<e.g. ILU villa / apartment / serviced apartment | null>", "note": "<tenure/DMF note | null>",`,
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
  // Cotality + Tavily lookups. Those run only on a cache miss below — otherwise
  // an identical (cached) request would still burn a Tavily search.
  let cotalitySettings: Awaited<ReturnType<typeof resolveCotalitySettings>> = null;
  try { cotalitySettings = await resolveCotalitySettings(supabase); } catch { /* ignore */ }
  let tavilySettings: Awaited<ReturnType<typeof resolveTavilySettings>> = null;
  if (head && head.provider !== 'gemini') {
    try { tavilySettings = await resolveTavilySettings(supabase); } catch { /* ignore */ }
  }

  // Response cache — checked BEFORE any model / Cotality / Tavily call, so a
  // cached request spends no search quota. Bypass with { refresh: true }.
  const cacheKey = researchCacheKey({
    endpoint: 'retirement-village',
    body,
    provider: head?.provider,
    model: head?.model,
    grounding: resolved.useGrounding,
    cotality: Boolean(cotalitySettings),
    tavily: Boolean(tavilySettings),
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

  // Optional Tavily web search for providers without native grounding (DeepSeek
  // / OpenRouter / NVIDIA). One search per cache-miss request maximum.
  let tavilyNote: { used: boolean; results?: number } = { used: false };
  let tavilySources: AIResearchSource[] = [];
  if (tavilySettings) {
    try {
      const where = [body.suburb, body.state].filter(Boolean).join(' ');
      const query = body.mode === 'suburbs'
        ? `${body.villageName} ${where} surrounding suburbs median house and unit price`.replace(/\s+/g, ' ').trim()
        : `retirement village near ${body.villageName} ${where} units for sale price recent`.replace(/\s+/g, ' ').trim();
      const ctx = await fetchTavilyContext(tavilySettings, query);
      if (ctx) {
        userPrompt +=
          `\n\n=== LIVE WEB SEARCH RESULTS (Tavily) — primary current-data source; cite the URLs ===\n` +
          `${ctx.promptBlock}\n=== END WEB SEARCH RESULTS ===`;
        tavilyNote = { used: true, results: ctx.resultCount };
        tavilySources = ctx.sources;
      }
    } catch { /* never block AI research on Tavily */ }
  }

  // Run with auto-failover across configured providers (active first); on a
  // quota 429 fall through to the next provider when enabled.
  const errors: string[] = [];
  for (let i = 0; i < resolved.chain.length; i++) {
    const p = resolved.chain[i];
    try {
      const result = await runAIResearch({
        provider: p.provider,
        model: p.model,
        apiKey: p.apiKey,
        systemPrompt,
        userPrompt,
        useGrounding: resolved.useGrounding,
      });

      const declared = (result.json.sources as AIResearchSource[] | undefined);
      const payload: Record<string, unknown> = {
        ...result.json,
        sources: mergeSources([...result.groundingSources, ...tavilySources], declared),
        model: p.model,
        provider: result.provider,
        groundingUsed: result.groundingUsed || tavilyNote.used,
        configSource: p.source,
        cotality: cotalityNote,
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
      return res.status(status).json({ error: msg, ...(errors.length > 1 ? { attempted: errors } : {}) });
    }
  }
  return res.status(429).json({ error: `All configured AI providers are rate-limited. ${errors.join(' | ')}`, attempted: errors });
}
