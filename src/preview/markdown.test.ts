import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { markdownSupport } from "./markdown";

describe("markdownSupport", () => {
  it("adds no input handlers, so nothing is auto-inserted (e.g. closing tags)", () => {
    const state = EditorState.create({ doc: "", extensions: [markdownSupport()] });
    expect(state.facet(EditorView.inputHandler)).toHaveLength(0);
  });
});
