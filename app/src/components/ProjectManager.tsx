/**
 * ProjectManager.tsx
 * Modal panel for saving, loading, deleting and duplicating projects stored
 * in IndexedDB (via Dexie).  Also exposes the "Export to Excel" action.
 */
import { useState, useEffect, useCallback } from 'react';
import {
  createProject,
  saveProject,
  loadProject,
  listProjects,
  deleteProject,
  duplicateProject,
  type ProjectRecord,
} from '../db/projectDb';
import { exportToExcel } from '../utils/exportToExcel';
import { useStore } from '../store/useStore';

// ── helpers ──────────────────────────────────────────────────────────────────

function fmt(d: Date) {
  return new Date(d).toLocaleString('en-AU', { dateStyle: 'short', timeStyle: 'short' });
}

// ── sub-components ───────────────────────────────────────────────────────────

interface Props {
  onClose: () => void;
  /** Called after a project is loaded so the parent can recalculate. */
  onLoad?: () => void;
}

export function ProjectManager({ onClose, onLoad }: Props) {
  const { admin, inputs, dashboardData, setAdmin, setInputs, setDashboardData } = useStore();

  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [saveName, setSaveName] = useState(admin.projectName || '');
  const [saveDesc, setSaveDesc] = useState('');
  const [currentId, setCurrentId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const refresh = useCallback(async () => {
    setProjects(await listProjects());
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // ── save / update ──────────────────────────────────────────────────────────

  async function handleSave() {
    if (!saveName.trim()) { setMsg('Please enter a project name.'); return; }
    setBusy(true);
    try {
      if (currentId !== null) {
        await saveProject(currentId, admin, inputs, dashboardData);
        setMsg('Project updated.');
      } else {
        const id = await createProject(saveName.trim(), saveDesc.trim(), admin, inputs, dashboardData);
        setCurrentId(id);
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
      setAdmin(rec.admin);
      setInputs(rec.inputs);
      if (rec.dashboardData) setDashboardData(rec.dashboardData);
      setCurrentId(id);
      setSaveName(rec.name);
      setSaveDesc(rec.description);
      setMsg(`Loaded "${rec.name}". Recalculating…`);
      onLoad?.();
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
      if (currentId === id) { setCurrentId(null); setSaveName(''); setSaveDesc(''); }
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
      await exportToExcel(dashboardData, admin, saveName || admin.projectName || 'Feasibility');
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
            <div className="flex gap-2 mb-2">
              <input
                className="flex-1 border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Project name"
                value={saveName}
                onChange={e => setSaveName(e.target.value)}
              />
              <input
                className="flex-1 border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Description (optional)"
                value={saveDesc}
                onChange={e => setSaveDesc(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleSave}
                disabled={busy}
                className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold px-4 py-1.5 rounded"
              >
                {currentId !== null ? 'Update' : 'Save'}
              </button>
              {currentId !== null && (
                <button
                  onClick={() => { setCurrentId(null); setSaveName(''); setSaveDesc(''); }}
                  className="border border-gray-300 text-gray-600 text-sm px-4 py-1.5 rounded hover:bg-gray-50"
                >
                  Save as new
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
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Saved projects ({projects.length})</h3>
            {projects.length === 0 ? (
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
