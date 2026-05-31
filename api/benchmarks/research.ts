import type { VercelRequest, VercelResponse } from '@vercel/node';
import { setCors } from '../_lib/auth';
import { getAdminSupabase, isSupabaseConfigured } from '../_lib/supabase';
import { resolveProviderChain } from '../_lib/aiSettings';
import { runAIResearch, mergeSources, AIResearchError, type AIResearchSource } from '../_lib/aiClient';
import { resolveCotalitySettings, fetchCotalityContext } from '../_lib/cotality';
import { resolveTavilySettings, fetchTavilyContext } from '../_lib/tavily';
import { researchCacheKey, getCachedResearch, setCachedResearch } from '../_lib/researchCache';

/**
 * POST /api/benchmarks/research
 *
 * Research current Australian construction-cost, professional-fee, or GRV
 * (gross-realisable-value sale-price) benchmarks for a given project profile,
 * using Google Gemini with built-in web search.
 *
 * Body (mode='construction' | 'professional'):
 * { mode, buildingType, storeys, state, finishQuality, siteComplexity, gfa?, units?, contractValue? }
 *
 * Body (mode='grv'):
 * { mode: 'grv', assetType, state, locationGrade, quality, targetYear,
 *   units?, totalSaleableArea?, unitArea? }
 */

interface ResearchRequest {
  mode: 'construction' | 'professional' | 'grv';
  // Cost-side fields
  buildingType?: string;
  storeys?: number;
  state: string;
  finishQuality?: string;
  siteComplexity?: string;
  gfa?: number;
  units?: number;
  contractValue?: number;
  // GRV-side fields
  assetType?: string;
  locationGrade?: string;
  quality?: string;
  targetYear?: number;
  totalSaleableArea?: number;
  unitArea?: number;
  /** Property address (free text). Optional context for AI grounding. */
  propertyAddress?: string;
  /** Suburb extracted from propertyAddress. Drives sub-market precision in
   *  the GRV research prompt — when present the AI is asked to ground the
   *  comparable-sales lookup to this specific suburb instead of the
   *  state × locationGrade average. */
  suburb?: string;
}

interface CotalityNote {
  used: boolean;
  /** The Cotality data URL that was queried (when used). */
  url?: string;
  /** Why grounding was skipped (when configured but no data returned). */
  reason?: string;
}

interface TavilyNote {
  used: boolean;
  /** Number of web results injected (when used). */
  results?: number;
}

/** Build a concise web-search query from the research request. */
function buildSearchQuery(req: ResearchRequest): string {
  if (req.mode === 'grv') {
    const where = req.suburb ? `${req.suburb} ` : '';
    return `Australian ${req.assetType ?? 'property'} sale price ${where}${req.state} ${req.locationGrade ?? ''} ${req.targetYear ?? new Date().getFullYear()} median price per sqm`.replace(/\s+/g, ' ').trim();
  }
  if (req.mode === 'professional') {
    return `Australian professional consultant fees percent of construction cost ${req.buildingType ?? ''} ${req.state} 2024 2025`.replace(/\s+/g, ' ').trim();
  }
  return `Australian construction cost per m2 ${req.buildingType ?? ''} ${req.state} ${req.finishQuality ?? ''} 2024 2025`.replace(/\s+/g, ' ').trim();
}

/** Pull a 4-digit Australian postcode out of a free-text address, if present. */
function extractPostcode(address?: string): string | undefined {
  if (!address) return undefined;
  const m = address.match(/\b(\d{4})\b/);
  return m ? m[1] : undefined;
}

const SYSTEM_PROMPT_COST = `You are an Australian quantity surveyor and construction-cost researcher.
Your job is to look up current (2024-2026) construction-cost benchmarks for Australian
property development feasibility models, citing public Quantity Surveyor publications and
reports.

Trusted sources you should prefer (in order):
  - Rawlinsons Australian Construction Handbook (annual edition)
  - Turner & Townsend International Construction Market Survey (ICMS) — Australian section
  - RLB (Rider Levett Bucknall) Quarterly Construction Cost Reports
  - Altus Group Australia Construction Cost Guide
  - Slattery Quarterly Cost Update
  - WT Partnership cost reports
  - AIQS (Australian Institute of Quantity Surveyors) Practice Guides (for professional fees)
  - Australian Institute of Architects (AIA) Fee Schedule
  - Engineers Australia Fee Guides
  - Master Builders Australia / HIA published rates (for residential)
  - State Government cost guides (e.g. ABS Producer Price Indexes — Output of construction)

You MUST:
  1. Search for recent (2024-2026) data — use your web search capability.
  2. Cite every numeric claim with a specific source name + URL.
  3. Express construction rates in AUD per m² of GFA, ex-GST, "head contractor lump sum"
     (excluding land, statutory contributions, finance, marketing, professional services,
     contingency, and developer profit) — unless the user explicitly asks for a different
     basis.
  4. Express professional fees as % of construction contract value, with separate disciplines
     (architect, structural, MEPH, QS, PM, etc.).
  5. Adjust for the user's state/city (Sydney, Melbourne, Brisbane, Perth, Adelaide,
     Canberra, Hobart, Darwin), storeys/height, finish quality (budget / standard / premium
     / luxury), and site complexity (simple / moderate / complex).
  6. Return ONLY valid JSON matching the requested schema — no preamble, no commentary.

If recent data is genuinely unavailable for a niche asset class, return your best estimate
with a clear "low confidence" note in summary, and explain in the summary why precision is
limited.`;

const SYSTEM_PROMPT_GRV = `You are an Australian property valuation analyst and sales-research specialist.
Your job is to look up current Australian sale-price benchmarks (Gross Realisable Value)
for property development feasibility models, citing public market-research publications.

Trusted sources you should prefer (in order):

  Residential
   - CoreLogic — Hedonic Home Value Index (monthly)
   - Domain Group — House / Apartment Price Reports (quarterly)
   - PropTrack (REA Group) — Home Price Index (monthly)
   - ABS Residential Property Price Indexes: Eight Capital Cities
   - Knight Frank Australia — Prime Residential Index
   - Charter Keck Cramer — Apartment Insights
   - Urbis — Apartment Essentials reports
   - HIA-CoreLogic — Residential Land Report

  Commercial / Office / Retail / Industrial
   - JLL Research Australia — Capital Markets reports
   - Knight Frank Capital Markets — Sector Spotlights
   - Colliers International — Capital Markets / Office / Retail Insights
   - Cushman & Wakefield — Marketbeat
   - CBRE Australia — ViewPoint / Capital Markets
   - Savills Australia — Spotlight reports

  Hotels
   - JLL Hotels & Hospitality — Australia
   - Colliers Hotels — Outlook
   - HVS Australia — Australia Hotel Valuation Index
   - STR Australia — performance data

You MUST:
  1. Search for recent data — use your web search capability. If the user asks for
     a future or historical year (target year ≠ current), apply published trend /
     escalation rates from the same sources to project the price.
  2. Cite every numeric claim with a specific source name + URL.
  3. Use the appropriate pricing basis for the asset class:
       - Apartments / units → AUD per m² of saleable internal area (GST-incl., margin scheme)
       - Townhouses / detached houses → AUD per dwelling (GST-incl., margin scheme)
       - Land → AUD per m² of titled land
       - Office / retail / industrial → AUD per m² of NLA (GST-excl., going-concern)
       - Hotels → AUD per key (GST-excl., going-concern)
     State the GST treatment in the summary.
  4. Adjust for state/city (Sydney, Melbourne, Brisbane, Perth, Adelaide, Canberra,
     Hobart, Darwin), location grade (CBD-prestige / CBD / inner-ring / middle-ring /
     outer-ring / regional), and quality (budget / standard / premium / luxury).
  5. Return ONLY valid JSON matching the requested schema — no preamble, no commentary.

If recent data is genuinely unavailable, return your best estimate with a clear "low
confidence" note in summary and explain why precision is limited.`;

function buildUserPrompt(req: ResearchRequest): string {
  if (req.mode === 'grv') return buildGRVPrompt(req);

  const lines = [
    `Research current (2024-2026) Australian benchmark costs for the project below.`,
    ``,
    `MODE: ${req.mode}`,
    `Building type: ${req.buildingType ?? '(not specified)'}`,
    `Storeys: ${req.storeys ?? '(not specified)'}`,
    `State / city region: ${req.state}`,
    `Finish quality: ${req.finishQuality ?? '(not specified)'}`,
    `Site complexity: ${req.siteComplexity ?? '(not specified)'}`,
  ];
  if (req.gfa)           lines.push(`Gross Floor Area: ${req.gfa.toLocaleString('en-AU')} m²`);
  if (req.units)         lines.push(`Number of units / lots / keys: ${req.units}`);
  if (req.contractValue) lines.push(`Construction contract value: A$${req.contractValue.toLocaleString('en-AU')}`);
  lines.push(``);
  if (req.mode === 'construction') {
    lines.push(`Search for and look up current per-m² rates for this asset class in this Australian city/state. Adjust the published "base" rate by state location, height/storey premium, finish quality, and site complexity. Return the recommended low-high band in $/m² GFA (ex-GST, head contractor lump sum) and the implied total in AUD. Cite at least 2 distinct sources with URLs.`);
    lines.push(``);
    lines.push(`Return JSON only, matching this schema:`);
    lines.push(`{`);
    lines.push(`  "summary": "1-3 sentence narrative including source citations",`);
    lines.push(`  "rateLow": <number>,`);
    lines.push(`  "rateHigh": <number>,`);
    lines.push(`  "totalLow": <number or 0>,`);
    lines.push(`  "totalHigh": <number or 0>,`);
    lines.push(`  "sources": [ { "title": "...", "url": "...", "snippet": "..." } ]`);
    lines.push(`}`);
  } else {
    lines.push(`Search for and look up current professional-fee benchmarks for this project type expressed as % of construction contract value. Provide rows per discipline (architect, interior designer, structural, civil, MEPH, façade, geotech, acoustic, fire, wind, QS, building surveyor, town planner, ESD, project manager, superintendent, vertical transport, traffic, DDA), each with low and high % bounds. If contract value is provided, also compute the dollar bounds. Cite at least 2 distinct sources with URLs.`);
    lines.push(``);
    lines.push(`Return JSON only, matching this schema:`);
    lines.push(`{`);
    lines.push(`  "summary": "1-3 sentence narrative including source citations",`);
    lines.push(`  "feeBreakdown": [ { "discipline": "...", "percentLow": <decimal>, "percentHigh": <decimal>, "dollarLow": <number or 0>, "dollarHigh": <number or 0> } ],`);
    lines.push(`  "sources": [ { "title": "...", "url": "...", "snippet": "..." } ]`);
    lines.push(`}`);
  }
  return lines.join('\n');
}

function buildGRVPrompt(req: ResearchRequest): string {
  const lines = [
    `Research the Australian sale-price benchmark (Gross Realisable Value) for the asset described below.`,
    ``,
    `MODE: grv`,
    `Asset type: ${req.assetType ?? '(not specified)'}`,
    `State / city region: ${req.state}`,
    `Sub-market / location grade: ${req.locationGrade ?? '(not specified)'}`,
    `Quality / finish grade: ${req.quality ?? '(not specified)'}`,
    `Target valuation year: ${req.targetYear ?? new Date().getFullYear()} (apply trend / escalation if not current)`,
  ];
  if (req.suburb)            lines.push(`Suburb (PRIMARY MARKET CONTEXT): ${req.suburb}`);
  if (req.propertyAddress)   lines.push(`Property address (context only): ${req.propertyAddress}`);
  if (req.units)             lines.push(`Number of units / lots / keys: ${req.units}`);
  if (req.totalSaleableArea) lines.push(`Total saleable area: ${req.totalSaleableArea.toLocaleString('en-AU')} m²`);
  if (req.unitArea)          lines.push(`Average unit area: ${req.unitArea.toLocaleString('en-AU')} m² per unit`);
  lines.push(``);
  if (req.suburb) {
    lines.push(`PRIORITY: Anchor the comparable-sales lookup to the SPECIFIC SUBURB "${req.suburb}" (${req.state}). Look up CoreLogic / Domain / PropTrack / realestate.com.au suburb pages for "${req.suburb}" directly — return suburb-level median/$ per m² where available, not the city-wide average. The state × location-grade context is a fallback ONLY when suburb-level data is genuinely unavailable; in that case say so explicitly in the summary.`);
    lines.push(``);
  }
  lines.push(`Look up current (or projected to ${req.targetYear ?? new Date().getFullYear()}) sale-price ranges for this asset class in this Australian sub-market. Use CoreLogic / Domain / PropTrack / ABS / Knight Frank / JLL / Colliers / Cushman & Wakefield / CBRE / Savills / Charter Keck Cramer / Urbis / HVS / STR. State explicitly in summary the pricing basis (e.g. "AUD per m² of saleable internal area, GST-incl. margin scheme") and the GST treatment used.`);
  lines.push(``);
  lines.push(`If the target year is in the future or past, apply published trend / annual-growth rates (from the same sources) to project the price linearly. Note in summary the annual growth rate used and the source.`);
  lines.push(``);
  lines.push(`Cite at least 2 distinct sources with URLs.${req.suburb ? ` PREFER suburb-specific pages (e.g. realestate.com.au/neighbourhoods/${req.suburb.toLowerCase().replace(/\s+/g, '-')}, domain.com.au/suburb-profile/${req.suburb.toLowerCase().replace(/\s+/g, '-')}) over city-wide reports where they exist.` : ''}`);
  lines.push(``);
  lines.push(`Return JSON only, matching this schema:`);
  lines.push(`{`);
  lines.push(`  "summary": "2-4 sentence narrative including source citations, pricing basis, GST treatment, and any escalation applied",`);
  lines.push(`  "pricingBasis": "e.g. AUD per m² of saleable internal area",`);
  lines.push(`  "perUnitLow": <number>,`);
  lines.push(`  "perUnitHigh": <number>,`);
  lines.push(`  "totalLow": <number or 0>,   // perUnit × area-or-units, when computable`);
  lines.push(`  "totalHigh": <number or 0>,`);
  lines.push(`  "breakdown": [ { "label": "Studio / 1-bed / 2-bed / Penthouse", "perUnitLow": <n>, "perUnitHigh": <n>, "pricingBasis": "...", "note": "..." } ],   // optional sub-segment table`);
  lines.push(`  "sources": [ { "title": "...", "url": "...", "snippet": "..." } ]`);
  lines.push(`}`);
  return lines.join('\n');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method not allowed' });

  const supabase = isSupabaseConfigured() ? getAdminSupabase() : null;
  const resolved = await resolveProviderChain(supabase);
  if (!resolved) {
    return res.status(503).json({
      error: 'AI research is not configured. An admin can set the API key and model in the Admin Portal → AI Settings, or set the GEMINI_API_KEY env var on the server.',
    });
  }

  let body: ResearchRequest;
  try {
    body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) as ResearchRequest;
  } catch {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }
  if (!body || (body.mode !== 'construction' && body.mode !== 'professional' && body.mode !== 'grv')) {
    return res.status(400).json({ error: 'mode must be "construction", "professional", or "grv"' });
  }
  if (!body.state) {
    return res.status(400).json({ error: 'state is required' });
  }
  if (body.mode === 'grv') {
    if (!body.assetType || !body.locationGrade || !body.quality) {
      return res.status(400).json({ error: 'assetType, locationGrade, and quality are required for grv mode' });
    }
  } else if (!body.buildingType || !body.finishQuality || !body.siteComplexity) {
    return res.status(400).json({ error: 'buildingType, finishQuality, and siteComplexity are required for construction/professional modes' });
  }

  const systemPrompt = body.mode === 'grv' ? SYSTEM_PROMPT_GRV : SYSTEM_PROMPT_COST;
  let userPrompt = buildUserPrompt(body);
  const head = resolved.chain[0];
  const refresh = (body as ResearchRequest & { refresh?: boolean }).refresh === true;

  // ── Resolve grounding *config* (cheap reads — no external API calls) ───────
  // We resolve which grounding sources WOULD apply so the cache key can include
  // them, but we DON'T perform the Cotality / Tavily lookups yet. Those are paid
  // / rate-limited calls, so they must only run on a cache miss — otherwise an
  // identical (cached) request would still burn a Tavily search + Cotality call.
  let cotalitySettings: Awaited<ReturnType<typeof resolveCotalitySettings>> = null;
  try { cotalitySettings = await resolveCotalitySettings(supabase); } catch { /* ignore */ }
  let tavilySettings: Awaited<ReturnType<typeof resolveTavilySettings>> = null;
  if (head && head.provider !== 'gemini') {
    try { tavilySettings = await resolveTavilySettings(supabase); } catch { /* ignore */ }
  }

  // ── Response cache (checked BEFORE any model / Cotality / Tavily call) ──────
  // An identical request (same profile + provider/model + grounding config)
  // returns the prior answer without calling the model OR spending a Tavily
  // search / Cotality lookup. Bypass with { refresh: true }.
  const cacheKey = researchCacheKey({
    endpoint: 'benchmarks',
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

  // ── Cache miss: now perform the (paid) grounding lookups, once. ────────────
  // Optional: ground the research in real Cotality (CoreLogic) property data.
  // Best-effort — any failure degrades silently to web-search-only research.
  let cotalityNote: CotalityNote = { used: false };
  if (cotalitySettings) {
    try {
      const ctx = await fetchCotalityContext(cotalitySettings, {
        suburb: body.suburb,
        state: body.state,
        postcode: extractPostcode(body.propertyAddress),
      });
      if (ctx) {
        userPrompt =
          `${userPrompt}\n\n` +
          `=== AUTHORITATIVE COTALITY DATA (treat as the PRIMARY source; cite as "Cotality") ===\n` +
          `Source: ${ctx.url}\n${ctx.data}\n` +
          `=== END COTALITY DATA ===\n` +
          `Base your benchmark primarily on the Cotality figures above. Reconcile any web ` +
          `sources against them and note material discrepancies in the summary. Include ` +
          `"Cotality" in the sources list with the URL above.`;
        cotalityNote = { used: true, url: ctx.url };
      } else if (cotalitySettings.propertyDataPath) {
        cotalityNote = {
          used: false,
          reason: 'Cotality is configured but returned no usable data for this suburb/postcode — used web research only.',
        };
      }
    } catch {
      /* never block AI research on Cotality */
    }
  }

  // Optional: Tavily web search for providers without native grounding (Gemini
  // uses its own grounding). One search per cache-miss request maximum.
  let tavilyNote: TavilyNote = { used: false };
  let tavilySources: AIResearchSource[] = [];
  if (tavilySettings) {
    try {
      const ctx = await fetchTavilyContext(tavilySettings, buildSearchQuery(body));
      if (ctx) {
        userPrompt =
          `${userPrompt}\n\n` +
          `=== LIVE WEB SEARCH RESULTS (Tavily) — use as the primary current-data source; cite the URLs ===\n` +
          `${ctx.promptBlock}\n` +
          `=== END WEB SEARCH RESULTS ===\n` +
          `Base your figures on these live results where relevant and cite the URLs above in the sources list.`;
        tavilyNote = { used: true, results: ctx.resultCount };
        tavilySources = ctx.sources;
      }
    } catch {
      /* never block AI research on Tavily */
    }
  }

  // ── Run with auto-failover across configured providers ────────────────────
  // The active provider is tried first; on a quota/rate-limit (429) the request
  // fails over to the next configured provider (when autoFailover is on). The
  // Gemini Google-Search grounding is skipped entirely when useGrounding is off
  // (avoids the scarce free-tier grounding quota).
  const errors: string[] = [];
  let failoverNote: string | undefined;
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

      const declared = result.json.sources as Array<{ title: string; url: string; snippet?: string }> | undefined;
      const payload: Record<string, unknown> = {
        ...result.json,
        sources: mergeSources([...result.groundingSources, ...tavilySources], declared as AIResearchSource[] | undefined),
        model: p.model,
        provider: result.provider,
        groundingUsed: result.groundingUsed || tavilyNote.used,
        configSource: p.source,
        cotality: cotalityNote,
        tavily: tavilyNote,
        timestamp: new Date().toISOString(),
      };
      if (i > 0) {
        failoverNote = `Primary provider (${resolved.chain[0].provider}) was rate-limited; served by ${p.provider} instead.`;
      }
      if (failoverNote) payload.failoverNote = failoverNote;
      setCachedResearch(cacheKey, payload);
      return res.status(200).json(payload);
    } catch (e) {
      const status = e instanceof AIResearchError ? e.status : 500;
      const msg = e instanceof Error ? e.message : 'Unknown error';
      errors.push(`${p.provider}: ${msg}`);
      // Only fail over on quota / rate-limit (429) when enabled and another
      // provider remains. Any other error is returned immediately.
      const isQuota = status === 429;
      const hasNext = i < resolved.chain.length - 1;
      if (isQuota && resolved.autoFailover && hasNext) continue;
      return res.status(status).json({
        error: msg,
        ...(errors.length > 1 ? { attempted: errors } : {}),
      });
    }
  }
  // Exhausted the chain (all 429).
  return res.status(429).json({
    error: `All configured AI providers are rate-limited. ${errors.join(' | ')}`,
    attempted: errors,
  });
}

