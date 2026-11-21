import { history, undo } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { ensureSyntaxTree } from "@codemirror/language";
import { describe, expect, it } from "vitest";
import { markdownSupport } from "./markdown";
import { toggleTask } from "./tasks";
import { at, mdState } from "./test-helpers";

function apply(doc: string, pos: number): string | null {
  const state = mdState(doc);
  const spec = toggleTask(state, pos);
  return spec ? state.update(spec).state.doc.toString() : null;
}

describe("toggleTask", () => {
  it("checks an unchecked task", () => {
    expect(apply("- [ ] a", 3)).toBe("- [x] a");
  });
  it("unchecks x and X", () => {
    expect(apply("- [x] a", 3)).toBe("- [ ] a");
    expect(apply("- [X] a", 3)).toBe("- [ ] a");
  });
  it("returns null off a task marker", () => {
    expect(apply("- [ ] a", 0)).toBeNull();
    expect(apply("- [ ] a", 6)).toBeNull();
    expect(apply("plain [ ] text", 7)).toBeNull();
  });
  it("undo restores the original character", () => {
    let state = EditorState.create({
      doc: "- [X] a",
      extensions: [markdownSupport(), history()],
    });
    ensureSyntaxTree(state, state.doc.length, 5000);
    const pos = at(state, "X");
    state = state.update(toggleTask(state, pos)!).state;
    expect(state.doc.toString()).toBe("- [ ] a");
    let out = state;
    undo({ state, dispatch: (tr) => (out = tr.state) });
    expect(out.doc.toString()).toBe("- [X] a");
  });
});
