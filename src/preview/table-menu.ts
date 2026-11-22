import type { EditorState, Extension, TransactionSpec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { deleteColumn, deleteRow, insertColumn, insertRow, setAlign } from "./table-edit";
import { type MenuItem, openMenu } from "./popup-menu";
import { editAsMarkdown, tableAt } from "./table-model";

export type { MenuItem };

type Command = (state: EditorState, pos: number) => TransactionSpec | null;

/** Menu entries for a right-click at pos, or null outside grid tables. `disabled` reflects the
 *  state at open time; `run` recomputes its edit from the view's state at click time (and does
 *  nothing if it no longer applies), so a document change while the menu is open is safe. */
export function menuItems(state: EditorState, pos: number): MenuItem[] | null {
  if (!tableAt(state, pos)) return null;
  const structural = (label: string, command: Command): MenuItem => ({
    label,
    disabled: command(state, pos) === null,
    run(view) {
      const spec = pos <= view.state.doc.length ? command(view.state, pos) : null;
      if (spec) view.dispatch({ ...spec, scrollIntoView: true, userEvent: "input" });
      view.focus();
    },
  });
  return [
    structural("Insert row above", (s, p) => insertRow(s, p, "above")),
    structural("Insert row below", (s, p) => insertRow(s, p, "below")),
    structural("Delete row", deleteRow),
    structural("Insert column left", (s, p) => insertColumn(s, p, "left")),
    structural("Insert column right", (s, p) => insertColumn(s, p, "right")),
    structural("Delete column", deleteColumn),
    structural("Align left", (s, p) => setAlign(s, p, "left")),
    structural("Align center", (s, p) => setAlign(s, p, "center")),
    structural("Align right", (s, p) => setAlign(s, p, "right")),
    {
      label: "Edit as Markdown",
      disabled: false,
      run(view) {
        const table = pos <= view.state.doc.length ? tableAt(view.state, pos) : null;
        if (table)
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
