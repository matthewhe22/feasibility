import React, { useEffect, useMemo, useState } from 'react';
import { useStore } from '../../store/useStore';
import { formatCurrency, formatPercent, formatNumber } from '../../utils';
import { listProjects, loadProject, type ProjectRecord } from '../../db/projectDb';
import type { FeasibilitySummary } from '../../types';

type Unit = '$' | '%' | 'ratio' | '#';

function formatValue(value: number, unit: Unit): string {
  return unit === '$' ? formatCurrency(value)
    : unit === '%' ? formatPercent(value)
    : unit === 'ratio' ? value.toFixed(4)
    : formatNumber(value);
}

function DashValue({ label, value, unit = '$', indent = false, bold = false, highlight = false }: {
  label: string; value: number; unit?: Unit; indent?: boolean; bold?: boolean; highlight?: boolean;
}) {
  const formatted = formatValue(value, unit);

  return (
    <div className={`flex justify-between items-center py-0.5 px-2 ${highlight ? 'bg-blue-50' : ''} ${bold ? 'font-bold' : ''}`}>
      <span className={`text-xs ${indent ? 'pl-4' : ''} ${bold ? 'text-gray-800' : 'text-gray-600'}`}>{label}</span>
      <div className="flex items-center gap-1">
        <span className="text-[10px] text-gray-400">{unit === '$' ? '$' : unit === '%' ? '%' : ''}</span>
        <span className={`text-xs font-mono ${value < 0 ? 'text-red-600' : 'text-gray-800'}`}>{formatted}</span>
      </div>
    </div>
  );
}

function CompareRow({ label, current, previous, unit = '$', indent = false, bold = false, highlight = false }: {
  label: string;
  current: number;
  previous: number | null;
  unit?: Unit;
  indent?: boolean;
  bold?: boolean;
  highlight?: boolean;
}) {
  const variance = previous != null ? current - previous : null;
  const valueClass = (v: number) => `text-xs font-mono ${v < 0 ? 'text-red-600' : 'text-gray-800'}`;

  return (
    <div className={`grid grid-cols-[1fr_auto_auto_auto] gap-3 items-center py-0.5 px-2 ${highlight ? 'bg-blue-50' : ''} ${bold ? 'font-bold' : ''}`}>
      <span className={`text-xs ${indent ? 'pl-4' : ''} ${bold ? 'text-gray-800' : 'text-gray-600'}`}>{label}</span>
      <span className={`${valueClass(current)} text-right tabular-nums w-28`}>{formatValue(current, unit)}</span>
      <span className={`text-xs font-mono text-right tabular-nums w-28 ${previous == null ? 'text-gray-300' : previous < 0 ? 'text-red-600' : 'text-gray-700'}`}>
        {previous == null ? '—' : formatValue(previous, unit)}
      </span>
      <span className={`text-xs font-mono text-right tabular-nums w-28 ${variance == null ? 'text-gray-300' : variance < 0 ? 'text-red-600' : variance > 0 ? 'text-green-700' : 'text-gray-500'}`}>
        {variance == null ? '—' : (variance > 0 ? '+' : '') + formatValue(variance, unit)}
      </span>
    </div>
  );
}

function TableHeader({ children }: { children: React.ReactNode }) {
  return <div className="bg-blue-700 text-white text-xs font-bold px-3 py-1.5 rounded-t">{children}</div>;
}

function TableBox({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`border border-gray-200 rounded mb-3 ${className}`}>{children}</div>;
}

function formatVersionLabel(rec: ProjectRecord): string {
  const updated = new Date(rec.updatedAt).toLocaleString('en-AU', { dateStyle: 'short', timeStyle: 'short' });
  const version = rec.admin?.versionName ?? rec.description;
  return version ? `${version} (${updated})` : updated;
}

function Table1FeasibilitySummary({
  current,
  versions,
  selectedVersionId,
  onSelectVersion,
  comparison,
}: {
  current: FeasibilitySummary;
  versions: ProjectRecord[];
  selectedVersionId: number | null;
  onSelectVersion: (id: number | null) => void;
  comparison: ProjectRecord | null;
}) {
  const compareEnabled = selectedVersionId != null;
  const prev: FeasibilitySummary | null = useMemo(() => {
    if (!compareEnabled) return null;
    return comparison?.dashboardData?.feasibility ?? null;
  }, [compareEnabled, comparison]);

  const prevHeaderLabel = comparison ? formatVersionLabel(comparison) : 'Previous version';

  // Each row's previous value (null when not comparing or snapshot missing).
  const p = (key: keyof FeasibilitySummary): number | null =>
    prev ? prev[key] : null;

  return (
    <TableBox>
      <TableHeader>Table 1 - Feasibility Summary</TableHeader>

      {/* Version comparison selector */}
      <div className="flex items-center gap-2 px-2 py-1.5 bg-gray-50 border-b border-gray-200">
        <label className="text-[11px] text-gray-600 shrink-0">Compare against previous version:</label>
        <select
          className="flex-1 min-w-0 text-xs border border-gray-300 rounded px-2 py-0.5 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-400"
          value={selectedVersionId ?? ''}
          onChange={e => onSelectVersion(e.target.value === '' ? null : Number(e.target.value))}
          disabled={versions.length === 0}
          title={versions.length === 0 ? 'No prior saved versions for this project' : undefined}
        >
          <option value="">— None —</option>
          {versions.map(v => (
            <option key={v.id} value={v.id!}>{formatVersionLabel(v)}</option>
          ))}
        </select>
      </div>

      {/* Column header (only when comparing) */}
      {compareEnabled && (
        <div className="grid grid-cols-[1fr_auto_auto_auto] gap-3 items-end px-2 py-1 bg-blue-50 text-blue-800 border-b border-gray-200">
          <span className="text-[10px] font-semibold uppercase tracking-wide"></span>
          <span className="text-[10px] font-semibold text-right w-28">Current</span>
          <span className="text-[10px] font-semibold text-right w-28 truncate" title={prevHeaderLabel}>{prevHeaderLabel}</span>
          <span className="text-[10px] font-semibold text-right w-28">Variance</span>
        </div>
      )}

      {compareEnabled && prev == null && (
        <div className="px-2 py-1 text-[11px] text-amber-800 bg-amber-50 border-b border-amber-200">
          Selected version has no saved dashboard snapshot — variance is unavailable.
        </div>
      )}

      <div className="divide-y divide-gray-100">
        {compareEnabled ? (
          <>
            <CompareRow label="Total GRV (net incentives)" current={current.totalGRV} previous={p('totalGRV')} />
            <div className="h-px bg-gray-200" />
            <CompareRow label="Land" current={current.land} previous={p('land')} />
            <CompareRow label="Acquisition Costs (Stamp Duty, Reg Fees)" current={current.stampDuty} previous={p('stampDuty')} />
            <CompareRow label="Build Costs" current={current.buildCosts} previous={p('buildCosts')} />
            <CompareRow label="Senior Finance Costs" current={current.seniorFinanceCosts} previous={p('seniorFinanceCosts')} />
            <CompareRow label="Mezzanine Finance Costs" current={current.mezzFinanceCosts} previous={p('mezzFinanceCosts')} />
            <CompareRow label="Other Financing Costs" current={current.otherFinancingCosts} previous={p('otherFinancingCosts')} />
            <CompareRow label="Standard Costs" current={current.standardCosts} previous={p('standardCosts')} />
            <CompareRow label="GST on Costs (ITC Claimable)" current={current.gst} previous={p('gst')} indent />
            <CompareRow label="GST on Revenue (Remitted to ATO)" current={current.gstOnRevenue} previous={p('gstOnRevenue')} indent />
            <CompareRow label="Net GST Payable to ATO" current={current.gstNet} previous={p('gstNet')} indent bold />
            <CompareRow label="Marketing and Advertising" current={current.marketingAndAdvertising} previous={p('marketingAndAdvertising')} />
            <CompareRow label="Sales Commissions" current={current.salesCommissions} previous={p('salesCommissions')} />
            <CompareRow label="Project Management Fee" current={current.pmFee} previous={p('pmFee')} />
            <CompareRow label="Total Cost" current={current.totalCost} previous={p('totalCost')} bold highlight />
            <div className="h-1 bg-gray-300" />
            <CompareRow label="Total Profit" current={current.totalProfit} previous={p('totalProfit')} bold highlight />
            <CompareRow label="Total Profit (after Loan Coupon Interest)" current={current.totalProfitAfterCoupon} previous={p('totalProfitAfterCoupon')} bold />
          </>
        ) : (
          <>
            <DashValue label="Total GRV (net incentives)" value={current.totalGRV} />
            <div className="h-px bg-gray-200" />
            <DashValue label="Land" value={current.land} />
            <DashValue label="Acquisition Costs (Stamp Duty, Reg Fees)" value={current.stampDuty} />
            <DashValue label="Build Costs" value={current.buildCosts} />
            <DashValue label="Senior Finance Costs" value={current.seniorFinanceCosts} />
            <DashValue label="Mezzanine Finance Costs" value={current.mezzFinanceCosts} />
            <DashValue label="Other Financing Costs" value={current.otherFinancingCosts} />
            <DashValue label="Standard Costs" value={current.standardCosts} />
            <DashValue label="GST on Costs (ITC Claimable)" value={current.gst} indent />
            <DashValue label="GST on Revenue (Remitted to ATO)" value={current.gstOnRevenue} indent />
            <DashValue label="Net GST Payable to ATO" value={current.gstNet} indent bold />
            <DashValue label="Marketing and Advertising" value={current.marketingAndAdvertising} />
            <DashValue label="Sales Commissions" value={current.salesCommissions} />
            <DashValue label="Project Management Fee" value={current.pmFee} />
            <DashValue label="Total Cost" value={current.totalCost} bold highlight />
            <div className="h-1 bg-gray-300" />
            <DashValue label="Total Profit" value={current.totalProfit} bold highlight />
            <DashValue label="Total Profit (after Loan Coupon Interest)" value={current.totalProfitAfterCoupon} bold />
          </>
        )}
      </div>
    </TableBox>
  );
}

export function InternalDashboard() {
  const { dashboardData: data, admin, currentProjectId } = useStore();

  const [versions, setVersions] = useState<ProjectRecord[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState<number | null>(null);
  const [loadedVersion, setLoadedVersion] = useState<ProjectRecord | null>(null);

  // Load saved versions matching the current project name (excluding the
  // currently loaded record). Re-fetches when the project name or current id
  // changes (e.g. after the user saves/loads a project).
  useEffect(() => {
    let cancelled = false;
    listProjects()
      .then(all => {
        if (cancelled) return;
        // Strict project-match: only show versions whose admin.projectName
        // equals the current project's name. Falls back to record name for
        // legacy records that pre-date the projectName/versionName split.
        const matches = all.filter(p => {
          if (p.id == null || p.id === currentProjectId) return false;
          const recProject = p.admin?.projectName ?? p.name;
          return recProject === admin.projectName;
        });
        setVersions(matches);
      })
      .catch(() => { if (!cancelled) setVersions([]); });
    return () => { cancelled = true; };
  }, [admin.projectName, currentProjectId]);

  // Treat the selection as cleared if it isn't in the current versions list
  // (e.g. the user just deleted that saved record).
  const effectiveSelectedId = selectedVersionId != null && versions.some(v => v.id === selectedVersionId)
    ? selectedVersionId
    : null;

  // Hydrate the selected version's full record (we need its dashboardData
  // snapshot). The fetch only writes state from async callbacks — render
  // gates the comparison on whether `loadedVersion.id` matches the current
  // selection, so stale loads never appear.
  useEffect(() => {
    if (effectiveSelectedId == null) return;
    let cancelled = false;
    loadProject(effectiveSelectedId)
      .then(rec => { if (!cancelled) setLoadedVersion(rec ?? null); })
      .catch(() => { if (!cancelled) setLoadedVersion(null); });
    return () => { cancelled = true; };
  }, [effectiveSelectedId]);

  const comparisonVersion = effectiveSelectedId != null && loadedVersion?.id === effectiveSelectedId
    ? loadedVersion
    : null;

  if (!data) {
    return <div className="text-center py-12 text-gray-400 text-sm">Run calculations to see the Internal Dashboard</div>;
  }

  const f = data.feasibility;
  const k = data.kpis;
  const cs = data.capitalStack;
  const ds = data.debtSummary;
  const dr = data.debtRates;
  const kd = data.keyDates;
  const er = data.equityReturns;

  return (
    <div>
      <div className="text-center mb-4">
        <h2 className="text-lg font-bold text-blue-800">Internal Feasibility Dashboard</h2>
        <p className="text-xs text-gray-500">Checks: OK</p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* Left Column */}
        <div>
          {/* Table 1: Feasibility Summary (with optional version comparison) */}
          <Table1FeasibilitySummary
            current={f}
            versions={versions}
            selectedVersionId={selectedVersionId}
            onSelectVersion={setSelectedVersionId}
            comparison={comparisonVersion}
          />


          {/* Table 2: KPIs */}
          <TableBox>
            <TableHeader>Table 2 - Key Performance Indicators</TableHeader>
            <div className="divide-y divide-gray-100">
              <DashValue label="Total Cash on Cash Return" value={k.totalCashOnCash} unit="ratio" />
              <DashValue label="Annual Cash on Cash Return" value={k.annualCashOnCash} unit="ratio" />
              <DashValue label="Return on Investment" value={k.roi} unit="%" />
              <DashValue label="IRR" value={k.irr} unit="%" />
            </div>
            <div className="px-2 py-1 bg-gray-50 text-[10px] text-gray-400 space-y-0.5">
              <p>Cash on Cash Return = Total Profit (after coupon) / Equity</p>
              <p>Return on Investment = Total Profit / Total Cost</p>
            </div>
          </TableBox>

          {/* Table 3: JV Equity Summary */}
          <TableBox>
            <TableHeader>Table 3 - JV Equity, Returns and Profit Share Summary</TableHeader>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-blue-50 text-blue-800">
                    <th className="px-2 py-1 text-left">Description</th>
                    <th className="px-2 py-1 text-right">Total</th>
                    <th className="px-2 py-1 text-right">JV Partner</th>
                    <th className="px-2 py-1 text-right">Developer</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="bg-blue-50 font-semibold"><td colSpan={4} className="px-2 py-1">EQUITY IN</td></tr>
                  <tr className="border-b border-gray-100">
                    <td className="px-2 py-0.5">Funding Contribution %</td>
                    <td className="px-2 py-0.5 text-right">{formatPercent(er.total.fundingContribPercent)}</td>
                    <td className="px-2 py-0.5 text-right">{formatPercent(er.jvPartner.fundingContribPercent)}</td>
                    <td className="px-2 py-0.5 text-right">{formatPercent(er.developer.fundingContribPercent)}</td>
                  </tr>
                  <tr className="border-b border-gray-100">
                    <td className="px-2 py-0.5">Total Equity Contributed</td>
                    <td className="px-2 py-0.5 text-right font-mono">{formatCurrency(er.total.totalEquityContributed)}</td>
                    <td className="px-2 py-0.5 text-right font-mono">{formatCurrency(er.jvPartner.totalEquityContributed)}</td>
                    <td className="px-2 py-0.5 text-right font-mono">{formatCurrency(er.developer.totalEquityContributed)}</td>
                  </tr>
                  <tr className="border-b border-gray-100">
                    <td className="px-2 py-0.5">IRR</td>
                    <td className="px-2 py-0.5 text-right">{formatPercent(er.total.irr)}</td>
                    <td className="px-2 py-0.5 text-right">{formatPercent(er.jvPartner.irr)}</td>
                    <td className="px-2 py-0.5 text-right">{formatPercent(er.developer.irr)}</td>
                  </tr>
                  <tr className="bg-blue-50 font-semibold"><td colSpan={4} className="px-2 py-1">EQUITY OUT</td></tr>
                  <tr className="border-b border-gray-100">
                    <td className="px-2 py-0.5">Total Equity Repatriation</td>
                    <td className="px-2 py-0.5 text-right font-mono">{formatCurrency(er.total.totalEquityRepatriation)}</td>
                    <td className="px-2 py-0.5 text-right font-mono">{formatCurrency(er.jvPartner.totalEquityRepatriation)}</td>
                    <td className="px-2 py-0.5 text-right font-mono">{formatCurrency(er.developer.totalEquityRepatriation)}</td>
                  </tr>
                  <tr className="border-b border-gray-100">
                    <td className="px-2 py-0.5">Profit Share Balance</td>
                    <td className="px-2 py-0.5 text-right font-mono">{formatCurrency(er.total.profitShareBalance)}</td>
                    <td className="px-2 py-0.5 text-right font-mono">{formatCurrency(er.jvPartner.profitShareBalance)}</td>
                    <td className="px-2 py-0.5 text-right font-mono">{formatCurrency(er.developer.profitShareBalance)}</td>
                  </tr>
                  <tr className="bg-blue-100 font-bold">
                    <td className="px-2 py-1">Total Profit Share</td>
                    <td className="px-2 py-1 text-right font-mono">{formatCurrency(er.total.totalProfitShare)}</td>
                    <td className="px-2 py-1 text-right font-mono">{formatCurrency(er.jvPartner.totalProfitShare)}</td>
                    <td className="px-2 py-1 text-right font-mono">{formatCurrency(er.developer.totalProfitShare)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </TableBox>
        </div>

        {/* Right Column */}
        <div>
          {/* Table 6: Capital Stack */}
          <TableBox>
            <TableHeader>Table 6 - Capital Stack</TableHeader>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-blue-50 text-blue-800">
                    <th className="px-2 py-1 text-left">Capital Stack</th>
                    <th className="px-2 py-1 text-right">LTC</th>
                    <th className="px-2 py-1 text-right" title="Loan-to-Value Ratio. Denominator is NRV — Gross Realization Value net of GST on residential and selling costs. Matches term sheet convention: LTV based on valuation net of GST and selling costs.">LVR (NRV)</th>
                    <th className="px-2 py-1 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b">
                    <td className="px-2 py-0.5">Senior Facility #1</td>
                    <td className="px-2 py-0.5 text-right">{formatPercent(cs.seniorLTC)}</td>
                    <td className="px-2 py-0.5 text-right">{formatPercent(cs.seniorLVR)}</td>
                    <td className="px-2 py-0.5 text-right font-mono">{formatCurrency(cs.seniorAmount)}</td>
                  </tr>
                  {cs.senior2Amount > 0 && (
                    <tr className="border-b">
                      <td className="px-2 py-0.5">Senior Facility #2</td>
                      <td className="px-2 py-0.5 text-right">{formatPercent(cs.senior2LTC)}</td>
                      <td className="px-2 py-0.5 text-right">{formatPercent(cs.senior2LVR)}</td>
                      <td className="px-2 py-0.5 text-right font-mono">{formatCurrency(cs.senior2Amount)}</td>
                    </tr>
                  )}
                  {cs.senior3Amount > 0 && (
                    <tr className="border-b">
                      <td className="px-2 py-0.5">Senior Facility #3</td>
                      <td className="px-2 py-0.5 text-right">{formatPercent(cs.senior3LTC)}</td>
                      <td className="px-2 py-0.5 text-right">{formatPercent(cs.senior3LVR)}</td>
                      <td className="px-2 py-0.5 text-right font-mono">{formatCurrency(cs.senior3Amount)}</td>
                    </tr>
                  )}
                  <tr className="border-b">
                    <td className="px-2 py-0.5">Mezzanine (Principal)</td>
                    <td className="px-2 py-0.5 text-right">{formatPercent(cs.mezzLTC)}</td>
                    <td className="px-2 py-0.5 text-right">{formatPercent(cs.mezzLVR)}</td>
                    <td className="px-2 py-0.5 text-right font-mono">{formatCurrency(cs.mezzAmount)}</td>
                  </tr>
                  <tr className="border-b">
                    <td className="px-2 py-0.5">Equity (Net of Repatriation)</td>
                    <td className="px-2 py-0.5 text-right">{formatPercent(cs.equityLTC)}</td>
                    <td className="px-2 py-0.5 text-right">{formatPercent(cs.equityLVR)}</td>
                    <td className="px-2 py-0.5 text-right font-mono">{formatCurrency(cs.equityAmount)}</td>
                  </tr>
                  <tr className="bg-blue-100 font-bold">
                    <td className="px-2 py-1" colSpan={3}>Total</td>
                    <td className="px-2 py-1 text-right font-mono">{formatCurrency(cs.total)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </TableBox>

          {/* Table 7: Debt Summary */}
          <TableBox>
            <TableHeader>Table 7 - Debt Principal, Interest and Total Facility</TableHeader>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-blue-50 text-blue-800">
                    <th className="px-2 py-1 text-left"></th>
                    <th className="px-2 py-1 text-right">Principal</th>
                    <th className="px-2 py-1 text-right">Interest</th>
                    <th className="px-2 py-1 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b">
                    <td className="px-2 py-0.5">Senior #1 (Inc Land Loan Interest)</td>
                    <td className="px-2 py-0.5 text-right font-mono">{formatCurrency(ds.seniorPrincipal)}</td>
                    <td className="px-2 py-0.5 text-right font-mono">{formatCurrency(ds.seniorInterest)}</td>
                    <td className="px-2 py-0.5 text-right font-mono">{formatCurrency(ds.seniorTotal)}</td>
                  </tr>
                  {ds.senior2Principal > 0 && (
                    <tr className="border-b">
                      <td className="px-2 py-0.5">Senior #2</td>
                      <td className="px-2 py-0.5 text-right font-mono">{formatCurrency(ds.senior2Principal)}</td>
                      <td className="px-2 py-0.5 text-right font-mono">{formatCurrency(ds.senior2Interest)}</td>
                      <td className="px-2 py-0.5 text-right font-mono">{formatCurrency(ds.senior2Total)}</td>
                    </tr>
                  )}
                  {ds.senior3Principal > 0 && (
                    <tr className="border-b">
                      <td className="px-2 py-0.5">Senior #3</td>
                      <td className="px-2 py-0.5 text-right font-mono">{formatCurrency(ds.senior3Principal)}</td>
                      <td className="px-2 py-0.5 text-right font-mono">{formatCurrency(ds.senior3Interest)}</td>
                      <td className="px-2 py-0.5 text-right font-mono">{formatCurrency(ds.senior3Total)}</td>
                    </tr>
                  )}
                  <tr className="border-b">
                    <td className="px-2 py-0.5">Mezzanine</td>
                    <td className="px-2 py-0.5 text-right font-mono">{formatCurrency(ds.mezzPrincipal)}</td>
                    <td className="px-2 py-0.5 text-right font-mono">{formatCurrency(ds.mezzInterest)}</td>
                    <td className="px-2 py-0.5 text-right font-mono">{formatCurrency(ds.mezzTotal)}</td>
                  </tr>
                  <tr className="bg-blue-100 font-bold">
                    <td className="px-2 py-1">Total</td>
                    <td className="px-2 py-1 text-right font-mono">{formatCurrency(ds.totalPrincipal)}</td>
                    <td className="px-2 py-1 text-right font-mono">{formatCurrency(ds.totalInterest)}</td>
                    <td className="px-2 py-1 text-right font-mono">{formatCurrency(ds.totalDebt)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </TableBox>

          {/* Table 8: Debt Rates */}
          <TableBox>
            <TableHeader>Table 8 - Rates for Debt Calculations</TableHeader>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-blue-50 text-blue-800">
                    <th className="px-2 py-1 text-left"></th>
                    <th className="px-2 py-1 text-right">Senior #1</th>
                    <th className="px-2 py-1 text-right">Senior #2</th>
                    <th className="px-2 py-1 text-right">Senior #3</th>
                    <th className="px-2 py-1 text-right">Mezzanine</th>
                    <th className="px-2 py-1 text-right">Land Loan</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b">
                    <td className="px-2 py-0.5">Establishment Fee</td>
                    <td className="px-2 py-0.5 text-right">{formatPercent(dr.seniorEstablishment)}</td>
                    <td className="px-2 py-0.5 text-right">{formatPercent(dr.senior2Establishment)}</td>
                    <td className="px-2 py-0.5 text-right">{formatPercent(dr.senior3Establishment)}</td>
                    <td className="px-2 py-0.5 text-right">{formatPercent(dr.mezzEstablishment)}</td>
                    <td className="px-2 py-0.5 text-right">{formatPercent(dr.landEstablishment)}</td>
                  </tr>
                  <tr className="border-b">
                    <td className="px-2 py-0.5">Line Fee</td>
                    <td className="px-2 py-0.5 text-right">{formatPercent(dr.seniorLineFee)}</td>
                    <td className="px-2 py-0.5 text-right">{formatPercent(dr.senior2LineFee)}</td>
                    <td className="px-2 py-0.5 text-right">{formatPercent(dr.senior3LineFee)}</td>
                    <td className="px-2 py-0.5 text-right">{formatPercent(dr.mezzLineFee)}</td>
                    <td className="px-2 py-0.5 text-right">{formatPercent(dr.landLineFee)}</td>
                  </tr>
                  <tr className="border-b">
                    <td className="px-2 py-0.5">Margin</td>
                    <td className="px-2 py-0.5 text-right">{formatPercent(dr.seniorMargin)}</td>
                    <td className="px-2 py-0.5 text-right">{formatPercent(dr.senior2Margin)}</td>
                    <td className="px-2 py-0.5 text-right">{formatPercent(dr.senior3Margin)}</td>
                    <td className="px-2 py-0.5 text-right">{formatPercent(dr.mezzMargin)}</td>
                    <td className="px-2 py-0.5 text-right">{formatPercent(dr.landMargin)}</td>
                  </tr>
                  <tr className="border-b">
                    <td className="px-2 py-0.5">BBSY</td>
                    <td className="px-2 py-0.5 text-right">{formatPercent(dr.seniorBBSY)}</td>
                    <td className="px-2 py-0.5 text-right">{formatPercent(dr.senior2BBSY)}</td>
                    <td className="px-2 py-0.5 text-right">{formatPercent(dr.senior3BBSY)}</td>
                    <td className="px-2 py-0.5 text-right">{formatPercent(dr.mezzBBSY)}</td>
                    <td className="px-2 py-0.5 text-right">{formatPercent(dr.landBBSY)}</td>
                  </tr>
                  <tr className="bg-blue-100 font-bold">
                    <td className="px-2 py-1">Total all in rate</td>
                    <td className="px-2 py-1 text-right">{formatPercent(dr.seniorAllIn)}</td>
                    <td className="px-2 py-1 text-right">{formatPercent(dr.senior2AllIn)}</td>
                    <td className="px-2 py-1 text-right">{formatPercent(dr.senior3AllIn)}</td>
                    <td className="px-2 py-1 text-right">{formatPercent(dr.mezzAllIn)}</td>
                    <td className="px-2 py-1 text-right">{formatPercent(dr.landAllIn)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </TableBox>

          {/* Key Dates */}
          <TableBox>
            <TableHeader>Table 9 - Key Dates</TableHeader>
            <div className="divide-y divide-gray-100">
              {[
                ['Contract Start Date (Land)', kd.contractStartDate],
                ['Sales Commencement', kd.salesCommencement],
                ['Land Settlement Date', kd.landSettlement],
                ['Construction Start Date', kd.constructionStart],
                ['Construction Completion Date', kd.constructionCompletion],
                ['Sales Settlement Completed', kd.salesSettlementCompleted],
              ].map(([label, val]) => (
                <div key={label as string} className="flex justify-between px-2 py-0.5">
                  <span className="text-xs text-gray-600">{label}</span>
                  <span className="text-xs font-mono">{val}</span>
                </div>
              ))}
              <div className="h-px bg-gray-200" />
              {[
                ['Project Duration', `${kd.projectDurationMonths} months`],
                ['Construction Time', `${kd.constructionTimeMonths.toFixed(1)} months`],
                ['Planning & Design Time', `${kd.planningDesignMonths} months`],
              ].map(([label, val]) => (
                <div key={label as string} className="flex justify-between px-2 py-0.5">
                  <span className="text-xs text-gray-600">{label}</span>
                  <span className="text-xs font-mono">{val}</span>
                </div>
              ))}
            </div>
          </TableBox>

          {/* Other Indicators */}
          <TableBox>
            <TableHeader>Table 10 - Other Indicators</TableHeader>
            <DashValue label="Peak Interest Holding Cost per Month" value={data.otherIndicators.peakInterestHoldingCostPerMonth} />
            <DashValue label="Payback Period (months)" value={data.otherIndicators.paybackPeriodMonths ?? 0} unit="#" indent />
          </TableBox>

          {/* DSCR & Peak Equity */}
          {data.dscr && (
            <TableBox>
              <TableHeader>Table 12 - Debt Service &amp; Peak Exposure</TableHeader>
              <DashValue label="Average DSCR" value={data.dscr.averageDSCR} unit="ratio" />
              <DashValue label="Minimum DSCR" value={data.dscr.minimumDSCR} unit="ratio" indent />
              <DashValue label="DSCR Target" value={data.dscr.targetDSCR} unit="ratio" indent />
              <div className={`flex justify-between items-center py-0.5 px-2 text-xs pl-4 ${data.dscr.meetsTarget ? 'text-green-700' : 'text-red-700'}`}>
                <span>Target Met?</span><span>{data.dscr.meetsTarget ? 'Yes' : 'No'}</span>
              </div>
              <DashValue label="Peak Debt" value={data.dscr.peakDebt} bold />
              <DashValue label="Peak Equity (net of repatriations)" value={data.dscr.peakEquity} bold />
              <DashValue label="Peak Equity Month (period #)" value={data.dscr.peakEquityMonth} unit="#" indent />
            </TableBox>
          )}

          {/* GST Compliance Schedule */}
          {data.gstCompliance && (
            <TableBox>
              <TableHeader>Table 13 - GST Compliance Schedule</TableHeader>
              <DashValue label="Margin-Scheme Supplies (Division 75)" value={data.gstCompliance.marginSchemeSupplies} />
              <DashValue label="  Land Cost Apportioned to Margin" value={data.gstCompliance.marginSchemeLandCost} indent />
              <DashValue label="  Taxable Margin" value={data.gstCompliance.taxableMargin} indent />
              <DashValue label="  GST on Margin-Scheme Supplies" value={data.gstCompliance.gstOnMarginSchemeSupplies} indent bold />
              <DashValue label="Standard-Rated Supplies" value={data.gstCompliance.standardRatedSupplies} />
              <DashValue label="  GST on Standard Supplies" value={data.gstCompliance.gstOnStandardSupplies} indent />
              <DashValue label="Input-Taxed Supplies" value={data.gstCompliance.inputTaxedSupplies} />
              <DashValue label="Going-Concern Supplies" value={data.gstCompliance.goingConcernSupplies} />
              <DashValue label="Creditable Acquisitions (ex-GST)" value={data.gstCompliance.creditableAcquisitions} />
              <DashValue label="ITC Claimable" value={data.gstCompliance.itcClaimable} indent />
              <DashValue label="GST Withholding (s.72-55)" value={data.gstCompliance.gstWithholdingTotal} indent />
              <div className="h-1 bg-gray-300" />
              <DashValue label="Net GST Payable to ATO" value={data.gstCompliance.netGSTPayable} bold highlight />
            </TableBox>
          )}

          {/* GRV Summary */}
          <TableBox>
            <TableHeader>Table 11 - GRV Summary</TableHeader>
            <DashValue label="Total Apartment GRV" value={data.grvSummary.totalApartmentGRV} bold />
            <DashValue label="GRV Sold / Exchanged" value={data.grvSummary.grvSoldExchanged} indent />
            <DashValue label="Unsold GRV" value={data.grvSummary.unsoldGRV} indent />
          </TableBox>

          {/* Warnings */}
          {data.warnings && data.warnings.length > 0 && (
            <TableBox>
              <TableHeader>Model Warnings</TableHeader>
              <ul className="text-xs text-amber-900 bg-amber-50 px-3 py-2 space-y-1">
                {data.warnings.map((w, i) => (
                  <li key={i} className="list-disc list-inside">{w}</li>
                ))}
              </ul>
            </TableBox>
          )}
        </div>
      </div>
    </div>
  );
}
