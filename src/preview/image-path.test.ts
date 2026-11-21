import { describe, expect, it } from "vitest";
import { imageMime, resolveImage } from "./image-path";

const local = (path: string) => ({ kind: "local", path });

describe("resolveImage", () => {
  it("joins relative paths to a Windows doc directory", () => {
    expect(resolveImage("C:\\n\\a.md", "img/x.png")).toEqual(local("C:\\n\\img\\x.png"));
  });
  it("resolves .. and percent-decodes", () => {
    expect(resolveImage("C:\\n\\a.md", "../p%20q.png")).toEqual(local("C:\\p q.png"));
  });
  it("strips query and fragment", () => {
    expect(resolveImage("/home/u/a.md", "./i/x.png?v=1#f")).toEqual(local("/home/u/i/x.png"));
  });
  it("keeps drive-letter absolute paths", () => {
    expect(resolveImage("/h/a.md", "C:/x.png")).toEqual(local("C:/x.png"));
  });
  it("unwraps file:// URLs", () => {
    expect(resolveImage("/h/a.md", "file:///C:/x.png")).toEqual(local("C:/x.png"));
    expect(resolveImage("/h/a.md", "file:///home/x.png")).toEqual(local("/home/x.png"));
  });
  it("unwraps file://localhost URLs", () => {
    expect(resolveImage("/h/a.md", "file://localhost/C:/x.png")).toEqual(local("C:/x.png"));
    expect(resolveImage("/h/a.md", "file://LOCALHOST/home/x.png")).toEqual(local("/home/x.png"));
  });
  it("refuses UNC, device and remote-host paths (no network access)", () => {
    const none = { kind: "none" };
    for (const url of [
      "//h/s/x.png",
      String.raw`\\h\s\x.png`,
      String.raw`\/h/s/x.png`,
      String.raw`/\h/s/x.png`,
      "file://h/s/x.png",
      "file://server/share/x.png",
      "file:////h/s/x.png",
      String.raw`\\?\C:\x.png`,
      String.raw`\\.\x`,
      "//?/C:/x.png",
      "%5C%5Ch%5Cs%5Cx.png",
      "%2F%2Fh/s/x.png",
    ]) {
      expect(resolveImage(String.raw`C:\n\a.md`, url), url).toEqual(none);
      expect(resolveImage("/h/a.md", url), url).toEqual(none);
    }
  });
  it("refuses NT-prefix paths and wildcards", () => {
    for (const url of [
      "%5C%3F%3F%5CUNC%5Ch%5Cs%5Cx.png",
      "%5C%3F%3F%5CC:%5Cx.png",
      String.raw`\??\UNC\h\s\x.png`,
      "/%3F%3F/UNC/h/s/x.png",
      "img/x%2A.png",
    ]) {
      expect(resolveImage(String.raw`C:\n\a.md`, url), url).toEqual({ kind: "none" });
      expect(resolveImage("/h/a.md", url), url).toEqual({ kind: "none" });
    }
  });
  it("refuses relative paths under a UNC document", () => {
    expect(resolveImage(String.raw`\\srv\share\a.md`, "x.png")).toEqual({ kind: "none" });
    expect(resolveImage("//srv/share/a.md", "img/x.png")).toEqual({ kind: "none" });
    expect(resolveImage(String.raw`\\srv\share\a.md`, "../../../x.png")).toEqual({ kind: "none" });
  });
  it("never lets .. produce a leading double separator", () => {
    expect(resolveImage("/a.md", "../..//x.png")).toEqual(local("/x.png"));
    expect(resolveImage("/h/a.md", String.raw`..\..\..\x.png`)).toEqual(local("/x.png"));
    expect(resolveImage(String.raw`C:\a.md`, "../../x.png")).toEqual(local(String.raw`C:\x.png`));
  });
  it("converts backslashes in relative paths to the doc separator", () => {
    expect(resolveImage("C:\\n\\a.md", "sub\\x.png")).toEqual(local("C:\\n\\sub\\x.png"));
    expect(resolveImage("/h/a.md", "sub\\x.png")).toEqual(local("/h/sub/x.png"));
  });
  it("returns web URLs unstripped", () => {
    expect(resolveImage("/h/a.md", "https://e.com/i.png")).toEqual({ kind: "web", url: "https://e.com/i.png" });
    expect(resolveImage("/h/a.md", "http://e.com/i.png?a=1")).toEqual({ kind: "web", url: "http://e.com/i.png?a=1" });
  });
  it("rejects other schemes", () => {
    expect(resolveImage("/h/a.md", "data:image/png;base64,AA")).toEqual({ kind: "none" });
  });
  it("keeps raw text when decoding fails", () => {
    expect(resolveImage("/h/a.md", "bad%zz.png")).toEqual(local("/h/bad%zz.png"));
  });
  it("needs a doc path for relative URLs", () => {
    expect(resolveImage(null, "x.png")).toEqual({ kind: "none" });
  });
  it("does not climb above the root", () => {
    expect(resolveImage("/a.md", "../../x.png")).toEqual(local("/x.png"));
  });
});

describe("imageMime", () => {
  it("maps known extensions", () => {
    expect(imageMime("A.PNG")).toBe("image/png");
    expect(imageMime("x.jpg")).toBe("image/jpeg");
    expect(imageMime("x.jpeg")).toBe("image/jpeg");
    expect(imageMime("x.gif")).toBe("image/gif");
    expect(imageMime("x.webp")).toBe("image/webp");
    expect(imageMime("x.svg")).toBe("image/svg+xml");
  });
  it("returns null otherwise", () => {
    expect(imageMime("x.bmp")).toBeNull();
    expect(imageMime("noext")).toBeNull();
  });
  it("ignores inherited object properties", () => {
    expect(imageMime("x.constructor")).toBeNull();
    expect(imageMime("x.toString")).toBeNull();
    expect(imageMime("x.__proto__")).toBeNull();
  });
});
