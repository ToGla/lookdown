import { describe, expect, it } from "vitest";
import { cellAt, editAsMarkdown, rawTable, tableAt, tableFromNode } from "./table-model";
import { syntaxTree } from "@codemirror/language";
import { at, mdState } from "./test-helpers";

function tableOf(doc: string) {
  const s = mdState(doc);
  const t = tableAt(s, 0)!;
  return { s, t };
}

describe("table model", () => {
  it("cells from pipes", () => {
    const { s, t } = tableOf("| a | b |\n|:--|--:|\n| c \\| d | e |\n|  | |");
    expect(t.columns).toBe(2);
    expect(t.outerPipes).toBe(true);
    expect(t.aligns).toEqual(["left", "right"]);
    const c = t.rows[1].cells[0];
    expect(s.doc.sliceString(c.textFrom, c.textTo)).toBe("c \\| d");
    expect(t.rows[2].cells).toHaveLength(2);
    for (const cell of t.rows[2].cells) {
      expect(cell.textFrom).toBe(cell.textTo);
    }
    const first = t.rows[2].cells[0];
    expect(first.textFrom).toBe(first.from + 1);
  });
  it("no outer pipes", () => {
    const { s, t } = tableOf("a | b\n--|--\nc | d");
    expect(t.outerPipes).toBe(false);
    const row = t.rows[1];
    expect(row.cells[0].from).toBe(row.from);
    expect(row.cells[0].to).toBe(at(s, "| d"));
    expect(row.cells).toHaveLength(2);
  });
  it("ragged row", () => {
    const { t } = tableOf("| a | b |\n|---|---|\n| c |");
    expect(t.rows[1].cells).toHaveLength(1);
    expect(t.columns).toBe(2);
  });
  it("quoted table is not a grid", () => {
    const s = mdState("> | a |\n> |---|\n> | b |");
    expect(tableAt(s, at(s, "b"))).toBeNull();
  });
  it("cellAt", () => {
    const { s, t } = tableOf("| a | b |\n|---|---|\n| c | e |");
    expect(cellAt(t, at(s, "e"))).toEqual({ row: 1, col: 1 });
    expect(cellAt(t, at(s, "---"))).toBeNull();
  });
  it("rawTable follows editAsMarkdown and resets when the cursor leaves", () => {
    const s0 = mdState("x\n\n| a |\n|---|\n| c |", { selection: { anchor: at(mdState("x\n\n| a |\n|---|\n| c |"), "a") } });
    const t = tableAt(s0, at(s0, "a"))!;
    const s1 = s0.update({ effects: editAsMarkdown.of(t.from) }).state;
    expect(tableAt(s1, at(s1, "a"))).toBeNull();
    const s2 = s1.update({ selection: { anchor: 0 } }).state;
    expect(tableAt(s2, at(s2, "a"))).not.toBeNull();
  });
  it("rawTable survives typing at the start of the header line", () => {
    // no outer pipes, so the edited header ("ya | b") is still a table
    const doc = "x\n\na | b\n--|--\nc | d";
    const s0 = mdState(doc, { selection: { anchor: at(mdState(doc), "a |") } });
    const from = tableAt(s0, at(s0, "a |"))!.from;
    const s1 = s0.update({ effects: editAsMarkdown.of(from) }).state;
    const s2 = s1.update({ changes: { from, insert: "y" }, selection: { anchor: from + 1 } }).state;
    expect(s2.field(rawTable)).toBe(from);
    const s3 = s2.update({ selection: { anchor: from + 3 } }).state;
    expect(s3.field(rawTable)).toBe(from);
    expect(tableAt(s3, from + 3)).toBeNull();
  });
  it("rawTable follows the table when Enter is pressed at the start of the header line", () => {
    const doc = "x\n\n| a |\n|---|\n| c |";
    const s0 = mdState(doc, { selection: { anchor: at(mdState(doc), "| a") } });
    const from = tableAt(s0, at(s0, "a"))!.from;
    const s1 = s0.update({ effects: editAsMarkdown.of(from) }).state;
    const s2 = s1.update({ changes: { from, insert: "\n" }, selection: { anchor: from + 1 } }).state;
    expect(s2.field(rawTable)).toBe(from + 1);
    const s3 = s2.update({ selection: { anchor: from + 3 } }).state;
    expect(s3.field(rawTable)).toBe(from + 1);
  });
  it("tableFromNode agrees with tableAt", () => {
    const s = mdState("| a |\n|---|\n| c |");
    let found = null;
    syntaxTree(s).iterate({ enter(n) { if (n.name === "Table") found = tableFromNode(s, n.node); } });
    expect(found).toEqual(tableAt(s, 0));
  });
});
