import React from 'react';
import { useStore } from '../../store/useStore';
import { formatCurrency, formatPercent } from '../../utils';

// B12 — hoisted from inside ExternalDashboard so React doesn't recreate the
// component types on every render (react-hooks/static-components). Pure
// presentational; takes only props.
const Row = ({ label, value, bold = false, highlight = false }: { label: string; value: string; bold?: boolean; highlight?: boolean }) => (
  <div className={`flex justify-between px-3 py-1 ${bold ? 'font-bold' : ''} ${highlight ? 'bg-green-50' : ''}`}>
    <span className={`text-xs ${bold ? 'text-gray-800' : 'text-gray-600'}`}>{label}</span>
    <span className={`text-xs font-mono ${bold ? 'text-gray-800' : 'text-gray-700'}`}>{value}</span>
  </div>
);

const Header = ({ children }: { children: React.ReactNode }) => (
  <div className="bg-green-700 text-white text-xs font-bold px-3 py-1.5 rounded-t">{children}</div>
);

const Box = ({ children }: { children: React.ReactNode }) => (
  <div className="border border-gray-200 rounded mb-3">{children}</div>
);

export function ExternalDashboard() {
  const { dashboardData: data } = useStore();

  if (!data) {
    return <div className="text-center py-12 text-gray-400 text-sm">Run calculations to see the External Dashboard</div>;
  }

  const f = data.feasibility;
  const k = data.kpis;
  const cs = data.capitalStack;
  const ds = data.debtSummary;
  const kd = data.keyDates;
  const er = data.equityReturns;

  return (
    <div>
      <div className="text-center mb-4">
        <h2 className="text-lg font-bold text-green-800">External Feasibility Dashboard</h2>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div>
          {/* Table 1: Feasibility Summary */}
          <Box>
            <Header>Table 1 - Feasibility Summary</Header>
            <div className="divide-y divide-gray-100">
              <Row label="Total GRV" value={formatCurrency(f.totalGRV)} />
              <div className="h-px bg-gray-200" />
              <Row label="Land" value={formatCurrency(f.land)} />
              <Row label="Acquisition Costs (Stamp Duty, Reg Fees)" value={formatCurrency(f.stampDuty)} />
              <Row label="Build Costs" value={formatCurrency(f.buildCosts)} />
              <Row label="Senior Finance Costs" value={formatCurrency(f.seniorFinanceCosts)} />
              <Row label="Mezzanine Finance Costs" value={formatCurrency(f.mezzFinanceCosts)} />
              <Row label="Other Financing Costs" value={formatCurrency(f.otherFinancingCosts)} />
              <Row label="Standard Costs" value={formatCurrency(f.standardCosts)} />
              <Row label="GST" value={formatCurrency(f.gst)} />
              <Row label="Marketing and Advertising" value={formatCurrency(f.marketingAndAdvertising)} />
              <Row label="Sales Commissions" value={formatCurrency(f.salesCommissions)} />
              <Row label="Project Management Fee" value={formatCurrency(f.pmFee)} />
              <Row label="Total Cost" value={formatCurrency(f.totalCost)} bold highlight />
              <div className="h-1 bg-gray-300" />
              <Row label="Total Profit" value={formatCurrency(f.totalProfit)} bold highlight />
            </div>
          </Box>

          {/* Table 2: KPIs */}
          <Box>
            <Header>Table 2 - Key Performance Indicators</Header>
            <div className="divide-y divide-gray-100">
              <Row label="Total Cash on Cash Return" value={k.totalCashOnCash.toFixed(4)} />
              <Row label="Annual Cash on Cash Return" value={k.annualCashOnCash.toFixed(4)} />
              <Row label="Return on Investment" value={formatPercent(k.roi)} />
              <Row label="Project IRR" value={formatPercent(k.irr)} />
            </div>
          </Box>

          {/* Table 3: Equity Summary */}
          <Box>
            <Header>Table 3 - Equity, Returns and Profit Share Summary</Header>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-green-50">
                    <th scope="col" className="px-2 py-1 text-left">Description</th>
                    <th scope="col" className="px-2 py-1 text-right">Total</th>
                    <th scope="col" className="px-2 py-1 text-right">JV Partner</th>
                    <th scope="col" className="px-2 py-1 text-right">Developer</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="bg-green-50 font-semibold"><td colSpan={4} className="px-2 py-0.5">EQUITY IN</td></tr>
                  <tr className="border-b"><td className="px-2 py-0.5">Funding Contribution %</td><td className="px-2 py-0.5 text-right">{formatPercent(1)}</td><td className="px-2 py-0.5 text-right">{formatPercent(er.jvPartner.fundingContribPercent)}</td><td className="px-2 py-0.5 text-right">{formatPercent(er.developer.fundingContribPercent)}</td></tr>
                  <tr className="border-b"><td className="px-2 py-0.5">Equity Contributed</td><td className="px-2 py-0.5 text-right font-mono">{formatCurrency(er.total.totalEquityContributed)}</td><td className="px-2 py-0.5 text-right font-mono">{formatCurrency(er.jvPartner.totalEquityContributed)}</td><td className="px-2 py-0.5 text-right font-mono">{formatCurrency(er.developer.totalEquityContributed)}</td></tr>
                  <tr className="border-b"><td className="px-2 py-0.5">IRR</td><td className="px-2 py-0.5 text-right">{formatPercent(er.total.irr)}</td><td className="px-2 py-0.5 text-right">{formatPercent(er.jvPartner.irr)}</td><td className="px-2 py-0.5 text-right">{formatPercent(er.developer.irr)}</td></tr>
                  <tr className="bg-green-50 font-semibold"><td colSpan={4} className="px-2 py-0.5">EQUITY OUT</td></tr>
                  <tr className="border-b"><td className="px-2 py-0.5">Total Equity Repatriation</td><td className="px-2 py-0.5 text-right font-mono">{formatCurrency(er.total.totalEquityRepatriation)}</td><td className="px-2 py-0.5 text-right font-mono">{formatCurrency(er.jvPartner.totalEquityRepatriation)}</td><td className="px-2 py-0.5 text-right font-mono">{formatCurrency(er.developer.totalEquityRepatriation)}</td></tr>
                  <tr className="bg-green-100 font-bold"><td className="px-2 py-1">Total Profit Share</td><td className="px-2 py-1 text-right font-mono">{formatCurrency(er.total.totalProfitShare)}</td><td className="px-2 py-1 text-right font-mono">{formatCurrency(er.jvPartner.totalProfitShare)}</td><td className="px-2 py-1 text-right font-mono">{formatCurrency(er.developer.totalProfitShare)}</td></tr>
                </tbody>
              </table>
            </div>
          </Box>
        </div>

        <div>
          {/* Table 4: Capital Stack */}
          <Box>
            <Header>Table 4 - Capital Stack</Header>
            <table className="w-full text-xs">
              <thead><tr className="bg-green-50"><th scope="col" className="px-2 py-1 text-left"></th><th scope="col" className="px-2 py-1 text-right">LTC</th><th scope="col" className="px-2 py-1 text-right">LVR</th><th scope="col" className="px-2 py-1 text-right">Total</th></tr></thead>
              <tbody>
                <tr className="border-b"><td className="px-2 py-0.5">Senior (Facility)</td><td className="px-2 py-0.5 text-right">{formatPercent(cs.seniorLTC)}</td><td className="px-2 py-0.5 text-right">{formatPercent(cs.seniorLVR)}</td><td className="px-2 py-0.5 text-right font-mono">{formatCurrency(cs.seniorAmount)}</td></tr>
                <tr className="border-b"><td className="px-2 py-0.5">Mezzanine</td><td className="px-2 py-0.5 text-right">{formatPercent(cs.mezzLTC)}</td><td className="px-2 py-0.5 text-right">{formatPercent(cs.mezzLVR)}</td><td className="px-2 py-0.5 text-right font-mono">{formatCurrency(cs.mezzAmount)}</td></tr>
                <tr className="border-b"><td className="px-2 py-0.5">Equity</td><td className="px-2 py-0.5 text-right">{formatPercent(cs.equityLTC)}</td><td className="px-2 py-0.5 text-right">{formatPercent(cs.equityLVR)}</td><td className="px-2 py-0.5 text-right font-mono">{formatCurrency(cs.equityAmount)}</td></tr>
                <tr className="bg-green-100 font-bold"><td className="px-2 py-1" colSpan={3}>Total</td><td className="px-2 py-1 text-right font-mono">{formatCurrency(cs.total)}</td></tr>
              </tbody>
            </table>
          </Box>

          {/* Table 5: Debt Summary */}
          <Box>
            <Header>Table 5 - Debt Summary</Header>
            <table className="w-full text-xs">
              <thead><tr className="bg-green-50"><th scope="col" className="px-2 py-1 text-left"></th><th scope="col" className="px-2 py-1 text-right">Principal</th><th scope="col" className="px-2 py-1 text-right">Interest</th><th scope="col" className="px-2 py-1 text-right">Total</th></tr></thead>
              <tbody>
                <tr className="border-b"><td className="px-2 py-0.5">Senior</td><td className="px-2 py-0.5 text-right font-mono">{formatCurrency(ds.seniorPrincipal)}</td><td className="px-2 py-0.5 text-right font-mono">{formatCurrency(ds.seniorInterest)}</td><td className="px-2 py-0.5 text-right font-mono">{formatCurrency(ds.seniorTotal)}</td></tr>
                <tr className="border-b"><td className="px-2 py-0.5">Mezzanine</td><td className="px-2 py-0.5 text-right font-mono">{formatCurrency(ds.mezzPrincipal)}</td><td className="px-2 py-0.5 text-right font-mono">{formatCurrency(ds.mezzInterest)}</td><td className="px-2 py-0.5 text-right font-mono">{formatCurrency(ds.mezzTotal)}</td></tr>
                <tr className="bg-green-100 font-bold"><td className="px-2 py-1">Total</td><td className="px-2 py-1 text-right font-mono">{formatCurrency(ds.totalPrincipal)}</td><td className="px-2 py-1 text-right font-mono">{formatCurrency(ds.totalInterest)}</td><td className="px-2 py-1 text-right font-mono">{formatCurrency(ds.totalDebt)}</td></tr>
              </tbody>
            </table>
          </Box>

          {/* Table 6: Key Dates */}
          <Box>
            <Header>Table 6 - Key Dates</Header>
            <div className="divide-y divide-gray-100">
              {[
                ['Contract Start Date', kd.contractStartDate],
                ['Sales Commencement', kd.salesCommencement],
                ['Land Settlement Date', kd.landSettlement],
                ['Construction Start', kd.constructionStart],
                ['Construction Completion', kd.constructionCompletion],
                ['Sales Settlement Completed', kd.salesSettlementCompleted],
              ].map(([l, v]) => (
                <div key={l as string} className="flex justify-between px-3 py-0.5">
                  <span className="text-xs text-gray-600">{l}</span>
                  <span className="text-xs font-mono">{v}</span>
                </div>
              ))}
              <div className="h-px bg-gray-200" />
              <div className="flex justify-between px-3 py-0.5">
                <span className="text-xs text-gray-600">Project Duration</span>
                <span className="text-xs font-mono">{kd.projectDurationMonths} months</span>
              </div>
            </div>
          </Box>

          {/* Table 7: Other Indicators */}
          <Box>
            <Header>Table 7 - Other Indicators</Header>
            <div className="flex justify-between px-3 py-1">
              <span className="text-xs text-gray-600">Peak Interest Holding Cost per Month</span>
              <span className="text-xs font-mono">{formatCurrency(data.otherIndicators.peakInterestHoldingCostPerMonth)}</span>
            </div>
          </Box>
        </div>
      </div>
    </div>
  );
}
