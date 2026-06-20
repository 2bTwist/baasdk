---
"@baas/migrate": minor
---

Add an opt-in `maxValueBytes` option and document migrate's size/scan bounds
against Convex's hard limits (16 MiB/mutation, 32k docs scanned, ~1 MiB/value).
When set, a row whose copied payload serializes to more than `maxValueBytes`
UTF-8 bytes aborts with a clear `validation` error BEFORE the insert, instead of
letting a size-capped target reject it with a provider-specific message
mid-insert; `maxValueBytes: 1_000_000` is a sensible bound for a Convex target.
Off by default, so the abstraction bakes in no backend's limit. Size is measured
portably (UTF-8 length of the JSON encoding via `TextEncoder`, so it works in the
browser too); a `bigint` (a legitimate Convex `int64`) is measured as its decimal
string rather than throwing, and a value that still cannot serialize (a circular
reference) skips the check rather than crashing the run. The README gains a
"Size and scan bounds" section noting that
reads page at ≤ 200 rows (under the 32k docs-scanned limit) and writes are one
mutation per row.
