/**
 * ProjectManager.tsx
 * Modal panel for saving, loading, deleting and duplicating projects stored
 * in IndexedDB (via Dexie).  Also exposes the "Export to Excel" action.
 */
import { useState, useEffect, useCallback } from 'react';
import {
  createProject,
  saveProject,
  renameProject,
  loadProject,
  listProjects,
  deleteProject,
  duplicateProject,
  type ProjectRecord,
} from '../db/projectDb';
import { exportToExcel } from '../utils/exportToExcel';
import { useStore, migratePersistedState } from '../store/useStore';

// ── helpers ──────────────────────────────────────────────────────────────────

function fmt(d: Date) {
  return new Date(d).toLocaleString('en-AU', { dateStyle: 'short', timeStyle: 'short' });
}

// ── sub-components ───────────────────────────────────────────────────────────

interface Props {
  onClose: () => void;
  /** Called after a project is loaded so the parent can recalculate.
   *
   *  IMPORTANT: the loaded admin/inputs are passed explicitly so the parent
   *  cannot use stale React-closure values when it kicks off the recalc.
   *  This is the fix for the "Inputs ↔ calc-engine state drift" UAT v2 P0.
   */
  onLoad?: (loaded?: { admin: import('../types').AdminConfig; inputs: import('../types').MainInputs }) => void;
}

/** Compose the user-visible record name from project + version. */
function composeName(projectName: string, versionName: string): string {
  const p = projectName.trim();
  const v = versionName.trim();
  if (p && v) return `${p} — ${v}`;
  return p || v;
}

export function ProjectManager({ onClose, onLoad }: Props) {
  const { admin, inputs, dashboardData, setAdmin, replaceAdmin, replaceInputs, setDashboardData, currentProjectId, setCurrentProjectId, projectList } = useStore();

  // R21 — distinguish "loading" (null) from "empty list" (empty array). Without
  // this, the count flickers to "(0)" while the IndexedDB read is in flight.
  const [projects, setProjects] = useState<ProjectRecord[] | null>(null);
  const [saveProjectName, setSaveProjectName] = useState(admin.projectName || '');
  const [saveVersionName, setSaveVersionName] = useState(admin.versionName || '');
  const currentId = currentProjectId;
  const setCurrentId = setCurrentProjectId;
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const refresh = useCallback(async () => {
    setProjects(await listProjects());
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // ── save / update ──────────────────────────────────────────────────────────

  async function handleSave() {
    const projectName = saveProjectName.trim();
    const versionName = saveVersionName.trim();
    if (!projectName) { setMsg('Please select a project name.'); return; }
    if (projectList.length > 0 && !projectList.includes(projectName)) {
      setMsg('Selected project is not in the master list. Add it via the Inputs tab first.');
      return;
    }
    if (!versionName) { setMsg('Please enter a version name.'); return; }

    // Persist project + version into admin so they travel with the record;
    // compose a display name for the legacy `name` column.
    const adminToSave = { ...admin, projectName, versionName };
    const recordName = composeName(projectName, versionName);

    setBusy(true);
    try {
      if (currentId !== null) {
        await Promise.all([
          saveProject(currentId, adminToSave, inputs, dashboardData),
          renameProject(currentId, recordName, versionName),
        ]);
        setAdmin({ projectName, versionName });
        setMsg('Project updated.');
      } else {
        const id = await createProject(recordName, versionName, adminToSave, inputs, dashboardData);
        setCurrentId(id);
        setAdmin({ projectName, versionName });
        setMsg('Project saved.');
      }
      await refresh();
    } catch (e) {
      setMsg(String(e));
    } finally {
      setBusy(false);
    }
  }

  // ── load ───────────────────────────────────────────────────────────────────

  async function handleLoad(id: number) {
    setBusy(true);
    try {
      const rec = await loadProject(id);
      if (!rec) { setMsg('Project not found.'); return; }
      // Review #1 fix — route the loaded record through migratePersistedState
      // so any pre-v7 fields (e.g. equityDeveloper.fixedAmount instead of
      // .equityCap) are migrated before the engine sees them. Without this,
      // existing Supabase / IndexedDB records saved on schema v6 fall through
      // to the engine with .equityCap === undefined, and the funding solver
      // silently treats the cap as 0 (or the % fallback). Migrates from any
      // version up to and including 6 — v7+ records pass through unchanged.
      const migrated = migratePersistedState(
        { admin: rec.admin, inputs: rec.inputs },
        6,
      ) as { admin: typeof rec.admin; inputs: typeof rec.inputs };
      rec.admin = migrated.admin;
      rec.inputs = migrated.inputs;
      // Wholesale replace — never partial-merge over the previous project's inputs.
      // The previous setAdmin/setInputs implementation merged top-level keys into
      // the existing object, so any field present in the prior project but absent
      // in the loaded record would leak through. That, plus the cached
      // dashboardData below, was the root of the v2-UAT "state drift" P0.
      replaceAdmin(rec.admin);
      replaceInputs(rec.inputs);
      // Do NOT hydrate cached dashboardData. It can be stale relative to the
      // loaded inputs (different calc revision, different inputs version) and
      // we'd flash the wrong figures on Dashboard/Cashflow/Checks until the
      // recalc lands. Force null so the UI shows "Calculating…" until fresh
      // results arrive — recalc fires below via onLoad with explicit values.
      setDashboardData(null);
      setCurrentId(id);
      setSaveProjectName(rec.admin.projectName ?? '');
      setSaveVersionName(rec.admin.versionName ?? rec.description ?? '');
      setMsg(`Loaded "${rec.name}". Recalculating…`);
      // Pass the just-loaded values explicitly so the parent's calculate()
      // cannot accidentally read stale closure values from useStore destructure.
      onLoad?.({ admin: rec.admin, inputs: rec.inputs });
    } catch (e) {
      setMsg(String(e));
    } finally {
      setBusy(false);
    }
  }

  // ── delete ─────────────────────────────────────────────────────────────────

  async function handleDelete(id: number, name: string) {
    if (!confirm(`Delete project "${name}"?`)) return;
    setBusy(true);
    try {
      await deleteProject(id);
      if (currentId === id) { setCurrentId(null); setSaveProjectName(''); setSaveVersionName(''); }
      await refresh();
      setMsg('Project deleted.');
    } catch (e) {
      setMsg(String(e));
    } finally {
      setBusy(false);
    }
  }

  // ── duplicate ──────────────────────────────────────────────────────────────

  async function handleDuplicate(id: number, name: string) {
    const newName = prompt('New project name:', `${name} (copy)`);
    if (!newName) return;
    setBusy(true);
    try {
      await duplicateProject(id, newName);
      await refresh();
      setMsg(`Duplicated as "${newName}".`);
    } catch (e) {
      setMsg(String(e));
    } finally {
      setBusy(false);
    }
  }

  // ── export ─────────────────────────────────────────────────────────────────

  async function handleExport() {
    if (!dashboardData) { setMsg('Run calculations first.'); return; }
    setBusy(true);
    try {
      const exportName = composeName(saveProjectName, saveVersionName) || admin.projectName || 'Feasibility';
      await exportToExcel(dashboardData, admin, exportName);
      setMsg('Excel file downloaded.');
    } catch (e) {
      setMsg(String(e));
    } finally {
      setBusy(false);
    }
  }

  // ── render ─────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl mx-4 flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-lg font-bold text-gray-800">Project Manager</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl font-bold leading-none">&times;</button>
        </div>

        <div className="overflow-y-auto flex-1 p-6 space-y-6">

          {/* Save panel */}
          <section>
            <h3 className="text-sm font-semibold text-gray-700 mb-3">
              {currentId !== null ? 'Update current project' : 'Save new project'}
            </h3>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <div>
                <label className="block text-[11px] text-gray-500 mb-0.5">Project name <span className="text-red-500">*</span></label>
                {projectList.length > 0 ? (
                  <select
                    className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={projectList.includes(saveProjectName) ? saveProjectName : ''}
                    onChange={e => setSaveProjectName(e.target.value)}
                  >
                    <option value="">— Select project —</option>
                    {projectList.map(name => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm bg-gray-100 text-gray-500"
                    placeholder="Add a project in Inputs → General first"
                    value={saveProjectName}
                    disabled
                    readOnly
                  />
                )}
              </div>
              <div>
                <label className="block text-[11px] text-gray-500 mb-0.5">Version name <span className="text-red-500">*</span></label>
                <input
                  className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g. Initial baseline, Post-review v2"
                  value={saveVersionName}
                  onChange={e => setSaveVersionName(e.target.value)}
                />
              </div>
            </div>
            {projectList.length === 0 && (
              <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 mb-2">
                The master project list is empty. Open <strong>Inputs → 1. General</strong> and add at least one project name to enable saving new versions.
              </p>
            )}
            <div className="flex gap-2">
              <button
                onClick={handleSave}
                disabled={busy || !saveProjectName.trim() || !saveVersionName.trim()}
                className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold px-4 py-1.5 rounded"
              >
                {currentId !== null ? 'Update' : 'Save'}
              </button>
              {currentId !== null && (
                <button
                  onClick={() => { setCurrentId(null); setSaveVersionName(''); }}
                  className="border border-gray-300 text-gray-600 text-sm px-4 py-1.5 rounded hover:bg-gray-50"
                >
                  Save as new version
                </button>
              )}
              <button
                onClick={handleExport}
                disabled={busy || !dashboardData}
                className="ml-auto bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-sm font-semibold px-4 py-1.5 rounded"
              >
                Export to Excel
              </button>
            </div>
          </section>

          {/* Message */}
          {msg && (
            <p className="text-sm text-blue-700 bg-blue-50 border border-blue-200 rounded px-3 py-2">{msg}</p>
          )}

          {/* Project list */}
          <section>
            <h3 className="text-sm font-semibold text-gray-700 mb-3">
              Saved projects {projects == null ? '' : `(${projects.length})`}
            </h3>
            {projects == null ? (
              // R21 — loading skeleton so the count doesn't flicker to "(0)".
              <div className="space-y-2" aria-busy="true" aria-label="Loading saved projects">
                {[0, 1, 2].map(i => (
                  <div key={i} className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 bg-gray-50 animate-pulse">
                    <div className="flex-1 min-w-0 space-y-1.5">
                      <div className="h-3 w-1/2 bg-gray-200 rounded" />
                      <div className="h-2 w-1/3 bg-gray-200 rounded" />
                    </div>
                  </div>
                ))}
              </div>
            ) : projects.length === 0 ? (
              <p className="text-sm text-gray-400 italic">No saved projects yet.</p>
            ) : (
              <div className="space-y-2">
                {projects.map(p => (
                  <div
                    key={p.id}
                    className={`flex items-center gap-3 p-3 rounded-lg border text-sm ${
                      p.id === currentId
                        ? 'border-blue-400 bg-blue-50'
                        : 'border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-800 truncate">{p.name}</p>
                      {p.description && (
                        <p className="text-xs text-gray-500 truncate">{p.description}</p>
                      )}
                      <p className="text-xs text-gray-400 mt-0.5">Updated {fmt(p.updatedAt)}</p>
                    </div>
                    <div className="flex gap-1.5 shrink-0">
                      <button
                        onClick={() => handleLoad(p.id!)}
                        disabled={busy}
                        className="text-xs bg-blue-100 hover:bg-blue-200 text-blue-700 px-2.5 py-1 rounded font-medium disabled:opacity-50"
                      >
                        Load
                      </button>
                      <button
                        onClick={() => handleDuplicate(p.id!, p.name)}
                        disabled={busy}
                        className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-2.5 py-1 rounded font-medium disabled:opacity-50"
                      >
                        Copy
                      </button>
                      <button
                        onClick={() => handleDelete(p.id!, p.name)}
                        disabled={busy}
                        className="text-xs bg-red-100 hover:bg-red-200 text-red-700 px-2.5 py-1 rounded font-medium disabled:opacity-50"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
