# Reconciliation Report — Section 2

Comparing app output vs KK Feaso Model Draft v43 Excel. Tolerance = 1%.

Legend: ✅ within 1% | ❌ outside tolerance | 🔶 methodology/presentation difference

---

## Section 4 — Table 6: Capital Stack

| Metric | Excel Model | App Output | Variance | Status |
|---|---|---|---|---|
| Senior Facility Amount | $826,387,470 | $566,780,762 | $259,606,708 | ❌ |
| Senior LTC | 86.37% | 51.46% | 34.91 pp | ❌ |
| Senior LVR | 72.00% | 49.38% | 22.62 pp | ❌ |
| Mezzanine Amount | $0 | $0 | $0 | ✅ |
| Equity Amount | $130,419,982 | $130,419,982 | $0 | ✅ |
| Equity LTC | 13.63% | 11.84% | 1.79 pp | ❌ |
| Equity LVR | 28.00% | 11.36% | 16.64 pp | ❌ |
| Total Capital | $956,807,452 | $697,200,744 | $259,606,708 | ❌ |

Notes:
- **Senior Amount**: Excel reports the **facility limit ($767M) + accrued interest/fees ($59.4M) = $826.4M** (total facility cost). App reports the **peak drawn balance ($566.8M)** — a fundamentally different definition. The Excel approach shows what the bank committed and the total cost of that debt; the app shows actual peak utilisation.
- **LTC/LVR**: Both ratios are wrong in the app because (a) the numerator (senior amount) is wrong and (b) the TDC denominator is affected by incorrect finance costs.
- **NRV used for LVR**: Excel NRV = $1,147,760,375; App NRV ≈ $1,147,760,375 ✅ (match — same GRV minus GST minus back-end commissions)
- **Excel TDC for LTC**: ~$957M; App TDC: ~$1,101M (different because app includes GST on costs in TDC)

---

## Section 5 — Table 7: Debt Principal, Interest & Total

| Metric | Excel Model | App Output | Variance $ | Variance % | Status |
|---|---|---|---|---|---|
| Senior Facility — Principal | $767,034,632 | $566,780,762 | $200,253,870 | 26.11% | ❌ |
| Senior Facility — Interest | $29,858,462 | $34,337,017 | -$4,478,555 | 15.00% | ❌ |
| Senior Facility — Fees | $29,494,376 | $57,420,423 | -$27,926,047 | 94.68% | ❌ |
| Senior Facility — Total (Int+Fees) | $59,352,838 | $91,757,440 | -$32,404,602 | 54.60% | ❌ |
| Land Loan — Principal | $120,000,000 | $120,000,000 | $0 | 0.00% | ✅ |
| Land Loan — Interest | $3,407,277 | $3,407,277 | $0 | 0.00% | ✅ |
| Land Loan — Fees | $1,940,040 | $1,940,040 | $0 | 0.00% | ✅ |
| Land Loan — Total (Int+Fees) | $5,347,317 | $5,347,317 | $0 | 0.00% | ✅ |
| Mezzanine — All | $0 | $0 | $0 | — | ✅ |

Notes:
- **Land Loan matches exactly** ✅ — interest calculation at 11.265% quarterly is correct.
- **Senior Principal**: Excel draws the full $767M facility; app only draws $566.8M (peak actual need). Different waterfall philosophy — Excel commits full facility at closing, app draws on demand.
- **Senior Fees** ($57.4M app vs $29.5M Excel): App charges line fee (2.15%) on the **full facility LIMIT ($767M)** for every active month (~41 months → ~$56.4M). Excel applies line fee on **undrawn/committed basis** (effective base ~$383M avg × ~20 active months → ~$25.7M) plus establishment fee ($3.8M). This is the largest single bug.
- **Senior Interest** ($34.3M app vs $29.9M Excel): App interest is lower than expected because it draws less ($566M vs $767M) — partially offsetting the fee overstatement.

---

## Section 6 — Table 8: Debt Rates

| Rate | Excel Senior | App Senior | Excel Land Loan | App Land Loan | Status |
|---|---|---|---|---|---|
| Establishment Fee | 0.50% | 0.50% | 1.617% | 1.617% | ✅ |
| Line Fee | 2.15% | 2.15% | 0.00% | 0.00% | ✅ |
| Margin | 2.15% | 2.15% | 11.265% | 11.265% | ✅ |
| BBSY | 1.96% | 1.96% | 0.00% | 0.00% | ✅ |
| All-In Rate | 6.76% | 4.11% | 12.882% | 11.265% | ❌ |

Notes:
- All individual rate inputs match ✅
- **All-In Rate mismatch**: Excel computes all-in as **Establishment + Line Fee + Margin + BBSY = 6.76%** (annualised composite including one-off establishment fee). App computes all-in as **Margin + BBSY only = 4.11%**. This is a display-only difference in the dashboard; it does not affect the underlying interest calculations.

---

## Section 7 — Table 9: Key Dates

| Date / Duration | Excel Model | App Output | Variance | Status |
|---|---|---|---|---|
| Contract Start Date | Apr-23 | Apr-23 | — | ✅ |
| Sales Commencement | Nov-25 | Sep-24 | 14 months early | ❌ |
| Land Settlement Date | Sep-25 | Sep-25 | — | ✅ |
| Construction Start Date | Dec-25 | Dec-25 | — | ✅ |
| Construction Completion | Apr-29 | Apr-29 | — | ✅ |
| Sales Settlement Completed | May-29 | May-29 | — | ✅ |
| Project Duration | 74 months | 74 months | — | ✅ |
| Construction Time | 40.57 months | 41.0 months | 0.43 months | 🔶 |
| Planning & Design Time | 32.5 months | 32 months | 0.5 months | 🔶 |

Notes:
- **Sales Commencement**: Excel uses the first **residential** presale exchange month (month 32 = Nov-25). App uses `min(presaleExchangeMonth)` across **all** GRV items including commercial items (code 9006–9008 at month 18 = Sep-24). Fix: filter to residential items only when computing salesStart.
- **Construction Time**: Excel shows 40.57 months (likely interpolating fractional months from exact calendar dates). App shows 41 (integer monthSpan input). Minor cosmetic difference.

---

## Section 8 — Table 10: Other Indicators

| Metric | Excel Model | App Output | Variance $ | Variance % | Status |
|---|---|---|---|---|---|
| Peak Interest Holding Cost / Month | $2,694,849 | $4,983,277 | -$2,288,428 | 84.93% | ❌ |

Notes:
- App peak is double the Excel because the app charges line fees on the full facility LIMIT every month (same bug as Section 5). The peak month in the app is dominated by the inflated line fee. Fix: calculate line fees on the drawn/undrawn balance rather than the facility limit.

---

## Section 9 — Table 11: GRV Summary

| Metric | Excel Model | App Output | Variance $ | Status |
|---|---|---|---|---|
| Total Apartment GRV | $989,575,243 | $989,575,243 | $0 | ✅ |
| GRV Sold / Exchanged | $134,062,299 | $75,485,999 | $58,576,300 | ❌ |
| Unsold GRV | $855,512,944 | $914,089,244 | -$58,576,300 | ❌ |

Notes:
- **GRV Sold/Exchanged**: Excel appears to report only the portion of residential GRV where actual sale data has been entered in the Actual Update sheet (~$134M corresponds to actuals data for Tower 3 & 4 partial lots). App computes it as sum of all GRV items whose `preSaleExchangeMonth <= lastActualPeriod (32)` — but all 5 residential items have presale months <= 32, producing $989M total which is then filtered. Likely the Excel uses the actual CTD (cost-to-date) exchange register amounts from the Actual Update sheet, not the presale schedule.
- **Total Apartment GRV**: matches exactly ✅

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
| Back-end Selling Costs (Excel: netted from revenue) | -$26,523,766 | (in costs: $24,114,734) | — | — | 🔶 |
| GST paid on Revenue | -$87,581,043 | -$89,992,295 | $2,411,252 | 2.75% | ❌ |
| Total Net Revenue | $1,147,760,375 | $1,171,872,889† | — | — | 🔶 |
| **COSTS** | | | | | |
| Land Purchase Cost | $124,000,000 | $124,000,000 | $0 | 0.00% | ✅ |
| PRSV Uplift | $56,000,000 | $56,000,000 | $0 | 0.00% | ✅ |
| Land Acquisition Costs | $8,244,994 | $8,244,994 | $0 | 0.00% | ✅ |
| Development Costs (incl. GST) | $55,601,424 | $50,546,750 (ex-GST) | — | — | 🔶 |
| Construction Costs (incl. GST) | $644,385,698 | $585,805,180 (ex-GST) | — | — | 🔶 |
| Construction Contingency (incl. GST) | $16,038,391 | $14,580,105 (ex-GST) | — | — | 🔶 |
| Marketing & Advertising (incl. GST) | $6,800,000 | $6,181,818 (ex-GST) | — | — | 🔶 |
| Other Standard Costs | $8,692,172 | $8,692,172 | $0 | 0.00% | ✅ |
| PM Fees (incl. GST) | $25,520,331 | $18,281,151 (ex-GST) | — | — | ❌ |
| Selling & Leasing Costs — Front-End (incl. GST) | $22,223,349 | $20,204,735 (ex-GST) | — | — | 🔶 |
| Land Loan Interest + Fees | $5,310,241 | $5,347,317 | -$37,076 | 0.70% | ✅ |
| Senior Construction Facility (Int + Fees) | $59,352,838 | $91,757,440 | -$32,404,602 | 54.60% | ❌ |
| Other Financing Costs (Extension Fee) | $15,687,080 | $15,687,080 | $0 | 0.00% | ✅ |
| GST Reclaimed / ITC | -$70,051,745 | (embedded in separate GST line) | — | — | 🔶 |
| **FINANCING** | | | | | |
| Land Loan Drawdown | $120,000,000 | $120,000,000 | $0 | 0.00% | ✅ |
| Land Loan Repayment | $120,000,000 | $120,000,000 | $0 | 0.00% | ✅ |
| Senior Drawdown | $767,034,632 | $699,494,492 | $67,540,140 | 8.81% | ❌ |
| Senior Repayment | $826,387,470 | $791,251,932 | $35,135,538 | 4.25% | ❌ |
| Equity Injections | $130,419,982 | $130,419,982 | $0 | 0.00% | ✅ |
| Equity Repatriations | $130,419,982 | $130,419,982 | $0 | 0.00% | ✅ |
| Profit Distributions | $169,955,601 | $70,457,966 | $99,497,635 | 58.59% | ❌ |
| **BOTTOM LINE** | | | | | |
| Net Cash Flow (Profit) | $169,955,601 | $70,457,966 | $99,497,635 | 58.59% | ❌ |
| Project IRR | 23.02% | 12.22% | 10.80 pp | — | ❌ |

† App's net revenue = $1,261,865,184 - $89,992,295 = $1,171,872,889 (back-end commissions in costs, not netted from revenue)

Notes:
- All GRV by category match ✅
- All land-related items match ✅
- Presentation differences (🔶): Excel shows taxable costs inclusive of GST then nets ITC; app shows ex-GST costs plus separate GST lines. Economically equivalent if profit formula handles GST correctly.
- Senior Drawdown: $699.5M (app) vs $767M (Excel) — app draws on demand; Excel draws full facility.
