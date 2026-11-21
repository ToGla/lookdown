// The CodeMirror editor. Plain text for now; live preview comes later.

import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { EditorView, type ViewUpdate, drawSelection, keymap } from "@codemirror/view";

export function createEditor(
  parent: HTMLElement,
  doc: string,
  onUpdate: (update: ViewUpdate) => void,
  onSave: () => void,
): EditorView {
  return new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        history(),
        drawSelection(),
        EditorView.lineWrapping,
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
