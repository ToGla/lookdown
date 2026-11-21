import type { Handler } from "./decorations";
import { eachLine } from "./blocks";
import { isGridTable, rawTable, tableFromNode, type Row } from "./table-model";
import { EmptyCellWidget } from "./widgets";

export const tableHandlers: Record<string, Handler> = {
  Table(node, state, emit) {
    if (!isGridTable(node.node)) return;
    if (state.field(rawTable, false) === node.from) return;
    const table = tableFromNode(state, node.node);
    const { from: rf, to: rt } = emit.range;
    const visible = (row: Row) => row.to >= rf && row.from <= rt;
    const conceal = (a: number, b: number) => emit.conceal(Math.max(a, rf), Math.min(b, rt));

    table.rows.forEach((row, i) => {
      if (!visible(row)) return;
      eachLine(state, emit, row.from, row.from, (pos) =>
        emit.line(i === 0 ? "cm-ld-tr cm-ld-th" : "cm-ld-tr", pos),
      );
      // The cell marks tile the whole line (each starts at its left pipe), so concealed
      // pipes and padding live inside cells and the row has no other direct children.
      // Each conceal is split at the cell boundaries: a replace range crossing two cell
      // marks would be rendered outside both, as a stray row child.
      row.cells.forEach((cell, c) => {
        const start = c === 0 ? row.from : cell.from - 1;
        const end = c + 1 < row.cells.length ? row.cells[c + 1].from - 1 : row.to;
        const visFrom = Math.max(start, Math.min(cell.textFrom, end));
        const visTo = Math.min(end, Math.max(cell.textFrom === cell.textTo ? cell.to : cell.textTo, visFrom));
        conceal(start, visFrom);
        conceal(visTo, end);
        const align = table.aligns[c];
        const cls = align === "center" || align === "right" ? ` cm-ld-align-${align}` : "";
        // Inclusive sorts the cell mark outside any inline mark with the same range, so the
        // row's direct child stays the cell.
        emit.mark(`cm-ld-cell${cls}`, Math.max(start, rf), Math.min(end, rt), true);
      });
      if (row.to >= rf && row.to <= rt) {
        for (let c = row.cells.length; c < table.columns; c++) emit.point(new EmptyCellWidget(), row.to);
      }
    });

    const d = table.delimiter;
    if (visible(d)) {
      emit.line("cm-ld-tr cm-ld-tdelim", d.from);
      conceal(d.from, d.to);
    }
  },
};
