/**
 * projectDb.ts
 * Persistence layer for project records.
 *
 * Storage backend is chosen at runtime:
 *  • Supabase (Postgres)  — when VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY are set.
 *    Data is stored server-side and accessible from any device / browser.
 *  • IndexedDB via Dexie  — fallback when Supabase is not configured.
 *    Data is local to the current browser only.
 *
 * Both backends expose the same async CRUD API so the rest of the app is
 * unaware of which backend is active.
 */
import Dexie, { type Table } from 'dexie';
import type { AdminConfig, MainInputs, DashboardData } from '../types';
import { supabase } from './supabaseClient';

// ── Shared record type ──────────────────────────────────────────────────────

export interface ProjectRecord {
  id?: number;
  name: string;
  description: string;
  createdAt: Date;
  updatedAt: Date;
  admin: AdminConfig;
  inputs: MainInputs;
  dashboardData: DashboardData | null;
}

// ── Global branding ─────────────────────────────────────────────────────────
// Branding settings are stored as a sentinel row in the projects table so that
// they survive across devices without requiring a schema change.  The sentinel
// row is invisible to the rest of the app (filtered out of listProjects).

export interface BrandingSettings {
  appName?: string | undefined;
  logoDataUrl?: string | undefined;
  faviconDataUrl?: string | undefined;
  appBgColor?: string | undefined;
}

const BRANDING_SENTINEL = '__global_branding__';
const PROJECT_LIST_SENTINEL = '__global_project_list__';

/** All sentinel record names — filtered out of listProjects. */
const SENTINELS: readonly string[] = [BRANDING_SENTINEL, PROJECT_LIST_SENTINEL];

// ── IndexedDB (Dexie) — local fallback ─────────────────────────────────────

class FeasibilityDatabase extends Dexie {
  projects!: Table<ProjectRecord, number>;

  constructor() {
    super('FeasibilityDB');
    this.version(1).stores({
      projects: '++id, name, createdAt, updatedAt',
    });
  }
}

const db = new FeasibilityDatabase();

// ── Supabase helpers ────────────────────────────────────────────────────────
// Supabase uses snake_case column names; we convert to/from camelCase here.

interface SupabaseRow {
  id: number;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
  admin: AdminConfig;
  inputs: MainInputs;
  dashboard_data: DashboardData | null;
}

function rowToRecord(row: SupabaseRow): ProjectRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    admin: row.admin,
    inputs: row.inputs,
    dashboardData: row.dashboard_data,
  };
}

// ── Public CRUD API ─────────────────────────────────────────────────────────

/** Persist a brand-new project and return its generated id. */
export async function createProject(
  name: string,
  description: string,
  admin: AdminConfig,
  inputs: MainInputs,
  dashboardData: DashboardData | null = null,
): Promise<number> {
  if (supabase) {
    const { data, error } = await supabase
      .from('projects')
      .insert({ name, description, admin, inputs, dashboard_data: dashboardData })
      .select('id')
      .single();
    if (error) throw new Error(error.message);
    return data.id as number;
  }
  const now = new Date();
  return db.projects.add({ name, description, createdAt: now, updatedAt: now, admin, inputs, dashboardData });
}

/** Overwrite an existing project's inputs and (optionally) its outputs. */
export async function saveProject(
  id: number,
  admin: AdminConfig,
  inputs: MainInputs,
  dashboardData: DashboardData | null = null,
): Promise<void> {
  if (supabase) {
    const { error } = await supabase
      .from('projects')
      .update({ admin, inputs, dashboard_data: dashboardData, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw new Error(error.message);
    return;
  }
  await db.projects.update(id, { admin, inputs, dashboardData, updatedAt: new Date() });
}

/** Rename / re-describe a project without touching inputs or outputs. */
export async function renameProject(id: number, name: string, description: string): Promise<void> {
  if (supabase) {
    const { error } = await supabase
      .from('projects')
      .update({ name, description, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw new Error(error.message);
    return;
  }
  await db.projects.update(id, { name, description, updatedAt: new Date() });
}

/** Return a single project or undefined if not found. */
export async function loadProject(id: number): Promise<ProjectRecord | undefined> {
  if (supabase) {
    const { data, error } = await supabase
      .from('projects')
      .select('*')
      .eq('id', id)
      .single();
    if (error) return undefined;
    return rowToRecord(data as SupabaseRow);
  }
  return db.projects.get(id);
}

/** Return all projects ordered by most-recently-updated first. */
export async function listProjects(): Promise<ProjectRecord[]> {
  if (supabase) {
    const { data, error } = await supabase
      .from('projects')
      .select('*')
      .not('name', 'in', `(${SENTINELS.map(s => `"${s}"`).join(',')})`)
      .order('updated_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data as SupabaseRow[]).map(rowToRecord);
  }
  const all = await db.projects.orderBy('updatedAt').reverse().toArray();
  return all.filter(p => !SENTINELS.includes(p.name));
}

// ── Global project-name list (master list used as data validation) ──────────
// Persisted as a sentinel record so it lives alongside projects without
// requiring a schema change. Stored under `admin.projectList`.

export async function loadProjectList(): Promise<string[]> {
  try {
    if (supabase) {
      const { data, error } = await supabase
        .from('projects')
        .select('admin')
        .eq('name', PROJECT_LIST_SENTINEL)
        .maybeSingle();
      if (error || !data) return [];
      const list = (data as { admin: { projectList?: unknown } }).admin?.projectList;
      return Array.isArray(list) ? list.filter((s): s is string => typeof s === 'string') : [];
    }
    const row = await db.projects.where('name').equals(PROJECT_LIST_SENTINEL).first();
    if (!row) return [];
    const list = (row.admin as { projectList?: unknown }).projectList;
    return Array.isArray(list) ? list.filter((s): s is string => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

export async function saveProjectList(list: string[]): Promise<void> {
  // De-dup, trim, drop empties — keeps the master list clean.
  const cleaned = Array.from(new Set(list.map(s => s.trim()).filter(Boolean)));
  const sentinelAdmin = { projectList: cleaned } as unknown as AdminConfig;
  try {
    if (supabase) {
      const { data: existing } = await supabase
        .from('projects')
        .select('id')
        .eq('name', PROJECT_LIST_SENTINEL)
        .maybeSingle();
      if (existing) {
        await supabase
          .from('projects')
          .update({ admin: sentinelAdmin, updated_at: new Date().toISOString() })
          .eq('name', PROJECT_LIST_SENTINEL);
      } else {
        await supabase
          .from('projects')
          .insert({ name: PROJECT_LIST_SENTINEL, description: '', admin: sentinelAdmin, inputs: {} as MainInputs });
      }
      return;
    }
    const existing = await db.projects.where('name').equals(PROJECT_LIST_SENTINEL).first();
    const now = new Date();
    if (existing?.id != null) {
      await db.projects.update(existing.id, { admin: sentinelAdmin, updatedAt: now });
    } else {
      await db.projects.add({
        name: PROJECT_LIST_SENTINEL,
        description: '',
        createdAt: now,
        updatedAt: now,
        admin: sentinelAdmin,
        inputs: {} as MainInputs,
        dashboardData: null,
      });
    }
  } catch (e) {
    console.warn('saveProjectList failed:', e);
  }
}

/** Load app-wide branding settings from the DB (cross-device). */
export async function loadBrandingSettings(): Promise<BrandingSettings | null> {
  try {
    if (supabase) {
      const { data, error } = await supabase
        .from('projects')
        .select('admin')
        .eq('name', BRANDING_SENTINEL)
        .maybeSingle();
      if (error || !data) return null;
      const { appName, logoDataUrl, faviconDataUrl, appBgColor } = (data as { admin: AdminConfig }).admin;
      return { appName, logoDataUrl, faviconDataUrl, appBgColor };
    }
    const row = await db.projects.where('name').equals(BRANDING_SENTINEL).first();
    if (!row) return null;
    const { appName, logoDataUrl, faviconDataUrl, appBgColor } = row.admin;
    return { appName, logoDataUrl, faviconDataUrl, appBgColor };
  } catch {
    return null;
  }
}

/** Persist app-wide branding settings to the DB (cross-device). */
export async function saveBrandingSettings(b: BrandingSettings): Promise<void> {
  // We store branding inside the `admin` field of the sentinel record.
  // All other admin/inputs fields are set to minimal placeholders.
  const brandingAdmin = { appName: b.appName, logoDataUrl: b.logoDataUrl, faviconDataUrl: b.faviconDataUrl, appBgColor: b.appBgColor } as AdminConfig;
  try {
    if (supabase) {
      const { data: existing } = await supabase
        .from('projects')
        .select('id')
        .eq('name', BRANDING_SENTINEL)
        .maybeSingle();
      if (existing) {
        await supabase
          .from('projects')
          .update({ admin: brandingAdmin, updated_at: new Date().toISOString() })
          .eq('name', BRANDING_SENTINEL);
      } else {
        await supabase
          .from('projects')
          .insert({ name: BRANDING_SENTINEL, description: '', admin: brandingAdmin, inputs: {} as MainInputs });
      }
      return;
    }
    const existing = await db.projects.where('name').equals(BRANDING_SENTINEL).first();
    const now = new Date();
    if (existing?.id != null) {
      await db.projects.update(existing.id, { admin: brandingAdmin, updatedAt: now });
    } else {
      await db.projects.add({ name: BRANDING_SENTINEL, description: '', createdAt: now, updatedAt: now, admin: brandingAdmin, inputs: {} as MainInputs, dashboardData: null });
    }
  } catch (e) {
    console.warn('saveBrandingSettings failed:', e);
  }
}

/** Permanently delete a project. */
export async function deleteProject(id: number): Promise<void> {
  if (supabase) {
    const { error } = await supabase.from('projects').delete().eq('id', id);
    if (error) throw new Error(error.message);
    return;
  }
  await db.projects.delete(id);
}

/** Duplicate an existing project under a new name. */
export async function duplicateProject(id: number, newName: string): Promise<number> {
  const src = await loadProject(id);
  if (!src) throw new Error(`Project ${id} not found`);
  return createProject(newName, src.description, src.admin, src.inputs, src.dashboardData);
}

/** Whether the app is currently backed by Supabase (cross-device) or local IndexedDB. */
export { isSupabaseConfigured } from './supabaseClient';
