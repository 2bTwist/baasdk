import type { Backend, FileHandle } from "@baas/core";
import type { Outcome } from "./movies";

/**
 * Phase 4: poster upload/render through the portable file port. The SAME two
 * calls work on both backends — the adapter hides the divergence (Supabase
 * Storage buckets/paths vs Convex's generate-URL-then-POST dance). The opaque
 * `FileHandle` is persisted on the movie row as `posterFile` (a plain string);
 * we round-trip it through the brand here.
 */

/** Upload poster bytes and return the opaque handle to persist on the movie. */
export async function uploadPoster(
  backend: Backend,
  file: Blob,
  contentType?: string,
): Promise<Outcome<string>> {
  // Only set contentType when known (exactOptionalPropertyTypes forbids an
  // explicit `undefined` on the optional field).
  const type = contentType ?? (file instanceof File ? file.type : "");
  const r = await backend.files.upload(file, {
    path: `poster-${Date.now()}`,
    ...(type ? { contentType: type } : {}),
  });
  return r.ok ? { ok: true, data: r.data as string } : { ok: false, message: r.error.message };
}

/** Resolve a stored poster handle to a fetchable URL, or null if it is gone. */
export async function posterUrl(backend: Backend, handle: string): Promise<Outcome<string | null>> {
  const r = await backend.files.getUrl(handle as FileHandle, { expiresInSeconds: 3600 });
  return r.ok ? { ok: true, data: r.data } : { ok: false, message: r.error.message };
}
