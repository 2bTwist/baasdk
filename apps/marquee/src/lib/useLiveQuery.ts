import type { Backend, Result, StoreSchema } from "@baas/core";
import { useEffect, useState } from "react";

/**
 * Phase 4: bind a named READ operation to React state via the portable
 * `store.subscribe()`. The SDK contract is the whole point here — `subscribe`
 * ALWAYS delivers once with the current result, then re-delivers on every change
 * IFF `capabilities.reactiveQueries`. So a single hook gives:
 *  - Convex: live (natively reactive).
 *  - Supabase: live once the query declares a `realtime` watch; otherwise the
 *    adapter surfaces an explicit `unsupported_capability` (we render that, never
 *    silently degrade).
 *  - Memory: live in-process (the dev sandbox notifies on every mutation).
 *
 * `refreshKey` lets a caller force an immediate re-subscribe after its OWN write
 * so the same tab updates without waiting on the realtime round-trip; cross-tab
 * updates still arrive through the live subscription. `args` is compared by JSON
 * value (not identity) so an inline object literal does not thrash the effect.
 */
export interface LiveQueryState<T> {
  readonly data: T | null;
  readonly error: string | null;
  readonly loading: boolean;
}

export function useLiveQuery<S extends StoreSchema, K extends keyof S["queries"] & string>(
  backend: Backend<S>,
  operation: K,
  args: S["queries"][K]["args"],
  refreshKey: number = 0,
): LiveQueryState<S["queries"][K]["result"]> {
  type T = S["queries"][K]["result"];
  const [state, setState] = useState<LiveQueryState<T>>({
    data: null,
    error: null,
    loading: true,
  });

  // Serialize args so a fresh-but-equal object literal does not re-subscribe.
  const argsKey = JSON.stringify(args);

  // argsKey is the value-identity of `args` (so an equal object literal does not
  // re-subscribe), and refreshKey forces a deliberate re-subscribe after a local
  // write — both intentional deps that biome's referenced-only heuristic misses.
  // biome-ignore lint/correctness/useExhaustiveDependencies: argsKey/refreshKey drive re-subscription by design.
  useEffect(() => {
    let live = true;
    const unsubscribe = backend.store.subscribe(operation, args, (result: Result<T>) => {
      if (!live) return;
      if (result.ok) {
        setState({ data: result.data, error: null, loading: false });
      } else {
        setState((prev) => ({ data: prev.data, error: result.error.message, loading: false }));
      }
    });
    return () => {
      live = false;
      unsubscribe();
    };
  }, [backend, operation, argsKey, refreshKey]);

  return state;
}
