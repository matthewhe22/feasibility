import React from 'react';
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ComposedChart,
} from 'recharts';
import { useStore } from '../../store/useStore';
import { formatCurrency } from '../../utils';

const COLORS = ['#2563eb', '#dc2626', '#059669', '#d97706', '#7c3aed', '#db2777', '#0891b2'];

function ChartBox({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-gray-200 rounded bg-white mb-4">
      <div className="bg-gray-700 text-white text-sm font-bold px-3 py-2 rounded-t">{title}</div>
      <div className="p-4">{children}</div>
    </div>
  );
}

const fmtM = (v: any) => `$${(Number(v) / 1e6).toFixed(0)}M`;
const fmtTick = (v: number) => `${(v / 1e6).toFixed(0)}M`;
const fmtCur = (v: any) => formatCurrency(Number(v));

export function ChartsTab() {
  const { dashboardData: data } = useStore();

  if (!data) {
    return <div className="text-center py-12 text-gray-400 text-sm">Run calculations to see charts</div>;
  }

  const cf = data.cashflows.filter(c => {
    const idx = c.period.periodNumber;
    return idx >= 1 && idx <= 84;
  });

  // 1. Funding Structure Over Time
  const fundingData = cf.map(c => ({
    period: c.period.label,
    'Land Loan': c.landLoanBalance,
    'Senior Facility': c.seniorBalance,
    'Mezzanine': c.mezzBalance,
    'Equity': c.equityInjection,
  }));

  // 2. Cumulative Costs vs Revenue
  let cumCost = 0, cumRev = 0;
  const cumData = cf.map(c => {
    cumCost += c.landCosts + c.acquisitionCosts + c.developmentCosts +
      c.constructionCosts + c.contingency + c.marketingCosts +
      c.otherStandardCosts + c.pmFees + c.sellingCostsFrontEnd + c.otherFinancingCosts;
    cumRev += c.grvSettlements + c.rentalIncome + c.otherIncome;
    return {
      period: c.period.label,
      'Cumulative Costs': cumCost,
      'Cumulative Revenue': cumRev,
    };
  });

  // 3. Monthly Cashflow
  const monthlyData = cf.map(c => ({
    period: c.period.label,
    'Costs': -(c.landCosts + c.acquisitionCosts + c.developmentCosts +
      c.constructionCosts + c.contingency + c.marketingCosts +
      c.otherStandardCosts + c.pmFees + c.otherFinancingCosts),
    'Revenue': c.grvSettlements + c.rentalIncome + c.otherIncome,
  }));

  // 4. Cost Breakdown Pie
  const f = data.feasibility;
  const costPieData = [
    { name: 'Land', value: f.land },
    { name: 'Construction', value: f.buildCosts },
    { name: 'Development', value: f.standardCosts },
    { name: 'Finance', value: f.seniorFinanceCosts + f.mezzFinanceCosts + f.otherFinancingCosts },
    { name: 'Marketing', value: f.marketingAndAdvertising },
    { name: 'Sales Comm.', value: f.salesCommissions },
    { name: 'PM Fees', value: f.pmFee },
  ].filter(d => d.value > 0);

  // 5. Revenue Mix
  const grvByType: Record<string, number> = {};
  // Revenue mix by type from inputs
  // Use inputs from store
  const { inputs } = useStore.getState();
  for (const item of inputs.grvItems) {
    const type = item.revenueType;
    if (type !== '-' && item.currentSalePrice > 0) {
      grvByType[type] = (grvByType[type] || 0) + item.currentSalePrice;
    }
  }
  const revPieData = Object.entries(grvByType).map(([name, value]) => ({ name, value }));

  // 6. Debt balance over time
  const debtData = cf.map(c => ({
    period: c.period.label,
    'Total Debt': c.landLoanBalance + c.seniorBalance + c.mezzBalance,
    'Senior': c.seniorBalance,
    'Land Loan': c.landLoanBalance,
  }));

  // 7. Interest costs over time
  const interestData = cf.map(c => ({
    period: c.period.label,
    'Senior Interest': c.seniorInterest + c.seniorFees,
    'Land Loan Interest': c.landLoanInterest,
  })).filter(d => d['Senior Interest'] > 0 || d['Land Loan Interest'] > 0);

  return (
    <div>
      <h2 className="text-lg font-bold text-gray-800 mb-4">Project Visualizations</h2>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* Funding Structure Over Time */}
        <ChartBox title="Funding Structure Over Time">
          <ResponsiveContainer width="100%" height={320}>
            <AreaChart data={fundingData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="period" tick={{ fontSize: 9 }} angle={-45} textAnchor="end" height={50} interval={5} />
              <YAxis tickFormatter={fmtTick} tick={{ fontSize: 10 }} />
              <Tooltip formatter={fmtM} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Area type="monotone" dataKey="Senior Facility" stackId="1" fill="#2563eb" stroke="#2563eb" />
              <Area type="monotone" dataKey="Land Loan" stackId="1" fill="#dc2626" stroke="#dc2626" />
              <Area type="monotone" dataKey="Mezzanine" stackId="1" fill="#d97706" stroke="#d97706" />
            </AreaChart>
          </ResponsiveContainer>
        </ChartBox>

        {/* Cumulative Costs vs Revenue */}
        <ChartBox title="Cumulative Costs vs Revenue">
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={cumData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="period" tick={{ fontSize: 9 }} angle={-45} textAnchor="end" height={50} interval={5} />
              <YAxis tickFormatter={fmtTick} tick={{ fontSize: 10 }} />
              <Tooltip formatter={fmtM} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="Cumulative Costs" stroke="#dc2626" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="Cumulative Revenue" stroke="#059669" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </ChartBox>

        {/* Monthly Cashflow */}
        <ChartBox title="Monthly Cashflow (Costs vs Revenue)">
          <ResponsiveContainer width="100%" height={320}>
            <ComposedChart data={monthlyData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="period" tick={{ fontSize: 9 }} angle={-45} textAnchor="end" height={50} interval={5} />
              <YAxis tickFormatter={fmtTick} tick={{ fontSize: 10 }} />
              <Tooltip formatter={fmtM} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="Costs" fill="#dc2626" opacity={0.7} />
              <Bar dataKey="Revenue" fill="#059669" opacity={0.7} />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartBox>

        {/* Debt Balance Over Time */}
        <ChartBox title="Debt Balance Over Time (Peak Exposure)">
          <ResponsiveContainer width="100%" height={320}>
            <AreaChart data={debtData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="period" tick={{ fontSize: 9 }} angle={-45} textAnchor="end" height={50} interval={5} />
              <YAxis tickFormatter={fmtTick} tick={{ fontSize: 10 }} />
              <Tooltip formatter={fmtM} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Area type="monotone" dataKey="Total Debt" fill="#7c3aed" stroke="#7c3aed" fillOpacity={0.3} />
              <Area type="monotone" dataKey="Senior" fill="#2563eb" stroke="#2563eb" fillOpacity={0.2} />
              <Area type="monotone" dataKey="Land Loan" fill="#dc2626" stroke="#dc2626" fillOpacity={0.2} />
            </AreaChart>
          </ResponsiveContainer>
        </ChartBox>

        {/* Cost Breakdown */}
        <ChartBox title="Cost Breakdown">
          <ResponsiveContainer width="100%" height={320}>
            <PieChart>
              <Pie data={costPieData} cx="50%" cy="50%" outerRadius={120} innerRadius={60} dataKey="value"
                label={({ name, value }) => `${name}: ${fmtM(value)}`} labelLine={{ stroke: '#666' }}>
                {costPieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length] ?? '#000'} />)}
              </Pie>
              <Tooltip formatter={fmtCur} />
            </PieChart>
          </ResponsiveContainer>
        </ChartBox>

        {/* Revenue Mix */}
        <ChartBox title="Revenue Mix by Type">
          <ResponsiveContainer width="100%" height={320}>
            <PieChart>
              <Pie data={revPieData} cx="50%" cy="50%" outerRadius={120} innerRadius={60} dataKey="value"
                label={({ name, value }) => `${name}: ${fmtM(value)}`} labelLine={{ stroke: '#666' }}>
                {revPieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length] ?? '#000'} />)}
              </Pie>
              <Tooltip formatter={fmtCur} />
            </PieChart>
          </ResponsiveContainer>
        </ChartBox>

        {/* Interest Over Time */}
        <ChartBox title="Monthly Interest & Fee Costs">
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={interestData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="period" tick={{ fontSize: 9 }} angle={-45} textAnchor="end" height={50} interval={2} />
              <YAxis tickFormatter={fmtTick} tick={{ fontSize: 10 }} />
              <Tooltip formatter={fmtM} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="Senior Interest" stackId="a" fill="#2563eb" />
              <Bar dataKey="Land Loan Interest" stackId="a" fill="#dc2626" />
            </BarChart>
          </ResponsiveContainer>
        </ChartBox>
      </div>
    </div>
  );
}
