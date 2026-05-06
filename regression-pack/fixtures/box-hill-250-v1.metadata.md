# box-hill-250-v1

**Synthetic:** yes (Project Demo scaffold + per-fixture override)
**Schema version:** 5

## Purpose

Box Hill 250 — UAT analog (Project Demo scaffold under a different name). Sensitivity: covenant solver, mezz-active path.

## Invariant sensitivities

- A1
- B1
- C1
- D1
- D2
- D3
- H1
- H2
- L1

## Expected key outputs (at last verification)

```json
{
  "senior_LTC_max": 0.8,
  "mezz_active": false,
  "R1_within": "$1k"
}
```

## Regenerating

```
node regression-pack/fixtures/_generate.mjs
```
