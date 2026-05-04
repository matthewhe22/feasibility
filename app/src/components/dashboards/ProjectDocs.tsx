import { useState } from 'react';

const sections = [
  { id: 'timeline', label: 'Timeline & Periods' },
  { id: 'scurve', label: 'S-Curve Methodology' },
  { id: 'costs', label: 'Cost Calculations' },
  { id: 'actuals', label: 'Actuals Overlay' },
  { id: 'revenue', label: 'Revenue Methodology' },
  { id: 'gst', label: 'GST & ITC Recovery' },
  { id: 'funding', label: 'Funding Structure' },
  { id: 'interest', label: 'Interest & Fees' },
  { id: 'solver', label: 'Circular Reference Solver' },
  { id: 'kpis', label: 'KPI Calculations' },
];

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <div id={id} className="mb-10 scroll-mt-16">
      <h2 className="text-lg font-bold text-gray-800 border-b-2 border-blue-500 pb-2 mb-4">{title}</h2>
      <div className="space-y-4 text-sm text-gray-700 leading-relaxed">{children}</div>
    </div>
  );
}

function SubSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <h3 className="text-sm font-semibold text-gray-700 mb-2">{title}</h3>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Formula({ label, formula }: { label: string; formula: string }) {
  return (
    <div className="bg-gray-50 border border-gray-200 rounded p-3 my-2">
      {label && <p className="text-xs text-gray-500 mb-1 font-medium">{label}</p>}
      <code className="text-xs font-mono text-blue-800">{formula}</code>
    </div>
  );
}

function InfoBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-blue-50 border-l-4 border-blue-400 rounded-r p-3 text-sm text-blue-900">
      {children}
    </div>
  );
}

function WarningBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-amber-50 border-l-4 border-amber-400 rounded-r p-3 text-sm text-amber-900">
      {children}
    </div>
  );
}

function Table({ headers, rows }: { headers: string[]; rows: (string | React.ReactNode)[][] }) {
  return (
    <div className="overflow-x-auto my-3">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="bg-gray-100">
            {headers.map((h, i) => (
              <th key={i} className="border border-gray-300 px-3 py-2 text-left font-semibold text-gray-700">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
              {row.map((cell, j) => (
                <td key={j} className="border border-gray-300 px-3 py-1.5 text-gray-700">{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ProjectDocs() {
  const [activeSection, setActiveSection] = useState('timeline');

  const scrollTo = (id: string) => {
    setActiveSection(id);
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="flex gap-6 max-w-7xl mx-auto">
      {/* Sidebar */}
      <aside className="w-52 shrink-0">
        <div className="sticky top-16 bg-white border border-gray-200 rounded-lg shadow-sm p-3">
          <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3 px-1">Contents</p>
          <nav className="space-y-0.5">
            {sections.map(s => (
              <button
                key={s.id}
                onClick={() => scrollTo(s.id)}
                className={`w-full text-left text-xs px-2 py-1.5 rounded transition-colors ${
                  activeSection === s.id
                    ? 'bg-blue-50 text-blue-700 font-semibold'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-800'
                }`}
              >
                {s.label}
              </button>
            ))}
          </nav>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 min-w-0 bg-white border border-gray-200 rounded-lg shadow-sm p-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Project Model Documents</h1>
          <p className="text-sm text-gray-500 mt-1">
            Full methodology reference for the feasibility model — covering how costs, revenue, financing and KPIs are calculated.
          </p>
        </div>

        {/* ── Timeline & Periods ── */}
        <Section id="timeline" title="1. Timeline & Period Generation">
          <p>
            The model operates on a monthly period grid. Each period runs from the 1st to the last day
            of the month. The number of periods equals <strong>Project Span (months) + 10 buffer periods</strong> to
            ensure all tail cashflows are captured.
          </p>
          <SubSection title="Period classification">
            <p>
              Every period is flagged as either <strong>Actual</strong> or <strong>Forecast</strong>:
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li>If the period end-date ≤ <em>Last Actuals Period</em> (set in Admin), it is classified as <strong>Actual</strong>.</li>
              <li>All later periods are classified as <strong>Forecast</strong>.</li>
            </ul>
            <Formula label="Days in period" formula="daysInPeriod = daysBetween(startDate, endDate) + 1" />
          </SubSection>
          <SubSection title="Key dates">
            <p>The first period date is read from <em>Inputs → General → Date of First Period</em>. Subsequent period start dates are derived by advancing one calendar month.</p>
          </SubSection>
          <InfoBox>
            The Actual/Forecast flag is the primary switch throughout all calculations — costs, revenue, interest and funding all branch on this flag to decide whether to use entered actuals or computed forecasts.
          </InfoBox>
        </Section>

        {/* ── S-Curve ── */}
        <Section id="scurve" title="2. S-Curve Methodology">
          <p>
            S-curves define how a total budget is distributed (shaped) across the months it is active.
            Rather than spending evenly, most construction and development costs follow a bell-shaped
            spending pattern — slow start, peak in the middle, tapering at the end.
          </p>
          <SubSection title="Curve types">
            <Table
              headers={['Type', 'How it works', 'Fallback']}
              rows={[
                ['Evenly Split', 'Budget ÷ span — equal amount each month', '—'],
                ['N Month Build (e.g. 41 Month Build)', 'Uses user-defined percentage weights from the Time Distribution tab for that build duration', 'Parabolic approximation if no weights entered'],
                ['Manual S-curve 1–5', 'Uses user-defined monthly percentage weights from the Time Distribution tab', 'Even split if no weights entered'],
              ]}
            />
          </SubSection>
          <SubSection title="Parabolic fallback formula">
            <p>When a build-curve has no user-defined weights, the model generates a parabolic (inverted-U) distribution:</p>
            <Formula
              label="Weight for period i (0-indexed), build span N months"
              formula="dist = |i - N/2| / (N/2)   →   weight[i] = 1 − dist²   →   normalise so sum = 1"
            />
            <p>This produces a smooth bell shape centred on the midpoint of the build period.</p>
          </SubSection>
          <SubSection title="Applying weights to a cost item">
            <p>Each cost line item has a <em>Start Month</em>, <em>Span</em>, <em>Total Budget</em>, and <em>S-Curve</em> assignment. The spread algorithm:</p>
            <ol className="list-decimal pl-5 space-y-1">
              <li>Retrieve normalised weights for the assigned curve and span.</li>
              <li>Map weight[i] → period index <code>(startMonth − 1) + i</code>.</li>
              <li>Assign <code>amount[period] = totalBudget × weight[i]</code>.</li>
            </ol>
          </SubSection>
          <WarningBox>
            If a named S-curve has no weights defined, the model emits a warning banner at the top of the screen and falls back automatically. Check the Time Distribution tab if you see warnings.
          </WarningBox>
        </Section>

        {/* ── Cost Calculations ── */}
        <Section id="costs" title="3. Cost Calculations">
          <SubSection title="Cost categories">
            <Table
              headers={['Category', 'Code range', 'How spread']}
              rows={[
                ['Land purchase', '—', 'Fixed stage payments evenly split over each stage span'],
                ['PRSV uplift', '—', 'Same as land — evenly split over stage span'],
                ['Stamp duty', '—', 'Single lump sum at month 1 of land acquisition'],
                ['Development costs', '2001–2099', 'S-curve per line item'],
                ['Construction costs', '4001–4099', 'S-curve per line item (typically 41-month build curve)'],
                ['Marketing & advertising', '3001–3010', 'S-curve per line item'],
                ['Other standard costs', '5001–5020', 'S-curve per line item'],
                ['PM fees', '6001–6020', 'Calculated dynamically (see below)'],
                ['Selling & leasing costs', '7001–7010', 'Front-end at presale, back-end at settlement'],
              ]}
            />
          </SubSection>
          <SubSection title="PM fee calculation">
            <p>PM fees are computed as a percentage of the <em>non-finance, non-GST cost base</em>:</p>
            <Formula
              label="PM Fee base"
              formula="PMFeeBase = Σ all costs excluding (GST on costs + finance costs + PM fees themselves)"
            />
            <Formula
              label="PM Fee per period"
              formula="PMFee[t] = pmFeeRate × (devCosts[t] + constructionCosts[t] + marketingCosts[t] + otherCosts[t] + landCosts[t] + sellingCosts[t])"
            />
          </SubSection>
          <SubSection title="Selling cost timing">
            <p>Selling commissions are split into front-end (at presale exchange) and back-end (at settlement):</p>
            <Formula label="Front-end commission" formula="frontEnd = GRV × salesCommissionRate × preCommissionPercent" />
            <Formula label="Back-end commission" formula="backEnd = GRV × salesCommissionRate × (1 − preCommissionPercent)" />
          </SubSection>
        </Section>

        {/* ── Actuals Overlay ── */}
        <Section id="actuals" title="4. Actuals Overlay">
          <p>
            Once a period is marked as <strong>Actual</strong>, the model substitutes entered actuals for
            S-curve forecasts. This allows the model to track real spend against budget and re-forecast
            the remaining budget over future periods.
          </p>
          <SubSection title="Cost actuals logic">
            <ol className="list-decimal pl-5 space-y-1">
              <li>For each <strong>actual period</strong>: use <code>item.actuals[periodIndex]</code> (entered value, or 0 if blank).</li>
              <li>Sum all actuals to get <code>actualTotal</code>.</li>
              <li>Compute <code>remainingBudget = totalBudget − actualTotal</code>.</li>
              <li>Re-spread <code>remainingBudget</code> across <strong>forecast periods only</strong> using the original S-curve weights, re-normalised to sum to 1 over those forecast periods.</li>
            </ol>
          </SubSection>
          <SubSection title="Revenue actuals logic">
            <p>The same pattern applies to GRV settlements: actual receipts are used for actual periods, and any remaining GRV is redistributed evenly across forecast settlement periods.</p>
          </SubSection>
          <SubSection title="Financing actuals overlay">
            <p>
              After the iterative debt solver converges, an <em>actuals overlay pass</em> replaces the
              model-calculated drawdowns, repayments, interest and fees for actual periods with
              user-entered figures. Running totals are then recomputed from the overlaid arrays.
              This keeps the dashboard KPIs aligned with actual bank statements.
            </p>
          </SubSection>
          <InfoBox>
            The <em>Last Actuals Period</em> setting in Admin controls where the actual/forecast boundary falls. Advancing this date progressively locks in real data and tightens the forecast.
          </InfoBox>
        </Section>

        {/* ── Revenue ── */}
        <Section id="revenue" title="5. Revenue Methodology">
          <SubSection title="GRV settlements">
            <p>Each revenue line item (GRV) has a <em>Settlement Month</em> and <em>Settlement Span</em>. The total sale price is distributed evenly across the span:</p>
            <Formula label="Revenue per period" formula="revenue[t] = currentSalePrice / settlementSpan  (for each period in the span)" />
          </SubSection>
          <SubSection title="Presale deposits">
            <p>A 10% deposit is collected at presale exchange, spread evenly across the presale span:</p>
            <Formula label="Deposit amount" formula="depositAmount = currentSalePrice × 10%" />
            <Formula label="Deposit per period" formula="deposit[t] = depositAmount / preSaleSpan  (for each period in the span)" />
            <p className="text-xs text-gray-500 mt-1">Note: deposits are held in trust and offset against the settlement receipt — they are a timing item only and do not affect total GRV.</p>
          </SubSection>
          <SubSection title="Revenue types">
            <Table
              headers={['Type', 'Code range', 'Description']}
              rows={[
                ['GRV — Residential towers', '9001–9005', 'Main apartment/tower sales revenue'],
                ['GRV — Commercial / Retail', '9006–9015', 'Retail and commercial strata or leaseback sales'],
                ['GRV — Hotel', '9016–9020', 'Hotel suite/room sales'],
                ['Rental income', '9101–9110', 'Holding income during construction/lease-up'],
                ['Other income', '9201–9210', 'Car parks, storage, misc'],
              ]}
            />
          </SubSection>
          <SubSection title="Net Realisable Value (NRV)">
            <Formula
              label="NRV formula"
              formula="NRV = totalGRV − GST on residential GRV − back-end selling commissions"
            />
            <p>NRV is used as the denominator for LVR (Loan-to-Value Ratio) facility sizing.</p>
          </SubSection>
        </Section>

        {/* ── GST ── */}
        <Section id="gst" title="6. GST & ITC Recovery">
          <SubSection title="GST on costs">
            <p>GST is applied to each cost line item at the standard rate (10%). The model assumes all costs are GST-exclusive in the input, so:</p>
            <Formula label="GST on costs per period" formula="gstOnCosts[t] = Σ costItems[t] × gstRate" />
          </SubSection>
          <SubSection title="GST on revenue (margin scheme)">
            <p>Residential GRV is typically sold under the GST margin scheme, which reduces the GST liability:</p>
            <Formula label="GST on GRV (margin scheme)" formula="gstOnRevenue[t] = (GRV[t] − landCostAllocation) × gstRate / (1 + gstRate)" />
            <p>Commercial and hotel GRV apply standard GST.</p>
          </SubSection>
          <SubSection title="Input Tax Credit (ITC) recovery">
            <p>
              GST paid on costs is recovered from the ATO as an Input Tax Credit in the <strong>same period</strong>.
              In the funding waterfall, <code>gstOnCosts</code> is added to revenue each period to net it against
              the cost outflow — so the model effectively funds costs on a GST-exclusive basis.
            </p>
            <Formula label="Effective cost funded by waterfall" formula="netCost[t] = totalCosts[t] − gstOnCosts[t]  (ITC offsets GST paid)" />
          </SubSection>
        </Section>

        {/* ── Funding Structure ── */}
        <Section id="funding" title="7. Funding Structure & Waterfall">
          <p>
            The funding waterfall determines how each period's net cash requirement is met —
            sequencing through debt and equity facilities in priority order until the gap is filled,
            and applying revenue to repay debt in reverse priority order.
          </p>
          <SubSection title="Facility types">
            <Table
              headers={['Facility', 'Role', 'Sizing constraint']}
              rows={[
                ['Land Loan', 'Funds land purchase as a fixed lump sum at a specific month', 'Fixed limit ($120M default)'],
                ['Senior Facility (1/2/3)', 'Primary construction debt — drawn to meet period shortfalls', 'Min(facilityLimit, LTC limit, LVR limit)'],
                ['Mezzanine', 'Second-ranking debt, drawn after senior capacity exhausted', 'Min(facilityLimit, LTC limit, LVR limit)'],
                ['Equity — Developer', 'First-loss equity injected after debt capacity is reached', 'Fixed $ or % of TDC'],
                ['Equity — JV Partner', 'Co-equity partner, injected in proportion to contribution %', 'Fixed $ or % of TDC'],
                ['Additional Loans 1–3', 'Flexible extra facilities (residual stock, preferred equity, etc.)', 'Fixed limit per facility'],
              ]}
            />
          </SubSection>
          <SubSection title="Drawdown priority">
            <p>Each facility has a user-configurable <em>Drawdown Priority</em> (1 = drawn first). Default order:</p>
            <ol className="list-decimal pl-5 space-y-0.5">
              <li>Senior Facility (priority 1)</li>
              <li>Mezzanine (priority 2)</li>
              <li>Developer Equity (priority 3)</li>
              <li>JV Equity (priority 4)</li>
              <li>Senior Facility 2, 3, Additional Loans (priority 5+)</li>
            </ol>
            <p className="mt-2">In each period, the waterfall iterates through this sequence and draws the minimum required to cover the period's net shortfall, respecting each facility's remaining capacity.</p>
          </SubSection>
          <SubSection title="Repayment waterfall">
            <p>
              When revenue exceeds costs in a period (typically at settlement), surplus cash is used to
              repay debt in <strong>reverse priority order</strong> (highest-priority debt repaid last, i.e. senior
              repaid after mezzanine and equity returns are distributed). Profit distributions to equity
              are made once all senior debt is repaid.
            </p>
          </SubSection>
          <SubSection title="Facility sizing (LTC / LVR)">
            <Formula label="LTC limit" formula="seniorLtcLimit = TDC × ltcTarget%" />
            <Formula label="LVR limit" formula="seniorLvrLimit = NRV × lvrTarget%" />
            <Formula label="Effective facility limit" formula="effectiveLimit = min(facilityLimit, LTC limit, LVR limit)" />
          </SubSection>
        </Section>

        {/* ── Interest & Fees ── */}
        <Section id="interest" title="8. Interest & Fee Calculations">
          <SubSection title="Senior interest (daily rate on opening balance)">
            <p>Interest is charged on the <strong>opening drawn balance</strong> for the period using a daily-rate formula:</p>
            <Formula
              label="Senior interest per period"
              formula="interest[t] = openingBalance[t] × allInRate × daysInPeriod[t] / daysPerYear"
            />
            <Formula label="All-in rate" formula="allInRate = margin + BBSY  (line fee is a separate charge)" />
          </SubSection>
          <SubSection title="Line fee (on peak drawn balance)">
            <p>
              The line fee is charged on the <strong>peak drawn balance</strong> reached over the facility term —
              reflecting the maximum committed exposure. The peak balance converges through the iterative solver.
            </p>
            <Formula
              label="Line fee per period (while facility is active)"
              formula="lineFee[t] = peakDrawnBalance × lineFeePercent × daysInPeriod[t] / daysPerYear"
            />
          </SubSection>
          <SubSection title="Land loan interest">
            <p>The land loan uses quarterly interest capitalisation at a flat annual rate:</p>
            <Formula
              label="Land loan interest"
              formula="interest[t] = openingBalance[t] × annualRate × daysInPeriod[t] / daysPerYear"
            />
          </SubSection>
          <SubSection title="Establishment fee">
            <Formula
              label="Establishment fee (charged once at facility start)"
              formula="establishmentFee = facilityLimit × establishmentFeePercent"
            />
          </SubSection>
          <SubSection title="Capitalised interest">
            <p>
              When a facility has <em>Capitalised Interest</em> enabled, interest accrued in a period is
              added to the drawn balance rather than paid in cash — increasing the balance and compounding
              the next period's interest charge.
            </p>
          </SubSection>
        </Section>

        {/* ── Circular Reference Solver ── */}
        <Section id="solver" title="9. Circular Reference Solver">
          <p>
            The model contains a circular dependency: finance costs (interest + fees) depend on the
            facility size, the facility size depends on Total Development Cost (TDC) via LTC constraints,
            and TDC includes finance costs. 
          </p>
          <SubSection title="Algorithm">
            <ol className="list-decimal pl-5 space-y-1">
              <li>Start with <code>finCosts = 0</code> (no finance costs in TDC).</li>
              <li>Compute <code>TDC = nonFinanceCosts + finCosts</code>.</li>
              <li>Run the full funding waterfall with this TDC to get facility sizes, drawdowns, and interest/fees.</li>
              <li>Extract new <code>finCosts</code> (total senior interest + fees + mezz interest + fees).</li>
              <li>Compare new vs previous <code>finCosts</code>. If all differences &lt; <strong>$10 tolerance</strong>, stop.</li>
              <li>Otherwise, set <code>finCosts = newFinCosts</code> and go to step 2.</li>
              <li>Maximum 50 iterations (convergence typically achieved in 5–10).</li>
            </ol>
          </SubSection>
          <Formula
            label="Convergence check"
            formula="|newSeniorFinCosts − prevSeniorFinCosts| < $10  AND  |newMezzFinCosts − prevMezzFinCosts| < $10"
          />
          <InfoBox>
            The peak drawn balance used for the line fee also converges through this loop — each iteration passes the previous peak balance as the fee basis, which stabilises to the true peak debt.
          </InfoBox>
        </Section>

        {/* ── KPIs ── */}
        <Section id="kpis" title="10. KPI Calculations">
          <SubSection title="Cash-on-Cash (CoC)">
            <Formula label="Total CoC" formula="CoC = totalProfitDistributions / totalEquityInjected" />
            <Formula label="Annual CoC" formula="annualCoC = (CoC ^ (12 / projectSpanMonths)) − 1" />
          </SubSection>
          <SubSection title="Return on Investment (ROI)">
            <Formula label="ROI" formula="ROI = totalProfit / totalDevelopmentCost" />
            <p>Where <code>totalProfit = totalGRV − totalDevelopmentCost</code> (excluding GST netting).</p>
          </SubSection>
          <SubSection title="Internal Rate of Return (IRR)">
            <p>
              IRR is computed on the <strong>equity cashflow series</strong> — equity injections are negative
              cashflows, profit distributions are positive cashflows. The Newton–Raphson method iterates
              to find the monthly rate <em>r</em> that satisfies:
            </p>
            <Formula
              label="IRR definition"
              formula="NPV = Σ cashFlow[t] / (1 + r)^t = 0  →  solve for r  →  annualIRR = (1 + r)^12 − 1"
            />
            <p>Starting guess is 10% annual. Convergence tolerance is 1×10⁻⁸, maximum 1,000 iterations.</p>
          </SubSection>
        </Section>

      </main>
    </div>
  );
}
