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
