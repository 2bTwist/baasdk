---
"@baas/migrate": minor
---

Add `dryRunMigrate(source, target, opts)`: project a cutover WITHOUT writing
anything. It reads the source and the target's resume index and returns a
`MigratePlan` — per collection, how many rows would be copied vs skipped — plus
the first `validation` issue (missing `_id`, or a payload over `maxValueBytes`)
the real run would fail-fast on, computed with the SAME per-row checks `migrate()`
uses (extracted into shared helpers so the preview can't drift from reality). It
is reads-only and honest about its limits: it does not project the relink pass
(relinking needs ids the target mints during the real copy) nor exercise the
read-after-write precondition (nothing is inserted). New exports: `dryRunMigrate`,
`MigratePlan`, `MigratePlanCollection`.
