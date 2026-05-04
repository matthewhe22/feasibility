import { useEffect, useState, Component, type ReactNode } from 'react';
import { Analytics } from '@vercel/analytics/react';

declare const __BUILD_TIME__: string;
import { useStore } from './store/useStore';
import { runCalculations } from './engine';
import { createProject, saveProject, listProjects, loadBrandingSettings, loadProjectList } from './db/projectDb';
import { projectTestAdmin, projectTestInputs } from './utils/createTestProject';
import { MainInputTab } from './components/inputs/MainInputTab';
import { InternalDashboard } from './components/dashboards/InternalDashboard';
import { ExternalDashboard } from './components/dashboards/ExternalDashboard';
import { ProjectCashflow } from './components/dashboards/ProjectCashflow';
import { ProjectSummary } from './components/dashboards/ProjectSummary';
import { ChartsTab } from './components/charts/Charts';
import { ChecksTab } from './components/dashboards/ChecksTab';
import { ProjectDocs } from './components/dashboards/ProjectDocs';
import { ProjectManager } from './components/ProjectManager';

// ── Pencil mark ───────────────────────────────────────────────────────────────
function PencilMark({ size = 44, invert = true }: { size?: number; invert?: boolean }) {
  const stroke = invert ? '#F4F1EA' : '#0E1012';
  return (
    <svg width={size} height={(size * 100) / 100} viewBox="0 0 100 100" aria-hidden="true">
      <rect x="14" y="44" width="58" height="14" fill="none" stroke={stroke} strokeWidth="2.5"/>
      <rect x="72" y="44" width="8" height="14" fill={stroke}/>
      <polygon points="80,44 96,51 80,58" fill="#C48A3C"/>
      <line x1="14" y1="72" x2="86" y2="72" stroke={stroke} strokeWidth="2"/>
    </svg>
  );
}

// ── Error Boundary ────────────────────────────────────────────────────────────

interface BoundaryProps {
  children: ReactNode;
  label?: string;
  onError?: (err: Error) => void;
}

class DashboardErrorBoundary extends Component<
  BoundaryProps,
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) {
    if (this.props.onError) this.props.onError(error);
    else console.error('UI error caught by boundary:', error);
  }
  render() {
    if (this.state.error) {
      const label = this.props.label ?? 'Component';
      return (
        <div role="alert" className="p-8 text-center">
          <p className="text-red-600 font-semibold text-sm mb-2">{label} error</p>
          <p className="text-xs text-gray-500 font-mono break-all max-w-2xl mx-auto">{this.state.error.message}</p>
          <button
            className="mt-4 text-xs text-blue-600 underline focus:outline-none focus:ring-2 focus:ring-blue-400 rounded px-2 py-1"
            onClick={() => this.setState({ error: null })}
          >
            Dismiss and retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Tab definitions ───────────────────────────────────────────────────────────

type TabId = 'input' | 'internalDash' | 'externalDash' | 'cashflow' | 'summary' | 'charts' | 'checks' | 'docs';

const TABS: { id: TabId; label: string }[] = [
  { id: 'input', label: 'Inputs' },
  { id: 'internalDash', label: 'Internal Dashboard' },
  { id: 'externalDash', label: 'External Dashboard' },
  { id: 'cashflow', label: 'Project Cashflow' },
  { id: 'summary', label: 'Project Summary' },
  { id: 'charts', label: 'Charts & Visualisations' },
  { id: 'checks', label: 'Checks' },
  { id: 'docs', label: 'Model Documents' },
];

// ── App ───────────────────────────────────────────────────────────────────────

function App() {
  const { activeTab, setActiveTab, admin, inputs, setAdmin, setInputs, setDashboardData, dashboardData, isCalculating, setIsCalculating, currentProjectId, setCurrentProjectId, setProjectList } = useStore();
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
    loadBrandingSettings().then(b => {
      if (b) setAdmin(b);
    }).catch(() => {});

    loadProjectList().then(list => setProjectList(list)).catch(() => {});

    (async () => {
      try {
        const projects = await listProjects();
        if (!projects.some(p => p.name === 'Project Test')) {
          const testResult = runCalculations(projectTestAdmin, projectTestInputs);
          await createProject(
            'Project Test',
            'Full sample model from KK Feaso Model Draft v43 — all inputs loaded for reconciliation.',
            projectTestAdmin,
            projectTestInputs,
            testResult,
          );
        }
      } catch {}
    })();

    if (currentProjectId !== null) {
      calculate();
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const projects = await listProjects();
        const demo = projects.find(p => p.name === 'Project Demo 2');
        if (!cancelled && demo?.id != null) {
          setAdmin(demo.admin);
          setInputs(demo.inputs);
          setCurrentProjectId(demo.id);
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
      } catch {}
      if (!cancelled) calculate();
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const appTitle = admin.appName || 'Pencil — Feasibility Engine';

  useEffect(() => {
    document.title = admin.projectName ? `${admin.projectName} — ${appTitle}` : appTitle;
  }, [appTitle, admin.projectName]);

  useEffect(() => {
    const baseDesc = 'AI-driven property feasibility model for residential and commercial development. Model land costs, construction, revenue, debt, and IRR with precision.';
    const desc = admin.projectName
      ? `${admin.projectName} feasibility analysis — ${baseDesc}`
      : baseDesc;
    let metaDesc = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    if (!metaDesc) {
      metaDesc = document.createElement('meta');
      metaDesc.name = 'description';
      document.head.appendChild(metaDesc);
    }
    metaDesc.content = desc;
  }, [admin.projectName]);

  useEffect(() => {
    if (!admin.faviconDataUrl) return;
    let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.href = admin.faviconDataUrl;
  }, [admin.faviconDataUrl]);

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: admin.appBgColor || '#F4F1EA' }}>
      {/* Pencil branded header */}
      <header className="pencil-header px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          {admin.logoDataUrl ? (
            <img src={admin.logoDataUrl} alt="Logo" className="h-11 w-auto object-contain" />
          ) : (
            <PencilMark size={44} />
          )}
          <div>
            <div className="pencil-wordmark text-2xl leading-none">{admin.appName ? appTitle : 'Pencil'}</div>
            <div className="pencil-tagline mt-1">Feasibility · Engine</div>
          </div>
          {(admin.projectName || admin.versionName || admin.projectVersion) && (
            <div className="ml-8 pl-8 border-l border-[#CFC7B5]">
              <div className="pencil-project-name">
                {admin.projectName || 'Untitled Project'}
              </div>
              <div className="pencil-project-version">
                {admin.versionName || (admin.projectVersion ? `v${admin.projectVersion}` : 'Draft')}
              </div>
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowProjectManager(true)}
            className="pencil-btn-secondary"
          >
            Projects
          </button>
          <a
            href="/admin"
            target="_blank"
            rel="noopener noreferrer"
            className="pencil-btn-secondary"
            title="Open the Admin Portal in a new tab"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Admin
          </a>
          <button
            onClick={calculate}
            disabled={isCalculating}
            className="pencil-btn-primary"
          >
            {isCalculating ? 'Calculating…' : 'Run Calculations'}
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

      {dashboardData?.solver && dashboardData.solver.converged === false && (
        <div role="alert" className="bg-red-50 border-b border-red-300 px-4 py-2 flex items-start justify-between">
          <div>
            <span className="text-red-800 text-xs font-semibold">Debt solver did not converge: </span>
            <span className="text-red-700 text-xs font-mono">
              {dashboardData.solver.iterations} of {dashboardData.solver.maxIterations} iterations,
              final delta ${Math.round(dashboardData.solver.finalDelta).toLocaleString()} &gt; tolerance ${dashboardData.solver.tolerance}.
              Finance costs and facility sizes may be inaccurate.
            </span>
          </div>
        </div>
      )}

      {!dismissedWarnings && dashboardData?.warningsDetail && dashboardData.warningsDetail.length > 0 && (
        <div role="status" className="bg-yellow-50 border-b border-yellow-300 px-4 py-2 flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <span className="text-yellow-800 text-xs font-semibold">
              {dashboardData.warningsDetail.length} calculation {dashboardData.warningsDetail.length === 1 ? 'warning' : 'warnings'}:
            </span>
            <ul className="mt-0.5 space-y-0.5">
              {dashboardData.warningsDetail.slice(0, 6).map((w, i) => (
                <li key={i} className={`text-xs font-mono ${w.severity === 'error' ? 'text-red-700' : 'text-yellow-700'}`}>
                  <span className="uppercase font-semibold mr-2">[{w.category}]</span>{w.message}
                </li>
              ))}
              {dashboardData.warningsDetail.length > 6 && (
                <li className="text-xs text-yellow-700 italic">…and {dashboardData.warningsDetail.length - 6} more (see Checks tab)</li>
              )}
            </ul>
          </div>
          <button onClick={() => setDismissedWarnings(true)} aria-label="Dismiss calculation warnings" className="text-yellow-600 text-xs underline ml-4 shrink-0">
            Dismiss
          </button>
        </div>
      )}

      {!dismissedWarnings && !dashboardData?.warningsDetail && dashboardData?.warnings && dashboardData.warnings.length > 0 && (
        <div role="status" className="bg-yellow-50 border-b border-yellow-300 px-4 py-2 flex items-start justify-between">
          <div>
            <span className="text-yellow-800 text-xs font-semibold">Warning: </span>
            {dashboardData.warnings.map((w, i) => (
              <span key={i} className="text-yellow-700 text-xs font-mono block">{w}</span>
            ))}
          </div>
          <button onClick={() => setDismissedWarnings(true)} aria-label="Dismiss warnings" className="text-yellow-600 text-xs underline ml-4 shrink-0">Dismiss</button>
        </div>
      )}

      {/* Pencil tab row */}
      <nav className="bg-white border-b border-[#CFC7B5] sticky top-0 z-10 shadow-sm">
        <div className="flex px-6">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as Parameters<typeof setActiveTab>[0])}
              className={`pencil-tab px-5 py-3 border-b-2 border-transparent transition-colors ${
                activeTab === tab.id ? 'pencil-tab-active' : ''
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </nav>

      <main className="flex-1 p-4 overflow-auto">
        <DashboardErrorBoundary key={activeTab} label={`Tab "${activeTab}"`}>
          {activeTab === 'input' && <MainInputTab />}
          {activeTab === 'internalDash' && <InternalDashboard />}
          {activeTab === 'externalDash' && <ExternalDashboard />}
          {activeTab === 'cashflow' && <ProjectCashflow />}
          {activeTab === 'summary' && <ProjectSummary />}
          {activeTab === 'charts' && <ChartsTab />}
          {activeTab === 'checks' && <ChecksTab />}
          {activeTab === 'docs' && <ProjectDocs />}
        </DashboardErrorBoundary>
      </main>

      {/* Pencil footer */}
      <footer className="bg-[#0E1012] text-[#8A8574] text-xs text-center py-3 pencil-num">
        <div>Pencil — Feasibility Engine · v1.0</div>
        <div className="text-[#5A5548] text-[10px] mt-1">
          Last updated: {new Date(__BUILD_TIME__).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' })}
        </div>
      </footer>
      <Analytics />
      {showProjectManager && (
        <DashboardErrorBoundary label="Project Manager">
          <ProjectManager
            onClose={() => setShowProjectManager(false)}
            onLoad={calculate}
          />
        </DashboardErrorBoundary>
      )}
    </div>
  );
}

export default App;
