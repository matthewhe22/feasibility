import { useStore } from '../../store/useStore';
import { CurrencyInput, PercentInput, NumberInput, SectionHeader } from '../common/FormFields';
import type { EquityConfig, DebtFacility } from '../../types';

function EquitySection({ title, config, onChange }: {
  title: string;
  config: EquityConfig;
  onChange: (c: EquityConfig) => void;
}) {
  const update = (field: keyof EquityConfig, value: number) => {
    onChange({ ...config, [field]: value });
  };

  return (
    <div className="border border-gray-200 rounded mb-3">
      <div className="bg-blue-50 px-3 py-1.5 border-b border-gray-200">
        <span className="text-xs font-bold text-blue-800">Equity ({title})</span>
      </div>
      <div className="p-3 space-y-1.5">
        <CurrencyInput label="Fixed Amount" value={config.fixedAmount} onChange={v => update('fixedAmount', v)} />
        <PercentInput label="Percentage of Costs" value={config.percentage} onChange={v => update('percentage', v)} />
        <PercentInput label="Interest Rate (p.a.)" value={config.interestRate} onChange={v => update('interestRate', v)} />
        <NumberInput label="Compound (1) / Simple (0)" value={config.interestCompound} onChange={v => update('interestCompound', v)} />
        <PercentInput label="Repay Equity Before Debt %" value={config.repayEquityBeforeDebt} onChange={v => update('repayEquityBeforeDebt', v)} />
        <PercentInput label="Equity Contribution %" value={config.equityContribution} onChange={v => update('equityContribution', v)} />
        <PercentInput label="Profit Share %" value={config.profitShare} onChange={v => update('profitShare', v)} />
      </div>
    </div>
  );
}

function DebtSection({ title, facility, onChange }: {
  title: string;
  facility: DebtFacility;
  onChange: (f: DebtFacility) => void;
}) {
  const update = (field: keyof DebtFacility, value: any) => {
    onChange({ ...facility, [field]: value });
  };

  return (
    <div className="border border-gray-200 rounded mb-3">
      <div className="bg-orange-50 px-3 py-1.5 border-b border-gray-200">
        <span className="text-xs font-bold text-orange-800">{title}</span>
      </div>
      <div className="p-3 space-y-1.5">
        <CurrencyInput label="Facility Limit" value={facility.facilityLimit} onChange={v => update('facilityLimit', v)} />
        <NumberInput label="Start Month" value={facility.startMonth} onChange={v => update('startMonth', v)} />
        <NumberInput label="Maturity (months from start)" value={facility.maturityMonth} onChange={v => update('maturityMonth', v)} />
        <div className="border-t border-gray-100 pt-1.5 mt-1.5">
          <p className="text-[10px] font-semibold text-gray-500 mb-1">Interest Rates</p>
          <PercentInput label="Margin Rate" value={facility.margin} onChange={v => update('margin', v)} />
          <PercentInput label="BBSY Rate" value={facility.bbsy} onChange={v => update('bbsy', v)} />
          <div className="flex items-center gap-2 mt-1">
            <span className="text-xs text-gray-600 w-56 shrink-0">All-in Rate</span>
            <span className="text-xs font-semibold text-gray-800 w-28 text-right">
              {((facility.margin + facility.bbsy) * 100).toFixed(2)}%
            </span>
          </div>
        </div>
        <div className="border-t border-gray-100 pt-1.5 mt-1.5">
          <p className="text-[10px] font-semibold text-gray-500 mb-1">Fees</p>
          <PercentInput label="Establishment Fee" value={facility.establishmentFeePercent} onChange={v => update('establishmentFeePercent', v)} />
          <PercentInput label="Annual Line Fee" value={facility.lineFeePercent} onChange={v => update('lineFeePercent', v)} />
        </div>
        <div className="border-t border-gray-100 pt-1.5 mt-1.5">
          <p className="text-[10px] font-semibold text-gray-500 mb-1">Constraints</p>
          <PercentInput label="Target LTC" value={facility.ltcTarget} onChange={v => update('ltcTarget', v)} />
          <PercentInput label="Target LVR" value={facility.lvrTarget} onChange={v => update('lvrTarget', v)} />
        </div>
      </div>
    </div>
  );
}

export function FinancingInputs() {
  const { inputs, setInputs } = useStore();

  return (
    <div>
      <SectionHeader number="4" title="FINANCING" />
      <div className="bg-white border border-t-0 border-gray-200 rounded-b p-4">
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {/* Left column: Equity */}
          <div>
            <h4 className="text-sm font-bold text-gray-700 mb-2">4.1 Equity</h4>
            <EquitySection
              title={inputs.equityKokoda.name}
              config={inputs.equityKokoda}
              onChange={(c) => setInputs({ equityKokoda: c })}
            />
            <EquitySection
              title={inputs.equityJV.name}
              config={inputs.equityJV}
              onChange={(c) => setInputs({ equityJV: c })}
            />
            <EquitySection
              title={inputs.equityPreferred.name}
              config={inputs.equityPreferred}
              onChange={(c) => setInputs({ equityPreferred: c })}
            />
            <EquitySection
              title={inputs.equityAdditional.name}
              config={inputs.equityAdditional}
              onChange={(c) => setInputs({ equityAdditional: c })}
            />
          </div>

          {/* Right column: Debt */}
          <div>
            <h4 className="text-sm font-bold text-gray-700 mb-2">4.2 Debt</h4>
            <DebtSection
              title="Land Loan Facility"
              facility={inputs.landLoan}
              onChange={(f) => setInputs({ landLoan: f })}
            />
            <DebtSection
              title="Mezzanine Finance"
              facility={inputs.mezzanine}
              onChange={(f) => setInputs({ mezzanine: f })}
            />
            <DebtSection
              title="Senior Construction Facility"
              facility={inputs.seniorFacility}
              onChange={(f) => setInputs({ seniorFacility: f })}
            />
            <DebtSection
              title="Residual Stock Facility"
              facility={inputs.residualStockFacility}
              onChange={(f) => setInputs({ residualStockFacility: f })}
            />
            <DebtSection
              title="Additional Loan #1"
              facility={inputs.additionalLoan1}
              onChange={(f) => setInputs({ additionalLoan1: f })}
            />
            <DebtSection
              title="Additional Loan #2"
              facility={inputs.additionalLoan2}
              onChange={(f) => setInputs({ additionalLoan2: f })}
            />
            <DebtSection
              title="Additional Loan #3"
              facility={inputs.additionalLoan3}
              onChange={(f) => setInputs({ additionalLoan3: f })}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
