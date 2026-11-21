import { EditorSelection, type ChangeSpec, type EditorState, type TransactionSpec } from "@codemirror/state";
import { appendRowText } from "./table-keys";
import { cellAt, tableAt, type Row, type TableInfo } from "./table-model";

type Spec = TransactionSpec;

interface Ctx {
  table: TableInfo;
  row: number;
  col: number;
}

function ctxAt(state: EditorState, pos: number): Ctx | null {
  const table = tableAt(state, pos);
  const at = table && cellAt(table, pos);
  return table && at ? { table, ...at } : null;
}

/** Cursor offset of column `col` inside a freshly inserted blank row starting at `start`. */
function blankRowCursor(table: TableInfo, start: number, col: number): number {
  const c = Math.min(col, table.columns - 1);
  return table.outerPipes || table.columns <= 1 ? start + 2 + 3 * c : start + 1 + 2 * c;
}

export function insertRow(state: EditorState, pos: number, where: "above" | "below"): Spec | null {
  const c = ctxAt(state, pos);
  if (!c) return null;
  const { table, row, col } = c;
  const text = appendRowText(table);
  if (where === "above") {
    if (row === 0) return null;
    const start = table.rows[row].from;
    return {
      changes: { from: start, insert: text + "\n" },
      selection: EditorSelection.cursor(blankRowCursor(table, start, col)),
    };
  }
  // below the header means after the delimiter row
  const anchor = row === 0 ? table.delimiter : table.rows[row];
  return {
    changes: { from: anchor.to, insert: "\n" + text },
    selection: EditorSelection.cursor(blankRowCursor(table, anchor.to + 1, col)),
  };
}

export function deleteRow(state: EditorState, pos: number): Spec | null {
  const c = ctxAt(state, pos);
  if (!c || c.row === 0) return null;
  const { table, row, col } = c;
  const r = table.rows[row];
  const last = row === table.rows.length - 1;
  const target = last ? table.rows[row - 1] : table.rows[row + 1];
  const cell = target.cells[Math.min(col, target.cells.length - 1)];
  const shift = last ? 0 : r.to + 1 - r.from;
  return {
    changes: last ? { from: r.from - 1, to: r.to } : { from: r.from, to: r.to + 1 },
    selection: EditorSelection.cursor(cell.textTo - shift),
  };
}

const hasPipeAt = (state: EditorState, row: Row, at: number) =>
  at < row.to && state.doc.sliceString(at, at + 1) === "|";

export function insertColumn(state: EditorState, pos: number, side: "left" | "right"): Spec | null {
  const c = ctxAt(state, pos);
  if (!c) return null;
  const { table, col } = c;
  const changes: ChangeSpec[] = [];
  for (const row of [...table.rows, table.delimiter]) {
    if (row.cells.length <= col) continue;
    const blank = row === table.delimiter ? "---" : "  ";
    const cell = row.cells[col];
    if (side === "left") changes.push({ from: cell.from, insert: blank + "|" });
    else if (hasPipeAt(state, row, cell.to)) changes.push({ from: cell.to + 1, insert: blank + "|" });
    // last cell without a trailing pipe: a blank cell needs one on each side to stay a cell
    else changes.push({ from: row.to, insert: "|" + blank + "|" });
  }
  return { changes };
}

export function deleteColumn(state: EditorState, pos: number): Spec | null {
  const c = ctxAt(state, pos);
  if (!c || c.table.columns === 1) return null;
  const { table, col } = c;
  // Without outer pipes a single column would read as plain text (or a setext heading), so
  // going from 2 columns to 1 keeps one pipe.
  const keepPipe = !table.outerPipes && table.columns === 2;
  const changes: ChangeSpec[] = [];
  for (const row of [...table.rows, table.delimiter]) {
    if (row.cells.length <= col) continue;
    const cell = row.cells[col];
    if (keepPipe) changes.push({ from: cell.from, to: cell.to });
    else if (hasPipeAt(state, row, cell.to)) changes.push({ from: cell.from, to: cell.to + 1 });
    else if (cell.from > row.from) changes.push({ from: cell.from - 1, to: cell.to });
    else changes.push({ from: cell.from, to: cell.to });
  }
  return { changes };
}

export function setAlign(state: EditorState, pos: number, align: "left" | "center" | "right"): Spec | null {
  const c = ctxAt(state, pos);
  const cell = c && c.table.delimiter.cells[c.col];
  if (!cell) return null;
  const width = Math.max(cell.textTo - cell.textFrom, 3);
  const dashes = "-".repeat(width - (align === "center" ? 2 : 1));
  const insert = align === "left" ? ":" + dashes : align === "right" ? dashes + ":" : ":" + dashes + ":";
  return { changes: { from: cell.textFrom, to: cell.textTo, insert } };
}
