# sydney-tower-v1

**Synthetic:** yes (Project Demo scaffold + per-fixture override)
**Schema version:** 5

## Purpose

Sydney Tower v1 — UAT analog. Sensitivity: cashflow-sum drift previously observed at -$123K (B01); equity check on profitable projects (B04).

## Invariant sensitivities

- A1
- B1
- B2
- C1
- I3

## Expected key outputs (at last verification)

```json
{
  "R1_within": "$1k after B01 fix",
  "equity_check_includes_profit_distribution": true
}
```

## Regenerating

```
node regression-pack/fixtures/_generate.mjs
```
