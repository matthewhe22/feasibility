# Reconciliation Report — KK Feaso Model Draft v43 (Post-Fix)
## Part 1: Tables 1–3 (Feasibility Summary, KPIs, JV Equity)

**Date:** 2026-04-21
**Branch:** claude/test-project-sample-data-hxDEQ
**Fixes Applied:** F1 (profit GST), F2 (line fee base), F3 (CoC definition), F4 (capital stack), F5 (sales date), F6 (all-in rate)
**Tolerance:** 1% — ✅ PASS | ❌ FAIL | 🔶 METHODOLOGY/DISPLAY

---

## Section 1 — Table 1: Feasibility Summary

| Metric | Excel Model | App Output | Variance $ | Variance % | Status |
|---|---|---|---|---|---|
| Total GRV | $1,261,865,184 | $1,261,865,184 | $0 | 0.00% | ✅ |
| Land (Purchase + PRSV) | $180,000,000 | $180,000,000 | $0 | 0.00% | ✅ |
| Stamp Duty / Acq Costs | $8,244,994 | $8,244,994 | $0 | 0.00% | ✅ |
| Construction Costs (ex-GST) | $585,805,180 | $585,805,180 | $0 | 0.00% | ✅ |
| Contingency (ex-GST) | $14,580,355 | $14,580,105 | $250 | 0.00% | ✅ |
| Development Costs (ex-GST) | $50,546,749 | $50,546,750 | -$1 | 0.00% | ✅ |
| Marketing & Advertising (ex-GST) | $6,181,818 | $6,181,818 | $0 | 0.00% | ✅ |
| Other Standard Costs | $8,692,172 | $8,692,172 | $0 | 0.00% | ✅ |
| PM Fees (ex-GST) | $23,200,301 | $18,281,151 | $4,919,150 | 21.20% | ❌ |
| Sales Commissions Total (ex-GST) | $44,315,558 | $44,319,469 | -$3,911 | 0.01% | ✅ |
| Senior Finance Costs (excl. land loan) | $59,352,838 | $91,482,428 | -$32,129,590 | 54.13% | ❌ |
| Land Loan Interest + Fees | $5,310,241 | $5,347,317 | -$37,076 | 0.70% | ✅ |
| Other Financing Costs (Extension Fee) | $15,687,080 | $15,687,080 | $0 | 0.00% | ✅ |
| Total Financing Costs | $80,350,159 | $112,516,825 | -$32,166,666 | 40.03% | ❌ |
| GST on Costs (ITC claimable) | $70,051,745 | $71,971,447 | -$1,919,702 | 2.74% | ❌ |
| GST on Revenue (remitted to ATO) | $87,581,043 | $89,992,295 | -$2,411,252 | 2.75% | ❌ |
| Net GST Payable (Dashboard line) | $17,345,313 | $18,020,848 | -$675,535 | 3.89% | ❌ |
| Total Cost | $1,091,732,839 | $1,029,168,464 | $62,564,375 | 5.73% | ❌ |
| Total Profit | $170,132,345 | $142,704,425 | $27,427,920 | 16.12% | ❌ |

**Notes:**

- ✅ All base cost inputs (construction, development, land, marketing, commissions) match exactly.
- ❌ **PM Fees ($4.9M gap, 21.2%):** App uses ex-GST cost base (~$914M). Excel uses GST-inclusive costs + finance costs (~$1.16B). Fix deferred (F7) — requires two-pass calculation before the funding waterfall.
- ❌ **Senior Finance Costs ($32.1M gap, 54.1%):** Line fee (F2) partially fixed — now charges on undrawn balance instead of full limit. However a timing mismatch persists: the app opens balance is used (0 at facility start), so fee is charged on full limit in month 1, and the repay/redraw cycle causes high average undrawn base. Excel draws full facility at closing (no cycling). This is a structural architectural difference.
- ❌ **Total Cost:** App $1,029M vs Excel $1,092M — app is $63M lower. Explanation: app excludes GST on costs from totalCost ($72M removed, offset by +$32M senior overcount and -$5M PM undercount → net -$63M vs Excel). Excel embeds GST within incl-GST cost line items. Structurally different presentation; profit formula is now correct.
- ❌ **Total Profit ($27.4M gap, 16.1%):** After F1 fix, profit improved from $70.5M to $142.7M (a $72.2M improvement). Remaining gap = senior finance overcount $32.1M − PM fee undercount $4.9M ≈ $27.2M. Once senior line fee and PM fee are fully fixed, profit should match Excel.

**Improvement vs Pre-Fix:**
- Profit: $70.5M → $142.7M (gap reduced from 58.6% to 16.1%) ✅

---

## Section 2 — Table 2: Key Performance Indicators

| KPI | Excel Model | App Output | Variance | Status |
|---|---|---|---|---|
| Total Cash on Cash Return | 2.303× | 2.094× | 0.209× | ❌ |
| Annual Cash on Cash Return | 0.3735 | 0.1273 | 0.246 | ❌ |
| Return on Investment (ROI) | 17.90% | 13.87% | 4.03 pp | ❌ |
| IRR (monthly equity cashflow) | 23.02% | 14.38% | 8.64 pp | ❌ |

**Notes:**

- **F3 (CoC definition) fixed:** CoC now uses `(Profit + Equity) / Equity = (142.7M + 130.4M) / 130.4M = 2.094×`. Direction matches Excel (2.303×). Remaining gap driven by profit understatement.
- **Annual CoC:** App uses compound annual formula `(1 + totalReturn)^(1/years) − 1`. Excel may use a simpler linear formula. Both produce different results regardless of profit accuracy.
- **ROI:** App 13.87% = $142.7M / $1,029.2M. Excel 17.90% = $170.1M / $1,091.7M. Both numerator (profit) and denominator (TDC) differ.
- **IRR 14.38% vs 23.02%:** IRR is computed from the funding waterfall equity cashflows. The waterfall distributes only $84.6M as profit (vs formula's $142.7M) because it deducts GST on costs ($72M) as a real cash cost without ITC recovery. Once the waterfall models ITC recovery correctly, IRR will improve significantly.

**Improvement vs Pre-Fix:**
- CoC: 0.540× → 2.094× (F3 fixed definition + F1 improved profit)
- ROI: 6.40% → 13.87%
- IRR: 12.22% → 14.38% (modest, limited by waterfall ITC issue)

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
| IRR — Total / Developer | 23.02% | 14.38% | 8.64 pp | ❌ |
| Total Equity Repatriation | $130,419,982 | $130,419,982 | $0 | ✅ |
| Profit Share Balance — Total | $169,955,601 | $142,704,425 | $27,251,176 | ❌ |
| Profit Share Balance — Developer | $169,955,601 | $142,704,425 | $27,251,176 | ❌ |

**Notes:**
- All equity amounts and repatriation match exactly ✅
- Profit share gap = $27.3M, matching the Table 1 profit gap — same root cause (senior finance + PM fees).
- IRR remains the waterfall-based value; driven by waterfall distribution ($84.6M) not formula profit ($142.7M).
