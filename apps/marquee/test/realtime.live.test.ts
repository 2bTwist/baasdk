/**
 * Phase 4 realtime gate (the acceptance bar): a review written by one client is
 * delivered LIVE to a separate subscriber, on BOTH backends. The subscriber is
 * the portable `store.subscribe("movieReviews", …)`; the writer is a second,
 * authenticated backend. This proves the reactive named-query seam end to end —
 * natively on Convex, and through Supabase Realtime (the `reviews` table in the
 * publication, replica identity full) on Supabase.
 *
 * Self-skips without env. Run (serially — see vitest.config.ts):
 *   SUPABASE_URL=... SUPABASE_KEY=<anon> CONVEX_URL=... pnpm --filter marquee test
 */
import { createConvexBackend } from "@baas/adapter-convex";
import { createSupabaseBackend } from "@baas/adapter-supabase";
import { type Backend, type Result, supportsCredentials } from "@baas/core";
import { createClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { convexQueries, supabaseQueries } from "../src/lib/enrich";
import {
  addReview,
  convexRatingQuery,
  convexReviewMutations,
  convexReviewsQuery,
  deleteReview,
  supabaseRatingQuery,
  supabaseReviewMutations,
  supabaseReviewsQuery,
} from "../src/lib/reviews";
import type { MarqueeSchema, ReviewRow } from "../src/lib/schema";

const sbUrl = process.env.SUPABASE_URL;
const sbKey = process.env.SUPABASE_KEY; // anon
const cxUrl = process.env.CONVEX_URL;
const ready = Boolean(sbUrl && sbKey && cxUrl);

type Creds = { email: string; password: string };
const USER_A: Creds = { email: "member.a@marquee.test", password: "password123" };

const newSupabase = (): Backend<MarqueeSchema> =>
  createSupabaseBackend<MarqueeSchema>({
    url: sbUrl as string,
    key: sbKey as string,
    queries: {
      ...supabaseQueries,
      movieRating: supabaseRatingQuery,
      movieReviews: supabaseReviewsQuery,
    },
    mutations: supabaseReviewMutations,
    realtime: {
      movieRating: { tables: ["reviews"] },
      movieReviews: { tables: ["reviews"] },
    },
  });

const newConvex = (): Backend<MarqueeSchema> =>
  createConvexBackend<MarqueeSchema>({
    url: cxUrl as string,
    queries: { ...convexQueries, movieRating: convexRatingQuery, movieReviews: convexReviewsQuery },
    mutations: convexReviewMutations,
  });

async function ensureUser(user: Creds): Promise<void> {
  const c = createClient(sbUrl as string, sbKey as string);
  await c.auth.signUp(user).catch(() => undefined);
}

async function tokenFor(user: Creds): Promise<string> {
  const c = createClient(sbUrl as string, sbKey as string);
  const { data, error } = await c.auth.signInWithPassword(user);
  if (error || !data.session) throw new Error(`sign-in ${user.email}: ${error?.message}`);
  return data.session.access_token;
}

/** Collects subscription deliveries and resolves the first that matches a predicate. */
function collector<T>() {
  const seen: T[] = [];
  let waiting: {
    match: (r: T) => boolean;
    resolve: () => void;
    reject: (e: Error) => void;
  } | null = null;
  return {
    push(value: T): void {
      seen.push(value);
      if (waiting?.match(value)) {
        waiting.resolve();
        waiting = null;
      }
    },
    waitFor(match: (r: T) => boolean, ms: number): Promise<void> {
      if (seen.some(match)) return Promise.resolve();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          waiting = null;
          reject(new Error(`no matching delivery within ${ms}ms`));
        }, ms);
        waiting = {
          match,
          resolve: () => {
            clearTimeout(timer);
            resolve();
          },
          reject,
        };
      });
    },
  };
}

interface Target {
  readonly name: string;
  readonly reader: () => Backend<MarqueeSchema>;
  readonly authed: () => Promise<Backend<MarqueeSchema>>;
}

const TARGETS: readonly Target[] = [
  {
    name: "supabase",
    reader: newSupabase,
    authed: async () => {
      const b = newSupabase();
      if (!supportsCredentials(b.auth)) throw new Error("supabase should manage credentials");
      const r = await b.auth.signInWithPassword(USER_A.email, USER_A.password);
      if (!r.ok) throw new Error(`supabase sign-in: ${r.error.message}`);
      return b;
    },
  },
  {
    name: "convex",
    reader: newConvex,
    authed: async () => {
      const token = await tokenFor(USER_A);
      const b = newConvex();
      b.auth.setToken(async () => token);
      return b;
    },
  },
];

const maybe = ready ? describe : describe.skip;

maybe.each(TARGETS)("live reviews on $name", ({ name, reader, authed }) => {
  let writer: Backend<MarqueeSchema>;
  let read: Backend<MarqueeSchema>;
  let movieId: string;

  beforeAll(async () => {
    await ensureUser(USER_A);
    writer = await authed();
    read = reader();
    const ins = await read.store.insert("movies", {
      title: `Live ${name}`,
      year: 2021,
      primaryGenre: "drama",
    });
    if (!ins.ok) throw new Error(`seed movie: ${ins.error.message}`);
    movieId = String(ins.data);
  }, 60_000);

  it("declares reactiveQueries", () => {
    expect(read.capabilities.reactiveQueries).toBe(true);
  });

  it("delivers a newly added review to a separate live subscriber", async () => {
    const box = collector<Result<ReviewRow[]>>();
    const unsubscribe = read.store.subscribe("movieReviews", { movieId }, (r) => box.push(r));

    // Contract: subscribe always delivers once with the current (empty) result.
    await box.waitFor((r) => r.ok && r.data.length === 0, 10_000);

    // A second client writes a review; the subscriber must see it without re-asking.
    const added = await addReview(writer, movieId, 5, `live on ${name}`);
    expect(added.ok).toBe(true);

    await box.waitFor((r) => r.ok && r.data.length === 1 && r.data[0]?.rating === 5, 15_000);

    unsubscribe();

    // Clean up so the shared DB stays tidy for sibling suites.
    if (added.ok) await deleteReview(writer, added.data.id);
    await read.store.remove("movies", movieId as never);
  }, 30_000);
});
