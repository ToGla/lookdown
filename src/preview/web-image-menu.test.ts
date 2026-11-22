import { describe, expect, it } from "vitest";
import { history, undo } from "@codemirror/commands";
import { ImageBlockWidget, imageField, loadWebImage, loadedWebImages, retryImages } from "./images";
import { webImageUrlAt } from "./web-image-menu";
import { mdState } from "./test-helpers";
import type { EditorState } from "@codemirror/state";

const DOC = "![a](https://e.com/x.png)\n\n![b](https://e.com/x.png)\n\n![c](https://e.com/y.png)";

function widgets(state: EditorState): ImageBlockWidget[] {
  const out: ImageBlockWidget[] = [];
  for (const c = state.field(imageField).iter(); c.value; c.next()) out.push(c.value.spec.widget);
  return out;
}

describe("loadWebImage", () => {
  it("marks every widget with that URL", () => {
    const s = mdState(DOC, { docPath: "C:/d/a.md" }).update({ effects: loadWebImage.of("https://e.com/x.png") }).state;
    expect(widgets(s).map((w) => w.loaded)).toEqual([true, true, false]);
    expect(s.doc.toString()).toBe(DOC);
  });

  it("drops the load when the URL is edited", () => {
    let s = mdState(DOC, { docPath: "C:/d/a.md" }).update({ effects: loadWebImage.of("https://e.com/x.png") }).state;
    s = s.update({ changes: { from: 19, to: 20, insert: "z" } }).state;
    expect(s.doc.sliceString(0, 25)).toBe("![a](https://e.com/z.png)");
    expect(widgets(s)[0].loaded).toBe(false);
  });

  it("is not undoable", () => {
    let s = mdState(DOC, { docPath: "C:/d/a.md", extensions: [history()] });
    s = s.update({ changes: { from: DOC.length, insert: " tail" }, userEvent: "input" }).state;
    s = s.update({ effects: loadWebImage.of("https://e.com/x.png") }).state;
    let after = s;
    const ran = undo({ state: s, dispatch: (tr) => (after = tr.state) });
    expect(ran).toBe(true);
    expect(after.doc.toString()).toBe(DOC);
    expect(widgets(after)[0].loaded).toBe(true);
  });

  it("counts attempts: loading the same URL again gives a widget that is not eq", () => {
    const url = "https://e.com/x.png";
    const one = mdState(DOC, { docPath: "C:/d/a.md" }).update({ effects: loadWebImage.of(url) }).state;
    const two = one.update({ effects: loadWebImage.of(url) }).state;
    expect(one.field(loadedWebImages).get(url)).toBe(1);
    expect(two.field(loadedWebImages).get(url)).toBe(2);
    expect(widgets(two)[0].eq(widgets(one)[0])).toBe(false);
    expect(widgets(two)[2].eq(widgets(one)[2])).toBe(true);
  });

  it("is ignored by local images", () => {
    const s = mdState("![l](pic.png)", { docPath: "C:/d/a.md" }).update({ effects: loadWebImage.of("pic.png") }).state;
    expect(widgets(s)[0].loaded).toBe(false);
  });
});

describe("retryImages", () => {
  it("makes only the retried path's widgets not eq", () => {
    const doc = "![a](a.png)\n\n![b](b.png)\n\n![w](https://e.com/x.png)";
    const before = mdState(doc, { docPath: "C:/d/a.md" });
    const after = before.update({ effects: retryImages.of(["C:/d/a.png"]) }).state;
    expect(widgets(after)[0].eq(widgets(before)[0])).toBe(false);
    expect(widgets(after)[1].eq(widgets(before)[1])).toBe(true);
    expect(widgets(after)[2].eq(widgets(before)[2])).toBe(true);
    expect(after.doc.toString()).toBe(doc);
  });
});

describe("webImageUrlAt", () => {
  const target = (v: unknown) => v as EventTarget;
  it("reads data-ld-web", () => {
    expect(webImageUrlAt(target({ closest: () => ({ dataset: { ldWeb: "https://e.com/x.png" } }) }))).toBe("https://e.com/x.png");
  });
  it("returns null otherwise", () => {
    expect(webImageUrlAt(null)).toBeNull();
    expect(webImageUrlAt(target({ closest: () => null }))).toBeNull();
  });
});
