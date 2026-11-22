import { undo } from "@codemirror/commands";
import { EditorSelection, EditorState } from "@codemirror/state";
import { describe, expect, test } from "vitest";
import { createTabState, reloadTransaction } from "./editor";

const opts = {
  onUpdate() {},
  onSave() {},
  openUrl() {},
  docPath: null,
  imageIO: {} as never,
};

describe("reloadTransaction", () => {
  test("keeps the cursor at the end and is not undoable", () => {
    let state = createTabState("a\nb\nc", opts);
    state = state.update({ selection: EditorSelection.cursor(5) }).state;
    state = state.update(reloadTransaction(state, "a\nB\nc")).state;
    expect(state.doc.toString()).toBe("a\nB\nc");
    expect(state.selection.main.head).toBe(5);
    undo({ state, dispatch: (tr) => (state = tr.state) });
    expect(state.doc.toString()).toBe("a\nB\nc");
  });

  test("applies to a state not attached to a view", () => {
    const state = createTabState("old", opts);
    expect(state.update(reloadTransaction(state, "new text")).state.doc.toString()).toBe("new text");
  });

  test("equal text yields no changes", () => {
    const state = EditorState.create({ doc: "same" });
    expect(state.update(reloadTransaction(state, "same")).docChanged).toBe(false);
  });

  test("overlapping prefix and suffix still yields the new text", () => {
    const state = EditorState.create({ doc: "aa" });
    expect(state.update(reloadTransaction(state, "aaa")).state.doc.toString()).toBe("aaa");
  });
});
