import { EditorSelection, EditorState } from "@codemirror/state";
import { ensureSyntaxTree } from "@codemirror/language";
import { markdownSupport } from "./markdown";
import { enableReveal, revealEnabled } from "./reveal";

export function mdState(
  doc: string,
  opts: {
    selection?: EditorSelection | { anchor: number; head?: number };
    reveal?: boolean;
  } = {},
): EditorState {
  let state = EditorState.create({
    doc,
    selection: opts.selection,
    extensions: [markdownSupport(), revealEnabled, EditorState.allowMultipleSelections.of(true)],
  });
  if (opts.reveal) {
    state = state.update({ effects: enableReveal.of(null) }).state;
  }
  ensureSyntaxTree(state, state.doc.length, 5000);
  return state;
}

export function at(state: EditorState, text: string): number {
  return state.doc.toString().indexOf(text);
}
