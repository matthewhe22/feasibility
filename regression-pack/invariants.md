# Pencil DM Feasibility Engine — Canonical Invariants

This is the testable specification of "the engine is working." Every entry here is
either checked by the engine-level `regression-runner.ts` or, where it's a UI / static
check, listed in `live-uat-checklist.md` for human verification.

Format per invariant: **ID** — title. Code reference. Test (engine / static / UI).
Pass criterion. Fail criterion.

---

## A. Cashflow integrity

### A1 — Sum of monthly net cashflows ≈ 0
**Code:** `app/src/engine/index.ts` (waterfall + cap-int closure)
**Test:** engine. `Math.abs(Σ wf[i].netCashflow) ≤ max($1, totalCost × 1e-6)`.
**Pass:** within tolerance. **Fail:** any drift > $1k on a balanced fixture (signals R1 regression).

### A2 — Stakeholder-trust deposit posted as deposit, not equity
**Code:** `engine/index.ts` (M1 trust deposit handling, PR #31)
**Test:** engine. On a fixture with non-zero deposit-in-trust stage, `wf[0].equityInjection` does NOT include the deposit; `wf[0].depositInTrust` (or equivalent) carries it.
**Fail:** deposit double-counted as equity.

### A3 — GST Withholding row present when applyGSTWithholding=true
**Code:** `engine/index.ts` GST flows; UI Table 13.
**Test:** UI (live-uat-checklist) and engine (`gstCompliance.withholdingPosted` non-zero on a fixture with the flag).
**Fail:** flag enabled but no withholding line in cashflow.

### A4 — Cashflow horizon == projectSpanMonths
**Code:** `engine/timeline.ts`
**Test:** engine. `wf.length === inputs.preliminary.projectSpanMonths`.
**Fail:** mismatch — settlements past timeline silently dropped (B03).

### A5 — Closing balance column = running cumulative net
**Code:** UI cashflow tab.
**Test:** UI. `balance[i] === balance[i-1] + netCashflow[i]` for all i.

---

## B. Returns reconciliation

### B1 — R2: feasibility profit ≈ waterfall profit distribution + unrepatriated equity − unpaid debt
**Code:** `engine/index.ts` waterfall closure (R2 fix, PR-B / #29).
**Test:** engine. `|f.totalProfit − Σ profitDistribution − unrepatEquity + unpaidDebt| ≤ tolerance`.
**Fail:** > $1k drift on a profitable fixture.

### B2 — Capitalised-interest residual = 0 at project end (unless revenue < cost)
**Code:** `engine/index.ts` (M2 — final-period sweep of cap-int).
**Test:** engine. On a profitable fixture, `wf[last].capitalisedInterestBalance ≈ 0`.
**Fail:** residual cap-int leaks past final period on a project with sufficient revenue.

---

## C. Capital stack

### C1 — Stack sums to total cost (or labelled "Underfunded $X" / "Over-committed $X")
**Code:** `engine/index.ts` capitalStack construction; UI capital-stack widget.
**Test:** engine. `|cs.equityAmount + cs.seniorAmount + cs.senior2Amount + cs.mezzAmount + landLoanAmount − f.totalCost| ≤ tolerance` OR a corresponding labelled gap.
**Fail:** silent drift.

### C2 — LVR(NRV) for equity is em-dash, not a percentage
**Code:** UI capital-stack table.
**Test:** UI. Equity row LVR cell shows "—".
**Fail:** equity row shows a numeric LVR (meaningless).

### C3 — Committed/Peak Outstanding labels consistent
**Code:** UI capital-stack column headers.
**Test:** UI. Both labels appear; "Committed" = facility limit, "Peak Outstanding" = max balance.

---

## D. Sizing / auto-sizing

### D1 — Senior never breaches its LTC or LVR cap
**Code:** `engine/funding.ts` (covenant solver).
**Test:** engine. `cs.seniorLTC ≤ inputs.seniorFacility.limitLTC + 1e-9` and analogous for LVR.
**Fail:** breach.

### D2 — Mezz never breaches its facility cap or LTC/LVR
**Code:** `engine/funding.ts`.
**Test:** engine. `cs.mezzAmount ≤ inputs.mezzanine.facilityLimit + 1e-9`; same for LTC/LVR caps.

### D3 — Auto-size grows debt to covenant cap before flagging equity gap
**Code:** `engine/funding.ts` (M4, PR #31).
**Test:** engine. On a deliberately-underfunded fixture, the solver pushes senior to its cap (LTC OR LVR, whichever binds first) and only then surfaces "additional equity required $X".
**Fail:** equity gap reported while senior still has covenant headroom.

---

## E. Repayment sequence

### E1 — Default repayment sequence = senior → mezz → equity
**Code:** `store/useStore.ts:68` (defaultAdmin), CR1 migration `:230`.
**Test:** engine + static. `admin.repaymentSequence` defaults to `['senior','mezz','equity']` for new projects; v4→v5 migration backfills it.

### E2 — Equity always last in waterfall regardless of sequence
**Code:** `engine/index.ts` waterfall.
**Test:** engine. `equity` is always the last element in `admin.repaymentSequence` after migration.

### E3 — Configurable senior↔mezz ordering produces different waterfall outputs
**Code:** `engine/index.ts` cash sweep.
**Test:** engine. With sequence `['mezz','senior','equity']` vs default, mezz monthly repayments come earlier on the same fixture.

### E4 — Legal priority on default = senior first, regardless of cash-sweep config
**Code:** code comment in `engine/index.ts` waterfall.
**Test:** static (assertion in code; no engine-level test of "default" scenario at this time).

---

## F. Land Loan

### F1 — `isCapitalised=true` capitalises interest; `false` pays cash
**Code:** `engine/funding.ts` LL1 (PR #32).
**Test:** engine. Two runs on identical fixture differ only in `landLoan.isCapitalised`. Cash-pay shows `wf[i].landLoanInterest > 0` during land-loan period; capitalised mode shows `landLoanInterest === 0` and balance grows.
**Fail:** flag has no effect.

### F2 — Senior takeout at construction start sweeps land-loan balance to zero
**Code:** `engine/funding.ts` LL2 (PR #32).
**Test:** engine. `wf[constructionStart].landLoanBalance ≈ 0` on a fixture with a senior facility.
**Fail:** land loan persists into construction phase.

### F3 — Cash-pay total = principal × monthlyRate × months (closed-form, B14)
**Code:** `engine/funding.ts`.
**Test:** engine. On a constant-balance synthetic, total land-loan interest matches `P × r × t` to within $1.

---

## G. GST

### G1 — Margin-scheme + standard + input-taxed contradiction caught
**Code:** `engine/index.ts` GST classifier; checks tab.
**Test:** engine + UI. A fixture mixing `margin-scheme` and explicit `input-taxed` items emits a CONTRADICTION-severity check.

### G2 — TAA s.14-250 withholding posted as a CREDIT, not an addition
**Code:** `engine/index.ts` `applyGSTWithholding` flow.
**Test:** engine. With the flag enabled, settlement period net cash receipt = sale price − 1/11 × sale price, and the 1/11 is a separate credit line, not double-counted.

### G3 — Tables 1 vs 13 — distinct labels (no duplication)
**Code:** UI feasibility tab.
**Test:** UI. Table 1 shows feasibility-headline GST; Table 13 shows BAS-cycle GST; labels are clearly different.

### G4 — Residential first-sale NOT classified as input-taxed (B05)
**Code:** `engine/index.ts` GST classifier.
**Test:** engine. A 100%-residential project with `gstIncluded: true` does NOT emit "100% input-taxed" warning.

### G5 — When `gstRate=0`, no second "GST on costs $0 despite addGST" warning fires (B09)
**Code:** `engine/index.ts` warning emitter.
**Test:** engine. A fixture with `landPurchase.gstRate=0` and addGST line items emits ONE warning, not two.

---

## H. Warnings consolidation

### H1 — Per-(category, message-prefix) consolidation: 1 entry per facility per category
**Code:** `engine/funding.ts` `_summaryWarnings` accumulator (PR #33).
**Test:** engine. Across an iterative solve, a category like "covenant overshoot — Senior" appears as ONE summary line, not N per iteration.

### H2 — INFO routed by `[INFO]` prefix; WARN slots not burned (B08)
**Code:** `engine/funding.ts` IPF handler.
**Test:** engine. Land-loan IPF=3 emits a single `[INFO]` message, not a WARN.

### H3 — `getFundingWarnings()` order is stable (B17 invariant)
**Code:** `engine/funding.ts` `_summaryWarnings.values()` insertion order.
**Test:** engine snapshot.

### H4 — Project-default warning routes through Q1 consolidator (B02)
**Code:** `engine/funding.ts` `recordProjectDefault`.
**Test:** engine. A fixture forcing default emits ONE summary line, not per-iteration spam.

---

## I. KPIs

### I1 — IRR/CCR display "N/M (loss)" on loss-making projects, not negative %
**Code:** UI dashboards / KPI widget.
**Test:** UI. Loss-making fixture shows "N/M (loss)" string; engine returns negative IRR/CCR untouched (UI formats).

### I2 — Total CCR sign matches Annual CCR sign
**Code:** `engine/index.ts` KPIs.
**Test:** engine. `sign(kpi.totalCashOnCash) === sign(kpi.annualCashOnCash)`.

### I3 — Capital-stack columns reconcile to total cost (B13 invariant)
**Code:** UI + engine.
**Test:** engine. `|capitalStack.total − feasibility.totalCost| ≤ tolerance`.

---

## J. DSCR removal

### J1 — No DSCR rows / covenants anywhere
**Code:** `git grep -i dscr` should return nothing in `app/src/` (except the `// removed in v4` comment in useStore.ts line ~280).
**Test:** static. Repo grep.
**Fail:** any new DSCR symbol appears.

### J2 — `admin.dscrTarget` removed from AdminConfig schema
**Code:** `types/index.ts:231` AdminConfig — no dscrTarget field.
**Test:** static.

---

## K. Schema versioning

### K1 — `persistVersion === 5`
**Code:** `store/useStore.ts:283` `version: 5`.
**Test:** static. Read literal value.
**Fail:** version drifts without a new migration step.

### K2 — v2/v3/v4 → v5 migration is reversible-safe and idempotent
**Code:** `store/useStore.ts:197` `migratePersistedState`.
**Test:** unit. Existing test in `store/__tests__/migrationCR1.test.ts` covers this; runner reads test results, not re-runs them.
**Fail:** running the migration on an already-migrated state mutates anything.

### K3 — Legacy facility keys (seniorFacility3, additionalLoan*) cleaned in `merge`
**Code:** `store/useStore.ts:300+` merge block.
**Test:** unit (existing) + static.

---

## L. Solver

### L1 — Solver converges in < maxIterations on every known-good fixture
**Code:** `engine/funding.ts` `SolverDiagnostics.convergedIn`.
**Test:** engine. `data.solver.convergedIn < data.solver.maxIterations`.
**Fail:** non-convergence (signals oscillation / fixture pathology).

### L2 — Solver reports `convergedIn`, `tolerance`, `finalDelta` in diagnostics (CR3)
**Code:** `engine/funding.ts`.
**Test:** engine. `data.solver` has the three fields populated.

---

## M. S-curve / actuals

### M1 — Actuals overwrite forecast in `isActual` periods
**Code:** `engine/costSpreading.ts:100` `spreadCost`.
**Test:** engine. Tested via `Actuals_Forecast_Test_Report.docx` (3 cases, 66 assertions). The runner verifies the property survives at the integration level: an item with actuals produces `result[i] === actuals[i]` for `periods[i].isActual`.

### M2 — Variance redistributes by ORIGINAL S-curve weights (not evenly)
**Code:** `engine/costSpreading.ts:115-130`.
**Test:** engine. Front-loaded fixture with overrun shows non-uniform redistribution (M13 > M24 on a `[29,28,...,6]` curve).

### M3 — Total budget unchanged after actuals overlay
**Code:** `engine/costSpreading.ts`.
**Test:** engine. `Σ result === item.totalCosts` to within rounding.

---

## Test taxonomy

| Class    | Where                                                        | Run by                          |
|----------|--------------------------------------------------------------|---------------------------------|
| engine   | requires `runCalculations(admin, inputs)` to assert numerically | `regression-runner.ts`        |
| static   | repo grep / AST literal lookup                                | `regression-runner.ts` shells out |
| UI       | requires loading the app in a browser                        | `live-uat-checklist.md` (human) |
| unit     | covered by existing vitest in `app/src/.../__tests__/`       | `npm test --prefix app`         |

The runner aggregates engine + static and produces the JSON / markdown output.
UI invariants are documented but verified by human walkthrough.
