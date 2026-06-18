/**
 * Runs the ONE app (`app.ts`) against both backends, proving the swap is real.
 *
 *  - The memory path runs everywhere, including the main CI test job, so the
 *    example can't rot.
 *  - The Supabase path runs against a REAL stack in CI (the supabase-conformance
 *    job runs this file with SUPABASE_URL set) and self-skips otherwise, so
 *    `pnpm test` stays green on a machine with no Docker/Supabase. To run it
 *    locally: `cd packages/adapter-supabase && supabase start`, then export
 *    SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from `supabase status`.
 *
 * The point: `seedTodos` / `openTitles` are byte-for-byte the same in both
 * cases. Only the factory passed in changes.
 */

import { expect, test } from "vitest";
import { clearTodos, openTitles, seedTodos } from "./app.js";
import { memoryBackend, supabaseBackend } from "./backends.js";

const TITLES = ["dev against memory", "deploy against supabase"] as const;

test("the app runs unchanged on the in-memory backend", async () => {
  const backend = memoryBackend();
  await seedTodos(backend, TITLES);
  expect(await openTitles(backend)).toEqual([...TITLES]);
});

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAvailable = Boolean(url && key);

test.skipIf(!supabaseAvailable)(
  "the SAME app runs unchanged on a live Supabase stack",
  async () => {
    const backend = supabaseBackend(url as string, key as string);

    // Shares the conformance `todos` table; start and end clean (via the portable
    // API, no raw client) so re-runs and the conformance suite both see it empty.
    await clearTodos(backend);

    await seedTodos(backend, TITLES);
    expect((await openTitles(backend)).sort()).toEqual([...TITLES].sort());

    await clearTodos(backend);
  },
);
