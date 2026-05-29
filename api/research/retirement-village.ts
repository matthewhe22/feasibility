import type { VercelRequest, VercelResponse } from '@vercel/node';
import { setCors } from '../_lib/auth';
import { getAdminSupabase, isSupabaseConfigured } from '../_lib/supabase';
import { resolveActiveSettings } from '../_lib/aiSettings';
import { resolveCotalitySettings, fetchCotalityContext } from '../_lib/cotality';
import { runAIResearch, mergeSources, AIResearchError, type AIResearchSource } from '../_lib/aiClient';

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

You MUST:
  1. Use your web search capability to find CURRENT data — prefer village operator
     websites, realestate.com.au / Domain retirement-living listings, downsizing.com.au,
     villages.com.au, and CoreLogic / Cotality where available.
  2. For each unit return: village name, price, whether it is a SOLD price or a current
     LISTING price, the date (sold date or listing date, ISO yyyy-mm-dd or yyyy-mm if only
     month known), bedrooms, bathrooms, study (true/false), unit type, and address/suburb
     where available. Use null for any field you cannot substantiate — never invent.
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
    `      "unitType": "<e.g. ILU villa / apartment / serviced apartment | null>", "note": "<tenure/DMF note | null>" }`,
    `  ],`,
    `  "summary": "2-4 sentences incl. how many villages/units found, date range, and source names",`,
    `  "sources": [ { "title": "...", "url": "...", "snippet": "..." } ]`,
    `}`,
  ].join('\n');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabase = isSupabaseConfigured() ? getAdminSupabase() : null;
  const active = await resolveActiveSettings(supabase);
  if (!active) {
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

  // Optional Cotality grounding (best-effort; needs a suburb/postcode key).
  let cotalityNote: { used: boolean; url?: string; reason?: string } = { used: false };
  try {
    const cotality = await resolveCotalitySettings(supabase);
    if (cotality) {
      const ctx = await fetchCotalityContext(cotality, {
        suburb: body.suburb,
        state: body.state,
        postcode: body.postcode,
      });
      if (ctx) {
        userPrompt +=
          `\n\n=== AUTHORITATIVE COTALITY DATA (treat as PRIMARY source; cite as "Cotality") ===\n` +
          `Source: ${ctx.url}\n${ctx.data}\n=== END COTALITY DATA ===`;
        cotalityNote = { used: true, url: ctx.url };
      } else if (cotality.propertyDataPath) {
        cotalityNote = { used: false, reason: 'Cotality configured but returned no data for the supplied suburb/postcode — used web research only.' };
      }
    }
  } catch { /* never block AI research on Cotality */ }

  try {
    const result = await runAIResearch({
      provider: active.provider,
      model: active.model,
      apiKey: active.apiKey,
      systemPrompt,
      userPrompt,
    });

    const declared = (result.json.sources as AIResearchSource[] | undefined);
    const payload = {
      ...result.json,
      sources: mergeSources(result.groundingSources, declared),
      model: active.model,
      provider: result.provider,
      groundingUsed: result.groundingUsed,
      configSource: active.source,
      cotality: cotalityNote,
      timestamp: new Date().toISOString(),
    };
    return res.status(200).json(payload);
  } catch (e) {
    const status = e instanceof AIResearchError ? e.status : 500;
    return res.status(status).json({ error: e instanceof Error ? e.message : 'Research failed.' });
  }
}
