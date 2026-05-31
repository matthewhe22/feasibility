import { useState } from 'react';
import { formatCurrency } from '../../utils';

/**
 * Retirement Village Property Research.
 *
 * Two independent research tools that combine the configured AI model (Admin →
 * AI Settings) with optional Cotality property data (Admin → Cotality Data):
 *   1. Surrounding-suburb pricing — median house / unit / $m² per related
 *      suburb + indicative averages (MHP, MUP, avg $/m²).
 *   2. Competitor villages — recently sold / listed units within a proximity
 *      radius, with price, date, beds, baths, study where available.
 */

const STATES = ['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'];

interface ResearchSource { title: string; url: string; snippet?: string }
interface CotalityNote { used: boolean; url?: string; reason?: string }

interface SuburbRow {
  suburb: string;
  state?: string;
  postcode?: string;
  distanceKm?: number | null;
  medianHousePrice?: number | null;
  medianUnitPrice?: number | null;
  medianDollarPerSqm?: number | null;
  asOf?: string | null;
}
interface SuburbsResult {
  village?: { name?: string; suburb?: string; state?: string; postcode?: string };
  suburbs: SuburbRow[];
  averages?: { avgMedianHousePrice?: number | null; avgMedianUnitPrice?: number | null; avgDollarPerSqm?: number | null };
  summary: string;
  sources: ResearchSource[];
  model?: string;
  provider?: string;
  timestamp?: string;
  cotality?: CotalityNote;
  groundingUsed?: boolean;
}

interface UnitRow {
  villageName: string;
  address?: string | null;
  suburb?: string | null;
  distanceKm?: number | null;
  priceType?: 'sold' | 'listing' | null;
  price?: number | null;
  date?: string | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  study?: boolean | null;
  unitType?: string | null;
  note?: string | null;
  source?: string | null;
  sourceUrl?: string | null;
}
interface CompetitorsResult {
  subject?: { name?: string; suburb?: string; state?: string; postcode?: string };
  proximityKm?: number;
  units: UnitRow[];
  summary: string;
  sources: ResearchSource[];
  model?: string;
  provider?: string;
  timestamp?: string;
  cotality?: CotalityNote;
  groundingUsed?: boolean;
}

const money = (v?: number | null) => (typeof v === 'number' && isFinite(v) ? formatCurrency(v) : '—');
const num = (v?: number | null) => (typeof v === 'number' && isFinite(v) ? String(v) : '—');
const avg = (xs: Array<number | null | undefined>) => {
  const v = xs.filter((x): x is number => typeof x === 'number' && isFinite(x));
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
};

export function RetirementVillageResearch() {
  const [villageName, setVillageName] = useState('');
  const [state, setState] = useState('');
  const [suburb, setSuburb] = useState('');
  const [postcode, setPostcode] = useState('');
  const [proximityKm, setProximityKm] = useState(5);

  const [subLoading, setSubLoading] = useState(false);
  const [subError, setSubError] = useState<string | null>(null);
  const [subResult, setSubResult] = useState<SuburbsResult | null>(null);

  const [compLoading, setCompLoading] = useState(false);
  const [compError, setCompError] = useState<string | null>(null);
  const [compResult, setCompResult] = useState<CompetitorsResult | null>(null);

  const body = () => ({
    villageName: villageName.trim(),
    state: state || undefined,
    suburb: suburb.trim() || undefined,
    postcode: postcode.trim() || undefined,
    proximityKm,
  });

  async function research<T>(mode: 'suburbs' | 'competitors'): Promise<T> {
    const r = await fetch('/api/research/retirement-village', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode, ...body() }),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({ error: r.statusText }));
      throw new Error(err.error || `HTTP ${r.status}`);
    }
    return (await r.json()) as T;
  }

  const runSuburbs = async () => {
    if (!villageName.trim()) { setSubError('Enter a retirement village name first.'); return; }
    setSubLoading(true); setSubError(null); setSubResult(null);
    try { setSubResult(await research<SuburbsResult>('suburbs')); }
    catch (e) { setSubError(e instanceof Error ? e.message : 'Research failed.'); }
    finally { setSubLoading(false); }
  };

  const runCompetitors = async () => {
    if (!villageName.trim()) { setCompError('Enter a retirement village name first.'); return; }
    setCompLoading(true); setCompError(null); setCompResult(null);
    try { setCompResult(await research<CompetitorsResult>('competitors')); }
    catch (e) { setCompError(e instanceof Error ? e.message : 'Research failed.'); }
    finally { setCompLoading(false); }
  };

  // Recompute averages client-side as a fallback if the model omitted them.
  const avgMHP = subResult?.averages?.avgMedianHousePrice ?? avg((subResult?.suburbs ?? []).map(s => s.medianHousePrice));
  const avgMUP = subResult?.averages?.avgMedianUnitPrice ?? avg((subResult?.suburbs ?? []).map(s => s.medianUnitPrice));
  const avgPSM = subResult?.averages?.avgDollarPerSqm ?? avg((subResult?.suburbs ?? []).map(s => s.medianDollarPerSqm));

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-4">
        <h2 className="text-lg font-bold text-gray-800">Retirement Village Property Research</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          Combines the configured AI model (Admin → AI Settings) with Cotality property data (Admin → Cotality Data)
          to research surrounding-suburb pricing and nearby retirement-village competitors. Figures are indicative —
          verify against the linked sources before relying on them.
        </p>
        <p className="text-[11px] text-amber-700 mt-1">
          Tip: live results (current villages.com.au / downsizing.com.au listings) need a <strong>Gemini</strong> model
          with web search — DeepSeek has no live search and answers from training data only. Set this in Admin → AI Settings.
        </p>
      </div>

      {/* Shared inputs */}
      <div className="border border-gray-200 bg-white rounded p-3 mb-4">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
          <Field className="md:col-span-5" label="Retirement village name *">
            <input value={villageName} onChange={e => setVillageName(e.target.value)}
              placeholder="e.g. Aveo Springfield"
              className="w-full text-sm border border-gray-300 rounded px-2 py-1.5 bg-yellow-50 focus:ring-1 focus:ring-blue-400" />
          </Field>
          <Field className="md:col-span-2" label="State">
            <select value={state} onChange={e => setState(e.target.value)}
              className="w-full text-sm border border-gray-300 rounded px-2 py-1.5 bg-yellow-50 focus:ring-1 focus:ring-blue-400">
              <option value="">(auto)</option>
              {STATES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field className="md:col-span-3" label="Suburb (optional — improves grounding)">
            <input value={suburb} onChange={e => setSuburb(e.target.value)}
              className="w-full text-sm border border-gray-300 rounded px-2 py-1.5 bg-yellow-50 focus:ring-1 focus:ring-blue-400" />
          </Field>
          <Field className="md:col-span-2" label="Postcode (optional)">
            <input value={postcode} onChange={e => setPostcode(e.target.value)} inputMode="numeric"
              className="w-full text-sm border border-gray-300 rounded px-2 py-1.5 bg-yellow-50 focus:ring-1 focus:ring-blue-400" />
          </Field>
        </div>
      </div>

      {/* Section 1 — Surrounding suburb pricing */}
      <Section
        title="1. Surrounding-suburb pricing"
        subtitle="Median house price (MHP), median unit price (MUP) and median $/m² for the village's suburb and adjacent suburbs."
        onRun={runSuburbs}
        running={subLoading}
        runLabel="Research suburb prices"
      >
        {subError && <ErrorBox error={subError} />}
        {subResult && (
          <div>
            <Meta result={subResult} />
            <p className="text-[11px] text-gray-700 mb-2">{subResult.summary}</p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-gray-100 text-left">
                    <Th>Suburb</Th><Th>State</Th><Th className="text-right">Median House</Th>
                    <Th className="text-right">Median Unit</Th><Th className="text-right">Median $/m²</Th>
                    <Th className="text-right">Dist (km)</Th><Th>As of</Th>
                  </tr>
                </thead>
                <tbody>
                  {subResult.suburbs?.map((s, i) => (
                    <tr key={i} className="border-b border-gray-100">
                      <Td className="capitalize font-medium">{s.suburb}</Td>
                      <Td>{s.state ?? '—'}{s.postcode ? ` ${s.postcode}` : ''}</Td>
                      <Td className="text-right font-mono">{money(s.medianHousePrice)}</Td>
                      <Td className="text-right font-mono">{money(s.medianUnitPrice)}</Td>
                      <Td className="text-right font-mono">{money(s.medianDollarPerSqm)}</Td>
                      <Td className="text-right">{num(s.distanceKm)}</Td>
                      <Td className="text-gray-500">{s.asOf ?? '—'}</Td>
                    </tr>
                  ))}
                  <tr className="bg-emerald-50 font-bold border-t-2 border-emerald-300">
                    <Td className="text-emerald-900">Indicative average</Td><Td />
                    <Td className="text-right font-mono text-emerald-900">{money(avgMHP)}</Td>
                    <Td className="text-right font-mono text-emerald-900">{money(avgMUP)}</Td>
                    <Td className="text-right font-mono text-emerald-900">{money(avgPSM)}</Td>
                    <Td /><Td />
                  </tr>
                </tbody>
              </table>
            </div>
            <Averages avgMHP={avgMHP} avgMUP={avgMUP} avgPSM={avgPSM} />
            <Sources sources={subResult.sources} />
          </div>
        )}
      </Section>

      {/* Section 2 — Competitor villages */}
      <Section
        title="2. Competitor retirement villages"
        subtitle="Recently sold / listed units within the proximity radius (price, date, beds, baths, study), sourced from villages.com.au, downsizing.com.au, operator sites & portals."
        onRun={runCompetitors}
        running={compLoading}
        runLabel="Research competitors"
        extraControl={
          <label className="flex items-center gap-1.5 text-[11px] text-gray-600">
            Proximity
            <input type="number" min={1} max={50} value={proximityKm}
              onChange={e => setProximityKm(Math.max(1, parseInt(e.target.value, 10) || 5))}
              className="w-16 text-xs border border-gray-300 rounded px-1.5 py-1 bg-yellow-50 text-right" />
            km
          </label>
        }
      >
        {compError && <ErrorBox error={compError} />}
        {compResult && (
          <div>
            <Meta result={compResult} />
            <p className="text-[11px] text-gray-700 mb-2">{compResult.summary}</p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-gray-100 text-left">
                    <Th>Village</Th><Th>Type</Th><Th className="text-right">Beds</Th>
                    <Th className="text-right">Baths</Th><Th className="text-center">Study</Th>
                    <Th className="text-right">Price</Th><Th>Sold / Listing</Th><Th>Date</Th><Th className="text-right">Dist</Th><Th>Source</Th>
                  </tr>
                </thead>
                <tbody>
                  {compResult.units?.length ? compResult.units.map((u, i) => (
                    <tr key={i} className="border-b border-gray-100 align-top">
                      <Td className="font-medium">{u.villageName}
                        {(u.suburb || u.address) && <span className="block text-[10px] text-gray-500">{u.address || u.suburb}</span>}
                        {u.note && <span className="block text-[10px] text-gray-400 italic">{u.note}</span>}
                      </Td>
                      <Td>{u.unitType ?? '—'}</Td>
                      <Td className="text-right">{num(u.bedrooms)}</Td>
                      <Td className="text-right">{num(u.bathrooms)}</Td>
                      <Td className="text-center">{u.study == null ? '—' : u.study ? 'Yes' : 'No'}</Td>
                      <Td className="text-right font-mono">{money(u.price)}</Td>
                      <Td>{u.priceType ? <Badge type={u.priceType} /> : '—'}</Td>
                      <Td className="text-gray-600">{u.date ?? '—'}</Td>
                      <Td className="text-right">{num(u.distanceKm)}</Td>
                      <Td>
                        {u.sourceUrl
                          ? <a href={u.sourceUrl} target="_blank" rel="noopener" className="text-blue-600 underline">{u.source || 'link'}</a>
                          : (u.source ?? '—')}
                      </Td>
                    </tr>
                  )) : (
                    <tr><Td className="text-gray-500 italic">No competitor units returned.</Td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <Sources sources={compResult.sources} />
          </div>
        )}
      </Section>
    </div>
  );
}

/* ── small presentational helpers ──────────────────────────────────────────── */

function Field({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="block text-[11px] text-gray-600 mb-1">{label}</span>
      {children}
    </label>
  );
}

function Section({
  title, subtitle, onRun, running, runLabel, extraControl, children,
}: {
  title: string; subtitle: string; onRun: () => void; running: boolean; runLabel: string;
  extraControl?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div className="border border-gray-200 bg-white rounded mb-4">
      <div className="flex items-center gap-3 px-3 py-2 border-b border-gray-200 bg-gray-50 rounded-t flex-wrap">
        <div className="flex-1 min-w-[200px]">
          <h3 className="text-sm font-bold text-gray-800">{title}</h3>
          <p className="text-[10px] text-gray-500">{subtitle}</p>
        </div>
        {extraControl}
        <button onClick={onRun} disabled={running}
          className="text-[11px] bg-purple-600 hover:bg-purple-700 disabled:opacity-40 text-white px-3 py-1.5 rounded font-medium">
          {running ? 'Researching…' : runLabel}
        </button>
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}

function Th({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return <th scope="col" className={`px-2 py-1.5 font-semibold text-gray-600 ${className}`}>{children}</th>;
}
function Td({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return <td className={`px-2 py-1.5 ${className}`}>{children}</td>;
}

function Badge({ type }: { type: 'sold' | 'listing' }) {
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${
      type === 'sold' ? 'bg-green-50 border-green-300 text-green-800' : 'bg-blue-50 border-blue-300 text-blue-800'
    }`}>{type === 'sold' ? 'Sold' : 'Listing'}</span>
  );
}

function Averages({ avgMHP, avgMUP, avgPSM }: { avgMHP: number | null; avgMUP: number | null; avgPSM: number | null }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-3">
      <Stat label="Indicative avg median house price (MHP)" value={money(avgMHP)} />
      <Stat label="Indicative avg median unit price (MUP)" value={money(avgMUP)} />
      <Stat label="Indicative avg $/m²" value={money(avgPSM)} />
    </div>
  );
}
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-emerald-200 bg-emerald-50 rounded p-2 text-center">
      <div className="text-[10px] text-emerald-700">{label}</div>
      <div className="text-base font-bold font-mono text-emerald-900">{value}</div>
    </div>
  );
}

function Meta({ result }: { result: { model?: string; provider?: string; cotality?: CotalityNote; groundingUsed?: boolean; tavily?: { used: boolean; results?: number } } }) {
  // groundingUsed is explicitly false when the active model has no live web
  // search (DeepSeek) OR when Gemini's grounding fell back (quota/permission).
  // Without live search the model relies on training data — it can't pull
  // current villages.com.au / downsizing.com.au listings — so warn the user.
  const noWebSearch = result.groundingUsed === false;
  return (
    <div className="mb-2">
      <div className="flex items-center gap-2 flex-wrap">
        {result.cotality?.used && (
          <span className="text-[10px] inline-flex items-center gap-1 bg-blue-100 border border-blue-300 text-blue-900 rounded px-1.5 py-0.5">
            ◆ Grounded in Cotality data
            {result.cotality.url && <a href={result.cotality.url} target="_blank" rel="noopener" className="underline ml-1">(source)</a>}
          </span>
        )}
        {result.groundingUsed
          ? <span className="text-[10px] bg-purple-50 border border-purple-200 text-purple-700 rounded px-1.5 py-0.5">Live web search{result.tavily?.used ? ` (Tavily${result.tavily.results ? `, ${result.tavily.results} results` : ''})` : ''}</span>
          : <span className="text-[10px] bg-amber-50 border border-amber-300 text-amber-800 rounded px-1.5 py-0.5">No live web search</span>}
        {result.model && <span className="text-[10px] text-gray-400">model: {result.model}</span>}
        {result.cotality && !result.cotality.used && result.cotality.reason && (
          <span className="text-[10px] text-amber-700">{result.cotality.reason}</span>
        )}
      </div>
      {noWebSearch && (
        <div className="mt-1.5 text-[10px] bg-amber-50 border border-amber-300 text-amber-800 rounded px-2 py-1">
          ⚠ The active model{result.provider ? ` (${result.provider})` : ''} ran <strong>without live web search</strong>, so these
          figures come from the model's training data — they may be stale and won't reflect current
          villages.com.au / downsizing.com.au listings. For live, sourced results switch to a
          <strong> Gemini</strong> model in <span className="font-mono">Admin → AI Settings</span>
          {result.provider === 'gemini' ? ' (Gemini grounding fell back — likely a quota/permission limit; wait and retry or enable billing).' : '.'}
        </div>
      )}
    </div>
  );
}

function ErrorBox({ error }: { error: string }) {
  return (
    <div className="p-2 mb-2 text-[11px] bg-red-50 border border-red-200 text-red-800 rounded">
      <span className="font-semibold">Research failed:</span> {error}
      {error.toLowerCase().includes('not configured') && (
        <span className="block mt-1 text-red-600">Add a Gemini API key in Admin → AI Settings (free tier from aistudio.google.com).</span>
      )}
    </div>
  );
}

function Sources({ sources }: { sources?: ResearchSource[] }) {
  if (!sources?.length) return <p className="text-[10px] italic text-gray-400 mt-2">No sources returned.</p>;
  return (
    <div className="mt-3">
      <p className="text-[10px] font-semibold text-gray-500 mb-1">Sources</p>
      <ul className="space-y-0.5">
        {sources.map((s, i) => (
          <li key={i} className="text-[10px]">
            <a href={s.url} target="_blank" rel="noopener" className="text-blue-600 underline">{s.title || s.url}</a>
          </li>
        ))}
      </ul>
      <p className="text-[10px] text-gray-400 mt-2 italic">
        Indicative only — retirement-village units often transact under licence / DMF arrangements. Verify against the linked sources.
      </p>
    </div>
  );
}
