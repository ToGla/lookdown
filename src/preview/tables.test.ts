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
    expect(marks).toEqual(
      ["0-4", "4-9", "20-24", "24-29"].map((r) => `mark cm-ld-cell ${r}`).sort(),
    );
    const covered = new Set<number>();
    for (const l of out) {
      const m = /^mark cm-ld-cell (\d+)-(\d+)$/.exec(l);
      if (m) for (let i = +m[1]; i < +m[2]; i++) covered.add(i);
    }
    for (let i = 0; i < s.doc.length; i++) {
      if ((i >= 10 && i < 20) || s.doc.sliceString(i, i + 1) === "\n") continue; // delimiter row, breaks
      expect(covered.has(i)).toBe(true);
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
    expect(out).toContain("mark cm-ld-cell cm-ld-align-center 0-4");
    expect(out).toContain("mark cm-ld-cell cm-ld-align-right 4-9");
  });
  it("blank and missing cells", () => {
    expect(run("|  |\n|--|\n|  |")).toContain("mark cm-ld-cell 0-4");
    const ragged = run("| a | b |\n|---|---|\n| c |");
    expect(ragged.filter((l) => l.startsWith("widget empty-cell"))).toEqual(["widget empty-cell 25-25"]);
    expect(run("||\n|-|\n| a |").filter((l) => l.startsWith("widget empty-cell"))).toEqual([]);
  });
  it("inline styling inside cells still renders", () => {
    const out = run("| **x** |\n|---|");
    expect(out.some((l) => l.startsWith("mark cm-ld-strong"))).toBe(true);
    expect(out).toContain("hide 2-4");
  });
  it("cell mark stays outside an inline mark with the same range", () => {
    const st = mdState("| ~~gone~~ |\n|---|");
    let inclusive = false;
    const seen: { cls: string; startSide: number; endSide: number }[] = [];
    for (const c = buildDecorations(st, 0, st.doc.length).iter(); c.value; c.next()) {
      const spec = c.value.spec as { ld: string; class?: string };
      if (spec.ld === "mark" && c.from <= 2) {
        if (spec.class?.startsWith("cm-ld-cell")) inclusive = (spec as { inclusive?: boolean }).inclusive === true;
        seen.push({ cls: spec.class!, startSide: c.value.startSide, endSide: c.value.endSide });
      }
    }
    const cell = seen.findIndex((m) => m.cls.startsWith("cm-ld-cell"));
    const strike = seen.findIndex((m) => m.cls.includes("strike"));
    expect(cell).toBeGreaterThanOrEqual(0);
    expect(strike).toBeGreaterThanOrEqual(0);
    expect(cell).toBeLessThan(strike);
    expect(inclusive).toBe(true);
    expect(seen[cell].startSide).toBeLessThan(seen[strike].startSide);
    expect(seen[cell].endSide).toBeGreaterThan(seen[strike].endSide);
  });
  it("cell marks tile each row line without gaps or overlaps", () => {
    const docs = [
      "| a | b |\n|---|---|\n| c | d |",
      "a | b\n--|--\nc | d",
      "|  |\n|--|\n|  |",
      "||\n|-|\n||",
      "| a | b |\n|---|---|\n| c |",
    ];
    for (const doc of docs) {
      const st = mdState(doc);
      const marks: [number, number][] = [];
      for (const c = buildDecorations(st, 0, st.doc.length).iter(); c.value; c.next()) {
        const spec = c.value.spec as { ld: string; class?: string };
        if (spec.ld === "mark" && spec.class?.startsWith("cm-ld-cell")) marks.push([c.from, c.to]);
      }
      for (const line of [st.doc.line(1), st.doc.line(3)]) {
        const row = marks.filter(([f, t]) => f >= line.from && t <= line.to).sort((x, y) => x[0] - y[0]);
        let pos = line.from;
        for (const [f, t] of row) {
          expect(f).toBe(pos);
          pos = t;
        }
        expect(pos).toBe(line.to);
      }
    }
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
