import type { Backend, DocumentId } from "@baas/core";
import { useCallback, useEffect, useState } from "react";
import {
  createMovie,
  type Genre,
  getMovie,
  listGenres,
  type Movie,
  updateMovie,
  type WithId,
} from "../lib/movies";

interface MovieFormProps {
  readonly backend: Backend;
  /** Editing an existing movie when set; otherwise a create form. */
  readonly movieId?: DocumentId;
  /** Called with the saved movie's id so the caller can navigate to its detail. */
  readonly onSaved: (id: DocumentId) => void;
  readonly onCancel: () => void;
}

/** The editable form state. Numbers are kept as strings so inputs can be empty mid-edit. */
interface FormState {
  title: string;
  year: string;
  runtime: string;
  director: string;
  synopsis: string;
  /** Selected genre slugs. The first selected is the primary genre. */
  genres: readonly string[];
  /** The primary genre slug; must be one of `genres`. */
  primaryGenre: string;
}

const EMPTY: FormState = {
  title: "",
  year: "",
  runtime: "",
  director: "",
  synopsis: "",
  genres: [],
  primaryGenre: "",
};

/** Seed form state from a loaded movie. */
function fromMovie(movie: Movie): FormState {
  return {
    title: movie.title,
    year: String(movie.year),
    runtime: String(movie.runtime),
    director: movie.director,
    synopsis: movie.synopsis,
    genres: movie.genres,
    primaryGenre: movie.primaryGenre,
  };
}

/**
 * Create or edit a movie through the portable store. An empty `movieId` inserts;
 * a present one loads the movie, pre-fills, and patches on save. Genre selection
 * is a multi-select; the primary genre is picked from the chosen genres.
 */
export function MovieForm({
  backend,
  movieId,
  onSaved,
  onCancel,
}: MovieFormProps): React.JSX.Element {
  const editing = movieId !== undefined;
  const [form, setForm] = useState<FormState>(EMPTY);
  const [genres, setGenres] = useState<ReadonlyArray<WithId<Genre>>>([]);
  const [loading, setLoading] = useState(editing);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load the genre list for the multi-select, plus the movie when editing.
  useEffect(() => {
    let active = true;
    setError(null);
    setLoading(editing);
    void (async () => {
      const genreResult = await listGenres(backend);
      if (!active) return;
      if (genreResult.ok) setGenres(genreResult.data);
      else setError(genreResult.message);

      if (movieId !== undefined) {
        const movieResult = await getMovie(backend, movieId);
        if (!active) return;
        if (!movieResult.ok) setError(movieResult.message);
        else if (movieResult.data === null) setError("That movie no longer exists.");
        else setForm(fromMovie(movieResult.data));
        setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [backend, movieId, editing]);

  const set = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]): void => {
    setForm((prev) => ({ ...prev, [key]: value }));
  }, []);

  /** Toggle a genre slug, keeping `primaryGenre` valid (it must stay selected). */
  const toggleGenre = useCallback((slug: string): void => {
    setForm((prev) => {
      const has = prev.genres.includes(slug);
      const next = has ? prev.genres.filter((g) => g !== slug) : [...prev.genres, slug];
      let primary = prev.primaryGenre;
      if (has && primary === slug) primary = next[0] ?? "";
      if (!has && primary === "") primary = slug;
      return { ...prev, genres: next, primaryGenre: primary };
    });
  }, []);

  /** Validate, then insert or patch. Surfaces any store error rather than throwing. */
  const save = useCallback(
    async (event: React.FormEvent): Promise<void> => {
      event.preventDefault();
      const year = Number(form.year);
      const runtime = Number(form.runtime);
      if (!form.title.trim()) return setError("A title is required.");
      if (!Number.isFinite(year) || year === 0) return setError("Enter a valid year.");
      if (!Number.isFinite(runtime) || runtime <= 0) return setError("Enter a runtime in minutes.");
      if (form.genres.length === 0) return setError("Pick at least one genre.");
      const primaryGenre = form.primaryGenre || (form.genres[0] ?? "");

      const value: Movie = {
        title: form.title.trim(),
        year,
        runtime,
        director: form.director.trim(),
        synopsis: form.synopsis.trim(),
        genres: form.genres,
        primaryGenre,
      };

      setSaving(true);
      setError(null);
      if (movieId !== undefined) {
        const result = await updateMovie(backend, movieId, value);
        setSaving(false);
        if (!result.ok) return setError(result.message);
        onSaved(movieId);
      } else {
        const result = await createMovie(backend, value);
        setSaving(false);
        if (!result.ok) return setError(result.message);
        onSaved(result.data);
      }
    },
    [backend, form, movieId, onSaved],
  );

  const heading = editing ? "Edit movie" : "Add movie";

  return (
    <main className="form-view">
      <button type="button" className="link-btn" onClick={onCancel}>
        ← Cancel
      </button>
      <h1 className="form-title">{heading}</h1>

      {error ? (
        <div className="error" role="alert">
          {error}
        </div>
      ) : null}

      {loading ? (
        <p className="muted-note">Loading…</p>
      ) : (
        <form className="movie-form" onSubmit={(e) => void save(e)}>
          <label className="field">
            <span className="field-label">Title</span>
            <input
              className="text-input"
              type="text"
              value={form.title}
              onChange={(e) => set("title", e.target.value)}
              autoComplete="off"
            />
          </label>

          <div className="field-row">
            <label className="field">
              <span className="field-label">Year</span>
              <input
                className="text-input"
                type="number"
                inputMode="numeric"
                value={form.year}
                onChange={(e) => set("year", e.target.value)}
              />
            </label>
            <label className="field">
              <span className="field-label">Runtime (min)</span>
              <input
                className="text-input"
                type="number"
                inputMode="numeric"
                value={form.runtime}
                onChange={(e) => set("runtime", e.target.value)}
              />
            </label>
          </div>

          <label className="field">
            <span className="field-label">Director</span>
            <input
              className="text-input"
              type="text"
              value={form.director}
              onChange={(e) => set("director", e.target.value)}
              autoComplete="off"
            />
          </label>

          <label className="field">
            <span className="field-label">Synopsis</span>
            <textarea
              className="text-input textarea"
              rows={4}
              value={form.synopsis}
              onChange={(e) => set("synopsis", e.target.value)}
            />
          </label>

          <div className="field">
            <span className="field-label">Genres</span>
            <div className="genre-chips">
              {genres.map((g) => {
                const selected = form.genres.includes(g.slug);
                return (
                  <button
                    key={g._id}
                    type="button"
                    className={selected ? "chip on" : "chip"}
                    aria-pressed={selected}
                    onClick={() => toggleGenre(g.slug)}
                  >
                    {g.name}
                  </button>
                );
              })}
            </div>
          </div>

          {form.genres.length > 0 ? (
            <label className="field">
              <span className="field-label">Primary genre</span>
              <select
                className="text-input"
                value={form.primaryGenre}
                onChange={(e) => set("primaryGenre", e.target.value)}
              >
                {form.genres.map((slug) => {
                  const match = genres.find((g) => g.slug === slug);
                  return (
                    <option key={slug} value={slug}>
                      {match ? match.name : slug}
                    </option>
                  );
                })}
              </select>
            </label>
          ) : null}

          <div className="form-actions">
            <button type="submit" className="add-btn" disabled={saving}>
              {saving ? "Saving…" : editing ? "Save changes" : "Create movie"}
            </button>
            <button type="button" className="link-btn" onClick={onCancel} disabled={saving}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </main>
  );
}
