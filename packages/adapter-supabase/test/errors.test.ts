/**
 * Unit test for the Supabase error taxonomy: each PostgREST/GoTrue/Storage error
 * shape maps to the portable `ErrorCode` the contract requires, so a caller can
 * branch on `error.code` the same way it would against Convex or the in-memory
 * adapter. The live conformance suite proves the round-trip behaviors (not_found
 * on a removed row, conflict on a duplicate signup); this pins the mapping table
 * for the SQLSTATE codes those behaviors don't provoke (notably 42501, the RLS
 * denial that previously fell through to `unknown`).
 */

import type { ErrorCode } from "@baas/core";
import { describe, expect, it } from "vitest";
import { toBackendError } from "../src/errors.js";

describe("toBackendError (Supabase taxonomy)", () => {
  const cases: ReadonlyArray<{ name: string; input: unknown; code: ErrorCode }> = [
    {
      name: "PGRST116 (no rows)",
      input: { code: "PGRST116", message: "no rows" },
      code: "not_found",
    },
    {
      name: "42501 (RLS / insufficient_privilege)",
      input: { code: "42501", message: "new row violates row-level security policy" },
      code: "unauthorized",
    },
    { name: "23505 (unique_violation)", input: { code: "23505" }, code: "conflict" },
    { name: "23503 (foreign_key_violation)", input: { code: "23503" }, code: "conflict" },
    { name: "23502 (not_null_violation)", input: { code: "23502" }, code: "validation" },
    { name: "23514 (check_violation)", input: { code: "23514" }, code: "validation" },
    { name: "22P02 (invalid_text_representation)", input: { code: "22P02" }, code: "validation" },
    { name: "HTTP 401", input: { status: 401, message: "unauthorized" }, code: "unauthorized" },
    { name: "HTTP 403", input: { status: 403 }, code: "unauthorized" },
    { name: "HTTP 404", input: { status: 404 }, code: "not_found" },
    { name: "unmapped SQLSTATE", input: { code: "XX000", message: "internal" }, code: "unknown" },
    { name: "plain string", input: "boom", code: "unknown" },
    { name: "null", input: null, code: "unknown" },
  ];

  for (const c of cases) {
    it(`maps ${c.name} -> ${c.code}`, () => {
      expect(toBackendError(c.input).code).toBe(c.code);
    });
  }

  it("preserves the original message and carries the cause", () => {
    const input = { code: "42501", message: "RLS denied" };
    const out = toBackendError(input);
    expect(out.message).toBe("RLS denied");
    expect(out.cause).toBe(input);
  });

  it("falls back to a stringified message when none is present", () => {
    expect(toBackendError("raw failure").message).toBe("raw failure");
  });

  it("lets a mapped SQLSTATE code win over a conflicting HTTP status", () => {
    // A PostgREST RLS denial carries both code 42501 AND status 403; a not-found
    // could in principle carry a different status. The code is the more specific
    // signal, so the table is consulted before status. Pin that precedence so the
    // extraction's table-then-status order can't silently regress to status-first.
    expect(toBackendError({ code: "PGRST116", status: 403 }).code).toBe("not_found");
    expect(toBackendError({ code: "23505", status: 200 }).code).toBe("conflict");
    // An UNMAPPED code still falls through to the status classification.
    expect(toBackendError({ code: "XX000", status: 403 }).code).toBe("unauthorized");
  });
});
