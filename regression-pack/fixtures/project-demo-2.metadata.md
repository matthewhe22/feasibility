# project-demo-2

**Synthetic:** yes (Project Demo scaffold + per-fixture override)
**Schema version:** 5

## Purpose

Identical to Project Demo. Used to detect non-determinism (regression: same inputs ⇒ identical outputs).

## Invariant sensitivities

- determinism

## Expected key outputs (at last verification)

```json
"identical to project-demo to the cent"
```

## Regenerating

```
node regression-pack/fixtures/_generate.mjs
```
