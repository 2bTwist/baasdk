# baasdk

A thin, honest abstraction over the **genuine common subset** of backend
services (document/KV CRUD, auth, file storage), with explicit escape hatches
for everything else. The abstraction is never richer than the intersection of
what all supported backends can do; anything provider-specific is reached
through a typed `.native()` escape hatch rather than smuggled into the core.

## Status

The contract and the in-memory reference adapter are in place, and the Supabase
adapter passes the conformance suite against a live local stack. The genuinely
portable surface is direct CRUD + auth + file storage + a uniform
result/capability/subscribe shape; named-operation implementations are
per-backend by design.

| Package | Role | State |
|--------|------|-------|
| `@baas/core` | the ports (interfaces, types, capability descriptors) | ✅ |
| `@baas/adapter-memory` | in-memory reference adapter | ✅ |
| `@baas/conformance` | one suite, parameterized by a constructor | ✅ |
| `@baas/adapter-supabase` | Supabase (PostgREST / Auth / Storage) | ✅ |

## Packages

- **`@baas/core`** — the port layer. Interfaces, types, capability descriptors,
  and pure guards only; imports no backend SDK.
- **`@baas/adapter-memory`** — the in-memory reference adapter, and the test
  fixture; passes the conformance suite 100% by construction. Declares a rich
  capability set (transactions, reactive queries, credential management, file
  storage) so every capability-gated branch is exercised.
- **`@baas/conformance`** — the single contract suite, parameterized by a
  `makeBackend` constructor and run unchanged against every adapter. It is
  capability-aware and asserts **both** runtime and type behavior.
- **`@baas/adapter-supabase`** — the first real adapter. See its README for
  running the suite against a local Supabase stack.

## Develop

```bash
pnpm install
pnpm test        # vitest: runtime conformance + type-level (.test-d.ts) tests
pnpm typecheck   # tsc --noEmit per package (turbo)
pnpm build       # tsup, ESM-only (.js + .d.ts) per package (turbo)
pnpm lint        # biome
```

### How the suite runs against an adapter

The suite fixes a canonical `ConformanceSchema` (a tiny "todos" surface). An
adapter author supplies a constructor that wires that schema to their backend;
the suite then runs unchanged. The in-memory wiring lives in
`packages/adapter-memory/test/conformance.test.ts` and is the template a real
adapter follows.

### Cross-package resolution

`tsconfig.json` + `vitest.config.ts` map `@baas/*` to TypeScript **source**, so
tests and the editor work with no build step. Per-package `tsc --noEmit` and the
published `exports` resolve to built `dist` instead; turbo's `^build` ordering
makes that sound. Output is **ESM-only**.
