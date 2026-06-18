/**
 * `ConvexAuth`, the narrow AuthProvider port over a `ConvexClient`.
 *
 * Vanilla Convex VERIFIES an external JWT; it runs no sign-in flows, so
 * `managesCredentials: false` and there is no `CredentialAuth`. The pieces:
 *  - `setToken`: wires the core `TokenFetcher` into `client.setAuth`, adapting
 *    Convex's `forceRefreshToken` arg, and caches the last token for `getSession`.
 *  - `getIdentity`: a `whoami` query returning `ctx.auth.getUserIdentity()`.
 *  - `getSession`: the cached token + identity + the JWT `exp`; null when no
 *    token is set (no network round-trip in the unauthenticated case).
 *  - `onAuthStateChange`: driven by `setAuth`'s `onChange`, with the current
 *    state delivered once on subscribe.
 */

import {
  type AuthProvider,
  type Capabilities,
  err,
  type Identity,
  ok,
  type Result,
  type Session,
  type TokenFetcher,
  type Unsubscribe,
} from "@baas/core";
import type { ConvexClient } from "convex/browser";
import type { FunctionReference } from "convex/server";
import { toBackendError } from "./errors.js";

interface ConvexIdentity {
  readonly subject?: string;
  readonly tokenIdentifier?: string;
  readonly issuer?: string;
  readonly email?: string;
  readonly [claim: string]: unknown;
}

/** Reference to the deployed `whoami` query. */
export type WhoamiRef = FunctionReference<
  "query",
  "public",
  Record<string, never>,
  ConvexIdentity | null
>;

/** Decode a JWT's `exp` (seconds) into Unix ms, or null if unreadable. */
function decodeJwtExp(token: string): number | null {
  const [, payloadB64] = token.split(".");
  if (!payloadB64) return null;
  try {
    const json = atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/"));
    const payload = JSON.parse(json) as { exp?: unknown };
    return typeof payload.exp === "number" ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

export class ConvexAuth implements AuthProvider {
  readonly capabilities: Pick<Capabilities, "managesCredentials">;
  private fetcher: TokenFetcher | null = null;
  private lastToken: string | null = null;
  private readonly listeners = new Set<(session: Session | null) => void>();

  constructor(
    private readonly client: ConvexClient,
    private readonly whoami: WhoamiRef,
  ) {
    this.capabilities = { managesCredentials: false };
  }

  setToken(fetcher: TokenFetcher): void {
    this.fetcher = fetcher;
    this.client.setAuth(
      async (args) => {
        // Convex's arg is `forceRefreshToken`, NOT `forceRefresh` (core's name).
        const token = await fetcher({ forceRefresh: args.forceRefreshToken });
        this.lastToken = token;
        return token ?? undefined;
      },
      (isAuthenticated) => {
        void this.emit(isAuthenticated);
      },
    );
  }

  clearToken(): void {
    this.fetcher = null;
    this.lastToken = null;
    this.client.setAuth(async () => null);
    void this.emit(false);
  }

  async getIdentity(): Promise<Result<Identity | null>> {
    try {
      const who = await this.client.query(this.whoami, {});
      return ok(who ? this.mapIdentity(who) : null);
    } catch (e) {
      return err(toBackendError(e));
    }
  }

  async getSession(): Promise<Result<Session | null>> {
    // No fetcher ever set means genuinely unauthenticated, answerable WITHOUT a
    // round-trip. Once a fetcher IS set we must ask the server: `lastToken` lands
    // only after Convex first invokes the fetcher, so short-circuiting on it would
    // hide a session that is about to exist. The whoami query forces that fetch.
    if (this.fetcher === null) return ok(null);
    const identity = await this.getIdentity();
    if (!identity.ok) return identity;
    // An authenticated whoami means Convex ran the fetcher, so lastToken is set.
    if (!identity.data || this.lastToken === null) return ok(null);
    return ok(this.buildSession(identity.data, this.lastToken));
  }

  onAuthStateChange(callback: (session: Session | null) => void): Unsubscribe {
    this.listeners.add(callback);
    // Deliver the current state once (async), per the contract. KNOWN LIMITATION
    // (tracked as the deferred conformance case "onAuthStateChange ordering"):
    // if a `setAuth` transition fires between adding the listener and this initial
    // delivery, the listener can see the transition first and the initial state
    // late. Harmless for the unauthenticated path; revisit with the ordering case.
    void (async () => {
      const session = await this.getSession();
      callback(session.ok ? session.data : null);
    })();
    return () => {
      this.listeners.delete(callback);
    };
  }

  native(): ConvexClient {
    return this.client;
  }

  private async emit(isAuthenticated: boolean): Promise<void> {
    let session: Session | null = null;
    if (isAuthenticated) {
      const s = await this.getSession();
      session = s.ok ? s.data : null;
    }
    for (const listener of this.listeners) listener(session);
  }

  private mapIdentity(who: ConvexIdentity): Identity {
    const { subject: _s, tokenIdentifier: _t, issuer: _i, email: _e, ...claims } = who;
    return {
      // Convex identities key on `subject`; fall back to `tokenIdentifier`.
      subject: who.subject ?? who.tokenIdentifier ?? "",
      ...(who.issuer ? { issuer: who.issuer } : {}),
      ...(who.email ? { email: who.email } : {}),
      claims,
    };
  }

  private buildSession(identity: Identity, token: string): Session {
    const expiresAt = decodeJwtExp(token);
    return {
      identity,
      token,
      ...(expiresAt !== null ? { expiresAt } : {}),
    };
  }
}
