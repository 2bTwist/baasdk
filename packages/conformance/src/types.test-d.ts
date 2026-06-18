/**
 * Type-level half of the contract — for a type-safe SDK the types are half the
 * contract. A type error here is a test failure under `vitest --typecheck`.
 *
 * These assertions pin the inference guarantees the named-operations model is
 * supposed to deliver: operation names are constrained, args and results are
 * derived from the schema, and capability narrowing works.
 */

import {
  type AuthProvider,
  type Backend,
  type CredentialAuth,
  type DocumentId,
  type Result,
  supportsCredentials,
} from "@baas/core";
import { describe, expectTypeOf, it } from "vitest";
import type { ConformanceSchema, Todo } from "./index.js";

declare const backend: Backend<ConformanceSchema>;

describe("DocumentStore inference", () => {
  it("derives the result type of a named query from the schema", () => {
    expectTypeOf(backend.store.run("listTodos", {})).resolves.toEqualTypeOf<Result<Todo[]>>();
    expectTypeOf(backend.store.run("getTodo", { id: "x" as DocumentId })).resolves.toEqualTypeOf<
      Result<Todo | null>
    >();
  });

  it("derives the args type of a named query from the schema", () => {
    expectTypeOf(backend.store.run<"getTodo">)
      .parameter(1)
      .toEqualTypeOf<{ readonly id: DocumentId }>();
  });

  it("derives the result type of a named mutation from the schema", () => {
    expectTypeOf(backend.store.mutate("addTodo", { title: "x" })).resolves.toEqualTypeOf<
      Result<DocumentId>
    >();
  });

  it("rejects unknown operation names", () => {
    // @ts-expect-error "nope" is not a query in ConformanceSchema
    backend.store.run("nope", {});
    // @ts-expect-error "nope" is not a mutation in ConformanceSchema
    backend.store.mutate("nope", {});
  });

  it("rejects mismatched args for a known operation", () => {
    // @ts-expect-error addTodo expects { title: string }, not { name }
    backend.store.mutate("addTodo", { name: "x" });
  });
});

describe("capability narrowing", () => {
  it("supportsCredentials narrows AuthProvider to CredentialAuth", () => {
    const auth: AuthProvider = backend.auth;
    if (supportsCredentials(auth)) {
      expectTypeOf(auth).toExtend<CredentialAuth>();
      expectTypeOf(auth.signInWithPassword).toBeFunction();
    }
  });
});
