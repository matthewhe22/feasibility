# sydney-tower-uat-brisbanemidrise

**Synthetic:** yes (Project Demo scaffold + per-fixture override)
**Schema version:** 5

## Purpose

Brisbane CBD Mid-Rise — UAT analog. Sensitivity: regression against B03 — settlements must not silently drop.

## Invariant sensitivities

- A1
- A4
- B3-fixture

## Expected key outputs (at last verification)

```json
{
  "settlement_drop": false,
  "all_grv_in_cashflow": true
}
```

## Regenerating

```
node regression-pack/fixtures/_generate.mjs
```
