/**
 * Phase 4 files gate (the acceptance bar): a poster uploaded through the portable
 * file port round-trips on BOTH backends. The SAME four calls — upload, getUrl,
 * download, remove — work over Supabase Storage (a `bucket::path` handle) and
 * Convex storage (a storage-id handle); the adapter hides the divergence. After
 * removal the handle no longer resolves.
 *
 * Self-skips without env. Run (serially — see vitest.config.ts):
 *   SUPABASE_URL=... SUPABASE_KEY=<anon> CONVEX_URL=... pnpm --filter marquee test
 */
import { createConvexBackend } from "@baas/adapter-convex";
import { createSupabaseBackend } from "@baas/adapter-supabase";
import { type Backend, supportsCredentials } from "@baas/core";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { convexQueries, supabaseQueries } from "../src/lib/enrich";
import {
  convexRatingQuery,
  convexReviewMutations,
  supabaseRatingQuery,
  supabaseReviewMutations,
} from "../src/lib/reviews";
import type { MarqueeSchema } from "../src/lib/schema";

const sbUrl = process.env.SUPABASE_URL;
const sbKey = process.env.SUPABASE_KEY;
const cxUrl = process.env.CONVEX_URL;
const ready = Boolean(sbUrl && sbKey && cxUrl);

const newSupabase = (): Backend<MarqueeSchema> =>
  createSupabaseBackend<MarqueeSchema>({
    url: sbUrl as string,
    key: sbKey as string,
    bucket: "posters",
    queries: { ...supabaseQueries, movieRating: supabaseRatingQuery },
    mutations: supabaseReviewMutations,
  });

const newConvex = (): Backend<MarqueeSchema> =>
  createConvexBackend<MarqueeSchema>({
    url: cxUrl as string,
    queries: { ...convexQueries, movieRating: convexRatingQuery },
    mutations: convexReviewMutations,
  });

// A tiny valid PNG (1x1, transparent) so content types are honest.
const PNG_BYTES = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

type Creds = { email: string; password: string };
const USER_A: Creds = { email: "member.a@marquee.test", password: "password123" };

async function ensureUser(): Promise<void> {
  const c = createClient(sbUrl as string, sbKey as string);
  await c.auth.signUp(USER_A).catch(() => undefined);
}

interface Target {
  readonly name: string;
  /** A backend ready to write to Storage. Supabase signs in (posters_insert is
   *  authenticated-only); Convex's file helpers are open, so no auth is needed. */
  readonly backend: () => Promise<Backend<MarqueeSchema>>;
}

const TARGETS: readonly Target[] = [
  {
    name: "supabase",
    backend: async () => {
      await ensureUser();
      const b = newSupabase();
      if (!supportsCredentials(b.auth)) throw new Error("supabase should manage credentials");
      const r = await b.auth.signInWithPassword(USER_A.email, USER_A.password);
      if (!r.ok) throw new Error(`supabase sign-in: ${r.error.message}`);
      return b;
    },
  },
  { name: "convex", backend: async () => newConvex() },
];

const maybe = ready ? describe : describe.skip;

maybe.each(TARGETS)("file port on $name", ({ backend }) => {
  it("declares fileStorage", async () => {
    expect((await backend()).files.capabilities.fileStorage).toBe(true);
  });

  it("uploads, resolves a URL, downloads identical bytes, then removes", async () => {
    const b = await backend();
    const blob = new Blob([PNG_BYTES], { type: "image/png" });

    const uploaded = await b.files.upload(blob, {
      path: `test-poster-${Math.random().toString(36).slice(2, 10)}`,
      contentType: "image/png",
    });
    expect(uploaded.ok).toBe(true);
    if (!uploaded.ok) return;
    const handle = uploaded.data;

    const url = await b.files.getUrl(handle);
    expect(url.ok).toBe(true);
    if (url.ok) expect(typeof url.data).toBe("string");

    const downloaded = await b.files.download(handle);
    expect(downloaded.ok).toBe(true);
    if (downloaded.ok) {
      const bytes = new Uint8Array(await downloaded.data.arrayBuffer());
      expect(bytes.length).toBe(PNG_BYTES.length);
      expect(Array.from(bytes)).toEqual(Array.from(PNG_BYTES));
    }

    const removed = await b.files.remove(handle);
    expect(removed.ok).toBe(true);

    // After removal the handle no longer resolves to a usable file.
    const afterUrl = await b.files.getUrl(handle);
    const gone = !afterUrl.ok || afterUrl.data === null;
    const afterDownload = await b.files.download(handle);
    expect(gone || !afterDownload.ok).toBe(true);
  }, 30_000);
});
