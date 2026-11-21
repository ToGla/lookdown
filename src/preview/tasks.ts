import { syntaxTree } from "@codemirror/language";
import type { EditorState, TransactionSpec } from "@codemirror/state";

/** `pos` is the offset of the character between `[` and `]` in a task marker. */
export function toggleTask(state: EditorState, pos: number): TransactionSpec | null {
  if (pos < 1 || pos + 1 > state.doc.length) return null;
  const node = syntaxTree(state).resolveInner(pos, 1);
  if (node.name !== "TaskMarker" || node.from !== pos - 1 || node.to !== pos + 2) return null;
  const ch = state.doc.sliceString(pos, pos + 1);
  if (ch !== " " && ch !== "x" && ch !== "X") return null;
  return { changes: { from: pos, to: pos + 1, insert: ch === " " ? "x" : " " } };
}
