import { describe, expect, it } from "vitest";
import { baseName, parentName, pathKey } from "./paths";

describe("pathKey", () => {
  it("matches equivalent Windows spellings when case-insensitive", () => {
    const a = pathKey("C:\\n\\a.md", true);
    expect(pathKey("c:/n/./a.md", true)).toBe(a);
    expect(pathKey("C:\\n\\sub\\..\\a.md", true)).toBe(a);
  });
  it("keeps case when case-sensitive", () => {
    expect(pathKey("/n/A.md", false)).not.toBe(pathKey("/n/a.md", false));
  });
  it("keeps roots, UNC and relative paths distinct", () => {
    expect(pathKey("/a", false)).not.toBe(pathKey("a", false));
    expect(pathKey("//srv/a", false)).not.toBe(pathKey("/srv/a", false));
    expect(pathKey("\\\\srv\\a", false)).toBe(pathKey("//srv/a", false));
  });
  it("stops .. at the root and drops trailing separators", () => {
    expect(pathKey("/../a", false)).toBe("/a");
    expect(pathKey("C:\\..\\a", false)).toBe("C:/a");
    expect(pathKey("/n/sub/", false)).toBe("/n/sub");
    expect(pathKey("/", false)).toBe("/");
  });
});

describe("baseName / parentName", () => {
  it("splits on either separator", () => {
    expect(baseName("C:\\n\\a.md")).toBe("a.md");
    expect(baseName("/n/b.md")).toBe("b.md");
    expect(parentName("C:\\n\\a.md")).toBe("n");
    expect(parentName("/n/b.md")).toBe("n");
  });
  it("gives empty parent at a root", () => {
    expect(parentName("C:\\a.md")).toBe("");
    expect(parentName("/a.md")).toBe("");
  });
});
