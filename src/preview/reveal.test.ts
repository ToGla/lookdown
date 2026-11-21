import { describe, expect, it } from "vitest";
import { EditorSelection } from "@codemirror/state";
import { isRevealed, revealedRanges } from "./reveal";
import { buildDecorations } from "./decorations";
import { editAsMarkdown } from "./table-model";
import { at, describeDecorations, mdState } from "./test-helpers";

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

  describe("table cells", () => {
    const doc = "| **a** | *b* |\n|---|---|\n| c | d |";
    const probe = mdState(doc);
    const a = at(probe, "a");
    const b = at(probe, "b");
    const c = at(probe, "c");
    const d = at(probe, "d");
    const cell0 = { from: 1, to: 8 };
    const cell1 = { from: 9, to: 14 };

    it("cursor in a cell reveals only that cell", () => {
      const s = mdState(doc, { selection: { anchor: a }, reveal: true });
      expect(revealedRanges(s)).toEqual([cell0]);
      const hides = describeDecorations(buildDecorations(s, 0, s.doc.length)).filter((l) => l.startsWith("hide"));
      expect(hides).not.toContain("hide 2-4");
      expect(hides).not.toContain("hide 5-7");
      expect(hides).toContain("hide 10-11");
      expect(hides).toContain("hide 12-13");
      expect(hides).toContain("hide 0-2");
      expect(hides).toContain("hide 7-10");
    });

    it("selection across two cells of a row", () => {
      const s = mdState(doc, { selection: { anchor: a, head: b }, reveal: true });
      expect(revealedRanges(s)).toEqual([{ from: 1, to: 14 }]);
    });

    it("selection across rows reveals whole lines", () => {
      const s = mdState(doc, { selection: { anchor: a, head: d }, reveal: true });
      expect(revealedRanges(s)).toEqual([{ from: 0, to: doc.length }]);
      const hides = describeDecorations(buildDecorations(s, 0, s.doc.length)).filter((l) => l.startsWith("hide"));
      expect(hides).toContain("hide 0-2");
      expect(hides).toContain("hide 7-10");
    });

    it("body row cell", () => {
      const s = mdState(doc, { selection: { anchor: c }, reveal: true });
      expect(revealedRanges(s)).toEqual([{ from: doc.indexOf("| c") + 1, to: doc.indexOf("| c") + 4 }]);
      expect(cell1.from).toBe(9);
    });

    it("raw table reveals by line", () => {
      let s = mdState(doc, { selection: { anchor: a }, reveal: true });
      s = s.update({ effects: editAsMarkdown.of(0) }).state;
      expect(revealedRanges(s)).toEqual([{ from: 0, to: 15 }]);
    });

    it("before first input nothing reveals", () => {
      const s = mdState(doc, { selection: { anchor: a } });
      expect(revealedRanges(s)).toEqual([]);
    });
  });
});
