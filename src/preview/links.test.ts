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
