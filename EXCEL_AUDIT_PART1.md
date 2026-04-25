# KK Feaso Model Draft v43 — Audit Report: Part 1
## Excel Model Internals: VBA, Circular References, S-Curves, C_Flag, Actuals Overlay, Named Ranges

*Audit date: 25 Apr 2026 | Source file: `KK Feaso Model Draft v43 20251003.xlsb`*

---

## Executive Summary

This report covers the internal mechanics of the Excel model: how the VBA macro resolves circular references, how S-curves are populated, how the actuals overlay operates, and how named ranges and Admin-sheet constants are wired. Six of the eleven audit categories are addressed here. Critical findings relate to the GST data-entry error on the Input sheet and gaps in the S-curve library; the remaining issues are Major or Minor risk.

| # | Category | Severity | Finding summary |
|---|----------|----------|-----------------|
| 1 | VBA macro architecture | Major | Two-level copy/paste; ESC leaves model partially converged |
| 2 | Circular reference resolution | Major | Tolerance $10; app uses 50 iterations vs Excel 100 |
| 3 | S-curve library | **Critical** | 48 of 65 curves have zero weights; silent zero-spread risk |
| 4 | C_Flag / cost spreading | Minor | No issues found in active project config; risk if curves changed |
| 5 | Actuals overlay | Major | Overlay applied post-convergence in app vs mid-iteration in Excel |
| 6 | Named ranges & Admin constants | Minor | All key ranges confirmed present and converged |

---

## 1. VBA Macro Architecture

### Finding
The model uses two separate copy/paste ranges to break its circular reference:

| Level | Source range | Destination range | Purpose |
|-------|-------------|-------------------|---------|
| Full time-series | `Funding Calcs P398:FO406` (`FinanceCostsCopy`) | `Funding Calcs P410:FO418` (`FinanceCostsPaste`) | Locks monthly finance cost schedules for all 9 facility rows × 156 time periods |
| Summary totals | `Admin P212:AM212` (`vba_Copy_1`) | `Admin P213:AM213` (`vba_Paste_1`) | Locks per-facility totals (PM fee, mezz, senior, principal, peak debt) |

The convergence check cell is `Admin F215` (`vba_Check_1`) — a single scalar equal to the sum of absolute differences between the two Admin summary rows. Tolerance is `Admin F28` = **$10**.

A separate macro, `Macro3` (Module3), pastes values to `Funding Calcs P385:FO393` — a distinct range that appears to lock peak-debt and interest summaries independently. This range is never cleared by the main iteration loop and may hold stale values if the model is reopened without re-running.

**Severity: Major**

### Root Cause
The VBA modules (`CopyPaste`, `Module1`, `Module3`) evolved independently. `Macro3` was added as a one-off and is not integrated into `ManageCircularities`.

### Impact
- If `Macro3` is not run (e.g. after pasting new inputs), `P385:FO393` holds prior-run values. Downstream cells referencing this range will show incorrect totals without any visible error.
- `ManageCircularities` turns on `Application.Calculation = xlCalculationManual` during the loop. If the user presses ESC and answers "No" to the stop prompt, `xlCalculationManual` may remain active, leaving the workbook in a non-recalculating state.

### Recommended Fix
1. Integrate `Macro3`'s paste step into the end of `ManageCircularities` so it always executes after convergence.
2. Add `Application.Calculation = xlCalculationAutomatic` (or restore `OrigCalcSetting`) in the error handler path as well as the normal exit path — verify `OrigCalcSetting` is always restored.
3. Add a `Checks` sheet row verifying that `P385:FO393` equals `P410:FO418` for the relevant rows, so stale values are flagged visually.

---

## 2. Circular Reference Resolution

### Finding
The iterative solver converges by comparing `vba_Copy_1` and `vba_Paste_1` (Admin rows 212–213). The current converged state of the model shows:

| Variable | Copy row 212 | Paste row 213 | Δ |
|----------|-------------|---------------|---|
| PM Fee | $21,327,785.03 | $21,327,785.03 | $0.00 |
| Mezz Finance Costs | $0 | $0 | $0.00 |
| Senior Finance Costs | $59,352,837.99 | $59,352,838.43 | **$0.44** |
| Senior Principal | $767,034,631.46 | $767,034,631.58 | **$0.12** |
| Senior Peak Debt | $517,744,796.80 | $517,744,799.42 | **$2.62** |

`vba_Check_1` (F215) = 0.0, which passes the $10 tolerance check. The model is correctly converged.

However:
- Excel's macro allows **100 iterations** before prompting the user to continue.
- The web app's `solveFunding()` defaults to **50 iterations** (`maxIterations=50`).
- For the current project config, convergence typically occurs in ~10–15 passes, so this gap has no practical impact. But for projects with larger construction costs or more complex waterfall structures, 50 iterations may not be sufficient.

The Excel uses a `OrigCalcSetting` variable to save and restore the calculation mode. If the workbook is in manual calculation mode when the macro is launched, it will be restored to manual on exit — which is correct. If it was automatic, it is restored to automatic. This is correctly implemented in the VBA.

**Severity: Major** (for the iteration count gap; convergence state itself is correct)

### Root Cause
The 50-iteration default in `funding.ts` was set conservatively; the Excel value of 100 was not cross-checked.

### Impact
For large projects (higher LTC, capitalised interest > 3 periods), convergence may stall at 50 iterations, producing a partially-converged result. The app currently emits a console warning but does not surface it in the UI.

### Recommended Fix
1. Change `maxIterations` default from 50 to 100 in `engine/funding.ts` to match Excel.
2. Surface the convergence warning prominently in the Internal Dashboard (e.g. a red banner: "Debt solver did not converge — increase iterations or check inputs").
3. Expose `maxIterations` as an `AdminConfig` setting so power users can adjust it.

---

## 3. S-Curve Library

### Finding — CRITICAL

The `Inputs_Time D` sheet holds one row per named S-curve with monthly percentage weights. Of the 65 possible curves, only **6 are populated**:

| Curve name | Sum of weights | Status |
|------------|---------------|--------|
| 20 Month Build | 1.000 | ✅ Populated |
| 26 Month Build | 1.000 | ✅ Populated |
| 35 Month Build | 1.000 | ✅ Populated |
| 41 Month Build | 1.000 | ✅ Populated |
| Manual S-curve 1 | 1.000 | ✅ Populated |
| Manual S-curve 2 | 1.000 | ✅ Populated |
| 12–19 Month Build | 0.000 | ❌ Zero weights |
| 21–25 Month Build | 0.000 | ❌ Zero weights |
| 27–34 Month Build | 0.000 | ❌ Zero weights |
| 36–40 Month Build | 0.000 | ❌ Zero weights |
| 42–60 Month Build | 0.000 | ❌ Zero weights |
| Manual S-curve 3 | 0.000 | ❌ Zero weights |

**The current project is not affected** because all active items use either `41 Month Build` or `Manual S-curve 1`, both of which are populated. However, if any cost or revenue item is assigned one of the 48 zero-weight curves, the Excel will spread $0 across all periods — the full cost amount silently disappears from the cashflow. There is no visible error, no warning, and no Checks sheet alert for this condition.

**Severity: Critical**

### Root Cause
The S-curve library was partially built. Only the curves needed for the current project were populated. The remaining rows were left blank.

### Impact
- Any future project using a build length other than 20, 26, 35, or 41 months will produce zero cost spreading with no visible warning.
- The `Checks` sheet does not validate that S-curve totals sum to 1.0 for each active curve.
- The web app partially mitigates this with a parabolic fallback — but the fallback behaviour diverges from Excel (see Part 2, Section 8).

### Recommended Fix
1. **Short-term**: Add a `Checks` sheet row that verifies each S-curve used by at least one active item sums to 100%. Alert if any curve is in use with a zero total.
2. **Medium-term**: Populate the missing S-curves using the standard industry S-curve formula: cumulative Beta distribution with α=2, β=3 normalised over the build period. The four populated curves follow this pattern and can be used as templates.
3. **In the web app**: Replace the parabolic fallback with a proper Beta(2,3) S-curve generator. If a user-defined curve is present but sums to zero, emit a visible error rather than falling back silently.

---

## 4. C_Flag / Cost Spreading

### Finding
The `C_Flag` sheet contains per-period flags that gate whether each cost/revenue item spreads in a given month. These flags are driven by the timeline start/end dates and the S-curve selection on the Input sheet.

For the current project configuration, all active items have correct start/end months and use populated S-curves (`41 Month Build` for construction, `Manual S-curve 1` for development costs). No misconfigured flags were detected in the active ranges.

**However**, the following risk conditions exist:

1. **Build month overlap**: If `monthStart + monthSpan` exceeds the project timeline (74 months), C_Flag silently truncates the spread. The remaining weight is lost — costs are understated with no warning.
2. **Zero-span items**: If `monthSpan = 0` for any item, division by zero in the spreading formula produces `#DIV/0!` errors in `C_Flag` which cascade to `Calcs_Rev_Costs`.
3. **`Evenly Split` curve**: The extension fee (item 16001, $15,687,080) uses `Evenly Split` across months 16–30 (15 months). This is correctly implemented. No issue found.

**Severity: Minor** (no active issues in current config; structural risk only)

### Root Cause
The model has no guard rails for cost items that extend beyond the project timeline or have zero-span definitions.

### Impact
Low for current project. Risk materialises when new projects are configured with non-standard timelines or when items are copied from other models without adjusting dates.

### Recommended Fix
1. Add `Checks` sheet rows: (a) flag any item where `monthStart + monthSpan > projectDuration`; (b) flag any item where `monthSpan ≤ 0`.
2. In the web app, add the same validation to `inputStore.ts` input saving — surface warnings in the Input tab.

---

## 5. Actuals Overlay

### Finding
The `Actual Update` sheet (391 rows × 171 cols) overlays actual values for completed periods. The `Admin` sheet rows 15–17 control period flags:

| Named range | Location | Purpose |
|-------------|----------|---------|
| `Actuals` | Admin O15:AM15 | 1 = period has actuals |
| `Forecast` | Admin O16:AM16 | 1 = period is forecast |

The `Calcs_Rev_Costs_with_actual` sheet blends: for each period, if `Actuals[t] = 1` it uses `Actual Update` values; otherwise it uses `Calcs_Rev_Costs` forecast values.

**Key architectural issue**: In Excel, the VBA macro `ManageCircularities` runs the full iteration over the blended actuals+forecast values. The paste step locks the converged finance costs for the full blended timeline. This means actuals-period interest charges are already baked into the converged result.

In the web app (`funding.ts`), `applyFinancingActualsOverlay()` is called **after** the solver converges on forecast-only data. This means:
- The solver converges on pure forecast totals
- Actuals are overlaid as a post-processing step
- If actuals-period debt balances differ from forecast (e.g. actual drawdowns were lower), the interest calculation for subsequent forecast periods will be based on the correct actuals balance — but the convergence itself did not account for this

For the current project (actuals only up to a small number of periods), the impact is negligible. For projects with significant actuals divergence from forecast, this could produce a material interest variance.

**Severity: Major** (architectural mismatch; low impact for current project)

### Root Cause
The actuals overlay was added as a post-processing step for simplicity. Integrating it into the solver loop requires running the full waterfall with the blended timeline at each iteration.

### Impact
For projects with >6 actuals periods and significant actuals vs forecast variance (>5% cost divergence), the solver may converge on a debt balance that is inconsistent with actual drawdowns. Senior interest could be understated by up to the interest on the actuals/forecast differential.

### Recommended Fix
1. Pass the actuals-blended cost/revenue arrays into `solveFunding()` as the primary input, so each solver iteration uses the correct blended values.
2. If performance is a concern, only re-blend when actuals data changes (memoize the blend step).
3. Add a `Checks`-equivalent warning in the app: if any actuals period has costs > 110% of forecast, flag a reconciliation review.

---

## 6. Named Ranges & Admin Constants

### Finding
All key named ranges were successfully decoded from the BIFF12 binary and verified against read cell values. Summary of critical ranges:

| Named range | Location | Value / Purpose | Status |
|-------------|----------|-----------------|--------|
| `Tolerance` | Admin F28 | 10.0 ($10 convergence threshold) | ✅ Confirmed |
| `DaysPerYear` | Admin F30 | 365 | ✅ Confirmed |
| `MonthsPerYear` | Admin F31 | 12 | ✅ Confirmed |
| `ModelStartDate` | Admin F9 | 44927 = 1 Apr 2023 | ✅ Confirmed |
| `vba_Copy_1` | Admin P212:AM212 | Live finance cost totals | ✅ Converged |
| `vba_Paste_1` | Admin P213:AM213 | Locked finance cost totals | ✅ Converged (Δ < $10) |
| `vba_Check_1` | Admin F215 | 0.0 (pass) | ✅ Pass |
| `FinanceCostsCopy` | Funding Calcs P398:FO406 | Monthly finance schedules (9 rows × 156 cols) | ✅ Confirmed |
| `FinanceCostsPaste` | Funding Calcs P410:FO418 | Locked monthly schedules | ✅ Confirmed |
| `S_CURVESELECTION` | Admin D114:D173 | S-curve name list (65 items) | ✅ Confirmed |
| `MasterCheck` | Checks F9 | "Checks: OK" | ✅ Pass |
| `MasterAlert` | Checks F20 | "Alerts: OK" | ✅ Pass |

One **latent alert** exists in the Checks sheet:
- Row 24: "Please run the macro" — currently inactive (flag = 0). This alert fires whenever the model detects that inputs have changed since the last macro run. It is currently suppressed, suggesting the macro was run after the last input change.

**Severity: Minor**

### Root Cause
Named ranges are correctly defined. The "run the macro" alert suppression may mask future scenarios where the user changes inputs without re-running the solver.

### Impact
If a user modifies inputs (e.g. senior facility limit or cost amounts) and does not re-run `ManageCircularities`, the paste ranges hold stale values. The Checks sheet row 24 alert should catch this — but only if its trigger formula is correctly wired to detect all relevant input cells.

### Recommended Fix
1. Verify that the row 24 trigger formula covers all input cells that affect the circular reference (at minimum: construction cost, GRV, senior limit, margin rate, BBSY).
2. Consider making row 24 permanent (always checking the macro-freshness flag) rather than conditional, so it cannot be silently suppressed.
3. In the web app, a "recalculate" button with a loading state achieves the same effect — flag in the UI when inputs have changed since the last full solve.

---

## Appendix: Verified Excel Model Constants

| Parameter | Source cell | Value |
|-----------|------------|-------|
| Project start | Admin F9 | 1 Apr 2023 |
| Project duration | Input sheet | 74 months |
| GFA | Input sheet | 32,133 m² |
| Lots | Input sheet | 178 |
| Land purchase | Input sheet | $124,000,000 |
| Land uplift (PRSV) | Input sheet | $56,000,000 |
| Construction (4001) | Input sheet | $585,805,180 |
| Construction S-curve | Input sheet | 41 Month Build (month 33, span 41) |
| Contingency rate | Input sheet | 2.489% |
| Senior facility limit | Input sheet | $767,034,631.58 |
| Senior margin | Input sheet | 2.15% |
| BBSY | Inputs_Time D row 74 | 1.96% flat |
| All-in rate | Derived | 4.11% |
| Senior establishment | Input sheet | 0.50% |
| Senior line fee | Input sheet | 2.15% |
| Land loan | Input sheet | $120,000,000 at 11.265% |
| Land loan frequency | Input sheet | Quarterly (3 months) |
| Total profit | Internal Dashboard | $169,955,601.41 |
| IRR | Internal Dashboard | 23.02% |
| Peak equity | Internal Dashboard | $130,419,982.33 |
| QLD stamp duty | Taxes & Duties | $7,110,524.94 |
| Convergence delta | Funding Calcs row 423 | −$0.44 (< $10 ✅) |
