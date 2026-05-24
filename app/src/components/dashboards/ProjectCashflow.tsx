import { useStore } from '../../store/useStore';
import { formatCurrency } from '../../utils';
import type { MonthlyCashflow } from '../../types';

type RowDef = {
  label: string;
  getValue: (c: MonthlyCashflow) => number;
  bold?: boolean;
  bg?: string;
  textColor?: string;
  /** When true, the "Total" cell shows the LAST-PERIOD closing balance
   *  rather than sum-of-monthlies. Use for outstanding-balance rows where
   *  summing monthlies is meaningless (e.g. Senior Balance). UAT v2 #14 /
   *  Melbourne UAT C2. */
  closingBalance?: boolean;
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
      { label: 'Selling Costs (Front End)', getValue: c => c.sellingCostsFrontEnd },
      { label: 'Selling Costs (Back End)', getValue: c => c.sellingCostsBackEnd },
      { label: 'Other Financing Costs', getValue: c => c.otherFinancingCosts },
      { label: 'GST on Costs (paid to vendors, ITC claimable)', getValue: c => c.gstOnCosts, textColor: 'text-orange-700' },
      { label: 'ITC Recovery (ATO refund of GST on costs)', getValue: c => c.itcRecovery, textColor: 'text-green-700' },
      {
        label: 'Total Costs (incl. GST on Costs, net of ITC)',
        getValue: c => c.landCosts + c.acquisitionCosts + c.developmentCosts + c.constructionCosts +
          c.contingency + c.marketingCosts + c.otherStandardCosts + c.pmFees +
          c.sellingCostsFrontEnd + c.sellingCostsBackEnd + c.otherFinancingCosts + c.gstOnCosts - c.itcRecovery,
        bold: true, bg: 'bg-red-50',
      },
    ],
  },
  {
    header: 'REVENUE',
    headerBg: 'bg-green-800 text-white',
    rows: [
      { label: 'GRV Settlements', getValue: c => c.grvSettlements, textColor: 'text-green-700' },
      // R9 — surfacing memo: GRV deposits at exchange period (held in trust, not
      // recognised as cashflow inflow; included for transparency).
      { label: 'GRV Deposits (memo, held in trust)', getValue: c => c.grvDeposits, textColor: 'text-gray-500' },
      { label: 'Rental Income', getValue: c => c.rentalIncome, textColor: 'text-green-700' },
      { label: 'Other Income', getValue: c => c.otherIncome, textColor: 'text-green-700' },
      { label: 'GST on Revenue (remitted via BAS)', getValue: c => c.gstOnRevenue, textColor: 'text-orange-700' },
      // R8 — surfacing memo: GST withholding (TAA 1953 Sch 1, s.14-250). Post
      // PR #28 the netCashflow no longer deducts withholding (attribution-only),
      // but it remains on the cashflow row for compliance reporting visibility.
      { label: 'GST Withholding (s.14-250 — memo, attribution only)', getValue: c => c.gstWithholding ?? 0, textColor: 'text-gray-500' },
      {
        label: 'Total Revenue (net of GST on Revenue)',
        getValue: c => c.grvSettlements + c.rentalIncome + c.otherIncome - c.gstOnRevenue,
        bold: true, bg: 'bg-green-50', textColor: 'text-green-800',
      },
    ],
  },
  {
    header: 'SENIOR FACILITY #1',
    headerBg: 'bg-blue-800 text-white',
    rows: [
      { label: 'Senior Drawdown', getValue: c => c.seniorDrawdown },
      { label: 'Senior Repayment', getValue: c => c.seniorRepayment },
      { label: 'Senior Interest', getValue: c => c.seniorInterest },
      { label: 'Senior Line fee', getValue: c => c.seniorFees },
      { label: 'Senior Balance', closingBalance: true, getValue: c => c.seniorBalance, bold: true, bg: 'bg-blue-50' },
    ],
  },
  {
    header: 'SENIOR FACILITY #2',
    headerBg: 'bg-blue-700 text-white',
    rows: [
      { label: 'Senior #2 Drawdown', getValue: c => c.senior2Drawdown },
      { label: 'Senior #2 Repayment', getValue: c => c.senior2Repayment },
      { label: 'Senior #2 Interest', getValue: c => c.senior2Interest },
      { label: 'Senior #2 Line fee', getValue: c => c.senior2Fees },
      { label: 'Senior #2 Balance', closingBalance: true, getValue: c => c.senior2Balance, bold: true, bg: 'bg-blue-50' },
    ],
  },
  {
    header: 'MEZZANINE FACILITY',
    headerBg: 'bg-teal-700 text-white',
    rows: [
      { label: 'Mezz Drawdown', getValue: c => c.mezzDrawdown },
      { label: 'Mezz Repayment', getValue: c => c.mezzRepayment },
      { label: 'Mezz Interest', getValue: c => c.mezzInterest },
      { label: 'Mezz Fees', getValue: c => c.mezzFees },
      { label: 'Mezz Balance', closingBalance: true, getValue: c => c.mezzBalance, bold: true, bg: 'bg-teal-50' },
    ],
  },
  {
    header: 'LAND LOAN',
    headerBg: 'bg-orange-700 text-white',
    rows: [
      { label: 'Land Loan Drawdown', getValue: c => c.landLoanDrawdown },
      { label: 'Land Loan Repayment', getValue: c => c.landLoanRepayment },
      { label: 'Land Loan Interest', getValue: c => c.landLoanInterest },
      { label: 'Land Loan Fees', getValue: c => c.landLoanFees },
      // LL2 — Memo of the senior-takeout transaction at construction start.
      { label: 'Senior Takeout of Land Loan (memo)', getValue: c => c.landLoanTakeoutBySenior ?? 0, textColor: 'text-gray-500' },
      { label: 'Land Loan Balance', closingBalance: true, getValue: c => c.landLoanBalance, bold: true, bg: 'bg-orange-50' },
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
      { label: 'Cumulative Cashflow', closingBalance: true, getValue: c => c.cumulativeCashflow, bold: true },
    ],
  },
];

export function ProjectCashflow() {
  const { dashboardData: data } = useStore();

  if (!data) {
    return <div className="text-center py-12 text-gray-400 text-sm">Run calculations to see the Project Cashflow</div>;
  }

  // Display every period in the project up to a safety ceiling (240 months) so
  // the final-period equity repatriation + profit distribution are visible. The
  // previous hard-cap of 84 truncated longer projects and hid the held bank
  // balance release (engine flushes at i === n-1).
  const MAX_DISPLAY_PERIODS = 240;
  const lastPeriodNumber = Math.min(data.cashflows.length, MAX_DISPLAY_PERIODS);
  const cf = data.cashflows.filter(c => c.period.periodNumber >= 1 && c.period.periodNumber <= lastPeriodNumber);

  const fmtVal = (v: number, textColor?: string) => {
    if (v == null || isNaN(v) || v === 0) return '';
    const color = v < 0 ? 'text-red-600' : (textColor || 'text-gray-800');
    return <span className={color}>{formatCurrency(v)}</span>;
  };

  const fmtTotal = (getValue: (c: MonthlyCashflow) => number, textColor?: string) => {
    const total = cf.reduce((s, c) => s + getValue(c), 0);
    if (total == null || isNaN(total) || total === 0) return '';
    const color = total < 0 ? 'text-red-600' : (textColor || 'text-gray-800');
    return <span className={`font-bold ${color}`}>{formatCurrency(total)}</span>;
  };

  // Closing-balance variant for outstanding-balance rows: shows the LAST
  // non-zero period's balance, not the meaningless sum of monthly closing
  // balances (UAT v2 #14 / Melbourne UAT C2). Header label is "Closing".
  const fmtClosing = (getValue: (c: MonthlyCashflow) => number, textColor?: string) => {
    const last = cf.length > 0 ? getValue(cf[cf.length - 1]!) : 0;
    if (last == null || isNaN(last) || last === 0) return '';
    const color = last < 0 ? 'text-red-600' : (textColor || 'text-gray-800');
    return <span className={`font-bold ${color}`}>{formatCurrency(last)}</span>;
  };

  return (
    <div>
      <div className="text-center mb-4">
        <h2 className="text-lg font-bold text-gray-800">Project Cashflow</h2>
        <p className="text-xs text-gray-500">Monthly cashflow detail across all periods</p>
      </div>

      <div className="overflow-auto border border-gray-200 rounded max-h-[75vh]">
        <table className="text-[10px] whitespace-nowrap border-collapse">
          <thead className="sticky top-0 z-10">
            {/* Period number row */}
            <tr className="bg-gray-700 text-white">
              <th scope="col" className="px-2 py-1 text-left sticky left-0 bg-gray-700 z-20 min-w-[160px]">Period</th>
              <th scope="col" className="px-2 py-1 text-right font-bold bg-gray-600 min-w-[80px]">Total</th>
              {cf.map(c => (
                <th scope="col" key={c.period.periodNumber} className="px-1.5 py-1 text-center min-w-[72px]">
                  {c.period.periodNumber}
                </th>
              ))}
            </tr>
            {/* Month label row */}
            <tr className="bg-gray-600 text-gray-200">
              <th scope="col" className="px-2 py-1 text-left sticky left-0 bg-gray-600 z-20">Month</th>
              <th scope="col" className="px-2 py-1 bg-gray-500"></th>
              {cf.map(c => (
                <th scope="col" key={c.period.periodNumber} className="px-1.5 py-1 text-center font-normal">
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
                      {row.closingBalance
                        ? fmtClosing(row.getValue, row.textColor)
                        : fmtTotal(row.getValue, row.textColor)}
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
