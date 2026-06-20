import type { CastMember } from "../lib/schema";

interface CastListProps {
  /** The ordered cast/crew from `getMovieCredits` (already sorted by billing). */
  readonly cast: ReadonlyArray<CastMember>;
  /** A short caption declaring HOW the cast loaded on the active backend. */
  readonly mechanism: string;
}

/**
 * Presentational cast/crew section for the detail page. Splits the credits join
 * into the director(s) (role "director") and the billed actors (role "actor"),
 * then renders each actor as "name as character". The `mechanism` caption makes
 * the Phase 2 thesis visible: the same UI, a per-backend divergent join, declared
 * honestly. Pure render, no data access.
 */
export function CastList({ cast, mechanism }: CastListProps): React.JSX.Element {
  const directors = cast.filter((c) => c.role === "director");
  const actors = cast.filter((c) => c.role === "actor");

  return (
    <section className="cast" aria-label="Cast and crew">
      {directors.length > 0 ? (
        <p className="detail-director">Directed by {directors.map((d) => d.name).join(", ")}</p>
      ) : null}

      {actors.length > 0 ? (
        <ul className="cast-list">
          {actors.map((actor) => (
            <li key={`${actor.name}-${actor.billing}`} className="cast-row">
              <span className="cast-name">{actor.name}</span>
              {actor.character ? (
                <span className="cast-character"> as {actor.character}</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      <p className="divergence-note">{mechanism}</p>
    </section>
  );
}
