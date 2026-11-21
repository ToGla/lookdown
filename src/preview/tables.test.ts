import { describe, expect, it } from "vitest";
import { buildDecorations } from "./decorations";
import { editAsMarkdown } from "./table-model";
import { at, describeDecorations, mdState } from "./test-helpers";

function run(doc: string, opts: Parameters<typeof mdState>[1] = {}): string[] {
  const s = mdState(doc, opts);
  return describeDecorations(buildDecorations(s, 0, s.doc.length));
}
const T = "| a | b |\n|---|---|\n| c | d |";

describe("table decorations", () => {
  it("grid lines", () => {
    const out = run(T);
    expect(out).toContain("line cm-ld-tr cm-ld-th 0");
    expect(out).toContain("line cm-ld-tr cm-ld-tdelim 10");
    expect(out).toContain("line cm-ld-tr 20");
  });
  it("pipes and padding hidden, text marked", () => {
    const s = mdState(T);
    const out = describeDecorations(buildDecorations(s, 0, s.doc.length));
    const marks = out.filter((l) => l.startsWith("mark cm-ld-cell")).sort();
    const want = ["a", "b", "c", "d"].map((ch) => {
      const p = at(s, ch);
      return `mark cm-ld-cell ${p}-${p + 1}`;
    });
    expect(marks).toEqual(want.sort());
    const covered = new Set<number>();
    for (const l of out) {
      const m = /^(hide|mark cm-ld-cell) (\d+)-(\d+)$/.exec(l);
      if (m) for (let i = +m[2]; i < +m[3]; i++) covered.add(i);
    }
    for (let i = 0; i < s.doc.length; i++) {
      if (s.doc.sliceString(i, i + 1) !== "\n") expect(covered.has(i)).toBe(true);
    }
    const hidden = new Set<number>();
    for (const l of out) {
      const m = /^hide (\d+)-(\d+)$/.exec(l);
      if (m) for (let i = +m[1]; i < +m[2]; i++) hidden.add(i);
    }
    for (let i = 0; i < s.doc.length; i++) {
      const ch = s.doc.sliceString(i, i + 1);
      if (ch !== "\n" && !"abcd".includes(ch)) expect(hidden.has(i)).toBe(true);
    }
  });
  it("concealed even when revealed", () => {
    const s = mdState(T, { reveal: true, selection: { anchor: at(mdState(T), "c") } });
    const out = describeDecorations(buildDecorations(s, 0, s.doc.length));
    expect(out).toContain("hide 20-22");
    expect(out).toContain("hide 10-19");
  });
  it("alignment classes", () => {
    const out = run("| a | b |\n|:-:|--:|\n| c | d |");
    expect(out).toContain("mark cm-ld-cell cm-ld-align-center 2-3");
    expect(out).toContain("mark cm-ld-cell cm-ld-align-right 6-7");
  });
  it("blank and missing cells", () => {
    expect(run("|  |\n|--|\n|  |")).toContain("mark cm-ld-cell 12-13");
    const ragged = run("| a | b |\n|---|---|\n| c |");
    expect(ragged.filter((l) => l.startsWith("widget empty-cell"))).toEqual(["widget empty-cell 25-25"]);
    expect(run("||\n|-|\n| a |").filter((l) => l.startsWith("widget empty-cell"))).toEqual(["widget empty-cell 1-1"]);
  });
  it("inline styling inside cells still renders", () => {
    const out = run("| **x** |\n|---|");
    expect(out.some((l) => l.startsWith("mark cm-ld-strong"))).toBe(true);
    expect(out).toContain("hide 2-4");
  });
  it("quoted table keeps part 1", () => {
    const out = run("> | a |\n> |---|\n> | b |");
    expect(out.some((l) => l.includes("cm-ld-tr") || l.includes("cm-ld-cell"))).toBe(false);
  });
  it("half-typed tables do not throw", () => {
    for (const doc of ["| a |", "| a |\n|--", "| a |\n|---|"]) {
      const out = run(doc);
      const isTable = doc === "| a |\n|---|";
      expect(out.some((l) => l.includes("cm-ld-tr"))).toBe(isTable);
    }
  });
  it("raw table", () => {
    const s0 = mdState(T, { selection: { anchor: 0 } });
    const s = s0.update({ effects: editAsMarkdown.of(0) }).state;
    expect(describeDecorations(buildDecorations(s, 0, s.doc.length)).some((l) => l.includes("cm-ld-tr"))).toBe(false);
  });
});
