import type { Backend, DocumentId } from "@baas/core";
import { supportsReactivity } from "@baas/core";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../lib/auth";
import { addReview, deleteReview } from "../lib/reviews";
import type { MarqueeSchema } from "../lib/schema";
import { useLiveQuery } from "../lib/useLiveQuery";

interface ReviewSectionProps {
  readonly backend: Backend<MarqueeSchema>;
  readonly movieId: DocumentId;
}

const RATINGS: readonly number[] = [1, 2, 3, 4, 5];

/** Render a rating as filled/empty stars, e.g. 4 -> "★★★★☆". */
function stars(rating: number): string {
  const filled = Math.max(0, Math.min(5, Math.round(rating)));
  return "★★★★★".slice(0, filled) + "☆☆☆☆☆".slice(0, 5 - filled);
}

/**
 * Phase 4 reviews UI for the movie detail page. The review feed + aggregate
 * rating are LIVE: both ride `store.subscribe()` through `useLiveQuery`, so a
 * review posted in another tab (or by another user) appears here without a
 * reload — natively on Convex, and on Supabase via its Realtime watch. A local
 * `refreshKey` bump after the user's OWN write makes the same tab update
 * instantly rather than waiting on the realtime round-trip. All permission
 * enforcement lives in the backend; this only shows or hides controls and
 * surfaces whatever message a write returns.
 */
export function ReviewSection({ backend, movieId }: ReviewSectionProps): React.JSX.Element {
  const { user } = useAuth();

  // Bumped after the signed-in user's own write to force an immediate re-read
  // (cross-tab/other-user changes arrive through the live subscription itself).
  const [refreshKey, setRefreshKey] = useState(0);
  const reviewsState = useLiveQuery(backend, "movieReviews", { movieId }, refreshKey);
  const ratingState = useLiveQuery(backend, "movieRating", { movieId }, refreshKey);

  const reviews = reviewsState.data ?? [];
  const rating = ratingState.data ?? { avg: 0, count: 0 };
  const loading = reviewsState.loading;
  const loadError = reviewsState.error;
  const live = supportsReactivity(backend);

  // The add/edit form's own state and the action-level error (writes).
  const [formRating, setFormRating] = useState(5);
  const [formBody, setFormBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const myReview = user ? (reviews.find((r) => r.userId === user.userId) ?? null) : null;

  const refresh = useCallback((): void => setRefreshKey((k) => k + 1), []);

  // Seed the form from the user's existing review whenever it (or the user) changes.
  useEffect(() => {
    setActionError(null);
    if (myReview) {
      setFormRating(myReview.rating);
      setFormBody(myReview.body);
    } else {
      setFormRating(5);
      setFormBody("");
    }
  }, [myReview]);

  // addReview upserts, so submit handles both the first review and edits of it.
  const submit = useCallback(async (): Promise<void> => {
    setBusy(true);
    setActionError(null);
    const result = await addReview(backend, movieId, formRating, formBody.trim());
    setBusy(false);
    if (!result.ok) {
      setActionError(result.message);
      return;
    }
    refresh();
  }, [backend, movieId, formRating, formBody, refresh]);

  const remove = useCallback(
    async (reviewId: string): Promise<void> => {
      setBusy(true);
      setActionError(null);
      const result = await deleteReview(backend, reviewId);
      setBusy(false);
      if (!result.ok) {
        setActionError(result.message);
        return;
      }
      refresh();
    },
    [backend, refresh],
  );

  const heading =
    rating.count === 0
      ? "No reviews yet"
      : `${stars(rating.avg)} ${rating.avg.toFixed(1)} · ${rating.count} ${
          rating.count === 1 ? "review" : "reviews"
        }`;

  // Reviews other than the signed-in user's own (theirs renders in the form).
  const otherReviews = myReview ? reviews.filter((r) => r._id !== myReview._id) : reviews;

  return (
    <section className="reviews" aria-label="Reviews">
      <div className="reviews-head">
        <h2 className="reviews-heading">{heading}</h2>
        <span className="live-badge" title={live ? "Reviews update live" : "One-shot read"}>
          {live ? "● live" : "○ static"}
        </span>
      </div>

      {loadError ? (
        <div className="error" role="alert">
          {loadError}
        </div>
      ) : null}

      {loading ? (
        <p className="muted-note">Loading reviews…</p>
      ) : (
        <>
          {actionError ? (
            <div className="error" role="alert">
              {actionError}
            </div>
          ) : null}

          {user ? (
            <form
              className="review-form"
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              <div className="review-form-head">
                <span className="field-label">{myReview ? "Your review" : "Add your review"}</span>
                <div className="rating-picker" role="radiogroup" aria-label="Your rating">
                  {RATINGS.map((value) => (
                    <button
                      type="button"
                      key={value}
                      className={value <= formRating ? "star-btn on" : "star-btn"}
                      aria-label={`${value} star${value === 1 ? "" : "s"}`}
                      aria-pressed={value === formRating}
                      onClick={() => setFormRating(value)}
                    >
                      {value <= formRating ? "★" : "☆"}
                    </button>
                  ))}
                  <span className="rating-value">{formRating}/5</span>
                </div>
              </div>
              <textarea
                className="text-input textarea"
                placeholder="What did you think?"
                value={formBody}
                onChange={(e) => setFormBody(e.target.value)}
              />
              <div className="form-actions">
                <button type="submit" className="add-btn" disabled={busy}>
                  {busy ? "Saving…" : myReview ? "Update review" : "Post review"}
                </button>
                {myReview ? (
                  <button
                    type="button"
                    className="link-btn"
                    disabled={busy}
                    onClick={() => void remove(myReview._id)}
                  >
                    Delete
                  </button>
                ) : null}
              </div>
            </form>
          ) : (
            <p className="muted-note">Sign in to leave a review.</p>
          )}

          {otherReviews.length > 0 ? (
            <ul className="review-list">
              {otherReviews.map((r) => (
                <li key={r._id} className="review-row">
                  <div className="review-rating" role="img" aria-label={`${r.rating} out of 5`}>
                    <span aria-hidden="true">{stars(r.rating)}</span>{" "}
                    <span className="review-rating-num">{r.rating}/5</span>
                  </div>
                  <p className="review-body">{r.body || "No comment."}</p>
                </li>
              ))}
            </ul>
          ) : !myReview ? (
            <p className="muted-note">Be the first to review this movie.</p>
          ) : null}
        </>
      )}
    </section>
  );
}
