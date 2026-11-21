import { describe, expect, it } from "vitest";
import { EditorSelection } from "@codemirror/state";
import { isRevealed, revealedRanges } from "./reveal";
import { at, mdState } from "./test-helpers";

describe("revealedRanges", () => {
  it("nothing revealed before first input", () => {
    const s = mdState("# A\nb", { selection: { anchor: 0 } });
    expect(revealedRanges(s)).toEqual([]);
  });

  it("cursor reveals its line", () => {
    const doc = "# A\nb\nc";
    const probe = mdState(doc);
    const s = mdState(doc, { selection: { anchor: at(probe, "b") }, reveal: true });
    expect(revealedRanges(s)).toEqual([{ from: 4, to: 5 }]);
  });

  it("multi-line selection and several ranges", () => {
    const doc = "l0\nl1\nl2\nl3\nl4";
    const probe = mdState(doc);
    const sel = EditorSelection.create([
      EditorSelection.range(at(probe, "l1"), at(probe, "l2") + 1),
      EditorSelection.cursor(at(probe, "l4")),
    ]);
    const s = mdState(doc, { selection: sel, reveal: true });
    expect(revealedRanges(s)).toEqual([
      { from: 3, to: 8 },
      { from: 12, to: 14 },
    ]);
  });

  it("fenced code reveals as a whole", () => {
    const doc = "x\n```\na\nb\n```\ny";
    const probe = mdState(doc);
    const s = mdState(doc, { selection: { anchor: at(probe, "b") }, reveal: true });
    expect(revealedRanges(s)).toEqual([{ from: 2, to: 13 }]);
  });

  it("setext heading reveals text and underline", () => {
    const doc = "Title\n===\nz";
    const probe = mdState(doc);
    const s = mdState(doc, { selection: { anchor: at(probe, "===") }, reveal: true });
    expect(revealedRanges(s)).toEqual([{ from: 0, to: 9 }]);
  });

  it("wrapped emphasis reveals both lines", () => {
    const doc = "a **b\nc** d\n\ne";
    const probe = mdState(doc);
    const s = mdState(doc, { selection: { anchor: at(probe, "b") }, reveal: true });
    expect(revealedRanges(s)).toEqual([{ from: 0, to: 11 }]);
  });
});

describe("isRevealed", () => {
  it("true when touching a range", () => {
    const r = [{ from: 4, to: 5 }];
    expect(isRevealed(r, 5, 6)).toBe(true);
    expect(isRevealed(r, 6, 7)).toBe(false);
  });
});
