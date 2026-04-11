import { useEffect } from 'react';
import { Analytics } from '@vercel/analytics/react';

declare const __BUILD_TIME__: string;
import { useStore } from './store/useStore';
import { runCalculations } from './engine';
import { MainInputTab } from './components/inputs/MainInputTab';
import { InternalDashboard } from './components/dashboards/InternalDashboard';
import { ExternalDashboard } from './components/dashboards/ExternalDashboard';
import { ProjectCashflow } from './components/dashboards/ProjectCashflow';
import { ProjectSummary } from './components/dashboards/ProjectSummary';
import { ChartsTab } from './components/charts/Charts';

type TabId = 'input' | 'internalDash' | 'externalDash' | 'cashflow' | 'summary' | 'charts';

const TABS: { id: TabId; label: string }[] = [
  { id: 'input', label: 'Inputs' },
  { id: 'internalDash', label: 'Internal Dashboard' },
  { id: 'externalDash', label: 'External Dashboard' },
  { id: 'cashflow', label: 'Project Cashflow' },
  { id: 'summary', label: 'Project Summary' },
  { id: 'charts', label: 'Charts & Visualisations' },
];

function App() {
  const { activeTab, setActiveTab, admin, inputs, setDashboardData, isCalculating, setIsCalculating } = useStore();

  const calculate = () => {
    setIsCalculating(true);
    setTimeout(() => {
      try {
        const result = runCalculations(admin, inputs);
        setDashboardData(result);
      } catch (e) {
        console.error('Calculation error:', e);
      } finally {
        setIsCalculating(false);
      }
    }, 50);
  };

  useEffect(() => {
    calculate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">
      {/* Header */}
      <header className="bg-gray-800 text-white px-4 py-3 flex items-center justify-between shadow">
        <div>
          <h1 className="text-lg font-bold tracking-wide">Project Development Feasibility Model</h1>
          <p className="text-xs text-gray-400">Property Development Feasibility Analysis</p>
        </div>
        <button
          onClick={calculate}
          disabled={isCalculating}
          className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-sm font-semibold px-5 py-2 rounded shadow transition-colors"
        >
          {isCalculating ? 'Calculating...' : 'Run Calculations'}
        </button>
      </header>

      {/* Tab Navigation */}
      <nav className="bg-white border-b border-gray-300 sticky top-0 z-10 shadow-sm">
        <div className="flex">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
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
        {activeTab === 'input' && <MainInputTab />}
        {activeTab === 'internalDash' && <InternalDashboard />}
        {activeTab === 'externalDash' && <ExternalDashboard />}
        {activeTab === 'cashflow' && <ProjectCashflow />}
        {activeTab === 'summary' && <ProjectSummary />}
        {activeTab === 'charts' && <ChartsTab />}
      </main>

      {/* Footer */}
      <footer className="bg-gray-800 text-gray-500 text-xs text-center py-2">
        <div>Project Development Feasibility Model &mdash; Web Application</div>
        <div className="text-gray-600 text-[10px] mt-0.5">
          Last updated: {new Date(__BUILD_TIME__).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' })}
        </div>
      </footer>
      <Analytics />
    </div>
  );
}

export default App;
