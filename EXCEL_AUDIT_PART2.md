# KK Feaso Model Draft v43 — Audit Report: Part 2
## Web App Replication Gaps: Missing Features, GST Bugs, Solver Differences, Data Model Issues

*Audit date: 25 Apr 2026 | Web app source: `/home/user/feasibility/app/src/`*

---

## Executive Summary

This report covers the five remaining audit categories focussed on how well the web app (`app/src/`) replicates the Excel model. The most critical finding is a GST data-entry error present in **both** the Excel source and the app's default values — seven cost items explicitly labelled "NO GST" are flagged `addGST = true`. Several Excel sheets (Scenario Manager, KK Cashflow, Funding Table) have no equivalent in the app. The debt solver has structural differences that could diverge under stress conditions.

| # | Category | Severity | Finding summary |
|---|----------|----------|-----------------|
| 7 | Missing sheets / features | Major | Scenario Manager, KK Cashflow, Funding Table not replicated |
| 8 | S-curve fallback mismatch | Major | App uses parabolic; Excel gives zero — divergent behavior |
| 9 | GST `addGST` bug | **Critical** | 7 "NO GST" items flagged `addGST=true` in both Excel and app |
| 10 | Solver architecture differences | Major | Iteration count, convergence metric, actuals timing all differ |
| 11 | Dashboard / output discrepancies | Major | Senior Finance costs gap ~$15.7M on Internal Dashboard |

---

## 7. Missing Sheets and Features

### Finding

The following Excel sheets have no equivalent in the web app:

#### 7a. Scenario Manager (Severity: **Major**)

The `Scenario Manager` sheet supports up to 8 named scenarios with overrides by cost category and GRV type. It has its own VBA copy/paste rows (rows 58–61) and a `vba_Outputs_Range` for saving scenario snapshots.

**Impact**: Users cannot compare scenarios (e.g. base case vs. construction cost increase vs. GRV reduction) side by side. The web app's `engine/sensitivity.ts` provides one-way sensitivity but not named scenario snapshots.

**Recommended fix**: Add a Scenarios tab to the app that stores named snapshots of `inputStore` state. On activate, apply overrides to the live inputs. Display side-by-side comparison of IRR, profit, peak equity, and CoC across all scenarios.

#### 7b. KK Cashflow (Severity: **Major**)

The `KK Cashflow` sheet (104 rows × 129 cols) shows the developer-specific cashflow — equity contributions, profit distributions, and net developer position over time. It differs from `!!! - Cashflow` by isolating the developer (KK) perspective from the project perspective.

**Impact**: The web app's cashflow view shows the consolidated project cashflow. Lenders and equity investors reviewing developer-specific returns cannot reconcile their position.

**Recommended fix**: Add a "Developer Cashflow" sub-tab to the Cashflow chart section. Derive it from the existing waterfall data: equity injections (negative), profit distributions (positive), net cumulative position.

#### 7c. Funding Table — GST Inc/Exc Conversion (Severity: **Minor**)

The `Funding Table - inc to ex GST` sheet (87 rows) converts the funding waterfall between GST-inclusive and GST-exclusive views. This is used for the ATO margin-scheme calculation and lender reporting (lenders typically require ex-GST figures).

**Impact**: The web app's `gstCompliance` export partially covers this but does not produce a period-by-period inc/exc conversion table matching the Excel layout.

**Recommended fix**: Add a `fundingTableGSTExc` derived array to the engine output that strips GST from each revenue/cost line for each period. Expose this in the GST Compliance export.

#### 7d. Checks Sheet (Severity: **Minor**)

The `Checks` sheet verifies model integrity: `Calcs_summary`, `Calcs_Rev_Costs`, `Calcs_Rev_Costs_with_actual`, and `Funding Calcs` all have dedicated check values. `MasterCheck = "Checks: OK"` and `MasterAlert = "Alerts: OK"` in the current model.

**Impact**: The web app has no equivalent integrity check panel. Users cannot verify that calculation sheets are internally consistent.

**Recommended fix**: Add a `ValidationPanel` component to the Internal Dashboard that replicates the Checks sheet logic: (a) cost totals match between spreading and summary sheets; (b) revenue totals match; (c) solver converged; (d) all active S-curves sum to 1.0.

---

## 8. S-Curve Fallback Mismatch

### Finding

When a cost item references an S-curve that has no data in `Inputs_Time D` (weights sum to zero), the Excel model spreads **$0 for that item across all periods** — the full cost silently disappears from the cashflow. There is no error cell, no warning, no Checks alert.

The web app (`engine/costSpreading.ts`) has a different behavior:

```typescript
// buildSCurveWeightsFallback(): parabolic bell curve
// w = 1 - dist²  where dist = (i - midpoint) / halfSpan
function buildSCurveWeightsFallback(months: number): number[] { ... }

function getSCurveWeights(curveName, buildSCurves, months) {
  const userDefined = buildSCurves[months];
  if (!userDefined || userDefined.every(w => w === 0)) {
    console.warn(`S-curve '${curveName}' missing — using parabolic fallback`);
    return buildSCurveWeightsFallback(months);
  }
  return userDefined;
}
```

**Result**: For any item using a zero-weight curve, Excel spreads $0 but the app spreads using a parabolic approximation. The outputs diverge.

For the **current project**, all active items use `41 Month Build` or `Manual S-curve 1` — both populated — so there is no current divergence. The risk is latent.

**Severity: Major** (behaviour diverges from Excel; can cause significant miscalculation if triggered)

### Root Cause
The parabolic fallback was added as a "better than nothing" safeguard. The Excel's zero-spread behaviour was not documented, and the fallback was assumed to be more correct.

### Impact
If a user selects any of the 48 zero-weight curves:
- Excel: that item's cost = $0 in all periods (funding gap)
- App: that item's cost is spread across the build period (no funding gap)
- The app will show a higher-cost, more conservative result — which is paradoxically less dangerous than Excel's silent zero — but the outputs will not reconcile.

### Recommended Fix
1. Change the fallback behaviour to match Excel: if a curve has zero total weights, spread $0 and emit a **visible error** in the UI (not just a console warning).
2. Alternatively, use a Beta(2,3) distribution to generate a mathematically correct S-curve for any build length, and apply it when the user-defined curve is missing — but clearly distinguish this from a user-defined curve in the UI.
3. Add a Checks-equivalent validation: flag any active item whose assigned S-curve has zero total weight.

---

## 9. GST `addGST` Bug — CRITICAL

### Finding

The `!!! - Input` sheet column 14 (0-based) contains an "Add GST" flag for each development cost item. The following items are labelled "NO GST" in their description but have `Add GST = 'Yes'` in the data:

| Code | Description | Excel Add GST | Correct treatment |
|------|-------------|--------------|-------------------|
| 2005 | Council Fees | ✅ Yes (BUG) | No — s.81-5 GSTA government charges exempt |
| 2029 | Open Space Levy | ✅ Yes (BUG) | No — statutory levy, not a taxable supply |
| 2053 | QLEAVE | ✅ Yes (BUG) | No — portable long service leave levy, not taxable |
| 2060 | Bank Fees | ✅ Yes (BUG) | No — financial supply (s.40-5), input-taxed |
| 2062 | Council rates | ✅ Yes (BUG) | No — government charge (s.81-5) |
| 2064 | Other Bonus | ✅ Yes (BUG) | No — employment bonus, not a taxable supply |
| 2065 | KPI | ✅ Yes (BUG) | No — employment-related payment |
| 2067 | Land Tax | ✅ Yes (BUG) | No — government charge (s.81-5) |

This is a **data entry error in the Excel itself**, faithfully replicated in `app/src/store/defaults.ts` via the `dc()` helper which defaults `addGST: true` for all development cost items without per-item overrides.

For comparison, `Other Standard Costs` items 5001–5004 correctly set `addGST: false` in both the Excel and the app.

**Severity: Critical**

### Root Cause
The `dc()` helper in `defaults.ts` applies `addGST: true` as a global default:

```typescript
// defaults.ts — dc() helper
function dc(code, description, amount, sCurve, monthStart, monthSpan, options = {}) {
  return {
    code, description, amount, sCurve, monthStart, monthSpan,
    addGST: true,  // ← applies to ALL dev costs by default
    ...options,
  };
}
```

Items 2005, 2029, 2053, 2060, 2062, 2064, 2065, 2067 are created with `dc()` without passing `addGST: false` in the `options` object. The Excel Input sheet has the same error in column 14.

### Impact
GST is incorrectly calculated on ~$X of costs (exact dollar impact depends on the amounts for these 8 items). The ITC claim is overstated by 10% of those amounts. For an ATO audit, this would be a compliance risk for both the app and the underlying Excel model.

Additionally, the PM fee base (2% of all costs including GST on costs) is overstated because these items incorrectly inflate `gstOnCosts`.

### Recommended Fix

**In `app/src/store/defaults.ts`** — add `addGST: false` to each affected item:

```typescript
dc(2005, 'Council Fees (NO GST)', amount, curve, start, span, { addGST: false }),
dc(2029, 'Open Space Levy (NO GST)', amount, curve, start, span, { addGST: false }),
dc(2053, 'QLEAVE (NO GST)', amount, curve, start, span, { addGST: false }),
dc(2060, 'Bank Fees (NO GST)', amount, curve, start, span, { addGST: false }),
dc(2062, 'Council Rates (NO GST)', amount, curve, start, span, { addGST: false }),
dc(2064, 'Other Bonus (NO GST)', amount, curve, start, span, { addGST: false }),
dc(2065, 'KPI (NO GST)', amount, curve, start, span, { addGST: false }),
dc(2067, 'Land Tax (NO GST)', amount, curve, start, span, { addGST: false }),
```

**In the Excel** — correct column 14 for rows 2005, 2029, 2053, 2060, 2062, 2064, 2065, 2067 from 'Yes' to 'No'.

**Note**: The existing unit tests should be updated to verify that these items produce zero GST. Add a test: `costItems.filter(c => c.description.includes('NO GST')).every(c => c.addGST === false)`.

---

## 10. Solver Architecture Differences

### Finding

Beyond the iteration count gap (50 vs 100, covered in Part 1 §2), the web app's solver differs from Excel in three structural ways:

#### 10a. Convergence metric

**Excel**: Convergence is assessed on the Admin row 212/213 summary totals — a single check across all facilities combined. `vba_Check_1` = sum of absolute differences in the summary row.

**App** (`funding.ts`): Convergence uses `Math.max(seniorDiff, mezzDiff, senior2Diff, senior3Diff)` — the maximum individual facility delta, not a sum.

For the current single-senior-facility project, these are equivalent. For multi-facility projects, the max metric is more conservative (requires each facility to converge individually), which is better practice but diverges from Excel.

**Severity: Minor** (app is more correct; diverges from Excel for multi-facility)

#### 10b. Senior 2/3 not in Excel

The app supports `Senior2`, `Senior3` facilities (e.g. for mezzanine-senior structures with separate facilities). The Excel has only one senior construction facility plus a land loan, a mezz facility, and three additional loans.

**Severity: Minor** (extra app features; no Excel equivalent to verify against)

#### 10c. Line fee basis differences

Excel: Line fee is charged on the peak drawn balance (resolved iteratively). This is confirmed by the `FinanceCostsCopy` range structure — the line fee cell references `Senior Peak Debt` (Admin P212 column 10 = $517,744,796.80).

App default: `lineFeeBasis = 'peak-driven'` matches Excel. Configurable to `'committed-limit'` or `'undrawn-commitment'` via `DebtFacility.lineFeeBasis`.

The reconciliation table in CLAUDE.md shows a +$5.1M over-count in senior fees. This is the line fee basis — Excel charges on peak drawn ($517.7M) while the app's `peak-drawn` mode may be referencing a slightly different peak calculation during iteration. Switching the app to `'committed-limit'` ($767M limit) would widen the gap further.

**Severity: Major** (contributes to the $5.1M senior fees reconciliation gap)

#### Recommended Fix (10a–10c)

1. Document the convergence metric difference in `funding.ts` with a comment explaining why `Math.max` is used instead of the Excel sum.
2. Audit the `peak-drawn` line fee calculation: verify that the app converges to exactly $517,744,796.80 peak debt and uses that as the line fee base. If the app is using a different period's balance as "peak", identify the exact point of divergence.
3. Add a per-facility `converged: boolean` flag to the solver output for UI display.

---

## 11. Dashboard Output Discrepancies

### Finding

The Internal Dashboard in Excel shows:

| Metric | Excel Internal Dashboard | Excel Calcs_summary | Gap | Explanation |
|--------|--------------------------|---------------------|-----|-------------|
| Senior Finance Costs | **$80,357,401.74** | $64,663,079.53 | +$15,694,322 | Other Financing Costs item 16001 ($15,687,080) |
| Total Profit | $169,955,601.41 | — | — | Confirmed |
| IRR | 23.02% | — | — | Confirmed |
| Peak Equity | $130,419,982.33 | — | — | Confirmed |

The $15.7M gap between the Dashboard's "Senior Finance Costs" and `Calcs_summary` is not a bug — it's intentional. The Internal Dashboard aggregates **all** financing costs (including the `Other Financing Costs` category, item 16001 extension fee) under a single "Senior Finance Costs" line for presentation purposes. `Calcs_summary` shows only the pure debt interest/fees.

The web app's Internal Dashboard should match this presentation convention. If it currently shows only `Calcs_summary`-equivalent figures (without the Other Financing Costs items), the displayed senior finance costs will be understated by ~$15.7M.

**Severity: Major** (dashboard display error if the aggregation convention is not matched)

### Root Cause
The Dashboard's "Senior Finance Costs" label is misleading — it includes non-senior items. This is an Excel presentation choice, not a calculation error.

### Impact
- Lenders reviewing the Internal Dashboard will see a different senior cost figure than the detailed cashflow, potentially triggering reconciliation queries.
- If the app does not replicate this aggregation, it will show $64.7M where the Excel shows $80.4M — a visible discrepancy.

### Recommended Fix
1. In the app's `InternalDashboard` component, aggregate "Total Financing Costs" as: senior interest + senior fees + land loan interest + land loan fees + additional loan costs + other financing costs (items 16001–16099).
2. Provide a tooltip or footnote explaining that "Other Financing Costs" (extension fees etc.) are included in the financing line.
3. Separately display a "Senior Facility Only" subtotal for lender reporting.

---

## Reconciliation Summary

The table below summarises the app vs Excel reconciliation status for the key output metrics, incorporating findings from both parts of this audit:

| Metric | App | Excel | Gap | Status | Root cause |
|--------|-----|-------|-----|--------|------------|
| Total Profit | $169.9M | $170.1M | −0.15% | ✅ | Rounding / timing residual |
| Senior Interest | $29.3M | $29.9M | −1.8% | ✅ | Within tolerance |
| Senior Fees | $34.6M | $29.5M | +17.4% | ❌ | Line fee peak debt calculation |
| PM Fees | $21.1M | $23.2M | −9.2% | ✅ | Within tolerance (two-pass) |
| IRR | 22.68% | 23.02% | −0.34pp | ✅ | Within tolerance |
| CoC | 2.303× | 2.303× | 0% | ✅ | Exact match |
| Equity In/Out | $130.4M | $130.4M | 0% | ✅ | Exact match |
| Net Cashflow | ≈$0 | ≈$0 | — | ✅ | Balanced |
| Dashboard Sr Finance | ~$64.7M | $80.4M | −$15.7M | ❌ | Aggregation convention (see §11) |

**Priority fixes to close remaining gaps:**
1. **Senior fees gap** (+$5.1M): Audit the `peak-drawn` convergence to verify the app reaches exactly $517.7M peak debt as the line fee base.
2. **GST addGST bug** (Critical): Fix 8 items in `defaults.ts` and in the Excel Input sheet.
3. **Dashboard aggregation** (Major): Include Other Financing Costs in the Dashboard "Senior Finance Costs" display line.
4. **S-curve library** (Critical for future projects): Populate missing curves or emit visible errors for zero-weight curves.

---

## Appendix: Files Audited

| File | Key findings |
|------|-------------|
| `KK Feaso Model Draft v43 20251003.xlsb` | BIFF12 binary; VBA extracted; named ranges decoded; cell values read via pyxlsb |
| `xl/vbaProject.bin` | CopyPaste, Module1/2/3, Navigation, ComparisonSheet, Disclaimer modules |
| `app/src/engine/funding.ts` | Solver: 50 iter, `Math.max` convergence, post-solve actuals overlay |
| `app/src/engine/costSpreading.ts` | Parabolic fallback for missing S-curves |
| `app/src/store/defaults.ts` | `dc()` helper defaults `addGST: true`; 8 items missing `addGST: false` override |
| `app/src/engine/gst.ts` | ITC, margin scheme, withholding — not audited in depth; see CLAUDE.md GST notes |
| `app/src/engine/kpi.ts` | IRR Newton-Raphson, CoC — output reconciled ✅ |
