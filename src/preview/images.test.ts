import { describe, expect, it } from "vitest";
import { buildDecorations } from "./decorations";
import { imageBlocks, imageField } from "./images";
import { at, describeDecorations, mdState } from "./test-helpers";

const D = { docPath: "/d/a.md" };

function decos(doc: string, opts: Parameters<typeof mdState>[1] = {}): string[] {
  const s = mdState(doc, { ...D, ...opts });
  return describeDecorations(buildDecorations(s, 0, s.doc.length));
}

describe("imageBlocks", () => {
  it("gives one block per image at the end of its line, in order, resolving references", () => {
    const doc = "x ![a](i.png) ![b][r]\n\n[r]: j.png";
    const s = mdState(doc, D);
    const end = s.doc.line(1).to;
    expect(imageBlocks(s)).toEqual([
      { pos: end, alt: "a", source: { kind: "local", path: "/d/i.png" }, href: null },
      { pos: end, alt: "b", source: { kind: "local", path: "/d/j.png" }, href: null },
    ]);
  });

  it("imageField holds the same blocks as block widgets", () => {
    const s = mdState("x ![a](i.png) ![b](k.png)", D);
    const out = describeDecorations(s.field(imageField));
    const end = s.doc.length;
    expect(out).toEqual([`widget image ${end}-${end}`, `widget image ${end}-${end}`]);
  });

  it("takes href from an enclosing openable link", () => {
    const [b] = imageBlocks(mdState("[![a](i.png)](https://e.com)", D));
    expect(b.href).toBe("https://e.com");
    expect(b.source).toEqual({ kind: "local", path: "/d/i.png" });
  });

  it("ignores an enclosing link that is not openable", () => {
    const [b] = imageBlocks(mdState("[![a](i.png)](other.md)", D));
    expect(b.href).toBeNull();
  });

  it("marks web images", () => {
    const [b] = imageBlocks(mdState("![w](https://e.com/p.png)", D));
    expect(b.source).toEqual({ kind: "web", url: "https://e.com/p.png" });
  });

  it("an image in a grid cell is a chip, not a block", () => {
    const doc = "| a | b |\n|---|---|\n| ![c](i.png) | d |";
    const s = mdState(doc, D);
    expect(imageBlocks(s)).toEqual([]);
    const from = at(s, "![c]");
    expect(decos(doc)).toContain(`widget image-chip ${from}-${from + "![c](i.png)".length}`);
  });

  it("hides the image syntax unless revealed", () => {
    expect(decos("![a](i.png)")).toEqual(["hide 0-11"]);
    expect(decos("![a](i.png)", { reveal: true, selection: { anchor: 3 } })).toEqual([]);
  });

  it("images in a heading, list item or quote give a block at that line's end", () => {
    for (const doc of ["# T ![a](i.png)\n\nnext", "- ![a](i.png)\n- next", "> ![a](i.png)\n> more"]) {
      const s = mdState(doc, D);
      expect(imageBlocks(s).map((b) => b.pos)).toEqual([s.doc.line(1).to]);
    }
  });
});
