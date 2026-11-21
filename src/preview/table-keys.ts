import { EditorSelection, type EditorState, type TransactionSpec } from "@codemirror/state";
import { EditorView, type KeyBinding } from "@codemirror/view";
import { cellAt, tableAt, type TableInfo } from "./table-model";

type Spec = TransactionSpec;

/** Text of a new blank row (without the leading newline). */
export function appendRowText(t: TableInfo): string {
  if (t.outerPipes || t.columns <= 1) return "|" + "  |".repeat(t.columns);
  return Array(t.columns).fill(" ").join("|");
}

interface Ctx {
  state: EditorState;
  table: TableInfo;
  row: number;
  col: number;
  head: number;
}

function ctxOf(state: EditorState): Ctx | null {
  const head = state.selection.main.head;
  const table = tableAt(state, head);
  if (!table) return null;
  const at = cellAt(table, head);
  return at ? { state, table, row: at.row, col: at.col, head } : null;
}

const go = (pos: number): Spec => ({ selection: EditorSelection.cursor(pos) });

/** Append a blank row and put the cursor in column `col` of it. */
function appendRow(table: TableInfo, col: number): Spec {
  const lastRow = table.rows[table.rows.length - 1];
  const text = appendRowText(table);
  const start = lastRow.to + 1;
  const c = Math.min(col, table.columns - 1);
  const pos = table.outerPipes || table.columns <= 1 ? start + 2 + 3 * c : start + 1 + 2 * c;
  return { changes: { from: lastRow.to, insert: "\n" + text }, selection: EditorSelection.cursor(pos) };
}

function lineAbove(state: EditorState, table: TableInfo): Spec {
  return table.from > 0 ? go(state.doc.lineAt(table.from - 1).to) : {};
}

function lineBelow(state: EditorState, table: TableInfo): Spec {
  const line = state.doc.lineAt(table.to);
  return line.number < state.doc.lines ? go(state.doc.line(line.number + 1).from) : {};
}

export function nextCell(state: EditorState): Spec | null {
  const c = ctxOf(state);
  if (!c) return null;
  const { rows } = c.table;
  if (c.col + 1 < rows[c.row].cells.length) return go(rows[c.row].cells[c.col + 1].textTo);
  if (c.row + 1 < rows.length) return go(rows[c.row + 1].cells[0].textTo);
  return appendRow(c.table, 0);
}

export function prevCell(state: EditorState): Spec | null {
  const c = ctxOf(state);
  if (!c) return null;
  const { rows } = c.table;
  if (c.col > 0) return go(rows[c.row].cells[c.col - 1].textTo);
  if (c.row > 0) {
    const cells = rows[c.row - 1].cells;
    return go(cells[cells.length - 1].textTo);
  }
  return {};
}

export function nextRow(state: EditorState): Spec | null {
  const c = ctxOf(state);
  if (!c) return null;
  const { rows } = c.table;
  if (c.row + 1 >= rows.length) return appendRow(c.table, c.col);
  const cells = rows[c.row + 1].cells;
  return go(cells[Math.min(c.col, cells.length - 1)].textTo);
}

export function moveVertical(state: EditorState, dir: -1 | 1): Spec | null {
  if (!state.selection.main.empty) return null;
  const c = ctxOf(state);
  if (!c) return null;
  const { rows } = c.table;
  const target = c.row + dir;
  if (target < 0) return lineAbove(state, c.table);
  if (target >= rows.length) return lineBelow(state, c.table);
  const cur = rows[c.row].cells[c.col];
  const offset = Math.max(0, c.head - cur.textFrom);
  const cells = rows[target].cells;
  const cell = cells[Math.min(c.col, cells.length - 1)];
  return go(cell.textFrom + Math.min(offset, cell.textTo - cell.textFrom));
}

export function moveHorizontal(state: EditorState, dir: -1 | 1): Spec | null {
  if (!state.selection.main.empty) return null;
  const c = ctxOf(state);
  if (!c) return null;
  const { rows } = c.table;
  const cell = rows[c.row].cells[c.col];
  if (c.head !== (dir < 0 ? cell.textFrom : cell.textTo)) return null;
  if (dir < 0) {
    if (c.col > 0) return go(rows[c.row].cells[c.col - 1].textTo);
    if (c.row > 0) {
      const cells = rows[c.row - 1].cells;
      return go(cells[cells.length - 1].textTo);
    }
    return lineAbove(state, c.table);
  }
  if (c.col + 1 < rows[c.row].cells.length) return go(rows[c.row].cells[c.col + 1].textFrom);
  if (c.row + 1 < rows.length) return go(rows[c.row + 1].cells[0].textFrom);
  return lineBelow(state, c.table);
}

export function leaveTable(state: EditorState): Spec | null {
  const c = ctxOf(state);
  if (!c) return null;
  const line = state.doc.lineAt(c.table.to);
  if (line.number < state.doc.lines) return go(state.doc.line(line.number + 1).from);
  return { changes: { from: c.table.to, insert: "\n" }, selection: EditorSelection.cursor(c.table.to + 1) };
}

/** Replace a typed `|` inside a grid cell with `\|`. */
export function escapePipe(state: EditorState, from: number, to: number): Spec | null {
  const table = tableAt(state, from);
  const a = table && cellAt(table, from);
  const b = table && cellAt(table, to);
  if (!a || !b || a.row !== b.row || a.col !== b.col) return null;
  const insert = "\\|";
  return {
    changes: { from, to, insert },
    selection: EditorSelection.cursor(from + insert.length),
    userEvent: "input.type",
  };
}

function bind(key: string, fn: (state: EditorState) => Spec | null): KeyBinding {
  return {
    key,
    run(view: EditorView) {
      const spec = fn(view.state);
      if (!spec) return false;
      view.dispatch({ ...spec, scrollIntoView: true });
      return true;
    },
  };
}

export const tableKeymap: KeyBinding[] = [
  bind("Tab", nextCell),
  bind("Shift-Tab", prevCell),
  bind("Enter", nextRow),
  bind("ArrowUp", (s) => moveVertical(s, -1)),
  bind("ArrowDown", (s) => moveVertical(s, 1)),
  bind("ArrowLeft", (s) => moveHorizontal(s, -1)),
  bind("ArrowRight", (s) => moveHorizontal(s, 1)),
  bind("Escape", leaveTable),
];
