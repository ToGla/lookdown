// The bar above the editor telling the active tab's file changed or vanished on disk.

export type BarAction = "reload" | "keep-yours" | "close" | "keep";

export interface BarModel {
  message: string;
  /** Why the changed file could not be reloaded (e.g. not UTF-8); "" when none. */
  error: string;
  actions: { label: string; action: BarAction }[];
}

export function barModel(kind: "changed" | "deleted", name: string, error = ""): BarModel {
  if (kind === "deleted") {
    return {
      message: `${name} was deleted or moved.`,
      error,
      actions: [
        { label: "Close tab", action: "close" },
        { label: "Keep", action: "keep" },
      ],
    };
  }
  return {
    message: `${name} changed on disk.`,
    error,
    actions: [
      { label: "Reload (discard your changes)", action: "reload" },
      { label: "Keep yours", action: "keep-yours" },
    ],
  };
}

/** Insert the bar right before `editor`; hidden while `render(null)`. */
export function createDiskBar(
  editor: HTMLElement,
  act: (action: BarAction) => void,
): { render(model: BarModel | null): void } {
  const bar = document.createElement("div");
  bar.className = "ld-diskbar";
  bar.setAttribute("role", "alert");
  bar.hidden = true;
  editor.before(bar);

  return {
    render(model) {
      bar.hidden = model === null;
      if (!model) {
        bar.replaceChildren();
        return;
      }
      const text = document.createElement("span");
      text.className = "ld-diskbar-text";
      text.textContent = model.message;
      if (model.error) {
        const error = document.createElement("span");
        error.className = "ld-diskbar-error";
        error.textContent = model.error;
        text.append(" ", error);
      }
      const buttons = model.actions.map(({ label, action }) => {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = label;
        button.addEventListener("click", () => act(action));
        return button;
      });
      bar.replaceChildren(text, ...buttons);
    },
  };
}
