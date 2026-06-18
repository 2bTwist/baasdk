# Contributing

Thanks for your interest. This document is a map: every convention below names
the gate that enforces it, so you can see what is checked automatically and what
is left to review. If a rule is not machine-enforced, it says so.

## Setup

```bash
pnpm install        # Node 22, pnpm 11
pnpm verify         # the full local gate (see below)
```

Workspace layout (pnpm + Turborepo + Changesets, ESM-only via tsup):

- `packages/core` (`@baas/core`) is the port layer: interfaces, types, capability
  descriptors, and pure guards. It imports no backend SDK and ships no logic.
- `packages/conformance` (`@baas/conformance`) is one contract suite, parameterized
  by a `makeBackend` constructor and run unchanged against every adapter.
- `packages/adapter-memory` is the in-memory reference adapter.
- `packages/adapter-supabase` is the Supabase adapter.

## The gates

CI is the source of truth. The `all-green` check is the single required status;
every other job feeds into it. Locally, `pnpm verify` runs the fast half and the
pre-commit hook (lefthook) runs a subset on staged files. The slower jobs
(`vitest` and `publint`/`attw`) run in CI only.

| Convention | Enforced by | Command |
|---|---|---|
| Formatting and non-type-aware lint | Biome | `biome ci` |
| **Zero warnings, zero deprecations** | `biome --error-on-warnings` + `@typescript-eslint/no-deprecated` | `pnpm lint:types`, `biome ci` |
| No silent suppressions (every `eslint-disable` states why) | `eslint-comments/require-description` | `pnpm lint:types` |
| Async correctness (no floating/misused promises, exhaustive switches, `return await`) | typescript-eslint type-aware rules | `pnpm lint:types` |
| **A `Result` must be consumed** (no silently swallowed failure) | custom `must-use-result` rule | `pnpm lint:types` |
| `core` returns errors, never throws across the boundary | `functional/no-throw-statements` (core) | `pnpm lint:types` |
| `core` imports no provider SDK; adapters never import each other; no cycles | dependency-cruiser | `pnpm lint:boundaries` |
| Explicit public signatures | `isolatedDeclarations` (per published package) | `pnpm typecheck` |
| Published API stability | `.d.ts` snapshot test + publint + attw | `pnpm test`, `pnpm lint:publish` |
| A changeset accompanies any publishable `src/` change | CI `changeset-check` | (CI) |
| Behavior/contract tests over interaction-shape mocks | the conformance suite is the executable spec | `pnpm test` |

### Review-enforced (no automated gate)

These are real conventions but not machine-checked; reviewers hold the line:

- **Lean repo.** Delete legacy or dead code in the same change that supersedes it.
  Never defer cleanup to a later phase. (No dead-export gate is wired yet.)
- **Intent-revealing port names.** Name ports by domain intent (`DocumentStore`,
  `AuthProvider`, `FileStore`), never by mechanism.
- **Branded opaque ids and `readonly`.** `DocumentId`/`FileHandle` are opaque;
  never construct or fabricate them. Prefer `readonly`.
- **Divergence is declared, never silent.** Anything a backend cannot do is a
  `false` in its `Capabilities` descriptor, branched on by callers and the suite,
  not a surprise at runtime. Provider-specific power is reached through
  `.native()`, not added to the core contract.

## Pull request workflow

1. Branch off `main`.
2. If you change a publishable package's `src/`, add a changeset: `pnpm changeset`.
3. Push and open a PR. CI must be green (`all-green`); direct pushes to `main`
   are blocked.
4. Changes are reviewed before merge. Squash-merge.

How a merged changeset becomes a published release (and the npm trusted-publishing
setup) is documented in **[RELEASING.md](RELEASING.md)**.

The Definition of Done for any change: `pnpm verify` is green (Biome with zero
warnings, boundaries, type-aware lint, typecheck, build, tests), and the public
API surface snapshot is unchanged or its update is reviewed.

## Adding an adapter

Full walkthrough: **[docs/WRITING-AN-ADAPTER.md](docs/WRITING-AN-ADAPTER.md)**.
The shape, in brief:

1. Implement `DocumentStore`, `AuthProvider`, `FileStore`, and a `Backend`
   factory. Declare honest `Capabilities`. Expose `.native()` on each port.
2. Convert provider errors into the `Result` shape at the boundary; do not let
   them throw across a port method.
3. Wire the canonical `ConformanceSchema` to your backend (see
   `packages/adapter-memory/test/fixture.ts` for the template) and run the suite
   against it. The suite is capability-aware: it asserts a behavior only when
   your adapter declares support for it.
4. An adapter is done when the conformance suite passes, not when it compiles.
