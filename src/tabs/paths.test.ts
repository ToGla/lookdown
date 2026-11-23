import { describe, expect, it, test } from "vitest";
import { baseName, newFileDefaultPath, parentName, pathKey, withMarkdownExtension } from "./paths";

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

describe("withMarkdownExtension", () => {
  test("appends .md when the name has no extension", () => {
    expect(withMarkdownExtension("/p/idea")).toBe("/p/idea.md");
    expect(withMarkdownExtension("/p/.notes")).toBe("/p/.notes.md");
    expect(withMarkdownExtension("/p/my.project/idea")).toBe("/p/my.project/idea.md");
    expect(withMarkdownExtension("C:\\my.project\\idea")).toBe("C:\\my.project\\idea.md");
  });
  test("keeps any existing extension", () => {
    for (const p of ["/p/idea.md", "/p/idea.markdown", "/p/idea.txt", "C:\\p\\idea.md"])
      expect(withMarkdownExtension(p)).toBe(p);
  });
});

describe("newFileDefaultPath", () => {
  test("without a tab it is just the default name", () => {
    expect(newFileDefaultPath(null)).toBe("untitled.md");
  });
  test("default path keeps native separators", () => {
    expect(newFileDefaultPath("/docs/a.md")).toBe("/docs/untitled.md");
    expect(newFileDefaultPath("C:\\notes\\a.md")).toBe("C:\\notes\\untitled.md");
  });
});
