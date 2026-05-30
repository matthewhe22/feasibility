import { useEffect, useMemo, useRef, useState } from 'react';
import {
  GRV_BENCHMARKS,
  STATE_FACTORS_GRV,
  LOCATION_FACTORS,
  QUALITY_FACTORS_GRV,
  ESCALATION_RATES,
  REQUIRED_GRV_METRICS,
  computeGRVBenchmark,
  pricingBasisLabel,
  type GRVAssetType,
  type State,
  type LocationGrade,
  type QualityGrade,
  type GRVBenchmarkInputs,
  type PricingBasis,
} from '../../utils/grvBenchmarks';
import { lookupSuburb } from '../../utils/suburbLookup';
import { formatCurrency, formatMillions, formatPercent } from '../../utils';
import { researchKey, getCachedResearch, setCachedResearch } from '../../utils/researchCache';

interface GRVReferenceCardProps {
  /** Total saleable area in m² (sum of unit areas). Optional. */
  defaultSaleableArea?: number;
  /** Number of units / lots / keys. Optional. */
  defaultUnits?: number;
  /** Default state to seed the picker. */
  defaultState?: State;
  /** Current modelled total GRV — used for variance comparison. */
  currentTotalGRV?: number;
  /** Free-text property address. When a known suburb is detected, state +
   *  location grade are auto-seeded (user can still override). Also forwarded
   *  to the live AI research panel so prompts ground prices to the address. */
  propertyAddress?: string;
}

/* ── Live AI research types (GRV mode) ───────────────────────────────────── */

interface ResearchSource {
  title: string;
  url: string;
  snippet?: string;
}

interface GRVResearch {
  summary: string;
  pricingBasis: string;
  perUnitLow: number;
  perUnitHigh: number;
  totalLow?: number;
  totalHigh?: number;
  /** Optional asset-type level breakdown if AI returns multiple subtypes. */
  breakdown?: Array<{
    label: string;
    perUnitLow: number;
    perUnitHigh: number;
    pricingBasis?: string;
    note?: string;
  }>;
  sources: ResearchSource[];
  model: string;
  timestamp: string;
  /** Set when the result was grounded in (or attempted against) Cotality data. */
  cotality?: { used: boolean; url?: string; reason?: string };
  /** True when served from cache (local or server) rather than a fresh AI call. */
  cached?: boolean;
}

const CURRENT_YEAR = new Date().getFullYear();

/**
 * GRV (Gross Realisable Value) sales-price benchmark / reference card.
 *
 * Mirrors the pattern of CostReferenceCard but for revenue side — recommended
 * sale price ranges per asset type (apartment $/m², townhouse $/lot, hotel $/key
 * etc.), adjustable by state, location grade, finish quality, and target year
 * (price escalation applied via 10-yr-avg annual growth rates).
 *
 * Data sources: CoreLogic, Domain, PropTrack, ABS, Knight Frank, JLL, Colliers,
 * Cushman & Wakefield, CBRE, Savills, Charter Keck Cramer, JLL Hotels, HVS, STR.
 * Sources are cited prominently and the calculation factors are exposed so the
 * user can audit how the recommended band was derived.
 */
export function GRVReferenceCard({
  defaultSaleableArea = 0,
  defaultUnits = 0,
  defaultState = 'QLD',
  currentTotalGRV,
  propertyAddress = '',
}: GRVReferenceCardProps) {
  const [expanded, setExpanded] = useState(false);

  // Suburb match drives the initial state / location grade selection. Once
  // the user manually edits either field we stop overriding (tracked via the
  // `userTouched` ref) so the address auto-seed never clobbers an explicit
  // pick.
  const addressMatch = useMemo(() => lookupSuburb(propertyAddress), [propertyAddress]);

  // Static-benchmark controlled inputs
  const [assetType, setAssetType]   = useState<GRVAssetType>('apartments-high-rise');
  const [state, setState]           = useState<State>(addressMatch?.state ?? defaultState);
  const [location, setLocation]     = useState<LocationGrade>(addressMatch?.locationGrade ?? 'cbd');
  const [quality, setQuality]       = useState<QualityGrade>('standard');
  const [targetYear, setTargetYear] = useState<number>(CURRENT_YEAR);
  const [units, setUnits]           = useState<number>(defaultUnits);
  const [unitArea, setUnitArea]     = useState<number>(0);
  const [totalArea, setTotalArea]   = useState<number>(defaultSaleableArea);
  const [customEscalation, setCustomEscalation] = useState<number | null>(null);

  // Track whether the user has manually picked state / location grade. After
  // a manual change we stop applying the address-driven auto-seed so the
  // user's choice persists across address edits.
  const userTouchedRef = useRef(false);
  useEffect(() => {
    if (userTouchedRef.current) return;
    if (!addressMatch) return;
    setState(addressMatch.state);
    setLocation(addressMatch.locationGrade);
  }, [addressMatch]);
  const markTouched = () => { userTouchedRef.current = true; };

  // Live AI research state
  const [liveLoading, setLiveLoading] = useState(false);
  const [liveError, setLiveError]     = useState<string | null>(null);
  const [liveResult, setLiveResult]   = useState<GRVResearch | null>(null);

  const benchmark = useMemo(() => {
    const inputs: GRVBenchmarkInputs = {
      assetType, state, locationGrade: location, quality, targetYear,
      unitArea: unitArea || undefined,
      units: units || undefined,
      totalSaleableArea: totalArea || undefined,
      customEscalation: customEscalation ?? undefined,
      suburb: addressMatch?.suburb,
    };
    return computeGRVBenchmark(inputs);
  }, [assetType, state, location, quality, targetYear, unitArea, units, totalArea, customEscalation, addressMatch?.suburb]);

  const variancePct = useMemo(() => {
    if (!benchmark || !benchmark.totalMid || !currentTotalGRV) return null;
    return (currentTotalGRV - benchmark.totalMid) / benchmark.totalMid;
  }, [benchmark, currentTotalGRV]);

  const runLiveResearch = async (forceRefresh = false) => {
    setLiveLoading(true);
    setLiveError(null);
    setLiveResult(null);
    try {
      const benchmarkRow = GRV_BENCHMARKS.find(b => b.assetType === assetType);
      const body = {
        mode: 'grv',
        assetType: benchmarkRow?.label ?? assetType,
        state,
        locationGrade: location,
        quality,
        targetYear,
        units: units || undefined,
        totalSaleableArea: totalArea || undefined,
        unitArea: unitArea || undefined,
        propertyAddress: propertyAddress || undefined,
        // Suburb (from address) lets the AI ground prices to the specific
        // sub-market rather than the state × grade average — much more
        // precise on the "comparable sales" side.
        suburb: addressMatch?.suburb || undefined,
      };

      // Durable local cache: identical GRV request reuses the prior answer
      // instead of re-hitting the rate-limited Gemini free tier.
      const key = researchKey(body);
      if (!forceRefresh) {
        const cached = getCachedResearch<GRVResearch>(key);
        if (cached) {
          setLiveResult({ ...cached, cached: true } as GRVResearch);
          return;
        }
      }

      const r = await fetch('/api/benchmarks/research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(forceRefresh ? { ...body, refresh: true } : body),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({ error: r.statusText }));
        throw new Error(err.error || `HTTP ${r.status}`);
      }
      const data = (await r.json()) as GRVResearch;
      setCachedResearch(key, data);
      setLiveResult(data);
    } catch (e) {
      setLiveError(e instanceof Error ? e.message : 'Live research request failed.');
    } finally {
      setLiveLoading(false);
    }
  };

  return (
    <div className="mb-4 border border-emerald-200 bg-emerald-50 rounded">
      <button
        type="button"
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-emerald-100 rounded-t"
      >
        <span className="text-xs font-bold text-emerald-800">
          {expanded ? '▼' : '▶'} GRV Reference / Sales Price Benchmark — Australia
        </span>
        <span className="text-[10px] text-emerald-700 ml-auto">
          CoreLogic / JLL / Knight Frank / Colliers + optional live AI research
        </span>
      </button>

      {expanded && (
        <div className="px-3 pb-3 pt-1 border-t border-emerald-200 bg-white rounded-b">
          {propertyAddress && (
            <div className="mb-2 text-[11px] bg-emerald-50 border border-emerald-200 rounded px-2 py-1">
              <span className="font-bold text-emerald-800">Property:</span>{' '}
              <span className="text-emerald-900">{propertyAddress}</span>
              {addressMatch ? (
                <span className="text-emerald-700 ml-2">
                  → suburb <strong className="capitalize">{addressMatch.suburb}</strong>,{' '}
                  auto-seeded <strong>{addressMatch.state}</strong> / <strong>{addressMatch.locationGrade}</strong>
                  {userTouchedRef.current && ' (manually overridden below)'}.
                  <span className="block text-[10px] text-emerald-600 italic mt-0.5">
                    Live AI research will ground prices to <strong className="capitalize">{addressMatch.suburb}</strong>{' '}
                    specifically — much more precise than the state × grade average.
                  </span>
                </span>
              ) : (
                <span className="text-amber-700 ml-2 italic">
                  Suburb not in built-in table — pick state / location grade manually below.
                </span>
              )}
            </div>
          )}
          <RequiredMetricsPanel />

          <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-700 mb-1">
            Static benchmark (built-in)
          </p>

          {/* Inputs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3 text-[11px]">
            <Field label="Asset type">
              <select
                value={assetType}
                onChange={e => setAssetType(e.target.value as GRVAssetType)}
                className="w-full px-1 py-0.5 text-[11px] border border-gray-300 rounded bg-yellow-50"
              >
                {GRV_BENCHMARKS.map(b => (
                  <option key={b.assetType} value={b.assetType}>{b.label}</option>
                ))}
              </select>
            </Field>
            <Field label="State / city">
              <select
                value={state}
                onChange={e => { markTouched(); setState(e.target.value as State); }}
                className="w-full px-1 py-0.5 text-[11px] border border-gray-300 rounded bg-yellow-50"
              >
                {(Object.keys(STATE_FACTORS_GRV) as State[]).map(s => (
                  <option key={s} value={s}>
                    {s} ({((STATE_FACTORS_GRV[s] - 1) * 100 >= 0 ? '+' : '') + ((STATE_FACTORS_GRV[s] - 1) * 100).toFixed(0)}%)
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Location grade">
              <select
                value={location}
                onChange={e => { markTouched(); setLocation(e.target.value as LocationGrade); }}
                className="w-full px-1 py-0.5 text-[11px] border border-gray-300 rounded bg-yellow-50"
              >
                {(Object.keys(LOCATION_FACTORS) as LocationGrade[]).map(l => (
                  <option key={l} value={l}>
                    {l} ({((LOCATION_FACTORS[l] - 1) * 100 >= 0 ? '+' : '') + ((LOCATION_FACTORS[l] - 1) * 100).toFixed(0)}%)
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Quality / finish">
              <select
                value={quality}
                onChange={e => setQuality(e.target.value as QualityGrade)}
                className="w-full px-1 py-0.5 text-[11px] border border-gray-300 rounded bg-yellow-50"
              >
                {(Object.keys(QUALITY_FACTORS_GRV) as QualityGrade[]).map(q => (
                  <option key={q} value={q}>
                    {q} ({((QUALITY_FACTORS_GRV[q] - 1) * 100 >= 0 ? '+' : '') + ((QUALITY_FACTORS_GRV[q] - 1) * 100).toFixed(0)}%)
                  </option>
                ))}
              </select>
            </Field>
            <Field label={`Target year (base ${benchmark?.factors.baseYear ?? 2025})`}>
              <input
                type="number" min={2010} max={2040} value={targetYear}
                onChange={e => setTargetYear(parseInt(e.target.value) || CURRENT_YEAR)}
                className="w-full px-1 py-0.5 text-[11px] text-right border border-gray-300 rounded bg-yellow-50"
              />
            </Field>
            <Field label="Units / lots / keys">
              <input
                type="number" min={0} value={units || ''}
                onChange={e => setUnits(parseFloat(e.target.value) || 0)}
                className="w-full px-1 py-0.5 text-[11px] text-right border border-gray-300 rounded bg-yellow-50"
              />
            </Field>
            <Field label="Avg m² per unit (optional)">
              <input
                type="number" min={0} value={unitArea || ''}
                onChange={e => setUnitArea(parseFloat(e.target.value) || 0)}
                className="w-full px-1 py-0.5 text-[11px] text-right border border-gray-300 rounded bg-yellow-50"
              />
            </Field>
            <Field label="Total saleable area (m²)">
              <input
                type="number" min={0} value={totalArea || ''}
                onChange={e => setTotalArea(parseFloat(e.target.value) || 0)}
                className="w-full px-1 py-0.5 text-[11px] text-right border border-gray-300 rounded bg-yellow-50"
              />
            </Field>
          </div>

          {/* Custom escalation override */}
          <EscalationControl
            assetType={assetType}
            customEscalation={customEscalation}
            onChange={setCustomEscalation}
          />

          {!benchmark ? (
            <p className="text-[11px] italic text-gray-500">
              Pick an asset type (and supply a target year) to see a benchmark.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-2">
                <ResultBox
                  title={`Recommended ${pricingBasisLabel(benchmark.pricingBasis)} (${targetYear})`}
                  primary={
                    benchmark.pricingBasis === 'per-lot' || benchmark.pricingBasis === 'per-key'
                      ? `${formatCurrency(benchmark.perUnitLow)} – ${formatCurrency(benchmark.perUnitHigh)}`
                      : `$${benchmark.perUnitLow.toLocaleString()} – $${benchmark.perUnitHigh.toLocaleString()}`
                  }
                  secondary={
                    benchmark.pricingBasis === 'per-lot' || benchmark.pricingBasis === 'per-key'
                      ? `Mid: ${formatCurrency(benchmark.perUnitMid)}`
                      : `Mid: $${benchmark.perUnitMid.toLocaleString()}`
                  }
                />
                <ResultBox
                  title={`Recommended total GRV (${targetYear})`}
                  primary={
                    benchmark.totalLow !== null && benchmark.totalHigh !== null
                      ? `${formatMillions(benchmark.totalLow)} – ${formatMillions(benchmark.totalHigh)}`
                      : '— (set units/area)'
                  }
                  secondary={
                    benchmark.totalMid !== null
                      ? `Mid: ${formatMillions(benchmark.totalMid)}`
                      : ''
                  }
                />
                <ResultBox
                  title="Your model vs benchmark"
                  primary={currentTotalGRV ? formatMillions(currentTotalGRV) : '—'}
                  secondary={
                    variancePct !== null
                      ? `${variancePct >= 0 ? '+' : ''}${formatPercent(variancePct)} vs mid`
                      : 'set GRV to compare'
                  }
                  tone={
                    variancePct === null ? 'neutral'
                      : Math.abs(variancePct) <= 0.10 ? 'good'
                      : Math.abs(variancePct) <= 0.20 ? 'warn' : 'bad'
                  }
                />
              </div>

              <SourceNote label="Source" text={benchmark.source} />
              <BasisNote text={benchmark.basisNote} />

              <details className="mt-2 mb-2 text-[10px] text-gray-600">
                <summary className="cursor-pointer font-semibold text-gray-700">How was this calculated?</summary>
                <div className="mt-1 pl-3 space-y-0.5">
                  <p>
                    Base band ({benchmark.factors.baseYear} Brisbane, standard, inner-ring):{' '}
                    {benchmark.pricingBasis.startsWith('per-sqm')
                      ? `$${benchmark.factors.base[0].toLocaleString()} – $${benchmark.factors.base[1].toLocaleString()} ${pricingBasisLabel(benchmark.pricingBasis)}`
                      : `${formatCurrency(benchmark.factors.base[0])} – ${formatCurrency(benchmark.factors.base[1])} ${pricingBasisLabel(benchmark.pricingBasis)}`}
                  </p>
                  <p>State factor: ×{benchmark.factors.stateFactor.toFixed(2)} ({state})</p>
                  <p>Location factor: ×{benchmark.factors.locationFactor.toFixed(2)} ({location})</p>
                  <p>Quality factor: ×{benchmark.factors.qualityFactor.toFixed(2)} ({quality})</p>
                  {benchmark.factors.suburb && (
                    <p>
                      Suburb refinement: <strong className="capitalize">{benchmark.factors.suburb}</strong>{' '}
                      <span className="text-gray-500 italic">
                        — used in live AI research to ground prices to this sub-market; not applied to the static math
                        (locationGrade is the static lever).
                      </span>
                    </p>
                  )}
                  <p>
                    Escalation: ×{benchmark.factors.escalationFactor.toFixed(3)} (
                    {(benchmark.factors.annualEscalation * 100).toFixed(1)}% p.a. ×{' '}
                    {benchmark.factors.yearsApplied} year{Math.abs(benchmark.factors.yearsApplied) === 1 ? '' : 's'} from{' '}
                    {benchmark.factors.baseYear} → {benchmark.factors.targetYear}
                    {customEscalation !== null ? ' — user override' : ''})
                  </p>
                </div>
              </details>
            </>
          )}

          {/* Live AI research */}
          <LiveResearchPanel
            loading={liveLoading}
            error={liveError}
            result={liveResult}
            onRun={runLiveResearch}
            assetType={assetType}
            targetYear={targetYear}
            totalArea={totalArea || (unitArea && units ? unitArea * units : 0)}
            units={units}
          />

          <Disclaimer />
        </div>
      )}
    </div>
  );
}

/* ── Required-metrics explainer ─────────────────────────────────────────── */

function RequiredMetricsPanel() {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-3 border border-gray-200 rounded bg-gray-50">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-2 py-1 text-left text-[11px] font-semibold text-gray-700 hover:bg-gray-100 rounded"
      >
        {open ? '▼' : '▶'} Project metrics required for an accurate GRV benchmark
      </button>
      {open && (
        <ul className="px-3 pb-2 pt-1 space-y-0.5">
          {REQUIRED_GRV_METRICS.map(m => (
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

/* ── Escalation control ─────────────────────────────────────────────────── */

function EscalationControl({
  assetType,
  customEscalation,
  onChange,
}: {
  assetType: GRVAssetType;
  customEscalation: number | null;
  onChange: (v: number | null) => void;
}) {
  const row = ESCALATION_RATES.find(e => e.assetType === assetType);
  const defaultRate = row?.annualGrowth ?? 0.04;
  const [editing, setEditing] = useState(false);
  return (
    <div className="mb-3 p-2 border border-gray-200 rounded bg-gray-50 text-[11px]">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-medium text-gray-700">Annual price escalation:</span>
        {!editing ? (
          <>
            <span className="font-mono text-gray-900">
              {((customEscalation ?? defaultRate) * 100).toFixed(1)}% p.a.
            </span>
            <span className="text-[10px] italic text-gray-500">
              {customEscalation === null
                ? `default — ${row?.source ?? '10-yr CoreLogic / sector avg'}`
                : 'user override'}
            </span>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="ml-auto text-[10px] bg-gray-200 hover:bg-gray-300 px-1.5 py-0.5 rounded"
            >
              Override
            </button>
          </>
        ) : (
          <>
            <input
              type="number"
              step={0.1}
              defaultValue={((customEscalation ?? defaultRate) * 100).toFixed(1)}
              onChange={e => {
                const pct = parseFloat(e.target.value);
                onChange(Number.isFinite(pct) ? pct / 100 : null);
              }}
              className="w-20 px-1 py-0.5 text-[11px] text-right border border-gray-300 rounded bg-yellow-50"
            />
            <span className="text-gray-700">% p.a.</span>
            <button
              type="button"
              onClick={() => { onChange(null); setEditing(false); }}
              className="text-[10px] bg-gray-200 hover:bg-gray-300 px-1.5 py-0.5 rounded"
            >
              Reset to default
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="text-[10px] bg-emerald-600 hover:bg-emerald-700 text-white px-1.5 py-0.5 rounded"
            >
              Done
            </button>
          </>
        )}
      </div>
      <p className="text-[10px] text-gray-500 mt-1">
        Escalation projects the {row?.source ?? '10-yr average'} forward / backward to your target year.
        Linear projection — best for ≤ 5 years.
      </p>
    </div>
  );
}

/* ── Live AI research panel ─────────────────────────────────────────────── */

function LiveResearchPanel({
  loading, error, result, onRun, assetType, targetYear, totalArea, units,
}: {
  loading: boolean;
  error: string | null;
  result: GRVResearch | null;
  onRun: (forceRefresh?: boolean) => void;
  assetType: GRVAssetType;
  targetYear: number;
  totalArea: number;
  units: number;
}) {
  return (
    <div className="mt-4 pt-3 border-t border-emerald-200">
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <p className="text-[10px] font-bold uppercase tracking-wide text-purple-700">
          Live AI research (Gemini with web search)
        </p>
        <button
          type="button"
          onClick={() => onRun(false)}
          disabled={loading}
          className="text-[11px] bg-purple-600 hover:bg-purple-700 disabled:opacity-40 text-white px-3 py-1 rounded"
        >
          {loading ? 'Researching…' : `Research live ${targetYear} prices`}
        </button>
        {result && !loading && (
          <button
            type="button"
            onClick={() => onRun(true)}
            title="Bypass the cached result and re-query the AI (uses Gemini quota)"
            className="text-[11px] border border-purple-300 text-purple-700 hover:bg-purple-50 px-2 py-1 rounded"
          >
            ↻ Refresh
          </button>
        )}
        {result?.cached && (
          <span className="text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded">
            cached
          </span>
        )}
        <span className="text-[10px] text-gray-500 italic ml-auto">
          Uses Admin → AI Settings (Gemini API key)
        </span>
      </div>

      {error && (
        <div className="p-2 mb-2 text-[11px] bg-red-50 border border-red-200 text-red-800 rounded">
          <span className="font-semibold">Live research failed:</span> {error}
          {error.toLowerCase().includes('not configured') && (
            <span className="block mt-1 text-red-600">
              The static benchmark above remains available. To enable live research, add a Gemini
              API key in Admin → AI Settings (free tier from aistudio.google.com).
            </span>
          )}
        </div>
      )}

      {result && (
        <div className="border border-purple-300 bg-purple-50 rounded p-2">
          {result.cotality?.used && (
            <div className="mb-2 text-[10px] inline-flex items-center gap-1 bg-blue-100 border border-blue-300 text-blue-900 rounded px-1.5 py-0.5">
              <span aria-hidden="true">◆</span> Grounded in Cotality property data
              {result.cotality.url && (
                <a href={result.cotality.url} target="_blank" rel="noopener" className="underline ml-1">(source)</a>
              )}
            </div>
          )}
          {result.cotality && !result.cotality.used && result.cotality.reason && (
            <div className="mb-2 text-[10px] bg-amber-50 border border-amber-200 text-amber-800 rounded px-1.5 py-0.5">
              {result.cotality.reason}
            </div>
          )}
          <p className="text-[11px] text-gray-800 mb-2">{result.summary}</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-2">
            <ResultBox
              title={`AI-researched ${result.pricingBasis ?? 'price'}`}
              primary={`$${result.perUnitLow.toLocaleString()} – $${result.perUnitHigh.toLocaleString()}`}
              secondary={`Mid: $${Math.round((result.perUnitLow + result.perUnitHigh) / 2).toLocaleString()}`}
            />
            <ResultBox
              title="AI-researched total GRV"
              primary={
                result.totalLow !== undefined && result.totalHigh !== undefined && result.totalLow > 0
                  ? `${formatMillions(result.totalLow)} – ${formatMillions(result.totalHigh)}`
                  : (totalArea > 0 || units > 0
                    ? `${formatMillions((isPerUnitBasis(result.pricingBasis) ? units : totalArea) * result.perUnitLow)} – ${formatMillions((isPerUnitBasis(result.pricingBasis) ? units : totalArea) * result.perUnitHigh)}`
                    : '— (set area/units)')
              }
              secondary={
                result.totalLow !== undefined && result.totalHigh !== undefined && result.totalLow > 0
                  ? `Mid: ${formatMillions((result.totalLow + result.totalHigh) / 2)}`
                  : ''
              }
            />
          </div>

          {result.breakdown && result.breakdown.length > 0 && (
            <div className="overflow-x-auto mb-2">
              <table className="w-full text-[11px] border-collapse">
                <thead>
                  <tr className="bg-purple-200 text-purple-900">
                    <th className="px-2 py-1 text-left">Sub-segment</th>
                    <th className="px-2 py-1 text-right w-28">Low</th>
                    <th className="px-2 py-1 text-right w-28">High</th>
                    <th className="px-2 py-1 text-left w-24">Basis</th>
                    <th className="px-2 py-1 text-left">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {result.breakdown.map((row, i) => (
                    <tr key={`${row.label}-${i}`} className={i % 2 === 0 ? 'bg-white' : 'bg-purple-50'}>
                      <td className="px-2 py-0.5">{row.label}</td>
                      <td className="px-2 py-0.5 text-right font-mono">${row.perUnitLow.toLocaleString()}</td>
                      <td className="px-2 py-0.5 text-right font-mono">${row.perUnitHigh.toLocaleString()}</td>
                      <td className="px-2 py-0.5 text-[10px] italic text-gray-600">{row.pricingBasis ?? ''}</td>
                      <td className="px-2 py-0.5 text-[10px] text-gray-700">{row.note ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <SourcesList sources={result.sources} model={result.model} timestamp={result.timestamp} assetLabel={`${assetType} (${targetYear})`} />
        </div>
      )}
    </div>
  );
}

function isPerUnitBasis(basis?: string): boolean {
  if (!basis) return false;
  const b = basis.toLowerCase();
  return b.includes('lot') || b.includes('key') || b.includes('dwelling');
}

function SourcesList({
  sources, model, timestamp, assetLabel,
}: {
  sources: ResearchSource[];
  model: string;
  timestamp: string;
  assetLabel: string;
}) {
  const date = new Date(timestamp);
  return (
    <div className="border-t border-purple-200 pt-2 mt-1">
      <p className="text-[10px] font-bold uppercase tracking-wide text-purple-800 mb-1">
        Sources cited by AI for {assetLabel}
      </p>
      {sources.length === 0 ? (
        <p className="text-[11px] italic text-gray-500">No sources returned.</p>
      ) : (
        <ul className="space-y-1">
          {sources.map((s, i) => (
            <li key={`${s.url}-${i}`} className="text-[11px] text-gray-700">
              <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-blue-700 underline hover:text-blue-900 font-medium">
                {s.title}
              </a>
              {s.snippet && <span className="text-gray-500"> — {s.snippet}</span>}
            </li>
          ))}
        </ul>
      )}
      <p className="text-[10px] italic text-gray-500 mt-1">
        Generated by {model} at {date.toLocaleString()}. Verify against
        the linked sources before relying on these figures.
      </p>
    </div>
  );
}

/* ── Generic helpers ────────────────────────────────────────────────────── */

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wide text-gray-500">{label}</span>
      {children}
    </label>
  );
}

function ResultBox({
  title, primary, secondary, tone = 'neutral',
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

function SourceNote({ label, text }: { label: string; text: string }) {
  return (
    <div className="text-[11px] bg-amber-50 border border-amber-200 rounded px-2 py-1">
      <span className="font-bold text-amber-800">{label}:</span>{' '}
      <span className="text-amber-900">{text}</span>
    </div>
  );
}

function BasisNote({ text }: { text: string }) {
  return (
    <div className="mt-1 text-[10px] bg-blue-50 border border-blue-200 rounded px-2 py-1">
      <span className="font-bold text-blue-800">Basis & GST:</span>{' '}
      <span className="text-blue-900">{text}</span>
    </div>
  );
}

function Disclaimer() {
  return (
    <p className="text-[10px] text-gray-500 italic mt-3">
      Indicative ranges for sanity-checking only. Real sales prices vary materially with view,
      orientation, podium / tower position, balcony size, parking allocation, settlement timing,
      and stock release strategy. Validate against a registered valuer (CBRE / JLL / Colliers /
      Knight Frank / Savills / Cushman & Wakefield / Charter Keck Cramer) before relying on
      these figures. Linear escalation is an approximation; real markets are cyclical.
    </p>
  );
}

/** Pricing basis type re-export for parent components if needed. */
export type { PricingBasis };
