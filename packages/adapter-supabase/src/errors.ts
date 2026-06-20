/**
 * Normalize a PostgREST / GoTrue / Storage error into a portable `BackendError`.
 *
 * The taxonomy is the executable contract every adapter shares: the SAME
 * condition must map to the SAME `ErrorCode` across Supabase, Convex, and the
 * in-memory reference, so callers can branch on `error.code` portably. PostgREST
 * surfaces the underlying Postgres `SQLSTATE` as `error.code`; GoTrue/Storage use
 * an HTTP `status`. We classify both, and fall back to `unknown` only for codes
 * with no portable meaning (so the original is never lost — `cause` carries it).
 *
 * SQLSTATE references: 42501 insufficient_privilege (an RLS denial reaches the
 * client as this), 23505 unique_violation, 23503 foreign_key_violation, 23502
 * not_null_violation, 23514 check_violation, 22P02 invalid_text_representation
 * (a malformed literal, e.g. a non-uuid passed to a uuid column). PGRST116 is
 * PostgREST's "no rows where exactly one was expected".
 */

import type { BackendError, ErrorCode } from "@baas/core";

/** Postgres SQLSTATE / PostgREST code -> portable ErrorCode. */
const CODE_BY_SQLSTATE: Readonly<Record<string, ErrorCode>> = {
  PGRST116: "not_found", // no rows where one expected
  "42501": "unauthorized", // insufficient_privilege — RLS denied the operation
  "23505": "conflict", // unique_violation
  "23503": "conflict", // foreign_key_violation — a referential conflict
  "23502": "validation", // not_null_violation — caller omitted a required column
  "23514": "validation", // check_violation — caller's value failed a constraint
  "22P02": "validation", // invalid_text_representation — malformed literal
};

export const toBackendError = (e: unknown): BackendError => {
  const x = e as { message?: string; code?: string; status?: number } | null;
  let code: ErrorCode = "unknown";
  const bySqlState = x?.code !== undefined ? CODE_BY_SQLSTATE[x.code] : undefined;
  if (bySqlState !== undefined) code = bySqlState;
  else if (x?.status === 401 || x?.status === 403) code = "unauthorized";
  else if (x?.status === 404) code = "not_found";
  return { code, message: x?.message ?? String(e), cause: e };
};
