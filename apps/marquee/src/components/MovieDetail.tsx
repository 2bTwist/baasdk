import type { Backend, DocumentId } from "@baas/core";
import { useEffect, useState } from "react";
import { type Genre, getMovie, listGenres, type Movie, type WithId } from "../lib/movies";

interface MovieDetailProps {
  readonly backend: Backend;
  readonly movieId: DocumentId;
  readonly onBack: () => void;
  readonly onEdit: (id: DocumentId) => void;
}

/** Render a runtime in minutes as e.g. "2h 16m" (or "94m" under an hour). */
function formatRuntime(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return "Unknown runtime";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/**
 * Full movie detail via the portable `get`. Genre slugs are resolved to display
 * names from the genre collection (a client-side lookup, not a join, which stays
 * Phase 2). Surfaces every store error rather than throwing.
 */
export function MovieDetail({
  backend,
  movieId,
  onBack,
  onEdit,
}: MovieDetailProps): React.JSX.Element {
  const [movie, setMovie] = useState<WithId<Movie> | null>(null);
  const [genreNames, setGenreNames] = useState<ReadonlyMap<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void (async () => {
      const [movieResult, genreResult] = await Promise.all([
        getMovie(backend, movieId),
        listGenres(backend),
      ]);
      if (!active) return;
      if (genreResult.ok) {
        setGenreNames(new Map(genreResult.data.map((g: WithId<Genre>) => [g.slug, g.name])));
      }
      if (!movieResult.ok) setError(movieResult.message);
      else if (movieResult.data === null) setError("That movie no longer exists.");
      else setMovie(movieResult.data);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [backend, movieId]);

  const genreLabel = (slug: string): string => genreNames.get(slug) ?? slug;

  return (
    <main className="detail-view">
      <button type="button" className="link-btn" onClick={onBack}>
        ← Back to catalog
      </button>

      {error ? (
        <div className="error" role="alert">
          {error}
        </div>
      ) : null}

      {loading ? (
        <p className="muted-note">Loading…</p>
      ) : movie ? (
        <article className="detail">
          <div className="detail-poster" aria-hidden="true">
            <span className="poster-initial">{movie.title.charAt(0).toUpperCase()}</span>
          </div>
          <div className="detail-body">
            <div className="detail-meta">
              {movie.year} · {formatRuntime(movie.runtime)} · {genreLabel(movie.primaryGenre)}
            </div>
            <h1 className="detail-title">{movie.title}</h1>
            <p className="detail-director">Directed by {movie.director || "Unknown"}</p>

            {movie.genres.length > 0 ? (
              <div className="detail-genres">
                {movie.genres.map((slug) => (
                  <span key={slug} className="genre-tag">
                    {genreLabel(slug)}
                  </span>
                ))}
              </div>
            ) : null}

            <p className="detail-synopsis">{movie.synopsis || "No synopsis yet."}</p>

            <div className="form-actions">
              <button type="button" className="add-btn" onClick={() => onEdit(movie._id)}>
                Edit
              </button>
              <button type="button" className="link-btn" onClick={onBack}>
                Back
              </button>
            </div>
          </div>
        </article>
      ) : null}
    </main>
  );
}
