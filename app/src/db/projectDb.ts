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
      .order('updated_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data as SupabaseRow[]).map(rowToRecord);
  }
  return db.projects.orderBy('updatedAt').reverse().toArray();
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
