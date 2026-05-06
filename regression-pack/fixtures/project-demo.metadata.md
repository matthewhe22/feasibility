# project-demo

**Synthetic:** yes (Project Demo scaffold + per-fixture override)
**Schema version:** 5

## Purpose

The default Project Demo fixture from store defaults. Sensitivity: full input surface; verifies engine handles the realistic 80-line dev-cost / 100-line construction config.

## Invariant sensitivities

- A1
- A4
- B1
- C1
- D1
- D2
- L1
- L2

## Expected key outputs (at last verification)

```json
{
  "totalGRV_approx": 1261865184,
  "R1_within": "$1k",
  "R2_within": "$1k"
}
```

## Regenerating

```
node regression-pack/fixtures/_generate.mjs
```
