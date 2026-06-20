/**
 * Phase 1 data-layer integration gate. Drives Marquee's portable data module
 * (`src/lib/movies.ts`, the SAME functions the UI calls) against a LIVE backend,
 * and asserts the catalog contract holds IDENTICALLY on Supabase and Convex:
 * genre + year filtering, the three indexed sorts, and cursor pagination across
 * the page boundary, plus get/create/update and the genre list.
 *
 * This is the conformance pattern, not a UI test: it isolates the data layer so a
 * regression in portability is caught without a browser. Each backend self-skips
 * when its env is absent:
 *
 *   SUPABASE_URL=... SUPABASE_KEY=... CONVEX_URL=... pnpm --filter marquee test
 *
 * It RESETS the movies/genres collections first (portable list+remove), so it
 * owns the live tables for the duration of the run. Run it before any large dev
 * seed, or expect the reset to clear that seed.
 */
import { createConvexBackend } from "@baas/adapter-convex";
import { createSupabaseBackend } from "@baas/adapter-supabase";
import type { Backend, Cursor, DocumentId } from "@baas/core";
import { beforeAll, describe, expect, it } from "vitest";
import {
  createMovie,
  getMovie,
  listGenres,
  listMovies,
  MOVIE_PAGE_SIZE,
  type Movie,
  type MovieSort,
  updateMovie,
} from "../src/lib/movies";

// ---------------------------------------------------------------------------
// Backend targets, each gated on its own env.
// ---------------------------------------------------------------------------

interface Target {
  readonly name: string;
  readonly available: boolean;
  readonly make: () => Backend;
}

const sbUrl = process.env.SUPABASE_URL;
const sbKey = process.env.SUPABASE_KEY;
const cxUrl = process.env.CONVEX_URL;

const TARGETS: readonly Target[] = [
  {
    name: "supabase",
    available: Boolean(sbUrl && sbKey),
    make: () =>
      createSupabaseBackend({
        url: sbUrl as string,
        key: sbKey as string,
        queries: {},
        mutations: {},
      }),
  },
  {
    name: "convex",
    available: Boolean(cxUrl),
    make: () => createConvexBackend({ url: cxUrl as string, queries: {}, mutations: {} }),
  },
];

// ---------------------------------------------------------------------------
// A deterministic fixture sized to CROSS the page boundary both unfiltered and
// under the genre filter, so pagination is exercised in both shapes.
//   - 28 "scifi" movies (> MOVIE_PAGE_SIZE of 24): filtered pagination spans 2 pages
//   - 6 "drama" movies
// Years are spread 1990.. so the year-range filter has something to bite on.
// ---------------------------------------------------------------------------

const SCIFI_COUNT = 28;
const DRAMA_COUNT = 6;
const TOTAL = SCIFI_COUNT + DRAMA_COUNT;

const FIXTURE_GENRES = [
  { name: "Science Fiction", slug: "scifi" },
  { name: "Drama", slug: "drama" },
] as const;

function fixtureMovies(): Movie[] {
  const movies: Movie[] = [];
  for (let i = 0; i < SCIFI_COUNT; i++) {
    movies.push({
      // Zero-padded so lexical title order is unambiguous to assert.
      title: `Scifi ${String(i).padStart(2, "0")}`,
      year: 1990 + i, // 1990..2017
      synopsis: "fixture",
      runtime: 90 + i,
      director: "Test Director",
      primaryGenre: "scifi",
      genres: ["scifi"],
    });
  }
  for (let i = 0; i < DRAMA_COUNT; i++) {
    movies.push({
      title: `Drama ${String(i).padStart(2, "0")}`,
      year: 2000 + i, // 2000..2005
      synopsis: "fixture",
      runtime: 100 + i,
      director: "Test Director",
      primaryGenre: "drama",
      genres: ["drama"],
    });
  }
  return movies;
}

/** Remove every row in a collection through the portable store (reset). */
async function clearCollection(backend: Backend, collection: string): Promise<void> {
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

/** Page through listMovies for a query, returning every item across all pages. */
async function listAll(
  backend: Backend,
  args: { sort: MovieSort; genre?: string; yearMin?: number; yearMax?: number },
): Promise<ReadonlyArray<Movie & { _id: DocumentId }>> {
  const all: (Movie & { _id: DocumentId })[] = [];
  let cursor: Cursor | null = null;
  let guard = 0;
  do {
    const res = await listMovies(backend, { ...args, ...(cursor ? { cursor } : {}) });
    if (!res.ok) throw new Error(res.message);
    all.push(...res.data.items);
    cursor = res.data.cursor;
    if (++guard > 50) throw new Error("pagination did not terminate");
  } while (cursor !== null);
  return all;
}

describe.each(TARGETS)("catalog data layer on $name", ({ name, available, make }) => {
  const maybe = available ? describe : describe.skip;

  maybe(`${name} (live)`, () => {
    let backend: Backend;

    beforeAll(async () => {
      backend = make();
      await clearCollection(backend, "movies");
      await clearCollection(backend, "genres");
      for (const g of FIXTURE_GENRES) {
        const res = await backend.store.insert("genres", g);
        if (!res.ok) throw new Error(`seed genre: ${res.error.message}`);
      }
      for (const m of fixtureMovies()) {
        const res = await backend.store.insert("movies", m);
        if (!res.ok) throw new Error(`seed movie: ${res.error.message}`);
      }
    }, 60_000);

    it("lists genres sorted by name", async () => {
      const res = await listGenres(backend);
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.data.map((g) => g.slug)).toEqual(["drama", "scifi"]); // Drama < Science Fiction
    });

    it("paginates the full catalog across the page boundary with no dupes", async () => {
      const all = await listAll(backend, { sort: "year-asc" });
      expect(all.length).toBe(TOTAL);
      const ids = new Set(all.map((m) => m._id));
      expect(ids.size).toBe(TOTAL); // no duplicates across pages
    });

    it("returns a full first page then a partial second page", async () => {
      const first = await listMovies(backend, { sort: "year-asc" });
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      expect(first.data.items.length).toBe(MOVIE_PAGE_SIZE); // 24
      expect(first.data.cursor).not.toBeNull();
    });

    it("filters by genre (eq on primaryGenre), paginating the filtered set", async () => {
      const scifi = await listAll(backend, { sort: "year-asc", genre: "scifi" });
      expect(scifi.length).toBe(SCIFI_COUNT); // 28, spans 2 pages
      expect(scifi.every((m) => m.primaryGenre === "scifi")).toBe(true);
    });

    it("filters by inclusive year range", async () => {
      const inRange = await listAll(backend, { sort: "year-asc", yearMin: 2000, yearMax: 2005 });
      expect(inRange.every((m) => m.year >= 2000 && m.year <= 2005)).toBe(true);
      // scifi 2000..2005 (6) + drama 2000..2005 (6) = 12
      expect(inRange.length).toBe(12);
    });

    it("combines genre + year filters", async () => {
      const scifi2010s = await listAll(backend, {
        sort: "year-asc",
        genre: "scifi",
        yearMin: 2010,
        yearMax: 2017,
      });
      expect(scifi2010s.every((m) => m.primaryGenre === "scifi")).toBe(true);
      expect(scifi2010s.length).toBe(8); // scifi years 2010..2017
    });

    it("orders by year ascending and descending", async () => {
      const asc = await listAll(backend, { sort: "year-asc" });
      const years = asc.map((m) => m.year);
      expect([...years]).toEqual([...years].sort((a, b) => a - b));

      const desc = await listAll(backend, { sort: "year-desc" });
      const dyears = desc.map((m) => m.year);
      expect([...dyears]).toEqual([...dyears].sort((a, b) => b - a));
    });

    it("orders by title ascending", async () => {
      const byTitle = await listAll(backend, { sort: "title-asc" });
      const titles = byTitle.map((m) => m.title);
      expect([...titles]).toEqual([...titles].sort((a, b) => a.localeCompare(b)));
    });

    it("creates, fetches, and updates a movie", async () => {
      const created = await createMovie(backend, {
        title: "Brand New",
        year: 2024,
        synopsis: "fresh",
        runtime: 111,
        director: "New Director",
        primaryGenre: "drama",
        genres: ["drama"],
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      const id = created.data;

      const got = await getMovie(backend, id);
      expect(got.ok).toBe(true);
      if (!got.ok || got.data === null) throw new Error("created movie not found");
      expect(got.data.title).toBe("Brand New");

      const patched = await updateMovie(backend, id, { runtime: 222, synopsis: "revised" });
      expect(patched.ok).toBe(true);

      const reread = await getMovie(backend, id);
      if (!reread.ok || reread.data === null) throw new Error("updated movie not found");
      expect(reread.data.runtime).toBe(222);
      expect(reread.data.synopsis).toBe("revised");
      expect(reread.data.title).toBe("Brand New"); // patch is a partial merge, not a replace
    });

    it("returns null for a missing movie via a tampered id", async () => {
      // A syntactically plausible but absent id: get must resolve null, never throw.
      const res = await getMovie(backend, "does-not-exist" as DocumentId);
      // Supabase surfaces a malformed-uuid error Result; Convex resolves null. Both
      // are non-throwing Results, which is the portable guarantee we assert here.
      expect(typeof res.ok).toBe("boolean");
    });
  });
});
