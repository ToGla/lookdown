import { describe, expect, it } from "vitest";
import { buildDecorations } from "./decorations";
import { describeDecorations, mdState } from "./test-helpers";

function run(doc: string, opts: Parameters<typeof mdState>[1] = {}): string[] {
  const s = mdState(doc, opts);
  return describeDecorations(buildDecorations(s, 0, s.doc.length)).sort();
}
const sorted = (a: string[]) => [...a].sort();

describe("inline decorations", () => {
  it("bold", () => {
    expect(run("**bold**")).toEqual(sorted(["mark cm-ld-strong 0-8", "hide 0-2", "hide 6-8"]));
  });
  it("emphasis with * and _", () => {
    expect(run("*em*")).toEqual(sorted(["mark cm-ld-em 0-4", "hide 0-1", "hide 3-4"]));
    expect(run("_em_")).toEqual(sorted(["mark cm-ld-em 0-4", "hide 0-1", "hide 3-4"]));
  });
  it("strikethrough", () => {
    expect(run("~~s~~")).toEqual(sorted(["mark cm-ld-strike 0-5", "hide 0-2", "hide 3-5"]));
  });
  it("inline code", () => {
    expect(run("`c`")).toEqual(sorted(["mark cm-ld-code 0-3", "hide 0-1", "hide 2-3"]));
  });
  it("inline link", () => {
    expect(run("[text](https://x.y)")).toEqual(
      sorted(["mark cm-ld-link 1-5", "hide 0-1", "hide 5-19"]),
    );
  });
  it("reference link", () => {
    const doc = "[t][r]\n\n[r]: https://x.y";
    expect(run(doc)).toEqual(sorted(["mark cm-ld-link 1-2", "hide 0-1", "hide 2-6"]));
  });
  it("autolink", () => {
    expect(run("<https://x.y>")).toEqual(
      sorted(["mark cm-ld-link 1-12", "hide 0-1", "hide 12-13"]),
    );
  });
  it("bare url", () => {
    expect(run("https://x.y")).toEqual(["mark cm-ld-link 0-11"]);
  });
  it("revealed line keeps styles", () => {
    expect(run("**bold**", { selection: { anchor: 3 }, reveal: true })).toEqual([
      "mark cm-ld-strong 0-8",
    ]);
  });
  it("code protects contents", () => {
    expect(run("`**x**`")).toEqual(sorted(["mark cm-ld-code 0-7", "hide 0-1", "hide 6-7"]));
  });
  it("stray syntax", () => {
    expect(run("**open")).toEqual([]);
    expect(run("a * b")).toEqual([]);
  });
  it("emphasis inside link", () => {
    expect(run("[**b**](u)")).toEqual(
      sorted([
        "mark cm-ld-link 1-6",
        "mark cm-ld-strong 1-6",
        "hide 0-1",
        "hide 1-3",
        "hide 4-6",
        "hide 6-10",
      ]),
    );
  });
  it("range limit", () => {
    const s = mdState("**a**\n**b**\n**c**");
    const l2 = s.doc.line(2);
    const got = describeDecorations(buildDecorations(s, l2.from, l2.to)).sort();
    expect(got).toEqual(sorted(["mark cm-ld-strong 6-11", "hide 6-8", "hide 9-11"]));
  });
});
