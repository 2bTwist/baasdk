/**
 * Hermetic tests for the CLIENT-side auth path. The live conformance suite can't
 * reach it: `managesCredentials: false` makes the suite's credential block
 * early-return, and the local deployment has no auth provider configured, so
 * `setToken` / authenticated `getSession` / `decodeJwtExp` / the
 * `forceRefreshToken` -> `forceRefresh` rename would otherwise be asserted by the
 * type-checker alone (exactly the bug the spike hit). A stub `ConvexClient`
 * drives them directly.
 */

import { createConvexBackend } from "@baas/adapter-convex";
import { type Result, type Session, supportsCredentials } from "@baas/core";
import type { ConvexClient } from "convex/browser";
import { describe, expect, it } from "vitest";

type AuthFetcher = (args: { forceRefreshToken: boolean }) => Promise<string | null | undefined>;

/**
 * A stub client capturing what the adapter wires, with a canned `whoami`.
 * `query` invokes the captured fetcher first, the way a real Convex query
 * authenticates itself (which is what caches the token in the adapter).
 */
function stubBackend(whoamiResult: Record<string, unknown> | null) {
  const state: { fetch?: AuthFetcher; queryCalls: number } = { queryCalls: 0 };

  const client = {
    setAuth(fetch: AuthFetcher, _onChange?: (b: boolean) => void) {
      state.fetch = fetch;
    },
    async query() {
      state.queryCalls += 1;
      if (state.fetch) await state.fetch({ forceRefreshToken: false });
      return whoamiResult;
    },
    mutation() {
      return Promise.resolve(null);
    },
  } as unknown as ConvexClient;

  const backend = createConvexBackend({ client, queries: {}, mutations: {} });
  return { auth: backend.auth, state };
}

/** A JWT whose payload carries `exp` (seconds). Signature is irrelevant here. */
function jwtWithExp(expSeconds: number): string {
  return `header.${btoa(JSON.stringify({ exp: expSeconds }))}.sig`;
}

function expectOk<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(`expected ok, got ${r.error.code}: ${r.error.message}`);
  return r.data;
}

describe("ConvexAuth (hermetic)", () => {
  it("does not manage credentials (no CredentialAuth)", () => {
    const { auth } = stubBackend(null);
    expect(auth.capabilities.managesCredentials).toBe(false);
    expect(supportsCredentials(auth)).toBe(false);
  });

  it("getSession returns null without a network round-trip when no token is set", async () => {
    const { auth, state } = stubBackend({ subject: "u1" });
    expect(expectOk(await auth.getSession())).toBeNull();
    expect(state.queryCalls).toBe(0); // short-circuited, no whoami
  });

  it("setToken adapts forceRefreshToken -> forceRefresh and caches the token", async () => {
    const { auth, state } = stubBackend({ subject: "u1" });
    let seenForceRefresh: boolean | undefined;
    auth.setToken(async ({ forceRefresh }) => {
      seenForceRefresh = forceRefresh;
      return "tok-abc";
    });
    // Simulate Convex invoking the wrapped fetcher with ITS arg name.
    const token = await state.fetch?.({ forceRefreshToken: true });
    expect(seenForceRefresh).toBe(true);
    expect(token).toBe("tok-abc");
  });

  it("getSession after auth builds a session with the decoded JWT expiry", async () => {
    const { auth } = stubBackend({ subject: "u1", email: "u@example.test", role: "admin" });
    const exp = 2_000_000_000; // seconds
    auth.setToken(async () => jwtWithExp(exp));

    const session = expectOk(await auth.getSession());
    expect(session?.identity.subject).toBe("u1");
    expect(session?.identity.email).toBe("u@example.test");
    expect(session?.identity.claims).toMatchObject({ role: "admin" });
    expect(session?.token).toBe(jwtWithExp(exp));
    expect(session?.expiresAt).toBe(exp * 1000);
  });

  it("getSession does a round-trip once a fetcher is set (no stale-null short-circuit)", async () => {
    const { auth, state } = stubBackend({ subject: "u1" });
    auth.setToken(async () => "tok");
    expectOk(await auth.getSession());
    expect(state.queryCalls).toBeGreaterThanOrEqual(1);
  });

  it("clearToken returns to the no-round-trip unauthenticated state", async () => {
    const { auth, state } = stubBackend({ subject: "u1" });
    auth.setToken(async () => "tok");
    auth.clearToken();
    expect(expectOk(await auth.getSession())).toBeNull();
    expect(state.queryCalls).toBe(0);
  });

  it("getIdentity maps subject/email and keeps the remaining claims", async () => {
    const { auth } = stubBackend({
      subject: "u9",
      issuer: "https://issuer.test",
      email: "e@example.test",
      org: "acme",
    });
    const identity = expectOk(await auth.getIdentity());
    expect(identity).toMatchObject({
      subject: "u9",
      issuer: "https://issuer.test",
      email: "e@example.test",
    });
    expect(identity?.claims).toMatchObject({ org: "acme" });
    // Mapped-out fields must not leak back into claims.
    expect(identity?.claims).not.toHaveProperty("subject");
  });

  it("omits expiresAt for an opaque (non-JWT) token", async () => {
    const { auth } = stubBackend({ subject: "u1" });
    auth.setToken(async () => "opaque-not-a-jwt");
    const session: Session | null = expectOk(await auth.getSession());
    expect(session?.token).toBe("opaque-not-a-jwt");
    expect(session?.expiresAt).toBeUndefined();
  });
});
