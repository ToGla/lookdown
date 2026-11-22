import { EditorState, StateEffect, type TransactionSpec } from "@codemirror/state";
import { EditorView, type ViewUpdate } from "@codemirror/view";
import { beforeEach, describe, expect, test } from "vitest";

import { App, type AppModel, type AppUi, type ViewPort, keyCommand } from "./app";
import { FakeHost } from "./test-host";
import { emptyText } from "./ui/empty";

const scrollTo = StateEffect.define<number>();

class StubView implements ViewPort {
  destroyed = false;
  focused = 0;
  scrolls: StateEffect<unknown>[] = [];
  setStates = 0;
  /** What scrollSnapshot returns next (the "scroll position"). */
  scrollPos = 0;

  constructor(public state: EditorState) {}

  setState(state: EditorState): void {
    this.state = state;
    this.setStates++;
  }
  scrollSnapshot(): StateEffect<unknown> {
    return scrollTo.of(this.scrollPos);
  }
  restoreScroll(effect: StateEffect<unknown>): void {
    this.scrolls.push(effect);
  }
  focus(): void {
    this.focused++;
  }
  destroy(): void {
    this.destroyed = true;
  }
  /** Apply a transaction like EditorView.dispatch does, calling the update listeners. */
  dispatch(spec: TransactionSpec): void {
    const tr = this.state.update(spec);
    this.state = tr.state;
    const update = { transactions: [tr], docChanged: tr.docChanged, state: tr.state, startState: tr.startState };
    for (const listener of tr.startState.facet(EditorView.updateListener)) listener(update as unknown as ViewUpdate);
  }
}

class StubUi implements AppUi {
  views: StubView[] = [];
  models: AppModel[] = [];
  statuses: string[] = [];
  createView(state: EditorState): ViewPort {
    const view = new StubView(state);
    this.views.push(view);
    return view;
  }
  render(model: AppModel): void {
    this.models.push(model);
  }
  status(message: string): void {
    this.statuses.push(message);
  }
  get view(): StubView {
    return this.views[this.views.length - 1];
  }
  get model(): AppModel {
    return this.models[this.models.length - 1];
  }
  get statusLine(): string {
    return this.statuses[this.statuses.length - 1] ?? "";
  }
}

let host: FakeHost;
let ui: StubUi;
let app: App;

beforeEach(() => {
  host = new FakeHost();
  host.setFile("/docs/a.md", "alpha\n");
  host.setFile("/docs/b.md", "bravo\n");
  host.setFile("/docs/c.md", "charlie\n");
  host.setFile("/work/notes.md", "work\n");
  host.setFile("/home/notes.md", "home\n");
  host.setFile("/docs/bad.md", new Uint8Array([0x61, 0xff, 0x62]));
  ui = new StubUi();
  app = new App(host, ui);
});

const paths = () => app.tabs.map((t) => t.path);
const activePath = () => app.active?.path ?? null;

describe("startup and the empty window", () => {
  test("with nothing queued the window is empty and titled lookdown", async () => {
    await app.start();
    expect(app.tabs).toHaveLength(0);
    expect(host.title).toBe("lookdown");
    expect(ui.model).toEqual({ tabs: [], activeId: null });
    expect(ui.views).toHaveLength(0);
  });

  test("listens for queued paths before draining the startup queue", async () => {
    host.queued = ["/docs/a.md", "/docs/b.md"];
    await app.start();
    expect(host.calls.indexOf("onPathsQueued")).toBeLessThan(host.calls.indexOf("takePaths"));
    expect(paths()).toEqual(["/docs/a.md", "/docs/b.md"]);
  });

  test("paths queued later (second instance) open as tabs", async () => {
    await app.start();
    host.queuePaths("/docs/c.md");
    await app.idle();
    expect(paths()).toEqual(["/docs/c.md"]);
    expect(activePath()).toBe("/docs/c.md");
  });

  test("dropped files open as tabs", async () => {
    await app.start();
    host.dropFiles("/docs/a.md", "/docs/b.md");
    await app.idle();
    expect(paths()).toEqual(["/docs/a.md", "/docs/b.md"]);
  });

  test("the empty page copy uses Ctrl+O, or Cmd+O on macOS", () => {
    expect(emptyText(false)).toBe("Open a file with Ctrl+O, or drop one here.");
    expect(emptyText(true)).toBe("Open a file with ⌘O, or drop one here.");
  });
});

describe("openPaths", () => {
  test("opens a file in a new active tab and shows it", async () => {
    await app.openPaths(["/docs/a.md"]);
    expect(paths()).toEqual(["/docs/a.md"]);
    expect(ui.views).toHaveLength(1);
    expect(ui.view.state.doc.toString()).toBe("alpha\n");
    expect(ui.view.focused).toBeGreaterThan(0);
    expect(host.title).toBe("a.md — lookdown");
    expect(ui.model.tabs).toEqual([{ id: app.active!.id, label: "a.md", path: "/docs/a.md", marker: "" }]);
    expect(ui.model.activeId).toBe(app.active!.id);
  });

  test("records the file's stamp", async () => {
    await app.openPaths(["/docs/a.md"]);
    expect(app.active!.stamp).toEqual(host.stamps.get("/docs/a.md"));
    expect(app.active!.dismissed).toBeNull();
  });

  test("several paths keep their order and the last one is active", async () => {
    await app.openPaths(["/docs/a.md", "/docs/b.md", "/docs/c.md"]);
    expect(paths()).toEqual(["/docs/a.md", "/docs/b.md", "/docs/c.md"]);
    expect(activePath()).toBe("/docs/c.md");
    expect(ui.view.state.doc.toString()).toBe("charlie\n");
    expect(ui.views).toHaveLength(1);
  });

  test("a new tab goes right after the active tab", async () => {
    await app.openPaths(["/docs/a.md", "/docs/b.md"]);
    app.select(app.tabs[0].id);
    await app.openPaths(["/docs/c.md"]);
    expect(paths()).toEqual(["/docs/a.md", "/docs/c.md", "/docs/b.md"]);
  });

  test("an already open file is activated, not opened again", async () => {
    await app.openPaths(["/docs/a.md", "/docs/b.md"]);
    const reads = host.calls.length;
    await app.openPaths(["/docs/./a.md"]);
    expect(paths()).toEqual(["/docs/a.md", "/docs/b.md"]);
    expect(activePath()).toBe("/docs/a.md");
    expect(ui.view.state.doc.toString()).toBe("alpha\n");
    expect(host.calls.length).toBe(reads);
  });

  test("path case only matters on case-sensitive hosts", async () => {
    host.caseInsensitivePaths = true;
    app = new App(host, ui);
    await app.openPaths(["/docs/a.md", "/DOCS/A.MD"]);
    expect(paths()).toEqual(["/docs/a.md"]);
  });

  test("the same path twice in one call opens one tab", async () => {
    await app.openPaths(["/docs/a.md", "/docs/a.md"]);
    expect(paths()).toEqual(["/docs/a.md"]);
  });

  test("concurrent opens of one file open one tab", async () => {
    await Promise.all([app.openPaths(["/docs/a.md"]), app.openPaths(["/docs/a.md"])]);
    expect(paths()).toEqual(["/docs/a.md"]);
  });

  test("an unreadable file opens no tab and shows the error", async () => {
    await app.openPaths(["/docs/missing.md"]);
    expect(app.tabs).toHaveLength(0);
    expect(ui.statusLine).toContain("Could not open /docs/missing.md");
    expect(ui.statusLine).toContain("file not found");
    expect(host.title).toBe("lookdown");
  });

  test("a file that is not UTF-8 opens no tab and shows the error", async () => {
    await app.openPaths(["/docs/a.md", "/docs/bad.md", "/docs/b.md"]);
    expect(paths()).toEqual(["/docs/a.md", "/docs/b.md"]);
    expect(ui.statusLine).toMatch(/^bad\.md: /);
  });

  test("a later successful open clears an old error", async () => {
    await app.openPaths(["/docs/missing.md"]);
    await app.openPaths(["/docs/a.md"]);
    expect(ui.statusLine).toBe("");
  });

  test("two files with the same name show their parent folder", async () => {
    await app.openPaths(["/work/notes.md", "/home/notes.md"]);
    expect(ui.model.tabs.map((t) => t.label)).toEqual(["notes.md — work", "notes.md — home"]);
    expect(host.title).toBe("notes.md — home — lookdown");
  });

  test("the open dialog's files are opened", async () => {
    host.picks = [["/docs/b.md", "/docs/c.md"]];
    await app.run("open");
    expect(paths()).toEqual(["/docs/b.md", "/docs/c.md"]);
  });

  test("a cancelled open dialog changes nothing", async () => {
    await app.run("open");
    expect(app.tabs).toHaveLength(0);
    expect(host.calls).toContain("pickFiles");
  });
});

describe("switching tabs", () => {
  test("each tab keeps its own state and scroll position", async () => {
    await app.openPaths(["/docs/a.md", "/docs/b.md"]);
    const [a, b] = app.tabs;
    const view = ui.view;
    view.dispatch({ selection: { anchor: 3 } });
    view.scrollPos = 42;
    app.select(a.id);
    expect(view.state.doc.toString()).toBe("alpha\n");
    expect(b.state.selection.main.head).toBe(3);
    view.scrollPos = 7;
    app.select(b.id);
    expect(view.state.selection.main.head).toBe(3);
    expect(view.scrolls[view.scrolls.length - 1].value).toBe(42);
    app.select(a.id);
    expect(view.scrolls[view.scrolls.length - 1].value).toBe(7);
    expect(ui.views).toHaveLength(1);
  });

  test("next and previous wrap", async () => {
    await app.openPaths(["/docs/a.md", "/docs/b.md", "/docs/c.md"]);
    await app.run("next");
    expect(activePath()).toBe("/docs/a.md");
    await app.run("previous");
    expect(activePath()).toBe("/docs/c.md");
    await app.run("previous");
    expect(activePath()).toBe("/docs/b.md");
    expect(ui.view.state.doc.toString()).toBe("bravo\n");
    expect(host.title).toBe("b.md — lookdown");
  });

  test("selecting the active tab does not reset the view", async () => {
    await app.openPaths(["/docs/a.md"]);
    const before = ui.view.setStates;
    app.select(app.active!.id);
    expect(ui.view.setStates).toBe(before);
  });
});

describe("edits and saving", () => {
  test("an edit marks only its own tab dirty and updates title and tab bar", async () => {
    await app.openPaths(["/docs/a.md", "/docs/b.md"]);
    const [a, b] = app.tabs;
    app.select(a.id);
    ui.view.dispatch({ changes: { from: 0, insert: "X" } });
    expect(a.doc.isDirty()).toBe(true);
    expect(b.doc.isDirty()).toBe(false);
    expect(host.title).toBe("• a.md — lookdown");
    expect(ui.model.tabs.map((t) => t.marker)).toEqual(["•", ""]);
  });

  test("an edit after switching goes to the newly shown tab's document", async () => {
    await app.openPaths(["/docs/a.md", "/docs/b.md"]);
    const [a, b] = app.tabs;
    app.select(a.id);
    app.select(b.id);
    ui.view.dispatch({ changes: { from: 0, insert: "Y" } });
    expect(b.doc.isDirty()).toBe(true);
    expect(a.doc.isDirty()).toBe(false);
  });

  test("save writes the active tab, clears dirty and records the new stamp", async () => {
    await app.openPaths(["/docs/a.md"]);
    ui.view.dispatch({ changes: { from: 0, insert: "X" } });
    await app.save();
    expect(host.text("/docs/a.md")).toBe("Xalpha\n");
    expect(app.active!.doc.isDirty()).toBe(false);
    expect(app.active!.stamp).toEqual(host.stamps.get("/docs/a.md"));
    expect(host.title).toBe("a.md — lookdown");
    expect(ui.model.tabs[0].marker).toBe("");
  });

  test("a failed save keeps the tab dirty and shows the error", async () => {
    await app.openPaths(["/docs/a.md"]);
    host.writeErrors.set("/docs/a.md", "disk full");
    ui.view.dispatch({ changes: { from: 0, insert: "X" } });
    await app.save();
    expect(app.active!.doc.isDirty()).toBe(true);
    expect(ui.statusLine).toContain("disk full");
  });
});

describe("closing", () => {
  test("closing a clean tab activates its neighbour", async () => {
    await app.openPaths(["/docs/a.md", "/docs/b.md", "/docs/c.md"]);
    app.select(app.tabs[1].id);
    await app.run("close");
    expect(paths()).toEqual(["/docs/a.md", "/docs/c.md"]);
    expect(activePath()).toBe("/docs/c.md");
    expect(ui.view.state.doc.toString()).toBe("charlie\n");
  });

  test("closing a tab by id (× or middle click)", async () => {
    await app.openPaths(["/docs/a.md", "/docs/b.md"]);
    await app.closeTab(app.tabs[0].id);
    expect(paths()).toEqual(["/docs/b.md"]);
    expect(activePath()).toBe("/docs/b.md");
  });

  test("closing the last tab destroys the view and empties the window; the next open makes a new view", async () => {
    await app.openPaths(["/docs/a.md"]);
    const first = ui.view;
    await app.run("close");
    expect(first.destroyed).toBe(true);
    expect(app.tabs).toHaveLength(0);
    expect(host.title).toBe("lookdown");
    expect(ui.model).toEqual({ tabs: [], activeId: null });
    await app.openPaths(["/docs/b.md"]);
    expect(ui.views).toHaveLength(2);
    expect(ui.view.state.doc.toString()).toBe("bravo\n");
  });

  test("a dirty tab is not closed (the prompt comes later)", async () => {
    await app.openPaths(["/docs/a.md"]);
    ui.view.dispatch({ changes: { from: 0, insert: "X" } });
    await app.run("close");
    expect(paths()).toEqual(["/docs/a.md"]);
  });

  test("closing with no tab does nothing", async () => {
    await app.run("close");
    await app.run("next");
    expect(app.tabs).toHaveLength(0);
  });

  test("the window closes at once when nothing is unsaved, and stays open otherwise", async () => {
    await app.start();
    await app.openPaths(["/docs/a.md"]);
    expect(await host.requestClose()).toBe(true);
    ui.view.dispatch({ changes: { from: 0, insert: "X" } });
    expect(await host.requestClose()).toBe(false);
  });
});

describe("keyCommand", () => {
  const key = (k: string, mods: Partial<Record<"ctrlKey" | "metaKey" | "shiftKey" | "altKey", boolean>> = {}) => ({
    key: k,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...mods,
  });

  test("Windows and Linux use Ctrl", () => {
    expect(keyCommand(key("o", { ctrlKey: true }), false)).toBe("open");
    expect(keyCommand(key("O", { ctrlKey: true }), false)).toBe("open");
    expect(keyCommand(key("w", { ctrlKey: true }), false)).toBe("close");
    expect(keyCommand(key("o", { metaKey: true }), false)).toBeNull();
  });

  test("macOS uses Cmd for open and close", () => {
    expect(keyCommand(key("o", { metaKey: true }), true)).toBe("open");
    expect(keyCommand(key("w", { metaKey: true }), true)).toBe("close");
    expect(keyCommand(key("o", { ctrlKey: true }), true)).toBeNull();
  });

  test("Ctrl+Tab and Ctrl+PageDown/Up switch tabs on every platform", () => {
    for (const mac of [false, true]) {
      expect(keyCommand(key("Tab", { ctrlKey: true }), mac)).toBe("next");
      expect(keyCommand(key("Tab", { ctrlKey: true, shiftKey: true }), mac)).toBe("previous");
      expect(keyCommand(key("PageDown", { ctrlKey: true }), mac)).toBe("next");
      expect(keyCommand(key("PageUp", { ctrlKey: true }), mac)).toBe("previous");
    }
  });

  test("other keys and extra modifiers are left alone", () => {
    expect(keyCommand(key("o"), false)).toBeNull();
    expect(keyCommand(key("s", { ctrlKey: true }), false)).toBeNull();
    expect(keyCommand(key("o", { ctrlKey: true, shiftKey: true }), false)).toBeNull();
    expect(keyCommand(key("o", { ctrlKey: true, altKey: true }), false)).toBeNull();
    expect(keyCommand(key("Tab"), false)).toBeNull();
    expect(keyCommand(key("PageDown"), false)).toBeNull();
  });
});
