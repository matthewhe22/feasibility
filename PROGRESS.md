# Project Progress — KK Feaso Reconciliation Task

**Last updated:** 2026-04-21
**Branch:** `claude/test-project-sample-data-hxDEQ`

---

## What Has Been Done (Completed)

1. **Read Excel model** — KK Feaso Model Draft v43 20251003.xlsb using pyxlsb (Python)
2. **Created "Project Test"** — all inputs, assumptions, and actuals loaded from Excel defaults into the app store (src/store/defaults.ts, src/utils/createTestProject.ts)
3. **Ran the calculation engine** — app/test-calc.ts executed with default inputs, all metrics captured
4. **Full reconciliation** — compared every metric on the Internal Dashboard (Tables 1–11) and Project Cashflow against Excel values with 1% tolerance
5. **Wrote three reconciliation part files** (all committed to branch):
   - `RECONCILIATION_PART1.md` — Sections 1–3 (Table 1: Feasibility Summary, Table 2: KPIs, Table 3: JV Equity)
   - `RECONCILIATION_PART2.md` — Sections 4–10 (Tables 6–11: Capital Stack, Debt, Rates, Dates, Other Indicators, GRV Summary + Cashflow Totals)
   - `RECONCILIATION_PART3.md` — Sections 11–13 (59-item master summary table, 9 gap analyses with fix code, priority table)

---

## What Is Pending

| Step | Task | Status |
|------|------|--------|
| 1 | Write `RECONCILIATION_REPORT.md` combining all three parts | ⏳ Blocked by stream timeout |
| 2 | `git add` all reconciliation files | ⏳ Pending |
| 3 | `git commit` with descriptive message | ⏳ Pending |
| 4 | `git push -u origin claude/test-project-sample-data-hxDEQ` | ⏳ Pending |

**Blocker:** Writing RECONCILIATION_REPORT.md (~300 lines) causes "Stream idle timeout" because the file content is large. Fix: write in smaller chunks or use a sub-agent with a tighter scope.

---

## Reconciliation Score (59 items checked)

| Result | Count |
|--------|-------|
| ✅ PASS (within 1%) | 28 |
| ❌ FAIL (outside 1%) | 14 |
| 🔶 METHODOLOGY / MINOR / DISPLAY | 7 |

---

## Top Bugs Found (Priority Order)

### P1 — CRITICAL: Profit understated by ~$99.7M (58.59%)
- **File:** `app/src/engine/index.ts`
- **Cause:** App deducts BOTH GST on costs ($72M) AND GST on revenue ($90M) from profit. GST on costs is recovered via ITC and should NOT reduce profit. Only net GST (~$18M) should be deducted.
- **Fix:** Replace `totalGSTOnCosts` in `totalCost` with `netGST = totalGSTOnRevenue - totalGSTOnCosts`
- **Cascades to:** IRR (12.22% vs 23.02%), ROI (6.40% vs 17.90%), CoC (0.540× vs 2.303×), all profit distributions

### P1 — HIGH: Senior line fee overcharged by ~$32M (94.68% on fees)
- **File:** `app/src/engine/funding.ts` ~line 450
- **Cause:** Line fee (2.15%) charged on full facility LIMIT ($767M) every active month → ~$56M. Excel charges on undrawn committed balance (~$383M avg) → ~$25-28M.
- **Fix:** `const undrawnBalance = Math.max(0, seniorLimit - snrOpenBalance); periodFees += periodInterest(undrawnBalance, ...)`

### P2 — MEDIUM: PM Fees understated by ~$4.9M (21.20%)
- **File:** `app/src/engine/index.ts`
- **Cause:** App uses ex-GST cost base (~$914M). Excel uses GST-inclusive costs + finance costs (~$1.16B base).
- **Fix:** Include finance costs and GST-inclusive values in PM fee base

### P2 — MEDIUM: Cash-on-Cash Return definition wrong
- **File:** `app/src/engine/index.ts`
- **Cause:** App = `Profit / Equity`. Excel = `(Profit + Equity) / Equity`.
- **Fix:** Add 1: `cashOnCash = (profit + equity) / equity`

### P2 — DISPLAY: Senior capital stack shows peak drawn ($566M) vs Excel facility limit + fees ($826M)
- **File:** `app/src/engine/index.ts`
- **Fix:** Report `seniorLimit` not `peakSnrBalance` for capital stack

### P3 — LOW: Sales commencement date 14 months early
- **File:** `app/src/engine/index.ts`
- **Cause:** App uses `min` across all GRV items incl. commercial (month 18). Excel uses first residential presale (month 32 = Nov-25).
- **Fix:** Filter to `revenueType === 'Residential'` when computing salesStart

### P3 — DISPLAY: All-in rate shows 4.11% vs Excel's 6.76%
- **File:** `app/src/engine/index.ts`
- **Fix:** Include establishment fee + line fee in all-in rate display

### P3 — LOW: GRV Sold/Exchanged off by $58.6M
- **Cause:** App counts all items with presaleMonth ≤ lastActualsPeriod; Excel uses only actually-booked actuals data

---

## Key File Locations

| File | Purpose |
|------|---------|
| `app/src/engine/index.ts` | Main calc orchestrator — profit formula, CoC, sales date, all-in rate |
| `app/src/engine/funding.ts` | Funding waterfall — line fee bug at ~line 450 |
| `app/src/store/defaults.ts` | All default values matching Excel v43 |
| `app/src/store/useStore.ts` | Zustand store, project dates |
| `app/src/utils/createTestProject.ts` | Creates "Project Test" in DB |
| `app/test-calc.ts` | Runs engine and prints all metrics |
| `RECONCILIATION_PART1.md` | Tables 1–3 detailed reconciliation |
| `RECONCILIATION_PART2.md` | Tables 6–11 + Cashflow reconciliation |
| `RECONCILIATION_PART3.md` | 59-item master table + gap fixes + priority order |

---

## Next Action

Resume at: **Write RECONCILIATION_REPORT.md** by writing it in two halves to avoid timeout:
- Half 1: Header + PART1 content + PART2 content
- Half 2: Append PART3 content

Then commit and push.
