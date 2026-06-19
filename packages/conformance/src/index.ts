/**
 * `@baas/conformance` — the single Interface Contract suite.
 *
 * It is parameterized by a `makeBackend` constructor and run, UNCHANGED,
 * against every adapter — including the in-memory reference adapter, which must
 * pass 100% by definition. The suite is capability-aware: a behavior is
 * asserted only on adapters that declare support for it.
 *
 * The suite fixes a canonical `ConformanceSchema` (a tiny "todos" surface).
 * Every adapter must provide a constructor that wires THIS schema; that is what
 * makes one suite runnable against many backends.
 */

import {
  type Backend,
  CAPABILITY_KEYS,
  type Capabilities,
  type Cursor,
  type DocumentId,
  isOk,
  type ListOptions,
  type ListPage,
  type Result,
  type StoreSchema,
  supportsCredentials,
  supportsReactivity,
  supportsTransactions,
} from "@baas/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// The canonical schema every adapter must implement to be conformant.
// ---------------------------------------------------------------------------

export interface Todo {
  readonly _id: DocumentId;
  readonly title: string;
  readonly done: boolean;
}

export interface ConformanceSchema extends StoreSchema {
  readonly queries: {
    /** List every todo. */
    readonly listTodos: { readonly args: Record<string, never>; readonly result: Todo[] };
    /** Fetch a single todo by id, or null. */
    readonly getTodo: { readonly args: { readonly id: DocumentId }; readonly result: Todo | null };
  };
  readonly mutations: {
    /** Insert a todo, returning its new id. */
    readonly addTodo: { readonly args: { readonly title: string }; readonly result: DocumentId };
    /** Flip a todo's `done`. */
    // biome-ignore lint/suspicious/noConfusingVoidType: `void` is the intended "no result" type for a mutation that returns nothing.
    readonly toggleTodo: { readonly args: { readonly id: DocumentId }; readonly result: void }; // eslint-disable-line @typescript-eslint/no-invalid-void-type -- void models a mutation that returns no result.
    /**
     * Insert a todo and then throw. Used to probe transaction atomicity:
     * on a transactional backend the insert must be rolled back.
     */
    readonly addThenFail: { readonly args: { readonly title: string }; readonly result: never };
  };
}

/**
 * The constructor an adapter must supply. Returns a fresh, empty backend.
 *
 * May be async: a real adapter backed by a shared database (Supabase, Convex,
 * Firebase) resets persistent state here, which the in-memory adapter never
 * needed. Stateless adapters can still return synchronously.
 */
export type MakeBackend = () => Backend<ConformanceSchema> | Promise<Backend<ConformanceSchema>>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Flush pending micro/macro tasks so async subscription callbacks settle. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Poll until `predicate` holds. The subscribe() contract guarantees one
 * delivery, but a network-backed adapter delivers it after a real round-trip,
 * not within a single microtask — so tests wait for the delivery rather than
 * assuming a single `flush()` suffices.
 */
const waitFor = async (predicate: () => boolean, timeoutMs = 3000): Promise<void> => {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor: condition not met in time");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

/** Unwrap a Result, failing the test loudly if it errored. */
function expectOk<T>(r: Result<T>): T {
  // Narrow on the discriminant directly so the error branch is well-typed.
  if (!r.ok) {
    throw new Error(`expected ok, got error: ${r.error.code} — ${r.error.message}`);
  }
  return r.data;
}

// ---------------------------------------------------------------------------
// The suite.
// ---------------------------------------------------------------------------

export function runConformanceSuite(adapterName: string, makeBackend: MakeBackend): void {
  describe(`conformance: ${adapterName}`, () => {
    let backend: Backend<ConformanceSchema>;

    beforeEach(async () => {
      backend = await makeBackend();
    });

    // -- DocumentStore: named operations -----------------------------------

    describe("DocumentStore — named operations", () => {
      it("run() returns the empty result on a fresh backend", async () => {
        const todos = expectOk(await backend.store.run("listTodos", {}));
        expect(todos).toEqual([]);
      });

      it("mutate() persists, and run() reflects it", async () => {
        const id = expectOk(await backend.store.mutate("addTodo", { title: "buy milk" }));
        expect(typeof id).toBe("string");

        const todos = expectOk(await backend.store.run("listTodos", {}));
        expect(todos).toHaveLength(1);
        expect(todos[0]).toMatchObject({ title: "buy milk", done: false });

        const one = expectOk(await backend.store.run("getTodo", { id }));
        expect(one).toMatchObject({ _id: id, title: "buy milk" });
      });

      it("mutate() can read back its own writes within the store", async () => {
        const id = expectOk(await backend.store.mutate("addTodo", { title: "task" }));
        expectOk(await backend.store.mutate("toggleTodo", { id }));
        const one = expectOk(await backend.store.run("getTodo", { id }));
        expect(one?.done).toBe(true);
      });

      it("getTodo() returns null for a missing id", async () => {
        // DocumentId is opaque — don't fabricate one. Create a real id, remove
        // it, then look it up: a valid id that no longer resolves.
        const id = expectOk(await backend.store.mutate("addTodo", { title: "temp" }));
        expectOk(await backend.store.remove("todos", id));
        const missing = expectOk(await backend.store.run("getTodo", { id }));
        expect(missing).toBeNull();
      });
    });

    // -- DocumentStore: portable CRUD primitives ---------------------------

    describe("DocumentStore — direct CRUD", () => {
      it("insert / get / patch / remove round-trip", async () => {
        const id = expectOk(await backend.store.insert("notes", { body: "hello", pinned: false }));

        const fetched = expectOk(
          await backend.store.get<{ body: string; pinned: boolean }>("notes", id),
        );
        expect(fetched).toMatchObject({ body: "hello", pinned: false });

        expectOk(await backend.store.patch("notes", id, { pinned: true }));
        const patched = expectOk(await backend.store.get<{ pinned: boolean }>("notes", id));
        expect(patched?.pinned).toBe(true);

        expectOk(await backend.store.remove("notes", id));
        const gone = expectOk(await backend.store.get("notes", id));
        expect(gone).toBeNull();
      });

      it("returns an error Result (never throws) for an unknown operation", async () => {
        // Intentionally bypass the type system: callers in the wild may pass a
        // bad operation name. The contract is "error Result, not a throw".
        const bad = await (backend.store.run as (op: string, args: unknown) => Promise<unknown>)(
          "doesNotExist",
          {},
        );
        expect(bad).toMatchObject({ ok: false });
      });

      it("mutate() also returns an error Result (never throws) for an unknown operation", async () => {
        const bad = await (
          backend.store.mutate as (op: string, args: unknown) => Promise<{ ok: boolean }>
        )("doesNotExist", {});
        expect(bad).toMatchObject({ ok: false });
      });

      it("remove() of a non-existent id is idempotent (returns ok)", async () => {
        // Use a VALID id that no longer resolves (never fabricate an opaque id):
        // create one, remove it, then remove again. remove() reaches a desired end
        // state, so a redundant remove succeeds rather than erroring.
        const id = expectOk(await backend.store.insert("notes", { body: "temp", pinned: false }));
        expectOk(await backend.store.remove("notes", id));
        expectOk(await backend.store.remove("notes", id)); // idempotent: still ok
      });

      it("patch() of a non-existent id returns err(not_found)", async () => {
        // patch() requires an existing target; the portable contract is not_found,
        // not a silent no-op. (A valid-but-removed id, never a fabricated one.)
        const id = expectOk(await backend.store.insert("notes", { body: "temp", pinned: false }));
        expectOk(await backend.store.remove("notes", id));
        const patched = await backend.store.patch("notes", id, { pinned: true });
        expect(patched).toMatchObject({ ok: false, error: { code: "not_found" } });
      });

      it("round-trips a unicode / special-character payload intact", async () => {
        // Emoji, accents, CJK, RTL, a combining mark, astral-plane chars, and
        // whitespace. (No NUL byte: Postgres text rejects it, so it is not part
        // of the portable contract.)
        const body = "🎉 cafe naïve 日本語 العربية 𝔘𝔫𝔦 é \t end";
        const id = expectOk(await backend.store.insert("notes", { body, pinned: false }));
        const fetched = expectOk(await backend.store.get<{ body: string }>("notes", id));
        expect(fetched?.body).toBe(body);
      });
    });

    // -- list(): portable filter + creation-order + cursor pagination ------

    describe("list()", () => {
      interface ItemRow {
        readonly _id: DocumentId;
        readonly n: number;
        readonly tag: string;
        readonly nilable: string | null;
        readonly flag: boolean;
      }
      // Standard seed: five items inserted in order, all but the last with a NULL
      // `nilable`; `flag` is true on even n. Sequential awaits make creation order
      // well-defined (distinct timestamps on a network-backed adapter).
      const seed = async (): Promise<void> => {
        await insertItem(1, "a", null);
        await insertItem(2, "b", null);
        await insertItem(3, "a", null);
        await insertItem(4, "c", null);
        await insertItem(5, "b", "x");
      };
      const insertItem = async (n: number, tag: string, nilable: string | null): Promise<void> => {
        expectOk(await backend.store.insert("items", { n, tag, nilable, flag: n % 2 === 0 }));
      };
      const ns = (page: { items: ReadonlyArray<ItemRow> }): number[] => page.items.map((i) => i.n);
      const list = (opts?: ListOptions) => backend.store.list<ItemRow>("items", opts);

      it("lists a collection in creation order, every item carrying _id", async () => {
        await seed();
        const page = expectOk(await list());
        expect(ns(page)).toEqual([1, 2, 3, 4, 5]);
        expect(page.nextCursor).toBeNull();
        for (const item of page.items) expect(typeof item._id).toBe("string");
      });

      it("orders descending when asked", async () => {
        await seed();
        expect(ns(expectOk(await list({ order: "desc" })))).toEqual([5, 4, 3, 2, 1]);
      });

      it("filters with eq across the six operators", async () => {
        await seed();
        expect(ns(expectOk(await list({ where: [["tag", "eq", "a"]] })))).toEqual([1, 3]);
        expect(ns(expectOk(await list({ where: [["n", "neq", 3]] })))).toEqual([1, 2, 4, 5]);
        expect(ns(expectOk(await list({ where: [["n", "gt", 3]] })))).toEqual([4, 5]);
        expect(ns(expectOk(await list({ where: [["n", "gte", 3]] })))).toEqual([3, 4, 5]);
        expect(ns(expectOk(await list({ where: [["n", "lt", 3]] })))).toEqual([1, 2]);
        expect(ns(expectOk(await list({ where: [["n", "lte", 2]] })))).toEqual([1, 2]);
      });

      it("filters on null with eq / neq", async () => {
        await seed();
        expect(ns(expectOk(await list({ where: [["nilable", "eq", null]] })))).toEqual([
          1, 2, 3, 4,
        ]);
        expect(ns(expectOk(await list({ where: [["nilable", "neq", null]] })))).toEqual([5]);
      });

      it("AND-combines multiple conditions", async () => {
        await seed();
        expect(
          ns(
            expectOk(
              await list({
                where: [
                  ["tag", "eq", "b"],
                  ["n", "gt", 2],
                ],
              }),
            ),
          ),
        ).toEqual([5]);
      });

      it("walks the whole set via the cursor with no dupes or skips", async () => {
        await seed();
        const seen: number[] = [];
        let next: Cursor | null = null;
        let guard = 0;
        do {
          const page: ListPage<ItemRow> = expectOk(await list({ limit: 2, cursor: next }));
          seen.push(...ns(page));
          next = page.nextCursor;
          if (++guard > 10) throw new Error("pagination did not terminate");
        } while (next !== null);
        expect(seen).toEqual([1, 2, 3, 4, 5]);
      });

      it("paginates a filtered, ordered query", async () => {
        await seed();
        // tag "b" => n 2 and 5; desc => [5, 2], one per page. Follow the cursor
        // until null, tolerating an empty trailing page: a scan-based backend
        // (Convex with a filter) may return a non-null cursor after the last
        // MATCH, then an empty final page. The portable contract is "loop until
        // nextCursor is null", which holds on every backend.
        const collected: number[] = [];
        let next: Cursor | null = null;
        let guard = 0;
        do {
          const page: ListPage<ItemRow> = expectOk(
            await list({ where: [["tag", "eq", "b"]], order: "desc", limit: 1, cursor: next }),
          );
          collected.push(...ns(page));
          next = page.nextCursor;
          if (++guard > 10) throw new Error("pagination did not terminate");
        } while (next !== null);
        expect(collected).toEqual([5, 2]);
      });

      it("returns an empty page (null cursor) for an empty collection", async () => {
        const page = expectOk(await list());
        expect(page.items).toEqual([]);
        expect(page.nextCursor).toBeNull();
      });

      it("filters on a boolean field", async () => {
        await seed();
        expect(ns(expectOk(await list({ where: [["flag", "eq", true]] })))).toEqual([2, 4]);
        expect(ns(expectOk(await list({ where: [["flag", "eq", false]] })))).toEqual([1, 3, 5]);
      });

      it("a listed item's _id round-trips through get", async () => {
        await seed();
        const first = expectOk(await list({ limit: 1 })).items[0];
        expect(first).toBeDefined();
        if (!first) return;
        const fetched = expectOk(await backend.store.get<ItemRow>("items", first._id));
        expect(fetched?.n).toBe(first.n);
      });

      it("returns an error Result (never throws) for a malformed cursor", async () => {
        await seed();
        const bad = "not-a-real-cursor" as unknown as Cursor;
        const r = await backend.store.list<ItemRow>("items", { cursor: bad });
        expect(r.ok).toBe(false);
      });

      it("filters with the in operator", async () => {
        await seed();
        expect(ns(expectOk(await list({ where: [["tag", "in", ["a", "c"]]] })))).toEqual([1, 3, 4]);
        expect(ns(expectOk(await list({ where: [["n", "in", [2, 4]]] })))).toEqual([2, 4]);
      });

      it("orders by a document field", async () => {
        await seed();
        // tags by creation order are [a,b,a,c,b]; sorted they are [a,a,b,b,c].
        // Assert the tag SEQUENCE (not n) so the result is independent of how each
        // backend breaks same-tag ties (counter vs pk vs index).
        const tagsOf = (p: ListPage<ItemRow>): string[] => p.items.map((i) => i.tag);
        expect(tagsOf(expectOk(await list({ order: { field: "tag" } })))).toEqual([
          "a",
          "a",
          "b",
          "b",
          "c",
        ]);
        expect(
          tagsOf(expectOk(await list({ order: { field: "tag", direction: "desc" } }))),
        ).toEqual(["c", "b", "b", "a", "a"]);
      });

      it("paginates a field-ordered query (stable across ties)", async () => {
        await seed();
        const tags: string[] = [];
        let next: Cursor | null = null;
        let guard = 0;
        do {
          const page: ListPage<ItemRow> = expectOk(
            await list({ order: { field: "tag" }, limit: 2, cursor: next }),
          );
          tags.push(...page.items.map((i) => i.tag));
          next = page.nextCursor;
          if (++guard > 10) throw new Error("pagination did not terminate");
        } while (next !== null);
        expect(tags).toEqual(["a", "a", "b", "b", "c"]);
      });

      it("applies the default page size of 50", async () => {
        for (let i = 0; i < 60; i++) {
          expectOk(
            await backend.store.insert("items", { n: i, tag: "x", nilable: null, flag: false }),
          );
        }
        const page = expectOk(await list());
        expect(page.items).toHaveLength(50);
        expect(page.nextCursor).not.toBeNull();
      });
    });

    // -- subscribe(): one-shot always, live updates capability-gated -------

    describe("subscribe()", () => {
      it("always delivers the current result at least once", async () => {
        const received: unknown[] = [];
        const unsub = backend.store.subscribe("listTodos", {}, (r) => received.push(r));
        await waitFor(() => received.length >= 1);
        expect(received[0]).toMatchObject({ ok: true, data: [] });
        unsub();
      });

      it("delivers live updates IFF capabilities.reactiveQueries", async () => {
        const results: Todo[][] = [];
        const unsub = backend.store.subscribe("listTodos", {}, (r) => {
          if (isOk(r)) results.push(r.data);
        });
        await waitFor(() => results.length >= 1); // initial delivery
        const afterInitial = results.length;

        expectOk(await backend.store.mutate("addTodo", { title: "reactive?" }));

        if (supportsReactivity(backend)) {
          await waitFor(() => results.length > afterInitial);
          expect(results[results.length - 1]).toHaveLength(1);
        } else {
          // Non-reactive backends must NOT push beyond the initial delivery.
          await flush();
          expect(results).toHaveLength(afterInitial);
        }
        unsub();
      });

      it("stops delivering after unsubscribe", async () => {
        const results: unknown[] = [];
        const unsub = backend.store.subscribe("listTodos", {}, (r) => results.push(r));
        await waitFor(() => results.length >= 1); // ensure the one delivery landed
        unsub();
        const countAtUnsub = results.length;

        expectOk(await backend.store.mutate("addTodo", { title: "after unsub" }));
        await flush();
        expect(results).toHaveLength(countAtUnsub);
      });

      it("unsubscribing synchronously (before initial delivery) yields no extra delivery", async () => {
        const results: unknown[] = [];
        const unsub = backend.store.subscribe("listTodos", {}, (r) => results.push(r));
        unsub(); // tear down before the guaranteed initial delivery has settled

        expectOk(await backend.store.mutate("addTodo", { title: "after sync unsub" }));
        await flush();
        // The one guaranteed initial delivery may still land; the mutation must
        // never produce an additional one. So: at most one, ever.
        expect(results.length).toBeLessThanOrEqual(1);
      });

      it("delivers an error Result (never throws) when the operation is unknown", async () => {
        const received: Array<{ ok: boolean }> = [];
        const unsub = (
          backend.store.subscribe as (
            op: string,
            args: unknown,
            onChange: (r: { ok: boolean }) => void,
          ) => () => void
        )("doesNotExist", {}, (r) => received.push(r));
        await waitFor(() => received.length >= 1);
        expect(received[0]).toMatchObject({ ok: false });
        unsub();
      });
    });

    // -- transactions: capability-gated ------------------------------------

    describe("transactions", () => {
      it("mutation atomicity IFF capabilities.multiDocumentTransactions", async () => {
        const failed = await backend.store.mutate("addThenFail", { title: "doomed" });
        expect(failed.ok).toBe(false);

        const todos = expectOk(await backend.store.run("listTodos", {}));
        if (supportsTransactions(backend)) {
          // The partial insert must have been rolled back.
          expect(todos).toHaveLength(0);
        } else {
          // No transaction guarantee: the insert may linger. Don't assert either way.
          expect(Array.isArray(todos)).toBe(true);
        }
      });
    });

    // -- AuthProvider: narrow core + capability-gated credentials ----------

    describe("AuthProvider", () => {
      it("reports no identity / session before sign-in", async () => {
        expect(expectOk(await backend.auth.getIdentity())).toBeNull();
        expect(expectOk(await backend.auth.getSession())).toBeNull();
      });

      it("onAuthStateChange delivers the current state once subscribed", async () => {
        const states: unknown[] = [];
        const unsub = backend.auth.onAuthStateChange((s) => states.push(s));
        // Real auth SDKs deliver the initial state asynchronously; the in-memory
        // adapter delivers it synchronously. Both must have fired after a flush.
        await flush();
        expect(states.length).toBeGreaterThanOrEqual(1);
        expect(states[0]).toBeNull();
        unsub();
      });

      it("credential flows work IFF capabilities.managesCredentials", async () => {
        const auth = backend.auth;
        if (!supportsCredentials(auth)) {
          expect(backend.capabilities.managesCredentials).toBe(false);
          return;
        }

        // Real auth providers enforce a minimum password length (Supabase: 6).
        const password = "conformance-pw-123";
        const states: unknown[] = [];
        const unsub = auth.onAuthStateChange((s) => states.push(s));

        const session = expectOk(await auth.signUp("a@example.com", password));
        expect(session?.identity.email).toBe("a@example.com");

        const ident = expectOk(await auth.getIdentity());
        expect(ident?.email).toBe("a@example.com");
        // initial null + signed-in session (delivered async by real SDKs)
        await flush();
        expect(states.length).toBeGreaterThanOrEqual(2);

        // A second signup with the same email is a conflict, never a silent
        // success. (Supabase hides this behind enumeration protection; the
        // adapter must still surface it as conflict.)
        const dupe = await auth.signUp("a@example.com", password);
        expect(dupe).toMatchObject({ ok: false, error: { code: "conflict" } });

        expectOk(await auth.signOut());
        expect(expectOk(await auth.getIdentity())).toBeNull();

        // wrong password is unauthorized, not a throw
        const bad = await auth.signInWithPassword("a@example.com", "wrong");
        expect(bad).toMatchObject({ ok: false, error: { code: "unauthorized" } });

        const ok = expectOk(await auth.signInWithPassword("a@example.com", password));
        expect(ok.identity.email).toBe("a@example.com");
        unsub();
      });
    });

    // -- FileStore: capability-gated ---------------------------------------

    describe("FileStore", () => {
      it("upload / getUrl / download / remove round-trip IFF fileStorage", async () => {
        if (!backend.capabilities.fileStorage) {
          expect(backend.files.capabilities.fileStorage).toBe(false);
          return;
        }

        const bytes = new TextEncoder().encode("file-contents");
        const handle = expectOk(
          await backend.files.upload(bytes.buffer, { contentType: "text/plain" }),
        );

        const url = expectOk(await backend.files.getUrl(handle));
        expect(typeof url).toBe("string");

        const blob = expectOk(await backend.files.download(handle));
        expect(await blob.text()).toBe("file-contents");

        expectOk(await backend.files.remove(handle));
        expect(expectOk(await backend.files.getUrl(handle))).toBeNull();
      });
    });

    // -- capability coverage: no flag silently untested --------------------

    describe("capabilities", () => {
      // The suite must ACCOUNT FOR every capability in one of two ways:
      //  - behaviorally gated: the suite BRANCHES on the flag (see the named
      //    describe block) and asserts the capability's behavior when true. The
      //    false branch takes the documented negative path, which is a strict
      //    counter-assertion for some flags (reactiveQueries: no further delivery
      //    after a mutation) but only "the behavior is not required" for others (a
      //    non-transactional backend MAY leave a partial write, so the suite does
      //    not force a leak). So "gated" means the flag changes what the suite
      //    asserts, NOT that every false branch is a strict negative.
      //  - descriptor-only: provider power reached through native(), or a
      //    performance trait, that has no portable behavioral assertion.
      // A capability that is NEITHER is a hole: the test below fails until a newly
      // added flag is classified (and, if behavioral, gated). This is the anti-rot
      // guard that keeps the portability claim honest as `core` grows.
      const BEHAVIORALLY_GATED: ReadonlySet<keyof Capabilities> = new Set([
        "multiDocumentTransactions", // see describe("transactions")
        "reactiveQueries", // see describe("subscribe()")
        "managesCredentials", // see describe("AuthProvider")
        "fileStorage", // see describe("FileStore")
      ]);
      const DESCRIPTOR_ONLY: ReadonlySet<keyof Capabilities> = new Set([
        "serverSideJoins", // reached via native(); not a portable behavior
        "aggregations", // reached via native(); not a portable behavior
        "efficientFilterRequiresIndex", // performance trait; a leak we name, not a behavior
      ]);

      it("declares every capability as a boolean", () => {
        for (const key of CAPABILITY_KEYS) {
          expect(typeof backend.capabilities[key], `capability "${key}"`).toBe("boolean");
        }
      });

      it("accounts for every capability (gated in both directions, or descriptor-only)", () => {
        for (const key of CAPABILITY_KEYS) {
          const accounted = BEHAVIORALLY_GATED.has(key) || DESCRIPTOR_ONLY.has(key);
          expect(
            accounted,
            `capability "${key}" is unclassified: gate it in both directions in this suite, or mark it descriptor-only`,
          ).toBe(true);
        }
        // No stale classification: every classified key is still a real capability.
        for (const key of [...BEHAVIORALLY_GATED, ...DESCRIPTOR_ONLY]) {
          expect([...CAPABILITY_KEYS]).toContain(key);
        }
      });
    });

    // -- escape hatch ------------------------------------------------------

    describe("escape hatch", () => {
      it("native() is present on every port", () => {
        expect(backend.store.native()).toBeDefined();
        expect(backend.auth.native()).toBeDefined();
        expect(backend.files.native()).toBeDefined();
      });
    });

    afterEach(() => {
      // nothing to tear down for in-memory; placeholder for real adapters.
    });
  });
}
