import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin } from '../_lib/auth';
import { getAdminSupabase, isSupabaseConfigured } from '../_lib/supabase';
import {
  AI_SETTINGS_SENTINEL,
  loadAISettings,
  saveAISettings,
  deleteAISettings,
  ALLOWED_MODELS,
  type AIModelId,
} from '../_lib/aiSettings';

/**
 * GET    /api/admin/ai-settings  → { hasKey, keyPreview, model, enabled, source }
 * POST   /api/admin/ai-settings  → body: { apiKey?, model?, enabled? }
 * DELETE /api/admin/ai-settings  → removes the stored key (env-var fallback may still apply)
 *
 * The API key is NEVER returned to the client. GET only returns a masked
 * preview (e.g. "sk-ant-***WXyZ") and a hasKey flag.
 *
 * `source` indicates where the active settings come from:
 *   "stored" — settings persisted in Supabase via this endpoint (admin-managed)
 *   "env"    — server env var ANTHROPIC_API_KEY (fallback)
 *   "none"   — no key available
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireAdmin(req, res)) return;

  if (!isSupabaseConfigured()) {
    return res.status(503).json({
      error: 'Supabase is not configured. AI settings cannot be persisted without VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. The fallback ANTHROPIC_API_KEY env var (if set) will still be used by /api/benchmarks/research.',
    });
  }

  const supabase = getAdminSupabase();

  if (req.method === 'GET') {
    const stored = await loadAISettings(supabase);
    const envKey = process.env.ANTHROPIC_API_KEY?.trim();
    const envModel = (process.env.ANTHROPIC_MODEL?.trim() as AIModelId | undefined) ?? null;

    const hasStored = Boolean(stored?.apiKey);
    const hasEnv    = Boolean(envKey);
    const activeKey = stored?.apiKey ?? envKey ?? '';
    const source: 'stored' | 'env' | 'none' = hasStored ? 'stored' : (hasEnv ? 'env' : 'none');

    return res.status(200).json({
      hasKey: source !== 'none',
      keyPreview: activeKey ? maskKey(activeKey) : '',
      model: stored?.model ?? envModel ?? 'claude-opus-4-7',
      enabled: stored?.enabled ?? true,
      source,
      hasEnvFallback: hasEnv,
      hasStoredKey: hasStored,
      allowedModels: ALLOWED_MODELS,
    });
  }

  if (req.method === 'POST') {
    let body: { apiKey?: string; model?: string; enabled?: boolean };
    try {
      body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) ?? {};
    } catch {
      return res.status(400).json({ error: 'Invalid JSON body' });
    }

    // Validate model
    if (body.model !== undefined && !ALLOWED_MODELS.some(m => m.id === body.model)) {
      return res.status(400).json({
        error: `Invalid model. Allowed: ${ALLOWED_MODELS.map(m => m.id).join(', ')}`,
      });
    }

    // Validate apiKey shape (don't log the value)
    // Gemini API keys are alphanumeric strings (no specific prefix required)
    if (body.apiKey !== undefined && body.apiKey !== '' && body.apiKey.length < 20) {
      return res.status(400).json({
        error: 'API key appears too short. Get a free Gemini API key from https://aistudio.google.com/apikey',
      });
    }

    const existing = await loadAISettings(supabase);
    const next = {
      apiKey:  body.apiKey ?? existing?.apiKey ?? '',
      model:   (body.model as AIModelId) ?? existing?.model ?? 'gemini-2-0-flash',
      enabled: body.enabled ?? existing?.enabled ?? true,
    };

    await saveAISettings(supabase, next);

    return res.status(200).json({
      ok: true,
      hasKey: Boolean(next.apiKey),
      keyPreview: next.apiKey ? maskKey(next.apiKey) : '',
      model: next.model,
      enabled: next.enabled,
    });
  }

  if (req.method === 'DELETE') {
    await deleteAISettings(supabase);
    return res.status(200).json({ ok: true, message: 'Stored AI key removed.' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

/** Mask a key like "sk-ant-abc...xyz1234" → "sk-ant-***1234" */
function maskKey(key: string): string {
  if (key.length <= 11) return 'sk-ant-***';
  return `${key.slice(0, 7)}***${key.slice(-4)}`;
}

export { AI_SETTINGS_SENTINEL };
