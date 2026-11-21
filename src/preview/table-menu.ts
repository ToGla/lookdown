import type { EditorState, Extension, TransactionSpec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { deleteColumn, deleteRow, insertColumn, insertRow, setAlign } from "./table-edit";
import { editAsMarkdown, tableAt } from "./table-model";

export interface MenuItem {
  label: string;
  disabled: boolean;
  run: (view: EditorView) => void;
}

/** Menu entries for a right-click at pos, or null outside grid tables. */
export function menuItems(state: EditorState, pos: number): MenuItem[] | null {
  const table = tableAt(state, pos);
  if (!table) return null;
  const structural = (label: string, spec: TransactionSpec | null): MenuItem => ({
    label,
    disabled: spec === null,
    run(view) {
      if (spec) view.dispatch({ ...spec, scrollIntoView: true, userEvent: "input" });
      view.focus();
    },
  });
  return [
    structural("Insert row above", insertRow(state, pos, "above")),
    structural("Insert row below", insertRow(state, pos, "below")),
    structural("Delete row", deleteRow(state, pos)),
    structural("Insert column left", insertColumn(state, pos, "left")),
    structural("Insert column right", insertColumn(state, pos, "right")),
    structural("Delete column", deleteColumn(state, pos)),
    structural("Align left", setAlign(state, pos, "left")),
    structural("Align center", setAlign(state, pos, "center")),
    structural("Align right", setAlign(state, pos, "right")),
    {
      label: "Edit as Markdown",
      disabled: false,
      run(view) {
        view.dispatch({
          selection: { anchor: pos },
          effects: editAsMarkdown.of(table.from),
          scrollIntoView: true,
        });
        view.focus();
      },
    },
  ];
}

let closeCurrent: (() => void) | null = null;

function openMenu(view: EditorView, items: MenuItem[], x: number, y: number): void {
  closeCurrent?.();
  const menu = document.createElement("div");
  menu.className = "cm-ld-menu";
  menu.setAttribute("role", "menu");
  const buttons: HTMLButtonElement[] = [];
  for (const item of items) {
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("role", "menuitem");
    b.textContent = item.label;
    b.disabled = item.disabled;
    b.addEventListener("click", () => {
      close();
      item.run(view);
    });
    menu.append(b);
    buttons.push(b);
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      view.focus();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const enabled = buttons.filter((b) => !b.disabled);
    if (!enabled.length) return;
    const i = enabled.indexOf(document.activeElement as HTMLButtonElement);
    const step = e.key === "ArrowDown" ? 1 : -1;
    enabled[(i + step + enabled.length) % enabled.length].focus();
  };
  const onPointerDown = (e: Event) => {
    if (!menu.contains(e.target as Node)) close();
  };
  const onDismiss = () => close();
  function close() {
    menu.remove();
    document.removeEventListener("keydown", onKey, true);
    document.removeEventListener("pointerdown", onPointerDown, true);
    window.removeEventListener("scroll", onDismiss, true);
    window.removeEventListener("blur", onDismiss);
    if (closeCurrent === close) closeCurrent = null;
  }
  closeCurrent = close;
  document.body.append(menu);
  const margin = 4;
  const left = Math.max(margin, Math.min(x, window.innerWidth - menu.offsetWidth - margin));
  const top = Math.max(margin, Math.min(y, window.innerHeight - menu.offsetHeight - margin));
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  document.addEventListener("keydown", onKey, true);
  document.addEventListener("pointerdown", onPointerDown, true);
  window.addEventListener("scroll", onDismiss, true);
  window.addEventListener("blur", onDismiss);
  buttons.find((b) => !b.disabled)?.focus();
}

export function tableMenu(): Extension {
  return EditorView.domEventHandlers({
    contextmenu(e, view) {
      const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
      if (pos === null) return false;
      const items = menuItems(view.state, pos);
      if (!items) return false;
      e.preventDefault();
      openMenu(view, items, e.clientX, e.clientY);
      return true;
    },
  });
}
