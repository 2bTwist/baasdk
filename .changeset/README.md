# Changesets

This folder is managed by [changesets](https://github.com/changesets/changesets).

Add a changeset for any change that should publish a new version:

```
pnpm changeset
```

`@baas/core` and each adapter are versioned and published independently. A
`core` bump propagates to the adapters that depend on it. `@baas/conformance` is
a dev/test-only package and is ignored by the release pipeline.
