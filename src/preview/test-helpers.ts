import type { DecorationSet } from "@codemirror/view";
import { EditorSelection, EditorState, type Extension } from "@codemirror/state";
import { ensureSyntaxTree } from "@codemirror/language";
import { markdownSupport } from "./markdown";
import { rawTable } from "./table-model";
import { enableReveal, revealEnabled } from "./reveal";
import { imageExtensions } from "./images";

export function mdState(
  doc: string,
  opts: {
    selection?: EditorSelection | { anchor: number; head?: number };
    reveal?: boolean;
    /** Provides the image extensions (without an image cache). */
    docPath?: string | null;
    extensions?: Extension[];
  } = {},
): EditorState {
  let state = EditorState.create({
    doc,
    selection: opts.selection,
    extensions: [
      markdownSupport(),
      revealEnabled,
      rawTable,
      EditorState.allowMultipleSelections.of(true),
      opts.docPath === undefined ? [] : imageExtensions({ docPath: opts.docPath, images: null }),
      opts.extensions ?? [],
    ],
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

export function describeDecorations(set: DecorationSet): string[] {
  const out: string[] = [];
  for (const cursor = set.iter(); cursor.value; cursor.next()) {
    const spec = cursor.value.spec as { ld: string; class?: string; widget?: { name?: string } };
    const { from, to } = cursor;
    switch (spec.ld) {
      case "hide":
        out.push(`hide ${from}-${to}`);
        break;
      case "mark":
        out.push(`mark ${spec.class} ${from}-${to}`);
        break;
      case "line":
        out.push(`line ${spec.class} ${from}`);
        break;
      case "widget":
        out.push(`widget ${spec.widget?.name} ${from}-${to}`);
        break;
    }
  }
  return out;
}
