// Loads local images into object URLs, memoized per path.

import { imageMime } from "./image-path";

export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export interface ImageIO {
  size(path: string): Promise<number>;
  read(path: string): Promise<Uint8Array>;
}

export type Loaded = { url: string } | { error: "not-found" | "too-large" };

export class ImageCache {
  private entries = new Map<string, Promise<Loaded>>();
  private urls = new Map<string, string>();
  private failed = new Set<string>();

  constructor(
    private io: ImageIO,
    private createUrl: (b: Blob) => string = (b) => URL.createObjectURL(b),
    private revokeUrl: (url: string) => void = (url) => URL.revokeObjectURL(url),
  ) {}

  /** Memoized per path: unknown formats are not-found and files over the cap too-large, both without reading. */
  load(path: string): Promise<Loaded> {
    let entry = this.entries.get(path);
    if (!entry) {
      entry = this.fetch(path);
      this.entries.set(path, entry);
      const pending = entry;
      void pending.then((r) => {
        if (!("url" in r)) {
          if (this.entries.get(path) === pending) this.failed.add(path);
          return;
        }
        // Dropped by retain while loading: nothing will use the URL.
        if (this.entries.get(path) === pending) this.urls.set(path, r.url);
        else this.revokeUrl(r.url);
      });
    }
    return entry;
  }

  /** Revokes and forgets every entry whose path is not in `paths`. */
  retain(paths: Set<string>): void {
    for (const path of [...this.entries.keys()]) {
      if (paths.has(path)) continue;
      this.entries.delete(path);
      this.failed.delete(path);
      const url = this.urls.get(path);
      if (url !== undefined) {
        this.urls.delete(path);
        this.revokeUrl(url);
      }
    }
  }

  /** Drops memoized failures (not successes), so the next `load` of those paths reads again. */
  forgetFailures(): void {
    for (const path of this.failed) this.entries.delete(path);
    this.failed.clear();
  }

  private async fetch(path: string): Promise<Loaded> {
    const mime = imageMime(path);
    // imageMime can return an inherited property for names like "x.constructor".
    if (typeof mime !== "string") return { error: "not-found" };
    try {
      if ((await this.io.size(path)) > MAX_IMAGE_BYTES) return { error: "too-large" };
      const bytes = await this.io.read(path);
      return { url: this.createUrl(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mime })) };
    } catch {
      return { error: "not-found" };
    }
  }
}
