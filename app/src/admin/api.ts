/**
 * Client-side helpers for talking to the /api/admin/* endpoints.
 * The JWT is stored in sessionStorage so it clears when the tab closes.
 */

const BASE = '/api/admin';
const TOKEN_KEY = 'admin_token';

export function getToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  sessionStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  sessionStorage.removeItem(TOKEN_KEY);
}

export function isLoggedIn(): boolean {
  return Boolean(getToken());
}

function authHeaders(): HeadersInit {
  const token = getToken();
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { ...authHeaders(), ...(options?.headers ?? {}) },
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error ?? `Request failed: ${res.status}`);
  return json as T;
}

// ── Auth ─────────────────────────────────────────────────────────────────────

export async function login(username: string, password: string): Promise<void> {
  const data = await apiFetch<{ token: string }>('/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  setToken(data.token);
}

// ── Stats ────────────────────────────────────────────────────────────────────

export interface AdminStats {
  totalProjects: number;
  recentlyUpdated: number;
  createdLast30Days: number;
  latestProjects: { id: number; name: string; updated_at: string }[];
  oldestProject: { id: number; name: string; created_at: string } | null;
  generatedAt: string;
}

export async function fetchStats(): Promise<AdminStats> {
  return apiFetch<AdminStats>('/stats');
}

// ── Projects ─────────────────────────────────────────────────────────────────

export interface ProjectSummary {
  id: number;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
}

export interface ProjectsResponse {
  projects: ProjectSummary[];
  pagination: { page: number; limit: number; total: number; pages: number };
}

export async function fetchProjects(opts: {
  page?: number;
  limit?: number;
  search?: string;
  sort?: string;
  order?: string;
} = {}): Promise<ProjectsResponse> {
  const params = new URLSearchParams();
  if (opts.page) params.set('page', String(opts.page));
  if (opts.limit) params.set('limit', String(opts.limit));
  if (opts.search) params.set('search', opts.search);
  if (opts.sort) params.set('sort', opts.sort);
  if (opts.order) params.set('order', opts.order);
  const qs = params.toString();
  return apiFetch<ProjectsResponse>(`/projects${qs ? `?${qs}` : ''}`);
}

export async function fetchProject(id: number): Promise<{ project: Record<string, unknown> }> {
  return apiFetch(`/project/${id}`);
}

export async function renameProject(id: number, name: string, description: string): Promise<void> {
  await apiFetch(`/project/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ name, description }),
  });
}

export async function deleteProject(id: number): Promise<void> {
  await apiFetch(`/project/${id}`, { method: 'DELETE' });
}

// ── AI Settings ──────────────────────────────────────────────────────────────

export type AIProvider = 'gemini' | 'deepseek' | 'openrouter';

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

/** Dynamic OpenRouter free-model entry. */
export interface OpenRouterModel {
  id: string;
  label: string;
  contextLength?: number;
  free: boolean;
}

export interface ProviderKeyStatus {
  provider: AIProvider;
  hasKey: boolean;
  hasStoredKey: boolean;
  hasEnvFallback: boolean;
  source: 'stored' | 'env' | 'none';
  keyPreview: string;
}

export interface AISettings {
  provider: AIProvider;
  model: string;
  enabled: boolean;
  useGrounding: boolean;     // Gemini Google-Search grounding on/off
  autoFailover: boolean;     // fail over to another provider on quota 429
  hasKey: boolean;            // active provider has a usable key
  anyKey: boolean;           // any provider has a usable key
  providers: ProviderKeyStatus[];
  allowedModels: AIModelOption[];        // static Gemini + DeepSeek
  openrouterModels: OpenRouterModel[];   // cached free list
  openrouterModelsUpdatedAt: string | null;
}

export interface AISettingsPatch {
  provider?: AIProvider;
  model?: string;
  enabled?: boolean;
  useGrounding?: boolean;
  autoFailover?: boolean;
  keys?: Partial<Record<AIProvider, string>>;
}

export async function fetchAISettings(): Promise<AISettings> {
  return apiFetch<AISettings>('/ai-settings');
}

export async function updateAISettings(
  patch: AISettingsPatch,
): Promise<{ ok: true; provider: AIProvider; model: string; enabled: boolean; providers: { provider: AIProvider; hasStoredKey: boolean; keyPreview: string }[] }> {
  return apiFetch('/ai-settings', { method: 'POST', body: JSON.stringify(patch) });
}

/** Remove one provider's stored key, or (no arg) all stored AI settings. */
export async function deleteStoredAIKey(provider?: AIProvider): Promise<void> {
  await apiFetch('/ai-settings', {
    method: 'DELETE',
    ...(provider ? { body: JSON.stringify({ provider }) } : {}),
  });
}

/** Refresh OpenRouter's free-model list (persisted server-side). */
export async function refreshOpenRouterModels(): Promise<{ ok: true; count: number; models: OpenRouterModel[]; updatedAt: string }> {
  return apiFetch('/openrouter-models', { method: 'POST' });
}

/**
 * Verify a single provider's key/model independently of the active settings.
 * Tests a draft (unsaved) key when `key` is supplied, else the stored/env key.
 */
export async function testAIProvider(args: { provider: AIProvider; model?: string; key?: string }): Promise<{ ok: true; message: string }> {
  return apiFetch('/ai-settings', { method: 'POST', body: JSON.stringify({ test: true, ...args }) });
}

// ── Cotality (CoreLogic) Data Settings ────────────────────────────────────────

export type CotalityRegion = 'au' | 'nz';

export interface CotalitySettings {
  hasCredentials: boolean;
  hasStoredCredentials: boolean;
  hasEnvFallback: boolean;
  source: 'stored' | 'env' | 'none';
  clientIdPreview: string;
  tokenUrl: string;
  apiBaseUrl: string;
  region: CotalityRegion;
  propertyDataPath: string;
  enabled: boolean;
  defaults: { apiBaseUrl: string; tokenUrl: string; region: CotalityRegion };
}

export interface CotalitySettingsPatch {
  clientId?: string;
  clientSecret?: string;
  tokenUrl?: string;
  apiBaseUrl?: string;
  region?: CotalityRegion;
  propertyDataPath?: string;
  enabled?: boolean;
}

export async function fetchCotalitySettings(): Promise<CotalitySettings> {
  return apiFetch<CotalitySettings>('/cotality-settings');
}

export async function updateCotalitySettings(
  patch: CotalitySettingsPatch,
): Promise<{ ok: true; hasCredentials: boolean; clientIdPreview: string; tokenUrl: string; apiBaseUrl: string; region: CotalityRegion; propertyDataPath: string; enabled: boolean }> {
  return apiFetch('/cotality-settings', { method: 'POST', body: JSON.stringify(patch) });
}

/** Verify the credentials by performing an OAuth2 token exchange. */
export async function testCotalityConnection(
  patch: CotalitySettingsPatch,
): Promise<{ ok: true; message: string }> {
  return apiFetch('/cotality-settings', { method: 'POST', body: JSON.stringify({ ...patch, test: true }) });
}

export async function deleteCotalityCredentials(): Promise<void> {
  await apiFetch('/cotality-settings', { method: 'DELETE' });
}
