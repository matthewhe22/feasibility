# sydney-cbd-senior-first

**Synthetic:** yes (Project Demo scaffold + senior-first mode override)
**Schema version:** 6

## Purpose

Exercises the new `equityDrawdownMode = 'senior-first'` mode end-to-end. Verifies:
- engine doesn't crash under the new mode
- baseline invariants (A1, A4, B3, C1, D1, D2, E1, H1, I2, L1, L2, M3) all PASS
- new D3 invariant (senior-first equity ceiling) PASSES

## Invariant sensitivities

- D3 — senior-first equity ceiling
- A1 — cashflow R1 close
- C1 — capital stack reconciles
- D1 — senior LTC/LVR caps
- L1 — solver convergence

## Expected behaviour

Compared to the equity-first counterpart, this fixture should show:
- cumulative equity drawn closer to pre-construction cost (~$45-80M range, not $130M)
- peak senior balance higher (debt absorbs construction)

## Regenerating

```
node regression-pack/fixtures/_generate.mjs
```

(then re-apply the senior-first override; the generator currently builds `equity-first` defaults)
