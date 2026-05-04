import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { setCors } from '../_lib/auth';
import { getAdminSupabase, isSupabaseConfigured } from '../_lib/supabase';
import { resolveActiveSettings } from '../_lib/aiSettings';

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
}

interface ResearchResult {
  summary: string;
  // Cost / construction
  rateLow?: number;
  rateHigh?: number;
  totalLow?: number;
  totalHigh?: number;
  feeBreakdown?: Array<{
    discipline: string;
    percentLow: number;
    percentHigh: number;
    dollarLow?: number;
    dollarHigh?: number;
  }>;
  // GRV
  pricingBasis?: string;
  perUnitLow?: number;
  perUnitHigh?: number;
  breakdown?: Array<{
    label: string;
    perUnitLow: number;
    perUnitHigh: number;
    pricingBasis?: string;
    note?: string;
  }>;
  // Common
  sources: Array<{ title: string; url: string; snippet?: string }>;
  model: string;
  timestamp: string;
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
  if (req.units)             lines.push(`Number of units / lots / keys: ${req.units}`);
  if (req.totalSaleableArea) lines.push(`Total saleable area: ${req.totalSaleableArea.toLocaleString('en-AU')} m²`);
  if (req.unitArea)          lines.push(`Average unit area: ${req.unitArea.toLocaleString('en-AU')} m² per unit`);
  lines.push(``);
  lines.push(`Look up current (or projected to ${req.targetYear ?? new Date().getFullYear()}) sale-price ranges for this asset class in this Australian sub-market. Use CoreLogic / Domain / PropTrack / ABS / Knight Frank / JLL / Colliers / Cushman & Wakefield / CBRE / Savills / Charter Keck Cramer / Urbis / HVS / STR. State explicitly in summary the pricing basis (e.g. "AUD per m² of saleable internal area, GST-incl. margin scheme") and the GST treatment used.`);
  lines.push(``);
  lines.push(`If the target year is in the future or past, apply published trend / annual-growth rates (from the same sources) to project the price linearly. Note in summary the annual growth rate used and the source.`);
  lines.push(``);
  lines.push(`Cite at least 2 distinct sources with URLs.`);
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
  const active = await resolveActiveSettings(supabase);
  if (!active) {
    return res.status(503).json({
      error: 'AI research is not configured. An admin can set the API key and model in the Admin Portal → AI Settings, or set the GEMINI_API_KEY env var on the server.',
    });
  }
  const apiKey = active.apiKey;

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

  const client = new GoogleGenerativeAI(apiKey);
  const model = active.model;

  try {
    const genModel = client.getGenerativeModel({
      model,
      systemInstruction: body.mode === 'grv' ? SYSTEM_PROMPT_GRV : SYSTEM_PROMPT_COST,
    });

    const response = await genModel.generateContent(buildUserPrompt(body));

    const text = response.response.text();
    let parsed: ResearchResult | null = null;

    // Strip markdown fences if Gemini wrapped the JSON.
    const cleaned = text
      .replace(/^\s*```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/i, '')
      .trim();

    try {
      parsed = JSON.parse(cleaned) as ResearchResult;
    } catch {
      // Last-ditch — extract first {...} block
      const m = cleaned.match(/\{[\s\S]*\}/);
      if (m) {
        try { parsed = JSON.parse(m[0]) as ResearchResult; } catch { /* ignore */ }
      }
      if (!parsed) {
        return res.status(502).json({
          error: 'AI response did not contain valid JSON.',
          raw: text,
        });
      }
    }

    parsed.model = model;
    parsed.timestamp = new Date().toISOString();
    (parsed as ResearchResult & { configSource?: string }).configSource = active.source;

    return res.status(200).json(parsed);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const errCode = (err as any)?.code || (err as any)?.status || '';

    if (msg.includes('API key') || msg.includes('authentication') || msg.includes('401') || msg.includes('UNAUTHENTICATED')) {
      return res.status(500).json({
        error: `Google Gemini API key is invalid (source: ${active.source}). Update it in the Admin Portal → AI Settings. Get a free key at https://aistudio.google.com/apikey`,
      });
    }
    if (msg.includes('RESOURCE_EXHAUSTED') || msg.includes('rate') || msg.includes('429') || errCode === 429) {
      return res.status(429).json({
        error: 'Google Gemini API rate limit reached (free tier: 60 req/min, 1500 req/day). Try again shortly.'
      });
    }

    return res.status(500).json({ error: `Live benchmark research failed: ${msg}` });
  }
}
