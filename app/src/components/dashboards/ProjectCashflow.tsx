import { useStore } from '../../store/useStore';
import { formatCurrency } from '../../utils';

export function ProjectCashflow() {
  const { dashboardData: data } = useStore();

  if (!data) {
    return <div className="text-center py-12 text-gray-400 text-sm">Run calculations to see the Project Cashflow</div>;
  }

  const cf = data.cashflows.filter(c => {
    const idx = c.period.periodNumber;
    return idx >= 1 && idx <= 84;
  });

  return (
    <div>
      <div className="text-center mb-4">
        <h2 className="text-lg font-bold text-gray-800">Project Cashflow</h2>
        <p className="text-xs text-gray-500">Monthly cashflow detail across all periods</p>
      </div>

      <div className="overflow-x-auto border border-gray-200 rounded">
        <table className="text-xs whitespace-nowrap">
          <thead>
            <tr className="bg-gray-700 text-white">
              <th className="px-2 py-1.5 text-left sticky left-0 bg-gray-700 z-10">Period</th>
              <th className="px-2 py-1.5 text-left sticky left-[60px] bg-gray-700 z-10">Month</th>
              <th className="px-2 py-1.5 text-right bg-red-800">Land</th>
              <th className="px-2 py-1.5 text-right bg-red-800">Acquisition</th>
              <th className="px-2 py-1.5 text-right bg-red-800">Development</th>
              <th className="px-2 py-1.5 text-right bg-red-800">Construction</th>
              <th className="px-2 py-1.5 text-right bg-red-800">Contingency</th>
              <th className="px-2 py-1.5 text-right bg-red-800">Marketing</th>
              <th className="px-2 py-1.5 text-right bg-red-800">Other Costs</th>
              <th className="px-2 py-1.5 text-right bg-red-800">PM Fees</th>
              <th className="px-2 py-1.5 text-right bg-red-800">Selling Costs</th>
              <th className="px-2 py-1.5 text-right bg-red-800">Other Fin.</th>
              <th className="px-2 py-1.5 text-right bg-red-900 font-bold">Total Costs</th>
              <th className="px-2 py-1.5 text-right bg-green-800">Settlements</th>
              <th className="px-2 py-1.5 text-right bg-green-800">Rental</th>
              <th className="px-2 py-1.5 text-right bg-green-800">Other Income</th>
              <th className="px-2 py-1.5 text-right bg-green-900 font-bold">Total Revenue</th>
              <th className="px-2 py-1.5 text-right bg-blue-800">Senior Draw</th>
              <th className="px-2 py-1.5 text-right bg-blue-800">Senior Repay</th>
              <th className="px-2 py-1.5 text-right bg-blue-800">Senior Int.</th>
              <th className="px-2 py-1.5 text-right bg-blue-800">Senior Fees</th>
              <th className="px-2 py-1.5 text-right bg-blue-900">Senior Bal.</th>
              <th className="px-2 py-1.5 text-right bg-orange-800">Land Loan Draw</th>
              <th className="px-2 py-1.5 text-right bg-orange-800">Land Loan Repay</th>
              <th className="px-2 py-1.5 text-right bg-orange-800">Land Loan Int.</th>
              <th className="px-2 py-1.5 text-right bg-orange-900">Land Loan Bal.</th>
              <th className="px-2 py-1.5 text-right bg-purple-800">Equity In</th>
              <th className="px-2 py-1.5 text-right bg-purple-800">Equity Out</th>
              <th className="px-2 py-1.5 text-right bg-purple-800">Profit Dist.</th>
              <th className="px-2 py-1.5 text-right bg-gray-600 font-bold">Net CF</th>
              <th className="px-2 py-1.5 text-right bg-gray-600 font-bold">Cum. CF</th>
            </tr>
          </thead>
          <tbody>
            {cf.map((c, i) => {
              const totalCosts = c.landCosts + c.acquisitionCosts + c.developmentCosts +
                c.constructionCosts + c.contingency + c.marketingCosts +
                c.otherStandardCosts + c.pmFees + c.sellingCostsFrontEnd + c.otherFinancingCosts;
              const totalRevenue = c.grvSettlements + c.rentalIncome + c.otherIncome;
              const isEven = i % 2 === 0;

              return (
                <tr key={c.period.periodNumber} className={`${isEven ? 'bg-white' : 'bg-gray-50'} hover:bg-yellow-50`}>
                  <td className={`px-2 py-0.5 font-mono sticky left-0 z-10 ${isEven ? 'bg-white' : 'bg-gray-50'}`}>{c.period.periodNumber}</td>
                  <td className={`px-2 py-0.5 sticky left-[60px] z-10 ${isEven ? 'bg-white' : 'bg-gray-50'}`}>{c.period.label}</td>
                  <td className="px-2 py-0.5 text-right font-mono">{c.landCosts ? formatCurrency(c.landCosts) : ''}</td>
                  <td className="px-2 py-0.5 text-right font-mono">{c.acquisitionCosts ? formatCurrency(c.acquisitionCosts) : ''}</td>
                  <td className="px-2 py-0.5 text-right font-mono">{c.developmentCosts ? formatCurrency(c.developmentCosts) : ''}</td>
                  <td className="px-2 py-0.5 text-right font-mono">{c.constructionCosts ? formatCurrency(c.constructionCosts) : ''}</td>
                  <td className="px-2 py-0.5 text-right font-mono">{c.contingency ? formatCurrency(c.contingency) : ''}</td>
                  <td className="px-2 py-0.5 text-right font-mono">{c.marketingCosts ? formatCurrency(c.marketingCosts) : ''}</td>
                  <td className="px-2 py-0.5 text-right font-mono">{c.otherStandardCosts ? formatCurrency(c.otherStandardCosts) : ''}</td>
                  <td className="px-2 py-0.5 text-right font-mono">{c.pmFees ? formatCurrency(c.pmFees) : ''}</td>
                  <td className="px-2 py-0.5 text-right font-mono">{c.sellingCostsFrontEnd ? formatCurrency(c.sellingCostsFrontEnd) : ''}</td>
                  <td className="px-2 py-0.5 text-right font-mono">{c.otherFinancingCosts ? formatCurrency(c.otherFinancingCosts) : ''}</td>
                  <td className="px-2 py-0.5 text-right font-mono font-bold bg-red-50">{totalCosts ? formatCurrency(totalCosts) : ''}</td>
                  <td className="px-2 py-0.5 text-right font-mono text-green-700">{c.grvSettlements ? formatCurrency(c.grvSettlements) : ''}</td>
                  <td className="px-2 py-0.5 text-right font-mono text-green-700">{c.rentalIncome ? formatCurrency(c.rentalIncome) : ''}</td>
                  <td className="px-2 py-0.5 text-right font-mono text-green-700">{c.otherIncome ? formatCurrency(c.otherIncome) : ''}</td>
                  <td className="px-2 py-0.5 text-right font-mono font-bold bg-green-50 text-green-800">{totalRevenue ? formatCurrency(totalRevenue) : ''}</td>
                  <td className="px-2 py-0.5 text-right font-mono">{c.seniorDrawdown ? formatCurrency(c.seniorDrawdown) : ''}</td>
                  <td className="px-2 py-0.5 text-right font-mono">{c.seniorRepayment ? formatCurrency(c.seniorRepayment) : ''}</td>
                  <td className="px-2 py-0.5 text-right font-mono">{c.seniorInterest ? formatCurrency(c.seniorInterest) : ''}</td>
                  <td className="px-2 py-0.5 text-right font-mono">{c.seniorFees ? formatCurrency(c.seniorFees) : ''}</td>
                  <td className="px-2 py-0.5 text-right font-mono bg-blue-50">{c.seniorBalance ? formatCurrency(c.seniorBalance) : ''}</td>
                  <td className="px-2 py-0.5 text-right font-mono">{c.landLoanDrawdown ? formatCurrency(c.landLoanDrawdown) : ''}</td>
                  <td className="px-2 py-0.5 text-right font-mono">{c.landLoanRepayment ? formatCurrency(c.landLoanRepayment) : ''}</td>
                  <td className="px-2 py-0.5 text-right font-mono">{c.landLoanInterest ? formatCurrency(c.landLoanInterest) : ''}</td>
                  <td className="px-2 py-0.5 text-right font-mono bg-orange-50">{c.landLoanBalance ? formatCurrency(c.landLoanBalance) : ''}</td>
                  <td className="px-2 py-0.5 text-right font-mono">{c.equityInjection ? formatCurrency(c.equityInjection) : ''}</td>
                  <td className="px-2 py-0.5 text-right font-mono">{c.equityRepatriation ? formatCurrency(c.equityRepatriation) : ''}</td>
                  <td className="px-2 py-0.5 text-right font-mono">{c.profitDistribution ? formatCurrency(c.profitDistribution) : ''}</td>
                  <td className={`px-2 py-0.5 text-right font-mono font-bold ${c.netCashflow < 0 ? 'text-red-600' : 'text-green-700'}`}>{formatCurrency(c.netCashflow)}</td>
                  <td className={`px-2 py-0.5 text-right font-mono font-bold ${c.cumulativeCashflow < 0 ? 'text-red-600' : 'text-green-700'}`}>{formatCurrency(c.cumulativeCashflow)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-gray-200 font-bold">
              <td className="px-2 py-1 sticky left-0 bg-gray-200 z-10" colSpan={2}>TOTAL</td>
              <td className="px-2 py-1 text-right font-mono">{formatCurrency(cf.reduce((s, c) => s + c.landCosts, 0))}</td>
              <td className="px-2 py-1 text-right font-mono">{formatCurrency(cf.reduce((s, c) => s + c.acquisitionCosts, 0))}</td>
              <td className="px-2 py-1 text-right font-mono">{formatCurrency(cf.reduce((s, c) => s + c.developmentCosts, 0))}</td>
              <td className="px-2 py-1 text-right font-mono">{formatCurrency(cf.reduce((s, c) => s + c.constructionCosts, 0))}</td>
              <td className="px-2 py-1 text-right font-mono">{formatCurrency(cf.reduce((s, c) => s + c.contingency, 0))}</td>
              <td className="px-2 py-1 text-right font-mono">{formatCurrency(cf.reduce((s, c) => s + c.marketingCosts, 0))}</td>
              <td className="px-2 py-1 text-right font-mono">{formatCurrency(cf.reduce((s, c) => s + c.otherStandardCosts, 0))}</td>
              <td className="px-2 py-1 text-right font-mono">{formatCurrency(cf.reduce((s, c) => s + c.pmFees, 0))}</td>
              <td className="px-2 py-1 text-right font-mono">{formatCurrency(cf.reduce((s, c) => s + c.sellingCostsFrontEnd, 0))}</td>
              <td className="px-2 py-1 text-right font-mono">{formatCurrency(cf.reduce((s, c) => s + c.otherFinancingCosts, 0))}</td>
              <td className="px-2 py-1 text-right font-mono bg-red-100">{formatCurrency(cf.reduce((s, c) => s + c.landCosts + c.acquisitionCosts + c.developmentCosts + c.constructionCosts + c.contingency + c.marketingCosts + c.otherStandardCosts + c.pmFees + c.sellingCostsFrontEnd + c.otherFinancingCosts, 0))}</td>
              <td className="px-2 py-1 text-right font-mono text-green-700">{formatCurrency(cf.reduce((s, c) => s + c.grvSettlements, 0))}</td>
              <td className="px-2 py-1 text-right font-mono text-green-700">{formatCurrency(cf.reduce((s, c) => s + c.rentalIncome, 0))}</td>
              <td className="px-2 py-1 text-right font-mono text-green-700">{formatCurrency(cf.reduce((s, c) => s + c.otherIncome, 0))}</td>
              <td className="px-2 py-1 text-right font-mono bg-green-100 text-green-800">{formatCurrency(cf.reduce((s, c) => s + c.grvSettlements + c.rentalIncome + c.otherIncome, 0))}</td>
              <td className="px-2 py-1 text-right font-mono">{formatCurrency(cf.reduce((s, c) => s + c.seniorDrawdown, 0))}</td>
              <td className="px-2 py-1 text-right font-mono">{formatCurrency(cf.reduce((s, c) => s + c.seniorRepayment, 0))}</td>
              <td className="px-2 py-1 text-right font-mono">{formatCurrency(cf.reduce((s, c) => s + c.seniorInterest, 0))}</td>
              <td className="px-2 py-1 text-right font-mono">{formatCurrency(cf.reduce((s, c) => s + c.seniorFees, 0))}</td>
              <td className="px-2 py-1 text-right font-mono"></td>
              <td className="px-2 py-1 text-right font-mono">{formatCurrency(cf.reduce((s, c) => s + c.landLoanDrawdown, 0))}</td>
              <td className="px-2 py-1 text-right font-mono">{formatCurrency(cf.reduce((s, c) => s + c.landLoanRepayment, 0))}</td>
              <td className="px-2 py-1 text-right font-mono">{formatCurrency(cf.reduce((s, c) => s + c.landLoanInterest, 0))}</td>
              <td className="px-2 py-1 text-right font-mono"></td>
              <td className="px-2 py-1 text-right font-mono">{formatCurrency(cf.reduce((s, c) => s + c.equityInjection, 0))}</td>
              <td className="px-2 py-1 text-right font-mono">{formatCurrency(cf.reduce((s, c) => s + c.equityRepatriation, 0))}</td>
              <td className="px-2 py-1 text-right font-mono">{formatCurrency(cf.reduce((s, c) => s + c.profitDistribution, 0))}</td>
              <td className="px-2 py-1 text-right font-mono"></td>
              <td className="px-2 py-1 text-right font-mono"></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
