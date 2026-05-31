import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin } from '../_lib/auth';
import { getAdminSupabase, isSupabaseConfigured } from '../_lib/supabase';
import {
  AI_SETTINGS_SENTINEL,
  loadAISettings,
  saveAISettings,
  deleteAISettings,
  ALLOWED_MODELS,
  maskKey,
  defaultModelFor,
  type AIProvider,
  type StoredAISettings,
} from '../_lib/aiSettings';
import { pingAIProvider, AIResearchError } from '../_lib/aiClient';

/**
 * GET    /api/admin/ai-settings  → per-provider key status + active provider/model + catalogs
 * POST   /api/admin/ai-settings  → body: { provider?, model?, enabled?, keys?: {gemini?,deepseek?,openrouter?} }
 * DELETE /api/admin/ai-settings  → body { provider? }: remove one provider key, or all stored settings
 *
 * Keys are stored per provider and NEVER returned to the client (masked preview only).
 */
const PROVIDERS: AIProvider[] = ['gemini', 'deepseek', 'openrouter', 'nvidia'];
const ENV_KEY: Record<AIProvider, string> = {
  gemini: 'GEMINI_API_KEY', deepseek: 'DEEPSEEK_API_KEY', openrouter: 'OPENROUTER_API_KEY', nvidia: 'NVIDIA_API_KEY',
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireAdmin(req, res)) return;

  if (!isSupabaseConfigured()) {
    return res.status(503).json({
      error: 'Supabase is not configured. AI settings cannot be persisted without VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. Provider env-var keys (if set) will still be used by /api/benchmarks/research.',
    });
  }
  const supabase = getAdminSupabase();

  if (req.method === 'GET') {
    const stored = await loadAISettings(supabase);

    const providers = PROVIDERS.map(p => {
      const storedKey = stored?.keys?.[p];
      const envKey = process.env[ENV_KEY[p]]?.trim();
      const activeKey = storedKey || envKey || '';
      const source: 'stored' | 'env' | 'none' = storedKey ? 'stored' : envKey ? 'env' : 'none';
      return { provider: p, hasKey: Boolean(activeKey), hasStoredKey: Boolean(storedKey), hasEnvFallback: Boolean(envKey), source, keyPreview: activeKey ? maskKey(activeKey) : '' };
    });

    const activeProvider = stored?.provider ?? 'gemini';
    const activeHasKey = providers.find(p => p.provider === activeProvider)?.hasKey ?? false;
    const anyKey = providers.some(p => p.hasKey);

    return res.status(200).json({
      provider: activeProvider,
      model: stored?.model ?? 'gemini-2-0-flash',
      enabled: stored?.enabled ?? true,
      useGrounding: stored?.useGrounding ?? true,
      autoFailover: stored?.autoFailover ?? true,
      hasKey: activeHasKey,
      anyKey,
      providers,
      allowedModels: ALLOWED_MODELS,
      openrouterModels: stored?.openrouterModels ?? [],
      openrouterModelsUpdatedAt: stored?.openrouterModelsUpdatedAt ?? null,
      nvidiaModels: stored?.nvidiaModels ?? [],
      nvidiaModelsUpdatedAt: stored?.nvidiaModelsUpdatedAt ?? null,
    });
  }

  if (req.method === 'POST') {
    let body: {
      provider?: string; model?: string; enabled?: boolean;
      useGrounding?: boolean; autoFailover?: boolean;
      keys?: Partial<Record<AIProvider, string>>;
      test?: boolean; key?: string;
    };
    try {
      body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) ?? {};
    } catch {
      return res.status(400).json({ error: 'Invalid JSON body' });
    }

    // Per-provider connection test — verifies a key/model independently of the
    // active settings, using a draft (unsaved) key if supplied, else the
    // provider's stored or env key. Does not persist anything.
    if (body.test) {
      const p = (body.provider as AIProvider) ?? 'gemini';
      if (!PROVIDERS.includes(p)) {
        return res.status(400).json({ error: `Invalid provider. Allowed: ${PROVIDERS.join(', ')}` });
      }
      const existing = await loadAISettings(supabase);
      const draft = typeof body.key === 'string' && body.key.trim() ? body.key.trim() : undefined;
      const key = draft || existing?.keys?.[p] || process.env[ENV_KEY[p]]?.trim();
      if (!key) {
        return res.status(400).json({ error: `No ${p} key to test. Enter one above first.` });
      }
      const model = (body.model && body.model.trim()) || defaultModelFor(p);
      try {
        await pingAIProvider({ provider: p, model, apiKey: key });
        return res.status(200).json({ ok: true, message: `${p} key works (model: ${model}).` });
      } catch (e) {
        const status = e instanceof AIResearchError && e.status ? e.status : 502;
        return res.status(status).json({ error: e instanceof Error ? e.message : 'Test failed.' });
      }
    }

    if (body.provider !== undefined && !PROVIDERS.includes(body.provider as AIProvider)) {
      return res.status(400).json({ error: `Invalid provider. Allowed: ${PROVIDERS.join(', ')}` });
    }
    // Validate model only for static providers; OpenRouter models are dynamic.
    if (body.model !== undefined && (body.provider === 'gemini' || body.provider === 'deepseek')) {
      if (!ALLOWED_MODELS.some(m => m.id === body.model && m.provider === body.provider)) {
        return res.status(400).json({ error: `Invalid ${body.provider} model "${body.model}".` });
      }
    }
    // Validate any provided key lengths (don't log values).
    for (const p of PROVIDERS) {
      const k = body.keys?.[p];
      if (k !== undefined && k !== '' && k.length < 20) {
        return res.status(400).json({ error: `${p} API key appears too short.` });
      }
    }

    const existing = await loadAISettings(supabase);
    const keys: Partial<Record<AIProvider, string>> = { ...(existing?.keys ?? {}) };
    for (const p of PROVIDERS) {
      const k = body.keys?.[p];
      if (typeof k === 'string' && k.trim()) keys[p] = k.trim(); // blank = keep current
    }

    const next: StoredAISettings = {
      provider: (body.provider as AIProvider) ?? existing?.provider ?? 'gemini',
      model: body.model ?? existing?.model ?? 'gemini-2-0-flash',
      enabled: body.enabled ?? existing?.enabled ?? true,
      useGrounding: body.useGrounding ?? existing?.useGrounding ?? true,
      autoFailover: body.autoFailover ?? existing?.autoFailover ?? true,
      keys,
      openrouterModels: existing?.openrouterModels,
      openrouterModelsUpdatedAt: existing?.openrouterModelsUpdatedAt,
      nvidiaModels: existing?.nvidiaModels,
      nvidiaModelsUpdatedAt: existing?.nvidiaModelsUpdatedAt,
    };
    await saveAISettings(supabase, next);

    return res.status(200).json({
      ok: true,
      provider: next.provider,
      model: next.model,
      enabled: next.enabled,
      useGrounding: next.useGrounding,
      autoFailover: next.autoFailover,
      providers: PROVIDERS.map(p => ({ provider: p, hasStoredKey: Boolean(keys[p]), keyPreview: keys[p] ? maskKey(keys[p]!) : '' })),
    });
  }

  if (req.method === 'DELETE') {
    let provider: string | undefined;
    try {
      const body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) ?? {};
      provider = body.provider;
    } catch { /* no body → delete all */ }

    if (provider && PROVIDERS.includes(provider as AIProvider)) {
      const existing = await loadAISettings(supabase);
      if (existing) {
        const keys = { ...existing.keys };
        delete keys[provider as AIProvider];
        await saveAISettings(supabase, { ...existing, keys });
      }
      return res.status(200).json({ ok: true, message: `${provider} key removed.` });
    }

    await deleteAISettings(supabase);
    return res.status(200).json({ ok: true, message: 'All stored AI settings removed.' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export { AI_SETTINGS_SENTINEL };
