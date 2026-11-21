import { EditorSelection, type EditorState, type TransactionSpec } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { describe, expect, it } from "vitest";
import {
  appendRowText,
  escapePipe,
  leaveTable,
  moveHorizontal,
  moveVertical,
  nextCell,
  nextRow,
  prevCell,
} from "./table-keys";
import { tableAt } from "./table-model";
import { at, mdState } from "./test-helpers";

const T = "| a | bb |\n|---|---|\n| c | d |";

function run(doc: string, head: number, fn: (s: EditorState) => TransactionSpec | null) {
  const s = mdState(doc, { selection: { anchor: head } });
  const spec = fn(s);
  if (!spec) return null;
  const next = s.update({ ...spec, selection: spec.selection ?? s.selection }).state;
  return { doc: next.doc.toString(), head: next.selection.main.head };
}

describe("table keys", () => {
  it("Tab walks cells, skipping the delimiter", () => {
    expect(run(T, at(mdState(T), "a"), nextCell)!.head).toBe(at(mdState(T), "bb") + 2);
    expect(run(T, at(mdState(T), "bb"), nextCell)!.head).toBe(at(mdState(T), "c") + 1);
  });
  it("Tab in the last cell appends a row", () => {
    const r = run(T, at(mdState(T), "d"), nextCell)!;
    expect(r.doc).toBe(T + "\n|  |  |");
    expect(r.head).toBe(T.length + 1 + 2);
  });
  it("Shift-Tab", () => {
    const s = mdState(T);
    expect(run(T, at(s, "c"), prevCell)!.head).toBe(at(s, "bb") + 2);
    const r = run(T, at(s, "a"), prevCell)!;
    expect(r.doc).toBe(T);
    expect(r.head).toBe(at(s, "a"));
  });
  it("Enter", () => {
    const s = mdState(T);
    expect(run(T, at(s, "a"), nextRow)!.head).toBe(at(s, "c") + 1);
    const r = run(T, at(s, "d"), nextRow)!;
    expect(r.doc).toBe(T + "\n|  |  |");
    expect(r.head).toBe(T.length + 1 + 2 + 3);
  });
  it("vertical movement", () => {
    const s = mdState(T);
    expect(run(T, at(s, "bb") + 1, (st) => moveVertical(st, 1))!.head).toBe(at(s, "d") + 1);
    const up = "x\n" + T;
    expect(run(up, at(mdState(up), "a"), (st) => moveVertical(st, -1))!.head).toBe(1);
    const none = run(T, at(s, "a"), (st) => moveVertical(st, -1))!;
    expect(none.doc).toBe(T);
    expect(none.head).toBe(at(s, "a"));
    const down = T + "\n\ny"; // a bare "y" line directly below would be a lazy table row
    const ds = mdState(down);
    expect(run(down, at(ds, "d"), (st) => moveVertical(st, 1))!.head).toBe(T.length + 1);
    expect(run(T, at(s, "d"), (st) => moveVertical(st, 1))).not.toBeNull();
  });
  it("horizontal movement", () => {
    const s = mdState(T);
    expect(run(T, at(s, "bb") + 1, (st) => moveHorizontal(st, 1))).toBeNull();
    expect(run(T, at(s, "a") + 1, (st) => moveHorizontal(st, 1))!.head).toBe(at(s, "bb"));
    expect(run(T, at(s, "c"), (st) => moveHorizontal(st, -1))!.head).toBe(at(s, "bb") + 2);
  });
  it("Escape leaves the table", () => {
    const r = run(T, at(mdState(T), "a"), leaveTable)!;
    expect(r.doc).toBe(T + "\n");
    expect(r.head).toBe(T.length + 1);
    const d = T + "\n\ny";
    expect(run(d, 2, leaveTable)!.head).toBe(T.length + 1);
  });
  it("no outer pipes", () => {
    const doc = "a | b\n--|--\nc | d";
    const r = run(doc, doc.length - 1, nextCell)!;
    expect(r.doc).toBe(doc + "\n | ");
    const s = mdState(r.doc);
    expect(tableAt(s, 0)!.rows).toHaveLength(3);
    let rows = 0;
    syntaxTree(s).iterate({ enter: (n) => void (n.name === "TableRow" && rows++) });
    expect(rows).toBe(2);
    expect(r.head).toBe(doc.length + 2);
  });
  it("appendRowText", () => {
    expect(appendRowText(tableAt(mdState(T), 0)!)).toBe("|  |  |");
    expect(appendRowText(tableAt(mdState("| a |\n|---|\n| b |"), 0)!)).toBe("|  |");
  });
  it("escapePipe", () => {
    const s = mdState(T, { selection: { anchor: at(mdState(T), "bb") } });
    const p = at(s, "bb");
    const spec = escapePipe(s, p, p)!;
    expect(s.update(spec).state.doc.toString()).toBe(T.replace("bb", "\|bb"));
    expect(escapePipe(mdState("plain"), 1, 1)).toBeNull();
  });
  it("emptying and retyping a cell", () => {
    const s = mdState(T);
    const c = at(s, "c");
    const emptied = s.update({ changes: { from: c, to: c + 1 } }).state;
    expect(emptied.doc.toString()).toBe("| a | bb |\n|---|---|\n|  | d |");
    const cell = tableAt(emptied, 0)!.rows[1].cells[0];
    const typed = emptied.update({ changes: { from: cell.textFrom, insert: "z" } }).state;
    expect(typed.doc.toString()).toBe("| a | bb |\n|---|---|\n| z | d |");
  });
  it("outside a table everything is null", () => {
    const s = mdState("plain text", { selection: EditorSelection.single(2) });
    for (const fn of [nextCell, prevCell, nextRow, leaveTable]) expect(fn(s)).toBeNull();
    expect(moveVertical(s, 1)).toBeNull();
    expect(moveHorizontal(s, 1)).toBeNull();
  });
});
