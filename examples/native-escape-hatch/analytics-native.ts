/**
 * The SAME count, done SERVER-SIDE on Supabase through `native()`.
 *
 * This is what the escape hatch is for, and how to use it with restraint:
 *
 *  - It exists because the count is genuinely OUTSIDE the portable contract.
 *    Counting portably means listing every row and counting client-side (see
 *    `countDone`); the core surface has no aggregate primitive on purpose. So
 *    `aggregations` is a declared capability, reached only via `native()`.
 *  - It checks that declared capability FIRST, rather than assuming the backend
 *    can do it. Honest divergence, not a runtime surprise.
 *  - `native()` is provider-specific, so this function is explicitly for a
 *    Supabase-backed `Backend`: you reach for the typed client because you KNOW
 *    your provider, having chosen its adapter. The Supabase adapter types
 *    `native()` as a `SupabaseClient`.
 *  - It is ONE small function in its own file. Everything else in the app stays
 *    on the portable surface. That ratio is the whole point: `native()` is a
 *    scalpel for the genuinely-excluded case, not a way of life.
 */

import type { Backend } from "@baas/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TodoSchema } from "./analytics.js";

export async function countDoneServerSide(backend: Backend<TodoSchema>): Promise<number> {
  // Portable precondition: only attempt this on a backend that DECLARES
  // server-side aggregation. On others (memory, vanilla Convex) use countDone.
  if (!backend.capabilities.aggregations) {
    throw new Error("backend does not declare `aggregations`; use the portable countDone instead");
  }

  // `native()` is typed `unknown` by the contract, and the capability flag above
  // says "supports aggregation," NOT "is Supabase." So verify the shape before
  // trusting the cast, rather than crashing obscurely if handed another provider
  // (or a memory backend with an `aggregations` override). Honest divergence is
  // the whole point of this example; that discipline applies to `native()` too.
  const client = backend.store.native();
  if (!isSupabaseClient(client)) {
    throw new Error(
      "countDoneServerSide requires a Supabase-backed Backend (native() is not a SupabaseClient)",
    );
  }

  // `head: true` asks Postgres for the count only, transferring no rows; this is
  // the win the portable list-and-count path cannot express.
  const { count, error } = await client
    .from("todos")
    .select("*", { count: "exact", head: true })
    .eq("done", true);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/** A minimal runtime check that `native()` really handed us a Supabase client. */
function isSupabaseClient(client: unknown): client is SupabaseClient {
  return (
    typeof client === "object" &&
    client !== null &&
    typeof (client as { from?: unknown }).from === "function"
  );
}
