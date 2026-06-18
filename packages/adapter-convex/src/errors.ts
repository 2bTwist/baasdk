/**
 * Normalize anything the Convex client throws into a `BackendError`.
 *
 * The reliable channel is `ConvexError.data`: our deployable helpers and the
 * app's named ops put a stable `{ code }` there, and it is the ONE error payload
 * Convex does not scrub in production (a plain `throw` is replaced with a generic
 * message before it reaches the client). So we trust `.data.code` and only
 * best-effort-classify everything else.
 */

import type { BackendError, ErrorCode } from "@baas/core";
import { ConvexError } from "convex/values";

const ERROR_CODES: ReadonlySet<string> = new Set<ErrorCode>([
  "not_found",
  "unauthorized",
  "conflict",
  "validation",
  "unsupported_capability",
  "network",
  "unknown",
]);

const isErrorCode = (s: unknown): s is ErrorCode => typeof s === "string" && ERROR_CODES.has(s);

export function toBackendError(e: unknown): BackendError {
  if (e instanceof ConvexError) {
    const data: unknown = e.data;
    const code =
      typeof data === "object" && data !== null && "code" in data ? data.code : undefined;
    if (isErrorCode(code)) {
      return { code, message: e.message, cause: e };
    }
    return { code: "unknown", message: e.message, cause: e };
  }

  const message = e instanceof Error ? e.message : String(e);
  // Convex scrubs the text of non-ConvexError SERVER throws, so this only
  // reliably catches CLIENT-side transport failures, not server logic (which
  // speaks through ConvexError above).
  if (
    /\b(network|connection|connect|fetch failed|websocket|econnrefused|etimedout)\b/i.test(message)
  ) {
    return { code: "network", message, cause: e };
  }
  if (/\b(unauthenticated|unauthorized|forbidden|not authorized|invalid token)\b/i.test(message)) {
    return { code: "unauthorized", message, cause: e };
  }
  return { code: "unknown", message, cause: e };
}
