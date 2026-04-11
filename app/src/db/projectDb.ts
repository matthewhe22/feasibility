/**
 * projectDb.ts
 * IndexedDB persistence layer via Dexie.
 * Stores complete project snapshots: admin config, all inputs, and the last
 * set of calculated outputs so the user can restore the full state instantly.
 */
import Dexie, { type Table } from 'dexie';
import type { AdminConfig, MainInputs, DashboardData } from '../types';

// ── Schema ─────────────────────────────────────────────────────────────────

export interface ProjectRecord {
  id?: number;            // auto-increment PK
  name: string;
  description: string;
  createdAt: Date;
  updatedAt: Date;
  admin: AdminConfig;
  inputs: MainInputs;
  dashboardData: DashboardData | null;
}

// ── Database class ──────────────────────────────────────────────────────────

class FeasibilityDatabase extends Dexie {
  projects!: Table<ProjectRecord, number>;

  constructor() {
    super('FeasibilityDB');
    // Version 1: projects table indexed by name and dates for list queries
    this.version(1).stores({
      projects: '++id, name, createdAt, updatedAt',
    });
  }
}

export const db = new FeasibilityDatabase();

// ── CRUD helpers ────────────────────────────────────────────────────────────

/** Persist a brand-new project and return its generated id. */
export async function createProject(
  name: string,
  description: string,
  admin: AdminConfig,
  inputs: MainInputs,
  dashboardData: DashboardData | null = null,
): Promise<number> {
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
  await db.projects.update(id, { admin, inputs, dashboardData, updatedAt: new Date() });
}

/** Rename / re-describe a project without touching inputs or outputs. */
export async function renameProject(id: number, name: string, description: string): Promise<void> {
  await db.projects.update(id, { name, description, updatedAt: new Date() });
}

/** Return a single project or undefined if not found. */
export async function loadProject(id: number): Promise<ProjectRecord | undefined> {
  return db.projects.get(id);
}

/** Return all projects ordered by most-recently-updated first. */
export async function listProjects(): Promise<ProjectRecord[]> {
  return db.projects.orderBy('updatedAt').reverse().toArray();
}

/** Permanently delete a project. */
export async function deleteProject(id: number): Promise<void> {
  await db.projects.delete(id);
}

/** Duplicate an existing project under a new name. */
export async function duplicateProject(id: number, newName: string): Promise<number> {
  const src = await db.projects.get(id);
  if (!src) throw new Error(`Project ${id} not found`);
  const now = new Date();
  return db.projects.add({
    ...src,
    id: undefined,
    name: newName,
    createdAt: now,
    updatedAt: now,
  });
}
