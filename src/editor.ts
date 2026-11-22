// The CodeMirror editor, with Markdown live preview.

import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { EditorState, Transaction, type TransactionSpec } from "@codemirror/state";
import { EditorView, type ViewUpdate, drawSelection, keymap } from "@codemirror/view";

import { reloadAnnotation } from "./document";
import { type ImageIO, livePreview, markdownSupport } from "./preview";

export interface TabStateOptions {
  onUpdate(u: ViewUpdate): void;
  onSave(): void;
  openUrl(url: string): void;
  /** The open file's path; local images resolve against its directory. */
  docPath: string | null;
  imageIO: ImageIO;
}

export type EditorOptions = TabStateOptions;

/** A fresh editor state (empty history) for one tab's text. */
export function createTabState(text: string, opts: TabStateOptions): EditorState {
  const { onUpdate, onSave, openUrl, docPath, imageIO } = opts;
  return EditorState.create({
    doc: text,
    extensions: [
      history(),
      drawSelection(),
      EditorView.lineWrapping,
      markdownSupport(),
      livePreview({ openUrl, docPath, imageIO }),
      keymap.of([
        {
          key: "Mod-s",
          preventDefault: true,
          run: () => {
            onSave();
            return true;
          },
        },
        ...defaultKeymap,
        ...historyKeymap,
      ]),
      EditorView.updateListener.of((u) => onUpdate(u)),
    ],
  });
}

export function createView(parent: HTMLElement, state: EditorState): EditorView {
  return new EditorView({ parent, state });
}

/**
 * Load new on-disk text, replacing only the differing middle so the cursor and
 * earlier history map through. Not an undo step, and not a user edit.
 */
export function reloadTransaction(state: EditorState, text: string): TransactionSpec {
  const old = state.doc.toString();
  let start = 0;
  const max = Math.min(old.length, text.length);
  while (start < max && old.charCodeAt(start) === text.charCodeAt(start)) start++;
  let oldEnd = old.length;
  let newEnd = text.length;
  while (oldEnd > start && newEnd > start && old.charCodeAt(oldEnd - 1) === text.charCodeAt(newEnd - 1)) {
    oldEnd--;
    newEnd--;
  }
  const annotations = [reloadAnnotation.of(true), Transaction.addToHistory.of(false)];
  if (start === oldEnd && start === newEnd) return { annotations };
  return { changes: { from: start, to: oldEnd, insert: text.slice(start, newEnd) }, annotations };
}

export function createEditor(parent: HTMLElement, doc: string, opts: EditorOptions): EditorView {
  return createView(parent, createTabState(doc, opts));
}
