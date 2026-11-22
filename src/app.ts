// The app shell: tabs over one editor view, opening files, keys, the empty page.
// `App` is the controller (no DOM, unit-tested with a fake host and stub view);
// `startApp` connects it to the page.

import type { EditorState, StateEffect } from "@codemirror/state";

import { OpenDocument } from "./document";
import { createTabState, createView } from "./editor";
import type { Host } from "./host";
import type { Stamp } from "./tabs/disk";
import { baseName } from "./tabs/paths";
import { Workspace } from "./tabs/workspace";
import { createEmptyPage } from "./ui/empty";
import { type TabModel, createTabBar } from "./ui/tabbar";

export interface Tab {
  id: number;
  path: string;
  doc: OpenDocument;
  /** The tab's editor state; while the tab is shown, the view's state is newer. */
  state: EditorState;
  /** Scroll position saved when the tab was hidden. */
  scroll?: StateEffect<unknown>;
  /** Modified time and size lookdown last read or wrote (null: missing). */
  stamp: Stamp | null;
  /** Disk stamp the user chose to keep their version over. */
  dismissed: Stamp | null;
}

/** The one editor view, as the controller sees it. */
export interface ViewPort {
  readonly state: EditorState;
  setState(state: EditorState): void;
  scrollSnapshot(): StateEffect<unknown>;
  restoreScroll(snapshot: StateEffect<unknown>): void;
  focus(): void;
  destroy(): void;
}

export interface AppModel {
  tabs: TabModel[];
  activeId: number | null;
}

/** What the controller needs from the page. */
export interface AppUi {
  createView(state: EditorState): ViewPort;
  render(model: AppModel): void;
  status(message: string): void;
}

/** Frontend commands; a later menu bar calls the same ones. */
export type Command = "open" | "close" | "next" | "previous";

export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/** Window-level keys: `Mod-o`, `Mod-w`, `Ctrl+(Shift+)Tab`, `Ctrl+PageDown/PageUp`. */
export function keyCommand(e: KeyLike, isMac: boolean): Command | null {
  if (e.altKey) return null;
  const mod = isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  if (mod && !e.shiftKey) {
    const key = e.key.toLowerCase();
    if (key === "o") return "open";
    if (key === "w") return "close";
  }
  if (e.ctrlKey && !e.metaKey) {
    if (e.key === "Tab") return e.shiftKey ? "previous" : "next";
    if (!e.shiftKey && e.key === "PageDown") return "next";
    if (!e.shiftKey && e.key === "PageUp") return "previous";
  }
  return null;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class App {
  private readonly workspace: Workspace<Tab>;
  private view: ViewPort | null = null;
  /** The tab whose state is in the view. */
  private shown: Tab | null = null;
  private nextId = 1;
  /** Opens run one after another, so their order and "already open" checks hold. */
  private opening: Promise<void> = Promise.resolve();
  private lastTitle: string | null = null;
  private lastModel: string | null = null;

  constructor(
    private readonly host: Host,
    private readonly ui: AppUi,
  ) {
    this.workspace = new Workspace<Tab>(host.caseInsensitivePaths);
  }

  get tabs(): readonly Tab[] {
    return this.workspace.tabs;
  }

  get active(): Tab | null {
    return this.workspace.active;
  }

  /** Hook up the host's events, then open the startup paths. */
  start(): Promise<void> {
    // Listen before the first drain, so paths queued in between are not missed.
    this.host.onPathsQueued(() => void this.drain());
    this.host.onFilesDropped((paths) => void this.openPaths(paths));
    this.host.onCloseRequested(async () => !this.workspace.tabs.some((t) => t.doc.isDirty()));
    this.refresh();
    return this.drain();
  }

  /** Resolves once every open started so far has finished. */
  idle(): Promise<void> {
    return this.opening;
  }

  /** The one open path: command line, second instance, drop and the open dialog. */
  openPaths(paths: readonly string[]): Promise<void> {
    return this.enqueue(() => this.openNow(paths));
  }

  select(id: number): void {
    this.workspace.activate(id);
    this.sync();
  }

  async run(command: Command): Promise<void> {
    switch (command) {
      case "open": {
        let paths: string[];
        try {
          paths = await this.host.pickFiles();
        } catch (error) {
          this.ui.status(`Could not show the open dialog: ${errorText(error)}`);
          return;
        }
        return this.openPaths(paths);
      }
      case "close": {
        const active = this.workspace.active;
        if (active) await this.closeTab(active.id);
        return;
      }
      case "next":
        this.workspace.next();
        return this.sync();
      case "previous":
        this.workspace.previous();
        return this.sync();
    }
  }

  async closeTab(id: number): Promise<void> {
    const tab = this.workspace.tabs.find((t) => t.id === id);
    if (!tab) return;
    // Unsaved tabs get a prompt in a later step; until then they stay open.
    if (tab.doc.isDirty()) return;
    this.workspace.remove(id);
    this.sync();
  }

  /** Save a tab (the active one by default); false when the save failed. */
  async save(tab: Tab | null = this.workspace.active): Promise<boolean> {
    if (!tab) return false;
    try {
      const result = await tab.doc.save((path, bytes) => this.host.writeFile(path, bytes));
      if (result === "saved") tab.stamp = await this.host.fileStamp(tab.path).catch(() => tab.stamp);
      this.ui.status("");
      return true;
    } catch (error) {
      this.ui.status(`Could not save ${baseName(tab.path)}: ${errorText(error)}`);
      return false;
    } finally {
      this.refresh();
    }
  }

  private drain(): Promise<void> {
    return this.enqueue(async () => this.openNow(await this.host.takePaths()));
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    const run = this.opening.then(task);
    this.opening = run.catch(() => undefined);
    return run;
  }

  private async openNow(paths: readonly string[]): Promise<void> {
    if (paths.length === 0) return;
    const errors: string[] = [];
    for (const path of paths) {
      const open = this.workspace.find(path);
      if (open) {
        this.workspace.activate(open.id);
        continue;
      }
      let bytes: Uint8Array;
      try {
        bytes = await this.host.readFile(path);
      } catch (error) {
        errors.push(`Could not open ${path}: ${errorText(error)}`);
        continue;
      }
      const doc = OpenDocument.fromBytes(path, bytes);
      if ("error" in doc) {
        errors.push(`${baseName(path)}: ${doc.error}`);
        continue;
      }
      const stamp = await this.host.fileStamp(path).catch(() => null);
      this.workspace.add(this.newTab(path, doc, stamp));
    }
    this.ui.status(errors.join(" "));
    this.sync();
  }

  private newTab(path: string, doc: OpenDocument, stamp: Stamp | null): Tab {
    const tab = { id: this.nextId++, path, doc, stamp, dismissed: null } as Tab;
    // Each tab's state carries callbacks bound to that tab, so edits always
    // reach the right document whichever tab the view shows.
    tab.state = createTabState(doc.initialText, {
      onUpdate: (update) => {
        for (const tr of update.transactions) tab.doc.track(tr);
        if (update.docChanged) this.refresh();
      },
      onSave: () => void this.save(tab),
      openUrl: (url) =>
        void this.host.openUrl(url).catch((error) => this.ui.status(`Could not open ${url}: ${errorText(error)}`)),
      docPath: path,
      imageIO: { size: (p) => this.host.fileSize(p), read: (p) => this.host.readFile(p) },
    });
    return tab;
  }

  /** Show the workspace's active tab in the view, then refresh title and tab bar. */
  private sync(): void {
    const next = this.workspace.active;
    if (next !== this.shown) {
      if (this.shown && this.view) {
        this.shown.state = this.view.state;
        this.shown.scroll = this.view.scrollSnapshot();
      }
      if (!next) {
        this.view?.destroy();
        this.view = null;
      } else if (!this.view) {
        this.view = this.ui.createView(next.state);
      } else {
        this.view.setState(next.state);
      }
      if (next?.scroll) this.view?.restoreScroll(next.scroll);
      this.shown = next;
      this.view?.focus();
    }
    this.refresh();
  }

  private refresh(): void {
    const ws = this.workspace;
    const active = ws.active;
    const title = active ? `${active.doc.isDirty() ? "• " : ""}${ws.label(active)} — lookdown` : "lookdown";
    if (title !== this.lastTitle) {
      this.lastTitle = title;
      this.host.setTitle(title);
    }
    const model: AppModel = {
      tabs: ws.tabs.map((t) => ({ id: t.id, label: ws.label(t), path: t.path, marker: t.doc.isDirty() ? "•" : "" })),
      activeId: active?.id ?? null,
    };
    const key = JSON.stringify(model);
    if (key !== this.lastModel) {
      this.lastModel = key;
      this.ui.render(model);
    }
  }
}

function editorPort(parent: HTMLElement, state: EditorState): ViewPort {
  const view = createView(parent, state);
  return {
    get state() {
      return view.state;
    },
    setState: (s) => view.setState(s),
    scrollSnapshot: () => view.scrollSnapshot(),
    restoreScroll: (snapshot) => view.dispatch({ effects: snapshot }),
    focus: () => view.focus(),
    destroy: () => view.destroy(),
  };
}

export function startApp(root: { tabs: HTMLElement; app: HTMLElement; status: HTMLElement }, host: Host): void {
  const empty = createEmptyPage(root.app, host.isMac);
  const tabBar = createTabBar(root.tabs, {
    select: (id) => app.select(id),
    close: (id) => void app.closeTab(id),
  });
  const ui: AppUi = {
    createView: (state) => editorPort(root.app, state),
    render(model) {
      tabBar.render(model.tabs, model.activeId);
      empty.show(model.tabs.length === 0);
    },
    status(message) {
      root.status.textContent = message;
      root.status.hidden = message === "";
    },
  };
  const app = new App(host, ui);

  // Capture phase: works in the empty window and before CodeMirror's keymap.
  window.addEventListener(
    "keydown",
    (e) => {
      const command = keyCommand(e, host.isMac);
      if (!command) return;
      e.preventDefault();
      e.stopPropagation();
      // Holding Mod-w must not close tab after tab; holding Ctrl+Tab may cycle.
      if (e.repeat && (command === "open" || command === "close")) return;
      void app.run(command);
    },
    true,
  );

  ui.status("");
  void app.start();
}
