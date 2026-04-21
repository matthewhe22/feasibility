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
- **KK Cashflow** (104 rows x 129 cols): Kokoda-specific cashflow
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
Charged on the **total committed facility size** (facilityLimit) throughout the committed term — per financing facility term sheet convention. The line fee applies for every period that `seniorActive` is true (start month to maturity month inclusive). Formula: `facilityLimit × lineFeePercent × daysInPeriod / daysPerYear`.

This differs from the Excel reference model which appears to use a smaller effective base (~40–50% of facility), but the total-facility-size approach is the correct term sheet interpretation.

### ITC Recovery
GST paid on costs (`gstOnCosts`) is modelled as a **same-period cash recovery** from the ATO (Input Tax Credit). In the funding waterfall, `gstOnCosts` is added to revenue each period to net it against the cost outflow, so the waterfall funds costs on an effective ex-GST basis. The `MonthlyCashflow.itcRecovery` field records this recovery and is included in the net cashflow formula to keep the per-period net ≈ $0.

### PM Fee Base
PM fee = rate × sum of all other costs **excluding GST on costs and excluding finance costs** (current implementation). The Excel reference model uses a wider base (GST-inclusive costs + finance costs), which produces a higher PM fee total (~$23.2M vs app's ~$18.3M). This is a known open gap (GAP B).

### Senior Interest
Charged on the **opening drawn balance** each period using a daily-rate formula: `openBalance × allInRate × daysInPeriod / daysPerYear`. The all-in rate = margin + BBSY (line fee is a separate fee, not included in interest rate).

### Reconciliation Status (vs KK Feaso Model Draft v43 defaults)
| Metric | App | Excel | Gap | Status |
|--------|-----|-------|-----|--------|
| Total Profit | $153.9M | $170.1M | -9.6% | ❌ |
| Senior Interest | $31.1M | $29.9M | +4.1% | ✅ |
| Senior Fees | $49.2M | $29.5M | +66.9% | ❌ methodology |
| PM Fees | $18.3M | $23.2M | -21.2% | ❌ GAP B |
| IRR (waterfall) | 23.70% | 23.02% | +0.68pp | ✅ |
| CoC | 2.180× | 2.303× | -5.3% | ❌ |
| Equity In/Out | $130.4M | $130.4M | 0% | ✅ |
| Profit Waterfall | $153.9M | $170.0M | -9.4% | ❌ |
| Net Cashflow | ≈$0 | ≈$0 | — | ✅ |

**Main profit variance drivers** (app vs Excel, $170.1M target):
1. Senior fees: +$19.7M over-stated (line fee on full facility > Excel's effective base) → profit -$19.7M
2. PM fees: -$4.9M under-stated (narrow base vs Excel's GST+finance inclusive base) → profit +$4.9M
3. Senior interest: +$1.2M over (on-demand cycling vs full-draw-at-close) → profit -$1.2M
4. GST on revenue: +$2.4M over (margin scheme minor difference) → profit -$2.4M
5. Unexplained residual: +$2.2M (minor rounding / settlement timing differences)
