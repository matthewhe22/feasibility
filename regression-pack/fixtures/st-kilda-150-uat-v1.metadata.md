# st-kilda-150-uat-v1

**Synthetic:** yes (Project Demo scaffold + per-fixture override)
**Schema version:** 5

## Purpose

St Kilda 150 — 70% LTC test fixture (PR #29). Sensitivity: F1 cash vs cap, F2 senior takeout, F3 closed-form land-loan interest. M1/M2 manual-trust deposit (PR #31).

## Invariant sensitivities

- F1
- F2
- F3
- A2
- B2
- L1

## Expected key outputs (at last verification)

```json
{
  "senior_LTC_max": 0.7,
  "land_loan_zero_at_construction_start": true
}
```

## Regenerating

```
node regression-pack/fixtures/_generate.mjs
```
