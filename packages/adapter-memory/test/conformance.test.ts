/**
 * Runs the single conformance suite against the in-memory reference adapter,
 * twice, to exercise BOTH sides of every capability gate:
 *
 *  1. Full capabilities — the rich path: transactions roll back, subscriptions
 *     deliver live updates, credentials and file storage work.
 *  2. Minimal capabilities — the SAME adapter code with capabilities downgraded
 *     to false. The suite must then take the negative branch of each gate, and
 *     the adapter must honestly behave that way (no live updates, no rollback).
 *
 * Same suite, same adapter, different declared capabilities: that is the cheap
 * proof that the abstraction's divergence-is-declared contract actually holds.
 */

import { runConformanceSuite } from "@baas/conformance";
import { makeMemoryConformanceBackend } from "./fixture.js";

runConformanceSuite("adapter-memory (full capabilities)", () => makeMemoryConformanceBackend());

runConformanceSuite("adapter-memory (minimal capabilities)", () =>
  makeMemoryConformanceBackend({
    multiDocumentTransactions: false,
    reactiveQueries: false,
    managesCredentials: false,
    fileStorage: false,
  }),
);
