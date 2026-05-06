# south-yarra-120-s3-backloaded

**Synthetic:** yes (Project Demo scaffold + per-fixture override)
**Schema version:** 5

## Purpose

South Yarra 120 — Back-loaded S-curve. Sensitivity: cap-int basis varies with cost timing; M2/M3 redistribution math.

## Invariant sensitivities

- A1
- B1
- D1
- D2
- C1
- M3

## Expected key outputs (at last verification)

```json
{
  "LTC_peak_le_80pct": true,
  "LVR_le_75pct": true,
  "all_three_facilities_active": true
}
```

## Regenerating

```
node regression-pack/fixtures/_generate.mjs
```
