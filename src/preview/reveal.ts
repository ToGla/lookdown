import { syntaxTree } from "@codemirror/language";
import { EditorState, StateEffect, StateField } from "@codemirror/state";
import { cellAt, tableAt } from "./table-model";

export interface Range {
  from: number;
  to: number;
}

export const enableReveal = StateEffect.define<null>();

export const revealEnabled = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(enableReveal)) return true;
    return value;
  },
});

// Always revealed as a whole when touched.
const BLOCK_UNITS = new Set([
  "FencedCode",
  "CodeBlock",
  "SetextHeading1",
  "SetextHeading2",
]);
// Revealed as a whole only when they cross a line break.
const INLINE_UNITS = new Set([
  "Emphasis",
  "StrongEmphasis",
  "Strikethrough",
  "InlineCode",
  "Link",
  "Autolink",
]);

// Inside a grid table, a range whose ends sit in cells of one row reveals just those cells.
function cellSpan(state: EditorState, from: number, to: number): Range | null {
  const table = tableAt(state, from);
  if (!table) return null;
  const a = cellAt(table, from);
  const b = cellAt(table, to);
  if (!a || !b || a.row !== b.row) return null;
  const cells = table.rows[a.row].cells;
  return { from: cells[a.col].from, to: cells[b.col].to };
}

export function revealedRanges(state: EditorState): Range[] {
  if (!state.field(revealEnabled, false)) return [];
  const doc = state.doc;
  const tree = syntaxTree(state);
  const spans: Range[] = state.selection.ranges.map(
    (r) =>
      cellSpan(state, r.from, r.to) ?? {
        from: doc.lineAt(r.from).from,
        to: doc.lineAt(r.to).to,
      },
  );

  for (const span of spans) {
    let changed = true;
    while (changed) {
      changed = false;
      tree.iterate({
        from: span.from,
        to: span.to,
        enter(node) {
          const name = node.name;
          const unit =
            BLOCK_UNITS.has(name) ||
            (INLINE_UNITS.has(name) &&
              doc.lineAt(node.from).number !== doc.lineAt(node.to).number);
          if (!unit) return;
          const from = doc.lineAt(node.from).from;
          const to = doc.lineAt(node.to).to;
          if (from < span.from) {
            span.from = from;
            changed = true;
          }
          if (to > span.to) {
            span.to = to;
            changed = true;
          }
        },
      });
    }
  }

  spans.sort((a, b) => a.from - b.from);
  const merged: Range[] = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && s.from <= last.to + 1) last.to = Math.max(last.to, s.to);
    else merged.push({ ...s });
  }
  return merged;
}

export function isRevealed(ranges: Range[], from: number, to: number): boolean {
  return ranges.some((r) => from <= r.to && to >= r.from);
}
