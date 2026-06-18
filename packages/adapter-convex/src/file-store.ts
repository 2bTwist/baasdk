/**
 * `ConvexFileStore`, the FileStore port over Convex storage.
 *
 * Upload is the two-step Convex dance: ask the deployed `generateUploadUrl`
 * helper for a short-lived URL, then POST the bytes to it; the response carries
 * the `storageId`, which IS the opaque `FileHandle`. `getUrl` returns a stable
 * URL that 404s after delete (not a custom-expiry signed URL), so
 * `expiresInSeconds` is advisory and ignored on Convex.
 */

import {
  type Capabilities,
  err,
  type FileHandle,
  type FileStore,
  ok,
  type Result,
  type UploadOptions,
} from "@baas/core";
import type { ConvexClient } from "convex/browser";
import type { FunctionReference } from "convex/server";
import { toBackendError } from "./errors.js";

/** Typed references to the deployed storage helpers (the `./convex` entry). */
export interface StorageRefs {
  readonly generateUploadUrl: FunctionReference<
    "mutation",
    "public",
    Record<string, never>,
    string
  >;
  readonly getFileUrl: FunctionReference<"query", "public", { storageId: string }, string | null>;
  readonly deleteFile: FunctionReference<"mutation", "public", { storageId: string }, null>;
}

export class ConvexFileStore implements FileStore {
  readonly capabilities: Pick<Capabilities, "fileStorage">;

  constructor(
    private readonly client: ConvexClient,
    private readonly refs: StorageRefs,
    enabled: boolean,
  ) {
    this.capabilities = { fileStorage: enabled };
  }

  async upload(data: Blob | ArrayBuffer, options?: UploadOptions): Promise<Result<FileHandle>> {
    try {
      const uploadUrl = await this.client.mutation(this.refs.generateUploadUrl, {});
      const body = data instanceof Blob ? data : new Blob([data]);
      const res = await fetch(uploadUrl, {
        method: "POST",
        headers: options?.contentType ? { "Content-Type": options.contentType } : {},
        body,
      });
      if (!res.ok) {
        return err({ code: "network", message: `upload failed: ${res.status} ${res.statusText}` });
      }
      const { storageId } = (await res.json()) as { storageId: string };
      return ok(storageId as FileHandle);
    } catch (e) {
      return err(toBackendError(e));
    }
  }

  async getUrl(
    handle: FileHandle,
    _options?: { expiresInSeconds?: number },
  ): Promise<Result<string | null>> {
    try {
      // Convex returns null once the file is deleted.
      const url = await this.client.query(this.refs.getFileUrl, { storageId: handle });
      return ok(url);
    } catch (e) {
      return err(toBackendError(e));
    }
  }

  async download(handle: FileHandle): Promise<Result<Blob>> {
    const urlResult = await this.getUrl(handle);
    if (!urlResult.ok) return urlResult;
    if (urlResult.data === null) return err({ code: "not_found", message: `no file ${handle}` });
    try {
      const res = await fetch(urlResult.data);
      if (!res.ok) return err({ code: "not_found", message: `file fetch failed: ${res.status}` });
      return ok(await res.blob());
    } catch (e) {
      return err(toBackendError(e));
    }
  }

  async remove(handle: FileHandle): Promise<Result<void>> {
    try {
      await this.client.mutation(this.refs.deleteFile, { storageId: handle });
      return ok(undefined);
    } catch (e) {
      return err(toBackendError(e));
    }
  }

  native(): ConvexClient {
    return this.client;
  }
}
