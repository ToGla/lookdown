// The CodeMirror editor, with Markdown live preview.

import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { EditorView, type ViewUpdate, drawSelection, keymap } from "@codemirror/view";

import { livePreview, markdownSupport } from "./preview";

export function createEditor(
  parent: HTMLElement,
  doc: string,
  onUpdate: (update: ViewUpdate) => void,
  onSave: () => void,
  openUrl: (url: string) => void,
): EditorView {
  return new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        history(),
        drawSelection(),
        EditorView.lineWrapping,
        markdownSupport(),
        livePreview({ openUrl }),
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
        EditorView.updateListener.of(onUpdate),
      ],
    }),
  });
}
