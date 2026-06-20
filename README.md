<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/baasdk-mark-dark.svg" />
    <img src="assets/baasdk-mark.svg" width="76" height="76" alt="baasdk" />
  </picture>
</p>

<h1 align="center">baasdk</h1>

<p align="center">
  <a href="https://github.com/2bTwist/baasdk/actions/workflows/ci.yml"><img src="https://github.com/2bTwist/baasdk/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI" /></a>
  <a href="https://2btwist.github.io/baasdk/"><img src="https://img.shields.io/badge/demo-live-3ecf8e" alt="Live demo" /></a>
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT" />
</p>

> One portable TypeScript contract over **Supabase**, **Convex**, and an
> in-memory backend: document CRUD, auth, and file storage, with declared
> capability flags and a typed `.native()` escape hatch. The same conformance
> suite runs against every adapter, live in CI.

> [!WARNING]
> **This is a weekend project, not a product.** I built baasdk to mess around with
> my own local apps and to learn from building it, not for production and not for
> anything you'd ship or trust with real data yet. Please don't reach for it on a
> serious project; it hasn't earned that. That said, I'm still working on it:
> issues and contributions are welcome, and I'll keep testing and hardening it over
> time. If it ever gets stable enough to actually rely on, I'll update this note.
> Until then, treat it as a sandbox.

A thin abstraction over the **genuine common subset** of backend
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

## Run the demo locally

There's an interactive demo: one todo app, the same code on two backends, with a
one-click migrate between them.

```bash
pnpm install && pnpm demo   # then open http://localhost:8788
```

It runs **entirely in-memory** by default (no database, nothing to set up, nothing
saved). To point it at your own local Supabase + Convex instead, see
[`demo/README.md`](demo/README.md). The in-memory build is also what gets published
to GitHub Pages, so a public demo can never touch a real database.

**Setting it up with a coding agent?** Paste one of these.

In-memory (no setup):

> Clone https://github.com/2bTwist/baasdk, run `pnpm install` then `pnpm demo`, and
> open http://localhost:8788. It runs in-memory, no database needed. Confirm you can
> add todos, check them off, and switch providers to migrate the data across.

Real local Supabase + Convex:

> Clone https://github.com/2bTwist/baasdk and run `pnpm install`. Start a local
> Supabase from `packages/adapter-supabase` with `supabase start` (needs Docker) and
> a local Convex from `packages/adapter-convex` with `npx convex dev`. Add a
> `migratedFrom` column to the Supabase `todos` table:
> `alter table todos add column "migratedFrom" text;`. Copy `demo/config.example.js`
> to `demo/config.js` and set `mode: "real"`, `supabaseUrl: "http://127.0.0.1:54321"`,
> `supabaseKey` to the local anon key from `supabase status`, and
> `convexUrl: "http://127.0.0.1:3210"`. Run `pnpm demo` and open
> http://localhost:8788. Add and check off todos, then switch providers to migrate
> between the real backends; the "open table" links open the rows in Supabase Studio
> and the Convex dashboard. `demo/config.js` is gitignored, so your keys stay local.

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
| `@baas/adapter-supabase` | Supabase (PostgREST / Auth / Storage / opt-in Realtime) | ✅ |
| `@baas/adapter-convex` | Convex (reactive, JWT-verify auth, storage) | ✅ |
| `@baas/migrate` | one-time data cutover between any two backends | ✅ |

Every divergence between backends is a declared capability flag, asserted in both
directions by the suite. See the generated **[capability matrix](docs/CAPABILITIES.md)**.

## When to use baasdk (and when not)

**Decision rule:** baasdk pays off exactly when the cost of being locked to one
backend exceeds the cost of the portable-surface tax. Below that line it is pure
tax, and below that line you're better off using the provider SDK directly. That
is a perfectly good outcome, not a failure of the tool.

**Use it when:**

- **You are building a backend-agnostic library or framework** (an auth-session
  store, a CMS toolkit, a workflow engine) that must persist data but must not
  dictate the consumer's backend. The strongest case.
- **You ship a multi-backend product** (bring-your-own-Supabase vs use-our-Convex,
  or per-tenant backend choice).
- **You want to test in memory and deploy to a real backend.** Run the whole
  suite against `@baas/adapter-memory` (fast, hermetic, no Docker), then deploy
  against Supabase or Convex trusting the contract holds. This pays off even for
  a single-backend app, purely as a testing strategy.
- **You are migrating Supabase <-> Convex gradually.** Move portable CRUD / auth
  / files first, and keep joins and aggregations on the old backend through
  `.native()` until last.

**Do not use it when:**

- **You have a single backend and need its full power** (RLS, joins, materialized
  views, vector search, the full PostgREST grammar). Use the provider SDK directly.
- **Your core value is the relational model** (analytics, reporting, join-heavy
  work). Such an app lives almost entirely in `.native()`, so the abstraction
  buys little.
- **A latency- or cost-critical path depends on the index-vs-scan difference**
  that the portable surface deliberately does not model.

Provider-specific power is never walled off: every port exposes a typed
`.native()` escape hatch (see the [native-escape-hatch example](examples/native-escape-hatch/)).
The point of the abstraction is the portable core, not to hide the backend.

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
- **`@baas/migrate`**: a one-time data cutover between any two backends, built on
  the core `list`/`insert`/`patch` primitives (no provider SDK). See its README.

## Develop

```bash
pnpm install
pnpm test        # vitest: runtime conformance + type-level (.test-d.ts) tests
pnpm typecheck   # tsc --noEmit per package (turbo)
pnpm build       # tsup, ESM-only (.js + .d.ts) per package (turbo)
pnpm lint        # biome
pnpm docs:api    # TypeDoc API reference -> docs/api/ (gitignored; open index.html)
```

The API reference is generated from the `isolatedDeclarations`-enforced public
surface. It is not committed; CI validates that it builds cleanly (broken links
or types leaking out of the documented surface fail the build).

### How the suite runs against an adapter

The suite fixes a canonical `ConformanceSchema` (a tiny "todos" surface). An
adapter author supplies a constructor that wires that schema to their backend;
the suite then runs unchanged. The in-memory wiring lives in
`packages/adapter-memory/test/conformance.test.ts` and is the template a real
adapter follows. To add a backend, see
**[Writing an adapter](docs/WRITING-AN-ADAPTER.md)**.

### Cross-package resolution

`tsconfig.json` + `vitest.config.ts` map `@baas/*` to TypeScript **source**, so
tests and the editor work with no build step. Per-package `tsc --noEmit` and the
published `exports` resolve to built `dist` instead; turbo's `^build` ordering
makes that sound. Output is **ESM-only**.
