/**
 * Property-based coverage for `list()` against the in-memory REFERENCE adapter.
 *
 * The conformance suite pins the filter/pagination contract with hand-picked
 * cases; this stress-tests the same contract over thousands of randomized
 * row-sets and queries, comparing the adapter to a pure-JS oracle. The in-memory
 * adapter is the reference every other adapter is judged against, so a bug in its
 * `list()` would corrupt that yardstick — this is the net that catches it.
 *
 * Generators are deliberately confined to the DOCUMENTED semantics (notably: `n`
 * is unique and never null so ordering is unambiguous; `in` lists never contain
 * null because "null in the list never matches null rows"; `neq` on the nullable
 * field only ever compares against null). Probing undocumented edges would test
 * the implementation, not the contract.
 */

import { createMemoryBackend } from "@baas/adapter-memory";
import type { Backend, Cursor, ListOptions, ListPage, Result } from "@baas/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

interface Row {
  readonly n: number;
  readonly tag: string;
  readonly nilable: string | null;
  readonly flag: boolean;
}
type Stored = Row & { readonly _id: string };
type Cond = readonly [field: string, op: string, value: unknown];

const fresh = (): Backend => createMemoryBackend({ queries: {}, mutations: {} });

/** Random row-set with a unique `n` (so creation order and `n`-order are total). */
const rowsArb = fc.uniqueArray(
  fc.record({
    n: fc.integer({ min: -50, max: 50 }),
    tag: fc.constantFrom("a", "b", "c", "d"),
    nilable: fc.option(fc.constantFrom("x", "y"), { nil: null }),
    flag: fc.boolean(),
  }),
  { selector: (r) => r.n, minLength: 1, maxLength: 40 },
);

/** A single random `where` condition, confined to the documented operator domain. */
const condArb: fc.Arbitrary<Cond> = fc.oneof(
  fc.tuple(
    fc.constant("n"),
    fc.constantFrom("eq", "neq", "gt", "gte", "lt", "lte"),
    fc.integer({ min: -50, max: 50 }),
  ),
  fc.tuple(fc.constant("n"), fc.constant("in"), fc.uniqueArray(fc.integer({ min: -50, max: 50 }))),
  fc.tuple(
    fc.constant("tag"),
    fc.constantFrom("eq", "neq"),
    fc.constantFrom("a", "b", "c", "d", "z"),
  ),
  fc.tuple(
    fc.constant("tag"),
    fc.constant("in"),
    fc.uniqueArray(fc.constantFrom("a", "b", "c", "d", "z")),
  ),
  fc.tuple(fc.constant("flag"), fc.constantFrom("eq", "neq"), fc.boolean()),
  fc.tuple(fc.constant("nilable"), fc.constantFrom("eq", "neq"), fc.constant(null)),
  fc.tuple(fc.constant("nilable"), fc.constant("eq"), fc.constantFrom("x", "y", "z")),
  fc.tuple(
    fc.constant("nilable"),
    fc.constant("in"),
    fc.uniqueArray(fc.constantFrom("x", "y", "z")),
  ),
);

/** Oracle: does a row satisfy a condition, by the documented rules? */
function matches(row: Row, [field, op, value]: Cond): boolean {
  const v = (row as unknown as Record<string, unknown>)[field];
  switch (op) {
    case "eq":
      return v === value;
    case "neq":
      return v !== value;
    case "gt":
      return (v as number) > (value as number);
    case "gte":
      return (v as number) >= (value as number);
    case "lt":
      return (v as number) < (value as number);
    case "lte":
      return (v as number) <= (value as number);
    case "in":
      return (value as unknown[]).includes(v); // generated `in` lists never hold null
    default:
      throw new Error(`unmapped op ${op}`);
  }
}

async function seed(backend: Backend, rows: readonly Row[]): Promise<void> {
  for (const row of rows) {
    const r = await backend.store.insert("items", row);
    if (!r.ok) throw new Error(`seed failed: ${r.error.message}`);
  }
}

/** Walk the cursor to exhaustion, returning every item across all pages. */
async function listAll(backend: Backend, opts: ListOptions): Promise<Stored[]> {
  const out: Stored[] = [];
  let cursor: Cursor | null = null;
  let guard = 0;
  do {
    const r: Result<ListPage<Stored>> = await backend.store.list<Stored>("items", {
      ...opts,
      cursor,
    });
    if (!r.ok) throw new Error(`list failed: ${r.error.message}`);
    out.push(...r.data.items);
    cursor = r.data.nextCursor;
    if (++guard > 1000) throw new Error("pagination did not terminate");
  } while (cursor !== null);
  return out;
}

const nsSorted = (items: ReadonlyArray<{ n: number }>): number[] =>
  items.map((i) => i.n).sort((a, b) => a - b);

describe("list() property-based contract (in-memory reference)", () => {
  it("filter result set equals the oracle, across the operator matrix", async () => {
    await fc.assert(
      fc.asyncProperty(
        rowsArb,
        condArb,
        fc.integer({ min: 1, max: 12 }),
        async (rows, cond, limit) => {
          const backend = fresh();
          await seed(backend, rows);
          const got = await listAll(backend, { where: [cond as never], limit });
          const expected = rows.filter((r) => matches(r, cond));
          expect(nsSorted(got)).toEqual(nsSorted(expected));
        },
      ),
      { numRuns: 200 },
    );
  });

  it("AND-combines two conditions equal to the oracle intersection", async () => {
    await fc.assert(
      fc.asyncProperty(rowsArb, condArb, condArb, async (rows, a, b) => {
        const backend = fresh();
        await seed(backend, rows);
        const got = await listAll(backend, { where: [a as never, b as never] });
        const expected = rows.filter((r) => matches(r, a) && matches(r, b));
        expect(nsSorted(got)).toEqual(nsSorted(expected));
      }),
      { numRuns: 150 },
    );
  });

  it("paginates the full set with no duplicates or skips, for any page size", async () => {
    await fc.assert(
      fc.asyncProperty(rowsArb, fc.integer({ min: 1, max: 7 }), async (rows, limit) => {
        const backend = fresh();
        await seed(backend, rows);
        const got = await listAll(backend, { limit });
        expect(got).toHaveLength(rows.length); // no dupes, no skips
        expect(nsSorted(got)).toEqual(nsSorted(rows));
      }),
      { numRuns: 150 },
    );
  });

  it("orders by a numeric field exactly, even paginated and filtered", async () => {
    await fc.assert(
      fc.asyncProperty(
        rowsArb,
        fc.boolean(),
        fc.integer({ min: 1, max: 6 }),
        async (rows, desc, limit) => {
          const backend = fresh();
          await seed(backend, rows);
          const got = await listAll(backend, {
            order: { field: "n", direction: desc ? "desc" : "asc" },
            limit,
          });
          const expected = [...rows].sort((x, y) => (desc ? y.n - x.n : x.n - y.n)).map((r) => r.n);
          expect(got.map((i) => i.n)).toEqual(expected);
        },
      ),
      { numRuns: 150 },
    );
  });
});
