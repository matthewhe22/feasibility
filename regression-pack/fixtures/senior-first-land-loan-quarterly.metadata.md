# senior-first-land-loan-quarterly

Synthetic fixture cloned from `sydney-cbd-senior-first` to exercise the
**Land Loan interest payment frequency** feature (Kew UAT v3 K) under
`equityDrawdownMode = 'senior-first'`.

## What this fixture proves

- `landLoan.interestPaymentFrequency = 3` (Quarterly) under cash-pay mode
  (`isCapitalised: false`).
- Cashflow `landLoanInterest` row is zero in accrual-window periods and
  carries the cumulative cash charge at the end of each quarter
  (periods 30+3, 30+6, ... relative to land-loan start month 30).
- K01 R2 reconciliation invariant — `feasibilityProfit ≈ Σ
  profitDistributions − unrepatEq − unpaidDebt` to within $1k tolerance
  even with a non-trivial debt stack and freq=3 schedule.

## Run

```
cd app && npm run regression
```

Looking for: `[runner] senior-first-land-loan-quarterly ... pass=N fail=0`.
