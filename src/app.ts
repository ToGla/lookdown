// The app shell: tabs over one editor view, opening files, saving, close
// prompts, watching files on disk, keys, the empty page.
// `App` is the controller (no DOM, unit-tested with a fake host and stub view);
// `startApp` connects it to the page.

import type { EditorState, StateEffect, TransactionSpec } from "@codemirror/state";

import { OpenDocument } from "./document";
import { createTabState, createView, reloadTransaction } from "./editor";
import type { Host } from "./host";
import { closeAll } from "./tabs/closing";
import { type Stamp, compareStamp, diskAction, needsOverwriteConfirm } from "./tabs/disk";
import { baseName } from "./tabs/paths";
import { Workspace } from "./tabs/workspace";
import { type BarAction, type BarModel, barModel, createDiskBar } from "./ui/diskbar";
import { createEmptyPage } from "./ui/empty";
import { type TabModel, createTabBar } from "./ui/tabbar";

/** How often open files are checked for changes on disk. */
export const POLL_MS = 2000;

/** A disk change or deletion the user has not answered yet. */
export interface PendingDisk {
  kind: "changed" | "deleted";
  /** The disk stamp seen when it was noticed (null: deleted). */
  stamp: Stamp | null;
  /** Why the changed file could not be reloaded; "" when none. */
  error: string;
}

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
  /** Shown as the bar while active, as `!` in the tab strip otherwise. */
  pending: PendingDisk | null;
  /** Disk stamp whose bytes failed to decode; not re-read until it changes. */
  unreadable: Stamp | null;
  /** Saves started and not yet settled; disk checks skip the tab meanwhile. */
  saving: number;
  /** Saves run one after another, each with its own overwrite check. */
  saveChain: Promise<unknown>;
}

/** The one editor view, as the controller sees it. */
export interface ViewPort {
  readonly state: EditorState;
  setState(state: EditorState): void;
  dispatch(spec: TransactionSpec): void;
  scrollSnapshot(): StateEffect<unknown>;
  restoreScroll(snapshot: StateEffect<unknown>): void;
  focus(): void;
  destroy(): void;
}

export interface AppModel {
  tabs: TabModel[];
  activeId: number | null;
  /** The disk bar for the active tab. */
  bar: BarModel | null;
}

/** What the controller needs from the page. */
export interface AppUi {
  createView(state: EditorState): ViewPort;
  render(model: AppModel): void;
  status(message: string): void;
}

/** Frontend commands; a later menu bar calls the same ones. */
export type Command = "open" | "close" | "next" | "previous" | "save";

export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/** Window-level keys: `Mod-o`, `Mod-w`, `Mod-s`, `Ctrl+(Shift+)Tab`, `Ctrl+PageDown/PageUp`. */
export function keyCommand(e: KeyLike, isMac: boolean): Command | null {
  if (e.altKey) return null;
  const mod = isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  if (mod && !e.shiftKey) {
    const key = e.key.toLowerCase();
    if (key === "o") return "open";
    if (key === "w") return "close";
    if (key === "s") return "save";
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

function sameStamp(a: Stamp | null, b: Stamp | null): boolean {
  return a !== null && b !== null && a.modifiedMs === b.modifiedMs && a.size === b.size;
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
  private timer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  /** A disk check is running; another one is skipped. */
  private checking = false;
  /** A tab-close prompt is open; another one is not stacked on top. */
  private prompting = false;

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

  /** Hook up the host's events, start watching files, then open the startup paths. */
  start(): Promise<void> {
    // Listen before the first drain, so paths queued in between are not missed.
    this.host.onPathsQueued(() => void this.drain());
    this.host.onFilesDropped((paths) => void this.openPaths(paths));
    this.host.onCloseRequested(() => this.confirmWindowClose());
    this.host.onFocus(() => {
      if (!this.stopped) void this.checkDisk();
    });
    this.timer = setInterval(() => void this.checkDisk(), POLL_MS);
    this.refresh();
    return this.drain();
  }

  /** Stop watching files (tests, teardown). */
  stop(): void {
    this.stopped = true;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
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
      case "save":
        await this.save();
        return;
    }
  }

  /** Close a tab; an unsaved one asks Save / Don't save / Cancel first. */
  async closeTab(id: number): Promise<void> {
    const tab = this.tabById(id);
    if (!tab) return;
    if (tab.doc.isDirty()) {
      if (this.prompting) return;
      this.prompting = true;
      let choice: 0 | 1 | 2;
      try {
        choice = await this.host.ask(`Save changes to ${this.workspace.label(tab)}?`, ["Save", "Don't save", "Cancel"]);
      } catch (error) {
        this.ui.status(`Could not ask about ${this.workspace.label(tab)}: ${errorText(error)}`);
        return;
      } finally {
        this.prompting = false;
      }
      if (choice === 2) return;
      if (choice === 0 && !(await this.save(tab))) {
        this.select(tab.id);
        return;
      }
    }
    this.workspace.remove(tab.id);
    this.sync();
  }

  /**
   * Save a tab (the active one by default); false when the save failed or the
   * user declined to overwrite a change on disk.
   */
  save(tab: Tab | null = this.workspace.active): Promise<boolean> {
    if (!tab) return Promise.resolve(false);
    // Counted at once, so a disk check starting now already skips the tab.
    tab.saving++;
    const run = tab.saveChain.then(() => this.saveNow(tab));
    tab.saveChain = run;
    void run.finally(() => tab.saving--);
    return run;
  }

  /** Answer one of the disk bar's buttons for the active tab. */
  async barAction(action: BarAction): Promise<void> {
    const tab = this.workspace.active;
    if (!tab?.pending) return;
    switch (action) {
      case "keep-yours":
        tab.dismissed = tab.pending.stamp;
        tab.pending = null;
        break;
      case "keep":
        // The document stays missing (unsaved); saving writes it back.
        tab.pending = null;
        break;
      case "close":
        this.workspace.remove(tab.id);
        return this.sync();
      case "reload":
        await this.reloadDiscarding(tab);
        break;
    }
    this.refresh();
  }

  /** Check every open file once; skipped while a check is still running. */
  async checkDisk(): Promise<void> {
    if (this.checking || this.stopped) return;
    this.checking = true;
    try {
      for (const tab of [...this.workspace.tabs]) {
        try {
          await this.checkTab(tab);
        } catch {
          // An unreadable stamp or file: try again on the next check.
        }
      }
    } finally {
      this.checking = false;
      this.refresh();
    }
  }

  private async saveNow(tab: Tab): Promise<boolean> {
    const name = () => this.workspace.label(tab);
    try {
      if (!tab.doc.isDirty()) return true;
      const now = await this.host.fileStamp(tab.path).catch(() => null);
      // A change the user accepted with Keep yours does not ask again.
      if (needsOverwriteConfirm(tab.dismissed ?? tab.stamp, now)) {
        const answer = await this.host.ask(`${name()} changed on disk. Overwrite it?`, ["Overwrite", "Cancel"]);
        if (answer !== 0) return false;
      }
      const result = await tab.doc.save((path, bytes) => this.host.writeFile(path, bytes));
      if (result === "saved") {
        tab.stamp = await this.host.fileStamp(tab.path).catch(() => tab.stamp);
        tab.dismissed = null;
        tab.pending = null;
        tab.unreadable = null;
      }
      this.ui.status("");
      return true;
    } catch (error) {
      this.ui.status(`Could not save ${name()}: ${errorText(error)}`);
      return false;
    } finally {
      this.refresh();
    }
  }

  private async checkTab(tab: Tab): Promise<void> {
    if (tab.saving > 0) return;
    const now = await this.host.fileStamp(tab.path);
    // A save started or the tab closed while the stamp was read.
    if (tab.saving > 0 || !this.isOpen(tab)) return;
    const action = diskAction(compareStamp(tab.stamp, now), tab.doc.isDirty(), tab.dismissed, now);
    switch (action) {
      case "none":
        return;
      case "show-deleted":
        tab.doc.markMissing();
        // Known as missing now, so this shows once; a file that comes back is "returned".
        tab.stamp = null;
        tab.dismissed = null;
        tab.pending = { kind: "deleted", stamp: null, error: "" };
        return;
      case "show-changed":
        if (tab.pending?.kind === "changed" && sameStamp(tab.pending.stamp, now)) return;
        tab.pending = { kind: "changed", stamp: now, error: "" };
        return;
      case "reload": {
        if (sameStamp(tab.unreadable, now)) return;
        const bytes = await this.host.readFile(tab.path);
        if (tab.saving > 0 || !this.isOpen(tab) || tab.doc.isDirty()) return;
        const result = tab.doc.reload(bytes);
        if ("busy" in result) return;
        if ("error" in result) {
          tab.unreadable = now;
          tab.pending = { kind: "changed", stamp: now, error: result.error };
          return;
        }
        tab.stamp = now;
        tab.dismissed = null;
        tab.pending = null;
        tab.unreadable = null;
        // Silent reload: cursor and history map through, not an undo step.
        if (tab === this.shown && this.view) this.view.dispatch(reloadTransaction(this.view.state, result.text));
        else tab.state = tab.state.update(reloadTransaction(tab.state, result.text)).state;
        return;
      }
    }
  }

  /** "Reload (discard your changes)": the disk text in a fresh state, no undo back. */
  private async reloadDiscarding(tab: Tab): Promise<void> {
    const name = this.workspace.label(tab);
    let now: Stamp | null;
    let bytes: Uint8Array;
    try {
      now = await this.host.fileStamp(tab.path);
      bytes = await this.host.readFile(tab.path);
    } catch (error) {
      this.ui.status(`Could not reload ${name}: ${errorText(error)}`);
      return;
    }
    if (!this.isOpen(tab)) return;
    const result = tab.doc.reload(bytes);
    if ("busy" in result) {
      this.ui.status(`Could not reload ${name}: a save is running.`);
      return;
    }
    if ("error" in result) {
      tab.unreadable = now;
      tab.pending = { kind: "changed", stamp: now, error: result.error };
      return;
    }
    tab.stamp = now;
    tab.dismissed = null;
    tab.pending = null;
    tab.unreadable = null;
    tab.state = this.tabState(tab, result.text);
    if (tab === this.shown && this.view) this.view.setState(tab.state);
    this.ui.status("");
  }

  /** The window's close button: one prompt listing every unsaved tab. */
  private async confirmWindowClose(): Promise<boolean> {
    try {
      const result = await closeAll(
        this.workspace.tabs.map((t) => ({ id: t.id, dirty: t.doc.isDirty() })),
        async (ids) => {
          const names = ids.map((id) => {
            const tab = this.tabById(id);
            return tab ? this.workspace.label(tab) : "";
          });
          const answer = await this.host.ask(`Save changes to these files?\n${names.join("\n")}`, [
            "Save all",
            "Discard all",
            "Cancel",
          ]);
          return answer === 0 ? "save" : answer === 1 ? "discard" : "cancel";
        },
        (id) => {
          const tab = this.tabById(id);
          return tab ? this.save(tab) : Promise.resolve(true);
        },
      );
      if (!result.close && result.activate !== null) this.select(result.activate);
      return result.close;
    } catch {
      return false;
    }
  }

  private tabById(id: number): Tab | null {
    return this.workspace.tabs.find((t) => t.id === id) ?? null;
  }

  private isOpen(tab: Tab): boolean {
    return this.workspace.tabs.includes(tab);
  }

  private drain(): Promise<void> {
    return this.enqueue(async () => this.openNow(await this.host.takePaths())).catch((error) =>
      this.ui.status(`Could not read startup files: ${errorText(error)}`),
    );
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
    const tab = {
      id: this.nextId++,
      path,
      doc,
      stamp,
      dismissed: null,
      pending: null,
      unreadable: null,
      saving: 0,
      saveChain: Promise.resolve(),
    } as unknown as Tab;
    tab.state = this.tabState(tab, doc.initialText);
    return tab;
  }

  /**
   * A fresh editor state for a tab. It carries callbacks bound to that tab, so
   * edits always reach the right document whichever tab the view shows.
   * Mod-s is a window-level command (`keyCommand`), not bound here.
   */
  private tabState(tab: Tab, text: string): EditorState {
    return createTabState(text, {
      onUpdate: (update) => {
        for (const tr of update.transactions) tab.doc.track(tr);
        if (update.docChanged) this.refresh();
      },
      openUrl: (url) =>
        void this.host.openUrl(url).catch((error) => this.ui.status(`Could not open ${url}: ${errorText(error)}`)),
      docPath: tab.path,
      imageIO: { size: (p) => this.host.fileSize(p), read: (p) => this.host.readFile(p) },
    });
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
    const marker = (t: Tab): TabModel["marker"] => (t !== active && t.pending ? "!" : t.doc.isDirty() ? "•" : "");
    const pending = active?.pending;
    const model: AppModel = {
      tabs: ws.tabs.map((t) => ({ id: t.id, label: ws.label(t), path: t.path, marker: marker(t) })),
      activeId: active?.id ?? null,
      bar: active && pending ? barModel(pending.kind, ws.label(active), pending.error) : null,
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
    dispatch: (spec) => view.dispatch(spec),
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
  const diskBar = createDiskBar(root.app, (action) => void app.barAction(action));
  const ui: AppUi = {
    createView: (state) => editorPort(root.app, state),
    render(model) {
      tabBar.render(model.tabs, model.activeId);
      diskBar.render(model.bar);
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
      if (e.repeat && command !== "next" && command !== "previous") return;
      void app.run(command);
    },
    true,
  );

  ui.status("");
  void app.start();
}
