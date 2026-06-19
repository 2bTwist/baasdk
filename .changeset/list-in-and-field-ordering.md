---
"@baas/core": minor
"@baas/adapter-memory": minor
"@baas/adapter-supabase": minor
"@baas/adapter-convex": minor
---

Extend `list` with the `in` operator and field ordering.

- **`in` operator**: `where: [["status", "in", ["open", "pending"]]]`. Maps to
  Supabase `.in()`, memory `Array.includes`, and an OR-of-eq expansion on Convex
  (which has no native `in`). `WhereCondition` is now a discriminated tuple union
  (`in` takes an array; the other six operators take a scalar).
- **Field ordering**: `order` accepts `{ field, direction }` in addition to the
  bare `"asc"`/`"desc"` creation-order shorthand. Supabase and memory order by any
  field directly (keyset on `(field, pk)`). On Convex, field ordering uses a
  `by_<field>` index; ordering by an unindexed field returns an
  `unsupported_capability` error rather than silently falling back to creation
  order. Page size still defaults to 50, clamped to 200.
