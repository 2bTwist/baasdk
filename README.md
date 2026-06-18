# baasdk

A thin, honest abstraction over the **genuine common subset** of backend
services (document/KV CRUD, auth, file storage), with explicit escape hatches
for everything else. The abstraction is never richer than the intersection of
what all supported backends can do; anything provider-specific is reached
through a typed `.native()` escape hatch rather than smuggled into the core.

## Quickstart

First query in under ten minutes, no server to run. The in-memory adapter
implements the same contract as the real ones, so this is also how every adapter
is wired and tested.

```bash
npm i @baas/core @baas/adapter-memory
```

> Not on npm yet (pre-1.0). Until the release pipeline ships, run this against a
> clone of the repo via the workspace. The code below is real: it executes in CI.

<!-- BEGIN:quickstart -->
```ts
import { createMemoryBackend } from "@baas/adapter-memory";
import type { DocumentId, StoreSchema } from "@baas/core";

// 1. Describe your backend surface: named reads (`queries`) and writes
//    (`mutations`), each with its arg and result types. This is the contract;
//    every adapter implements the same named operations.
interface Todo {
  _id: DocumentId;
  title: string;
}
interface TodoSchema extends StoreSchema {
  queries: {
    listTodos: { args: Record<string, never>; result: Todo[] };
  };
  mutations: {
    addTodo: { args: { title: string }; result: DocumentId };
  };
}

// 2. Wire the schema to a backend. The in-memory adapter needs no server, so it
//    runs anywhere (tests, a REPL, a demo) with the same contract as Supabase
//    or Convex. Each operation is a plain function over a tiny document context.
const backend = createMemoryBackend<TodoSchema>({
  queries: {
    listTodos: (ctx) => ctx.all<Todo>("todos"),
  },
  mutations: {
    addTodo: (ctx, { title }) => ctx.insert("todos", { title }),
  },
});

// 3. First write, then first query. Every call returns a `Result`, either
//    `{ ok: true, data }` or `{ ok: false, error }`, so errors are values
//    rather than thrown exceptions, uniformly across every backend.
async function quickstart() {
  const added = await backend.store.mutate("addTodo", { title: "Ship baasdk" });
  if (!added.ok) throw new Error(added.error.message);

  const result = await backend.store.run("listTodos", {});
  if (!result.ok) throw new Error(result.error.message);

  return result.data; // [{ _id: "todos:1", title: "Ship baasdk" }]
}
```
<!-- END:quickstart -->

This exact snippet runs in CI ([`quickstart.test.ts`][quickstart-test]) and is
checked against this README on every commit, so it can't rot. Swap
`@baas/adapter-memory` for `@baas/adapter-supabase` or `@baas/adapter-convex`
(see the [capability matrix](docs/CAPABILITIES.md) for what each supports) and
the calling code is unchanged.

[quickstart-test]: packages/adapter-memory/test/quickstart.test.ts

## Status

The contract, the in-memory reference adapter, and **two structurally-different
real adapters (Supabase and Convex)** all pass the same conformance suite. Both
real adapters run their live conformance against a real backend **in CI on every
commit**, so the portability claim is verified, not asserted. The genuinely
portable surface is direct CRUD + auth + file storage + a uniform
result/capability/subscribe shape; named-operation implementations are
per-backend by design.

| Package | Role | State |
|--------|------|-------|
| `@baas/core` | the ports (interfaces, types, capability descriptors) | ✅ |
| `@baas/adapter-memory` | in-memory reference adapter | ✅ |
| `@baas/conformance` | one suite, parameterized by a constructor | ✅ |
| `@baas/adapter-supabase` | Supabase (PostgREST / Auth / Storage) | ✅ |
| `@baas/adapter-convex` | Convex (reactive, JWT-verify auth, storage) | ✅ |

Every divergence between backends is a declared capability flag, asserted in both
directions by the suite. See the generated **[capability matrix](docs/CAPABILITIES.md)**.

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
- **`@baas/adapter-convex`**: the second real adapter, and the proof the
  contract is not Supabase-shaped: reactive `subscribe`, JWT-verify-only auth,
  and deployable server helpers for generic CRUD. See its README.

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
