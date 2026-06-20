import type { Backend } from "@baas/core";
import {
  dryRunMigrate,
  type MigratePlan,
  type MigrateProgress,
  type MigrateReport,
  migrate,
} from "@baas/migrate";
import type { BackendKind } from "./backend";

/**
 * Phase 5: Marquee's live cutover config for `@baas/migrate`. The admin Migrate
 * panel runs this Supabase<->Convex. The whole point of the dogfood: the SAME
 * migrate engine copies the catalog + user data across two backends with
 * completely different storage models, remapping foreign keys to the ids the
 * target mints, idempotently (a re-run resumes via the `migratedFrom` marker).
 *
 * Collections are copied parents-first (cosmetic; relations are resolved in a
 * second relink pass regardless of order). Identity-bearing fields (reviews/
 * profiles `userId`) are NOT remapped: the shared OIDC issuer makes a user's
 * `sub` identical on both backends, so a copied `userId` stays valid on the
 * target — that cross-backend identity consistency is exactly why Phase 3 chose
 * one issuer. The poster handle (`movies.posterFile`) is copied verbatim and is
 * NOT followed: file blobs live in each backend's own storage, so a migrated
 * poster handle dangles on the target (an honest, documented limit — file
 * migration is out of scope).
 */
/** Catalog collections have NO row-level security: the portable CRUD writes them
 *  on any backend with the public/anon client. */
export const CATALOG_COLLECTIONS = [
  "genres",
  "people",
  "movies",
  "movieGenres",
  "credits",
] as const;

/** User-owned collections are RLS-protected on Supabase (insert_own requires
 *  `auth.uid() = userId`), so the browser's anon client CANNOT write them. They
 *  migrate freely INTO Convex (ungated CRUD); writing them INTO Supabase needs
 *  service credentials, so a `->supabase` cutover from the browser is
 *  catalog-only (see `collectionsFor`). */
export const USER_COLLECTIONS = ["reviews", "profiles"] as const;

export const MIGRATE_COLLECTIONS = [...CATALOG_COLLECTIONS, ...USER_COLLECTIONS] as const;

/**
 * The collections a browser-driven cutover can actually write, by target. Into
 * Convex: everything (its generic CRUD is ungated). Into Supabase: catalog only,
 * because reviews/profiles RLS rejects the anon client — migrating user data into
 * an RLS backend is an ops action that needs a service key, not a browser session.
 * Stated in the panel, not hidden.
 */
export function collectionsFor(targetKind: BackendKind): readonly string[] {
  return targetKind === "supabase"
    ? [...CATALOG_COLLECTIONS]
    : [...CATALOG_COLLECTIONS, ...USER_COLLECTIONS];
}

/** FK remap: `relations[collection][field] = targetCollection`. */
export const MIGRATE_RELATIONS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  movieGenres: { movieId: "movies", genreId: "genres" },
  credits: { movieId: "movies", personId: "people" },
  reviews: { movieId: "movies" },
};

/**
 * Fields to drop before re-inserting. A Supabase SOURCE surfaces its primary key
 * (`id`) and `created_at` as ordinary columns; the target re-mints both, so strip
 * them. A Convex source carries only `_id`/`_creationTime`, which migrate strips
 * unconditionally, so nothing extra is needed.
 */
function stripFieldsFor(sourceKind: BackendKind): readonly string[] {
  return sourceKind === "supabase" ? ["id", "created_at"] : [];
}

/**
 * A Convex TARGET caps a single value at ~1 MiB; bound payloads BEFORE insert so
 * an oversized row fails fast with a named `validation` error rather than a
 * provider-specific error mid-cutover. A Supabase target has no such per-row cap.
 */
function maxValueBytesFor(targetKind: BackendKind): number | undefined {
  return targetKind === "convex" ? 1_000_000 : undefined;
}

export interface MigrateDirection {
  readonly from: BackendKind;
  readonly to: BackendKind;
}

/** Project the cutover without writing (counts + the first size/shape issue). */
export function planMigration(
  source: Backend,
  target: Backend,
  direction: MigrateDirection,
): Promise<MigratePlan> {
  const maxValueBytes = maxValueBytesFor(direction.to);
  return dryRunMigrate(source, target, {
    collections: collectionsFor(direction.to),
    stripFields: stripFieldsFor(direction.from),
    batchSize: 200,
    ...(maxValueBytes ? { maxValueBytes } : {}),
  });
}

/** Run the live cutover, streaming per-collection progress to `onProgress`. */
export function runMigration(
  source: Backend,
  target: Backend,
  direction: MigrateDirection,
  onProgress: (event: MigrateProgress) => void,
): Promise<MigrateReport> {
  const maxValueBytes = maxValueBytesFor(direction.to);
  return migrate(source, target, {
    collections: collectionsFor(direction.to),
    relations: MIGRATE_RELATIONS,
    stripFields: stripFieldsFor(direction.from),
    batchSize: 200,
    onProgress,
    ...(maxValueBytes ? { maxValueBytes } : {}),
  });
}
