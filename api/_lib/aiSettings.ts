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

export type AIProvider = 'gemini' | 'deepseek';

export type AIModelId =
  // Google Gemini
  | 'gemini-2-0-flash'
  | 'gemini-1-5-pro'
  | 'gemini-1-5-flash'
  // DeepSeek
  | 'deepseek-chat'
  | 'deepseek-reasoner';

/**
 * Map our internal model IDs (dash-separated, TS-friendly) to the actual
 * Gemini API model names (dot-separated). Google's API expects e.g.
 * "gemini-2.0-flash", not "gemini-2-0-flash" — passing the wrong one yields
 * a 404 NotFound from the SDK.
 */
export function toGeminiApiModel(id: AIModelId): string {
  switch (id) {
    case 'gemini-2-0-flash': return 'gemini-2.0-flash';
    case 'gemini-1-5-pro':   return 'gemini-1.5-pro';
    case 'gemini-1-5-flash': return 'gemini-1.5-flash';
    default: return id;
  }
}

/** DeepSeek API expects model names verbatim. */
export function toDeepSeekApiModel(id: AIModelId): string {
  return id; // 'deepseek-chat' | 'deepseek-reasoner'
}

/** Derive which provider a given model belongs to. */
export function getProvider(id: AIModelId): AIProvider {
  if (id.startsWith('gemini-')) return 'gemini';
  if (id.startsWith('deepseek-')) return 'deepseek';
  // Fallback — shouldn't happen with the union, but keeps TS happy.
  return 'gemini';
}

export interface AIModelOption {
  id: AIModelId;
  label: string;
  provider: AIProvider;
  tier: 'flash' | 'pro' | 'chat' | 'reasoner';
  contextWindow: string;
  inputPricePerMillion: number;
  outputPricePerMillion: number;
  /** True if the provider supports built-in live web search grounding. */
  supportsWebSearch: boolean;
  recommendedFor: string;
}

/** Models the admin can pick from. Pricing in USD per million tokens. */
export const ALLOWED_MODELS: AIModelOption[] = [
  // ── Google Gemini (free tier: 15 req/min, 1500 req/day on 2.0 Flash) ──
  {
    id: 'gemini-2-0-flash',
    label: 'Gemini 2.0 Flash — recommended (free tier)',
    provider: 'gemini',
    tier: 'flash',
    contextWindow: '1M',
    inputPricePerMillion: 0,
    outputPricePerMillion: 0,
    supportsWebSearch: true,
    recommendedFor: 'Fastest, free tier. Best for cost benchmarks. Live web search via Google Search grounding.',
  },
  {
    id: 'gemini-1-5-pro',
    label: 'Gemini 1.5 Pro — most capable Gemini',
    provider: 'gemini',
    tier: 'pro',
    contextWindow: '2M',
    inputPricePerMillion: 1.25,
    outputPricePerMillion: 5,
    supportsWebSearch: true,
    recommendedFor: 'Highest quality reasoning (paid tier).',
  },
  {
    id: 'gemini-1-5-flash',
    label: 'Gemini 1.5 Flash — balanced',
    provider: 'gemini',
    tier: 'flash',
    contextWindow: '1M',
    inputPricePerMillion: 0.075,
    outputPricePerMillion: 0.3,
    supportsWebSearch: true,
    recommendedFor: 'Fast and cheaper alternative to Pro (paid tier).',
  },
  // ── DeepSeek (very cheap; no built-in web search) ─────────────────────
  {
    id: 'deepseek-chat',
    label: 'DeepSeek Chat (V3) — cheapest',
    provider: 'deepseek',
    tier: 'chat',
    contextWindow: '64K',
    inputPricePerMillion: 0.27,
    outputPricePerMillion: 1.10,
    supportsWebSearch: false,
    recommendedFor: 'Very low cost (~$1/M tokens). General-purpose. No live web search — answers from training data.',
  },
  {
    id: 'deepseek-reasoner',
    label: 'DeepSeek Reasoner (R1) — chain-of-thought',
    provider: 'deepseek',
    tier: 'reasoner',
    contextWindow: '64K',
    inputPricePerMillion: 0.55,
    outputPricePerMillion: 2.19,
    supportsWebSearch: false,
    recommendedFor: 'Best reasoning quality from DeepSeek; slower. No live web search.',
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
 * Resolve the active key + model + provider with this precedence:
 *   1. Stored settings (admin UI)
 *   2. Env vars: GEMINI_API_KEY (+ GEMINI_MODEL) or DEEPSEEK_API_KEY (+ DEEPSEEK_MODEL)
 *      — Gemini takes precedence if both are set.
 *
 * Returns `null` if no key is available anywhere.
 */
export async function resolveActiveSettings(
  supabase: SupabaseClient | null,
): Promise<{
  apiKey: string;
  model: AIModelId;
  provider: AIProvider;
  source: 'stored' | 'env';
} | null> {
  if (supabase) {
    const stored = await loadAISettings(supabase);
    if (stored && stored.apiKey && stored.enabled) {
      return {
        apiKey: stored.apiKey,
        model: stored.model,
        provider: getProvider(stored.model),
        source: 'stored',
      };
    }
  }
  // Env-var fallback — try Gemini first, then DeepSeek.
  const geminiKey = process.env.GEMINI_API_KEY?.trim();
  if (geminiKey) {
    const envModel = process.env.GEMINI_MODEL?.trim() as AIModelId | undefined;
    const model = ALLOWED_MODELS.some(m => m.id === envModel && m.provider === 'gemini')
      ? (envModel as AIModelId)
      : 'gemini-2-0-flash';
    return { apiKey: geminiKey, model, provider: 'gemini', source: 'env' };
  }
  const deepseekKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (deepseekKey) {
    const envModel = process.env.DEEPSEEK_MODEL?.trim() as AIModelId | undefined;
    const model = ALLOWED_MODELS.some(m => m.id === envModel && m.provider === 'deepseek')
      ? (envModel as AIModelId)
      : 'deepseek-chat';
    return { apiKey: deepseekKey, model, provider: 'deepseek', source: 'env' };
  }
  return null;
}
