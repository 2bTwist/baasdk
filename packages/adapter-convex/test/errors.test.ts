/**
 * Unit test for the Convex error taxonomy. Convex's reliable channel is
 * `ConvexError.data.code` (the one payload Convex does not scrub in production),
 * so the mapper trusts a known code there and best-effort-classifies everything
 * else by message. This pins that table so it stays consistent with the Supabase
 * and in-memory adapters' codes for the same conditions.
 */

import type { ErrorCode } from "@baas/core";
import { ConvexError } from "convex/values";
import { describe, expect, it } from "vitest";
import { toBackendError } from "../src/errors.js";

describe("toBackendError (Convex taxonomy)", () => {
  it("trusts a known ErrorCode in ConvexError.data.code", () => {
    const codes: ErrorCode[] = ["not_found", "unauthorized", "conflict", "validation"];
    for (const code of codes) {
      const out = toBackendError(new ConvexError({ code, message: "x" }));
      expect(out.code).toBe(code);
    }
  });

  it("falls back to unknown for a ConvexError without a recognized code", () => {
    expect(toBackendError(new ConvexError({ message: "no code" })).code).toBe("unknown");
    expect(toBackendError(new ConvexError("plain string payload")).code).toBe("unknown");
    expect(toBackendError(new ConvexError({ code: "not-a-real-code" })).code).toBe("unknown");
  });

  it("classifies a client-side transport failure as network", () => {
    expect(toBackendError(new Error("fetch failed")).code).toBe("network");
    expect(toBackendError(new Error("WebSocket connection closed")).code).toBe("network");
    expect(toBackendError(new Error("ECONNREFUSED 127.0.0.1:3210")).code).toBe("network");
  });

  it("classifies an auth-shaped message as unauthorized", () => {
    expect(toBackendError(new Error("Unauthenticated request")).code).toBe("unauthorized");
    expect(toBackendError(new Error("not authorized")).code).toBe("unauthorized");
    expect(toBackendError(new Error("invalid token")).code).toBe("unauthorized");
  });

  it("falls back to unknown for an unclassifiable plain error", () => {
    expect(toBackendError(new Error("something odd happened")).code).toBe("unknown");
    expect(toBackendError("raw string").code).toBe("unknown");
  });

  it("preserves the message and carries the cause", () => {
    const e = new ConvexError({ code: "conflict", message: "dup" });
    const out = toBackendError(e);
    expect(out.message).toBe(e.message);
    expect(out.cause).toBe(e);
  });
});
