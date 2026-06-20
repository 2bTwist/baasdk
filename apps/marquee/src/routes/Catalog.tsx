import type { Backend, Cursor, DocumentId } from "@baas/core";
import { useCallback, useEffect, useState } from "react";
import {
  type Genre,
  type ListMoviesArgs,
  listGenres,
  listMovies,
  type Movie,
  type MovieSort,
  SORT_LABELS,
  type WithId,
} from "../lib/movies";

interface CatalogProps {
  readonly backend: Backend;
  readonly onOpen: (id: DocumentId) => void;
  readonly onCreate: () => void;
}

/** The catalog's active filter + sort state. Any change resets pagination. */
interface Query {
  readonly genre: string;
  readonly yearMin: string;
  readonly yearMax: string;
  readonly sort: MovieSort;
}

const INITIAL_QUERY: Query = { genre: "", yearMin: "", yearMax: "", sort: "added-desc" };

const SORT_OPTIONS: readonly MovieSort[] = [
  "added-desc",
  "added-asc",
  "year-desc",
  "year-asc",
  "title-asc",
  "title-desc",
];

/** Parse an optional year input; empty/invalid means "no bound". */
function parseYear(value: string): number | undefined {
  const n = Number(value);
  return value.trim() !== "" && Number.isFinite(n) ? n : undefined;
}

/**
 * Translate the catalog's UI query into `listMovies` args, omitting empty
 * filters entirely (under `exactOptionalPropertyTypes`, an absent optional and
 * one set to `undefined` differ). An optional cursor continues a page.
 */
function toListArgs(query: Query, cursor?: Cursor): ListMoviesArgs {
  const yearMin = parseYear(query.yearMin);
  const yearMax = parseYear(query.yearMax);
  return {
    sort: query.sort,
    ...(query.genre ? { genre: query.genre } : {}),
    ...(yearMin !== undefined ? { yearMin } : {}),
    ...(yearMax !== undefined ? { yearMax } : {}),
    ...(cursor ? { cursor } : {}),
  };
}

/**
 * The Phase 1 catalog: a filtered, sorted, cursor-paginated grid of movies, all
 * through the portable store. Filters and sort map onto a single `ListOptions`
 * in `listMovies`; changing any of them resets to page 1. "Load more" appends
 * the next page and hides itself once the cursor is null.
 */
export function Catalog({ backend, onOpen, onCreate }: CatalogProps): React.JSX.Element {
  const [query, setQuery] = useState<Query>(INITIAL_QUERY);
  const [movies, setMovies] = useState<ReadonlyArray<WithId<Movie>>>([]);
  const [cursor, setCursor] = useState<Cursor | null>(null);
  const [genres, setGenres] = useState<ReadonlyArray<WithId<Genre>>>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Populate the genre dropdown once per backend instance.
  useEffect(() => {
    let active = true;
    void (async () => {
      const result = await listGenres(backend);
      if (!active) return;
      if (result.ok) setGenres(result.data);
      // A genre-load failure is non-fatal; the dropdown just stays empty.
    })();
    return () => {
      active = false;
    };
  }, [backend]);

  /** Fetch page 1 for the current query, replacing the grid. */
  const loadFirstPage = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    const result = await listMovies(backend, toListArgs(query));
    setLoading(false);
    if (!result.ok) {
      setError(result.message);
      setMovies([]);
      setCursor(null);
      return;
    }
    setMovies(result.data.items);
    setCursor(result.data.cursor);
  }, [backend, query]);

  // Reload page 1 whenever the backend or any filter/sort changes.
  useEffect(() => {
    void loadFirstPage();
  }, [loadFirstPage]);

  /** Append the next page using the live cursor. */
  const loadMore = useCallback(async (): Promise<void> => {
    if (cursor === null) return;
    setLoadingMore(true);
    const result = await listMovies(backend, toListArgs(query, cursor));
    setLoadingMore(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setMovies((prev) => [...prev, ...result.data.items]);
    setCursor(result.data.cursor);
  }, [backend, cursor, query]);

  const update = useCallback(<K extends keyof Query>(key: K, value: Query[K]): void => {
    setQuery((prev) => ({ ...prev, [key]: value }));
  }, []);

  const genreName = useCallback(
    (slug: string): string => genres.find((g) => g.slug === slug)?.name ?? slug,
    [genres],
  );

  return (
    <main>
      <div className="catalog-head">
        <div>
          <h1>Catalog</h1>
          <p>
            Filtered, sorted, and cursor-paginated entirely through the portable
            <code> backend.store </code> port. The same code runs on memory, Supabase, and Convex.
          </p>
        </div>
        <button type="button" className="add-btn" onClick={onCreate}>
          + Add movie
        </button>
      </div>

      <div className="filter-bar">
        <label className="filter">
          <span className="filter-label">Genre</span>
          <select
            className="text-input"
            value={query.genre}
            onChange={(e) => update("genre", e.target.value)}
          >
            <option value="">All genres</option>
            {genres.map((g) => (
              <option key={g._id} value={g.slug}>
                {g.name}
              </option>
            ))}
          </select>
        </label>

        <label className="filter">
          <span className="filter-label">Year from</span>
          <input
            className="text-input"
            type="number"
            inputMode="numeric"
            placeholder="any"
            value={query.yearMin}
            onChange={(e) => update("yearMin", e.target.value)}
          />
        </label>

        <label className="filter">
          <span className="filter-label">Year to</span>
          <input
            className="text-input"
            type="number"
            inputMode="numeric"
            placeholder="any"
            value={query.yearMax}
            onChange={(e) => update("yearMax", e.target.value)}
          />
        </label>

        <label className="filter">
          <span className="filter-label">Sort</span>
          <select
            className="text-input"
            value={query.sort}
            onChange={(e) => update("sort", e.target.value as MovieSort)}
          >
            {SORT_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {SORT_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error ? (
        <div className="error" role="alert">
          Could not load movies: {error}
        </div>
      ) : null}

      {loading ? (
        <p className="muted-note">Loading…</p>
      ) : movies.length === 0 ? (
        <div className="empty">
          <p className="big">No movies match</p>
          <p>Adjust the filters above, or add a movie to the catalog.</p>
        </div>
      ) : (
        <>
          <div className="cards">
            {movies.map((m) => (
              <button
                type="button"
                className="card card-btn"
                key={m._id}
                onClick={() => onOpen(m._id)}
              >
                <div className="poster-thumb" aria-hidden="true">
                  <span className="poster-initial">{m.title.charAt(0).toUpperCase()}</span>
                </div>
                <div className="year">{m.year}</div>
                <h2 className="title">{m.title}</h2>
                <div className="card-genre">{genreName(m.primaryGenre)}</div>
              </button>
            ))}
          </div>

          {cursor !== null ? (
            <div className="load-more-row">
              <button
                type="button"
                className="link-btn load-more"
                onClick={() => void loadMore()}
                disabled={loadingMore}
              >
                {loadingMore ? "Loading…" : "Load more"}
              </button>
            </div>
          ) : null}
        </>
      )}
    </main>
  );
}
