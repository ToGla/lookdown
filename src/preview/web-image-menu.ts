import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { loadWebImage } from "./images";
import { openMenu } from "./popup-menu";

/** The URL of the not-yet-loaded web image placeholder under the event target, or null. */
export function webImageUrlAt(target: EventTarget | null): string | null {
  const el = (target as Element | null)?.closest?.("[data-ld-web]") as HTMLElement | null | undefined;
  return el?.dataset.ldWeb ?? null;
}

export function webImageMenu(): Extension {
  return EditorView.domEventHandlers({
    contextmenu(e, view) {
      const url = webImageUrlAt(e.target);
      if (url === null) return false;
      e.preventDefault();
      openMenu(
        view,
        [
          {
            label: "Load image",
            disabled: false,
            run: (v) => {
              v.dispatch({ effects: loadWebImage.of(url) });
              v.focus();
            },
          },
        ],
        e.clientX,
        e.clientY,
      );
      return true;
    },
  });
}
