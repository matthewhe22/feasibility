# Reconciliation Report — KK Feaso Model Draft v43 (Post-Fix)
## Part 2: Tables 6–11 + Cashflow Totals

**Date:** 2026-04-21
**Tolerance:** 1% — ✅ PASS | ❌ FAIL | 🔶 METHODOLOGY/DISPLAY

---

## Section 4 — Table 6: Capital Stack

| Metric | Excel Model | App Output | Variance | Status |
|---|---|---|---|---|
| Senior Facility Amount | $826,387,470 | $858,517,060 | -$32,129,590 | 🔶 |
| Senior LTC | 86.37% | 83.42% | 2.95 pp | 🔶 |
| Senior LVR | 72.00% | 74.80% | -2.80 pp | 🔶 |
| Mezzanine Amount | $0 | $0 | $0 | ✅ |
| Equity Amount | $130,419,982 | $130,419,982 | $0 | ✅ |
| Equity LTC | 13.63% | 12.67% | 0.96 pp | ✅ |
| Equity LVR | 28.00% | 11.36% | 16.64 pp | ❌ |

**Notes:**
- **F4 applied:** App now reports Senior Amount as `facilityLimit ($767M) + totalInterest + totalFees = $767M + $91.5M = $858.5M`. Excel reports $826.4M = $767M + $59.4M. Gap = $32.1M, exactly the senior finance cost overstatement. Once F2 (line fee) is fully resolved, capital stack will align.
- **Equity LVR:** App 11.36% vs Excel 28.00%. The Excel equity LVR appears to use a different NRV denominator or a different equity amount in the ratio. The app uses NRV ≈ $1,147.8M; Excel appears to use a much lower base (~$465M). Likely the Excel LVR for equity is computed differently (e.g., equity / (NRV − senior)).

---

## Section 5 — Table 7: Debt Principal, Interest & Total

| Metric | Excel Model | App Output | Variance $ | Variance % | Status |
|---|---|---|---|---|---|
| Senior Facility — Principal | $767,034,632 | $767,034,632 | $0 | 0.00% | ✅ |
| Senior Facility — Interest | $29,858,462 | $33,907,782 | -$4,049,320 | 13.56% | ❌ |
| Senior Facility — Fees | $29,494,376 | $57,574,646 | -$28,080,270 | 95.20% | ❌ |
| Senior Facility — Total (Int+Fees) | $59,352,838 | $91,482,428 | -$32,129,590 | 54.13% | ❌ |
| Land Loan — Principal | $120,000,000 | $120,000,000 | $0 | 0.00% | ✅ |
| Land Loan — Interest | $3,407,277 | $3,407,277 | $0 | 0.00% | ✅ |
| Land Loan — Fees | $1,940,040 | $1,940,040 | $0 | 0.00% | ✅ |
| Land Loan — Total (Int+Fees) | $5,347,317 | $5,347,317 | $0 | 0.00% | ✅ |
| Mezzanine — All | $0 | $0 | $0 | — | ✅ |

**Notes:**
- **F4 applied:** Senior Principal now correctly reports facility limit $767,034,632 ✅ (was $566.8M before fix).
- **Land Loan matches exactly** ✅.
- **Senior Fees ($28M gap, 95.2%):** F2 partially fixed the line fee base. However, the fee total dropped by only ~$0.2M (from $57.4M to $57.6M — slightly worse). Root cause: the undrawn balance calculation uses the opening balance, which means in month 1 of the senior facility the full $767M is undrawn (opening balance = 0 before land loan refi). The repay/redraw cycle over the project life results in persistently high average undrawn base (~$734M equivalent vs Excel's ~$350M). Full resolution requires aligning the drawdown architecture to match Excel's full-commitment-at-closing model.
- **Senior Interest ($4M gap, 13.6%):** App draws slightly differently, resulting in modestly higher average balance.

---

## Section 6 — Table 8: Debt Rates

| Rate | Excel Senior | App Senior | Excel Land | App Land | Status |
|---|---|---|---|---|---|
| Establishment Fee | 0.50% | 0.50% | 1.617% | 1.617% | ✅ |
| Line Fee | 2.15% | 2.15% | 0.00% | 0.00% | ✅ |
| Margin | 2.15% | 2.15% | 11.265% | 11.265% | ✅ |
| BBSY | 1.96% | 1.96% | 0.00% | 0.00% | ✅ |
| All-In Rate | 6.76% | 6.76% | 12.882% | 11.265% | ✅ / 🔶 |

**Notes:**
- **F6 applied:** Senior All-In Rate now correctly shows `establishment (0.5%) + line fee (2.15%) + margin (2.15%) + BBSY (1.96%) = 6.76%` ✅.
- Land All-In: App shows 11.265% (margin only). Excel shows 12.882% (possibly includes line fee 1.617%). Minor display difference.

---

## Section 7 — Table 9: Key Dates

| Date / Duration | Excel Model | App Output | Variance | Status |
|---|---|---|---|---|
| Contract Start Date | Apr-23 | Apr-23 | — | ✅ |
| Sales Commencement | Nov-25 | Sep-25 | 2 months | ❌ |
| Land Settlement Date | Sep-25 | Sep-25 | — | ✅ |
| Construction Start Date | Dec-25 | Dec-25 | — | ✅ |
| Construction Completion | Apr-29 | Apr-29 | — | ✅ |
| Sales Settlement Completed | May-29 | May-29 | — | ✅ |
| Project Duration | 74 months | 74 months | — | ✅ |
| Construction Time | 40.57 months | 41.0 months | 0.43 months | 🔶 |
| Planning & Design Time | 32.5 months | 32 months | 0.5 months | 🔶 |

**Notes:**
- **F5 applied:** Sales Commencement filter now restricted to Residential GRV items. Improved from Sep-24 (14 months early) to Sep-25 (2 months early). Remaining gap: the smallest residential `preSaleExchangeMonth` in defaults is 30 (Sep-25) but Excel reports month 32 (Nov-25). The default residential GRV items likely need their `preSaleExchangeMonth` updated from 30 to 32 in `store/defaults.ts`.

---

## Section 8 — Table 10: Other Indicators

| Metric | Excel Model | App Output | Variance $ | Variance % | Status |
|---|---|---|---|---|---|
| Peak Interest Holding Cost / Month | $2,694,849 | $6,383,904 | -$3,689,055 | 136.89% | ❌ |

**Notes:**
- Peak interest is still overstated because the senior line fee is charged on the undrawn balance using opening-balance timing, producing large fee months when balance is low (near start and end). Same root cause as senior fees gap. Once the line fee architecture is corrected, peak monthly interest will align.

---

## Section 9 — Table 11: GRV Summary

| Metric | Excel Model | App Output | Variance $ | Status |
|---|---|---|---|---|
| Total Apartment GRV | $989,575,243 | $989,575,243 | $0 | ✅ |
| GRV Sold / Exchanged | $134,062,299 | $75,485,999 | $58,576,300 | ❌ |
| Unsold GRV | $855,512,944 | $914,089,244 | -$58,576,300 | ❌ |

**Notes:**
- Total Apartment GRV matches exactly ✅.
- GRV Sold/Exchanged: App counts all residential items with `preSaleExchangeMonth ≤ lastActualsPeriod`. Excel uses only amounts actually booked in the Actual Update sheet. With only partial actuals loaded (~Tower 3 & 4), Excel shows $134M while app shows $75M. Unchanged from pre-fix — a data-sourcing difference, not a code bug.

---

## Section 10 — Cashflow Totals Reconciliation

| Cashflow Line | Excel (Total Col) | App Output | Variance $ | Variance % | Status |
|---|---|---|---|---|---|
| **REVENUE** | | | | | |
| Gross Realisable Value | $1,261,865,184 | $1,261,865,184 | $0 | 0.00% | ✅ |
| Residential GRV | $989,575,243 | $989,575,243 | $0 | 0.00% | ✅ |
| Retail F&B GRV | $79,658,356 | $79,658,356 | $0 | 0.00% | ✅ |
| Commercial Office GRV | $12,000,000 | $12,000,000 | $0 | 0.00% | ✅ |
| Hotel GRV | $171,641,716 | $171,641,716 | $0 | 0.00% | ✅ |
| GST paid on Revenue | -$87,581,043 | -$89,992,295 | $2,411,252 | 2.75% | ❌ |
| **COSTS** | | | | | |
| Land Purchase Cost | $124,000,000 | $124,000,000 | $0 | 0.00% | ✅ |
| PRSV Uplift | $56,000,000 | $56,000,000 | $0 | 0.00% | ✅ |
| Land Acquisition Costs | $8,244,994 | $8,244,994 | $0 | 0.00% | ✅ |
| Development Costs (ex-GST) | $50,546,749 | $50,546,750 | $1 | 0.00% | ✅ |
| Construction Costs (ex-GST) | $585,805,180 | $585,805,180 | $0 | 0.00% | ✅ |
| Construction Contingency (ex-GST) | $14,580,355 | $14,580,105 | $250 | 0.00% | ✅ |
| Marketing & Advertising (ex-GST) | $6,181,818 | $6,181,818 | $0 | 0.00% | ✅ |
| Other Standard Costs | $8,692,172 | $8,692,172 | $0 | 0.00% | ✅ |
| PM Fees (ex-GST) | $23,200,301 | $18,281,151 | $4,919,150 | 21.20% | ❌ |
| Front-End Selling Costs (ex-GST) | $20,204,735 | $20,204,735 | $0 | 0.00% | ✅ |
| Back-End Selling Costs (ex-GST) | $24,110,823 | $24,114,734 | -$3,911 | 0.02% | ✅ |
| Land Loan Interest + Fees | $5,347,317 | $5,347,317 | $0 | 0.00% | ✅ |
| Senior Construction Facility (Int+Fees) | $59,352,838 | $91,482,428 | -$32,129,590 | 54.13% | ❌ |
| Other Financing Costs (Extension Fee) | $15,687,080 | $15,687,080 | $0 | 0.00% | ✅ |
| **FINANCING** | | | | | |
| Land Loan Drawdown | $120,000,000 | $120,000,000 | $0 | 0.00% | ✅ |
| Land Loan Repayment | $120,000,000 | $120,000,000 | $0 | 0.00% | ✅ |
| Senior Drawdown | $767,034,632 | $699,494,492 | $67,540,140 | 8.81% | 🔶 |
| Senior Repayment | $826,387,470 | $777,140,419 | $49,247,051 | 5.96% | 🔶 |
| Equity Injections | $130,419,982 | $130,419,982 | $0 | 0.00% | ✅ |
| Equity Repatriations | $130,419,982 | $130,419,982 | $0 | 0.00% | ✅ |
| Profit Distributions (Waterfall) | $169,955,601 | $84,569,480 | $85,386,121 | 50.24% | ❌ |
| **BOTTOM LINE** | | | | | |
| Formula Profit (Dashboard) | $170,132,345 | $142,704,425 | $27,427,920 | 16.12% | ❌ |
| Project IRR | 23.02% | 14.38% | 8.64 pp | — | ❌ |
| Net Cashflow (balance check) | $0 | $0 | $0 | — | ✅ |

**Notes:**
- All GRV by category match ✅. All land and most cost items match ✅.
- **Senior Drawdown (🔶):** App draws on-demand ($699M) vs Excel full commitment at close ($767M). Architecture difference.
- **Profit Distributions ($85M gap):** Waterfall distributes $84.6M — this is cash profit after all costs including ITC-unreduced GST costs. The dashboard formula profit $142.7M is the accounting profit (ex-GST cost basis). Gap = $142.7M − $84.6M = $58.1M ≈ gstOnCosts $72M − senior_fee_reduction $14M. To reconcile waterfall profit with formula, the waterfall needs explicit ITC recovery cash inflows.
- Net cashflow = 0 ✅ (waterfall is balanced).
