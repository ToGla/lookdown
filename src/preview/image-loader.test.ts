import { describe, expect, it, vi } from "vitest";
import { ImageCache, type ImageIO, MAX_IMAGE_BYTES } from "./image-loader";

function setup(size: (path: string) => Promise<number> = async () => 10) {
  const io: ImageIO = {
    size: vi.fn(size),
    read: vi.fn(async () => new Uint8Array([1, 2, 3])),
  };
  const blobs: Blob[] = [];
  const createUrl = vi.fn((b: Blob) => {
    blobs.push(b);
    return "blob:n";
  });
  const revokeUrl = vi.fn();
  const cache = new ImageCache(io, createUrl, revokeUrl);
  return { io, cache, blobs, createUrl, revokeUrl };
}

describe("ImageCache", () => {
  it("loads a png once and returns its url", async () => {
    const { io, cache } = setup();
    expect(await cache.load("/d/i.png")).toEqual({ url: "blob:n" });
    expect(await cache.load("/d/i.png")).toEqual({ url: "blob:n" });
    expect(io.read).toHaveBeenCalledTimes(1);
  });

  it("refuses files over the cap without reading them", async () => {
    const { io, cache } = setup(async () => MAX_IMAGE_BYTES + 1);
    expect(await cache.load("/d/big.png")).toEqual({ error: "too-large" });
    expect(io.read).not.toHaveBeenCalled();
  });

  it("reports a failing size as not found", async () => {
    const { cache } = setup(async () => {
      throw new Error("missing");
    });
    expect(await cache.load("/d/gone.png")).toEqual({ error: "not-found" });
  });

  it("treats unsupported formats as not found, without IO", async () => {
    const { io, cache } = setup();
    expect(await cache.load("/d/x.bmp")).toEqual({ error: "not-found" });
    expect(await cache.load("/d/x.constructor")).toEqual({ error: "not-found" });
    expect(io.size).not.toHaveBeenCalled();
    expect(io.read).not.toHaveBeenCalled();
  });

  it("types an svg blob as image/svg+xml", async () => {
    const { cache, blobs } = setup();
    await cache.load("/d/s.svg");
    expect(blobs[0].type).toBe("image/svg+xml");
  });

  it("retain revokes dropped urls, and the next load reads again", async () => {
    const { io, cache, revokeUrl } = setup();
    await cache.load("/d/i.png");
    cache.retain(new Set());
    expect(revokeUrl).toHaveBeenCalledWith("blob:n");
    await cache.load("/d/i.png");
    expect(io.read).toHaveBeenCalledTimes(2);
  });

  it("retain keeps listed paths", async () => {
    const { io, cache, revokeUrl } = setup();
    await cache.load("/d/i.png");
    cache.retain(new Set(["/d/i.png"]));
    expect(revokeUrl).not.toHaveBeenCalled();
    await cache.load("/d/i.png");
    expect(io.read).toHaveBeenCalledTimes(1);
  });

  it("revokes a url that arrives after its path was dropped", async () => {
    const { cache, revokeUrl } = setup();
    const pending = cache.load("/d/i.png");
    cache.retain(new Set());
    await pending;
    expect(revokeUrl).toHaveBeenCalledWith("blob:n");
  });

  it("forgetFailures makes a failed path load again, but not a loaded one", async () => {
    let fail = false;
    const { io, cache } = setup(async () => {
      if (fail) throw new Error("missing");
      return 10;
    });
    await cache.load("/d/ok.png");
    expect(io.read).toHaveBeenCalledTimes(1);
    fail = true;
    expect(await cache.load("/d/gone.png")).toEqual({ error: "not-found" });
    fail = false;
    expect(await cache.load("/d/gone.png")).toEqual({ error: "not-found" });
    expect(cache.forgetFailures()).toEqual(["/d/gone.png"]);
    expect(cache.forgetFailures()).toEqual([]);
    expect(await cache.load("/d/gone.png")).toEqual({ url: "blob:n" });
  });

  it("forgetFailures keeps successes without reading them again", async () => {
    const { io, cache, revokeUrl } = setup();
    await cache.load("/d/i.png");
    expect(cache.forgetFailures()).toEqual([]);
    await cache.load("/d/i.png");
    expect(io.read).toHaveBeenCalledTimes(1);
    expect(revokeUrl).not.toHaveBeenCalled();
  });
});
