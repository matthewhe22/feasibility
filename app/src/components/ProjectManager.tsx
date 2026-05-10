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
  saveProjectList,
  type ProjectRecord,
} from '../db/projectDb';
import { validateProjectName } from '../admin/projectSetupValidator';
import { exportToExcel } from '../utils/exportToExcel';
import { useStore, migratePersistedState, defaultAdmin, defaultInputs } from '../store/useStore';
import { deepMerge } from '../utils/deepMerge';

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
  const { admin, inputs, dashboardData, setAdmin, replaceAdmin, replaceInputs, setDashboardData, currentProjectId, setCurrentProjectId, projectList, setProjectList } = useStore();

  // R21 — distinguish "loading" (null) from "empty list" (empty array). Without
  // this, the count flickers to "(0)" while the IndexedDB read is in flight.
  const [projects, setProjects] = useState<ProjectRecord[] | null>(null);
  const [saveProjectName, setSaveProjectName] = useState(admin.projectName || '');
  const [saveVersionName, setSaveVersionName] = useState(admin.versionName || '');
  const currentId = currentProjectId;
  const setCurrentId = setCurrentProjectId;
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  // Bug 5 (Kew UAT): main-app free-text save. When the user wants to save under
  // a project name that's not yet in the master list, they can toggle this on
  // and type a new name. We attempt to publish the new name to the master list
  // via saveProjectList (best-effort — gracefully handled if RLS denies);
  // either way the local save succeeds with the new name.
  const [useNewName, setUseNewName] = useState(false);

  const refresh = useCallback(async () => {
    setProjects(await listProjects());
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // ── save / update ──────────────────────────────────────────────────────────

  async function handleSave() {
    const projectName = saveProjectName.trim();
    const versionName = saveVersionName.trim();
    if (!projectName) { setMsg('Please select or enter a project name.'); return; }
    // Bug 5 (Kew UAT): if user toggled "New name", validate + try to publish to
    // master list. Validation mirrors the admin Project Setup page (50-char
    // limit, no duplicates, non-empty). Publishing is best-effort — RLS may
    // deny non-admin writes, in which case the local save still proceeds and
    // the user is told the name was saved locally only.
    // Track whether this save is for a brand-new master-list entry. The
    // "Update" button sitting next to a freshly-typed (not-yet-published)
    // name was previously taking the in-place rename path below — which
    // overwrote the loaded record's name and depended on a best-effort
    // saveProjectList() to publish the new name. When the master-list
    // publish was rejected (RLS) or otherwise raced, the toast still said
    // "Project updated." but the new name never appeared in admin.projectList
    // on reload. Treat "+ New name + Update" as "save under new name" instead
    // — route through createProject (the proven-working path the "Save as
    // new version" button uses) and surface clearer wording.
    const isNewMasterName =
      useNewName && projectList.length > 0 && !projectList.includes(projectName);
    if (isNewMasterName) {
      const err = validateProjectName(projectName, projectList);
      if (err) { setMsg(err); return; }
      try {
        const next = Array.from(new Set([...projectList, projectName])).sort((a, b) => a.localeCompare(b));
        await saveProjectList(next);
        setProjectList(next);
      } catch (e) {
        // Don't abort — local save still works; the project just won't appear
        // in everyone else's dropdown until an admin adds it.
        console.warn('Bug 5 (Kew UAT): could not publish new name to master list (likely RLS) — saving locally only:', e);
      }
    } else if (projectList.length > 0 && !projectList.includes(projectName)) {
      setMsg('Selected project is not in the master list. Toggle "New name" to add it, or pick from the dropdown.');
      return;
    }
    if (!versionName) { setMsg('Please enter a version name.'); return; }

    // Persist project + version into admin so they travel with the record;
    // compose a display name for the legacy `name` column.
    const adminToSave = { ...admin, projectName, versionName };
    const recordName = composeName(projectName, versionName);

    setBusy(true);
    try {
      // If the user typed a brand-new master-list name, always create a new
      // project row — even if a project is currently loaded. Renaming the
      // loaded record in place to a fresh name was the source of the
      // "Project updated." false-positive: the row was renamed locally but
      // (when the master-list publish failed) the new name was nowhere to be
      // found in the dropdown after reload, making the project look absent.
      if (currentId !== null && !isNewMasterName) {
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
        setMsg(isNewMasterName ? `Project saved as "${projectName}".` : 'Project saved.');
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
      // Issue 4 (review batch) — MIGRATE-FIRST, then back-fill defaults.
      //
      // Earlier order (PR #55) was: deepMerge(defaults, rec) → migrate.
      // Bug: deepMerge filled missing fields with defaults BEFORE migration
      // ran, so a v6-or-earlier record carrying `equityDeveloper.fixedAmount:
      // 16500000` (and no `equityCap`) had `equityCap` populated with the
      // default ($130.4M) by the time the v6→v7 migration looked at it. The
      // v7 migration only copies fixedAmount→equityCap when `equityCap` is
      // undefined, so it silently skipped the copy and the user's $16.5M cap
      // was lost.
      //
      // The correct order is:
      //   1. migratePersistedState on the RAW record so v7 sees legacy
      //      `fixedAmount` and copies it into `equityCap` correctly.
      //   2. deepMerge with defaults to back-fill any other missing fields
      //      (otherFinancingCosts, backEndSellingCosts, etc — same purpose
      //      as the original Layer A: stop legacy iterators from crashing
      //      on undefined arrays).
      //
      // Migration is run from version `rec.version ?? 0` up to current. The
      // ladder is idempotent on already-migrated data, so doing this on a
      // modern record is a no-op. If a `version` field is added to
      // ProjectRecord later, it'll be picked up here.
      const recVersion = (rec as { version?: number }).version ?? 0;
      const migrated = migratePersistedState(
        { admin: rec.admin, inputs: rec.inputs },
        recVersion,
      ) as { admin: typeof rec.admin; inputs: typeof rec.inputs };
      const normalisedAdmin = deepMerge(defaultAdmin, migrated.admin);
      const normalisedInputs = deepMerge(defaultInputs, migrated.inputs);
      rec.admin = normalisedAdmin;
      rec.inputs = normalisedInputs;
      // Wholesale replace — never partial-merge over the previous project's inputs.
      // The previous setAdmin/setInputs implementation merged top-level keys into
      // the existing object, so any field present in the prior project but absent
      // in the loaded record would leak through. That, plus the cached
      // dashboardData below, was the root of the v2-UAT "state drift" P0.
      replaceAdmin(normalisedAdmin);
      replaceInputs(normalisedInputs);
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
                <div className="flex items-center justify-between mb-0.5">
                  <label className="block text-[11px] text-gray-500">Project name <span className="text-red-500">*</span></label>
                  {projectList.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setUseNewName(v => {
                          const next = !v;
                          if (next) setSaveProjectName('');
                          return next;
                        });
                        setMsg('');
                      }}
                      className="text-[10px] text-blue-600 hover:text-blue-800 underline"
                      title="Bug 5 (Kew UAT): save under a new project name. The new name is published to the master list (best-effort — admin RLS may apply)."
                    >
                      {useNewName ? '↩ Pick from list' : '+ New name'}
                    </button>
                  )}
                </div>
                {projectList.length > 0 && !useNewName ? (
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
                ) : projectList.length > 0 && useNewName ? (
                  <input
                    className="w-full border border-blue-300 rounded px-3 py-1.5 text-sm bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Type a new project name (max 50 chars)"
                    value={saveProjectName}
                    maxLength={50}
                    onChange={e => setSaveProjectName(e.target.value)}
                  />
                ) : (
                  <input
                    className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Type a project name (max 50 chars)"
                    value={saveProjectName}
                    maxLength={50}
                    onChange={e => setSaveProjectName(e.target.value)}
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
              <p className="text-[11px] text-blue-700 bg-blue-50 border border-blue-200 rounded px-2 py-1 mb-2">
                The master project list is empty. Type a name above and Save — the new name will be published to the master list automatically (Bug 5 fix).
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
