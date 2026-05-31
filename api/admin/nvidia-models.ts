import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin } from '../_lib/auth';
import { getAdminSupabase, isSupabaseConfigured } from '../_lib/supabase';
import { loadAISettings, saveAISettings, fetchNvidiaModels } from '../_lib/aiSettings';

/**
 * POST /api/admin/nvidia-models
 *
 * Refresh the cached NVIDIA model list. Fetches NVIDIA's hosted NIM catalogue
 * (integrate.api.nvidia.com/v1/models), persists it into the AI-settings
 * sentinel, and returns it so the admin UI can populate the NVIDIA model
 * dropdown.
 *
 * Unlike OpenRouter, NVIDIA's /models endpoint is authenticated, so a stored
 * NVIDIA key (or NVIDIA_API_KEY) is required.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireAdmin(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabase = isSupabaseConfigured() ? getAdminSupabase() : null;

  const stored = supabase ? await loadAISettings(supabase) : null;
  const apiKey = stored?.keys?.nvidia || process.env.NVIDIA_API_KEY?.trim();
  if (!apiKey) {
    return res.status(400).json({ error: 'No NVIDIA key configured. Save an NVIDIA API key first, then update the model list.' });
  }

  let models;
  try {
    models = await fetchNvidiaModels(apiKey);
  } catch (e) {
    return res.status(502).json({ error: e instanceof Error ? e.message : 'Failed to fetch NVIDIA models.' });
  }

  const updatedAt = new Date().toISOString();

  // Persist the cache when we have a place to store it.
  if (supabase) {
    const base = stored ?? { provider: 'nvidia' as const, model: 'meta/llama-3.1-8b-instruct', enabled: true, useGrounding: true, autoFailover: true, keys: {} };
    try {
      await saveAISettings(supabase, { ...base, nvidiaModels: models, nvidiaModelsUpdatedAt: updatedAt });
    } catch { /* non-fatal — still return the freshly fetched list */ }
  }

  return res.status(200).json({ ok: true, count: models.length, models, updatedAt });
}
