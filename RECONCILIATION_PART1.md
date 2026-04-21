---
# Reconciliation Report — KK Feaso Model Draft v43
## Project: "Project Test" — All inputs loaded from Excel model defaults

**Date:** 2026-04-20
**Branch:** claude/test-project-sample-data-hxDEQ
**Tolerance:** 1% (items outside tolerance are flagged ❌; within tolerance ✅; methodology difference 🔶)

---

## Section 1 — Table 1: Feasibility Summary

| Metric | Excel Model | App Output | Variance $ | Variance % | Status |
|---|---|---|---|---|---|
| Total GRV | $1,261,865,184 | $1,261,865,184 | $0 | 0.00% | ✅ |
| Land (Purchase + PRSV) | $180,000,000 | $180,000,000 | $0 | 0.00% | ✅ |
| Stamp Duty / Acq Costs | $8,244,994 | $8,244,994 | $0 | 0.00% | ✅ |
| Build Costs (Construction excl. contingency, ex-GST) | $585,805,180 | $585,805,180 | $0 | 0.00% | ✅ |
| Contingency (ex-GST) | $14,580,355 | $14,580,105 | $250 | 0.00% | ✅ |
| Build Costs — Dashboard display (incl. GST) | $644,385,698 | $600,385,285 | $44,000,413 | 6.83% | 🔶 |
| Contingency — Dashboard display (incl. GST) | $16,038,391 | $14,580,105 | $1,458,286 | 9.09% | 🔶 |
| Development Costs (ex-GST) | $50,546,749 | $50,546,750 | -$1 | 0.00% | ✅ |
| Marketing & Advertising (ex-GST) | $6,181,818 | $6,181,818 | $0 | 0.00% | ✅ |
| Other Standard Costs | $8,692,172 | $8,692,172 | $0 | 0.00% | ✅ |
| PM Fees (ex-GST) | $23,200,301 | $18,281,151 | $4,919,150 | 21.20% | ❌ |
| PM Fees — Dashboard display (incl. GST) | $25,520,331 | $18,281,151 | $7,239,180 | 28.37% | ❌ |
| Sales Commissions Total (ex-GST) | $44,315,558 | $44,319,469 | -$3,911 | 0.01% | ✅ |
| Sales Commissions — Dashboard (incl. GST) | $48,747,114 | $44,319,469 | $4,427,645 | 9.08% | 🔶 |
| Standard Costs — Dashboard (dev incl. GST + other std) | $64,293,596 | $59,238,922 | $5,054,674 | 7.86% | 🔶 |
| Senior Finance Costs (excl. land loan, excl. ext. fee) | $59,352,838 | $91,757,440 | -$32,404,602 | 54.60% | ❌ |
| Land Loan Interest + Fees | $5,310,241 | $5,347,317 | -$37,076 | 0.70% | ✅ |
| Other Financing Costs (Extension Fee) | $15,687,080 | $15,687,080 | $0 | 0.00% | ✅ |
| Total Financing Costs | $80,350,159 | $112,791,837 | -$32,441,678 | 40.37% | ❌ |
| GST on Costs (ITC claimable) | $70,051,745 | $71,971,447 | -$1,919,702 | 2.74% | ❌ |
| GST on Revenue (remitted to ATO) | $87,581,043 | $89,992,295 | -$2,411,252 | 2.75% | ❌ |
| Net GST Payable (Dashboard line) | $17,345,313 | $18,020,848 | -$675,535 | 3.89% | ❌ |
| Total Cost | $1,091,732,839 | $1,101,414,923 | -$9,682,084 | 0.89% | ✅ |
| Total Profit | $170,132,345 | $70,457,966 | $99,674,379 | 58.59% | ❌ |

**Notes:**

- 🔶 **Build Costs, Marketing, PM, Standard Costs, Sales Commissions:** The Excel Dashboard displays costs **inclusive of GST** (construction × 1.1, dev × 1.1, etc.); the app displays **ex-GST**. The underlying ex-GST values match — this is a presentation difference only.
- ❌ **PM Fees:** Excel computes PM fee (2%) on a base that includes GST-inclusive costs AND senior finance costs (~$1.16B base vs app's $914M), yielding $23.2M vs app's $18.3M ex-GST. Root cause: different PM fee base definition.
- ❌ **Senior Finance Costs:** Excel charges interest (4.11% = margin 2.15% + BBSY 1.96%) + line fees on the **drawn balance** and applies establishment fee once. App charges line fees on the **facility LIMIT** ($767M) for all active months, causing a $32.4M overstatement in fees.
- ❌ **GST on Costs / GST on Revenue:** Small variance (~2.75%) likely due to different treatment of GST on non-residential items (management rights, settlement adjustments) and actuals overlay.
- ❌ **Net GST:** 3.89% variance is within 1 delta-unit of the 1% tolerance but outside it; driven by the GST on costs/revenue differences above.
- ✅ **Total Cost:** 0.89% — within 1% tolerance despite component-level differences that partially offset.
- ❌ **Total Profit:** 58.59% variance is the most critical gap. Root cause: app deducts **both** GST on Costs ($72M) **and** GST on Revenue ($90M) from profit. GST on costs is fully recovered as ITC and should NOT reduce developer profit. The correct profit formula deducts only the **net GST** (~$18M), not both components separately.

---

## Section 2 — Table 2: Key Performance Indicators

| KPI | Excel Model | App Output | Variance | Status |
|---|---|---|---|---|
| Total Cash on Cash Return | 2.303 × | 0.540 × | 1.763 × | ❌ |
| Annual Cash on Cash Return | 0.3735 | 0.0726 | 0.301 | ❌ |
| Return on Investment (ROI) | 17.90% | 6.40% | 11.50 pp | ❌ |
| IRR (monthly equity cashflow) | 23.02% | 12.22% | 10.80 pp | ❌ |

**Notes:**

- All KPIs are wrong because they derive from **Total Profit** which is understated by ~$99.7M (same root cause as profit gap above).
- **CoC definition mismatch:** Excel uses **(Profit + Equity) / Equity** (equity multiple ≈ 2.303 × means 1.303 × profit multiple); app uses **Profit / Equity** (0.540 × profit multiple). Even if profit were correct ($170M / $130M = 1.307 ×), the formulas differ — app should add 1 to match Excel.
- **ROI:** Excel = 17.90% = $170.1M / $1,091.7M; app = 6.40% = $70.5M / $1,101.4M. Both driven by profit error.
- **IRR:** 23.02% (Excel) vs 12.22% (app). Lower app IRR follows from lower profit distributions to equity.

---

## Section 3 — Table 3: JV Equity, Returns and Profit Share

| Metric | Excel Model | App Output | Variance $ | Status |
|---|---|---|---|---|
| Funding Contribution % — Total | 100% | 100% | 0% | ✅ |
| Funding Contribution % — JV Partner | 0% | 0% | 0% | ✅ |
| Funding Contribution % — Developer | 100% | 100% | 0% | ✅ |
| Total Equity Contributed | $130,419,982 | $130,419,982 | $0 | ✅ |
| JV Partner Equity Contributed | $0 | $0 | $0 | ✅ |
| Developer Equity Contributed | $130,419,982 | $130,419,982 | $0 | ✅ |
| IRR — Total / Developer | 23.02% | 12.22% | 10.80 pp | ❌ |
| Total Equity Repatriation | $130,419,982 | $130,419,982 | $0 | ✅ |
| Profit Share Balance — Total | $169,955,601 | $70,457,966 | $99,497,635 | ❌ |
| Profit Share Balance — Developer | $169,955,601 | $70,457,966 | $99,497,635 | ❌ |

**Notes:**

- Equity amounts and repatriation match exactly ✅
- Profit share differs by the same $99.5M profit gap — same root cause.
