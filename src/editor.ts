// The CodeMirror editor, with Markdown live preview.

import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { EditorView, type ViewUpdate, drawSelection, keymap } from "@codemirror/view";

import { type ImageIO, livePreview, markdownSupport } from "./preview";

export interface EditorOptions {
  onUpdate(u: ViewUpdate): void;
  onSave(): void;
  openUrl(url: string): void;
  /** The open file's path; local images resolve against its directory. */
  docPath: string | null;
  imageIO: ImageIO;
}

export function createEditor(parent: HTMLElement, doc: string, opts: EditorOptions): EditorView {
  const { onUpdate, onSave, openUrl, docPath, imageIO } = opts;
  return new EditorView({
    parent,
    state: EditorState.create({
      doc,
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
    }),
  });
}
