# project-test

**Synthetic:** yes (Project Demo scaffold + per-fixture override)
**Schema version:** 5

## Purpose

Mirror of Project Demo. Sensitivity: project-name-dependent code paths (warning-key dedupe is keyed by category, not project name).

## Invariant sensitivities

- H1
- H4

## Expected key outputs (at last verification)

```json
"matches project-demo numerically"
```

## Regenerating

```
node regression-pack/fixtures/_generate.mjs
```
