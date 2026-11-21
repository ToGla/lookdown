import type { EditorState, TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { menuItems } from "./table-menu";
import { at, mdState } from "./test-helpers";

const T = "| a | bb |\n|---|---|\n| c | d |";
const ONE = "| a |\n|---|\n| c |";
const labels = [
  "Insert row above",
  "Insert row below",
  "Delete row",
  "Insert column left",
  "Insert column right",
  "Delete column",
  "Align left",
  "Align center",
  "Align right",
  "Edit as Markdown",
];

describe("menuItems", () => {
  it("lists labels in order", () => {
    const s = mdState(T);
    expect(menuItems(s, at(s, "d"))!.map((i) => i.label)).toEqual(labels);
  });
  it("disables row above/delete on the header", () => {
    const s = mdState(T);
    const m = Object.fromEntries(menuItems(s, at(s, "a"))!.map((i) => [i.label, i.disabled]));
    expect(m["Insert row above"]).toBe(true);
    expect(m["Delete row"]).toBe(true);
    expect(m["Insert row below"]).toBe(false);
    expect(m["Edit as Markdown"]).toBe(false);
  });
  it("disables Delete column on a 1-column table", () => {
    const s = mdState(ONE);
    const m = Object.fromEntries(menuItems(s, at(s, "c"))!.map((i) => [i.label, i.disabled]));
    expect(m["Delete column"]).toBe(true);
  });
  it("is null outside a table", () => {
    const s = mdState("hello\n\n" + T);
    expect(menuItems(s, 2)).toBeNull();
  });
});

describe("running an item", () => {
  type Spec = Parameters<EditorView["dispatch"]>[0];
  function fakeView(state: EditorState) {
    const sent: Spec[] = [];
    const view = { state, dispatch: (s: Spec) => sent.push(s), focus() {} } as unknown as EditorView;
    return { view, sent };
  }
  const item = (s: EditorState, pos: number, label: string) => menuItems(s, pos)!.find((i) => i.label === label)!;

  it("computes the edit from the state at click time", () => {
    const s = mdState(T);
    const del = item(s, at(s, "d"), "Delete row");
    // the document changes while the menu is open
    const later = s.update({ changes: { from: 0, insert: "x\n\n" } }).state;
    const { view, sent } = fakeView(later);
    del.run(view);
    expect(sent).toHaveLength(1);
    expect(later.update(sent[0] as TransactionSpec).state.doc.toString()).toBe("x\n\n| a | bb |\n|---|---|");
  });
  it("does nothing when the command no longer applies", () => {
    const s = mdState(T);
    const items = menuItems(s, at(s, "d"))!;
    for (const doc of ["plain text, no table here at all", "short"]) {
      const { view, sent } = fakeView(mdState(doc));
      for (const i of items) i.run(view);
      expect(sent).toHaveLength(0);
    }
  });
});
