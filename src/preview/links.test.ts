import { describe, expect, it } from "vitest";
import { isOpenableUrl, linkUrlAt } from "./links";
import { at, mdState } from "./test-helpers";

function urlIn(doc: string, needle: string): string | null {
  const state = mdState(doc);
  return linkUrlAt(state, at(state, needle));
}

describe("linkUrlAt", () => {
  it("reads an inline link", () => {
    expect(urlIn("see [t](https://a.b) now", "t]")).toBe("https://a.b");
  });
  it("resolves a reference link, ignoring case and spacing", () => {
    expect(urlIn("[t][R]\n\n[r]: http://x.y\n", "t]")).toBe("http://x.y");
    expect(urlIn("[t][Some  Ref]\n\n[some ref]: http://x.y\n", "t]")).toBe("http://x.y");
  });
  it("turns an email autolink into mailto", () => {
    expect(urlIn("<a@b.c>", "a@")).toBe("mailto:a@b.c");
  });
  it("reads a bracketed autolink and a bare URL", () => {
    expect(urlIn("<https://a.b>", "a.b")).toBe("https://a.b");
    expect(urlIn("go https://a.b now", "a.b")).toBe("https://a.b");
  });
  it("returns null for plain text and unresolved references", () => {
    expect(urlIn("just text", "text")).toBeNull();
    expect(urlIn("[t][nope]", "t]")).toBeNull();
  });
});

describe("linkUrlAt destinations", () => {
  it("returns a relative destination unchanged, never mailto", () => {
    expect(urlIn("[t](./a.md)", "a.md")).toBe("./a.md");
    expect(isOpenableUrl(urlIn("[t](./a.md)", "a.md")!)).toBe(false);
  });
  it("ignores images and definitions", () => {
    expect(urlIn("![a](p.png)", "p.png")).toBeNull();
    expect(urlIn("![a](p.png)", "a]")).toBeNull();
    expect(urlIn("[r]: ./a.md", "a.md")).toBeNull();
  });
  it("turns a bare email into mailto", () => {
    expect(urlIn("write sales@example.com now", "sales")).toBe("mailto:sales@example.com");
    expect(urlIn("write a@b.co now", "a@")).toBe("mailto:a@b.co");
  });
});

describe("isOpenableUrl", () => {
  it("allows only web and mail", () => {
    expect(isOpenableUrl("HTTPS://x")).toBe(true);
    expect(isOpenableUrl("http://x")).toBe(true);
    expect(isOpenableUrl("mailto:a@b.c")).toBe(true);
    expect(isOpenableUrl("file:///c")).toBe(false);
    expect(isOpenableUrl("javascript:x")).toBe(false);
    expect(isOpenableUrl("./a.md")).toBe(false);
  });
});

describe("linkUrlAt shortcut and collapsed references", () => {
  it("resolves a collapsed reference [t][]", () => {
    expect(urlIn("[t][]\n\n[t]: https://x.y\n", "t]")).toBe("https://x.y");
  });
  it("resolves a shortcut reference [r]", () => {
    expect(urlIn("[r]\n\n[r]: https://x.y\n", "r]")).toBe("https://x.y");
  });
  it("returns null for undefined shortcut and collapsed references", () => {
    expect(urlIn("see [1] here", "1]")).toBeNull();
    expect(urlIn("[t][]", "t]")).toBeNull();
  });
});

describe("linkUrlAt www URLs", () => {
  it("maps a bare www. URL to https", () => {
    expect(urlIn("go www.example.com now", "example")).toBe("https://www.example.com");
    expect(isOpenableUrl(urlIn("go www.example.com now", "example")!)).toBe(true);
  });
});
