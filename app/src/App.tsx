import { useEffect, useState, Component, type ReactNode } from 'react';
import { Analytics } from '@vercel/analytics/react';

declare const __BUILD_TIME__: string;
import { useStore } from './store/useStore';
import { runCalculations } from './engine';
import { createProject, saveProject, listProjects } from './db/projectDb';
import { projectTestAdmin, projectTestInputs } from './utils/createTestProject';
import { MainInputTab } from './components/inputs/MainInputTab';
import { InternalDashboard } from './components/dashboards/InternalDashboard';
import { ExternalDashboard } from './components/dashboards/ExternalDashboard';
import { ProjectCashflow } from './components/dashboards/ProjectCashflow';
import { ProjectSummary } from './components/dashboards/ProjectSummary';
import { ChartsTab } from './components/charts/Charts';
import { ChecksTab } from './components/dashboards/ChecksTab';
import { ProjectManager } from './components/ProjectManager';

// ── Error Boundary ────────────────────────────────────────────────────────────

class DashboardErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div className="p-8 text-center">
          <p className="text-red-600 font-semibold text-sm mb-2">Dashboard error</p>
          <p className="text-xs text-gray-500 font-mono">{(this.state.error as Error).message}</p>
          <button
            className="mt-4 text-xs text-blue-600 underline"
            onClick={() => this.setState({ error: null })}
          >
            Dismiss
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Tab definitions ───────────────────────────────────────────────────────────

type TabId = 'input' | 'internalDash' | 'externalDash' | 'cashflow' | 'summary' | 'charts' | 'checks';

const TABS: { id: TabId; label: string }[] = [
  { id: 'input', label: 'Inputs' },
  { id: 'internalDash', label: 'Internal Dashboard' },
  { id: 'externalDash', label: 'External Dashboard' },
  { id: 'cashflow', label: 'Project Cashflow' },
  { id: 'summary', label: 'Project Summary' },
  { id: 'charts', label: 'Charts & Visualisations' },
  { id: 'checks', label: 'Checks' },
];

// ── App ───────────────────────────────────────────────────────────────────────

function App() {
  const { activeTab, setActiveTab, admin, inputs, setAdmin, setInputs, setDashboardData, dashboardData, isCalculating, setIsCalculating, currentProjectId, setCurrentProjectId } = useStore();
  const [showProjectManager, setShowProjectManager] = useState(false);
  const [calcError, setCalcError] = useState<string | null>(null);
  const [dismissedWarnings, setDismissedWarnings] = useState(false);

  const calculate = () => {
    setIsCalculating(true);
    setCalcError(null);
    setDismissedWarnings(false);
    setTimeout(() => {
      try {
        const result = runCalculations(admin, inputs);
        setDashboardData(result);
        // Auto-save to DB when a project is currently loaded
        if (currentProjectId !== null) {
          saveProject(currentProjectId, admin, inputs, result).catch((err) => {
            console.warn('Auto-save failed:', err);
          });
        }
      } catch (e) {
        console.error('Calculation error:', e);
        setCalcError(e instanceof Error ? e.message : String(e));
      } finally {
        setIsCalculating(false);
      }
    }, 50);
  };

  useEffect(() => {
    // On first load with no active project, try to restore "Project Demo 2"
    // from the database so the user's saved defaults are shown automatically.
    if (currentProjectId !== null) {
      // A project is already active — just recalculate with persisted inputs.
      calculate();
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const projects = await listProjects();

        // Seed "Project Test" (KK Feaso Model v43 defaults) if not yet in DB
        const hasTestProject = projects.some(p => p.name === 'Project Test');
        if (!hasTestProject) {
          try {
            const testResult = runCalculations(projectTestAdmin, projectTestInputs);
            await createProject(
              'Project Test',
              'Full sample model from KK Feaso Model Draft v43 — all inputs loaded for reconciliation.',
              projectTestAdmin,
              projectTestInputs,
              testResult,
            );
          } catch {
            // Seeding failed (e.g. DB unavailable) — not critical, continue
          }
        }

        const demo = projects.find(p => p.name === 'Project Demo 2');
        if (!cancelled && demo?.id != null) {
          setAdmin(demo.admin);
          setInputs(demo.inputs);
          setCurrentProjectId(demo.id);
          // Calculate immediately with the loaded data (state updates are async,
          // so call runCalculations directly rather than relying on stale closure).
          setIsCalculating(true);
          setCalcError(null);
          try {
            const result = runCalculations(demo.admin, demo.inputs);
            if (!cancelled) setDashboardData(result);
          } catch (e) {
            if (!cancelled) setCalcError(e instanceof Error ? e.message : String(e));
          } finally {
            if (!cancelled) setIsCalculating(false);
          }
          return;
        }
      } catch {
        // DB unavailable — fall through to default calculate
      }
      if (!cancelled) calculate();
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">
      {/* Header */}
      <header className="bg-gray-800 text-white px-4 py-3 flex items-center justify-between shadow">
        <div>
          <h1 className="text-lg font-bold tracking-wide">Project Development Feasibility Model</h1>
          <p className="text-xs text-gray-400">{admin.projectName || 'Property Development Feasibility Analysis'}</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowProjectManager(true)}
            className="bg-gray-600 hover:bg-gray-500 text-white text-sm font-semibold px-4 py-2 rounded shadow transition-colors"
          >
            Projects
          </button>
          <button
            onClick={calculate}
            disabled={isCalculating}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-sm font-semibold px-5 py-2 rounded shadow transition-colors"
          >
            {isCalculating ? 'Calculating...' : 'Run Calculations'}
          </button>
        </div>
      </header>

      {/* Calculation error banner */}
      {calcError && (
        <div className="bg-red-100 border-b border-red-300 px-4 py-2 flex items-center justify-between">
          <span className="text-red-700 text-xs font-mono">Calculation error: {calcError}</span>
          <button onClick={() => setCalcError(null)} className="text-red-500 text-xs underline ml-4">Dismiss</button>
        </div>
      )}

      {/* S-curve warnings banner */}
      {!dismissedWarnings && dashboardData?.warnings && dashboardData.warnings.length > 0 && (
        <div className="bg-yellow-50 border-b border-yellow-300 px-4 py-2 flex items-start justify-between">
          <div>
            <span className="text-yellow-800 text-xs font-semibold">S-Curve Warning: </span>
            {dashboardData.warnings.map((w, i) => (
              <span key={i} className="text-yellow-700 text-xs font-mono block">{w}</span>
            ))}
          </div>
          <button onClick={() => setDismissedWarnings(true)} className="text-yellow-600 text-xs underline ml-4 shrink-0">Dismiss</button>
        </div>
      )}

      {/* Tab Navigation */}
      <nav className="bg-white border-b border-gray-300 sticky top-0 z-10 shadow-sm">
        <div className="flex">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as Parameters<typeof setActiveTab>[0])}
              className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-blue-600 text-blue-700 bg-blue-50'
                  : 'border-transparent text-gray-600 hover:text-gray-800 hover:bg-gray-50'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </nav>

      {/* Content */}
      <main className="flex-1 p-4 overflow-auto">
        <DashboardErrorBoundary>
          {activeTab === 'input' && <MainInputTab />}
          {activeTab === 'internalDash' && <InternalDashboard />}
          {activeTab === 'externalDash' && <ExternalDashboard />}
          {activeTab === 'cashflow' && <ProjectCashflow />}
          {activeTab === 'summary' && <ProjectSummary />}
          {activeTab === 'charts' && <ChartsTab />}
          {activeTab === 'checks' && <ChecksTab />}
        </DashboardErrorBoundary>
      </main>

      {/* Footer */}
      <footer className="bg-gray-800 text-gray-500 text-xs text-center py-2">
        <div>Project Development Feasibility Model &mdash; Web Application</div>
        <div className="text-gray-600 text-[10px] mt-0.5">
          Last updated: {new Date(__BUILD_TIME__).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' })}
        </div>
      </footer>
      <Analytics />
      {showProjectManager && (
        <ProjectManager
          onClose={() => setShowProjectManager(false)}
          onLoad={calculate}
        />
      )}
    </div>
  );
}

export default App;
