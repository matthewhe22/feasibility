import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * AI settings storage helpers.
 *
 * Settings live in a single sentinel row in the existing `projects` table —
 * the same pattern used for branding (`__global_branding__`) and the project
 * name list (`__global_project_list__`). The settings JSON is stored in the
 * row's `admin` JSONB column under the `aiSettings` key so it survives across
 * Vercel deployments and is shared across admin sessions.
 *
 * The plaintext API key is only ever read on the server; it is never returned
 * to the browser. The admin endpoint returns a masked preview only.
 */

export const AI_SETTINGS_SENTINEL = '__ai_settings__';

export type AIModelId =
  | 'gemini-2-0-flash'
  | 'gemini-1-5-pro'
  | 'gemini-1-5-flash';

export interface AIModelOption {
  id: AIModelId;
  label: string;
  tier: 'flash' | 'pro';
  contextWindow: string;
  inputPricePerMillion: number;
  outputPricePerMillion: number;
  recommendedFor: string;
}

/** Models the admin can pick from. Pricing in USD per million tokens (free tier: 60 req/min, 1500 req/day). */
export const ALLOWED_MODELS: AIModelOption[] = [
  {
    id: 'gemini-2-0-flash',
    label: 'Gemini 2.0 Flash — recommended (free tier)',
    tier: 'flash',
    contextWindow: '1M',
    inputPricePerMillion: 0,
    outputPricePerMillion: 0,
    recommendedFor: 'Fastest, free tier. Best for cost benchmarks. Built-in web search.',
  },
  {
    id: 'gemini-1-5-pro',
    label: 'Gemini 1.5 Pro — most capable',
    tier: 'pro',
    contextWindow: '2M',
    inputPricePerMillion: 1.25,
    outputPricePerMillion: 5,
    recommendedFor: 'Highest quality reasoning (paid tier).',
  },
  {
    id: 'gemini-1-5-flash',
    label: 'Gemini 1.5 Flash — balanced',
    tier: 'flash',
    contextWindow: '1M',
    inputPricePerMillion: 0.075,
    outputPricePerMillion: 0.3,
    recommendedFor: 'Fast and cheaper alternative to Pro (paid tier).',
  },
];

export interface StoredAISettings {
  apiKey: string;
  model: AIModelId;
  enabled: boolean;
}

/** Load the stored AI settings, or null if no sentinel row exists yet. */
export async function loadAISettings(
  supabase: SupabaseClient,
): Promise<StoredAISettings | null> {
  const { data, error } = await supabase
    .from('projects')
    .select('admin')
    .eq('name', AI_SETTINGS_SENTINEL)
    .maybeSingle();

  if (error || !data) return null;

  const adminCol = (data as { admin: Record<string, unknown> }).admin ?? {};
  const ai = (adminCol as { aiSettings?: Partial<StoredAISettings> }).aiSettings;
  if (!ai) return null;

  return {
    apiKey: typeof ai.apiKey === 'string' ? ai.apiKey : '',
    model: (ai.model as AIModelId) ?? 'gemini-2-0-flash',
    enabled: ai.enabled !== false,
  };
}

/** Persist (upsert) the AI settings sentinel row. */
export async function saveAISettings(
  supabase: SupabaseClient,
  settings: StoredAISettings,
): Promise<void> {
  const adminPayload = { aiSettings: settings };

  const { data: existing } = await supabase
    .from('projects')
    .select('id')
    .eq('name', AI_SETTINGS_SENTINEL)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from('projects')
      .update({ admin: adminPayload, updated_at: new Date().toISOString() })
      .eq('name', AI_SETTINGS_SENTINEL);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase
      .from('projects')
      .insert({
        name: AI_SETTINGS_SENTINEL,
        description: 'AI provider settings (admin-managed). Do not edit directly.',
        admin: adminPayload,
        inputs: {},
      });
    if (error) throw new Error(error.message);
  }
}

/** Remove the stored sentinel row. Env var fallback may still be active. */
export async function deleteAISettings(supabase: SupabaseClient): Promise<void> {
  await supabase.from('projects').delete().eq('name', AI_SETTINGS_SENTINEL);
}

/**
 * Resolve the active key + model with this precedence:
 *   1. Stored settings (admin UI)
 *   2. Env vars ANTHROPIC_API_KEY / ANTHROPIC_MODEL
 *
 * Returns `null` if no key is available anywhere.
 */
export async function resolveActiveSettings(
  supabase: SupabaseClient | null,
): Promise<{ apiKey: string; model: AIModelId; source: 'stored' | 'env' } | null> {
  if (supabase) {
    const stored = await loadAISettings(supabase);
    if (stored && stored.apiKey && stored.enabled) {
      return { apiKey: stored.apiKey, model: stored.model, source: 'stored' };
    }
  }
  const envKey = process.env.GEMINI_API_KEY?.trim();
  if (envKey) {
    const envModel = process.env.GEMINI_MODEL?.trim() as AIModelId | undefined;
    return {
      apiKey: envKey,
      model: ALLOWED_MODELS.some(m => m.id === envModel) ? (envModel as AIModelId) : 'gemini-2-0-flash',
      source: 'env',
    };
  }
  return null;
}
