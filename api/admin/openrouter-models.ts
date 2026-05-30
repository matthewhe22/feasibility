import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin } from '../_lib/auth';
import { getAdminSupabase, isSupabaseConfigured } from '../_lib/supabase';
import { loadAISettings, saveAISettings, fetchOpenRouterFreeModels } from '../_lib/aiSettings';

/**
 * POST /api/admin/openrouter-models
 *
 * Refresh the cached OpenRouter FREE-model list. Fetches OpenRouter's public
 * /models catalogue, filters to free models (prompt+completion price == 0 or
 * an ":free" id), persists the list into the AI-settings sentinel, and returns
 * it so the admin UI can populate the OpenRouter model dropdown.
 *
 * Uses the stored OpenRouter key (or OPENROUTER_API_KEY) as a Bearer token if
 * present, but the catalogue is public so a key is not required.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireAdmin(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabase = isSupabaseConfigured() ? getAdminSupabase() : null;

  const stored = supabase ? await loadAISettings(supabase) : null;
  const apiKey = stored?.keys?.openrouter || process.env.OPENROUTER_API_KEY?.trim() || undefined;

  let models;
  try {
    models = await fetchOpenRouterFreeModels(apiKey);
  } catch (e) {
    return res.status(502).json({ error: e instanceof Error ? e.message : 'Failed to fetch OpenRouter models.' });
  }

  const updatedAt = new Date().toISOString();

  // Persist the cache when we have a place to store it.
  if (supabase) {
    const base = stored ?? { provider: 'openrouter' as const, model: 'openrouter/auto', enabled: true, keys: {} };
    try {
      await saveAISettings(supabase, { ...base, openrouterModels: models, openrouterModelsUpdatedAt: updatedAt });
    } catch { /* non-fatal — still return the freshly fetched list */ }
  }

  return res.status(200).json({ ok: true, count: models.length, models, updatedAt });
}
