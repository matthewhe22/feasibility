# melbourne-mixeduse-v1

**Synthetic:** yes (Project Demo scaffold + per-fixture override)
**Schema version:** 5

## Purpose

Melbourne mixed-use UAT analog. Sensitivity: GST classifier; G4 false-positive suppression.

## Invariant sensitivities

- G1
- G2
- G4
- A1

## Expected key outputs (at last verification)

```json
{
  "gst_input_taxed_warning": false,
  "BAS_GST_correct": true
}
```

## Regenerating

```
node regression-pack/fixtures/_generate.mjs
```
