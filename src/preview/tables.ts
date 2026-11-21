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
      let pos = row.from;
      row.cells.forEach((cell, c) => {
        const blank = cell.textFrom === cell.textTo;
        const markTo = blank ? cell.to : cell.textTo;
        conceal(pos, cell.textFrom);
        if (markTo > cell.textFrom) {
          const align = table.aligns[c];
          const cls = align === "center" || align === "right" ? ` cm-ld-align-${align}` : "";
          if (cell.textFrom >= rf && markTo <= rt) // Inclusive sorts the cell mark outside any inline mark with the same range, so the
          // row's direct child stays the cell (the CSS hides other children).
          emit.mark(`cm-ld-cell${cls}`, cell.textFrom, markTo, true);
        } else if (cell.textFrom >= rf && cell.textFrom <= rt) {
          emit.point(new EmptyCellWidget(), cell.textFrom);
        }
        pos = markTo;
      });
      conceal(pos, row.to);
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
