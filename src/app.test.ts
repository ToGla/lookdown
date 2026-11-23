import { EditorState, StateEffect, type Transaction, type TransactionSpec } from "@codemirror/state";
import { EditorView, type ViewUpdate } from "@codemirror/view";
import { redo, undo } from "@codemirror/commands";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { App, type AppModel, type AppUi, type ViewPort, isCommand, isReloadKey, keyCommand } from "./app";
import { previewConfig } from "./preview/images";
import { closeMenu } from "./preview/popup-menu";
import { FakeHost } from "./test-host";
import { emptyText } from "./ui/empty";

// Spied on, so tests can check an open table menu is closed when the shown tab changes.
vi.mock("./preview/popup-menu", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./preview/popup-menu")>();
  return { ...actual, closeMenu: vi.fn(actual.closeMenu) };
});

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
  undo(): void {
    undo({ state: this.state, dispatch: (tr) => this.apply(tr) });
  }
  redo(): void {
    redo({ state: this.state, dispatch: (tr) => this.apply(tr) });
  }
  /** Apply a transaction like EditorView.dispatch does, calling the update listeners. */
  dispatch(spec: TransactionSpec): void {
    this.apply(this.state.update(spec));
  }
  private apply(tr: Transaction): void {
    this.state = tr.state;
    const update = { transactions: [tr], docChanged: tr.docChanged, state: tr.state, startState: tr.startState };
    for (const listener of tr.startState.facet(EditorView.updateListener)) listener(update as unknown as ViewUpdate);
  }
}

class StubUi implements AppUi {
  views: StubView[] = [];
  models: AppModel[] = [];
  statuses: string[] = [];
  /** Every `setUnsaved` call, in order. */
  unsavedCalls: boolean[] = [];
  setUnsaved(unsaved: boolean): void {
    this.unsavedCalls.push(unsaved);
  }
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

afterEach(() => {
  app.stop();
  vi.useRealTimers();
});

const paths = () => app.tabs.map((t) => t.path);
const activePath = () => app.active?.path ?? null;

describe("startup and the empty window", () => {
  test("with nothing queued the window is empty and titled lookdown", async () => {
    await app.start();
    expect(app.tabs).toHaveLength(0);
    expect(host.title).toBe("lookdown");
    expect(ui.model).toEqual({ tabs: [], activeId: null, bar: null });
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
    expect(ui.model).toEqual({ tabs: [], activeId: null, bar: null });
    await app.openPaths(["/docs/b.md"]);
    expect(ui.views).toHaveLength(2);
    expect(ui.view.state.doc.toString()).toBe("bravo\n");
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
    expect(await host.requestClose()).toBe(false); // no answer scripted: Cancel
  });
});

describe("menu commands", () => {
  test("runs a menu command like the keyboard does", async () => {
    await app.start();
    await app.openPaths(["/docs/a.md"]);
    host.menu("close");
    await app.idle();
    await Promise.resolve();
    expect(app.tabs).toHaveLength(0);
  });

  test("ignores unknown menu commands", async () => {
    await app.start();
    await app.openPaths(["/docs/a.md"]);
    host.menu("explode");
    host.menu(42);
    host.menu(undefined);
    await app.idle();
    expect(app.tabs).toHaveLength(1);
    expect(ui.statusLine).toBe("");
  });

  test("undo and redo act on the shown tab's editor", async () => {
    await app.openPaths(["/docs/a.md", "/docs/b.md"]);
    app.select(app.tabs[0].id);
    ui.view.dispatch({ changes: { from: 0, insert: "X" } });
    await app.run("undo");
    expect(ui.view.state.doc.toString()).toBe("alpha\n");
    expect(app.tabs[0].doc.isDirty()).toBe(false);
    await app.run("redo");
    expect(ui.view.state.doc.toString()).toBe("Xalpha\n");
    expect(app.tabs[0].doc.isDirty()).toBe(true);
  });

  test("menu commands without a tab do nothing", async () => {
    await app.start();
    for (const c of ["save", "close", "undo", "redo", "next", "previous"] as const) await app.run(c);
    expect(ui.statusLine).toBe("");
    expect(host.writes).toHaveLength(0);
    expect(app.tabs).toHaveLength(0);
  });

  test("isCommand accepts exactly the commands", () => {
    expect(["open", "close", "next", "previous", "save", "undo", "redo"].every(isCommand)).toBe(true);
    expect(isCommand("quit")).toBe(false);
    expect(isCommand(undefined)).toBe(false);
    expect(isCommand(1)).toBe(false);
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

  test("Mod-s saves", () => {
    expect(keyCommand(key("s", { ctrlKey: true }), false)).toBe("save");
    expect(keyCommand(key("S", { ctrlKey: true }), false)).toBe("save");
    expect(keyCommand(key("s", { metaKey: true }), true)).toBe("save");
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
    expect(keyCommand(key("s", { ctrlKey: true, shiftKey: true }), false)).toBeNull();
    expect(keyCommand(key("s", { metaKey: true }), false)).toBeNull();
    expect(keyCommand(key("o", { ctrlKey: true, shiftKey: true }), false)).toBeNull();
    expect(keyCommand(key("o", { ctrlKey: true, altKey: true }), false)).toBeNull();
    expect(keyCommand(key("Tab"), false)).toBeNull();
    expect(keyCommand(key("PageDown"), false)).toBeNull();
  });
});

const edit = (text = "X") => ui.view.dispatch({ changes: { from: 0, insert: text } });
const markers = () => ui.model.tabs.map((t) => t.marker);

describe("close prompts", () => {
  test("closing a dirty tab asks; Cancel keeps it", async () => {
    await app.openPaths(["/docs/a.md"]);
    edit();
    host.answers = [2];
    await app.run("close");
    expect(host.asked).toEqual([{ message: "Save changes to a.md?", buttons: ["Save", "Don't save", "Cancel"] }]);
    expect(paths()).toEqual(["/docs/a.md"]);
    expect(host.writes).toHaveLength(0);
  });

  test("Don't save closes without writing", async () => {
    await app.openPaths(["/docs/a.md", "/docs/b.md"]);
    edit();
    host.answers = [1];
    await app.run("close");
    expect(paths()).toEqual(["/docs/a.md"]);
    expect(host.writes).toHaveLength(0);
    expect(host.text("/docs/b.md")).toBe("bravo\n");
  });

  test("Save writes, then closes", async () => {
    await app.openPaths(["/docs/a.md"]);
    edit();
    host.answers = [0];
    await app.run("close");
    expect(app.tabs).toHaveLength(0);
    expect(host.text("/docs/a.md")).toBe("Xalpha\n");
  });

  test("a failed Save keeps the tab open, active, with the error", async () => {
    await app.openPaths(["/docs/a.md", "/docs/b.md"]);
    app.select(app.tabs[0].id);
    edit();
    app.select(app.tabs[1].id);
    host.writeErrors.set("/docs/a.md", "disk full");
    host.answers = [0];
    await app.closeTab(app.tabs[0].id);
    expect(paths()).toEqual(["/docs/a.md", "/docs/b.md"]);
    expect(activePath()).toBe("/docs/a.md");
    expect(ui.statusLine).toContain("disk full");
  });

  test("a clean tab closes without asking", async () => {
    await app.openPaths(["/docs/a.md"]);
    await app.run("close");
    expect(host.asked).toHaveLength(0);
    expect(app.tabs).toHaveLength(0);
  });
});

describe("window close prompt", () => {
  test("lists every unsaved file, one per line", async () => {
    await app.start();
    await app.openPaths(["/docs/a.md", "/docs/b.md", "/docs/c.md"]);
    app.select(app.tabs[0].id);
    edit();
    app.select(app.tabs[2].id);
    edit();
    host.answers = [2];
    expect(await host.requestClose()).toBe(false);
    expect(host.asked).toEqual([
      { message: "Save changes to these files?\na.md\nc.md", buttons: ["Save all", "Discard all", "Cancel"] },
    ]);
  });

  test("Discard all closes without writing; Save all writes every file", async () => {
    await app.start();
    await app.openPaths(["/docs/a.md", "/docs/b.md"]);
    edit();
    host.answers = [1];
    expect(await host.requestClose()).toBe(true);
    expect(host.writes).toHaveLength(0);
    app.select(app.tabs[0].id);
    edit("Y");
    host.answers = [0];
    expect(await host.requestClose()).toBe(true);
    expect(host.text("/docs/a.md")).toBe("Yalpha\n");
    expect(host.text("/docs/b.md")).toBe("Xbravo\n");
  });

  test("a failing save keeps the window open and activates that tab", async () => {
    await app.start();
    await app.openPaths(["/docs/a.md", "/docs/b.md"]);
    app.select(app.tabs[0].id);
    edit();
    app.select(app.tabs[1].id);
    edit();
    host.writeErrors.set("/docs/a.md", "locked");
    host.answers = [0];
    expect(await host.requestClose()).toBe(false);
    expect(activePath()).toBe("/docs/a.md");
    expect(ui.statusLine).toContain("locked");
  });

  test("a throwing prompt keeps the window open", async () => {
    await app.start();
    await app.openPaths(["/docs/a.md"]);
    edit();
    host.ask = async () => {
      throw new Error("dialog failed");
    };
    expect(await host.requestClose()).toBe(false);
  });

  test("Save all asks before overwriting a file changed on disk; Cancel there keeps the window open", async () => {
    await app.start();
    await app.openPaths(["/docs/a.md"]);
    edit();
    host.setFile("/docs/a.md", "theirs\n");
    host.answers = [0, 1];
    expect(await host.requestClose()).toBe(false);
    expect(host.asked[1]).toEqual({ message: "a.md changed on disk. Overwrite it?", buttons: ["Overwrite", "Cancel"] });
    expect(host.text("/docs/a.md")).toBe("theirs\n");
  });
});

describe("saving", () => {
  test("Mod-s is an app command; with no tab it does nothing", async () => {
    await app.run("save");
    expect(host.writes).toHaveLength(0);
    await app.openPaths(["/docs/a.md"]);
    edit();
    await app.run("save");
    expect(host.text("/docs/a.md")).toBe("Xalpha\n");
  });

  test("a file changed after the last poll asks before writing; Cancel writes nothing", async () => {
    await app.openPaths(["/docs/a.md"]);
    edit();
    host.setFile("/docs/a.md", "theirs\n");
    host.answers = [1];
    await app.run("save");
    expect(host.asked).toEqual([{ message: "a.md changed on disk. Overwrite it?", buttons: ["Overwrite", "Cancel"] }]);
    expect(host.writes).toHaveLength(0);
    expect(app.active!.doc.isDirty()).toBe(true);
  });

  test("Overwrite writes and records the new stamp", async () => {
    await app.openPaths(["/docs/a.md"]);
    edit();
    host.setFile("/docs/a.md", "theirs\n");
    host.answers = [0];
    await app.run("save");
    expect(host.text("/docs/a.md")).toBe("Xalpha\n");
    expect(app.active!.stamp).toEqual(host.stamps.get("/docs/a.md"));
  });

  test("lookdown's own save does not show the bar on the next poll", async () => {
    await app.openPaths(["/docs/a.md"]);
    edit();
    await app.run("save");
    edit("Y");
    await app.checkDisk();
    expect(ui.model.bar).toBeNull();
    expect(ui.view.state.doc.toString()).toBe("YXalpha\n");
    expect(host.asked).toHaveLength(0);
  });

  test("a poll racing a save skips the tab", async () => {
    await app.openPaths(["/docs/a.md"]);
    edit();
    const saving = app.run("save");
    await app.checkDisk();
    await saving;
    await app.checkDisk();
    expect(ui.model.bar).toBeNull();
    expect(app.active!.doc.isDirty()).toBe(false);
  });

  test("saving a deleted file writes it back without asking", async () => {
    await app.openPaths(["/docs/a.md"]);
    host.deleteFile("/docs/a.md");
    await app.checkDisk();
    await app.run("save");
    expect(host.asked).toHaveLength(0);
    expect(host.text("/docs/a.md")).toBe("alpha\n");
    expect(app.active!.doc.isDirty()).toBe(false);
    expect(ui.model.bar).toBeNull();
  });
});

describe("changes on disk", () => {
  test("a clean inactive tab reloads on the next poll and shows the new text when activated", async () => {
    await app.openPaths(["/docs/a.md", "/docs/b.md"]);
    const a = app.tabs[0];
    host.setFile("/docs/a.md", "alpha two\n");
    await app.checkDisk();
    expect(markers()).toEqual(["", ""]);
    app.select(a.id);
    expect(ui.view.state.doc.toString()).toBe("alpha two\n");
    expect(a.doc.isDirty()).toBe(false);
    expect(a.stamp).toEqual(host.stamps.get("/docs/a.md"));
    let state = ui.view.state;
    undo({ state, dispatch: (tr) => (state = tr.state) });
    expect(state.doc.toString()).toBe("alpha two\n");
  });

  test("a clean active tab reloads in the view and keeps the cursor", async () => {
    await app.openPaths(["/docs/a.md"]);
    ui.view.dispatch({ selection: { anchor: 5 } });
    const view = ui.view;
    host.setFile("/docs/a.md", "alpha!\n");
    await app.checkDisk();
    expect(view.state.doc.toString()).toBe("alpha!\n");
    expect(view.state.selection.main.head).toBe(5);
    expect(app.active!.doc.isDirty()).toBe(false);
    expect(host.title).toBe("a.md — lookdown");
    expect(ui.views).toHaveLength(1);
  });

  test("window focus forgets failed images in every tab", async () => {
    await app.openPaths(["/docs/a.md", "/docs/b.md"]);
    const spies = app.tabs.map((t) => vi.spyOn(t.state.facet(previewConfig).images!, "forgetFailures"));
    await app.start();
    host.focus();
    app.stop();
    spies.forEach((s) => expect(s).toHaveBeenCalled());
  });

  test("window focus with no failed images dispatches nothing", async () => {
    await app.openPaths(["/docs/a.md", "/docs/b.md"]);
    await app.start();
    const before = ui.view.state;
    const hidden = app.tabs[0].state;
    host.focus();
    app.stop();
    expect(ui.view.state).toBe(before);
    expect(app.tabs[0].state).toBe(hidden);
  });

  test("a silent reload of the active tab forgets failed images", async () => {
    await app.openPaths(["/docs/a.md"]);
    const spy = vi.spyOn(ui.view.state.facet(previewConfig).images!, "forgetFailures");
    host.setFile("/docs/a.md", "alpha!\n");
    await app.checkDisk();
    expect(spy).toHaveBeenCalled();
  });

  test("a dirty active tab shows the changed bar and is not reloaded", async () => {
    await app.openPaths(["/docs/a.md"]);
    edit();
    host.setFile("/docs/a.md", "theirs\n");
    await app.checkDisk();
    expect(ui.view.state.doc.toString()).toBe("Xalpha\n");
    expect(ui.model.bar).toEqual({
      message: "a.md changed on disk.",
      error: "",
      actions: [
        { label: "Reload (discard your changes)", action: "reload" },
        { label: "Keep yours", action: "keep-yours" },
      ],
    });
  });

  test("a dirty inactive tab gets the ! marker; the bar shows when it becomes active", async () => {
    await app.openPaths(["/docs/a.md", "/docs/b.md"]);
    app.select(app.tabs[0].id);
    edit();
    app.select(app.tabs[1].id);
    host.setFile("/docs/a.md", "theirs\n");
    await app.checkDisk();
    expect(markers()).toEqual(["!", ""]);
    expect(ui.model.bar).toBeNull();
    app.select(app.tabs[0].id);
    expect(ui.model.bar?.message).toBe("a.md changed on disk.");
    expect(markers()).toEqual(["•", ""]);
    expect(ui.view.state.doc.toString()).toBe("Xalpha\n");
  });

  test("Keep yours hides the bar until the file changes again, and the next save overwrites without asking", async () => {
    await app.openPaths(["/docs/a.md"]);
    edit();
    host.setFile("/docs/a.md", "theirs\n");
    await app.checkDisk();
    await app.barAction("keep-yours");
    expect(ui.model.bar).toBeNull();
    await app.checkDisk();
    expect(ui.model.bar).toBeNull();
    host.setFile("/docs/a.md", "theirs again\n");
    await app.checkDisk();
    expect(ui.model.bar?.message).toBe("a.md changed on disk.");
    await app.barAction("keep-yours");
    await app.run("save");
    expect(host.asked).toHaveLength(0);
    expect(host.text("/docs/a.md")).toBe("Xalpha\n");
    expect(app.active!.dismissed).toBeNull();
  });

  test("Reload (discard your changes) loads the disk text in a fresh state", async () => {
    await app.openPaths(["/docs/a.md"]);
    edit();
    host.setFile("/docs/a.md", "theirs\n");
    await app.checkDisk();
    await app.barAction("reload");
    expect(ui.model.bar).toBeNull();
    expect(ui.view.state.doc.toString()).toBe("theirs\n");
    expect(app.active!.doc.isDirty()).toBe(false);
    let state = ui.view.state;
    undo({ state, dispatch: (tr) => (state = tr.state) });
    expect(state.doc.toString()).toBe("theirs\n");
    // Edits still reach the document after the state was replaced.
    edit("Z");
    expect(app.active!.doc.isDirty()).toBe(true);
    await app.run("save");
    expect(host.text("/docs/a.md")).toBe("Ztheirs\n");
  });

  test("a deleted file marks the tab dirty and shows the deleted bar once", async () => {
    await app.openPaths(["/docs/a.md"]);
    host.deleteFile("/docs/a.md");
    await app.checkDisk();
    const tab = app.active!;
    expect(tab.doc.isDirty()).toBe(true);
    expect(tab.stamp).toBeNull();
    expect(host.title).toBe("• a.md — lookdown");
    expect(ui.model.bar).toEqual({
      message: "a.md was deleted or moved.",
      error: "",
      actions: [
        { label: "Close tab", action: "close" },
        { label: "Keep", action: "keep" },
      ],
    });
    await app.barAction("keep");
    expect(ui.model.bar).toBeNull();
    await app.checkDisk();
    expect(ui.model.bar).toBeNull();
    expect(tab.doc.isDirty()).toBe(true);
    expect(ui.view.state.doc.toString()).toBe("alpha\n");
  });

  test("a deleted file that comes back is treated as a change", async () => {
    await app.openPaths(["/docs/a.md"]);
    host.deleteFile("/docs/a.md");
    await app.checkDisk();
    await app.barAction("keep");
    host.setFile("/docs/a.md", "back\n");
    await app.checkDisk();
    expect(ui.model.bar?.message).toBe("a.md changed on disk.");
  });

  test("Close tab on the deleted bar prompts like any unsaved tab", async () => {
    await app.openPaths(["/docs/a.md"]);
    host.deleteFile("/docs/a.md");
    await app.checkDisk();
    host.answers = [1];
    await app.barAction("close");
    expect(app.tabs).toHaveLength(0);
    expect(host.asked).toEqual([{ message: "Save changes to a.md?", buttons: ["Save", "Don't save", "Cancel"] }]);
  });

  test("a file that becomes undecodable shows the bar with the error instead of reloading", async () => {
    await app.openPaths(["/docs/a.md"]);
    host.setFile("/docs/a.md", new Uint8Array([0x61, 0xff]));
    await app.checkDisk();
    expect(ui.view.state.doc.toString()).toBe("alpha\n");
    expect(ui.model.bar?.message).toBe("a.md changed on disk.");
    expect(ui.model.bar?.error).not.toBe("");
  });

  test("one check at a time: a check while one runs is skipped", async () => {
    await app.openPaths(["/docs/a.md"]);
    const spy = vi.spyOn(host, "fileStamp");
    await Promise.all([app.checkDisk(), app.checkDisk()]);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  test("polls every 2 seconds and on focus, and stops with stop()", async () => {
    vi.useFakeTimers();
    await app.start();
    const spy = vi.spyOn(app, "checkDisk");
    await vi.advanceTimersByTimeAsync(2000);
    expect(spy).toHaveBeenCalledTimes(1);
    host.focus();
    expect(spy).toHaveBeenCalledTimes(2);
    app.stop();
    await vi.advanceTimersByTimeAsync(4000);
    host.focus();
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe("startup errors", () => {
  test("a failing startup queue shows the error in the status line", async () => {
    host.takePaths = async () => {
      throw new Error("no queue");
    };
    await app.start();
    expect(ui.statusLine).toBe("Could not read startup files: no queue");
  });
});

describe("fix round 1: close and save around disk changes", () => {
  async function deletedWithEdits() {
    await app.openPaths(["/docs/a.md"]);
    edit();
    host.deleteFile("/docs/a.md");
    await app.checkDisk();
  }

  test("Close tab on the deleted bar of an edited tab asks; Cancel keeps it", async () => {
    await deletedWithEdits();
    host.answers = [2];
    await app.barAction("close");
    expect(host.asked).toEqual([{ message: "Save changes to a.md?", buttons: ["Save", "Don't save", "Cancel"] }]);
    expect(paths()).toEqual(["/docs/a.md"]);
  });

  test("Close tab, Don't save: closes without writing", async () => {
    await deletedWithEdits();
    host.answers = [1];
    await app.barAction("close");
    expect(app.tabs).toHaveLength(0);
    expect(host.writes).toHaveLength(0);
  });

  test("Close tab, Save: writes the file back, then closes", async () => {
    await deletedWithEdits();
    host.answers = [0];
    await app.barAction("close");
    expect(app.tabs).toHaveLength(0);
    expect(host.text("/docs/a.md")).toBe("Xalpha\n");
  });

  test("a stamp read that fails before a save asks before overwriting", async () => {
    await app.openPaths(["/docs/a.md"]);
    edit();
    host.fileStamp = async () => {
      throw new Error("access denied");
    };
    host.answers = [1];
    await app.run("save");
    expect(host.asked).toEqual([{ message: "a.md changed on disk. Overwrite it?", buttons: ["Overwrite", "Cancel"] }]);
    expect(host.writes).toHaveLength(0);
  });

  test("a poll whose read spans a whole save does not reload stale bytes", async () => {
    await app.openPaths(["/docs/a.md"]);
    host.setFile("/docs/a.md", "theirs\n");
    const stale = host.files.get("/docs/a.md")!.slice();
    let release: (() => void) | undefined;
    let reached!: () => void;
    const atRead = new Promise<void>((r) => (reached = r));
    const realRead = host.readFile.bind(host);
    host.readFile = (path: string) => {
      if (path !== "/docs/a.md" || release) return realRead(path);
      return new Promise<Uint8Array>((resolve) => {
        release = () => resolve(stale);
        reached();
      });
    };
    const poll = app.checkDisk();
    await atRead;
    edit();
    host.answers = [0];
    expect(await app.run("save").then(() => true)).toBe(true);
    expect(host.text("/docs/a.md")).toBe("Xalpha\n");
    release!();
    await poll;
    expect(ui.view.state.doc.toString()).toBe("Xalpha\n");
    expect(app.active!.doc.isDirty()).toBe(false);
    expect(app.active!.stamp).toEqual(host.stamps.get("/docs/a.md"));
  });
});

describe("final fixes: window close around running saves", () => {
  /** Holds every write until `release()`; returns the release function. */
  function holdWrites(): () => void {
    const held: (() => void)[] = [];
    const realWrite = host.writeFile.bind(host);
    host.writeFile = (path, bytes) =>
      new Promise<void>((resolve, reject) => held.push(() => void realWrite(path, bytes).then(resolve, reject)));
    return () => held.splice(0).forEach((go) => go());
  }
  const settle = () => new Promise((r) => setTimeout(r, 0));

  test("a close requested during a running save waits for it, then lists only still-unsaved tabs", async () => {
    await app.start();
    await app.openPaths(["/docs/a.md", "/docs/b.md"]);
    app.select(app.tabs[0].id);
    edit();
    const release = holdWrites();
    const saving = app.run("save");
    app.select(app.tabs[1].id);
    edit();
    host.answers = [2];
    const closing = host.requestClose();
    await settle();
    expect(host.asked).toHaveLength(0);
    release();
    await saving;
    expect(await closing).toBe(false);
    expect(host.text("/docs/a.md")).toBe("Xalpha\n");
    expect(host.asked).toEqual([
      { message: "Save changes to these files?\nb.md", buttons: ["Save all", "Discard all", "Cancel"] },
    ]);
  });

  test("a second close request while the first prompt is open returns false", async () => {
    await app.start();
    await app.openPaths(["/docs/a.md"]);
    edit();
    let answer!: (choice: 0 | 1 | 2) => void;
    host.ask = (message, buttons) => {
      host.asked.push({ message, buttons });
      return new Promise((resolve) => (answer = resolve));
    };
    const first = host.requestClose();
    await settle();
    expect(host.asked).toHaveLength(1);
    const second = host.requestClose();
    await settle();
    expect(host.asked).toHaveLength(1);
    expect(await second).toBe(false);
    answer(2);
    expect(await first).toBe(false);
  });
});

describe("final fixes: the table menu closes when the shown tab changes", () => {
  test("closing the active tab closes an open menu", async () => {
    await app.openPaths(["/docs/a.md", "/docs/b.md"]);
    vi.mocked(closeMenu).mockClear();
    await app.run("close");
    expect(activePath()).toBe("/docs/a.md");
    expect(closeMenu).toHaveBeenCalled();
  });

  test("opening a file closes an open menu", async () => {
    await app.openPaths(["/docs/a.md"]);
    vi.mocked(closeMenu).mockClear();
    await app.openPaths(["/docs/b.md"]);
    expect(closeMenu).toHaveBeenCalled();
  });

  test("switching tabs still closes it; selecting the shown tab does not", async () => {
    await app.openPaths(["/docs/a.md", "/docs/b.md"]);
    vi.mocked(closeMenu).mockClear();
    app.select(app.tabs[0].id);
    await app.run("next");
    await app.run("previous");
    expect(closeMenu).toHaveBeenCalledTimes(3);
    vi.mocked(closeMenu).mockClear();
    app.select(app.active!.id);
    expect(closeMenu).not.toHaveBeenCalled();
  });
});

describe("final fixes: reloading the page", () => {
  const key = (k: string, mods: Partial<Record<"ctrlKey" | "metaKey" | "shiftKey" | "altKey", boolean>> = {}) => ({
    key: k,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...mods,
  });

  test("F5, Ctrl+F5 and Shift+F5 reload on every platform", () => {
    for (const mac of [false, true]) {
      expect(isReloadKey(key("F5"), mac)).toBe(true);
      expect(isReloadKey(key("F5", { ctrlKey: true }), mac)).toBe(true);
      expect(isReloadKey(key("F5", { shiftKey: true }), mac)).toBe(true);
      expect(isReloadKey(key("BrowserRefresh"), mac)).toBe(true);
    }
  });

  test("Mod-r and Mod-Shift-r reload: Ctrl on Windows and Linux, Cmd on macOS", () => {
    expect(isReloadKey(key("r", { ctrlKey: true }), false)).toBe(true);
    expect(isReloadKey(key("R", { ctrlKey: true, shiftKey: true }), false)).toBe(true);
    expect(isReloadKey(key("r", { metaKey: true }), true)).toBe(true);
    expect(isReloadKey(key("R", { metaKey: true, shiftKey: true }), true)).toBe(true);
    expect(isReloadKey(key("r", { metaKey: true }), false)).toBe(false);
    expect(isReloadKey(key("r", { ctrlKey: true }), true)).toBe(false);
  });

  test("other keys are not reloads", () => {
    expect(isReloadKey(key("r"), false)).toBe(false);
    expect(isReloadKey(key("R", { shiftKey: true }), false)).toBe(false);
    expect(isReloadKey(key("r", { ctrlKey: true, altKey: true }), false)).toBe(false);
    expect(isReloadKey(key("F5", { altKey: true }), false)).toBe(false);
    expect(isReloadKey(key("s", { ctrlKey: true }), false)).toBe(false);
    expect(isReloadKey(key("F4"), false)).toBe(false);
  });

  test("the host hears when some tab is unsaved (macOS quit asks only then)", async () => {
    await app.openPaths(["/docs/a.md"]);
    expect(host.unsavedCalls).toEqual([]);
    edit();
    expect(host.unsavedCalls).toEqual([true]);
    await app.run("save");
    expect(host.unsavedCalls).toEqual([true, false]);
  });

  test("the unload guard is on only while a tab is unsaved", async () => {
    await app.openPaths(["/docs/a.md", "/docs/b.md"]);
    expect(ui.unsavedCalls).toEqual([]);
    edit();
    edit("Y");
    expect(ui.unsavedCalls).toEqual([true]);
    await app.run("save");
    expect(ui.unsavedCalls).toEqual([true, false]);
    edit();
    host.answers = [1];
    await app.run("close");
    expect(ui.unsavedCalls).toEqual([true, false, true, false]);
  });

  test("the unload guard is off once the window may close with unsaved tabs", async () => {
    await app.start();
    await app.openPaths(["/docs/a.md"]);
    edit();
    host.answers = [2];
    expect(await host.requestClose()).toBe(false);
    expect(ui.unsavedCalls).toEqual([true]);
    host.answers = [1];
    expect(await host.requestClose()).toBe(true);
    expect(ui.unsavedCalls).toEqual([true, false]);
    expect(app.active!.doc.isDirty()).toBe(true);
  });
});
