import { useMemo, useState } from 'react';
import {
  CONSTRUCTION_BENCHMARKS,
  STATE_FACTORS,
  FINISH_FACTORS,
  SITE_FACTORS,
  PROFESSIONAL_FEE_BENCHMARKS,
  REQUIRED_METRICS,
  PER_UNIT_BENCHMARKS,
  computeConstructionBenchmark,
  type BuildingType,
  type FinishQuality,
  type State,
  type SiteComplexity,
  type BenchmarkInputs,
} from '../../utils/costBenchmarks';
import { formatCurrency, formatMillions, formatPercent } from '../../utils';

type Mode = 'construction' | 'professional';

interface CostReferenceCardProps {
  /** What kind of benchmark to surface — drives which panel renders. */
  mode: Mode;
  /** Currently-modelled GFA (m²) — pre-fills the input and used for total $ calc. */
  defaultGFA?: number;
  /** Currently-modelled total construction cost — used for variance vs benchmark. */
  currentTotal?: number;
  /** Currently-modelled rate ($/m²) — used for variance vs benchmark. */
  currentRate?: number;
  /** Currently-modelled lot/key/space count — for per-unit cross-check. */
  defaultUnits?: number;
  /** Default state from project (e.g. inputs.landPurchase.stampDutyState). */
  defaultState?: State;
}

/**
 * Cost benchmark / reference card. Uses curated public-QS data
 * (Rawlinsons / Turner & Townsend / RLB / AIQS) to suggest a construction $/m²
 * range or a professional-fee % range, given key project metrics.
 *
 * Sits inline in the inputs page so users can sense-check their entered rates
 * before running the model.
 */
export function CostReferenceCard({
  mode,
  defaultGFA = 0,
  currentTotal,
  currentRate,
  defaultUnits = 0,
  defaultState = 'QLD',
}: CostReferenceCardProps) {
  const [expanded, setExpanded] = useState(false);

  // Construction-mode controlled inputs
  const [buildingType, setBuildingType] = useState<BuildingType>('high-rise-apartments');
  const [storeys, setStoreys] = useState<number>(20);
  const [state, setState] = useState<State>(defaultState);
  const [finish, setFinish] = useState<FinishQuality>('standard');
  const [siteComplexity, setSiteComplexity] = useState<SiteComplexity>('moderate');
  const [gfa, setGfa] = useState<number>(defaultGFA);
  const [units, setUnits] = useState<number>(defaultUnits);

  // Professional-mode controlled input — total construction contract value used for % fees
  const [contractValue, setContractValue] = useState<number>(currentTotal ?? 0);

  const benchmark = useMemo(() => {
    if (mode !== 'construction') return null;
    if (!gfa || gfa <= 0) return null;
    const inputs: BenchmarkInputs = { buildingType, storeys, state, finish, siteComplexity, gfa };
    return computeConstructionBenchmark(inputs);
  }, [mode, buildingType, storeys, state, finish, siteComplexity, gfa]);

  const variancePct = useMemo(() => {
    if (!benchmark) return null;
    const refRate = currentRate && currentRate > 0
      ? currentRate
      : (currentTotal && gfa > 0 ? currentTotal / gfa : null);
    if (!refRate) return null;
    return (refRate - benchmark.rateMid) / benchmark.rateMid;
  }, [benchmark, currentRate, currentTotal, gfa]);

  return (
    <div className="mb-4 border border-blue-200 bg-blue-50 rounded">
      {/* Header — collapsible */}
      <button
        type="button"
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-blue-100 rounded-t"
      >
        <span className="text-xs font-bold text-blue-800">
          {expanded ? '▼' : '▶'} Cost Reference / Benchmark
          {mode === 'construction' ? ' — Construction $/m²' : ' — Professional Fees % of Construction'}
        </span>
        <span className="text-[10px] text-blue-600 ml-auto">
          AI-curated from Rawlinsons, Turner &amp; Townsend, RLB, AIQS
        </span>
      </button>

      {expanded && (
        <div className="px-3 pb-3 pt-1 border-t border-blue-200 bg-white rounded-b">
          {/* Required metrics explainer */}
          <RequiredMetricsPanel mode={mode} />

          {mode === 'construction' && (
            <ConstructionBenchmarkPanel
              buildingType={buildingType} setBuildingType={setBuildingType}
              storeys={storeys}           setStoreys={setStoreys}
              state={state}               setState={setState}
              finish={finish}             setFinish={setFinish}
              siteComplexity={siteComplexity} setSiteComplexity={setSiteComplexity}
              gfa={gfa}                   setGfa={setGfa}
              units={units}               setUnits={setUnits}
              currentTotal={currentTotal}
              currentRate={currentRate}
              benchmark={benchmark}
              variancePct={variancePct}
            />
          )}

          {mode === 'professional' && (
            <ProfessionalFeeBenchmarkPanel
              contractValue={contractValue}
              setContractValue={setContractValue}
              defaultTotal={currentTotal ?? 0}
            />
          )}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────── Required-metrics explainer ────────────────────── */

function RequiredMetricsPanel({ mode }: { mode: Mode }) {
  const [open, setOpen] = useState(false);

  const filtered = mode === 'professional'
    ? REQUIRED_METRICS.filter(m => !m.name.toLowerCase().includes('finish'))
    : REQUIRED_METRICS;

  return (
    <div className="mb-3 border border-gray-200 rounded bg-gray-50">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-2 py-1 text-left text-[11px] font-semibold text-gray-700 hover:bg-gray-100 rounded"
      >
        {open ? '▼' : '▶'} Project metrics required for an accurate benchmark
      </button>
      {open && (
        <ul className="px-3 pb-2 pt-1 space-y-0.5">
          {filtered.map(m => (
            <li key={m.name} className="text-[11px] text-gray-600">
              <span className="font-medium text-gray-800">• {m.name}</span>
              <span className="text-gray-500"> — {m.why}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ─────────────────────── Construction panel ────────────────────── */

interface ConstructionPanelProps {
  buildingType: BuildingType;     setBuildingType: (b: BuildingType) => void;
  storeys: number;                setStoreys: (n: number) => void;
  state: State;                   setState: (s: State) => void;
  finish: FinishQuality;          setFinish: (f: FinishQuality) => void;
  siteComplexity: SiteComplexity; setSiteComplexity: (s: SiteComplexity) => void;
  gfa: number;                    setGfa: (n: number) => void;
  units: number;                  setUnits: (n: number) => void;
  currentTotal?: number;
  currentRate?: number;
  benchmark: ReturnType<typeof computeConstructionBenchmark>;
  variancePct: number | null;
}

function ConstructionBenchmarkPanel(p: ConstructionPanelProps) {
  return (
    <>
      {/* Inputs grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3 text-[11px]">
        <Field label="Building type">
          <select
            value={p.buildingType}
            onChange={e => p.setBuildingType(e.target.value as BuildingType)}
            className="w-full px-1 py-0.5 text-[11px] border border-gray-300 rounded bg-yellow-50"
          >
            {CONSTRUCTION_BENCHMARKS.map(b => (
              <option key={b.buildingType} value={b.buildingType}>{b.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Storeys">
          <input
            type="number" min={1} max={120} value={p.storeys}
            onChange={e => p.setStoreys(parseInt(e.target.value) || 1)}
            className="w-full px-1 py-0.5 text-[11px] text-right border border-gray-300 rounded bg-yellow-50"
          />
        </Field>
        <Field label="State / city">
          <select
            value={p.state}
            onChange={e => p.setState(e.target.value as State)}
            className="w-full px-1 py-0.5 text-[11px] border border-gray-300 rounded bg-yellow-50"
          >
            {(Object.keys(STATE_FACTORS) as State[]).map(s => (
              <option key={s} value={s}>
                {s} ({((STATE_FACTORS[s] - 1) * 100 >= 0 ? '+' : '') + ((STATE_FACTORS[s] - 1) * 100).toFixed(0)}%)
              </option>
            ))}
          </select>
        </Field>
        <Field label="Finish quality">
          <select
            value={p.finish}
            onChange={e => p.setFinish(e.target.value as FinishQuality)}
            className="w-full px-1 py-0.5 text-[11px] border border-gray-300 rounded bg-yellow-50"
          >
            {(Object.keys(FINISH_FACTORS) as FinishQuality[]).map(f => (
              <option key={f} value={f}>
                {f} ({((FINISH_FACTORS[f] - 1) * 100 >= 0 ? '+' : '') + ((FINISH_FACTORS[f] - 1) * 100).toFixed(0)}%)
              </option>
            ))}
          </select>
        </Field>
        <Field label="Site complexity">
          <select
            value={p.siteComplexity}
            onChange={e => p.setSiteComplexity(e.target.value as SiteComplexity)}
            className="w-full px-1 py-0.5 text-[11px] border border-gray-300 rounded bg-yellow-50"
          >
            {(Object.keys(SITE_FACTORS) as SiteComplexity[]).map(s => (
              <option key={s} value={s}>
                {s} ({((SITE_FACTORS[s] - 1) * 100 >= 0 ? '+' : '') + ((SITE_FACTORS[s] - 1) * 100).toFixed(0)}%)
              </option>
            ))}
          </select>
        </Field>
        <Field label="GFA (m²)">
          <input
            type="number" min={0} step={100} value={p.gfa || ''}
            onChange={e => p.setGfa(parseFloat(e.target.value) || 0)}
            className="w-full px-1 py-0.5 text-[11px] text-right border border-gray-300 rounded bg-yellow-50"
          />
        </Field>
        <Field label="Units / lots / keys">
          <input
            type="number" min={0} value={p.units || ''}
            onChange={e => p.setUnits(parseFloat(e.target.value) || 0)}
            className="w-full px-1 py-0.5 text-[11px] text-right border border-gray-300 rounded bg-yellow-50"
          />
        </Field>
      </div>

      {/* Result */}
      {!p.benchmark ? (
        <p className="text-[11px] italic text-gray-500">Enter a GFA to see a benchmark range.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-3">
          <ResultBox
            title="Recommended $/m² range"
            primary={`$${p.benchmark.rateLow.toLocaleString()} – $${p.benchmark.rateHigh.toLocaleString()}`}
            secondary={`Mid: $${p.benchmark.rateMid.toLocaleString()} /m²`}
          />
          <ResultBox
            title="Recommended total construction"
            primary={`${formatMillions(p.benchmark.totalLow)} – ${formatMillions(p.benchmark.totalHigh)}`}
            secondary={`Mid: ${formatMillions(p.benchmark.totalMid)}`}
          />
          <ResultBox
            title="Your model vs benchmark"
            primary={
              p.currentTotal
                ? formatMillions(p.currentTotal)
                : (p.currentRate ? `$${p.currentRate.toLocaleString()} /m²` : '—')
            }
            secondary={
              p.variancePct !== null
                ? `${p.variancePct >= 0 ? '+' : ''}${formatPercent(p.variancePct)} vs mid`
                : 'set rate to compare'
            }
            tone={
              p.variancePct === null
                ? 'neutral'
                : Math.abs(p.variancePct) <= 0.10
                  ? 'good'
                  : Math.abs(p.variancePct) <= 0.20
                    ? 'warn'
                    : 'bad'
            }
          />
        </div>
      )}

      {/* Factor decomposition */}
      {p.benchmark && (
        <details className="mb-3 text-[10px] text-gray-600">
          <summary className="cursor-pointer font-semibold text-gray-700">How was this calculated?</summary>
          <div className="mt-1 pl-3 space-y-0.5">
            <p>Base band (Brisbane / standard finish): ${p.benchmark.factors.base[0].toLocaleString()} – ${p.benchmark.factors.base[1].toLocaleString()} /m²</p>
            <p>State factor: ×{p.benchmark.factors.stateFactor.toFixed(2)} ({p.state})</p>
            <p>Finish factor: ×{p.benchmark.factors.finishFactor.toFixed(2)} ({p.finish})</p>
            <p>Height factor: ×{p.benchmark.factors.heightFactor.toFixed(2)} ({p.storeys} storeys)</p>
            <p>Site factor: ×{p.benchmark.factors.siteFactor.toFixed(2)} ({p.siteComplexity})</p>
            <p className="italic mt-1">Source: {p.benchmark.source}</p>
          </div>
        </details>
      )}

      {/* Per-unit cross-check */}
      {p.units > 0 && p.benchmark && (
        <PerUnitCrossCheck units={p.units} totalMid={p.benchmark.totalMid} />
      )}

      <Disclaimer />
    </>
  );
}

function PerUnitCrossCheck({ units, totalMid }: { units: number; totalMid: number }) {
  const perUnit = totalMid / units;
  return (
    <div className="mb-3 p-2 border border-gray-200 rounded bg-gray-50">
      <p className="text-[11px] font-semibold text-gray-700 mb-1">Per-unit cross-check</p>
      <p className="text-[11px] text-gray-600 mb-2">
        Implied benchmark cost per unit: <span className="font-mono">{formatCurrency(perUnit)}</span> per unit
      </p>
      <table className="text-[10px] w-full">
        <thead>
          <tr className="text-gray-500">
            <th className="text-left">Reference metric</th>
            <th className="text-right">Low</th>
            <th className="text-right">High</th>
            <th className="text-left pl-3">Source</th>
          </tr>
        </thead>
        <tbody>
          {PER_UNIT_BENCHMARKS.map(b => (
            <tr key={b.metric} className="border-t border-gray-100">
              <td className="py-0.5">{b.metric}</td>
              <td className="text-right font-mono">{formatCurrency(b.low)}</td>
              <td className="text-right font-mono">{formatCurrency(b.high)}</td>
              <td className="pl-3 italic text-gray-500">{b.source}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ─────────────────────── Professional fees panel ────────────────────── */

function ProfessionalFeeBenchmarkPanel({
  contractValue,
  setContractValue,
  defaultTotal,
}: {
  contractValue: number;
  setContractValue: (n: number) => void;
  defaultTotal: number;
}) {
  return (
    <>
      <div className="flex items-center gap-2 mb-3 text-[11px]">
        <label className="text-gray-700 font-medium">Construction contract value (ex-GST)</label>
        <input
          type="number" min={0} step={100000}
          value={contractValue || ''}
          placeholder={defaultTotal ? defaultTotal.toString() : '0'}
          onChange={e => setContractValue(parseFloat(e.target.value) || 0)}
          className="w-32 px-1 py-0.5 text-[11px] text-right border border-gray-300 rounded bg-yellow-50"
        />
        {defaultTotal > 0 && contractValue !== defaultTotal && (
          <button
            type="button"
            onClick={() => setContractValue(defaultTotal)}
            className="text-[10px] bg-gray-200 hover:bg-gray-300 px-1.5 py-0.5 rounded"
          >
            Use modelled ({formatMillions(defaultTotal)})
          </button>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-[11px] border-collapse">
          <thead>
            <tr className="bg-gray-200 text-gray-700">
              <th className="px-2 py-1 text-left">Discipline</th>
              <th className="px-2 py-1 text-right w-20">% Low</th>
              <th className="px-2 py-1 text-right w-20">% High</th>
              <th className="px-2 py-1 text-right w-28">$ Low</th>
              <th className="px-2 py-1 text-right w-28">$ High</th>
              <th className="px-2 py-1 text-left w-44">Notes / Source</th>
            </tr>
          </thead>
          <tbody>
            {PROFESSIONAL_FEE_BENCHMARKS.map((b, i) => {
              const dollarLow  = contractValue > 0 ? contractValue * b.percentLow  : 0;
              const dollarHigh = contractValue > 0 ? contractValue * b.percentHigh : 0;
              const isAllIn = b.category.toLowerCase().includes('all-in');
              return (
                <tr key={b.category} className={`border-b border-gray-100 ${isAllIn ? 'bg-blue-100 font-semibold' : i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}>
                  <td className="px-2 py-0.5">{b.category}</td>
                  <td className="px-2 py-0.5 text-right font-mono">{(b.percentLow  * 100).toFixed(2)}%</td>
                  <td className="px-2 py-0.5 text-right font-mono">{(b.percentHigh * 100).toFixed(2)}%</td>
                  <td className="px-2 py-0.5 text-right font-mono">{contractValue > 0 ? formatCurrency(dollarLow)  : '—'}</td>
                  <td className="px-2 py-0.5 text-right font-mono">{contractValue > 0 ? formatCurrency(dollarHigh) : '—'}</td>
                  <td className="px-2 py-0.5 text-[10px] text-gray-500 italic">
                    {b.fixedFeeNote ? `${b.fixedFeeNote} • ` : ''}{b.source}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Disclaimer />
    </>
  );
}

/* ─────────────────────── Generic helpers ────────────────────── */

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wide text-gray-500">{label}</span>
      {children}
    </label>
  );
}

function ResultBox({
  title,
  primary,
  secondary,
  tone = 'neutral',
}: {
  title: string;
  primary: string;
  secondary: string;
  tone?: 'good' | 'warn' | 'bad' | 'neutral';
}) {
  const toneClasses: Record<typeof tone, string> = {
    good:    'bg-green-50  border-green-300  text-green-800',
    warn:    'bg-amber-50  border-amber-300  text-amber-800',
    bad:     'bg-red-50    border-red-300    text-red-800',
    neutral: 'bg-gray-50   border-gray-300   text-gray-800',
  };
  return (
    <div className={`rounded border px-3 py-2 ${toneClasses[tone]}`}>
      <p className="text-[10px] uppercase tracking-wide opacity-80">{title}</p>
      <p className="text-sm font-semibold font-mono mt-0.5">{primary}</p>
      <p className="text-[10px] mt-0.5 opacity-80">{secondary}</p>
    </div>
  );
}

function Disclaimer() {
  return (
    <p className="text-[10px] text-gray-500 italic mt-1">
      Indicative ranges for sanity-checking only. Real tenders vary materially with site conditions,
      structural system, façade complexity, services density, and procurement timing. Validate
      against a project-specific QS estimate before relying on these figures.
    </p>
  );
}
