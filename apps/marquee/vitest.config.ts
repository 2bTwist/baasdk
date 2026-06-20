/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

/**
 * The live integration suites (catalog / enrich / security) all drive ONE shared
 * Supabase + Convex database: each resets and seeds its own fixture, then asserts
 * over the whole table (e.g. genreCounts counts every movie). They must therefore
 * run one file at a time, never in parallel, or one file's writes corrupt
 * another's counts. `fileParallelism: false` serializes the files; tests within a
 * file already run sequentially.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    fileParallelism: false,
  },
});
