# Regression Run — 2026-05-07T08-03-58-834Z

- **HEAD commit:** `3c3bda9`
- **Fixtures:** 13
- **Totals:** 158 PASS · 0 FAIL · 0 SKIP
- **Verdict:** GREEN — safe to ship

## Per-fixture matrix

| Fixture | A1 | A4 | B3-fixture | C1 | D1 | D2 | E1 | H1 | I2 | L1 | L2 | M3 | Pass/Fail/Skip |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| box-hill-250-v1 (S) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 12/0/0 |
| brisbane-cbd-midrise-uat-v1 (S) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 12/0/0 |
| melbourne-mixeduse-v1 (S) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 12/0/0 |
| project-demo-2 (S) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 12/0/0 |
| project-demo (S) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 12/0/0 |
| project-test (S) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 12/0/0 |
| south-yarra-120-s1-default (S) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 12/0/0 |
| south-yarra-120-s2-frontloaded (S) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 12/0/0 |
| south-yarra-120-s3-backloaded (S) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 12/0/0 |
| south-yarra-120-s4-milestonestepped (S) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 12/0/0 |
| st-kilda-150-uat-v1 (S) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 12/0/0 |
| sydney-tower-uat-brisbanemidrise (S) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 12/0/0 |
| sydney-tower-v1 (S) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 12/0/0 |

Legend: ✓ PASS · ✗ FAIL · − SKIP · (S) synthetic fixture

## Static checks

- **J1** — No DSCR field declarations / reads in production code: ✅ 5 matches, all in comments / migration deletes
- **K1** — persistVersion === 5: ✅ version=5
