import { useStore } from '../../store/useStore';
import { CurrencyInput, PercentInput, NumberInput, SectionHeader } from '../common/FormFields';
import { computeDrawdownSequence } from '../../engine/funding';
import type { EquityConfig, DebtFacility, MainInputs, MinEquityRequirement } from '../../types';
import { getFacilityLimitHelperText } from './facilityLimitHelperText';

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
        <CurrencyInput label="Equity Cap ($)" value={config.equityCap} onChange={v => update('equityCap', v)} />
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

/**
 * Facility-limit helper text.
 *
 * When `isCapitalised`, the user-set facility limit is a covenant cap on the
 * PEAK OUTSTANDING BALANCE (interest compounds into balance). PR #56 replaced
 * the closed-form `principal_cap = facilityLimit / (1 + r)^N` back-solve with
 * a timing-aware loop in the engine — there is no longer a single static
 * principal cap to display, so we just describe the limit semantics.
 *
 * When NOT capitalised, the facility limit is the maximum principal drawn
 * (interest is cash-paid each period and never adds to the balance).
 */
function FacilityLimitHint({ facility, isResidualStock = false }: { facility: DebtFacility; isResidualStock?: boolean }) {
  const helperText = getFacilityLimitHelperText(facility, isResidualStock);
  return (
    <div className="-mt-1 mb-1 ml-[14.5rem] text-[10px]">
      <span className="text-gray-500">{helperText}</span>
    </div>
  );
}


function DebtSection({ title, facility, isLandLoan = false, isResidualStock = false, onChange }: {
  title: string;
  facility: DebtFacility;
  isLandLoan?: boolean;
  isResidualStock?: boolean;
  onChange: (f: DebtFacility) => void;
}) {
  // L4 — generic-bound update: TS now type-checks every call site against the
  // concrete field type. `lineFeeBasis` (string union) and `lenderIsGSTExempt`
  // (boolean) consumers below are exercised — the signature catches future
  // misuse like `update('interestRate', 'five percent')`.
  const update = <K extends keyof DebtFacility>(field: K, value: DebtFacility[K]) => {
    onChange({ ...facility, [field]: value });
  };

  const disabled = (facility.facilityLimit ?? 0) <= 0;
  const handleDisable = () => {
    if (!confirm(`Zero out "${title}"? Facility limit, fees, rates and start/maturity all reset to 0.`)) return;
    onChange({
      ...facility,
      facilityLimit: 0,
      startMonth: 0,
      maturityMonth: 0,
      interestRate: 0,
      bbsy: 0,
      margin: 0,
      establishmentFeePercent: 0,
      lineFeePercent: 0,
      ltcTarget: 0,
      lvrTarget: 0,
      isCapitalised: false,
    });
  };

  return (
    <div className="border border-gray-200 rounded mb-3">
      <div className="bg-orange-50 px-3 py-1.5 border-b border-gray-200 flex items-center justify-between">
        <span className="text-xs font-bold text-orange-800">
          {title}
          {disabled && <span className="ml-2 text-[10px] font-normal text-gray-500 italic">(disabled — limit = 0)</span>}
        </span>
        <button
          type="button"
          onClick={handleDisable}
          className="text-[10px] bg-red-100 hover:bg-red-200 text-red-700 border border-red-300 px-2 py-0.5 rounded"
          title="Set facility limit, fees and rates to 0 so this facility produces no draws, interest or fees."
        >
          Zero out / disable
        </button>
      </div>
      <div className="p-3 space-y-1.5">
        <CurrencyInput label="Facility Limit" value={facility.facilityLimit} onChange={v => update('facilityLimit', v)} />
        <FacilityLimitHint facility={facility} isResidualStock={isResidualStock} />
        {!disabled && (facility.isCapitalised || (facility.establishmentFeePercent ?? 0) > 0 || (facility.lineFeePercent ?? 0) > 0) && (
          <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 mt-1">
            <strong>Heads up:</strong> with a non-zero facility limit + non-zero fees or capitalised interest, this
            facility will record drawdowns even if construction needs nothing from it — establishment fees,
            line fees and accrued interest are drawn from the facility itself. Click <em>Zero out / disable</em>
            above to suppress all activity.
          </p>
        )}
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
          <p className="text-[10px] font-semibold text-gray-500 mb-1">Interest & Fee Treatment</p>
          <div className="flex items-center gap-2 mt-1">
            <span
              className="text-xs text-gray-600 w-56 shrink-0"
              title="Capitalised: interest and line fees compound into the loan balance — no cash outflow during the holding period; cleared via the revenue/equity sweep when the facility is repaid. Cash-pay: interest and fees are paid out of the project bank account every period (funded by equity / revenue / further drawdowns)."
            >
              Interest & Line Fee Treatment
            </span>
            <select
              value={facility.isCapitalised ? 'capitalised' : 'cash-pay'}
              onChange={e => update('isCapitalised', e.target.value === 'capitalised')}
              className="text-xs bg-yellow-50 border border-gray-300 rounded px-2 py-0.5"
            >
              <option value="cash-pay">Cash-pay (paid each period)</option>
              <option value="capitalised">Capitalised (compounds into balance)</option>
            </select>
          </div>
          <p className="text-[10px] text-gray-500 mt-1">
            {facility.isCapitalised
              ? 'Capitalised: accrued interest and line fees roll into the loan balance and are cleared from sales revenue (or equity backstop) when the facility is repaid.'
              : 'Cash-pay: interest and line fees are drawn from the project bank every period — equity backstops any shortfall not covered by revenue or available drawdowns.'}
          </p>
        </div>
        <div className="border-t border-gray-100 pt-1.5 mt-1.5">
          <p className="text-[10px] font-semibold text-gray-500 mb-1">Constraints</p>
          <PercentInput label="Target LTC" value={facility.ltcTarget} onChange={v => update('ltcTarget', v)} />
          <PercentInput label="Target LVR" value={facility.lvrTarget} onChange={v => update('lvrTarget', v)} />
        </div>
        {isLandLoan && (
          <div className="border-t border-gray-100 pt-1.5 mt-1.5">
            <p className="text-[10px] font-semibold text-gray-500 mb-1">Interest Payment Schedule</p>
            <div className="flex items-center gap-2 mt-1">
              <span
                className="text-xs text-gray-600 w-56 shrink-0"
                title="Monthly: pay interest every period. Quarterly: accrue 3 periods, pay at end of quarter. Cash-pay mode only — disabled when interest is capitalised (compounds every period regardless)."
              >
                Interest Payment Frequency
              </span>
              <select
                value={(facility.interestPaymentFrequency ?? 1) === 3 ? '3' : '1'}
                disabled={!!facility.isCapitalised}
                onChange={e => update('interestPaymentFrequency', e.target.value === '3' ? 3 : 1)}
                className={`text-xs border border-gray-300 rounded px-2 py-0.5 ${
                  facility.isCapitalised ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-yellow-50'
                }`}
              >
                <option value="1">Monthly</option>
                <option value="3">Quarterly</option>
              </select>
            </div>
            {facility.isCapitalised && (
              <p className="text-[10px] text-gray-500 italic mt-1">
                Frequency is disabled in capitalised mode — interest compounds into the balance every period regardless.
              </p>
            )}
          </div>
        )}
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

function RepaymentSequenceBanner() {
  const { admin, setAdmin } = useStore();
  // M3 — Cash-sweep order for the revenue waterfall. Default = legal priority.
  const seq = admin.repaymentSequence ?? ['senior', 'mezz', 'equity'] as const;
  const isLegalOrder = seq[0] === 'senior';
  return (
    <div className="mb-4 border border-emerald-200 rounded bg-emerald-50 p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold text-emerald-800 mb-1.5">Repayment Sequence (cash-sweep order)</p>
          <div className="flex items-center gap-1 text-xs text-emerald-900 font-medium">
            <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-emerald-600 text-white text-[10px] font-bold">1</span>
            <span>{isLegalOrder ? 'Senior' : 'Mezz'}</span>
            <span className="text-emerald-400 font-bold mx-1">→</span>
            <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-emerald-600 text-white text-[10px] font-bold">2</span>
            <span>{isLegalOrder ? 'Mezz' : 'Senior'}</span>
            <span className="text-emerald-400 font-bold mx-1">→</span>
            <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-emerald-600 text-white text-[10px] font-bold">3</span>
            <span>Equity</span>
          </div>
        </div>
        <select
          className="text-xs bg-white border border-emerald-300 rounded px-2 py-1 text-emerald-900 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          value={isLegalOrder ? 'legal' : 'cash-sweep'}
          onChange={e => {
            const next = e.target.value === 'legal'
              ? ['senior', 'mezz', 'equity'] as ('senior' | 'mezz' | 'equity')[]
              : ['mezz', 'senior', 'equity'] as ('senior' | 'mezz' | 'equity')[];
            setAdmin({ repaymentSequence: next });
          }}
          title="Senior → Mezz → Equity is the legal priority (default). Mezz → Senior → Equity is sometimes used as a cash-sweep on retail fund mandates so the highest-rate debt clears first. Equity is always last. Legal priority on default is unaffected by this setting."
        >
          <option value="legal">Senior → Mezz → Equity (default — legal priority)</option>
          <option value="cash-sweep">Mezz → Senior → Equity (high-rate-first cash sweep)</option>
        </select>
      </div>
      <p className="text-[10px] text-emerald-500 mt-1.5">
        Cash-sweep order only — the LEGAL priority on default remains senior-first regardless of this setting.
      </p>
    </div>
  );
}

// ===== MIN EQUITY REQUIREMENT (term-sheet cross-check) =====

function MinEquityRequirementCard({ value, onChange }: {
  value: MinEquityRequirement;
  onChange: (v: MinEquityRequirement) => void;
}) {
  const isActive = (value?.value ?? 0) > 0;
  return (
    <div className="mb-4 border border-purple-200 rounded bg-purple-50 p-3">
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="min-w-0">
          <p className="text-xs font-bold text-purple-800">Minimum Equity Requirement</p>
          <p
            className="text-[10px] text-purple-600 mt-0.5"
            title="Cross-check against term-sheet equity floor — emits warning if actual cash equity falls below"
          >
            Cross-check against term-sheet equity floor — emits warning if actual cash equity falls below.
          </p>
        </div>
        <span className={`text-[10px] px-2 py-0.5 rounded font-semibold ${
          isActive ? 'bg-purple-600 text-white' : 'bg-gray-200 text-gray-600'
        }`}>
          {isActive ? 'Active' : 'Disabled (value = 0)'}
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs text-purple-900 w-16 shrink-0">Mode</span>
          <select
            value={value?.mode ?? 'percent'}
            onChange={e => onChange({ ...value, mode: e.target.value as 'percent' | 'amount' })}
            className="text-xs bg-white border border-purple-300 rounded px-2 py-0.5 flex-1"
          >
            <option value="percent">Percent of basis</option>
            <option value="amount">Fixed $ amount</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-purple-900 w-16 shrink-0">Value</span>
          {value?.mode === 'amount' ? (
            <CurrencyInput
              label=""
              value={value?.value ?? 0}
              onChange={v => onChange({ ...value, value: v })}
            />
          ) : (
            <PercentInput
              label=""
              value={value?.value ?? 0}
              onChange={v => onChange({ ...value, value: v })}
            />
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-purple-900 w-16 shrink-0">Basis</span>
          <select
            value={value?.basis ?? 'tdc-incl-finance-costs'}
            onChange={e => onChange({ ...value, basis: e.target.value as 'tdc' | 'tdc-incl-finance-costs' })}
            className="text-xs bg-white border border-purple-300 rounded px-2 py-0.5 flex-1"
          >
            <option value="tdc-incl-finance-costs">TDC + financing costs</option>
            <option value="tdc">TDC (excl. financing costs)</option>
          </select>
        </div>
      </div>
      <p className="text-[10px] text-purple-500 mt-2">
        Default = 0 (disabled). Set value &gt; 0 to enable a [FUNDING] warning + Checks-tab FAIL when
        converged cash equity (developer + JV draws) falls below the required amount.
        Most term sheets reference TDC including capitalised finance costs.
      </p>
      <p className="text-[10px] text-purple-700 mt-1 font-semibold" title="Bug 3 fix: percent mode is a fraction in [0, 1] — enter 0.10 for 10%. The v9 migration heals legacy values > 1.">
        ⓘ Percent mode = fraction in [0,&nbsp;1]. Enter <code>0.10</code> for <strong>10%</strong>, not <code>10</code>.
        Values &gt; 1 are healed by the v9 migration (<code>10</code> → <code>0.10</code>).
      </p>
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
        <RepaymentSequenceBanner />
        <MinEquityRequirementCard
          value={inputs.minEquityRequirement ?? { mode: 'percent', value: 0, basis: 'tdc-incl-finance-costs' }}
          onChange={v => setInputs({ minEquityRequirement: v })}
        />

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
              isResidualStock={true}
              onChange={(f) => setInputs({ residualStockFacility: f })}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
