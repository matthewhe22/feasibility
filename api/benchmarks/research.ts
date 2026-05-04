import type { VercelRequest, VercelResponse } from '@vercel/node';
import Anthropic from '@anthropic-ai/sdk';
import { setCors } from '../_lib/auth';

/**
 * POST /api/benchmarks/research
 *
 * Research current Australian construction or professional-fee benchmarks for
 * a given project profile, using Claude with the server-side web_search tool
 * and stream the result back as JSON.
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
  1. Use the web_search tool to find recent (2024-2026) data — do not rely on memory.
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

const RESPONSE_SCHEMA_CONSTRUCTION = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: { type: 'string', description: '1-3 sentence narrative explanation including any caveats. Cite source names inline.' },
    rateLow:  { type: 'number', description: 'Recommended low-end $/m² GFA (AUD, ex-GST)' },
    rateHigh: { type: 'number', description: 'Recommended high-end $/m² GFA (AUD, ex-GST)' },
    totalLow:  { type: 'number', description: 'Total construction cost AUD low-end (rate × GFA). 0 if GFA not provided.' },
    totalHigh: { type: 'number', description: 'Total construction cost AUD high-end (rate × GFA). 0 if GFA not provided.' },
    sources: {
      type: 'array',
      description: 'Each source actually used to derive the numbers above.',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title:   { type: 'string' },
          url:     { type: 'string' },
          snippet: { type: 'string', description: 'Short excerpt or paraphrase of the cited line item.' },
        },
        required: ['title', 'url'],
      },
    },
  },
  required: ['summary', 'rateLow', 'rateHigh', 'sources'],
};

const RESPONSE_SCHEMA_PROFESSIONAL = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: { type: 'string' },
    feeBreakdown: {
      type: 'array',
      description: 'Per-discipline professional-fee benchmark rows.',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          discipline:  { type: 'string', description: 'e.g. "Architect", "Structural Engineer", "Quantity Surveyor"' },
          percentLow:  { type: 'number', description: 'Low end as decimal — e.g. 0.04 for 4%' },
          percentHigh: { type: 'number', description: 'High end as decimal' },
          dollarLow:   { type: 'number', description: 'percentLow × contractValue. 0 if contractValue is 0.' },
          dollarHigh:  { type: 'number', description: 'percentHigh × contractValue. 0 if contractValue is 0.' },
        },
        required: ['discipline', 'percentLow', 'percentHigh'],
      },
    },
    sources: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title:   { type: 'string' },
          url:     { type: 'string' },
          snippet: { type: 'string' },
        },
        required: ['title', 'url'],
      },
    },
  },
  required: ['summary', 'feeBreakdown', 'sources'],
};

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
    lines.push(`Use web_search to look up current per-m² rates for this asset class in this Australian city/state. Adjust the published "base" rate by state location, height/storey premium, finish quality, and site complexity. Return the recommended low-high band in $/m² GFA (ex-GST, head contractor lump sum) and the implied total in AUD. Cite at least 2 distinct sources.`);
  } else {
    lines.push(`Use web_search to look up current professional-fee benchmarks for this project type expressed as % of construction contract value. Provide a row per discipline (architect, interior designer, structural, civil, MEPH, façade, geotech, acoustic, fire, wind, QS, building surveyor, town planner, ESD, project manager, superintendent, vertical transport, traffic, DDA), each with low and high % bounds. If contract value is provided, also compute the dollar bounds. Cite at least 2 distinct sources.`);
  }
  lines.push(``);
  lines.push(`Return ONLY the JSON. No prose outside JSON.`);
  return lines.join('\n');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(503).json({
      error: 'AI research is not configured on this deployment. Set ANTHROPIC_API_KEY in the server environment to enable live benchmark research.',
    });
  }

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

  const client = new Anthropic({ apiKey });
  const model  = 'claude-opus-4-7';
  const schema = body.mode === 'construction' ? RESPONSE_SCHEMA_CONSTRUCTION : RESPONSE_SCHEMA_PROFESSIONAL;

  try {
    const stream = client.messages.stream({
      model,
      max_tokens: 64000,
      thinking: { type: 'adaptive' },
      output_config: {
        effort: 'high',
        format: { type: 'json_schema', schema },
      },
      tools: [{ type: 'web_search_20260209', name: 'web_search' }],
      system: [
        {
          type: 'text',
          text: SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: buildUserPrompt(body) }],
    });

    const finalMessage = await stream.finalMessage();

    let parsed: ResearchResult | null = null;
    for (const block of finalMessage.content) {
      if (block.type === 'text') {
        try {
          parsed = JSON.parse(block.text) as ResearchResult;
          break;
        } catch {
          // fall through and try the next text block
        }
      }
    }

    if (!parsed) {
      return res.status(502).json({
        error: 'AI response did not contain valid JSON.',
        raw: finalMessage.content,
      });
    }

    parsed.model = model;
    parsed.timestamp = new Date().toISOString();

    return res.status(200).json(parsed);
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      return res.status(500).json({ error: 'ANTHROPIC_API_KEY is invalid.' });
    }
    if (err instanceof Anthropic.RateLimitError) {
      return res.status(429).json({ error: 'Anthropic API rate limit reached. Try again shortly.' });
    }
    if (err instanceof Anthropic.APIError) {
      return res.status(502).json({ error: `Anthropic API error ${err.status}: ${err.message}` });
    }
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return res.status(500).json({ error: `Live benchmark research failed: ${msg}` });
  }
}
