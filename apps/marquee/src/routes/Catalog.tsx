import type { Backend } from "@baas/core";
import { useCallback, useEffect, useState } from "react";

interface CatalogProps {
  readonly backend: Backend;
}

interface Movie {
  readonly _id: string;
  readonly title: string;
  readonly year: number;
}

/** A rotating set of samples so repeated clicks add varied movies. */
const SAMPLES: ReadonlyArray<{ title: string; year: number }> = [
  { title: "Metropolis", year: 1927 },
  { title: "Blade Runner", year: 1982 },
  { title: "Spirited Away", year: 2001 },
  { title: "Parasite", year: 2019 },
  { title: "Whiplash", year: 2014 },
  { title: "Arrival", year: 2016 },
  { title: "In the Mood for Love", year: 2000 },
  { title: "Mad Max: Fury Road", year: 2015 },
];

/**
 * The Phase 0 catalog stub. Proves a full round-trip through the portable
 * `DocumentStore` port: `insert("movies", ...)` then `list("movies", ...)`.
 * Every `Result` error is surfaced in the UI rather than thrown.
 */
export function Catalog({ backend }: CatalogProps): React.JSX.Element {
  const [movies, setMovies] = useState<ReadonlyArray<Movie>>([]);
  const [error, setError] = useState<string | null>(null);
  // Index into SAMPLES; resets whenever the backend instance changes.
  const [nextSample, setNextSample] = useState(0);

  const refresh = useCallback(async (): Promise<void> => {
    const result = await backend.store.list<Movie>("movies", { order: "desc" });
    if (result.ok) {
      setMovies(result.data.items);
      setError(null);
    } else {
      setError(`Could not load movies: ${result.error.message}`);
    }
  }, [backend]);

  // A new backend instance means a fresh (empty) store; reload and reset.
  useEffect(() => {
    setMovies([]);
    setNextSample(0);
    void refresh();
  }, [refresh]);

  const addSample = useCallback(async (): Promise<void> => {
    const sample = SAMPLES[nextSample % SAMPLES.length];
    if (!sample) return;
    setNextSample((n) => n + 1);
    const result = await backend.store.insert("movies", sample);
    if (!result.ok) {
      setError(`Could not add movie: ${result.error.message}`);
      return;
    }
    await refresh();
  }, [backend, nextSample, refresh]);

  return (
    <main>
      <div className="catalog-head">
        <div>
          <h1>Catalog</h1>
          <p>
            A Phase 0 stub. Every movie round-trips through the portable
            <code> backend.store </code> port: insert then list. Switching backend re-creates the
            store, which resets this list.
          </p>
        </div>
        <button type="button" className="add-btn" onClick={() => void addSample()}>
          Add sample movie
        </button>
      </div>

      {error ? (
        <div className="error" role="alert">
          {error}
        </div>
      ) : null}

      {movies.length === 0 ? (
        <div className="empty">
          <p className="big">No movies yet</p>
          <p>Click "Add sample movie" to insert one through the store.</p>
        </div>
      ) : (
        <div className="cards">
          {movies.map((m) => (
            <article className="card" key={m._id}>
              <div className="year">{m.year}</div>
              <h2 className="title">{m.title}</h2>
            </article>
          ))}
        </div>
      )}
    </main>
  );
}
