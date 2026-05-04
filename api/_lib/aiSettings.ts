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
  | 'claude-opus-4-7'
  | 'claude-opus-4-6'
  | 'claude-sonnet-4-6'
  | 'claude-haiku-4-5';

export interface AIModelOption {
  id: AIModelId;
  label: string;
  tier: 'opus' | 'sonnet' | 'haiku';
  contextWindow: string;
  inputPricePerMillion: number;
  outputPricePerMillion: number;
  recommendedFor: string;
}

/** Models the admin can pick from. Pricing in USD per million tokens. */
export const ALLOWED_MODELS: AIModelOption[] = [
  {
    id: 'claude-opus-4-7',
    label: 'Claude Opus 4.7 — most capable',
    tier: 'opus',
    contextWindow: '1M',
    inputPricePerMillion: 5,
    outputPricePerMillion: 25,
    recommendedFor: 'Highest quality research, deep reasoning. Default.',
  },
  {
    id: 'claude-opus-4-6',
    label: 'Claude Opus 4.6 — previous Opus',
    tier: 'opus',
    contextWindow: '1M',
    inputPricePerMillion: 5,
    outputPricePerMillion: 25,
    recommendedFor: 'Same price as 4.7; slightly less capable.',
  },
  {
    id: 'claude-sonnet-4-6',
    label: 'Claude Sonnet 4.6 — balanced',
    tier: 'sonnet',
    contextWindow: '1M',
    inputPricePerMillion: 3,
    outputPricePerMillion: 15,
    recommendedFor: 'Best speed/cost balance for most benchmark lookups.',
  },
  {
    id: 'claude-haiku-4-5',
    label: 'Claude Haiku 4.5 — fastest, cheapest',
    tier: 'haiku',
    contextWindow: '200K',
    inputPricePerMillion: 1,
    outputPricePerMillion: 5,
    recommendedFor: 'Lowest cost; quality lower than Sonnet/Opus.',
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
    model: (ai.model as AIModelId) ?? 'claude-opus-4-7',
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
  const envKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (envKey) {
    const envModel = process.env.ANTHROPIC_MODEL?.trim() as AIModelId | undefined;
    return {
      apiKey: envKey,
      model: ALLOWED_MODELS.some(m => m.id === envModel) ? (envModel as AIModelId) : 'claude-opus-4-7',
      source: 'env',
    };
  }
  return null;
}
