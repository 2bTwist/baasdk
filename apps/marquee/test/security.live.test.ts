/**
 * Phase 3 security gate (the acceptance bar): own-only reviews, enforced by the
 * BACKEND, proven identically on Supabase (RLS) and Convex (ctx.auth). Two real
 * users sign in through the shared Supabase issuer; member B must NOT be able to
 * edit or delete member A's review, and A's review must be unchanged after the
 * attempt. Identity is always derived from the verified session, never from args.
 *
 * Self-skips without env. Run:
 *   SUPABASE_URL=... SUPABASE_KEY=<anon> CONVEX_URL=... pnpm --filter marquee test
 */
import { createConvexBackend } from "@baas/adapter-convex";
import { createSupabaseBackend } from "@baas/adapter-supabase";
import { type Backend, supportsCredentials } from "@baas/core";
import { createClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { convexQueries, supabaseQueries } from "../src/lib/enrich";
import {
  addReview,
  convexRatingQuery,
  convexReviewMutations,
  deleteReview,
  editReview,
  getMovieRating,
  listReviews,
  supabaseRatingQuery,
  supabaseReviewMutations,
} from "../src/lib/reviews";
import type { MarqueeSchema } from "../src/lib/schema";

const sbUrl = process.env.SUPABASE_URL;
const sbKey = process.env.SUPABASE_KEY; // anon
const cxUrl = process.env.CONVEX_URL;
// Convex verifies the Supabase issuer, so all three are required to run this gate.
const ready = Boolean(sbUrl && sbKey && cxUrl);

type Creds = { email: string; password: string };
const USER_A: Creds = { email: "member.a@marquee.test", password: "password123" };
const USER_B: Creds = { email: "member.b@marquee.test", password: "password123" };

const supabaseQ = { ...supabaseQueries, movieRating: supabaseRatingQuery };
const convexQ = { ...convexQueries, movieRating: convexRatingQuery };

const newSupabase = (): Backend<MarqueeSchema> =>
  createSupabaseBackend<MarqueeSchema>({
    url: sbUrl as string,
    key: sbKey as string,
    queries: supabaseQ,
    mutations: supabaseReviewMutations,
  });

const newConvex = (): Backend<MarqueeSchema> =>
  createConvexBackend<MarqueeSchema>({
    url: cxUrl as string,
    queries: convexQ,
    mutations: convexReviewMutations,
  });

/** Make sure a user exists (idempotent; email confirmations are off locally). */
async function ensureUser(user: Creds): Promise<void> {
  const c = createClient(sbUrl as string, sbKey as string);
  await c.auth.signUp(user).catch(() => undefined);
}

/** A fresh access token for a user (used to authenticate the Convex client). */
async function tokenFor(user: Creds): Promise<string> {
  const c = createClient(sbUrl as string, sbKey as string);
  const { data, error } = await c.auth.signInWithPassword(user);
  if (error || !data.session) throw new Error(`sign-in ${user.email}: ${error?.message}`);
  return data.session.access_token;
}

interface Target {
  readonly name: string;
  /** A backend authenticated as the given user (through the SDK auth port). */
  readonly authed: (user: Creds) => Promise<Backend<MarqueeSchema>>;
  /** An unauthenticated backend, to seed a movie + read rows back. */
  readonly anon: () => Backend<MarqueeSchema>;
}

const TARGETS: readonly Target[] = [
  {
    name: "supabase",
    anon: newSupabase,
    authed: async (user) => {
      const b = newSupabase();
      if (!supportsCredentials(b.auth)) throw new Error("supabase should manage credentials");
      const r = await b.auth.signInWithPassword(user.email, user.password);
      if (!r.ok) throw new Error(`supabase sign-in ${user.email}: ${r.error.message}`);
      return b;
    },
  },
  {
    name: "convex",
    anon: newConvex,
    authed: async (user) => {
      const token = await tokenFor(user);
      const b = newConvex();
      b.auth.setToken(async () => token);
      return b;
    },
  },
];

const maybe = ready ? describe : describe.skip;

maybe.each(TARGETS)("own-only reviews on $name", ({ name, authed, anon }) => {
  let backendA: Backend<MarqueeSchema>;
  let backendB: Backend<MarqueeSchema>;
  let reader: Backend<MarqueeSchema>;
  let movieId: string;

  beforeAll(async () => {
    await Promise.all([ensureUser(USER_A), ensureUser(USER_B)]);
    [backendA, backendB] = await Promise.all([authed(USER_A), authed(USER_B)]);
    reader = anon();
    // A fresh movie to review (movies have no RLS, so the anon backend can insert).
    const ins = await reader.store.insert("movies", {
      title: `Sec ${name}`,
      year: 2020,
      primaryGenre: "drama",
    });
    if (!ins.ok) throw new Error(`seed movie: ${ins.error.message}`);
    movieId = String(ins.data);
  }, 60_000);

  it("lets the owner add a review (identity from the session)", async () => {
    const res = await addReview(backendA, movieId, 5, "A loved it");
    expect(res.ok).toBe(true);
  });

  it("REJECTS another user editing/deleting the owner's review, leaving it unchanged", async () => {
    const list = await listReviews(reader, movieId);
    if (!list.ok || list.data.length === 0) throw new Error("no review to attack");
    const reviewId = String(list.data[0]?._id);

    const attackEdit = await editReview(backendB, reviewId, 1, "B tampered");
    expect(attackEdit.ok).toBe(false);

    const attackDelete = await deleteReview(backendB, reviewId);
    expect(attackDelete.ok).toBe(false);

    // The DB/transaction blocked both: the row still holds A's content.
    const after = await listReviews(reader, movieId);
    if (!after.ok) throw new Error(after.message);
    const row = after.data.find((r) => String(r._id) === reviewId);
    expect(row).toBeDefined();
    expect(row?.rating).toBe(5);
    expect(row?.body).toBe("A loved it");
  });

  it("lets the owner edit and delete their own review; rating reflects it", async () => {
    const list = await listReviews(reader, movieId);
    if (!list.ok || list.data.length === 0) throw new Error("no review");
    const reviewId = String(list.data[0]?._id);

    const edit = await editReview(backendA, reviewId, 4, "A revised");
    expect(edit.ok).toBe(true);

    const rating = await getMovieRating(reader, movieId);
    expect(rating.ok).toBe(true);
    if (rating.ok) {
      expect(rating.data.count).toBe(1);
      expect(rating.data.avg).toBe(4);
    }

    const del = await deleteReview(backendA, reviewId);
    expect(del.ok).toBe(true);
    const gone = await listReviews(reader, movieId);
    if (gone.ok) expect(gone.data.find((r) => String(r._id) === reviewId)).toBeUndefined();
  });

  it("rejects a signed-out write", async () => {
    const res = await addReview(anon(), movieId, 3, "anon");
    expect(res.ok).toBe(false);
  });
});
