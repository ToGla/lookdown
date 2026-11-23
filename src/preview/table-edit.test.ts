import type { EditorState, TransactionSpec } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { deleteColumn, deleteRow, insertColumn, insertRow, insertTable, setAlign } from "./table-edit";
import { editAsMarkdown, rawTable, tableAt } from "./table-model";
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

/** Re-parses `doc` (a table containing its first `|`): header column count and cells per row. */
function shape(doc: string) {
  const t = tableAt(mdState(doc), doc.indexOf("|"));
  return t && { columns: t.columns, cells: t.rows.map((r) => r.cells.length) };
}

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
    expect(shape("| a |  | bb |\n|---|---|---|\n| c |  | d |")).toEqual({ columns: 3, cells: [3, 3] });
  });
  it("left of a", () => {
    expect(run(T, p(T, "a"), (s, x) => insertColumn(s, x, "left"))!.doc).toBe(
      "|  | a | bb |\n|---|---|---|\n|  | c | d |",
    );
    expect(shape("|  | a | bb |\n|---|---|---|\n|  | c | d |")).toEqual({ columns: 3, cells: [3, 3] });
  });
  it("right of the last column", () => {
    expect(run(T, p(T, "bb"), (s, x) => insertColumn(s, x, "right"))!.doc).toBe(
      "| a | bb |  |\n|---|---|---|\n| c | d |  |",
    );
    expect(shape("| a | bb |  |\n|---|---|---|\n| c | d |  |")).toEqual({ columns: 3, cells: [3, 3] });
  });
  it("no outer pipes: right of b needs a trailing pipe to keep the cell", () => {
    expect(run(NP, p(NP, "b"), (s, x) => insertColumn(s, x, "right"))!.doc).toBe(
      "a | b|  |\n--|--|---|\nc | d|  |",
    );
    expect(shape("a | b|  |\n--|--|---|\nc | d|  |")).toEqual({ columns: 3, cells: [3, 3] });
  });
  // a leading `|` would be read as an outer pipe, so a new first column gets one on each side
  it("no outer pipes: left of a, and right of a", () => {
    expect(run(NP, p(NP, "a"), (s, x) => insertColumn(s, x, "left"))!.doc).toBe(
      "|  |a | b\n|---|--|--\n|  |c | d",
    );
    expect(run(NP, p(NP, "a"), (s, x) => insertColumn(s, x, "right"))!.doc).toBe(
      "a |  | b\n--|---|--\nc |  | d",
    );
    expect(shape("|  |a | b\n|---|--|--\n|  |c | d")).toEqual({ columns: 3, cells: [3, 3] });
    expect(shape("a |  | b\n--|---|--\nc |  | d")).toEqual({ columns: 3, cells: [3, 3] });
  });
  it("ragged: short rows are left alone", () => {
    expect(run(RAGGED, p(RAGGED, "b"), (s, x) => insertColumn(s, x, "right"))!.doc).toBe(
      "| a | b |  |\n|---|---|---|\n| c |",
    );
    expect(shape("| a | b |  |\n|---|---|---|\n| c |")).toEqual({ columns: 3, cells: [3, 1] });
  });
});

describe("deleteColumn", () => {
  it("bb", () => {
    expect(run(T, p(T, "bb"), deleteColumn)!.doc).toBe("| a |\n|---|\n| c |");
    expect(shape("| a |\n|---|\n| c |")).toEqual({ columns: 1, cells: [1, 1] });
  });
  it("a", () => {
    expect(run(T, p(T, "a"), deleteColumn)!.doc).toBe("| bb |\n|---|\n| d |");
    expect(shape("| bb |\n|---|\n| d |")).toEqual({ columns: 1, cells: [1, 1] });
  });
  it("one column is null", () => {
    expect(run("| a |\n|---|\n| c |", 3, deleteColumn)).toBeNull();
  });
  it("no outer pipes, down to one column keeps a pipe so it stays a table", () => {
    expect(run(NP, p(NP, "a"), deleteColumn)!.doc).toBe("| b\n|--|\n| d");
    expect(run(NP, p(NP, "b"), deleteColumn)!.doc).toBe("a |\n--|\nc |");
    expect(shape("| b\n|--|\n| d")).toEqual({ columns: 1, cells: [1, 1] });
    expect(shape("a |\n--|\nc |")).toEqual({ columns: 1, cells: [1, 1] });
  });
  it("no outer pipes, three columns", () => {
    const N3 = "a | b | c\n--|--|--\nd | e | f";
    expect(run(N3, p(N3, "b"), deleteColumn)!.doc).toBe("a | c\n--|--\nd | f");
    expect(run(N3, p(N3, "c"), deleteColumn)!.doc).toBe("a | b \n--|--\nd | e ");
    expect(shape("a | c\n--|--\nd | f")).toEqual({ columns: 2, cells: [2, 2] });
    expect(shape("a | b \n--|--\nd | e ")).toEqual({ columns: 2, cells: [2, 2] });
  });
  it("ragged: untouched short row", () => {
    expect(run(RAGGED, p(RAGGED, "b"), deleteColumn)!.doc).toBe("| a |\n|---|\n| c |");
    expect(shape("| a |\n|---|\n| c |")).toEqual({ columns: 1, cells: [1, 1] });
  });
  // A row whose only cell is deleted keeps a single `|`: an empty line would end the table and
  // push the following rows out of it.
  it("ragged: a one-cell row without a trailing pipe keeps a pipe", () => {
    const R = "| a | b |\n|---|---|\n| c\n| e | f |";
    const r = run(R, p(R, "a"), deleteColumn)!;
    expect(r.doc).toBe("| b |\n|---|\n|\n| f |");
    expect(shape(r.doc)).toEqual({ columns: 1, cells: [1, 1, 1] });
  });
  it("no outer pipes: a bare one-cell row keeps a pipe", () => {
    const R = "a | b\n--|--\nc\nd | e";
    const r = run(R, p(R, "a"), deleteColumn)!;
    expect(r.doc).toBe("| b\n|--|\n|\n| e");
    expect(shape(r.doc)).toEqual({ columns: 1, cells: [1, 1, 1] });
    const R3 = "a | b | x\n--|--|--\nc\nd | e | f";
    const r3 = run(R3, p(R3, "a"), deleteColumn)!;
    expect(r3.doc).toBe(" b | x\n--|--\n|\n e | f");
    expect(shape(r3.doc)).toEqual({ columns: 2, cells: [2, 1, 2] });
  });
  it("no outer pipes: a one-cell row with a trailing pipe keeps it", () => {
    const R3 = "a | b | x\n--|--|--\nc |\nd | e | f";
    const r3 = run(R3, p(R3, "a"), deleteColumn)!;
    expect(r3.doc).toBe(" b | x\n--|--\n|\n e | f");
    expect(shape(r3.doc)).toEqual({ columns: 2, cells: [2, 1, 2] });
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
    for (const doc of [T, NP, RAGGED, "| a | b |\n|---|---|\n| c", "a | b\n--|--\nc", "a | b | x\n--|--|--\nc"]) {
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

describe("insertTable", () => {
  const TABLE = "|  |  |\n|--|--|\n|  |  |";
  function ins(doc: string, anchor: number, head = anchor) {
    const s = mdState(doc, { selection: { anchor, head } });
    const spec = insertTable(s);
    if (!spec) return null;
    const tr = s.update(spec);
    expect(tr.changes.invert(s.doc).apply(tr.state.doc).toString()).toBe(doc);
    return { doc: tr.state.doc.toString(), head: tr.state.selection.main.head, state: tr.state };
  }
  const cases: [string, string, number, string, number][] = [
    ["empty document", "", 0, TABLE, 2],
    ["after a line of text", "text", 2, "text\n\n" + TABLE, 8],
    ["blank line between paragraphs", "a\n  \nb", 3, "a\n\n" + TABLE + "\n\nb", 5],
    ["existing blank lines are reused", "a\n\n\n\nb", 3, "a\n\n" + TABLE + "\n\nb", 5],
    ["text line followed by text", "a\nb", 0, "a\n\n" + TABLE + "\n\nb", 5],
    ["text line followed by a blank line", "a\n\nb", 0, "a\n\n" + TABLE + "\n\nb", 5],
  ];
  for (const [name, doc, pos, want, head] of cases) {
    it(name, () => {
      expect(ins(doc, pos)).toMatchObject({ doc: want, head });
    });
  }

  it("selection is kept", () => {
    expect(ins("hello world", 0, 5)).toMatchObject({ doc: "hello world\n\n" + TABLE, head: 15 });
  });

  it("inside a table does nothing", () => {
    expect(insertTable(mdState(T, { selection: { anchor: p(T, "c") } }))).toBeNull();
  });

  it("inside a table shown as raw Markdown does nothing", () => {
    for (const anchor of [p(T, "a"), p(T, "c")]) {
      const s0 = mdState(T, { selection: { anchor } });
      const raw = s0.update({ effects: editAsMarkdown.of(0) }).state;
      expect(raw.field(rawTable)).toBe(0);
      expect(insertTable(raw)).toBeNull();
    }
  });

  it("inside a table in a blockquote does nothing", () => {
    const Q = "> | a | b |\n> |---|---|\n> | c | d |";
    expect(insertTable(mdState(Q, { selection: { anchor: Q.indexOf("a") } }))).toBeNull();
  });

  it("on the blank line after a table it inserts", () => {
    expect(ins(T + "\n\n", T.length + 1)).toMatchObject({ doc: T + "\n\n" + TABLE + "\n", head: T.length + 4 });
  });

  it("result parses as a 2x2 table", () => {
    for (const [doc, pos] of [["", 0], ["text", 2]] as const) {
      const r = ins(doc, pos)!;
      const next = mdState(r.doc, { selection: { anchor: r.head } });
      const t = tableAt(next, r.head);
      expect(t?.columns).toBe(2);
      expect(t?.rows.length).toBe(2);
    }
  });
});
