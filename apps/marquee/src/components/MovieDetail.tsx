import type { Backend, DocumentId } from "@baas/core";
import { useEffect, useState } from "react";
import { useAuth } from "../lib/auth";
import { getMovieCredits, joinsServerSide } from "../lib/enrich";
import { posterUrl } from "../lib/files";
import { type Genre, getMovie, listGenres, type Movie, type WithId } from "../lib/movies";
import type { CastMember, MarqueeSchema } from "../lib/schema";
import { CastList } from "./CastList";
import { ReviewSection } from "./ReviewSection";

interface MovieDetailProps {
  readonly backend: Backend<MarqueeSchema>;
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
  const { canEditCatalog } = useAuth();
  const [movie, setMovie] = useState<WithId<Movie> | null>(null);
  const [genreNames, setGenreNames] = useState<ReadonlyMap<string, string>>(new Map());
  const [cast, setCast] = useState<ReadonlyArray<CastMember>>([]);
  const [castError, setCastError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [posterSrc, setPosterSrc] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setCast([]);
    setCastError(null);
    void (async () => {
      const [movieResult, genreResult, creditsResult] = await Promise.all([
        getMovie(backend, movieId),
        listGenres(backend),
        getMovieCredits(backend, movieId),
      ]);
      if (!active) return;
      if (genreResult.ok) {
        setGenreNames(new Map(genreResult.data.map((g: WithId<Genre>) => [g.slug, g.name])));
      }
      if (creditsResult.ok) setCast(creditsResult.data);
      else setCastError(creditsResult.message);
      if (!movieResult.ok) setError(movieResult.message);
      else if (movieResult.data === null) setError("That movie no longer exists.");
      else setMovie(movieResult.data);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [backend, movieId]);

  // Resolve the movie's poster handle to a URL through the portable file port.
  // The SAME getUrl works on Supabase Storage and Convex storage.
  useEffect(() => {
    let active = true;
    const handle = movie?.posterFile;
    if (!handle) {
      setPosterSrc(null);
      return;
    }
    void (async () => {
      const result = await posterUrl(backend, handle);
      if (active && result.ok) setPosterSrc(result.data);
    })();
    return () => {
      active = false;
    };
  }, [backend, movie?.posterFile]);

  const genreLabel = (slug: string): string => genreNames.get(slug) ?? slug;

  // How the credits join ran on the active backend (the Phase 2 thesis, made visible).
  const castMechanism = joinsServerSide(backend)
    ? "Cast joined server-side."
    : "Cast assembled by following references.";

  // Did the join surface any director? If not, fall back to the denormalized string.
  const hasJoinedDirector = cast.some((c) => c.role === "director");

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
          <div className="detail-poster">
            {posterSrc ? (
              <img className="detail-poster-img" src={posterSrc} alt={`${movie.title} poster`} />
            ) : (
              <span className="poster-initial" aria-hidden="true">
                {movie.title.charAt(0).toUpperCase()}
              </span>
            )}
          </div>
          <div className="detail-body">
            <div className="detail-meta">
              {movie.year} · {formatRuntime(movie.runtime)} · {genreLabel(movie.primaryGenre)}
            </div>
            <h1 className="detail-title">{movie.title}</h1>

            {castError ? (
              <div className="error" role="alert">
                {castError}
              </div>
            ) : cast.length > 0 ? (
              <>
                {!hasJoinedDirector && movie.director ? (
                  <p className="detail-director">Directed by {movie.director}</p>
                ) : null}
                <CastList cast={cast} mechanism={castMechanism} />
              </>
            ) : (
              <>
                <p className="detail-director">Directed by {movie.director || "Unknown"}</p>
                <p className="muted-note">No cast listed.</p>
              </>
            )}

            {/* Defensive: a schemaless backend (Convex) omits a field that was
                never written, so `genres` can be undefined even though the type
                says otherwise; Supabase fills it from a column default. */}
            {(movie.genres ?? []).length > 0 ? (
              <div className="detail-genres">
                {(movie.genres ?? []).map((slug) => (
                  <span key={slug} className="genre-tag">
                    {genreLabel(slug)}
                  </span>
                ))}
              </div>
            ) : null}

            <p className="detail-synopsis">{movie.synopsis || "No synopsis yet."}</p>

            <ReviewSection backend={backend} movieId={movieId} />

            <div className="form-actions">
              {canEditCatalog ? (
                <button type="button" className="add-btn" onClick={() => onEdit(movieId)}>
                  Edit
                </button>
              ) : null}
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
