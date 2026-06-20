/**
 * `@baas/migrate-conformance` — the migrate cross-backend suite.
 *
 * A dedicated test-suite package (sibling to `@baas/conformance`), because the
 * suite must pair the real backend with the in-memory REFERENCE adapter, so it
 * depends on `@baas/adapter-memory`. `@baas/adapter-memory` in turn depends on
 * `@baas/conformance` (to prove itself against the contract spec), so the migrate
 * suite cannot live in `@baas/conformance` without forming a package cycle. This
 * package sits downstream of both and nothing depends back on it.
 *
 * `runMigrateConformanceSuite` is the executable spec for `@baas/migrate`,
 * parameterized by ONE real backend constructor and run UNCHANGED in BOTH
 * directions against the in-memory reference: `memory -> real` (proves the real
 * backend survives as a migration TARGET — re-inserting every row, stamping the
 * `migratedFrom` marker) and `real -> memory` (proves it survives as a SOURCE —
 * paging, id surfacing, keyset order).
 *
 * Why this shape: `migrate()` was tested memory -> memory only, and that blind
 * spot let a real bug ship green — the marker used to be `_migratedFrom`, and
 * Convex rejects user fields starting with `_`, so no memory test could ever
 * have caught it. Pairing the real backend with memory in BOTH directions
 * exercises the platform-specific insert/read rules that the memory double
 * cannot model, without standing up two live stacks in one CI job.
 *
 * The suite drives only the portable store port (`list`/`insert`/`patch`/`get`)
 * on two migrate-only collections, `m_people` and `m_tasks` (an FK into
 * `m_people`). They are deliberately disjoint from the contract suite's
 * `todos`/`notes`/`items`, so the two suites never truncate each other.
 */

import { createMemoryBackend } from "@baas/adapter-memory";
import type { DocumentId, DocumentStore, ListOptions, ListPage, Result } from "@baas/core";
import { err } from "@baas/core";
import { type MigrateEndpoint, migrate } from "@baas/migrate";
import { beforeEach, describe, expect, it } from "vitest";

/** The slice of a backend the migrate suite touches: portable store ops only. */
type StorePort = Pick<DocumentStore, "list" | "insert" | "patch" | "get">;
/** A backend reduced to its store; any `Backend` satisfies this structurally. */
export interface MigrateBackend {
  readonly store: StorePort;
}
/** Constructor for a fresh, reset backend (mirrors conformance's `MakeBackend`). */
export type MakeMigrateBackend = () => MigrateBackend | Promise<MigrateBackend>;

type Row = Record<string, unknown>;

/** A fresh in-memory backend — the portable reference the real backend is paired with. */
const makeMemory: MakeMigrateBackend = () => createMemoryBackend({ queries: {}, mutations: {} });

// A Supabase SOURCE surfaces its `id`/`created_at` columns as regular fields;
// drop them so they never carry into the target (which re-mints its own). On a
// memory/Convex source these names don't exist, so it is a harmless no-op.
const STRIP = ["id", "created_at"] as const;

/** Unwrap a Result, failing the test loudly (with the backend's error) on err. */
function expectOk<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(`expected ok, got error: ${r.error.code} — ${r.error.message}`);
  return r.data;
}

async function insertRow(b: MigrateBackend, collection: string, value: Row): Promise<DocumentId> {
  return expectOk(await b.store.insert(collection, value));
}

/** Page a collection to exhaustion via the cursor (the portable read path). */
async function listAll(b: MigrateBackend, collection: string): Promise<Row[]> {
  const out: Row[] = [];
  let cursor = null as ListPage<Row>["nextCursor"];
  do {
    const page = expectOk(await b.store.list<Row>(collection, { cursor }));
    out.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor !== null);
  return out;
}

/**
 * Wrap a target so its Nth insert returns a backend error, leaving every other
 * op untouched. Adapter-agnostic (it intercepts at the store port), so the same
 * fault-injection drives the fail-fast assertion against memory OR a live backend.
 */
function faultyTarget(real: MigrateBackend, failOnInsertCall: number): MigrateEndpoint {
  let inserts = 0;
  return {
    store: {
      list: (collection: string, opts?: ListOptions) => real.store.list(collection, opts),
      insert: (collection: string, value: unknown) => {
        inserts++;
        if (inserts === failOnInsertCall) {
          return Promise.resolve(err({ code: "network", message: "boom" }));
        }
        return real.store.insert(collection, value);
      },
      patch: (collection: string, id: DocumentId, value: unknown) =>
        real.store.patch(collection, id, value as Partial<unknown>),
      get: (collection: string, id: DocumentId) => real.store.get(collection, id),
    },
  };
}

/**
 * Run the migrate spec against `realName`/`makeReal` in both directions.
 * `makeReal` must return a FRESH, reset backend on every call (each test
 * constructs its own source and target), exactly like conformance's `MakeBackend`.
 */
export function runMigrateConformanceSuite(realName: string, makeReal: MakeMigrateBackend): void {
  describe(`migrate conformance: ${realName}`, () => {
    const directions = [
      { label: "memory -> real", makeSource: makeMemory, makeTarget: makeReal },
      { label: "real -> memory", makeSource: makeReal, makeTarget: makeMemory },
    ] as const;

    for (const dir of directions) {
      describe(dir.label, () => {
        let source: MigrateBackend;
        let target: MigrateBackend;

        beforeEach(async () => {
          source = await dir.makeSource();
          target = await dir.makeTarget();
        });

        it("copies every row, re-minting ids and stamping migratedFrom (counts + idMap)", async () => {
          const names = ["alice", "bob", "carol"];
          for (const name of names) await insertRow(source, "m_people", { name });

          const report = await migrate(source, target, {
            collections: ["m_people"],
            stripFields: STRIP,
          });

          expect(report.ok).toBe(true);
          expect(report.collections.m_people).toEqual({ copied: 3, skipped: 0, relinked: 0 });
          expect(report.idMap.m_people?.size).toBe(3);

          const rows = await listAll(target, "m_people");
          expect(rows).toHaveLength(3);
          expect(rows.map((r) => r.name).sort()).toEqual([...names].sort());
          // Every re-minted row carries a portable lineage marker that maps back
          // through the report's idMap to its target-minted id. (This is the
          // assertion that would have caught the `_`-prefixed-marker bug: it
          // requires the marker to survive a real insert into the target.)
          for (const row of rows) {
            const from = row.migratedFrom;
            expect(typeof from).toBe("string");
            expect(report.idMap.m_people?.get(from as string)).toBe(row._id);
          }
        });

        it("remaps a foreign key so it resolves on the target", async () => {
          const alice = await insertRow(source, "m_people", { name: "alice" });
          const bob = await insertRow(source, "m_people", { name: "bob" });
          await insertRow(source, "m_tasks", { title: "t-alice", ownerId: alice });
          await insertRow(source, "m_tasks", { title: "t-bob", ownerId: bob });

          const report = await migrate(source, target, {
            collections: ["m_people", "m_tasks"],
            relations: { m_tasks: { ownerId: "m_people" } },
            stripFields: STRIP,
          });

          expect(report.ok).toBe(true);
          expect(report.collections.m_tasks?.relinked).toBe(2);

          const tasks = await listAll(target, "m_tasks");
          expect(tasks).toHaveLength(2);
          for (const task of tasks) {
            const expectedName = task.title === "t-alice" ? "alice" : "bob";
            // The FK points at a TARGET id (not the stale source id) and that id
            // resolves to the right person on the target.
            const resolved = expectOk(
              await target.store.get<Row>("m_people", task.ownerId as DocumentId),
            );
            expect(resolved?.name).toBe(expectedName);
          }
        });

        it("is idempotent: a re-run skips already-copied rows, no duplicates", async () => {
          for (const name of ["alice", "bob", "carol"]) {
            await insertRow(source, "m_people", { name });
          }

          const first = await migrate(source, target, {
            collections: ["m_people"],
            stripFields: STRIP,
          });
          expect(first.collections.m_people).toEqual({ copied: 3, skipped: 0, relinked: 0 });

          const second = await migrate(source, target, {
            collections: ["m_people"],
            stripFields: STRIP,
          });
          expect(second.collections.m_people).toEqual({ copied: 0, skipped: 3, relinked: 0 });

          expect(await listAll(target, "m_people")).toHaveLength(3); // no dupes
        });

        it("stops on the first insert error and surfaces it with a partial idMap", async () => {
          for (const name of ["alice", "bob", "carol"]) {
            await insertRow(source, "m_people", { name });
          }
          // buildResumeIndex lists the (empty) target first without inserting, so
          // the copy phase's 3rd insert is the 3rd insert call: fail there.
          const wrapped = faultyTarget(target, 3);

          const report = await migrate(source, wrapped, {
            collections: ["m_people"],
            stripFields: STRIP,
          });

          expect(report.ok).toBe(false);
          expect(report.error?.collection).toBe("m_people");
          expect(report.error?.phase).toBe("copy");
          expect(report.error?.error.code).toBe("network");
          // The two rows copied before the failure are mapped (resume can continue)
          // and exactly those two landed on the real target.
          expect(report.idMap.m_people?.size).toBe(2);
          expect(await listAll(target, "m_people")).toHaveLength(2);
        });
      });
    }
  });
}
