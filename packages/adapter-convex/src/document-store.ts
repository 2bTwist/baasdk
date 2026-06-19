/**
 * `ConvexDocumentStore`, the DocumentStore port over a `ConvexClient`.
 *
 *  - `run`/`mutate`: dispatch to the app's named ops (configured FunctionReferences).
 *  - `subscribe`: `client.onUpdate` (native reactivity), always with an `onError`
 *    so a failing query delivers an `err` Result instead of throwing.
 *  - direct CRUD: dispatch to the deployed generic helpers (the `./convex` entry),
 *    which already normalize missing/foreign ids (idempotent remove, not_found
 *    patch, null get).
 */

import {
  type Capabilities,
  type Cursor,
  type DocumentId,
  type DocumentStore,
  err,
  type ListOptions,
  type ListPage,
  ok,
  type Result,
  type StoreSchema,
  type Unsubscribe,
} from "@baas/core";
import type { ConvexClient } from "convex/browser";
import type { FunctionReference } from "convex/server";
import { toBackendError } from "./errors.js";

type QueryName<S extends StoreSchema> = keyof S["queries"] & string;
type MutationName<S extends StoreSchema> = keyof S["mutations"] & string;

/** Typed references to the deployed generic CRUD helpers (the `./convex` entry). */
export interface HelperRefs {
  readonly insert: FunctionReference<
    "mutation",
    "public",
    { collection: string; value: unknown },
    string
  >;
  readonly get: FunctionReference<"query", "public", { collection: string; id: string }, unknown>;
  readonly list: FunctionReference<
    "query",
    "public",
    {
      collection: string;
      where?: ReadonlyArray<{
        field: string;
        op: string;
        value: string | number | boolean | null | ReadonlyArray<string | number | boolean | null>;
      }>;
      order?: { field: string | null; dir: string };
      paginationOpts?: { numItems: number; cursor: string | null };
    },
    { page: unknown[]; isDone: boolean; continueCursor: string }
  >;
  readonly patch: FunctionReference<
    "mutation",
    "public",
    { collection: string; id: string; value: unknown },
    null
  >;
  readonly remove: FunctionReference<
    "mutation",
    "public",
    { collection: string; id: string },
    null
  >;
}

/** The app's named read/write ops, mapped to deployed function references. */
export interface NamedOps<S extends StoreSchema> {
  readonly queries: { readonly [K in QueryName<S>]: FunctionReference<"query"> };
  readonly mutations: { readonly [K in MutationName<S>]: FunctionReference<"mutation"> };
}

export class ConvexDocumentStore<S extends StoreSchema> implements DocumentStore<S> {
  constructor(
    private readonly client: ConvexClient,
    private readonly ops: NamedOps<S>,
    private readonly helpers: HelperRefs,
    readonly capabilities: Capabilities,
  ) {}

  async run<K extends QueryName<S>>(
    operation: K,
    args: S["queries"][K]["args"],
  ): Promise<Result<S["queries"][K]["result"]>> {
    const fn = this.ops.queries[operation];
    if (!fn) return err({ code: "not_found", message: `unknown query "${operation}"` });
    try {
      const data = (await this.client.query(fn, args)) as S["queries"][K]["result"];
      return ok(data);
    } catch (e) {
      return err(toBackendError(e));
    }
  }

  subscribe<K extends QueryName<S>>(
    operation: K,
    args: S["queries"][K]["args"],
    onChange: (result: Result<S["queries"][K]["result"]>) => void,
  ): Unsubscribe {
    const fn = this.ops.queries[operation];
    if (!fn) {
      // Honor the always-one-delivery contract even for a bad op name, async.
      queueMicrotask(() => {
        onChange(err({ code: "not_found", message: `unknown query "${operation}"` }));
      });
      return () => {};
    }
    // onError is REQUIRED: without it Convex throws on a query error instead of
    // delivering it, which would break "onChange always receives a Result".
    const unsubscribe = this.client.onUpdate(
      fn,
      args,
      (data) => {
        onChange(ok(data as S["queries"][K]["result"]));
      },
      (e) => {
        onChange(err(toBackendError(e)));
      },
    );
    return () => {
      unsubscribe();
    };
  }

  async mutate<K extends MutationName<S>>(
    operation: K,
    args: S["mutations"][K]["args"],
  ): Promise<Result<S["mutations"][K]["result"]>> {
    const fn = this.ops.mutations[operation];
    if (!fn) return err({ code: "not_found", message: `unknown mutation "${operation}"` });
    try {
      const data = (await this.client.mutation(fn, args)) as S["mutations"][K]["result"];
      return ok(data);
    } catch (e) {
      return err(toBackendError(e));
    }
  }

  async get<T = unknown>(collection: string, id: DocumentId): Promise<Result<T | null>> {
    try {
      const doc = (await this.client.query(this.helpers.get, { collection, id })) as T | null;
      return ok(doc ?? null);
    } catch (e) {
      return err(toBackendError(e));
    }
  }

  async list<T = unknown>(collection: string, opts?: ListOptions): Promise<Result<ListPage<T>>> {
    try {
      const limit = Math.min(Math.max(opts?.limit ?? 50, 1), 200);
      // Serialize the portable [field, op, value] tuples into the helper's objects.
      const where = (opts?.where ?? []).map(([field, op, value]) => ({ field, op, value }));
      // Serialize the order into { field, dir }: a field (indexed on Convex) or
      // creation order (field null).
      const order = opts?.order;
      const orderArg =
        typeof order === "object" && order !== null
          ? { field: order.field, dir: order.direction ?? "asc" }
          : { field: null, dir: order ?? "asc" };
      const result = await this.client.query(this.helpers.list, {
        collection,
        where,
        order: orderArg,
        paginationOpts: { numItems: limit, cursor: opts?.cursor ?? null },
      });
      // Convex docs already carry `_id`; no normalization needed.
      const items = result.page as T[];
      const nextCursor = result.isDone ? null : (result.continueCursor as Cursor);
      return ok({ items, nextCursor });
    } catch (e) {
      return err(toBackendError(e));
    }
  }

  async insert<T = Record<string, unknown>>(
    collection: string,
    value: T,
  ): Promise<Result<DocumentId>> {
    try {
      const id = await this.client.mutation(this.helpers.insert, { collection, value });
      return ok(id as DocumentId);
    } catch (e) {
      return err(toBackendError(e));
    }
  }

  async patch<T = Record<string, unknown>>(
    collection: string,
    id: DocumentId,
    value: Partial<T>,
  ): Promise<Result<void>> {
    try {
      await this.client.mutation(this.helpers.patch, { collection, id, value });
      return ok(undefined);
    } catch (e) {
      return err(toBackendError(e));
    }
  }

  async remove(collection: string, id: DocumentId): Promise<Result<void>> {
    try {
      await this.client.mutation(this.helpers.remove, { collection, id });
      return ok(undefined);
    } catch (e) {
      return err(toBackendError(e));
    }
  }

  native(): ConvexClient {
    return this.client;
  }
}
