import { useStore } from '../../store/useStore';
import { formatCurrency, formatPercent } from '../../utils';

export function ProjectSummary() {
  const { dashboardData: data } = useStore();

  if (!data) {
    return <div className="text-center py-12 text-gray-400 text-sm">Run calculations to see the Project Summary</div>;
  }

  const f = data.feasibility;
  const k = data.kpis;
  const cs = data.capitalStack;
  const ds = data.debtSummary;
  const kd = data.keyDates;

  const cf = data.cashflows;
  const totalLandCosts = cf.reduce((s, c) => s + c.landCosts, 0);
  const totalAcquisition = cf.reduce((s, c) => s + c.acquisitionCosts, 0);
  const totalDev = cf.reduce((s, c) => s + c.developmentCosts, 0);
  const totalConst = cf.reduce((s, c) => s + c.constructionCosts, 0);
  const totalContingency = cf.reduce((s, c) => s + c.contingency, 0);
  const totalMarketing = cf.reduce((s, c) => s + c.marketingCosts, 0);
  const totalOther = cf.reduce((s, c) => s + c.otherStandardCosts, 0);
  const totalPM = cf.reduce((s, c) => s + c.pmFees, 0);
  const totalSelling = cf.reduce((s, c) => s + c.sellingCostsFrontEnd, 0);
  const totalOtherFin = cf.reduce((s, c) => s + c.otherFinancingCosts, 0);
  const totalSettlements = cf.reduce((s, c) => s + c.grvSettlements, 0);
  const totalRental = cf.reduce((s, c) => s + c.rentalIncome, 0);
  const totalOtherInc = cf.reduce((s, c) => s + c.otherIncome, 0);

  const totalCostsExcFin = totalLandCosts + totalAcquisition + totalDev + totalConst +
    totalContingency + totalMarketing + totalOther + totalPM + totalSelling + totalOtherFin;
  const totalRevenue = totalSettlements + totalRental + totalOtherInc;

  const Header = ({ children }: { children: React.ReactNode }) => (
    <div className="bg-gray-700 text-white text-xs font-bold px-3 py-1.5 rounded-t">{children}</div>
  );

  const Box = ({ children }: { children: React.ReactNode }) => (
    <div className="border border-gray-200 rounded mb-4">{children}</div>
  );

  const Row = ({ label, value, bold = false, highlight = false, negative = false }: {
    label: string; value: string; bold?: boolean; highlight?: boolean; negative?: boolean;
  }) => (
    <div className={`flex justify-between px-3 py-1 ${bold ? 'font-bold' : ''} ${highlight ? 'bg-blue-50' : ''}`}>
      <span className={`text-xs ${bold ? 'text-gray-800' : 'text-gray-600'}`}>{label}</span>
      <span className={`text-xs font-mono ${negative ? 'text-red-600' : bold ? 'text-gray-800' : 'text-gray-700'}`}>{value}</span>
    </div>
  );

  return (
    <div>
      <div className="text-center mb-4">
        <h2 className="text-lg font-bold text-gray-800">Project Summary</h2>
        <p className="text-xs text-gray-500">Aggregated cost, revenue and financing summary</p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div>
          {/* Cost Summary */}
          <Box>
            <Header>Cost Summary (exc. Finance)</Header>
            <div className="divide-y divide-gray-100">
              <Row label="Land Costs" value={formatCurrency(totalLandCosts)} />
              <Row label="Acquisition Costs" value={formatCurrency(totalAcquisition)} />
              <Row label="Development Costs" value={formatCurrency(totalDev)} />
              <Row label="Construction Costs" value={formatCurrency(totalConst)} />
              <Row label="Contingency" value={formatCurrency(totalContingency)} />
              <Row label="Marketing & Advertising" value={formatCurrency(totalMarketing)} />
              <Row label="Other Standard Costs" value={formatCurrency(totalOther)} />
              <Row label="PM Fees" value={formatCurrency(totalPM)} />
              <Row label="Selling Costs" value={formatCurrency(totalSelling)} />
              <Row label="Other Financing Costs" value={formatCurrency(totalOtherFin)} />
              <div className="h-1 bg-gray-300" />
              <Row label="Total Costs (exc. Finance)" value={formatCurrency(totalCostsExcFin)} bold highlight />
            </div>
          </Box>

          {/* Revenue Summary */}
          <Box>
            <Header>Revenue Summary</Header>
            <div className="divide-y divide-gray-100">
              <Row label="GRV Settlements" value={formatCurrency(totalSettlements)} />
              <Row label="Rental Income" value={formatCurrency(totalRental)} />
              <Row label="Other Income" value={formatCurrency(totalOtherInc)} />
              <div className="h-1 bg-gray-300" />
              <Row label="Total Revenue" value={formatCurrency(totalRevenue)} bold highlight />
            </div>
          </Box>

          {/* Feasibility Summary */}
          <Box>
            <Header>Feasibility Summary</Header>
            <div className="divide-y divide-gray-100">
              <Row label="Total GRV" value={formatCurrency(f.totalGRV)} />
              <Row label="Total Cost" value={formatCurrency(f.totalCost)} />
              <div className="h-1 bg-gray-300" />
              <Row label="Total Profit" value={formatCurrency(f.totalProfit)} bold highlight />
              <Row label="Profit Margin" value={formatPercent(f.totalGRV > 0 ? f.totalProfit / f.totalGRV : 0)} />
            </div>
          </Box>
        </div>

        <div>
          {/* Finance Summary */}
          <Box>
            <Header>Finance Summary</Header>
            <div className="divide-y divide-gray-100">
              <Row label="Senior Finance Costs" value={formatCurrency(f.seniorFinanceCosts)} />
              <Row label="Mezzanine Finance Costs" value={formatCurrency(f.mezzFinanceCosts)} />
              <Row label="Other Financing Costs" value={formatCurrency(f.otherFinancingCosts)} />
              <div className="h-1 bg-gray-300" />
              <Row label="Total Finance Costs" value={formatCurrency(f.seniorFinanceCosts + f.mezzFinanceCosts + f.otherFinancingCosts)} bold highlight />
            </div>
          </Box>

          {/* Capital Stack */}
          <Box>
            <Header>Capital Stack</Header>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-100 text-gray-600">
                    <th className="px-2 py-1 text-left"></th>
                    <th className="px-2 py-1 text-right">LTC</th>
                    <th className="px-2 py-1 text-right">LVR</th>
                    <th className="px-2 py-1 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b"><td className="px-2 py-0.5">Senior</td><td className="px-2 py-0.5 text-right">{formatPercent(cs.seniorLTC)}</td><td className="px-2 py-0.5 text-right">{formatPercent(cs.seniorLVR)}</td><td className="px-2 py-0.5 text-right font-mono">{formatCurrency(cs.seniorAmount)}</td></tr>
                  <tr className="border-b"><td className="px-2 py-0.5">Mezzanine</td><td className="px-2 py-0.5 text-right">{formatPercent(cs.mezzLTC)}</td><td className="px-2 py-0.5 text-right">{formatPercent(cs.mezzLVR)}</td><td className="px-2 py-0.5 text-right font-mono">{formatCurrency(cs.mezzAmount)}</td></tr>
                  <tr className="border-b"><td className="px-2 py-0.5">Equity</td><td className="px-2 py-0.5 text-right">{formatPercent(cs.equityLTC)}</td><td className="px-2 py-0.5 text-right">{formatPercent(cs.equityLVR)}</td><td className="px-2 py-0.5 text-right font-mono">{formatCurrency(cs.equityAmount)}</td></tr>
                  <tr className="bg-gray-100 font-bold"><td className="px-2 py-1" colSpan={3}>Total</td><td className="px-2 py-1 text-right font-mono">{formatCurrency(cs.total)}</td></tr>
                </tbody>
              </table>
            </div>
          </Box>

          {/* Debt Summary */}
          <Box>
            <Header>Debt Summary</Header>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-100 text-gray-600">
                    <th className="px-2 py-1 text-left"></th>
                    <th className="px-2 py-1 text-right">Principal</th>
                    <th className="px-2 py-1 text-right">Interest</th>
                    <th className="px-2 py-1 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b"><td className="px-2 py-0.5">Senior</td><td className="px-2 py-0.5 text-right font-mono">{formatCurrency(ds.seniorPrincipal)}</td><td className="px-2 py-0.5 text-right font-mono">{formatCurrency(ds.seniorInterest)}</td><td className="px-2 py-0.5 text-right font-mono">{formatCurrency(ds.seniorTotal)}</td></tr>
                  <tr className="border-b"><td className="px-2 py-0.5">Mezzanine</td><td className="px-2 py-0.5 text-right font-mono">{formatCurrency(ds.mezzPrincipal)}</td><td className="px-2 py-0.5 text-right font-mono">{formatCurrency(ds.mezzInterest)}</td><td className="px-2 py-0.5 text-right font-mono">{formatCurrency(ds.mezzTotal)}</td></tr>
                  <tr className="bg-gray-100 font-bold"><td className="px-2 py-1">Total</td><td className="px-2 py-1 text-right font-mono">{formatCurrency(ds.totalPrincipal)}</td><td className="px-2 py-1 text-right font-mono">{formatCurrency(ds.totalInterest)}</td><td className="px-2 py-1 text-right font-mono">{formatCurrency(ds.totalDebt)}</td></tr>
                </tbody>
              </table>
            </div>
          </Box>

          {/* KPIs */}
          <Box>
            <Header>Key Performance Indicators</Header>
            <div className="divide-y divide-gray-100">
              <Row label="Total Cash on Cash Return" value={k.totalCashOnCash.toFixed(4)} />
              <Row label="Annual Cash on Cash Return" value={k.annualCashOnCash.toFixed(4)} />
              <Row label="Return on Investment" value={formatPercent(k.roi)} />
              <Row label="Project IRR" value={formatPercent(k.irr)} />
            </div>
          </Box>

          {/* Key Dates */}
          <Box>
            <Header>Key Dates</Header>
            <div className="divide-y divide-gray-100">
              <Row label="Project Start" value={kd.contractStartDate} />
              <Row label="Construction Start" value={kd.constructionStart} />
              <Row label="Construction Completion" value={kd.constructionCompletion} />
              <Row label="Last Settlement" value={kd.salesSettlementCompleted} />
              <div className="h-px bg-gray-200" />
              <Row label="Project Duration" value={`${kd.projectDurationMonths} months`} />
              <Row label="Construction Time" value={`${kd.constructionTimeMonths.toFixed(1)} months`} />
            </div>
          </Box>
        </div>
      </div>
    </div>
  );
}
