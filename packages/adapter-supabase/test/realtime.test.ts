/**
 * Docker-free unit tests for the reactive `subscribe()` path, driven by a fake
 * Supabase Realtime channel. The live conformance suite (which needs a running
 * stack) only runs in CI / with credentials, so the coalescing, ordering,
 * error, and teardown logic is proven here in isolation, and each assertion is
 * verified to be a real tripwire (see the comment on the coalescing test).
 *
 * Uses real timers with short waits (the adapter's debounce is 250ms), which is
 * more robust than interleaving fake timers with the query promises.
 */

import { createSupabaseBackend } from "@baas/adapter-supabase";
import { type Backend, isOk, type Result, type StoreSchema } from "@baas/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import { REALTIME_SUBSCRIBE_STATES } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it } from "vitest";

// A tiny single-query schema keeps the fixtures minimal.
interface TestSchema extends StoreSchema {
  readonly queries: {
    readonly listTodos: { readonly args: Record<string, never>; readonly result: string };
  };
  readonly mutations: Record<string, never>;
}

const DEBOUNCE_MS = 250;
/** Indexed access that throws (rather than a non-null assertion) when empty. */
function at<T>(arr: readonly T[], i: number): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`no element at index ${i}`);
  return v;
}
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
/** Let queued microtasks (resolved query promises -> onChange) settle. */
const flush = (): Promise<void> => sleep(0);
/** Wait out the debounce window plus a margin, then settle microtasks. */
const settleDebounce = async (): Promise<void> => {
  await sleep(DEBOUNCE_MS + 60);
  await flush();
};

// --- Fake Realtime channel + client -----------------------------------------

type StatusCb = (status: REALTIME_SUBSCRIBE_STATES) => void;

class FakeChannel {
  readonly pgHandlers: Array<() => void> = [];
  /** The postgres_changes config object passed to each `.on()` call. */
  readonly pgConfigs: Array<Record<string, unknown>> = [];
  statusCb: StatusCb | undefined;
  on(_event: string, config: Record<string, unknown>, cb: () => void): this {
    this.pgHandlers.push(cb);
    this.pgConfigs.push(config);
    return this;
  }
  subscribe(cb: StatusCb): this {
    this.statusCb = cb;
    return this;
  }
  /** Simulate a postgres_changes event on a watched table. */
  emitChange(): void {
    for (const h of this.pgHandlers) h();
  }
  /** Drive the channel lifecycle status. */
  setStatus(status: REALTIME_SUBSCRIBE_STATES): void {
    this.statusCb?.(status);
  }
}

class FakeClient {
  readonly channels: FakeChannel[] = [];
  readonly removed: FakeChannel[] = [];
  channel(_name: string): FakeChannel {
    const c = new FakeChannel();
    this.channels.push(c);
    return c;
  }
  removeChannel(c: FakeChannel): Promise<"ok"> {
    this.removed.push(c);
    return Promise.resolve("ok");
  }
}

// The query implementation is swappable per test (auto-resolve or manual defer).
let queryImpl: () => Promise<string>;

function makeBackend(opts: {
  fake: FakeClient;
  watch?: boolean;
  forceReactive?: boolean;
}): Backend<TestSchema> {
  return createSupabaseBackend<TestSchema>({
    client: opts.fake as unknown as SupabaseClient,
    queries: { listTodos: () => queryImpl() },
    mutations: {},
    ...(opts.watch ? { realtime: { listTodos: { tables: ["todos"] } } } : {}),
    ...(opts.forceReactive ? { capabilities: { reactiveQueries: true } } : {}),
  });
}

const dataOf = (r: Result<string>): string | undefined => (isOk(r) ? r.data : undefined);

describe("adapter-supabase reactive subscribe()", () => {
  let fake: FakeClient;

  beforeEach(() => {
    fake = new FakeClient();
    queryImpl = () => Promise.resolve("v0");
  });

  it("declaring a realtime watch flips reactiveQueries on", () => {
    expect(makeBackend({ fake, watch: true }).capabilities.reactiveQueries).toBe(true);
    expect(makeBackend({ fake: new FakeClient() }).capabilities.reactiveQueries).toBe(false);
  });

  it("delivers an initial snapshot once, immediately (before the channel is live)", async () => {
    const received: Array<Result<string>> = [];
    const backend = makeBackend({ fake, watch: true });
    backend.store.subscribe("listTodos", {}, (r) => received.push(r));
    await flush();
    expect(received).toHaveLength(1);
    expect(dataOf(at(received, 0))).toBe("v0");
  });

  it("coalesces a burst of change events into a single re-run", async () => {
    let calls = 0;
    queryImpl = () => {
      calls += 1;
      return Promise.resolve(`v${calls}`);
    };
    const received: Array<Result<string>> = [];
    const backend = makeBackend({ fake, watch: true });
    backend.store.subscribe("listTodos", {}, (r) => received.push(r));
    await flush(); // initial snapshot (calls -> 1)
    const channel = at(fake.channels, 0);
    channel.setStatus(REALTIME_SUBSCRIBE_STATES.SUBSCRIBED);
    await settleDebounce(); // catch-up re-run (calls -> 2)

    const callsBeforeBurst = calls;
    const deliveriesBeforeBurst = received.length;
    // A burst of 5 events within one debounce window must collapse to ONE re-run.
    // Tripwire check: removing the `if (!timer)` guard in schedule() (i.e. firing
    // per event) makes this assert 5, not 1, verified by hand during authoring.
    for (let i = 0; i < 5; i++) channel.emitChange();
    await settleDebounce();

    expect(calls - callsBeforeBurst).toBe(1);
    expect(received.length - deliveriesBeforeBurst).toBe(1);
  });

  it("never lets a slow older re-run overwrite a newer result", async () => {
    // Manual deferral: each query call parks a resolver the test controls.
    const resolvers: Array<(v: string) => void> = [];
    queryImpl = () =>
      new Promise<string>((resolve) => {
        resolvers.push(resolve);
      });

    const received: Array<Result<string>> = [];
    const backend = makeBackend({ fake, watch: true });
    backend.store.subscribe("listTodos", {}, (r) => received.push(r));
    const channel = at(fake.channels, 0);
    resolvers[0]?.("initial"); // settle the initial snapshot
    await flush();

    // Two separate change-driven re-runs, each parking a resolver.
    channel.emitChange();
    await settleDebounce(); // re-run A -> resolvers[1] (older generation)
    channel.emitChange();
    await settleDebounce(); // re-run B -> resolvers[2] (newer generation)

    // Resolve the NEWER first, then the OLDER. The older must be discarded.
    resolvers[2]?.("newer");
    await flush();
    resolvers[1]?.("older");
    await flush();

    expect(dataOf(at(received, received.length - 1))).toBe("newer");
    expect(received.map(dataOf)).not.toContain("older");
  });

  it("delivers a loud error when the channel fails (CHANNEL_ERROR / TIMED_OUT)", async () => {
    const received: Array<Result<string>> = [];
    const backend = makeBackend({ fake, watch: true });
    backend.store.subscribe("listTodos", {}, (r) => received.push(r));
    await flush();
    at(fake.channels, 0).setStatus(REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR);
    await flush();
    const last = at(received, received.length - 1);
    expect(last.ok).toBe(false);
    if (!last.ok) expect(last.error.code).toBe("network");
  });

  it("errors loudly when subscribing to a reactive backend query with no watch", async () => {
    // reactiveQueries forced on, but no realtime watch declared for listTodos.
    const received: Array<Result<string>> = [];
    const backend = makeBackend({ fake, forceReactive: true });
    backend.store.subscribe("listTodos", {}, (r) => received.push(r));
    await flush();
    expect(received).toHaveLength(1);
    const r = at(received, 0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("unsupported_capability");
    expect(fake.channels).toHaveLength(0); // no channel opened
  });

  it("stops delivering after unsubscribe and removes the channel", async () => {
    let calls = 0;
    queryImpl = () => {
      calls += 1;
      return Promise.resolve(`v${calls}`);
    };
    const received: Array<Result<string>> = [];
    const backend = makeBackend({ fake, watch: true });
    const unsub = backend.store.subscribe("listTodos", {}, (r) => received.push(r));
    await flush();
    const channel = at(fake.channels, 0);
    channel.setStatus(REALTIME_SUBSCRIBE_STATES.SUBSCRIBED);
    await settleDebounce();

    const countAtUnsub = received.length;
    unsub();
    expect(fake.removed).toContain(channel);

    channel.emitChange();
    await settleDebounce();
    expect(received).toHaveLength(countAtUnsub); // no further deliveries
  });

  it("non-reactive backend stays one-shot and opens no channel", async () => {
    const received: Array<Result<string>> = [];
    const backend = makeBackend({ fake }); // no watch, no override
    backend.store.subscribe("listTodos", {}, (r) => received.push(r));
    await flush();
    expect(received).toHaveLength(1);
    expect(dataOf(at(received, 0))).toBe("v0");
    expect(fake.channels).toHaveLength(0);
  });

  it("delivers the initial snapshot even when unsubscribed synchronously", async () => {
    // Drop-the-guard fix: the always-one-delivery contract must hold even if the
    // caller tears down before the initial query resolves (matches the in-memory
    // reference adapter). The generation guard still prevents stale overwrites.
    const received: Array<Result<string>> = [];
    const backend = makeBackend({ fake, watch: true });
    const unsub = backend.store.subscribe("listTodos", {}, (r) => received.push(r));
    unsub(); // synchronous teardown, before the initial query promise resolves
    await flush();
    expect(received).toHaveLength(1);
    expect(dataOf(at(received, 0))).toBe("v0");
  });

  it("re-runs on every SUBSCRIBED (reconnect catch-up), not just the first", async () => {
    let calls = 0;
    queryImpl = () => {
      calls += 1;
      return Promise.resolve(`v${calls}`);
    };
    const received: Array<Result<string>> = [];
    const backend = makeBackend({ fake, watch: true });
    backend.store.subscribe("listTodos", {}, (r) => received.push(r));
    await flush(); // initial (calls -> 1)
    const channel = at(fake.channels, 0);
    channel.setStatus(REALTIME_SUBSCRIBE_STATES.SUBSCRIBED);
    await settleDebounce(); // first catch-up (calls -> 2)
    channel.setStatus(REALTIME_SUBSCRIBE_STATES.SUBSCRIBED); // simulate a reconnect
    await settleDebounce(); // reconnect catch-up (calls -> 3)
    expect(calls).toBe(3);
  });

  it("latches channel errors: a streak of failures delivers exactly one error", async () => {
    const received: Array<Result<string>> = [];
    const backend = makeBackend({ fake, watch: true });
    backend.store.subscribe("listTodos", {}, (r) => received.push(r));
    await flush();
    const channel = at(fake.channels, 0);
    channel.setStatus(REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR);
    channel.setStatus(REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR);
    channel.setStatus(REALTIME_SUBSCRIBE_STATES.TIMED_OUT);
    await flush();
    expect(received.filter((r) => !r.ok)).toHaveLength(1);
  });

  it("re-arms the error latch after a SUBSCRIBED recovery", async () => {
    const received: Array<Result<string>> = [];
    const backend = makeBackend({ fake, watch: true });
    backend.store.subscribe("listTodos", {}, (r) => received.push(r));
    await flush();
    const channel = at(fake.channels, 0);
    channel.setStatus(REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR); // error 1
    await flush();
    channel.setStatus(REALTIME_SUBSCRIBE_STATES.SUBSCRIBED); // recover, re-arm latch
    await settleDebounce();
    channel.setStatus(REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR); // error 2
    await flush();
    expect(received.filter((r) => !r.ok)).toHaveLength(2);
  });

  it("treats an unexpected CLOSED as a loud error", async () => {
    const received: Array<Result<string>> = [];
    const backend = makeBackend({ fake, watch: true });
    backend.store.subscribe("listTodos", {}, (r) => received.push(r));
    await flush();
    at(fake.channels, 0).setStatus(REALTIME_SUBSCRIBE_STATES.CLOSED);
    await flush();
    const last = at(received, received.length - 1);
    expect(last.ok).toBe(false);
    if (!last.ok) expect(last.error.code).toBe("network");
  });

  it("ignores a CLOSED that follows our own unsubscribe", async () => {
    const received: Array<Result<string>> = [];
    const backend = makeBackend({ fake, watch: true });
    const unsub = backend.store.subscribe("listTodos", {}, (r) => received.push(r));
    await flush();
    const channel = at(fake.channels, 0);
    const countAtUnsub = received.length;
    unsub();
    channel.setStatus(REALTIME_SUBSCRIBE_STATES.CLOSED); // teardown-driven close
    await flush();
    expect(received).toHaveLength(countAtUnsub); // no error delivered
  });

  it("a bare table-name watch subscribes to the whole table (no filter)", async () => {
    const backend = makeBackend({ fake, watch: true }); // tables: ["todos"]
    backend.store.subscribe("listTodos", {}, () => {});
    await flush();
    const cfg = at(at(fake.channels, 0).pgConfigs, 0);
    expect(cfg).toMatchObject({ schema: "public", table: "todos" });
    expect(cfg).not.toHaveProperty("filter");
  });

  it("a { table, filter } watch passes the filter through to the channel config", async () => {
    const backend = createSupabaseBackend<TestSchema>({
      client: fake as unknown as SupabaseClient,
      queries: { listTodos: () => queryImpl() },
      mutations: {},
      realtime: { listTodos: { tables: [{ table: "messages", filter: "room_id=eq.42" }] } },
    });
    expect(backend.capabilities.reactiveQueries).toBe(true);
    backend.store.subscribe("listTodos", {}, () => {});
    await flush();
    const cfg = at(at(fake.channels, 0).pgConfigs, 0);
    expect(cfg).toMatchObject({ schema: "public", table: "messages", filter: "room_id=eq.42" });
  });
});
