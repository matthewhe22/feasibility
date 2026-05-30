import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * AI settings storage helpers.
 *
 * Settings live in a single sentinel row (`__ai_settings__`) in the `projects`
 * table — same pattern as branding / Cotality. The settings JSON is stored in
 * the row's `admin` JSONB column under `aiSettings`.
 *
 * Keys are stored PER PROVIDER so the user can keep a Gemini, DeepSeek and
 * OpenRouter key on file simultaneously and switch the active provider without
 * re-entering anything. Plaintext keys are only ever read on the server; the
 * admin endpoint returns masked previews only.
 *
 * Back-compat: the previous shape stored a single { apiKey, model, enabled }.
 * loadAISettings() normalises that into the new per-provider `keys` map.
 */

export const AI_SETTINGS_SENTINEL = '__ai_settings__';

export type AIProvider = 'gemini' | 'deepseek' | 'openrouter';

export type AIModelId =
  // Google Gemini
  | 'gemini-2-0-flash'
  | 'gemini-1-5-pro'
  | 'gemini-1-5-flash'
  // DeepSeek V4 (current, released 2026-04-24)
  | 'deepseek-v4-pro'
  | 'deepseek-v4-flash'
  // DeepSeek legacy (deprecated — retiring 2026-07-24)
  | 'deepseek-chat'
  | 'deepseek-reasoner';

/** Map internal Gemini model IDs (dash) to the API names (dot). */
export function toGeminiApiModel(id: string): string {
  switch (id) {
    case 'gemini-2-0-flash': return 'gemini-2.0-flash';
    case 'gemini-1-5-pro':   return 'gemini-1.5-pro';
    case 'gemini-1-5-flash': return 'gemini-1.5-flash';
    default: return id;
  }
}

/** DeepSeek + OpenRouter expect their model IDs verbatim. */
export function toDeepSeekApiModel(id: string): string { return id; }
export function toOpenRouterApiModel(id: string): string { return id; }

/** Derive the provider for a STATIC (gemini/deepseek) model id. */
export function getProvider(id: string): AIProvider {
  if (id.startsWith('gemini-')) return 'gemini';
  if (id.startsWith('deepseek-')) return 'deepseek';
  return 'gemini';
}

export interface AIModelOption {
  id: string;
  label: string;
  provider: AIProvider;
  tier: 'flash' | 'pro' | 'chat' | 'reasoner' | 'free' | 'paid';
  contextWindow: string;
  inputPricePerMillion: number;
  outputPricePerMillion: number;
  supportsWebSearch: boolean;
  recommendedFor: string;
}

/** Static models the admin can pick from (Gemini + DeepSeek). OpenRouter models
 *  are dynamic and fetched/cached separately (see OpenRouterModel). */
export const ALLOWED_MODELS: AIModelOption[] = [
  {
    id: 'gemini-2-0-flash',
    label: 'Gemini 2.0 Flash — recommended (free tier)',
    provider: 'gemini', tier: 'flash', contextWindow: '1M',
    inputPricePerMillion: 0, outputPricePerMillion: 0, supportsWebSearch: true,
    recommendedFor: 'Fastest, free tier. Live web search via Google Search grounding.',
  },
  {
    id: 'gemini-1-5-pro',
    label: 'Gemini 1.5 Pro — most capable Gemini',
    provider: 'gemini', tier: 'pro', contextWindow: '2M',
    inputPricePerMillion: 1.25, outputPricePerMillion: 5, supportsWebSearch: true,
    recommendedFor: 'Highest quality reasoning (paid tier).',
  },
  {
    id: 'gemini-1-5-flash',
    label: 'Gemini 1.5 Flash — balanced',
    provider: 'gemini', tier: 'flash', contextWindow: '1M',
    inputPricePerMillion: 0.075, outputPricePerMillion: 0.3, supportsWebSearch: true,
    recommendedFor: 'Fast and cheaper alternative to Pro (paid tier).',
  },
  {
    id: 'deepseek-v4-flash',
    label: 'DeepSeek V4 Flash — cheapest, fast (recommended)',
    provider: 'deepseek', tier: 'flash', contextWindow: '1M',
    inputPricePerMillion: 0.14, outputPricePerMillion: 0.28, supportsWebSearch: false,
    recommendedFor: 'Successor to deepseek-chat. Cheapest DeepSeek. No live web search.',
  },
  {
    id: 'deepseek-v4-pro',
    label: 'DeepSeek V4 Pro — top quality (paid)',
    provider: 'deepseek', tier: 'pro', contextWindow: '1M',
    inputPricePerMillion: 1.74, outputPricePerMillion: 3.48, supportsWebSearch: false,
    recommendedFor: "DeepSeek's flagship. No live web search.",
  },
  {
    id: 'deepseek-chat',
    label: 'DeepSeek Chat (V3) — DEPRECATED, retires 2026-07-24',
    provider: 'deepseek', tier: 'chat', contextWindow: '64K',
    inputPricePerMillion: 0.27, outputPricePerMillion: 1.10, supportsWebSearch: false,
    recommendedFor: 'Legacy V3 — use deepseek-v4-flash instead.',
  },
  {
    id: 'deepseek-reasoner',
    label: 'DeepSeek Reasoner (R1) — DEPRECATED, retires 2026-07-24',
    provider: 'deepseek', tier: 'reasoner', contextWindow: '64K',
    inputPricePerMillion: 0.55, outputPricePerMillion: 2.19, supportsWebSearch: false,
    recommendedFor: 'Legacy R1 — use deepseek-v4-flash / v4-pro instead.',
  },
];

/** OpenRouter model entry (dynamic — refreshed via the "Update models" button). */
export interface OpenRouterModel {
  id: string;            // e.g. "meta-llama/llama-3.1-8b-instruct:free"
  label: string;         // human-readable name
  contextLength?: number;
  free: boolean;         // pricing prompt+completion == 0
}

export interface StoredAISettings {
  provider: AIProvider;
  model: string;
  enabled: boolean;
  /** When true (default), Gemini requests use Google Search grounding. Turn off
   *  to avoid the scarce free-tier grounding quota (no live web search). */
  useGrounding: boolean;
  /** When true (default), on a quota/rate-limit error the active provider fails
   *  over to the next configured provider. */
  autoFailover: boolean;
  /** Per-provider API keys (plaintext, server-only). */
  keys: Partial<Record<AIProvider, string>>;
  /** Cached OpenRouter free-model list (from the last "Update models"). */
  openrouterModels?: OpenRouterModel[];
  openrouterModelsUpdatedAt?: string;
}

const DEFAULT_MODEL_FOR: Record<AIProvider, string> = {
  gemini: 'gemini-2-0-flash',
  deepseek: 'deepseek-v4-flash',
  openrouter: 'openrouter/auto',
};

/** Default model id for a provider (used when none is selected). */
export function defaultModelFor(provider: AIProvider): string {
  return DEFAULT_MODEL_FOR[provider];
}

/** Normalise a raw persisted object (old single-key OR new multi-key) → StoredAISettings. */
function normalizeStored(raw: unknown): StoredAISettings | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;

  // Per-provider keys (new shape).
  const keys: Partial<Record<AIProvider, string>> = {};
  const rawKeys = r.keys as Record<string, unknown> | undefined;
  if (rawKeys && typeof rawKeys === 'object') {
    for (const p of ['gemini', 'deepseek', 'openrouter'] as AIProvider[]) {
      if (typeof rawKeys[p] === 'string' && rawKeys[p]) keys[p] = rawKeys[p] as string;
    }
  }

  // Back-compat: old single `apiKey` belonged to the (then) model's provider.
  const legacyKey = typeof r.apiKey === 'string' ? r.apiKey : '';
  const model = typeof r.model === 'string' && r.model ? r.model : '';
  if (legacyKey && Object.keys(keys).length === 0) {
    const legacyProvider = model ? getProvider(model) : 'gemini';
    keys[legacyProvider] = legacyKey;
  }

  // Active provider: explicit if present, else derive from model, else first key.
  let provider = r.provider as AIProvider | undefined;
  const valid = (p: unknown): p is AIProvider => p === 'gemini' || p === 'deepseek' || p === 'openrouter';
  if (!valid(provider)) {
    provider = model && (model.startsWith('gemini-') || model.startsWith('deepseek-'))
      ? getProvider(model)
      : (Object.keys(keys)[0] as AIProvider | undefined) ?? 'gemini';
  }

  const orModels = Array.isArray(r.openrouterModels)
    ? (r.openrouterModels as OpenRouterModel[]).filter(m => m && typeof m.id === 'string')
    : undefined;

  return {
    provider,
    model: model || DEFAULT_MODEL_FOR[provider],
    enabled: r.enabled !== false,
    useGrounding: r.useGrounding !== false,   // default ON
    autoFailover: r.autoFailover !== false,   // default ON
    keys,
    openrouterModels: orModels,
    openrouterModelsUpdatedAt: typeof r.openrouterModelsUpdatedAt === 'string' ? r.openrouterModelsUpdatedAt : undefined,
  };
}

export async function loadAISettings(supabase: SupabaseClient): Promise<StoredAISettings | null> {
  const { data, error } = await supabase
    .from('projects')
    .select('admin')
    .eq('name', AI_SETTINGS_SENTINEL)
    .maybeSingle();
  if (error || !data) return null;
  const ai = (data as { admin?: { aiSettings?: unknown } }).admin?.aiSettings;
  return normalizeStored(ai);
}

export async function saveAISettings(supabase: SupabaseClient, settings: StoredAISettings): Promise<void> {
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

export async function deleteAISettings(supabase: SupabaseClient): Promise<void> {
  await supabase.from('projects').delete().eq('name', AI_SETTINGS_SENTINEL);
}

const ENV_KEY: Record<AIProvider, string> = {
  gemini: 'GEMINI_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
};
const ENV_MODEL: Record<AIProvider, string> = {
  gemini: 'GEMINI_MODEL',
  deepseek: 'DEEPSEEK_MODEL',
  openrouter: 'OPENROUTER_MODEL',
};

function envKey(p: AIProvider): string | undefined { return process.env[ENV_KEY[p]]?.trim() || undefined; }

/**
 * Resolve the active key + model + provider.
 *   1. Stored settings: use the selected provider's stored key (or its env key).
 *   2. If the selected provider has no key, fall back to any provider that does
 *      (stored first, then env), using that provider's default/selected model.
 */
export interface ResolvedProvider {
  apiKey: string;
  model: string;
  provider: AIProvider;
  source: 'stored' | 'env';
}

export interface ResolvedChain {
  /** Usable providers in priority order: active provider first, then others
   *  that have a key (for auto-failover). At least one entry. */
  chain: ResolvedProvider[];
  useGrounding: boolean;
  autoFailover: boolean;
}

/**
 * Build the ordered list of usable providers. The active (stored-selected)
 * provider comes first with its selected model; remaining providers that have a
 * key follow with their default model, so the caller can fail over on quota.
 */
export async function resolveProviderChain(supabase: SupabaseClient | null): Promise<ResolvedChain | null> {
  const stored = supabase ? await loadAISettings(supabase) : null;
  const order: AIProvider[] = ['gemini', 'deepseek', 'openrouter'];
  const chain: ResolvedProvider[] = [];
  const seen = new Set<AIProvider>();

  const keyFor = (p: AIProvider): { key: string; source: 'stored' | 'env' } | null => {
    const sk = stored?.keys?.[p];
    if (sk) return { key: sk, source: 'stored' };
    const ek = envKey(p);
    if (ek) return { key: ek, source: 'env' };
    return null;
  };

  if (stored && stored.enabled) {
    const p = stored.provider;
    const k = keyFor(p);
    if (k) {
      chain.push({ apiKey: k.key, model: stored.model || DEFAULT_MODEL_FOR[p], provider: p, source: k.source });
      seen.add(p);
    }
  }
  // Append remaining providers that have a key (failover candidates).
  for (const p of order) {
    if (seen.has(p)) continue;
    const k = keyFor(p);
    if (k) {
      const m = (stored?.provider === p && stored.model) ? stored.model
        : (process.env[ENV_MODEL[p]]?.trim() || DEFAULT_MODEL_FOR[p]);
      chain.push({ apiKey: k.key, model: m, provider: p, source: k.source });
      seen.add(p);
    }
  }

  if (chain.length === 0) return null;
  return {
    chain,
    useGrounding: stored?.useGrounding !== false,
    autoFailover: stored?.autoFailover !== false,
  };
}

/**
 * Resolve the single active key + model + provider (back-compat thin wrapper
 * over resolveProviderChain — returns the first/active entry).
 */
export async function resolveActiveSettings(
  supabase: SupabaseClient | null,
): Promise<ResolvedProvider | null> {
  const r = await resolveProviderChain(supabase);
  return r ? r.chain[0] : null;
}

/* ── OpenRouter free-model discovery ───────────────────────────────────────── */

interface OpenRouterApiModel {
  id: string;
  name?: string;
  context_length?: number;
  pricing?: { prompt?: string; completion?: string };
}

/** Parse the OpenRouter /models payload into our free-model list. */
export function parseOpenRouterFreeModels(payload: unknown): OpenRouterModel[] {
  const data = (payload as { data?: OpenRouterApiModel[] })?.data;
  if (!Array.isArray(data)) return [];
  const isFree = (m: OpenRouterApiModel) => {
    const p = parseFloat(m.pricing?.prompt ?? '0');
    const c = parseFloat(m.pricing?.completion ?? '0');
    return (Number.isFinite(p) ? p : 1) === 0 && (Number.isFinite(c) ? c : 1) === 0;
  };
  return data
    .filter(m => m && typeof m.id === 'string' && (isFree(m) || m.id.endsWith(':free')))
    .map(m => ({
      id: m.id,
      label: m.name || m.id,
      contextLength: typeof m.context_length === 'number' ? m.context_length : undefined,
      free: true,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Fetch + filter OpenRouter's free models. Optional key (the list is public). */
export async function fetchOpenRouterFreeModels(apiKey?: string): Promise<OpenRouterModel[]> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const r = await fetch('https://openrouter.ai/api/v1/models', { headers });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`OpenRouter /models failed (HTTP ${r.status}): ${t.slice(0, 200)}`);
  }
  return parseOpenRouterFreeModels(await r.json());
}

/** Mask a key like "sk-or-v1-abc...wxyz" → "sk-or-***wxyz". */
export function maskKey(key: string): string {
  if (key.length <= 11) return '***';
  return `${key.slice(0, 7)}***${key.slice(-4)}`;
}
