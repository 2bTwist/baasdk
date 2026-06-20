# Releasing

Packages publish to npm from CI via **OIDC trusted publishing**, no long-lived
token. This document is the runbook plus the one-time setup that has to happen on
npmjs.com (which a maintainer does by hand; it cannot be scripted from here).

## How a release works

1. **Every publishable change ships with a changeset.** Run `pnpm changeset`,
   pick the bumped packages and semver level, and commit the generated file.
   (`@baas/conformance` is `ignore`d in `.changeset/config.json`; it is the test
   suite, not a consumer package.) Docs, CI, scripts, and `examples/` need no
   changeset.
2. **Merge to `main`.** `.github/workflows/release.yml` runs. With pending
   changesets it opens or updates a **"Version Packages"** PR that applies the
   version bumps and assembles changelogs. This step needs no npm auth.
3. **Merge the Version Packages PR.** The workflow runs again, the changesets are
   now consumed, and it **publishes** the bumped packages via `changeset publish`.

Versioning is independent per package (`fixed: []`, `linked: []`), so an adapter
patch never forces a `@baas/core` bump.

## One-time npm setup (maintainer, on npmjs.com)

Trusted publishing means npm trusts a specific GitHub repo + workflow to publish a
specific package, instead of a stored token.

1. **Own the `@baas` scope/org** on npm.
2. For **each publishable package** (`@baas/core`, `@baas/adapter-memory`,
   `@baas/adapter-supabase`, `@baas/adapter-convex`, `@baas/migrate`), open
   `https://www.npmjs.com/package/<name>/access` and add a **trusted publisher**:
   - Provider: GitHub Actions
   - Repository: `2bTwist/baasdk`
   - Workflow: `.github/workflows/release.yml`
   - Environment: leave blank (the workflow uses none)
3. Confirm each package's `package.json` `repository.url` matches the repo above.
   It already does (`git+https://github.com/2bTwist/baasdk.git`), and provenance
   relies on that match.

### The first-publish chicken-and-egg

A trusted publisher can only be configured for a package that **already exists**
on npm, and at the time of writing npm does not yet support the very first publish
of a brand-new package over OIDC (see npm/cli#8544). So each package is
bootstrapped once:

1. Create a **granular access token** scoped to the `@baas` packages with publish
   rights, short expiry.
2. Publish the initial version once with it (locally or a throwaway workflow):
   `npm publish --access public` (omit `--provenance`; provenance needs the CI
   OIDC context, not a local token).
3. Configure the trusted publisher (above) and **delete the token**.

From then on every release publishes via OIDC with provenance, no token.

## Requirements (handled by CI)

- **npm >= 11.5.1** and **Node >= 22.14.0** for OIDC trusted publishing. The
  release workflow upgrades npm (`npm install -g npm@latest`) on the Node 22
  runner, and the job has `permissions: id-token: write`.
- **Provenance** is on (`NPM_CONFIG_PROVENANCE: "true"`). If a published version
  is missing its provenance attestation, add `--provenance` to the publish (or
  `publishConfig.provenance` per package). Provenance proves the package's
  **origin** (this repo, this commit, this workflow), not that the code is safe.

## Versioning policy (summary)

The full rationale lives in the build-plan research doc; the rules:

- **What is a `@baas/core` major:** removing or renaming a port method, narrowing
  a return, widening a required argument, removing or flipping a capability flag,
  or changing an `ErrorCode` value. The committed `.d.ts` snapshot test is the
  enforcement: any such change is a blocking, reviewed diff (re-approve with
  `vitest -u` only when the break is intended).
- **Adding a capability flag** is a core **minor** (additive). **Removing or
  flipping** one is a **major**.
- **Adding a port method** is a core minor but pressures every adapter to
  implement it to stay conformant; treat it as rare and prefer `.native()`.
- A breaking core major requires every adapter to publish a new major widening
  its core range, and the conformance suite must pass against the new core first.
- **Deprecate** with `@deprecated` (caught by the zero-deprecations gate) for at
  least one minor before removal.
- **Pre-1.0 (`0.x`):** breaking-in-minor is allowed by semver, but still use the
  snapshot + a changeset so the break is visible. Do not cut `1.0` until two real
  adapters pass conformance in CI (they now do).
