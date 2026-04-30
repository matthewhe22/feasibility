import { useStore } from '../../store/useStore';
import { CurrencyInput, PercentInput, NumberInput, SectionHeader } from '../common/FormFields';
import { computeDrawdownSequence } from '../../engine/funding';
import type { EquityConfig, DebtFacility, MainInputs } from '../../types';

// ===== DRAWDOWN SEQUENCE BANNER =====

function DrawdownSequenceBanner({ inputs }: { inputs: MainInputs }) {
  const sequence = computeDrawdownSequence(inputs);
  return (
    <div className="mb-4 border border-indigo-200 rounded bg-indigo-50 p-3">
      <p className="text-xs font-bold text-indigo-800 mb-2">Drawdown Sequence (gap-fill order)</p>
      <div className="flex items-center gap-2 flex-wrap">
        {sequence.map((entry, idx) => (
          <div key={entry.type} className="flex items-center gap-1">
            <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-indigo-600 text-white text-[10px] font-bold">
              {idx + 1}
            </span>
            <span className="text-xs text-indigo-900 font-medium">{entry.name}</span>
            <span className="text-[10px] text-indigo-500">({entry.type})</span>
            {idx < sequence.length - 1 && (
              <span className="text-indigo-400 font-bold mx-1">→</span>
            )}
          </div>
        ))}
        <span className="text-[10px] text-indigo-400 ml-2">→ equity backstop (uncapped)</span>
      </div>
      <p className="text-[10px] text-indigo-500 mt-1.5">
        Set <strong>Drawdown Priority</strong> on each facility below (1&nbsp;=&nbsp;first drawn, higher&nbsp;=&nbsp;later).
        The land loan is excluded — it is always drawn as a lump sum at its fixed start month.
      </p>
    </div>
  );
}

// ===== EQUITY SECTION =====

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
        <div className="border-t border-gray-100 pt-1.5 mt-1.5">
          <p className="text-[10px] font-semibold text-indigo-600 mb-1">Drawdown Sequence</p>
          <NumberInput
            label="Drawdown Priority (1 = first drawn)"
            value={config.drawdownPriority}
            onChange={v => update('drawdownPriority', v)}
          />
        </div>
      </div>
    </div>
  );
}

// ===== DEBT SECTION =====

function DebtSection({ title, facility, isLandLoan = false, onChange }: {
  title: string;
  facility: DebtFacility;
  isLandLoan?: boolean;
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
          <div className="flex items-center gap-2 mt-1">
            <span className="text-xs text-gray-600 w-56 shrink-0" title="Line Fee basis: Peak Drawn (default) — converges to actual peak debt via solver. Committed Limit — charge on the full approved facility (some term sheets). Undrawn Commitment — only on limit − drawn (commitment-fee style).">Line Fee Basis</span>
            <select
              value={facility.lineFeeBasis ?? 'peak-drawn'}
              onChange={e => update('lineFeeBasis', e.target.value as 'peak-drawn' | 'committed-limit' | 'undrawn-commitment')}
              className="text-xs bg-yellow-50 border border-gray-300 rounded px-2 py-0.5"
            >
              <option value="peak-drawn">Peak Drawn (default)</option>
              <option value="committed-limit">Committed Limit</option>
              <option value="undrawn-commitment">Undrawn Commitment</option>
            </select>
          </div>
          {(facility.lineFeeBasis ?? 'peak-drawn') === 'peak-drawn' && (facility.lineFeePercent ?? 0) > 0 && (
            <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 mt-1">
              Term sheet note: most senior construction facilities (e.g. Goldman Sachs indicative terms) charge the line fee on the <strong>Facility Limit</strong> from Financial Close. Consider switching to <em>Committed Limit</em> for lender-facing models.
            </p>
          )}
          <div className="flex items-center gap-2 mt-1">
            <span className="text-xs text-gray-600 w-56 shrink-0" title="If the lender is a GST-exempt financial institution (GSTA s.40-60, typical for banks), fees are GST-free. Non-bank lenders may charge GST on fees with no ITC available (s.11-15).">Lender GST Exempt</span>
            <select
              value={(facility.lenderIsGSTExempt ?? true) ? 'yes' : 'no'}
              onChange={e => update('lenderIsGSTExempt', e.target.value === 'yes')}
              className="text-xs bg-yellow-50 border border-gray-300 rounded px-2 py-0.5"
            >
              <option value="yes">Yes (exempt — fees GST-free)</option>
              <option value="no">No (fees GST-inclusive)</option>
            </select>
          </div>
        </div>
        <div className="border-t border-gray-100 pt-1.5 mt-1.5">
          <p className="text-[10px] font-semibold text-gray-500 mb-1">Constraints</p>
          <PercentInput label="Target LTC" value={facility.ltcTarget} onChange={v => update('ltcTarget', v)} />
          <PercentInput label="Target LVR" value={facility.lvrTarget} onChange={v => update('lvrTarget', v)} />
        </div>
        <div className="border-t border-gray-100 pt-1.5 mt-1.5">
          <p className="text-[10px] font-semibold text-indigo-600 mb-1">Drawdown Sequence</p>
          {isLandLoan ? (
            <p className="text-[10px] text-gray-400 italic">
              Land loan is drawn as a lump sum at its fixed start month and is not part of
              the configurable gap-fill sequence.
            </p>
          ) : (
            <NumberInput
              label="Drawdown Priority (1 = first drawn)"
              value={facility.drawdownPriority}
              onChange={v => update('drawdownPriority', v)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ===== MAIN COMPONENT =====

export function FinancingInputs() {
  const { inputs, setInputs } = useStore();

  return (
    <div>
      <SectionHeader number="4" title="FINANCING" />
      <div className="bg-white border border-t-0 border-gray-200 rounded-b p-4">

        <DrawdownSequenceBanner inputs={inputs} />

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {/* Left column: Equity */}
          <div>
            <h4 className="text-sm font-bold text-gray-700 mb-2">4.1 Equity</h4>
            <EquitySection
              title={inputs.equityDeveloper?.name ?? 'Developer'}
              config={inputs.equityDeveloper}
              onChange={(c) => setInputs({ equityDeveloper: c })}
            />
            <EquitySection
              title={inputs.equityJV?.name ?? 'JV Partner'}
              config={inputs.equityJV}
              onChange={(c) => setInputs({ equityJV: c })}
            />
            <EquitySection
              title={inputs.equityPreferred?.name ?? 'Preferred Equity'}
              config={inputs.equityPreferred}
              onChange={(c) => setInputs({ equityPreferred: c })}
            />
            <EquitySection
              title={inputs.equityAdditional?.name ?? 'Additional Equity #1'}
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
              isLandLoan={true}
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
              title="Senior Facility #2"
              facility={inputs.seniorFacility2}
              onChange={(f) => setInputs({ seniorFacility2: f })}
            />
            <DebtSection
              title="Residual Stock Facility"
              facility={inputs.residualStockFacility}
              onChange={(f) => setInputs({ residualStockFacility: f })}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
