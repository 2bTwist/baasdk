import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Phase 3: the pluggable identity provider seam. The SDK auth port is
 * IdP-agnostic; Marquee picks ONE OIDC issuer that both data backends verify, so
 * identity (`sub`) is consistent across backends (Phase 5 migration stays
 * coherent). This interface is the swap point: today it is Supabase Auth, but a
 * `ClerkIdentityProvider` / `Auth0IdentityProvider` could drop in without the data
 * backends caring. That is what keeps Convex from being Supabase-locked: it
 * verifies whatever issuer this provider represents.
 *
 * The provider only deals in credentials + the issued token. Wiring the token to
 * the active data backend (Supabase signs in via its own CredentialAuth; Convex
 * verifies the token via setToken) lives in `auth.tsx`, because the Supabase
 * adapter's setToken is a no-op (it authenticates by seating a session, not a
 * bearer token).
 */
export interface IdentityResult {
  readonly ok: boolean;
  readonly message?: string;
}

export interface IdentityProvider {
  signUp(email: string, password: string): Promise<IdentityResult>;
  signIn(email: string, password: string): Promise<IdentityResult>;
  signOut(): Promise<void>;
  /** The current access token (JWT), or null when signed out. */
  getToken(): Promise<string | null>;
  /** The current session tokens, used to seat a session on a data backend. */
  getSession(): Promise<{ readonly accessToken: string; readonly refreshToken: string } | null>;
  /** The signed-in user's email, or null. */
  email(): Promise<string | null>;
  /** Fires on any auth state change; returns an unsubscribe. */
  onChange(callback: () => void): () => void;
  /** The underlying client, for advanced use (e.g. seating a session). */
  native(): SupabaseClient;
}

/** The default issuer: Supabase Auth. */
export function createSupabaseIdentityProvider(url: string, anonKey: string): IdentityProvider {
  // A distinct storageKey isolates the issuer's session from the Supabase DATA
  // backend's client (same URL would otherwise share one localStorage slot and
  // the two would stomp each other's session).
  const client = createClient(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: "marquee-idp" },
  });

  return {
    async signUp(email, password) {
      const { error } = await client.auth.signUp({ email, password });
      return error ? { ok: false, message: error.message } : { ok: true };
    },
    async signIn(email, password) {
      const { error } = await client.auth.signInWithPassword({ email, password });
      return error ? { ok: false, message: error.message } : { ok: true };
    },
    async signOut() {
      await client.auth.signOut();
    },
    async getToken() {
      const { data } = await client.auth.getSession();
      return data.session?.access_token ?? null;
    },
    async getSession() {
      const { data } = await client.auth.getSession();
      if (!data.session) return null;
      return {
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
      };
    },
    async email() {
      const { data } = await client.auth.getSession();
      return data.session?.user.email ?? null;
    },
    onChange(callback) {
      const { data } = client.auth.onAuthStateChange(() => callback());
      return () => data.subscription.unsubscribe();
    },
    native() {
      return client;
    },
  };
}
