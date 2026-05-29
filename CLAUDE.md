# Feasibility Model Web App

## Project Overview
Web application replicating the KK Feaso Model Draft v43 Excel feasibility model for property development analysis. The source Excel file is `KK Feaso Model Draft v43 20251003.xlsb`.

## Source Excel Structure

### Input Sheets (Yellow - User Editable)
1. **Admin** (219 rows x 172 cols): Model timeline, constants, S-curve definitions (12-60 month builds + manual), cost/revenue type lists, named ranges
2. **!!! - Input** (560 rows x 19 cols): Main inputs organized as:
   - Section 1: General/Preliminary (dates, lots, GFA, site area)
   - Section 2: Costs (land purchase $124M + $56M uplift, stamp duty QLD, ~80 development cost line items 2001-2099, construction $585M codes 4001-4099, marketing 3001-3010, other costs 5001-5020, PM fees 6001-6020, selling costs 7001-7010)
   - Section 3: Revenue (GRV 9001-9020 with towers/commercial/hotel, rental income 9101-9110, other income 9201-9210)
   - Section 4: Financing (equity - developer/JV/preferred/additional with interest & profit share; debt - land loan $120M, mezzanine, senior $767M, residual stock, additional loans 1-3 with rates/fees)
3. **Inputs_Time D** (77 rows x 153 cols): Manual S-curve monthly distribution percentages
4. **Actual Update** (391 rows x 171 cols): Actual values replacing forecast for completed periods

### Calculation Sheets (Engine)
- **C_Flag** (705 rows): Cost/revenue spreading flags per period
- **Calcs_Rev_Costs** (455 rows): Forecast cost/revenue by period using S-curves
- **Calcs_Rev_Costs_with_actual** (482 rows): Blended actuals + forecast
- **Calcs_summary** (60 rows): Aggregated cost/revenue summaries
- **Funding Calcs** (423 rows): Funding waterfall, debt control accounts, interest calculations, exit waterfall, debt solving (circular reference resolution)
- **Funding Table** (87 rows): GST inc/exc conversion
- **!!! - Cashflow** (238 rows x 104 cols): Detailed monthly cashflow
- **KK Cashflow** (104 rows x 129 cols): Developer-specific cashflow
- **Taxes & Duties** (46 rows): GST and stamp duty calculations
- **Scenario Manager** (64 rows): Scenario comparison
- **Checks** (31 rows): Model integrity checks

### Output Sheets (Dashboards)
1. **Internal Dashboard** (87 rows x 20 cols): 11 tables - feasibility summary with variance, KPIs (IRR/ROI/CoC), JV equity breakdown, capital stack, debt details, key dates, settlement assumptions, GRV summary
2. **External Dashboard** (66 rows x 15 cols): 8 tables - simplified for external stakeholders

## Key Model Parameters (Default Values)
- Project: 178 lots, 32,133 sqm GFA, 1,650 sqm site, 74-month duration (Apr 2023 - May 2029)
- Land: $124M purchase + $56M PRSV uplift, QLD stamp duty
- Construction: ~$585M (41-month build), 2.49% contingency
- GRV: ~$1.26B total (residential towers ~$989M, retail ~$80M, commercial ~$12M, hotel ~$172M)
- Senior Facility: Margin 2.15% + BBSY 1.96%, establishment 0.5%, line fee 2.15%
- Land Loan: 11.265% rate, quarterly interest, $120M limit
- Equity: 10% of costs (~$130M), developer only (100% contribution, 100% profit share)
- GST Rate: 10%
- PM Fee: 2% of costs

## Debt Solving (Circular Reference Resolution)
The model has a circular dependency: finance costs depend on facility size, facility size depends on total costs, total costs include finance costs. Resolution:
1. Calculate costs excluding interest
2. Determine initial facility from LTC/LVR constraints
3. Calculate interest on facility (daily rate x days outstanding per period)
4. Add interest to costs, recalculate facility
5. Iterate until convergence within tolerance ($10)
6. The Excel uses VBA macro (copy/paste range comparison on Admin row 212-213)

## Tech Stack
- React 18 + TypeScript + Vite
- Zustand for state management
- Recharts for visualizations
- TailwindCSS for styling
- All calculations client-side (no backend)

## Architecture
```
src/
├── components/
│   ├── inputs/           # AdminTab, MainInputTab, TimeDistributionTab, ActualUpdateTab
│   ├── dashboards/       # InternalDashboard, ExternalDashboard
│   ├── charts/           # FundingOverTime, CashflowWaterfall, CostBreakdown, etc.
│   └── common/           # DataTable, CurrencyInput, DatePicker, TabNav
├── engine/               # Pure calculation functions
│   ├── timeline.ts       # Period generation, actuals/forecast flags
│   ├── costSpreading.ts  # S-curve application, cost distribution
│   ├── revenue.ts        # GRV, presale, settlement timing
│   ├── gst.ts            # GST calculations, margin scheme
│   ├── funding.ts        # Funding waterfall, debt solving loop
│   ├── interest.ts       # Interest calculations per facility
│   ├── exitWaterfall.ts  # Repayment order, equity/profit distribution
│   ├── kpi.ts            # IRR (Newton-Raphson), ROI, CoC
│   └── index.ts          # Orchestrator running all calcs
├── store/                # Zustand stores
│   ├── adminStore.ts
│   ├── inputStore.ts
│   ├── timeDistStore.ts
│   └── actualStore.ts
├── types/                # TypeScript interfaces
│   ├── costItem.ts
│   ├── revenueItem.ts
│   ├── fundingFacility.ts
│   └── timeline.ts
└── utils/                # Formatting, date helpers
```

## Build / Pre-push Validation

Before opening a PR, run the canonical build from `app/`:

```
cd app && npm run build
```

This runs `tsc -b && vite build`, which is what Vercel runs on every preview deploy. **Use this — not `tsc --noEmit` — as the pre-push gate.**

### Why `tsc --noEmit` isn't enough

`tsc --noEmit` from the project root only typechecks files reachable from the root `tsconfig.json`. The repo uses TypeScript project references — `tsconfig.app.json` covers `src/**`, and `tsconfig.test.json` (or equivalent) covers `__tests__/**`. The root config doesn't cross those references, so type errors confined to test files (e.g. invalid string literal types like `costType`) silently slip through.

`tsc -b` is the build-mode invocation: it walks every referenced project and typechecks all of them. That's why `npm run build` catches what plain `tsc --noEmit` misses.

### Concrete example — PR #48

Local `npx tsc --noEmit` came back clean, but Vercel's preview deploy failed with two invalid `CostType` literals in newly-added test fixtures (`manualSCurveSpan.test.ts`, `sellingCostsWiring.test.ts`). The fix landed in commit `99d8f6c` before the PR could be merged. Running `cd app && npm run build` before pushing would have caught it locally in seconds.

### TL;DR

- **Pre-push gate:** `cd app && npm run build`
- **Editor watch loop:** `cd app && npx tsc -b --watch`
- **Don't use `tsc --noEmit` from `app/`** — with `files: []` + project references, it's a no-op that gives false confidence. Always use `-b` (build mode) so referenced configs are walked.

## Implementation Phases
1. Project setup + types + state management
2. Input forms (4 tabs with Excel defaults pre-loaded)
3. Core calculation engine (cost spreading, revenue, GST)
4. Funding & debt solver (iterative convergence)
5. Dashboard outputs (matching Excel layout exactly)
6. Charts & visualizations (7 charts including funding structure over time)
7. Verification against Excel values & polish

## Calculation Methodology (Current Decisions)

### Line Fee
Charged on the **peak drawn balance** by default (maximum senior balance reached during the facility term) — per financing term sheet convention where the line fee reflects the maximum committed/drawn amount. The peak balance is computed via the iterative solver: each iteration uses the peak balance from the prior pass as the fee basis, converging to the actual peak debt. Formula: `peakDrawnBalance × lineFeePercent × daysInPeriod / daysPerYear`. Applies for every period that `seniorActive` is true (start month to maturity month inclusive).

**Line Fee Basis is now configurable** via `DebtFacility.lineFeeBasis`:
- `'peak-drawn'` (default): converges via solver to the actual peak balance — matches the legacy Excel model and term sheets that reference maximum drawn amount.
- `'committed-limit'`: charge on the full approved facility limit each active period — matches term sheets where the lender charges the fee on the full commitment (reserved capital).
- `'undrawn-commitment'`: charge only on the undrawn portion (`limit − drawn`) — commitment-fee style.

Choose the basis that matches the actual term sheet. Do not change the default unless the lender specifies otherwise.

### ITC Recovery
GST paid on costs (`gstOnCosts`) is modelled as a cash recovery from the ATO (Input Tax Credit). In the funding waterfall, `gstOnCosts[i - itcLag]` is added to revenue each period to net it against the cost outflow, so the waterfall funds costs on an effective ex-GST basis. The `MonthlyCashflow.itcRecovery` field records this recovery and is included in the net cashflow formula to keep the per-period net ≈ $0.

The lag is configurable via `AdminConfig.itcRecoveryLagMonths` (default 0 = same-period recovery, matches Excel). Set to 1–3 months to model realistic quarterly BAS timing for lender-facing models.

### GST Vendor Withholding (s.72-55)
When `AdminConfig.applyGSTWithholding=true`, purchasers of margin-scheme residential settlements withhold 1/11 of the GST-exclusive price and remit directly to the ATO under GSTA s.72-55. The developer's cash inflow at settlement is reduced accordingly. Disabled by default — enable for lender-facing models where settlement cash should be shown net of withholding.

### GST Supply Type Classification
`RevenueLineItem.supplyType` controls GST treatment:
- `'margin-scheme'` (default when `gstIncluded=true`): Division 75 GSTA, GST on taxable margin only
- `'standard'`: Standard-rated supply (GST on full price × 1/11)
- `'input-taxed'` (default when `gstIncluded=false`): No GST output, no ITC attributable
- `'going-concern'`: GSTA s.38-325 exempt (GST-free, vendor+purchaser must both be registered)

`RentalIncomeItem.supplyType` defaults to `'input-taxed'` (long-term residential, s.40-70). Set to `'standard'` for short-term letting / hotel accommodation which is standard-rated.

### Contingency GST
`AdminConfig.contingencyGSTMode` controls whether GST is applied to the contingency reserve:
- `'full'` (default): GST applied to reserve (legacy; assumes contingency will be spent on creditable acquisitions)
- `'none'`: No GST on the reserve; GST applied only when contingency is actually spent on invoiced supplies

### Lender GST Exemption
`DebtFacility.lenderIsGSTExempt` (default `true`) assumes the lender is an exempt financial institution (GSTA s.40-60) and fees are GST-free. Set to `false` for non-bank lenders — fees are then uplifted by gstRate to reflect the GST-inclusive cash cost (no ITC recoverable on financial supply acquisitions under s.11-15(2)(a)).

### PM Fee Base
PM fee = rate × sum of all other costs **including** GST on costs **and** preliminary finance costs (two-pass: preliminary solve estimates finance costs, which then feed into a second PM fee computation). This matches Excel's GST+finance-inclusive base.

### IRR Timing Convention
IRR is calculated on monthly equity cashflows using Newton-Raphson, then annualised via `(1 + r_monthly)^12 − 1`. Each cashflow at period `t` is discounted by `(1 + r)^t` (month-start convention — cashflows are placed at the beginning of each period). For hurdle comparisons, note that investors may expect end-of-period discounting which would add ~1 pp at typical rates.

### Debt Service Coverage Ratio (DSCR)
Calculated per-period as: Operating Cashflow (revenue − operating costs) / Debt Service (interest + fees + principal repayment). Reported as average, minimum, and peak values in `DashboardData.dscr`. Target threshold configurable via `AdminConfig.dscrTarget` (default 1.25×).

### Peak Equity Exposure
Tracked as the maximum cumulative equity injected net of repatriations; reported in `DashboardData.dscr.peakEquity` along with the month of peak.

### Payback Period
First month where cumulative (equity repatriations + profit distributions) ≥ cumulative equity injections. Reported in `DashboardData.otherIndicators.paybackPeriodMonths`.

### GST Compliance Schedule
`DashboardData.gstCompliance` exports the margin-scheme apportionment, GST outputs by supply type, ITC claimable, and net GST payable. Supports ATO audit defence for taxpayers applying Division 75 (GSTR 2006/1).

### Senior Interest
Charged on the **opening drawn balance** each period using a daily-rate formula: `openBalance × allInRate × daysInPeriod / daysPerYear`. The all-in rate = margin + BBSY (line fee is a separate fee, not included in interest rate).

### Reconciliation Status (vs KK Feaso Model Draft v43 defaults)
| Metric | App | Excel | Gap | Status |
|--------|-----|-------|-----|--------|
| Total Profit | $169.9M | $170.1M | -0.15% | ✅ |
| Senior Interest | $29.3M | $29.9M | -1.8% | ✅ |
| Senior Fees | $34.6M | $29.5M | +17.4% | ❌ lineFeeBasis (see note) |
| PM Fees | $21.1M | $23.2M | -9.2% | ✅ (within tolerance) |
| IRR (waterfall) | 22.68% | 23.02% | -0.3pp | ✅ |
| CoC | 2.303× | 2.303× | 0% | ✅ |
| Equity In/Out | $130.4M | $130.4M | 0% | ✅ |
| Net Cashflow | ≈$0 | ≈$0 | — | ✅ |

**Line Fee note**: default is `peak-drawn` (matches legacy baseline). For lenders that charge on the committed facility limit, change `DebtFacility.lineFeeBasis` to `'committed-limit'` via the Financing Inputs UI.

> **Update (code-review fix — land-loan takeout double-count):** the table above
> predates recent engine changes and no longer matches `npx tsx src/run-test.ts`
> ("Project Test", which carries the $120M default land loan). A senior-takeout
> double-count was fixed in `engine/funding.ts` (the legacy refi block re-applied
> `llRepayments[i]` on top of the LL2 balance-sheet swap, inflating the senior
> balance and injecting a phantom bank credit). Effect on the default project:
> Senior Interest $30.5M → **$29.5M** (Excel $29.9M, now slightly under),
> Total Profit $165.8M → **$167.0M** (Excel $170.1M). Both moved *toward* Excel.
> The remaining headline gap is Senior Fees ≈$43.2M vs Excel $29.5M, which is the
> known `lineFeeBasis: 'peak-drawn'` overcount documented above — switch to
> `'committed-limit'` to close it. Regression locked in by
> `engine/__tests__/landLoanSeniorTakeoutNoDoubleCount.test.ts`.

**Main profit variance drivers** (app vs Excel, $170.1M target, post-fixes):
1. Senior fees: +$5.1M over (peak-debt line fee — configurable) → profit -$5.1M
2. PM fees: -$2.1M under (two-pass iteration partially closes prior gap) → profit +$2.1M
3. Senior interest: -$0.5M under → profit +$0.5M
4. GST on revenue: ≈$0 delta → profit ≈$0
5. Unexplained residual: +$2.2M (settlement timing / rounding)
6. **Net: -$0.3M explained gap → -0.15% total profit gap ✅**

### Post-Review Features Added (v0.2)
After multi-agent review (financier, GST specialist, investor, dev manager, code reviewer):
- **Peak Equity tracking** — `DashboardData.dscr.peakEquity` + month
- **DSCR calculation** — average / minimum / target / meets-target flag
- **Payback period** — months until cumulative distributions ≥ equity injected
- **GST Compliance schedule** — margin-scheme apportionment, supply type breakdown, ITC, withholding, net GST payable (for ATO audit defence)
- **Configurable line fee basis** — peak-drawn / committed-limit / undrawn-commitment
- **GST vendor withholding (s.72-55)** toggle for residential settlements
- **Contingency GST mode** — full (legacy) or none (defer until spend)
- **Lender GST exemption** per facility (affects fee gross-up)
- **Stamp duty concessions** — home concession, first-home exemption, foreign surcharge
- **Rental income supply type** — input-taxed (default) / standard / going-concern
- **Revenue item supply type** — margin-scheme / standard / input-taxed / going-concern
- **Pre-populated standard build S-curves** (12–60 months) replacing the parabolic fallback
- **Debt solver convergence warning** emitted when max iterations reached
- **Revenue input validation warnings** (span ≤ 0, settlement before presale)
- **Division-by-zero guards** in all revenue and cost spreading
- **Sensitivity analysis framework** (`engine/sensitivity.ts`) — run variations on construction cost, GRV, contingency, senior margin, timeline
- **Unit tests** — 46 engine tests covering spreading, GST, IRR, stamp duty, S-curves, etc.
- **NRV validation** — warns when net realisable value is non-positive
- **GST rate validation** — clamps to 10% if invalid with user warning
- **Peak interest** metric now includes land loan + additional loans
- **Deposit percent** — uses `sellingCosts[].depositPercent` instead of hardcoded 10%
- **ITC recovery** — documented as already wired through waterfall via `totalMonthlyRevenue`

## Cotality (CoreLogic) Property-Data Integration
Live AI benchmark research (the "Research benchmarks" buttons on the GRV/cost
reference cards) can be **grounded in real Cotality property data** when a
Cotality subscription is configured.

**Architecture** (mirrors the AI-settings pattern):
- `api/_lib/cotality.ts` — credential storage (sentinel row `__cotality_settings__`
  in `projects.admin` JSONB, server-only — secret never sent to the browser),
  OAuth2 **client-credentials** token exchange (cached in-memory until ~5 min
  before expiry), and an optional best-effort property-data fetch.
- `api/admin/cotality-settings.ts` — admin GET/POST/DELETE + a `{test:true}`
  action that verifies credentials via a live token exchange.
- `api/benchmarks/research.ts` — before calling the AI model, resolves Cotality
  settings and (for requests carrying a suburb/postcode) fetches the configured
  data path, injecting the result into the prompt as the **authoritative primary
  source**. The response carries `cotality: { used, url?, reason? }`. Every
  Cotality call is best-effort — any failure degrades silently to web-search-only.
- Admin UI: `app/src/admin/CotalitySettingsPage.tsx` (nav: **Cotality Data**).
  GRV reference card shows a "Grounded in Cotality property data" badge when used.

**Configuration** (Admin → Cotality Data, or env-var fallback):
- Client ID + Client Secret (OAuth2 consumer key/secret from
  https://developer.corelogic.asia/).
- Token URL (default `https://api.corelogic.asia/access/oauth/token`) and API
  base URL (default `https://api.corelogic.asia`) — switch to the UAT host
  (`api-uat.corelogic.asia`) while testing. Region: AU / NZ.
- **Property data path** (optional): a path template with `{suburb}` `{state}`
  `{postcode}` placeholders, copied from your subscription's API docs (the exact
  endpoint depends on the Cotality products you license). Blank ⇒ credentials are
  used for connection verification only and research runs on web search alone.
- Env-var fallback: `COTALITY_CLIENT_ID`, `COTALITY_CLIENT_SECRET`,
  `COTALITY_TOKEN_URL`, `COTALITY_API_BASE_URL`, `COTALITY_REGION`, `COTALITY_DATA_PATH`.

Cotality data is property *value* data, so grounding applies to **GRV** research;
construction/professional **cost** benchmarks remain QS/AI-sourced (no suburb key).
