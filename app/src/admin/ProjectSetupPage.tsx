import { useEffect, useState } from 'react';
import { loadProjectList, saveProjectList } from '../db/projectDb';
import { useStore } from '../store/useStore';

export function ProjectSetupPage() {
  const { setProjectList: setStoreList } = useStore();

  const [list, setList] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  // Initial hydration from DB.
  useEffect(() => {
    let cancelled = false;
    loadProjectList()
      .then(items => {
        if (cancelled) return;
        setList(items);
        setStoreList(items);
      })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [setStoreList]);

  async function persist(next: string[]) {
    setList(next);
    setStoreList(next);
    setSaving(true);
    setError(null);
    try {
      await saveProjectList(next);
      setSavedAt(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  function handleAdd() {
    const trimmed = draft.trim();
    if (!trimmed) return;
    if (list.some(p => p.toLowerCase() === trimmed.toLowerCase())) {
      setDraft('');
      return;
    }
    void persist([...list, trimmed]);
    setDraft('');
  }

  function handleRemove(name: string) {
    if (!confirm(`Remove "${name}" from the master project list?\n\nNote: any saved project versions referencing this name remain in the database — only the data-validation entry is removed.`)) return;
    void persist(list.filter(p => p !== name));
  }

  function handleRename(oldName: string) {
    const next = prompt(`Rename "${oldName}" to:`, oldName);
    if (next == null) return;
    const trimmed = next.trim();
    if (!trimmed || trimmed === oldName) return;
    if (list.some(p => p.toLowerCase() === trimmed.toLowerCase())) {
      alert(`"${trimmed}" already exists in the list.`);
      return;
    }
    void persist(list.map(p => (p === oldName ? trimmed : p)));
  }

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold text-white">Project Setup</h2>
        <p className="text-gray-400 text-sm mt-1">
          Manage the master list of project names. Saved feasibility versions in the main app must select a project name from
          this list — entries here drive the data-validation dropdown shown when users save a new version.
        </p>
      </div>

      {error && (
        <div className="bg-red-900/40 border border-red-700 text-red-300 rounded-xl p-4 text-sm">
          {error}
        </div>
      )}

      {/* Master Project List */}
      <section className="bg-gray-800 rounded-xl p-5 border border-gray-700">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-white text-sm font-semibold">Master Project List</h3>
            <p className="text-gray-500 text-xs mt-0.5">Stored globally; shared across all sessions and devices.</p>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <span className="text-gray-500">{list.length} project{list.length === 1 ? '' : 's'}</span>
            {saving && <span className="text-blue-400 animate-pulse">Saving…</span>}
            {!saving && savedAt && (
              <span className="text-emerald-400">Saved {savedAt.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
            )}
          </div>
        </div>

        {/* Add input */}
        <div className="flex gap-2 mb-4">
          <input
            type="text"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAdd(); } }}
            placeholder="New project name…"
            disabled={loading || saving}
            className="flex-1 bg-gray-900 text-white rounded-lg px-3 py-2 text-sm
                       border border-gray-700 focus:border-blue-500 focus:ring-1 focus:ring-blue-500
                       outline-none placeholder-gray-600 transition disabled:opacity-50"
          />
          <button
            type="button"
            onClick={handleAdd}
            disabled={loading || saving || !draft.trim()}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition disabled:opacity-50"
          >
            Add
          </button>
        </div>

        {/* List */}
        {loading ? (
          <p className="text-gray-500 text-xs animate-pulse text-center py-6">Loading…</p>
        ) : list.length === 0 ? (
          <p className="text-gray-500 text-xs italic text-center py-6">
            No projects yet. Add one above to enable the project-name dropdown in the main app.
          </p>
        ) : (
          <ul className="divide-y divide-gray-700/60 border border-gray-700 rounded-lg overflow-hidden">
            {list.map(name => (
              <li key={name} className="flex items-center justify-between px-4 py-2.5 bg-gray-900/40 hover:bg-gray-900/70 transition-colors">
                <span className="text-white text-sm font-medium truncate" title={name}>{name}</span>
                <div className="flex items-center gap-3 shrink-0 ml-3">
                  <button
                    type="button"
                    onClick={() => handleRename(name)}
                    disabled={saving}
                    className="text-xs text-gray-400 hover:text-white font-medium transition disabled:opacity-50"
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRemove(name)}
                    disabled={saving}
                    className="text-xs text-red-400 hover:text-red-300 font-medium transition disabled:opacity-50"
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Help */}
      <section className="bg-gray-800/50 rounded-xl p-5 border border-gray-700/60 text-xs text-gray-400 space-y-2">
        <p className="text-white text-sm font-semibold">How project names are used</p>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>When a user clicks <span className="text-white">Projects → Save</span> in the main app, they must pick a project name from this list and add a free-text version name.</li>
          <li>Each save creates a new version of that project (e.g. "Tower A — Initial baseline", "Tower A — Post-review v2").</li>
          <li>The Internal Dashboard's Table&nbsp;1 version-comparison feature only shows versions whose project name matches the currently loaded project.</li>
          <li>Renaming a project here does <span className="text-white">not</span> rename existing saved versions in the database; saved versions retain whichever project name was current at the time they were saved.</li>
        </ul>
      </section>
    </div>
  );
}
