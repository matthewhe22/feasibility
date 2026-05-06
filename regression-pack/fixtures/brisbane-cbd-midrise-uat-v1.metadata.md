# brisbane-cbd-midrise-uat-v1

**Synthetic:** yes (Project Demo scaffold + per-fixture override)
**Schema version:** 5

## Purpose

Brisbane CBD Mid-Rise UAT — confirms B03 / settlement-window invariant.

## Invariant sensitivities

- A4
- A1
- B3-fixture

## Expected key outputs (at last verification)

```json
{
  "all_grv_in_cashflow": true
}
```

## Regenerating

```
node regression-pack/fixtures/_generate.mjs
```
