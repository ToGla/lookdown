// An in-memory Host for unit tests (node, no DOM) and the dev harness:
// fake files with settable stamps, scripted dialogs, and callable OS events.

import type { Host } from "./host";
import type { Stamp } from "./tabs/disk";

export interface AskCall {
  message: string;
  buttons: [string, string, string?];
}

export class FakeHost implements Host {
  isMac = false;
  caseInsensitivePaths = false;

  readonly files = new Map<string, Uint8Array>();
  readonly stamps = new Map<string, Stamp>();
  /** Paths waiting for `takePaths` (startup arguments, second instances). */
  queued: string[] = [];
  /** Answers for `pickFiles`, used in order; empty = dialog cancelled. */
  picks: string[][] = [];
  /** Answers for `ask`, used in order; when empty, the last button (Cancel). */
  answers: (0 | 1 | 2)[] = [];
  readonly asked: AskCall[] = [];
  readonly titles: string[] = [];
  readonly writes: { path: string; bytes: Uint8Array }[] = [];
  readonly opened: string[] = [];
  /** Host calls in order, e.g. to check the queue listener comes before takePaths. */
  readonly calls: string[] = [];
  /** Make reads or writes fail with this error. */
  readErrors = new Map<string, string>();
  writeErrors = new Map<string, string>();

  private clock = 1000;
  private queuedListeners: (() => void)[] = [];
  private dropListeners: ((paths: string[]) => void)[] = [];
  private focusListeners: (() => void)[] = [];
  private closeListeners: (() => Promise<boolean>)[] = [];
  private menuListeners: ((payload: unknown) => void)[] = [];

  get title(): string | undefined {
    return this.titles[this.titles.length - 1];
  }

  // ---- test controls ----

  /** Create or change a file; bumps its stamp like a write on disk would. */
  setFile(path: string, content: string | Uint8Array): void {
    const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
    this.files.set(path, bytes);
    this.stamps.set(path, { modifiedMs: (this.clock += 1000), size: bytes.length });
  }

  deleteFile(path: string): void {
    this.files.delete(path);
    this.stamps.delete(path);
  }

  text(path: string): string | undefined {
    const bytes = this.files.get(path);
    return bytes && new TextDecoder().decode(bytes);
  }

  /** Simulate a second launch (or startup arguments) queueing paths. */
  queuePaths(...paths: string[]): void {
    this.queued.push(...paths);
    for (const cb of this.queuedListeners) cb();
  }

  dropFiles(...paths: string[]): void {
    for (const cb of this.dropListeners) cb(paths);
  }

  focus(): void {
    for (const cb of this.focusListeners) cb();
  }

  /** Simulate a macOS menu item sending `payload`. */
  menu(payload: unknown): void {
    for (const cb of this.menuListeners) cb(payload);
  }

  /** Simulate the window's close button; true when the window may close. */
  async requestClose(): Promise<boolean> {
    for (const cb of this.closeListeners) if (!(await cb())) return false;
    return true;
  }

  // ---- Host ----

  async takePaths(): Promise<string[]> {
    this.calls.push("takePaths");
    const paths = this.queued;
    this.queued = [];
    return paths;
  }

  onPathsQueued(cb: () => void): void {
    this.calls.push("onPathsQueued");
    this.queuedListeners.push(cb);
  }

  onFilesDropped(cb: (paths: string[]) => void): void {
    this.dropListeners.push(cb);
  }

  async pickFiles(): Promise<string[]> {
    this.calls.push("pickFiles");
    return this.picks.shift() ?? [];
  }

  async readFile(path: string): Promise<Uint8Array> {
    this.calls.push(`readFile ${path}`);
    const error = this.readErrors.get(path);
    if (error) throw new Error(error);
    const bytes = this.files.get(path);
    if (!bytes) throw new Error(`file not found: ${path}`);
    return bytes.slice();
  }

  async writeFile(path: string, bytes: Uint8Array): Promise<void> {
    const error = this.writeErrors.get(path);
    if (error) throw new Error(error);
    this.writes.push({ path, bytes: bytes.slice() });
    this.setFile(path, bytes.slice());
  }

  async fileSize(path: string): Promise<number> {
    return (await this.readFile(path)).length;
  }

  async fileStamp(path: string): Promise<Stamp | null> {
    const stamp = this.stamps.get(path);
    return stamp ? { ...stamp } : null;
  }

  setTitle(title: string): void {
    this.titles.push(title);
  }

  async openUrl(url: string): Promise<void> {
    this.opened.push(url);
  }

  async ask(message: string, buttons: [string, string, string?]): Promise<0 | 1 | 2> {
    this.asked.push({ message, buttons });
    const last = (buttons[2] === undefined ? 1 : 2) as 1 | 2;
    return this.answers.shift() ?? last;
  }

  onCloseRequested(cb: () => Promise<boolean>): void {
    this.closeListeners.push(cb);
  }

  onFocus(cb: () => void): void {
    this.focusListeners.push(cb);
  }

  onMenuCommand(cb: (payload: unknown) => void): void {
    this.menuListeners.push(cb);
  }
}
