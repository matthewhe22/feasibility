import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { setCors } from '../_lib/auth';
import { getAdminSupabase, isSupabaseConfigured } from '../_lib/supabase';
import { resolveActiveSettings } from '../_lib/aiSettings';

/**
 * POST /api/benchmarks/research
 *
 * Research current Australian construction or professional-fee benchmarks for
 * a given project profile, using Google Gemini with built-in web search.
 *
 * Body:
 * {
 *   mode: 'construction' | 'professional',
 *   buildingType: string,
 *   storeys: number,
 *   state: string,         // e.g. 'NSW', 'QLD'
 *   finishQuality: string, // 'budget' | 'standard' | 'premium' | 'luxury'
 *   siteComplexity: string,
 *   gfa?: number,
 *   units?: number,
 *   contractValue?: number  // only used for `professional`
 * }
 *
 * Response:
 * {
 *   summary: string,
 *   rateLow?: number, rateHigh?: number,
 *   totalLow?: number, totalHigh?: number,
 *   feeBreakdown?: Array<{discipline, percentLow, percentHigh, dollarLow, dollarHigh}>,
 *   sources: Array<{title, url, snippet?}>,
 *   model: string,
 *   timestamp: string
 * }
 */

interface ResearchRequest {
  mode: 'construction' | 'professional';
  buildingType: string;
  storeys: number;
  state: string;
  finishQuality: string;
  siteComplexity: string;
  gfa?: number;
  units?: number;
  contractValue?: number;
}

interface ResearchResult {
  summary: string;
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
  sources: Array<{ title: string; url: string; snippet?: string }>;
  model: string;
  timestamp: string;
}

const SYSTEM_PROMPT = `You are an Australian quantity surveyor and construction-cost researcher.
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

function buildUserPrompt(req: ResearchRequest): string {
  const lines = [
    `Research current (2024-2026) Australian benchmark costs for the project below.`,
    ``,
    `MODE: ${req.mode}`,
    `Building type: ${req.buildingType}`,
    `Storeys: ${req.storeys}`,
    `State / city region: ${req.state}`,
    `Finish quality: ${req.finishQuality}`,
    `Site complexity: ${req.siteComplexity}`,
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
  if (!body || (body.mode !== 'construction' && body.mode !== 'professional')) {
    return res.status(400).json({ error: 'mode must be "construction" or "professional"' });
  }
  if (!body.buildingType || !body.state || !body.finishQuality || !body.siteComplexity) {
    return res.status(400).json({ error: 'buildingType, state, finishQuality, and siteComplexity are required' });
  }

  const client = new GoogleGenerativeAI(apiKey);
  const model = active.model;

  try {
    const genModel = client.getGenerativeModel({
      model,
      systemInstruction: SYSTEM_PROMPT,
    });

    const response = await genModel.generateContent(buildUserPrompt(body));

    const text = response.response.text();
    let parsed: ResearchResult | null = null;

    try {
      parsed = JSON.parse(text) as ResearchResult;
    } catch {
      return res.status(502).json({
        error: 'AI response did not contain valid JSON.',
        raw: text,
      });
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
