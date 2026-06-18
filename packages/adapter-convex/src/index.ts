/**
 * `@baas/adapter-convex`, the Convex adapter (client side).
 *
 * Assembles the `Backend` from a `ConvexClient`:
 *  - `ConvexDocumentStore` (named ops via configured FunctionReferences; direct
 *    CRUD + subscriptions via the deployed `./convex` helpers)
 *  - `ConvexAuth` (verify-only; `managesCredentials: false`)
 *  - `ConvexFileStore` (the upload-URL-then-POST dance)
 *
 * The deployed helpers (`insert`/`get`/`list`/`patch`/`remove`/`whoami`/
 * `generateUploadUrl`/`getFileUrl`/`deleteFile`) live under one module in the
 * app's `convex/` dir, `baas` by default, and are dispatched dynamically via
 * `anyApi`. See the `./convex` entry and the package README for setup.
 */

import type { Adapter, AnySchema, Backend, Capabilities, StoreSchema } from "@baas/core";
import { ConvexClient } from "convex/browser";
import { anyApi, type FunctionReference } from "convex/server";
import { ConvexAuth, type WhoamiRef } from "./auth.js";
import { ConvexDocumentStore, type HelperRefs, type NamedOps } from "./document-store.js";
import { ConvexFileStore, type StorageRefs } from "./file-store.js";

export interface ConvexConfig<S extends StoreSchema = AnySchema> {
  /** A ready client, or a `url` to construct one. */
  readonly client?: ConvexClient;
  readonly url?: string;
  /** Module the helpers were re-exported under in the app's `convex/` dir. Default `"baas"`. */
  readonly helpersModule?: string;
  readonly queries: { readonly [K in keyof S["queries"]]: FunctionReference<"query"> };
  readonly mutations: { readonly [K in keyof S["mutations"]]: FunctionReference<"mutation"> };
  readonly capabilities?: Partial<Capabilities>;
}

const CONVEX_CAPABILITIES: Capabilities = {
  multiDocumentTransactions: true, // every mutation is a transaction; a throw rolls it back
  reactiveQueries: true, // native onUpdate
  serverSideJoins: false, // follow refs manually (or native())
  aggregations: false, // via native()
  efficientFilterRequiresIndex: true, // .filter() without .withIndex() is a scan
  managesCredentials: false, // verifies an external JWT; runs no sign-in flows
  fileStorage: true,
};

/** The deployed helper module, resolved dynamically and typed for dispatch. */
type HelperModule = HelperRefs & StorageRefs & { readonly whoami: WhoamiRef };

function resolveClient(config: { client?: ConvexClient; url?: string }): ConvexClient {
  if (config.client) return config.client;
  if (!config.url) throw new Error("ConvexConfig requires either `client` or `url`.");
  return new ConvexClient(config.url);
}

export function createConvexBackend<S extends StoreSchema = AnySchema>(
  config: ConvexConfig<S>,
): Backend<S> {
  const client = resolveClient(config);
  const capabilities: Capabilities = { ...CONVEX_CAPABILITIES, ...config.capabilities };
  const moduleName = config.helpersModule ?? "baas";
  const helperModule = anyApi[moduleName] as unknown as HelperModule;
  const ops: NamedOps<S> = { queries: config.queries, mutations: config.mutations };
  return {
    capabilities,
    store: new ConvexDocumentStore<S>(client, ops, helperModule, capabilities),
    auth: new ConvexAuth(client, helperModule.whoami),
    files: new ConvexFileStore(client, helperModule, capabilities.fileStorage),
  };
}

/** `Adapter`-typed entry point for symmetry with the other adapters. */
export const convexAdapter: Adapter<ConvexConfig> = (config) => createConvexBackend(config);
