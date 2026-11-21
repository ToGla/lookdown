import type { EditorState, TransactionSpec } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { deleteColumn, deleteRow, insertColumn, insertRow, setAlign } from "./table-edit";
import { at, mdState } from "./test-helpers";

const T = "| a | bb |\n|---|---|\n| c | d |";
const NP = "a | b\n--|--\nc | d";
const RAGGED = "| a | b |\n|---|---|\n| c |";

function run(doc: string, pos: number, fn: (s: EditorState, pos: number) => TransactionSpec | null) {
  const s = mdState(doc);
  const spec = fn(s, pos);
  if (!spec) return null;
  const tr = s.update(spec);
  const next = tr.state;
  // undo: the inverted changes restore the original exactly
  expect(tr.changes.invert(s.doc).apply(next.doc).toString()).toBe(doc);
  return { doc: next.doc.toString(), head: next.selection.main.head };
}
const p = (doc: string, text: string) => at(mdState(doc), text);

describe("insertRow", () => {
  it("below a inserts after the delimiter row, cursor in the same column", () => {
    const r = run(T, p(T, "a"), (s, x) => insertRow(s, x, "below"))!;
    expect(r.doc).toBe("| a | bb |\n|---|---|\n|  |  |\n| c | d |");
    expect(r.head).toBe(p(r.doc, "|  |  |") + 2);
    const r2 = run(T, p(T, "bb"), (s, x) => insertRow(s, x, "below"))!;
    expect(r2.head).toBe(p(r2.doc, "|  |  |") + 5);
  });
  it("above a is null; above a body row inserts before it", () => {
    expect(run(T, p(T, "a"), (s, x) => insertRow(s, x, "above"))).toBeNull();
    const r = run(T, p(T, "d"), (s, x) => insertRow(s, x, "above"))!;
    expect(r.doc).toBe("| a | bb |\n|---|---|\n|  |  |\n| c | d |");
    expect(r.head).toBe(p(r.doc, "|  |  |") + 5);
  });
  it("below the last row", () => {
    const r = run(T, p(T, "c"), (s, x) => insertRow(s, x, "below"))!;
    expect(r.doc).toBe(T + "\n|  |  |");
  });
  it("null on the delimiter row or outside a table", () => {
    expect(run(T, p(T, "|---"), (s, x) => insertRow(s, x, "below"))).toBeNull();
    expect(run("hi\n\n" + T, 1, (s, x) => insertRow(s, x, "below"))).toBeNull();
  });
  it("no outer pipes", () => {
    const r = run(NP, p(NP, "c"), (s, x) => insertRow(s, x, "below"))!;
    expect(r.doc).toBe(NP + "\n | ");
  });
});

describe("deleteRow", () => {
  it("removes the last row and moves up", () => {
    const r = run(T, p(T, "c"), deleteRow)!;
    expect(r.doc).toBe("| a | bb |\n|---|---|");
    expect(r.head).toBe(p(T, "a") + 1);
  });
  it("removes a middle row, cursor lands in the row now there", () => {
    const D = T + "\n| e | f |";
    const r = run(D, p(D, "d"), deleteRow)!;
    expect(r.doc).toBe(T.replace("| c | d |", "| e | f |"));
    expect(r.head).toBe(p(r.doc, "f") + 1);
  });
  it("header is null", () => {
    expect(run(T, p(T, "a"), deleteRow)).toBeNull();
  });
});

describe("insertColumn", () => {
  it("right of a", () => {
    expect(run(T, p(T, "a"), (s, x) => insertColumn(s, x, "right"))!.doc).toBe(
      "| a |  | bb |\n|---|---|---|\n| c |  | d |",
    );
  });
  it("left of a", () => {
    expect(run(T, p(T, "a"), (s, x) => insertColumn(s, x, "left"))!.doc).toBe(
      "|  | a | bb |\n|---|---|---|\n|  | c | d |",
    );
  });
  it("right of the last column", () => {
    expect(run(T, p(T, "bb"), (s, x) => insertColumn(s, x, "right"))!.doc).toBe(
      "| a | bb |  |\n|---|---|---|\n| c | d |  |",
    );
  });
  it("no outer pipes: right of b needs a trailing pipe to keep the cell", () => {
    expect(run(NP, p(NP, "b"), (s, x) => insertColumn(s, x, "right"))!.doc).toBe(
      "a | b|  |\n--|--|---|\nc | d|  |",
    );
  });
  it("no outer pipes: left of a, and right of a", () => {
    expect(run(NP, p(NP, "a"), (s, x) => insertColumn(s, x, "left"))!.doc).toBe(
      "  |a | b\n---|--|--\n  |c | d",
    );
    expect(run(NP, p(NP, "a"), (s, x) => insertColumn(s, x, "right"))!.doc).toBe(
      "a |  | b\n--|---|--\nc |  | d",
    );
  });
  it("ragged: short rows are left alone", () => {
    expect(run(RAGGED, p(RAGGED, "b"), (s, x) => insertColumn(s, x, "right"))!.doc).toBe(
      "| a | b |  |\n|---|---|---|\n| c |",
    );
  });
});

describe("deleteColumn", () => {
  it("bb", () => {
    expect(run(T, p(T, "bb"), deleteColumn)!.doc).toBe("| a |\n|---|\n| c |");
  });
  it("a", () => {
    expect(run(T, p(T, "a"), deleteColumn)!.doc).toBe("| bb |\n|---|\n| d |");
  });
  it("one column is null", () => {
    expect(run("| a |\n|---|\n| c |", 3, deleteColumn)).toBeNull();
  });
  it("no outer pipes, down to one column keeps a pipe so it stays a table", () => {
    expect(run(NP, p(NP, "a"), deleteColumn)!.doc).toBe("| b\n|--\n| d");
    expect(run(NP, p(NP, "b"), deleteColumn)!.doc).toBe("a |\n--|\nc |");
  });
  it("no outer pipes, three columns", () => {
    const N3 = "a | b | c\n--|--|--\nd | e | f";
    expect(run(N3, p(N3, "b"), deleteColumn)!.doc).toBe("a | c\n--|--\nd | f");
    expect(run(N3, p(N3, "c"), deleteColumn)!.doc).toBe("a | b \n--|--\nd | e ");
  });
  it("ragged: untouched short row", () => {
    expect(run(RAGGED, p(RAGGED, "b"), deleteColumn)!.doc).toBe("| a |\n|---|\n| c |");
  });
});

describe("setAlign", () => {
  it("center, right, left", () => {
    const c = run(T, p(T, "bb"), (s, x) => setAlign(s, x, "center"))!;
    expect(c.doc).toBe("| a | bb |\n|---|:-:|\n| c | d |");
    const r = run(c.doc, p(c.doc, "a"), (s, x) => setAlign(s, x, "right"))!;
    expect(r.doc).toBe("| a | bb |\n|--:|:-:|\n| c | d |");
    const l = run(r.doc, p(r.doc, "a"), (s, x) => setAlign(s, x, "left"))!;
    expect(l.doc).toBe("| a | bb |\n|:--|:-:|\n| c | d |");
  });
  it("no outer pipes and ragged", () => {
    expect(run(NP, p(NP, "b"), (s, x) => setAlign(s, x, "right"))!.doc).toBe("a | b\n--|--:\nc | d");
    expect(run(RAGGED, p(RAGGED, "b"), (s, x) => setAlign(s, x, "left"))!.doc).toBe(
      "| a | b |\n|---|:--|\n| c |",
    );
  });
});

describe("undo", () => {
  it("every command on every shape restores the original", () => {
    for (const doc of [T, NP, RAGGED]) {
      for (const text of ["a", "b", "c"]) {
        const pos = p(doc, text);
        if (pos < 0) continue;
        for (const fn of [
          (s: EditorState, x: number) => insertRow(s, x, "below"),
          (s: EditorState, x: number) => insertRow(s, x, "above"),
          deleteRow,
          (s: EditorState, x: number) => insertColumn(s, x, "left"),
          (s: EditorState, x: number) => insertColumn(s, x, "right"),
          deleteColumn,
          (s: EditorState, x: number) => setAlign(s, x, "center"),
        ])
          run(doc, pos, fn); // asserts the undo inside
      }
    }
  });
});
