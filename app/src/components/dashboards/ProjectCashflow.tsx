import { useStore } from '../../store/useStore';
import { formatCurrency } from '../../utils';
import type { MonthlyCashflow } from '../../types';

type RowDef = {
  label: string;
  getValue: (c: MonthlyCashflow) => number;
  bold?: boolean;
  bg?: string;
  textColor?: string;
};

const SECTIONS: { header: string; headerBg: string; rows: RowDef[] }[] = [
  {
    header: 'COSTS',
    headerBg: 'bg-red-800 text-white',
    rows: [
      { label: 'Land Costs', getValue: c => c.landCosts },
      { label: 'Acquisition Costs', getValue: c => c.acquisitionCosts },
      { label: 'Development Costs', getValue: c => c.developmentCosts },
      { label: 'Construction Costs', getValue: c => c.constructionCosts },
      { label: 'Contingency', getValue: c => c.contingency },
      { label: 'Marketing', getValue: c => c.marketingCosts },
      { label: 'Other Standard Costs', getValue: c => c.otherStandardCosts },
      { label: 'PM Fees', getValue: c => c.pmFees },
      { label: 'Selling Costs', getValue: c => c.sellingCostsFrontEnd },
      { label: 'Other Financing Costs', getValue: c => c.otherFinancingCosts },
      {
        label: 'Total Costs',
        getValue: c => c.landCosts + c.acquisitionCosts + c.developmentCosts + c.constructionCosts +
          c.contingency + c.marketingCosts + c.otherStandardCosts + c.pmFees +
          c.sellingCostsFrontEnd + c.otherFinancingCosts,
        bold: true, bg: 'bg-red-50',
      },
    ],
  },
  {
    header: 'REVENUE',
    headerBg: 'bg-green-800 text-white',
    rows: [
      { label: 'GRV Settlements', getValue: c => c.grvSettlements, textColor: 'text-green-700' },
      { label: 'Rental Income', getValue: c => c.rentalIncome, textColor: 'text-green-700' },
      { label: 'Other Income', getValue: c => c.otherIncome, textColor: 'text-green-700' },
      {
        label: 'Total Revenue',
        getValue: c => c.grvSettlements + c.rentalIncome + c.otherIncome,
        bold: true, bg: 'bg-green-50', textColor: 'text-green-800',
      },
    ],
  },
  {
    header: 'SENIOR FACILITY',
    headerBg: 'bg-blue-800 text-white',
    rows: [
      { label: 'Senior Drawdown', getValue: c => c.seniorDrawdown },
      { label: 'Senior Repayment', getValue: c => c.seniorRepayment },
      { label: 'Senior Interest', getValue: c => c.seniorInterest },
      { label: 'Senior Fees', getValue: c => c.seniorFees },
      { label: 'Senior Balance', getValue: c => c.seniorBalance, bold: true, bg: 'bg-blue-50' },
    ],
  },
  {
    header: 'LAND LOAN',
    headerBg: 'bg-orange-700 text-white',
    rows: [
      { label: 'Land Loan Drawdown', getValue: c => c.landLoanDrawdown },
      { label: 'Land Loan Repayment', getValue: c => c.landLoanRepayment },
      { label: 'Land Loan Interest', getValue: c => c.landLoanInterest },
      { label: 'Land Loan Balance', getValue: c => c.landLoanBalance, bold: true, bg: 'bg-orange-50' },
    ],
  },
  {
    header: 'EQUITY',
    headerBg: 'bg-purple-800 text-white',
    rows: [
      { label: 'Equity Injection', getValue: c => c.equityInjection },
      { label: 'Equity Repatriation', getValue: c => c.equityRepatriation },
      { label: 'Profit Distribution', getValue: c => c.profitDistribution },
    ],
  },
  {
    header: 'NET POSITION',
    headerBg: 'bg-gray-700 text-white',
    rows: [
      { label: 'Net Cashflow', getValue: c => c.netCashflow, bold: true },
      { label: 'Cumulative Cashflow', getValue: c => c.cumulativeCashflow, bold: true },
    ],
  },
];

export function ProjectCashflow() {
  const { dashboardData: data } = useStore();

  if (!data) {
    return <div className="text-center py-12 text-gray-400 text-sm">Run calculations to see the Project Cashflow</div>;
  }

  const cf = data.cashflows.filter(c => c.period.periodNumber >= 1 && c.period.periodNumber <= 84);

  const fmtVal = (v: number, textColor?: string) => {
    if (!v) return '';
    const color = v < 0 ? 'text-red-600' : (textColor || 'text-gray-800');
    return <span className={color}>{formatCurrency(v)}</span>;
  };

  const fmtTotal = (getValue: (c: MonthlyCashflow) => number, textColor?: string) => {
    const total = cf.reduce((s, c) => s + getValue(c), 0);
    if (!total) return '';
    const color = total < 0 ? 'text-red-600' : (textColor || 'text-gray-800');
    return <span className={`font-bold ${color}`}>{formatCurrency(total)}</span>;
  };

  return (
    <div>
      <div className="text-center mb-4">
        <h2 className="text-lg font-bold text-gray-800">Project Cashflow</h2>
        <p className="text-xs text-gray-500">Monthly cashflow detail across all periods</p>
      </div>

      <div className="overflow-x-auto border border-gray-200 rounded">
        <table className="text-[10px] whitespace-nowrap border-collapse">
          <thead>
            {/* Period number row */}
            <tr className="bg-gray-700 text-white">
              <th className="px-2 py-1 text-left sticky left-0 bg-gray-700 z-20 min-w-[160px]">Period</th>
              <th className="px-2 py-1 text-right font-bold bg-gray-600 min-w-[80px]">Total</th>
              {cf.map(c => (
                <th key={c.period.periodNumber} className="px-1.5 py-1 text-center min-w-[72px]">
                  {c.period.periodNumber}
                </th>
              ))}
            </tr>
            {/* Month label row */}
            <tr className="bg-gray-600 text-gray-200">
              <th className="px-2 py-1 text-left sticky left-0 bg-gray-600 z-20">Month</th>
              <th className="px-2 py-1 bg-gray-500"></th>
              {cf.map(c => (
                <th key={c.period.periodNumber} className="px-1.5 py-1 text-center font-normal">
                  {c.period.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {SECTIONS.map(section => (
              <>
                {/* Section header */}
                <tr key={`hdr-${section.header}`}>
                  <td className={`px-2 py-1 font-bold sticky left-0 z-10 ${section.headerBg}`} colSpan={cf.length + 2}>
                    {section.header}
                  </td>
                </tr>
                {/* Data rows */}
                {section.rows.map((row, ri) => (
                  <tr key={`${section.header}-${ri}`} className={`${row.bg || (ri % 2 === 0 ? 'bg-white' : 'bg-gray-50')} hover:bg-yellow-50`}>
                    <td className={`px-2 py-0.5 sticky left-0 z-10 ${row.bold ? 'font-bold' : ''} ${row.bg || (ri % 2 === 0 ? 'bg-white' : 'bg-gray-50')} border-r border-gray-200`}>
                      {row.label}
                    </td>
                    <td className={`px-1.5 py-0.5 text-right font-mono bg-gray-100 border-r border-gray-300 ${row.bold ? 'font-bold' : ''}`}>
                      {fmtTotal(row.getValue, row.textColor)}
                    </td>
                    {cf.map(c => (
                      <td key={c.period.periodNumber} className={`px-1.5 py-0.5 text-right font-mono ${row.bold ? 'font-bold' : ''}`}>
                        {fmtVal(row.getValue(c), row.textColor)}
                      </td>
                    ))}
                  </tr>
                ))}
              </>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
