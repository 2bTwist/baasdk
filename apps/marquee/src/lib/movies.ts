import type {
  Backend,
  Cursor,
  DocumentId,
  ListOptions,
  ListOrder,
  WhereCondition,
} from "@baas/core";

/**
 * Marquee's portable data-access layer. Every function here drives
 * `backend.store` through the core port ONLY (insert/get/list/patch/remove),
 * so the identical code path runs on memory, Supabase, and Convex. No
 * `native()`, no joins, no aggregation. All `where`/`order`/`cursor`
 * translation lives in this module so the React components stay declarative.
 *
 * Nothing here throws: every store call returns a `Result`, and these functions
 * re-shape it into a small `Outcome<T>` the UI can render directly.
 */

/** A movie document as Marquee stores it. Field names are identical on both backends. */
export interface Movie {
  readonly title: string;
  readonly year: number;
  readonly synopsis: string;
  /** Runtime in minutes. */
  readonly runtime: number;
  readonly director: string;
  /** A genre SLUG (not a name). */
  readonly primaryGenre: string;
  /** Genre slugs, denormalized for display. */
  readonly genres: readonly string[];
}

/** A genre document. `slug` is the stable key movies reference. */
export interface Genre {
  readonly name: string;
  readonly slug: string;
}

/**
 * Every listed/fetched item carries a portable `_id`. The core `list<T>()`
 * signature does not surface `_id` in `T`, so we attach it locally with this
 * helper. (Known SDK ergonomics gap; worked around here, not in the port.)
 */
export type WithId<T> = T & { readonly _id: DocumentId };

/**
 * A throw-free outcome the UI renders directly: either `ok` with data, or a
 * surfaced error message. Mirrors the core `Result` shape but flattens the
 * error to the single string a banner needs.
 */
export type Outcome<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly message: string };

const ok = <T>(data: T): Outcome<T> => ({ ok: true, data });
const fail = (message: string): Outcome<never> => ({ ok: false, message });

/** The sort options the catalog offers. Each maps onto a portable `ListOrder`. */
export type MovieSort =
  | "added-desc"
  | "added-asc"
  | "year-desc"
  | "year-asc"
  | "title-asc"
  | "title-desc";

/**
 * Only `year` and `title` are backend-indexed, so field ordering is restricted
 * to those two. "Recently added" uses portable creation order (no index needed).
 * Offering any other sort field would error on Convex (`unsupported_capability`).
 */
const SORT_TO_ORDER: Record<MovieSort, ListOrder> = {
  "added-desc": "desc",
  "added-asc": "asc",
  "year-desc": { field: "year", direction: "desc" },
  "year-asc": { field: "year", direction: "asc" },
  "title-asc": { field: "title", direction: "asc" },
  "title-desc": { field: "title", direction: "desc" },
};

/** Human labels for the sort select, kept next to the mapping they describe. */
export const SORT_LABELS: Record<MovieSort, string> = {
  "added-desc": "Recently added",
  "added-asc": "Oldest added",
  "year-desc": "Year (newest)",
  "year-asc": "Year (oldest)",
  "title-asc": "Title (A to Z)",
  "title-desc": "Title (Z to A)",
};

/** A grid page is 24 cards. */
export const MOVIE_PAGE_SIZE = 24;

/** Filters the catalog can apply, all AND-combined into a portable `where`. */
interface MovieFilters {
  /** Restrict to a single genre by slug (matched against `primaryGenre`). */
  readonly genre?: string;
  /** Inclusive lower bound on `year`. */
  readonly yearMin?: number;
  /** Inclusive upper bound on `year`. */
  readonly yearMax?: number;
}

export interface ListMoviesArgs extends MovieFilters {
  readonly sort: MovieSort;
  /** Omit for page 1; pass the prior page's `cursor` to continue. */
  readonly cursor?: Cursor | null;
}

export interface MoviePage {
  readonly items: ReadonlyArray<WithId<Movie>>;
  /** `null` once the collection is exhausted for this query shape. */
  readonly cursor: Cursor | null;
}

/** Build the AND-combined `where` array from the active filters. */
function buildWhere(filters: MovieFilters): WhereCondition[] {
  const where: WhereCondition[] = [];
  if (filters.genre) where.push(["primaryGenre", "eq", filters.genre]);
  if (typeof filters.yearMin === "number") where.push(["year", "gte", filters.yearMin]);
  if (typeof filters.yearMax === "number") where.push(["year", "lte", filters.yearMax]);
  return where;
}

/**
 * List a page of movies under the active filters and sort. The cursor is only
 * valid for an identical query shape, so the caller must reset it to null
 * whenever a filter or the sort changes (the catalog does exactly that).
 */
export async function listMovies(
  backend: Backend,
  args: ListMoviesArgs,
): Promise<Outcome<MoviePage>> {
  const where = buildWhere(args);
  const opts: ListOptions = {
    order: SORT_TO_ORDER[args.sort],
    limit: MOVIE_PAGE_SIZE,
    ...(where.length > 0 ? { where } : {}),
    ...(args.cursor ? { cursor: args.cursor } : {}),
  };
  const result = await backend.store.list<WithId<Movie>>("movies", opts);
  if (!result.ok) return fail(result.error.message);
  return ok({ items: result.data.items, cursor: result.data.nextCursor });
}

/** Fetch a single movie by id. Resolves to `null` when it does not exist. */
export async function getMovie(
  backend: Backend,
  id: DocumentId,
): Promise<Outcome<WithId<Movie> | null>> {
  const result = await backend.store.get<WithId<Movie>>("movies", id);
  if (!result.ok) return fail(result.error.message);
  return ok(result.data);
}

/** Create a movie. Resolves to the new document's id. */
export async function createMovie(backend: Backend, input: Movie): Promise<Outcome<DocumentId>> {
  const result = await backend.store.insert<Movie>("movies", input);
  if (!result.ok) return fail(result.error.message);
  return ok(result.data);
}

/** Patch an existing movie. */
export async function updateMovie(
  backend: Backend,
  id: DocumentId,
  patch: Partial<Movie>,
): Promise<Outcome<void>> {
  const result = await backend.store.patch<Movie>("movies", id, patch);
  if (!result.ok) return fail(result.error.message);
  return ok(undefined);
}

/**
 * List every genre, paging through the cursor until exhausted so the dropdown
 * always shows the full set regardless of page size. Uses portable creation
 * order (no field index needed; only `movies.year`/`movies.title` are indexed),
 * then sorts by name client-side for a stable, readable dropdown.
 */
export async function listGenres(backend: Backend): Promise<Outcome<ReadonlyArray<WithId<Genre>>>> {
  const all: WithId<Genre>[] = [];
  let cursor: Cursor | null = null;
  // Loop until nextCursor is null; a non-null cursor can still return a full
  // page, so null is the only authoritative "done" signal.
  do {
    const opts: ListOptions = {
      order: "asc",
      limit: 200,
      ...(cursor ? { cursor } : {}),
    };
    const result = await backend.store.list<WithId<Genre>>("genres", opts);
    if (!result.ok) return fail(result.error.message);
    all.push(...result.data.items);
    cursor = result.data.nextCursor;
  } while (cursor !== null);
  const sorted = [...all].sort((a, b) => a.name.localeCompare(b.name));
  return ok(sorted);
}
