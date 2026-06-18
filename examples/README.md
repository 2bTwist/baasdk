# Examples

Runnable examples of using baasdk. Each one is plain TypeScript plus a colocated
`*.test.ts` that executes it with assertions, so every example runs in CI on
every commit and cannot drift from the code it documents. Cross-package imports
resolve to source via the workspace path map, so there is no build step: run a
single example with `pnpm exec vitest run examples/<name>`.

| Example | Shows |
|---|---|
| [`backend-agnostic-library`](backend-agnostic-library/) | A reusable library written against `@baas/core` only. The same `TodoService` runs against any adapter; the app supplies the per-backend query wiring (which on SQL backends also maps the primary key onto `_id`). |
| [`memory-then-supabase`](memory-then-supabase/) | Develop and test one app against the in-memory backend, then point the identical app code at Supabase by swapping only the factory. The memory path runs in CI everywhere; the Supabase path runs against a real stack in the live-conformance job and self-skips otherwise. |

More to come: a `.native()` example that models restraint.
