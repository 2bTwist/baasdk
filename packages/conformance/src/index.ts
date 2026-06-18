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
  type DocumentId,
  isOk,
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
