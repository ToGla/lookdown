import { syntaxTree } from "@codemirror/language";
import { EditorState, StateEffect, StateField } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";

export type Align = "left" | "center" | "right" | null;
/** from/to: between the cell's delimiters (or line start/end). textFrom/textTo: trimmed text;
 *  for a blank cell both equal min(from + 1, to). */
export interface Cell {
  from: number;
  to: number;
  textFrom: number;
  textTo: number;
}
export interface Row {
  from: number;
  to: number;
  cells: Cell[];
} // a line
export interface TableInfo {
  from: number;
  to: number;
  rows: Row[]; // rows[0] is the header, then body rows; the delimiter row excluded
  delimiter: Row; // cells split on `|` by hand
  aligns: Align[]; // one per delimiter cell
  columns: number; // header cell count
  outerPipes: boolean; // header line, trimmed, starts with `|`
}

const isSpace = (c: string) => c === " " || c === "\t";

/** A GFM table directly in the document (not in a quote or list). */
export function isGridTable(node: SyntaxNode): boolean {
  return node.name === "Table" && node.parent?.name === "Document";
}

function makeCell(state: EditorState, from: number, to: number): Cell {
  const text = state.doc.sliceString(from, to);
  let a = 0;
  let b = text.length;
  while (a < b && isSpace(text[a])) a++;
  while (b > a && isSpace(text[b - 1])) b--;
  if (a >= b) {
    const p = Math.min(from + 1, to);
    return { from, to, textFrom: p, textTo: p };
  }
  return { from, to, textFrom: from + a, textTo: from + b };
}

// Cells of one line, given the positions of its `|` characters.
function splitLine(state: EditorState, lineFrom: number, lineTo: number, pipes: number[]): Row {
  const text = state.doc.sliceString(lineFrom, lineTo);
  let indent = 0;
  while (indent < text.length && isSpace(text[indent])) indent++;
  const leading = pipes.length > 0 && pipes[0] === lineFrom + indent;
  const last = pipes[pipes.length - 1];
  const trailing =
    pipes.length > 0 &&
    (pipes.length > 1 || !leading) &&
    state.doc.sliceString(last + 1, lineTo).trim() === "";
  const cells: Cell[] = [];
  let start = leading ? pipes[0] + 1 : lineFrom;
  for (let i = leading ? 1 : 0; i < pipes.length; i++) {
    cells.push(makeCell(state, start, pipes[i]));
    start = pipes[i] + 1;
  }
  if (!trailing) cells.push(makeCell(state, start, lineTo));
  return { from: lineFrom, to: lineTo, cells };
}

function rowOf(state: EditorState, node: SyntaxNode): Row {
  const line = state.doc.lineAt(node.from);
  const pipes = node.getChildren("TableDelimiter").map((d) => d.from);
  return splitLine(state, line.from, line.to, pipes);
}

function alignOf(text: string): Align {
  const left = text.startsWith(":");
  const right = text.endsWith(":");
  return left && right ? "center" : right ? "right" : left ? "left" : null;
}

export function tableFromNode(state: EditorState, table: SyntaxNode): TableInfo {
  const rows: Row[] = [];
  let delimiter: Row | null = null;
  for (let c = table.firstChild; c; c = c.nextSibling) {
    if (c.name === "TableHeader" || c.name === "TableRow") rows.push(rowOf(state, c));
    else if (c.name === "TableDelimiter" && !delimiter) {
      const line = state.doc.lineAt(c.from);
      const pipes: number[] = [];
      for (let i = line.from; i < line.to; i++) if (state.doc.sliceString(i, i + 1) === "|") pipes.push(i);
      delimiter = splitLine(state, line.from, line.to, pipes);
    }
  }
  const header = rows[0];
  const dl = delimiter ?? { from: header.to, to: header.to, cells: [] };
  const headerText = state.doc.sliceString(header.from, header.to).trimStart();
  return {
    from: table.from,
    to: table.to,
    rows,
    delimiter: dl,
    aligns: dl.cells.map((c) => alignOf(state.doc.sliceString(c.textFrom, c.textTo))),
    columns: header.cells.length,
    outerPipes: headerText.startsWith("|"),
  };
}

function gridTableNear(state: EditorState, pos: number): SyntaxNode | null {
  const tree = syntaxTree(state);
  for (const side of [1, -1] as const) {
    for (let n: SyntaxNode | null = tree.resolve(pos, side); n; n = n.parent) {
      if (n.name === "Table") return isGridTable(n) ? n : null;
    }
  }
  return null;
}

export const editAsMarkdown = StateEffect.define<number>();

function head(from: number, ranges: readonly { head: number }[], to: number): boolean {
  return ranges.some((r) => r.head >= from && r.head <= to);
}

/** `from` of the table shown as raw Markdown, mapped through changes. Resets to null when
 *  no selection head is inside that table (evaluated after the transaction's effects). */
export const rawTable = StateField.define<number | null>({
  create: () => null,
  update(value, tr) {
    let from = value;
    for (const e of tr.effects) if (e.is(editAsMarkdown)) from = e.value;
    if (from === null) return null;
    const node = gridTableNear(tr.startState, from);
    if (!node || node.from !== from) return null;
    // Text inserted at the table start joins the header line (typing at column 0) unless it
    // ends a line (Enter at column 0), in which case the table starts after its last newline.
    const before = tr.changes.mapPos(node.from, -1);
    const after = tr.changes.mapPos(node.from, 1);
    const newFrom = before + tr.newDoc.sliceString(before, after).lastIndexOf("\n") + 1;
    const newTo = tr.changes.mapPos(node.to, 1);
    if (newTo <= newFrom) return null;
    return head(newFrom, tr.newSelection.ranges, newTo) ? newFrom : null;
  },
});

/** The grid table containing pos, unless it is shown raw. */
export function tableAt(state: EditorState, pos: number): TableInfo | null {
  const node = gridTableNear(state, pos);
  if (!node || state.field(rawTable, false) === node.from) return null;
  return tableFromNode(state, node);
}

export function cellAt(table: TableInfo, pos: number): { row: number; col: number } | null {
  for (let r = 0; r < table.rows.length; r++) {
    const row = table.rows[r];
    if (pos < row.from || pos > row.to) continue;
    for (let c = 0; c < row.cells.length; c++) {
      if (pos >= row.cells[c].from && pos <= row.cells[c].to) return { row: r, col: c };
    }
  }
  return null;
}
