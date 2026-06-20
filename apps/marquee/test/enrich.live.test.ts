/**
 * Phase 2 enrich gate: the JOIN (`movieCredits`) and AGGREGATION (`genreCounts`)
 * named operations, asserted to return identical shapes on all three backends
 * despite divergent implementations (Supabase server-side embed/view; Convex and
 * memory ref-follow/scan). The capability flags are asserted too, so the declared
 * divergence is part of the contract.
 *
 * Memory runs hermetically (always). Supabase and Convex self-skip without env:
 *   SUPABASE_URL=... SUPABASE_KEY=... CONVEX_URL=... pnpm --filter marquee test
 */
import { createConvexBackend } from "@baas/adapter-convex";
import { createMemoryBackend } from "@baas/adapter-memory";
import { createSupabaseBackend } from "@baas/adapter-supabase";
import type { Backend, DocumentId } from "@baas/core";
import { beforeAll, describe, expect, it } from "vitest";
import {
  aggregatesServerSide,
  convexQueries,
  getGenreCounts,
  getMovieCredits,
  joinsServerSide,
  memoryQueries,
  supabaseQueries,
} from "../src/lib/enrich";
import {
  convexRatingQuery,
  convexReviewMutations,
  memoryRatingQuery,
  memoryReviewMutations,
  supabaseRatingQuery,
  supabaseReviewMutations,
} from "../src/lib/reviews";
import type { MarqueeSchema } from "../src/lib/schema";

// Complete query/mutation maps so the backends satisfy the full MarqueeSchema
// (this test only exercises the Phase 2 join/aggregation, but the schema now also
// carries movieRating + the review mutations from Phase 3).
const memoryQ = { ...memoryQueries, movieRating: memoryRatingQuery };
const supabaseQ = { ...supabaseQueries, movieRating: supabaseRatingQuery };
const convexQ = { ...convexQueries, movieRating: convexRatingQuery };

interface Target {
  readonly name: string;
  readonly available: boolean;
  readonly serverSide: boolean; // expected serverSideJoins/aggregations
  readonly make: () => Backend<MarqueeSchema>;
}

const sbUrl = process.env.SUPABASE_URL;
const sbKey = process.env.SUPABASE_KEY;
const cxUrl = process.env.CONVEX_URL;

const TARGETS: readonly Target[] = [
  {
    name: "memory",
    available: true,
    serverSide: false,
    make: () =>
      createMemoryBackend<MarqueeSchema>({ queries: memoryQ, mutations: memoryReviewMutations }),
  },
  {
    name: "supabase",
    available: Boolean(sbUrl && sbKey),
    serverSide: true, // PostgREST embed + SQL view
    make: () =>
      createSupabaseBackend<MarqueeSchema>({
        url: sbUrl as string,
        key: sbKey as string,
        queries: supabaseQ,
        mutations: supabaseReviewMutations,
      }),
  },
  {
    name: "convex",
    available: Boolean(cxUrl),
    serverSide: false, // ref-follow + scan
    make: () =>
      createConvexBackend<MarqueeSchema>({
        url: cxUrl as string,
        queries: convexQ,
        mutations: convexReviewMutations,
      }),
  },
];

async function clear(backend: Backend<MarqueeSchema>, collection: string): Promise<void> {
  for (;;) {
    const page = await backend.store.list<{ _id: DocumentId }>(collection, { limit: 200 });
    if (!page.ok) throw new Error(`reset ${collection}: ${page.error.message}`);
    if (page.data.items.length === 0) break;
    for (const item of page.data.items) {
      const removed = await backend.store.remove(collection, item._id);
      if (!removed.ok) throw new Error(`reset remove ${collection}: ${removed.error.message}`);
    }
    if (page.data.nextCursor === null) break;
  }
}

async function insert(
  backend: Backend<MarqueeSchema>,
  collection: string,
  value: Record<string, unknown>,
): Promise<DocumentId> {
  const res = await backend.store.insert(collection, value);
  if (!res.ok) throw new Error(`insert ${collection}: ${res.error.message}`);
  return res.data;
}

describe.each(TARGETS)("enrich on $name", ({ name, available, serverSide, make }) => {
  const maybe = available ? describe : describe.skip;

  maybe(name, () => {
    let backend: Backend<MarqueeSchema>;
    let targetMovieId: DocumentId;
    let creditlessMovieId: DocumentId;

    beforeAll(async () => {
      backend = make();
      for (const c of ["credits", "people", "movieGenres", "movies", "genres"]) {
        await clear(backend, c);
      }

      await insert(backend, "genres", { name: "Science Fiction", slug: "scifi" });
      await insert(backend, "genres", { name: "Drama", slug: "drama" });

      // 3 scifi + 2 drama -> genreCounts should report scifi:3, drama:2.
      const scifiIds: DocumentId[] = [];
      for (let i = 0; i < 3; i++) {
        scifiIds.push(
          await insert(backend, "movies", {
            title: `S${i}`,
            year: 2000 + i,
            primaryGenre: "scifi",
          }),
        );
      }
      creditlessMovieId = scifiIds[0] as DocumentId; // a real movie with no credits
      const dramaIds: DocumentId[] = [];
      for (let i = 0; i < 2; i++) {
        dramaIds.push(
          await insert(backend, "movies", {
            title: `D${i}`,
            year: 2010 + i,
            primaryGenre: "drama",
          }),
        );
      }
      targetMovieId = dramaIds[0] as DocumentId;

      // Cast for the target movie: a director (billing 0) and two actors (1, 2),
      // inserted OUT of billing order to prove the join sorts by billing.
      const dir = await insert(backend, "people", { name: "Jane Director", bio: "" });
      const a1 = await insert(backend, "people", { name: "Actor One", bio: "" });
      const a2 = await insert(backend, "people", { name: "Actor Two", bio: "" });
      await insert(backend, "credits", {
        movieId: String(targetMovieId),
        personId: String(a2),
        role: "actor",
        character: "Sidekick",
        billing: 2,
      });
      await insert(backend, "credits", {
        movieId: String(targetMovieId),
        personId: String(dir),
        role: "director",
        character: "",
        billing: 0,
      });
      await insert(backend, "credits", {
        movieId: String(targetMovieId),
        personId: String(a1),
        role: "actor",
        character: "Lead",
        billing: 1,
      });
    }, 60_000);

    it("declares its join/aggregation capability", () => {
      expect(joinsServerSide(backend)).toBe(serverSide);
      expect(aggregatesServerSide(backend)).toBe(serverSide);
    });

    it("joins credits to people, ordered by billing, names resolved", async () => {
      const res = await getMovieCredits(backend, String(targetMovieId));
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.data.map((c) => c.billing)).toEqual([0, 1, 2]); // sorted by billing
      expect(res.data.map((c) => c.name)).toEqual(["Jane Director", "Actor One", "Actor Two"]);
      expect(res.data[0]?.role).toBe("director");
      expect(res.data[1]?.character).toBe("Lead");
    });

    it("returns an empty cast for a real movie with no credits", async () => {
      const res = await getMovieCredits(backend, String(creditlessMovieId));
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.data).toEqual([]);
    });

    it("aggregates movie counts per primary genre", async () => {
      const res = await getGenreCounts(backend);
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      const bySlug = new Map(res.data.map((g) => [g.slug, g.count]));
      expect(bySlug.get("scifi")).toBe(3);
      expect(bySlug.get("drama")).toBe(2);
    });
  });
});
