/**
 * Phase 5 migrate-config gate (isolated, no live stack): Marquee's collections +
 * FK-relation map drive a correct cutover. Two in-memory backends stand in for
 * source/target so the marquee config — not the @baas/migrate engine, which has
 * its own conformance suite — is what's under test:
 *  - every collection copies,
 *  - foreign keys are REMAPPED to the ids the target mints (a movieGenres row on
 *    the target points at a TARGET movie id, never the source id),
 *  - identity-bearing userId is carried verbatim (shared-issuer invariant),
 *  - a re-run is idempotent (all skipped, no duplicates).
 *
 * The live Supabase<->Convex cutover is exercised by the admin-panel browser smoke.
 */
import { createMemoryBackend } from "@baas/adapter-memory";
import type { Backend, DocumentId } from "@baas/core";
import { describe, expect, it } from "vitest";
import { MIGRATE_COLLECTIONS, runMigration } from "../src/lib/migrate";

type AnyBackend = Backend;

interface Row {
  readonly _id: DocumentId;
  readonly [k: string]: unknown;
}

async function listAll(b: AnyBackend, collection: string): Promise<Row[]> {
  const r = await b.store.list<Row>(collection, { limit: 200 });
  if (!r.ok) throw new Error(`list ${collection}: ${r.error.message}`);
  return [...r.data.items];
}

async function insert(
  b: AnyBackend,
  collection: string,
  value: Record<string, unknown>,
): Promise<string> {
  const r = await b.store.insert(collection, value);
  if (!r.ok) throw new Error(`insert ${collection}: ${r.error.message}`);
  return String(r.data);
}

/** Seed a tiny relational graph into `source`: 2 genres, 1 person, 2 movies, the
 *  genre joins + credits that reference them, and one review. */
async function seedGraph(b: AnyBackend): Promise<void> {
  const drama = await insert(b, "genres", { name: "Drama", slug: "drama" });
  const scifi = await insert(b, "genres", { name: "Science Fiction", slug: "scifi" });
  const person = await insert(b, "people", { name: "Ava Director", bio: "" });
  const m1 = await insert(b, "movies", { title: "Alpha", year: 2020, primaryGenre: "drama" });
  const m2 = await insert(b, "movies", { title: "Beta", year: 2021, primaryGenre: "scifi" });
  await insert(b, "movieGenres", { movieId: m1, genreId: drama });
  await insert(b, "movieGenres", { movieId: m2, genreId: scifi });
  await insert(b, "credits", {
    movieId: m1,
    personId: person,
    role: "director",
    character: "",
    billing: 0,
  });
  await insert(b, "reviews", { movieId: m1, userId: "user-abc", rating: 5, body: "great" });
}

describe("marquee migrate config (memory -> memory)", () => {
  it("copies every collection and remaps foreign keys to target ids", async () => {
    const source = createMemoryBackend({ queries: {}, mutations: {} });
    const target = createMemoryBackend({ queries: {}, mutations: {} });
    await seedGraph(source);

    const report = await runMigration(source, target, { from: "memory", to: "memory" }, () => {});
    expect(report.ok).toBe(true);

    // Every configured collection copied its rows.
    for (const c of MIGRATE_COLLECTIONS) {
      const src = await listAll(source, c);
      const dst = await listAll(target, c);
      expect(dst.length).toBe(src.length);
    }

    // FK remap, checked by CONTENT (two fresh memory backends mint colliding id
    // spaces, so an id-equality check can't tell a remap from a coincidence).
    // Each target movieGenres row must resolve, THROUGH TARGET IDS, to the same
    // (movie title, genre slug) pairing it had on the source.
    const targetMovieTitle = new Map(
      (await listAll(target, "movies")).map((m) => [String(m._id), String(m.title)]),
    );
    const targetGenreSlug = new Map(
      (await listAll(target, "genres")).map((g) => [String(g._id), String(g.slug)]),
    );
    const targetPairs = (await listAll(target, "movieGenres"))
      .map(
        (j) =>
          `${targetMovieTitle.get(String(j.movieId))}|${targetGenreSlug.get(String(j.genreId))}`,
      )
      .sort();
    expect(targetPairs).toEqual(["Alpha|drama", "Beta|scifi"]);
    // Every resolved end must be a REAL target row (no dangling/unmapped id).
    for (const pair of targetPairs) expect(pair).not.toContain("undefined");

    // Identity-bearing userId is carried verbatim (NOT remapped — shared issuer).
    const targetReviews = await listAll(target, "reviews");
    expect(targetReviews[0]?.userId).toBe("user-abc");
  });

  it("is idempotent: a second run skips everything and adds no duplicates", async () => {
    const source = createMemoryBackend({ queries: {}, mutations: {} });
    const target = createMemoryBackend({ queries: {}, mutations: {} });
    await seedGraph(source);

    await runMigration(source, target, { from: "memory", to: "memory" }, () => {});
    const afterFirst = await listAll(target, "movies");

    const second = await runMigration(source, target, { from: "memory", to: "memory" }, () => {});
    expect(second.ok).toBe(true);
    // Nothing new copied; counts hold.
    for (const c of MIGRATE_COLLECTIONS) {
      expect(second.collections[c]?.copied ?? 0).toBe(0);
    }
    const afterSecond = await listAll(target, "movies");
    expect(afterSecond.length).toBe(afterFirst.length);
  });
});
