/**
 * Conformance-style spec for `migrate()`, run memory -> memory: the in-memory
 * adapter is the fast, fully-portable double, so the contract is proven here
 * instantly and the live Supabase -> Convex cutover is left to a manual smoke
 * (the playground button). Each behavior below has a matching tripwire in the
 * commit log: the guard was broken to confirm it goes red before it was trusted.
 */

import { createMemoryBackend } from "@baas/adapter-memory";
import {
  type Backend,
  type Cursor,
  type DocumentId,
  err,
  type ListOptions,
  type ListPage,
  ok,
  type Result,
} from "@baas/core";
import { dryRunMigrate, type MigrateEndpoint, type MigrateProgress, migrate } from "@baas/migrate";
import { describe, expect, it } from "vitest";

type Row = Record<string, unknown>;
type Mem = Backend;

const fresh = (): Mem => createMemoryBackend({ queries: {}, mutations: {} });

async function insertRow(backend: Mem, collection: string, value: Row): Promise<DocumentId> {
  const r = await backend.store.insert(collection, value);
  if (!r.ok) throw new Error(`seed insert failed: ${r.error.message}`);
  return r.data;
}

async function listAll(backend: MigrateEndpoint, collection: string): Promise<Row[]> {
  const out: Row[] = [];
  let cursor: Cursor | null = null;
  do {
    const r: Result<ListPage<Row>> = await backend.store.list<Row>(collection, { cursor });
    if (!r.ok) throw new Error(`list failed: ${r.error.message}`);
    out.push(...r.data.items);
    cursor = r.data.nextCursor;
  } while (cursor !== null);
  return out;
}

describe("migrate(): flat copy (P1)", () => {
  it("copies every row, re-minting ids and stamping migratedFrom", async () => {
    const source = fresh();
    const target = fresh();
    const a = await insertRow(source, "todos", { title: "a", done: false });
    const b = await insertRow(source, "todos", { title: "b", done: true });
    const c = await insertRow(source, "todos", { title: "c", done: false });

    const report = await migrate(source, target, { collections: ["todos"] });

    expect(report.ok).toBe(true);
    expect(report.collections.todos).toEqual({ copied: 3, skipped: 0, relinked: 0 });

    const rows = await listAll(target, "todos");
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.title).sort()).toEqual(["a", "b", "c"]);
    const sourceIds = new Set<string>([a, b, c]);
    for (const row of rows) {
      const migratedFrom = row.migratedFrom as string;
      const id = row._id as string;
      // Lineage is stamped to a real source id, and the row carries the
      // TARGET-minted id that migrate recorded for it (not the source's _id,
      // which was stripped before insert). (Memory ids are only unique within a
      // backend, so target ids may coincide with source ids by string, which is
      // an id-scheme artifact, not something migrate promises; the idMap linkage
      // is the portable invariant.)
      expect(sourceIds.has(migratedFrom)).toBe(true);
      expect(report.idMap.todos?.get(migratedFrom)).toBe(id);
    }
    expect(report.idMap.todos?.size).toBe(3);
    expect(report.idMap.todos?.get(a)).toBeDefined();
  });

  it("drops fields named in stripFields (e.g. a Supabase source's pk column)", async () => {
    const source = fresh();
    const target = fresh();
    await insertRow(source, "todos", { title: "a", id: "legacy-pk", created_at: "2020" });

    await migrate(source, target, {
      collections: ["todos"],
      stripFields: ["id", "created_at"],
    });

    const [row] = await listAll(target, "todos");
    expect(row?.title).toBe("a");
    expect(row).not.toHaveProperty("id");
    expect(row).not.toHaveProperty("created_at");
  });

  it("treats migratedFrom as reserved, replacing any source value with new lineage", async () => {
    const source = fresh();
    const target = fresh();
    // A source row that itself carries migratedFrom (e.g. a chained migration).
    const id = await insertRow(source, "todos", { title: "a", migratedFrom: "stale-lineage" });

    await migrate(source, target, { collections: ["todos"] });

    const [row] = await listAll(target, "todos");
    expect(row?.migratedFrom).toBe(id); // re-stamped to THIS run's source id, not "stale-lineage"
  });

  it("stamps a portable marker with no leading underscore (Convex rejects _-prefixed fields)", async () => {
    const source = fresh();
    const target = fresh();
    await insertRow(source, "todos", { title: "a" });

    await migrate(source, target, { collections: ["todos"] });

    const [row] = await listAll(target, "todos");
    // The lineage marker must be a plain field; Convex refuses to insert any user
    // field starting with "_", so an underscore marker would break Convex targets.
    expect(row).toHaveProperty("migratedFrom");
    const underscoreFields = Object.keys(row ?? {}).filter((k) => k.startsWith("_") && k !== "_id");
    expect(underscoreFields).toEqual([]);
  });

  it("reports copy progress per row", async () => {
    const source = fresh();
    const target = fresh();
    await insertRow(source, "todos", { title: "a" });
    await insertRow(source, "todos", { title: "b" });

    const events: MigrateProgress[] = [];
    await migrate(source, target, {
      collections: ["todos"],
      onProgress: (e) => events.push(e),
    });

    expect(events).toHaveLength(2);
    expect(events.every((e) => e.phase === "copy" && e.collection === "todos")).toBe(true);
    expect(events.map((e) => e.done)).toEqual([1, 2]);
  });

  it("leaves the source untouched (cutover reads only)", async () => {
    const source = fresh();
    const target = fresh();
    await insertRow(source, "todos", { title: "a" });
    await migrate(source, target, { collections: ["todos"] });
    expect(await listAll(source, "todos")).toHaveLength(1);
  });
});

describe("migrate(): relation relink (P2)", () => {
  it("rewrites a foreign key to the target's new id", async () => {
    const source = fresh();
    const target = fresh();
    const alice = await insertRow(source, "users", { name: "alice" });
    const bob = await insertRow(source, "users", { name: "bob" });
    await insertRow(source, "posts", { title: "p1", authorId: alice });
    await insertRow(source, "posts", { title: "p2", authorId: bob });

    const report = await migrate(source, target, {
      collections: ["users", "posts"],
      relations: { posts: { authorId: "users" } },
    });

    expect(report.ok).toBe(true);
    expect(report.collections.posts?.relinked).toBe(2);

    const users = await listAll(target, "users");
    const posts = await listAll(target, "posts");
    const newUserIdByName = new Map(users.map((u) => [u.name as string, u._id as string]));

    for (const post of posts) {
      const expectedAuthor =
        post.title === "p1" ? newUserIdByName.get("alice") : newUserIdByName.get("bob");
      // The FK now points at the TARGET user id, not the stale source id.
      expect(post.authorId).toBe(expectedAuthor);
      // And it resolves on the target.
      const resolved = await target.store.get<Row>("users", post.authorId as DocumentId);
      expect(resolved.ok && resolved.data?.name).toBe(post.title === "p1" ? "alice" : "bob");
    }
  });

  it("leaves an unmapped/dangling foreign key as the copied value", async () => {
    const source = fresh();
    const target = fresh();
    // authorId points at a user that is NOT migrated (users not in collections).
    await insertRow(source, "posts", { title: "orphan", authorId: "ghost-id" });

    const report = await migrate(source, target, {
      collections: ["posts"],
      relations: { posts: { authorId: "users" } },
    });

    expect(report.ok).toBe(true);
    expect(report.collections.posts?.relinked).toBe(0);
    const [post] = await listAll(target, "posts");
    expect(post?.authorId).toBe("ghost-id"); // left as-is, never silently nulled
  });

  it("leaves a dangling FK whose target collection WAS migrated but the value has no mapping", async () => {
    const source = fresh();
    const target = fresh();
    const alice = await insertRow(source, "users", { name: "alice" });
    await insertRow(source, "posts", { title: "p1", authorId: alice });
    await insertRow(source, "posts", { title: "p2", authorId: "no-such-user" });

    const report = await migrate(source, target, {
      collections: ["users", "posts"],
      relations: { posts: { authorId: "users" } },
    });

    expect(report.ok).toBe(true);
    expect(report.collections.posts?.relinked).toBe(1); // only p1 had a mappable FK
    const posts = await listAll(target, "posts");
    const p2 = posts.find((p) => p.title === "p2");
    expect(p2?.authorId).toBe("no-such-user"); // unmapped value left, not nulled
  });
});

describe("migrate(): resume + batch (P3)", () => {
  it("is idempotent: a re-run skips already-copied rows, no duplicates", async () => {
    const source = fresh();
    const target = fresh();
    await insertRow(source, "todos", { title: "a" });
    await insertRow(source, "todos", { title: "b" });
    await insertRow(source, "todos", { title: "c" });

    const first = await migrate(source, target, { collections: ["todos"] });
    expect(first.collections.todos).toEqual({ copied: 3, skipped: 0, relinked: 0 });

    const second = await migrate(source, target, { collections: ["todos"] });
    expect(second.collections.todos).toEqual({ copied: 0, skipped: 3, relinked: 0 });

    expect(await listAll(target, "todos")).toHaveLength(3); // no dupes
  });

  it("paginates the source across multiple pages with a small batchSize", async () => {
    const source = fresh();
    const target = fresh();
    for (let i = 0; i < 5; i++) await insertRow(source, "todos", { i });

    const report = await migrate(source, target, { collections: ["todos"], batchSize: 2 });

    expect(report.collections.todos?.copied).toBe(5);
    expect(await listAll(target, "todos")).toHaveLength(5);
  });

  it("rejects a row over maxValueBytes before inserting it (opt-in byte bound)", async () => {
    const source = fresh();
    const target = fresh();
    await insertRow(source, "todos", { title: "small" });
    await insertRow(source, "todos", { title: "BIG".repeat(5000) }); // ~15 KB body
    await insertRow(source, "todos", { title: "also-small" });

    const report = await migrate(source, target, { collections: ["todos"], maxValueBytes: 1000 });

    expect(report.ok).toBe(false);
    expect(report.error?.phase).toBe("copy");
    expect(report.error?.error.code).toBe("validation");
    expect(report.error?.error.message).toMatch(/maxValueBytes/);
    // The oversized row never lands; only rows copied before it are on the target.
    const landed = await listAll(target, "todos");
    expect(landed.every((r) => (r.title as string).length < 100)).toBe(true);
    expect(landed.length).toBeLessThan(3); // aborted before the third row
  });

  it("copies normally when every row is under maxValueBytes", async () => {
    const source = fresh();
    const target = fresh();
    await insertRow(source, "todos", { title: "a" });
    await insertRow(source, "todos", { title: "b" });

    const report = await migrate(source, target, {
      collections: ["todos"],
      maxValueBytes: 1_000_000,
    });

    expect(report.ok).toBe(true);
    expect(report.collections.todos?.copied).toBe(2);
  });

  it("measures a bigint value instead of throwing when maxValueBytes is set", async () => {
    // JSON.stringify throws on bigint; a naive size guard would crash (an
    // unhandled throw, breaking the never-throws contract) or wrongly reject a
    // legitimate Convex int64. The guard must measure it (as its decimal string)
    // and let a small row through.
    const source = fresh();
    const target = fresh();
    await insertRow(source, "todos", { title: "a", count: 42n });

    const report = await migrate(source, target, {
      collections: ["todos"],
      maxValueBytes: 1_000_000,
    });

    expect(report.ok).toBe(true);
    expect(report.collections.todos?.copied).toBe(1);
  });
});

describe("migrate(): fail-fast (P4)", () => {
  /** A target whose Nth insert returns a backend error, wrapping a real memory store. */
  function faultyTarget(real: Mem, failOnInsertCall: number): MigrateEndpoint {
    let inserts = 0;
    return {
      store: {
        list<T = unknown>(collection: string, opts?: ListOptions): Promise<Result<ListPage<T>>> {
          return real.store.list<T>(collection, opts);
        },
        insert<T = Row>(collection: string, value: T): Promise<Result<DocumentId>> {
          inserts++;
          if (inserts === failOnInsertCall) {
            return Promise.resolve(err({ code: "network", message: "boom" }));
          }
          return real.store.insert<T>(collection, value);
        },
        patch<T = Row>(
          collection: string,
          id: DocumentId,
          value: Partial<T>,
        ): Promise<Result<void>> {
          return real.store.patch<T>(collection, id, value);
        },
        get<T = unknown>(collection: string, id: DocumentId): Promise<Result<T | null>> {
          return real.store.get<T>(collection, id);
        },
      },
    };
  }

  it("stops on the first insert error and surfaces it with partial idMap", async () => {
    const source = fresh();
    const real = fresh();
    const target = faultyTarget(real, 3); // third insert blows up

    await insertRow(source, "todos", { title: "a" });
    await insertRow(source, "todos", { title: "b" });
    await insertRow(source, "todos", { title: "c" });

    const report = await migrate(source, target, { collections: ["todos"] });

    expect(report.ok).toBe(false);
    expect(report.error?.collection).toBe("todos");
    expect(report.error?.phase).toBe("copy");
    expect(report.error?.oldId).toBeDefined();
    expect(report.error?.error.code).toBe("network");
    // The two rows copied before the failure are mapped (resume can continue).
    expect(report.idMap.todos?.size).toBe(2);
    expect(await listAll(real, "todos")).toHaveLength(2);
  });

  it("aborts fail-fast with a validation error on a source row missing a usable _id", async () => {
    const target = fresh();
    // A misbehaving source whose list() yields a row with no _id (contract
    // violation). migrate must fail loudly, not collapse the idMap to one key.
    const badSource: MigrateEndpoint = {
      store: {
        list<T = unknown>(_collection: string, _opts?: ListOptions): Promise<Result<ListPage<T>>> {
          return Promise.resolve(ok({ items: [{ title: "a" } as unknown as T], nextCursor: null }));
        },
        insert<T = Row>(collection: string, value: T): Promise<Result<DocumentId>> {
          return target.store.insert<T>(collection, value);
        },
        patch<T = Row>(
          collection: string,
          id: DocumentId,
          value: Partial<T>,
        ): Promise<Result<void>> {
          return target.store.patch<T>(collection, id, value);
        },
        get<T = unknown>(collection: string, id: DocumentId): Promise<Result<T | null>> {
          return target.store.get<T>(collection, id);
        },
      },
    };

    const report = await migrate(badSource, target, { collections: ["todos"] });

    expect(report.ok).toBe(false);
    expect(report.error?.phase).toBe("copy");
    expect(report.error?.error.code).toBe("validation");
    expect(await listAll(target, "todos")).toHaveLength(0); // nothing landed
  });

  it("aborts when an inserted row cannot be read back (target filters reads, e.g. Supabase RLS)", async () => {
    const source = fresh();
    await insertRow(source, "todos", { title: "a" });
    await insertRow(source, "todos", { title: "b" });

    // A target that accepts inserts but whose reads are filtered: insert/patch
    // succeed, but get() always returns null (the row is invisible to this key).
    // This is the Supabase insert-allowed/select-denied RLS case, which silently
    // breaks resume (the next run's resume scan sees an empty target and
    // re-copies). migrate must fail loudly on the FIRST copied row instead.
    const real = fresh();
    const readFilteredTarget: MigrateEndpoint = {
      store: {
        list<T = unknown>(collection: string, opts?: ListOptions): Promise<Result<ListPage<T>>> {
          return real.store.list<T>(collection, opts);
        },
        insert<T = Row>(collection: string, value: T): Promise<Result<DocumentId>> {
          return real.store.insert<T>(collection, value);
        },
        patch<T = Row>(
          collection: string,
          id: DocumentId,
          value: Partial<T>,
        ): Promise<Result<void>> {
          return real.store.patch<T>(collection, id, value);
        },
        get<T = unknown>(_collection: string, _id: DocumentId): Promise<Result<T | null>> {
          return Promise.resolve(ok(null)); // reads are filtered: row invisible
        },
      },
    };

    const report = await migrate(source, readFilteredTarget, { collections: ["todos"] });

    expect(report.ok).toBe(false);
    expect(report.error?.collection).toBe("todos");
    expect(report.error?.phase).toBe("copy");
    expect(report.error?.error.code).toBe("validation");
    expect(report.error?.error.message).toMatch(/read it back/i);
    // It aborts on the FIRST inserted row, before copying the rest.
    expect(report.collections.todos?.copied).toBe(1);
  });
});

describe("dryRunMigrate(): projection without writes (P5)", () => {
  it("reports toCopy for a fresh target and leaves it untouched", async () => {
    const source = fresh();
    const target = fresh();
    await insertRow(source, "todos", { title: "a" });
    await insertRow(source, "todos", { title: "b" });
    await insertRow(source, "todos", { title: "c" });

    const plan = await dryRunMigrate(source, target, { collections: ["todos"] });

    expect(plan.ok).toBe(true);
    expect(plan.collections.todos).toEqual({ total: 3, toCopy: 3, toSkip: 0 });
    // Nothing was written to the target.
    expect(await listAll(target, "todos")).toHaveLength(0);
  });

  it("reports toSkip for rows already migrated (after a real run)", async () => {
    const source = fresh();
    const target = fresh();
    await insertRow(source, "todos", { title: "a" });
    await insertRow(source, "todos", { title: "b" });
    await migrate(source, target, { collections: ["todos"] }); // copies both

    await insertRow(source, "todos", { title: "c" }); // a new row appears
    const plan = await dryRunMigrate(source, target, { collections: ["todos"] });

    expect(plan.ok).toBe(true);
    expect(plan.collections.todos).toEqual({ total: 3, toCopy: 1, toSkip: 2 });
    expect(await listAll(target, "todos")).toHaveLength(2); // still untouched
  });

  it("flags an oversized row (maxValueBytes) the real run would reject, without writing", async () => {
    const source = fresh();
    const target = fresh();
    await insertRow(source, "todos", { title: "small" });
    await insertRow(source, "todos", { title: "BIG".repeat(5000) });

    const plan = await dryRunMigrate(source, target, {
      collections: ["todos"],
      maxValueBytes: 1000,
    });

    expect(plan.ok).toBe(false);
    expect(plan.error?.phase).toBe("copy");
    expect(plan.error?.error.code).toBe("validation");
    expect(plan.error?.error.message).toMatch(/maxValueBytes/);
    expect(await listAll(target, "todos")).toHaveLength(0); // pure read, no writes
  });

  it("flags a source row missing a usable _id", async () => {
    const target = fresh();
    const badSource: MigrateEndpoint = {
      store: {
        list<T = unknown>(_c: string, _o?: ListOptions): Promise<Result<ListPage<T>>> {
          return Promise.resolve(ok({ items: [{ title: "a" } as unknown as T], nextCursor: null }));
        },
        insert: (c, v) => target.store.insert(c, v),
        patch: (c, id, v) => target.store.patch(c, id, v),
        get: (c, id) => target.store.get(c, id),
      },
    };

    const plan = await dryRunMigrate(badSource, target, { collections: ["todos"] });

    expect(plan.ok).toBe(false);
    expect(plan.error?.error.code).toBe("validation");
  });
});
