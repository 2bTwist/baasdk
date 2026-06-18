# Convex feasibility spike (throwaway)

Answers one question before committing to `@baas/adapter-convex`: **can the
core's direct-CRUD primitives (`store.insert/get/patch/remove`) be implemented
generically on Convex**, given Convex has no client-side `ctx.db`?

The plan: deploy a small set of generic, schemaless helper functions and call
them from the client. The risk: `ctx.db.insert(<runtime string>, doc)` might
require statically-known tables or a `schema.ts`.

## Two halves

### 1. Hermetic (no login) — `npm test`

`convex/baas.test.ts` runs the real helper code against `convex-test` (Convex's
in-process runtime mock) in **schemaless** mode.

**Result: PASS.** Generic inserts into runtime-variable table names work; new
collections are created on first insert; CRUD round-trips. `convex/_generated/
server.ts` is a hand-authored stand-in (codegen needs a deployment); it is a
faithful re-export of Convex's generic builders.

> Caveat: `convex-test` is a reimplementation, not prod. The live half confirms.

### 2. Live (needs a deployment) — `npm run spike`

`spike.ts` exercises the client-only mappings against a real Convex deployment:
`setAuth` (matches core's `TokenFetcher`), dynamic dispatch by string via
`anyApi`, the generic insert helper, and `onUpdate` reactivity.

```bash
cd spike
npx convex dev --once     # interactive login; pushes functions; writes .env.local
npm run spike             # derives the URL from CONVEX_DEPLOYMENT in .env.local
```

Expected: `setAuth` log line fires, the insert returns an id, and `onUpdate`
delivers **twice** (initial + after insert) — confirming `reactiveQueries: true`.

## What this tells the adapter design

- Direct CRUD is generically implementable (one helper set per app).
- `setAuth` / `onUpdate` map 1:1 to the core's auth + subscribe ports.
- The cost the core never sees: those helpers must be **deployed into the user's
  `convex/`** (a Convex Component is the idiomatic packaging), and a real
  deployment is needed to run conformance — Convex is not hermetic the way
  Supabase/Firebase are.
