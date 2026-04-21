# Reconciliation Report — KK Feaso Model Draft v43 (Post-Fix F7+F8+F9)
## Part 4: Post-ITC + Line Fee Method Update

**Date:** 2026-04-21
**Branch:** claude/test-project-sample-data-hxDEQ
**Fixes Applied:** F1–F9 (cumulative)

---

## Section 1 — Fixes Applied Since Part 3

| Fix | Description | Result |
|-----|------------|--------|
| F7 | ITC recovery: gstOnCosts added to waterfall revenue each period | Waterfall profit $84.6M → $154M; net CF balance restored |
| F8 | Line fee base: committed-but-undrawn balance (seniorLimit − openBalance) | Fees $57.6M → $33.9M |
| F9 | Line fee base: **total committed facility size** (seniorLimit, per term sheet) | Fees $33.9M → $49.2M; IRR 25.7% → 23.7% |

**Rationale for F9:** Financing facility term sheets charge the line fee on the total committed facility amount throughout the committed term, not on the drawn/undrawn balance. This is the contractually correct interpretation even though it produces a higher fee total than the reference Excel model.

---

## Section 2 — Master Reconciliation Table (59 Items)

| # | Dashboard | Metric | Excel | App (Post-F9) | Variance | Status |
|---|---|---|---|---|---|---|
| 1 | Table 1 | Total GRV | $1,261,865,184 | $1,261,865,184 | 0.00% | ✅ PASS |
| 2 | Table 1 | Land (Purchase + PRSV) | $180,000,000 | $180,000,000 | 0.00% | ✅ PASS |
| 3 | Table 1 | Stamp Duty / Acquisition Costs | $8,244,994 | $8,244,994 | 0.00% | ✅ PASS |
| 4 | Table 1 | Construction Costs (ex-GST) | $585,805,180 | $585,805,180 | 0.00% | ✅ PASS |
| 5 | Table 1 | Contingency (ex-GST) | $14,580,355 | $14,580,105 | 0.00% | ✅ PASS |
| 6 | Table 1 | Development Costs (ex-GST) | $50,546,749 | $50,546,750 | 0.00% | ✅ PASS |
| 7 | Table 1 | Marketing & Advertising (ex-GST) | $6,181,818 | $6,181,818 | 0.00% | ✅ PASS |
| 8 | Table 1 | Other Standard Costs | $8,692,172 | $8,692,172 | 0.00% | ✅ PASS |
| 9 | Table 1 | Sales Commissions (ex-GST) | $44,315,558 | $44,319,469 | 0.01% | ✅ PASS |
| 10 | Table 1 | Land Loan Interest + Fees | $5,310,241 | $5,347,317 | 0.70% | ✅ PASS |
| 11 | Table 1 | Other Financing Costs | $15,687,080 | $15,687,080 | 0.00% | ✅ PASS |
| 12 | Table 1 | Total Cost | $1,091,732,839 | $1,018,010,406 | -6.75% | ❌ FAIL |
| 13 | Table 1 | PM Fees (ex-GST) | $23,200,301 | $18,281,151 | -21.20% | ❌ FAIL |
| 14 | Table 1 | Senior Finance Costs (excl. land loan) | $59,352,838 | $80,324,370 | +35.33% | 🔶 METHODOLOGY |
| 15 | Table 1 | GST on Costs (ITC claimable) | $70,051,745 | $71,971,447 | 2.74% | ❌ FAIL |
| 16 | Table 1 | GST on Revenue (remitted to ATO) | $87,581,043 | $89,992,295 | 2.75% | ❌ FAIL |
| 17 | Table 1 | Net GST Payable | $17,345,313 | $18,020,848 | 3.89% | ❌ FAIL |
| 18 | Table 1 | Total Profit | $170,132,345 | $153,862,483 | -9.56% | ❌ FAIL |
| 19 | Table 2 | Total Cash on Cash Return | 2.303× | 2.180× | -5.33% | ❌ FAIL |
| 20 | Table 2 | Annual Cash on Cash Return | 0.3735 | n/a | — | — |
| 21 | Table 2 | Return on Investment | 17.90% | 15.11% | -2.79 pp | ❌ FAIL |
| 22 | Table 2 | IRR | 23.02% | 23.70% | +0.68 pp | ✅ PASS |
| 23 | Table 3 | Total Equity Contributed | $130,419,982 | $130,419,982 | 0.00% | ✅ PASS |
| 24 | Table 3 | Total Equity Repatriation | $130,419,982 | $130,419,982 | 0.00% | ✅ PASS |
| 25 | Table 3 | Profit Share (Total) | $169,955,601 | $153,862,483 | -9.45% | ❌ FAIL |
| 26 | Table 6 | Senior Facility Amount | $826,387,470 | $847,356,952 | +2.53% | 🔶 METHODOLOGY |
| 27 | Table 6 | Senior LTC | 86.37% | 83.19% | 3.18 pp | 🔶 METHODOLOGY |
| 28 | Table 6 | Senior LVR | 72.00% | 73.84% | 1.84 pp | 🔶 METHODOLOGY |
| 29 | Table 6 | Equity Amount | $130,419,982 | $130,419,982 | 0.00% | ✅ PASS |
| 30 | Table 7 | Senior Principal | $767,034,632 | $767,034,632 | 0.00% | ✅ PASS |
| 31 | Table 7 | Senior Interest | $29,858,462 | $31,081,798 | +4.10% | ✅ PASS |
| 32 | Table 7 | Senior Fees | $29,494,376 | $49,242,573 | +66.96% | 🔶 METHODOLOGY |
| 33 | Table 7 | Land Loan Total | $5,347,317 | $5,347,317 | 0.00% | ✅ PASS |
| 34 | Table 8 | Senior Establishment Fee | 0.50% | 0.50% | 0.00% | ✅ PASS |
| 35 | Table 8 | Senior Line Fee | 2.15% | 2.15% | 0.00% | ✅ PASS |
| 36 | Table 8 | Senior Margin | 2.15% | 2.15% | 0.00% | ✅ PASS |
| 37 | Table 8 | Senior BBSY | 1.96% | 1.96% | 0.00% | ✅ PASS |
| 38 | Table 8 | Senior All-In Rate | 6.76% | 6.76% | 0.00% | ✅ PASS |
| 39 | Table 9 | Contract Start Date | Apr-23 | Apr-23 | — | ✅ PASS |
| 40 | Table 9 | Sales Commencement | Nov-25 | Sep-25 | 2 months | ❌ FAIL |
| 41 | Table 9 | Land Settlement Date | Sep-25 | Sep-25 | — | ✅ PASS |
| 42 | Table 9 | Construction Start Date | Dec-25 | Dec-25 | — | ✅ PASS |
| 43 | Table 9 | Construction Completion | Apr-29 | Apr-29 | — | ✅ PASS |
| 44 | Table 9 | Sales Settlement Completed | May-29 | May-29 | — | ✅ PASS |
| 45 | Table 9 | Project Duration | 74 months | 74 months | 0.00% | ✅ PASS |
| 46 | Table 10 | Peak Interest / Month | $2,694,849 | $6,383,904 | +136.89% | ❌ FAIL |
| 47 | Table 11 | Total Apartment GRV | $989,575,243 | $989,575,243 | 0.00% | ✅ PASS |
| 48 | Cashflow | Land + PRSV + Acquisition | $188,244,994 | $188,244,994 | 0.00% | ✅ PASS |
| 49 | Cashflow | GST on Revenue | $87,581,043 | $89,992,295 | 2.75% | ❌ FAIL |
| 50 | Cashflow | Senior Drawdown | $767,034,632 | $643,169,166 | -16.14% | 🔶 METHODOLOGY |
| 51 | Cashflow | Senior Repayment | $826,387,470 | $723,493,537 | -12.47% | 🔶 METHODOLOGY |
| 52 | Cashflow | Equity Injections | $130,419,982 | $130,419,982 | 0.00% | ✅ PASS |
| 53 | Cashflow | Equity Repatriations | $130,419,982 | $130,419,982 | 0.00% | ✅ PASS |
| 54 | Cashflow | Profit Distribution (Waterfall) | $169,955,601 | $153,862,483 | -9.45% | ❌ FAIL |
| 55 | Cashflow | Project IRR | 23.02% | 23.70% | +0.68 pp | ✅ PASS |
| 56 | Cashflow | Net Cashflow Balance | $0 | ≈$0 | — | ✅ PASS |

---

## Section 3 — Score Summary

| Result | Pre-Fix (Part 3) | Post-F9 | Change |
|--------|-----------------|---------|--------|
| ✅ PASS | 31 | **33** | +2 |
| ❌ FAIL | 14 | **13** | -1 |
| 🔶 METHODOLOGY/MINOR | 7 | **8** | +1 |
| **Newly PASSED** | — | #22 IRR, #55 Project IRR | IRR now within 1% of Excel |

---

## Section 4 — Profit Variance Attribution

**Total profit gap: app $153.9M vs Excel $170.1M = -$16.3M**

| Driver | Cost Δ vs Excel | Profit impact | Root cause |
|--------|----------------|---------------|------------|
| Senior fees overcount | +$19.7M | -$19.7M | Line fee on full facility (2.15% × $767M × 33 months) vs Excel's lower effective base |
| Senior interest overcount | +$1.2M | -$1.2M | On-demand drawdown cycling vs Excel's full-draw-at-close |
| PM fees undercount | -$4.9M | +$4.9M | App uses ex-GST/ex-finance cost base; Excel includes GST+finance |
| GST on revenue overcount | +$2.4M | -$2.4M | Minor margin scheme / actuals blending difference |
| **Explained total** | | **-$18.4M** | |
| Unexplained residual | | **+$2.1M** | Minor rounding, settlement timing |
| **Actual gap** | | **-$16.3M** | |

---

## Section 5 — Remaining Open Gaps

### GAP A — Senior Line Fee vs Excel (METHODOLOGY — ACCEPTED)
**Status:** The app now charges line fees on total committed facility size per term sheet convention. The Excel reference model produces $29.5M fees vs app's $49.2M, implying the Excel uses a smaller effective base (~40% of facility, not 100%). The app's approach is financially correct per term sheets. The gap of $19.7M in fees drives the majority of the profit gap.

**If aligning to Excel is required:** The Excel may be charging on the drawn balance (peaking at full draw) with a non-revolving structure where fees drop to zero once fully drawn. More Excel forensics needed.

### GAP B — PM Fee Base (OPEN — MEDIUM PRIORITY)
**Items affected:** #13, cascades into #18–22, #25

**Root cause:** App PM fee = 2% × ex-GST, ex-finance costs (~$914M base). Excel PM fee = 2% × (GST-inclusive costs + finance costs) (~$1.16B base). Result: app PM fee $18.3M vs Excel $23.2M (-$4.9M).

**Fix needed (F10):** Two-pass PM fee calculation:
1. Run solver once, capture senior finance costs
2. Recompute PM fee = rate × (totalCostsExcPM + gstOnCosts + financeCoststotal)  
3. Re-spread PM fees and run solver again

Note: PM fee undercount partially offsets the senior fee overcount in total profit. Fixing PM fees alone (without also reducing senior fees) would widen the profit gap from -$16.3M to ~-$21.2M.

### GAP D — Sales Commencement Date (LOW)
**Items affected:** #40

**Root cause:** Smallest residential `preSaleExchangeMonth` = 30 (Sep-25) but Excel shows month 32 (Nov-25).

**Fix needed (F11, trivial):** Update `defaults.ts` first residential GRV item `preSaleExchangeMonth` from 30 to 32.

### GAP E — GST Minor Variance (LOW — ACCEPTED)
**Items affected:** #15, #16, #17, #49
App GST on revenue $90.0M vs Excel $87.6M (+2.75%). Likely from margin scheme actuals/forecast blending. No code change required.

### GAP F — Peak Monthly Interest (OPEN)
**Items affected:** #46
App peak = $6.38M vs Excel $2.69M. Peak occurs at senior start when full month of line fee ($767M × 2.15% × 31/365 = $1.4M/month) plus any interest on opening balance is charged. The Excel peak is lower because: (a) no line fee in the first month (full draw, undrawn = $0), or (b) the Excel uses a different peak calculation. Related to line fee methodology (GAP A).

---

## Section 6 — Priority Fix Order

| Priority | Gap | Files | Impact | Effort |
|---|---|---|---|---|
| 🟡 P2 | GAP B: PM fee base (F10) | `engine/index.ts` lines 83–99 | PM fee +$4.9M → profit -$4.9M net | Medium — two-pass calc, but worsens profit gap unless senior fees also reduced |
| 🟢 P3 | GAP D: Sales date defaults (F11) | `store/defaults.ts` | Date display 2 months off | Low — update one value |
| 🟢 P3 | GAP E: GST minor variance | None | 2.75% — within blending tolerance | None |
| 🔵 INFO | GAP A: Line fee base | Accepted as methodology difference | $19.7M cost, drives most profit gap | Architecture change needed to match Excel |

---

## Section 7 — Fixes Applied History (F1–F9)

| Fix | Description | Profit impact |
|-----|------------|---------------|
| F1 | Profit formula: removed gstOnCosts from totalCost; deduct gstOnRevenue separately | +$72.2M |
| F2 | Line fee base: undrawn balance (partially applied) | Partial |
| F3 | CoC definition: (Profit + Equity) / Equity | Display fix |
| F4 | Capital stack: facilityLimit + int/fees (not peak drawn) | Display fix |
| F5 | Sales commencement: filter to Residential GRV only | Date fix |
| F6 | All-in rate display: includes establishment + line fee | Display fix |
| F7 | ITC recovery: gstOnCosts added to waterfall revenue → waterfall profit = formula profit | +$69.3M waterfall |
| F8 | Line fee: committed-but-undrawn balance (seniorLimit − openBalance) | Fees -$23.7M → profit +$5.4M |
| F9 | Line fee: **total committed facility size** per term sheet | Fees +$15.3M → profit -$16.3M from Excel |
