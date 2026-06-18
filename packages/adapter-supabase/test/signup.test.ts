/**
 * Hermetic unit tests for signUp duplicate detection. The live conformance
 * stack runs with email confirmation OFF, so it only exercises the
 * `user_already_exists` error path; the enumeration-protection obfuscated path
 * (confirmation ON) has no live coverage and is pinned here with a stub client.
 */

import { createSupabaseBackend } from "@baas/adapter-supabase";
import { supportsCredentials } from "@baas/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

/** Build a backend whose only stubbed client method is `auth.signUp`. */
function authWithSignUp(signUp: () => Promise<unknown>) {
  const client = { auth: { signUp } } as unknown as SupabaseClient;
  const backend = createSupabaseBackend({ client, queries: {}, mutations: {} });
  if (!supportsCredentials(backend.auth)) throw new Error("expected credential auth");
  return backend.auth;
}

describe("Supabase signUp duplicate detection", () => {
  it("maps the user_already_exists error (confirmation OFF) to conflict", async () => {
    const auth = authWithSignUp(async () => ({
      data: { user: null, session: null },
      error: {
        name: "AuthApiError",
        message: "User already registered",
        status: 422,
        code: "user_already_exists",
      },
    }));
    expect(await auth.signUp("a@example.com", "pw")).toMatchObject({
      ok: false,
      error: { code: "conflict" },
    });
  });

  it("maps the obfuscated duplicate (empty identities, no session) to conflict", async () => {
    const auth = authWithSignUp(async () => ({
      data: { user: { id: "u1", email: "a@example.com", identities: [] }, session: null },
      error: null,
    }));
    expect(await auth.signUp("a@example.com", "pw")).toMatchObject({
      ok: false,
      error: { code: "conflict" },
    });
  });

  it("does NOT misclassify a genuine confirmation-pending signup (one identity, no session)", async () => {
    const auth = authWithSignUp(async () => ({
      data: {
        user: { id: "u2", email: "new@example.com", identities: [{ identity_id: "i1" }] },
        session: null,
      },
      error: null,
    }));
    // No session yet (awaiting confirmation), but it is a real new user: ok(null).
    expect(await auth.signUp("new@example.com", "pw")).toMatchObject({ ok: true, data: null });
  });
});
