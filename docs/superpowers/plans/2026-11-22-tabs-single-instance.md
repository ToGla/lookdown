# Tabs and Single Instance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One window with tabs: files open from the command line, a second launch, drag and drop or `Ctrl+O`; unsaved work is always prompted; files changed on disk reload or warn.

**Architecture:** Rust queues incoming paths (startup args and second instances) and the frontend drains the queue. A pure `Workspace` model owns the tab list. Each tab pairs an `OpenDocument` with its own CodeMirror `EditorState`, and one `EditorView` swaps between them. A pure disk-check module compares file stamps polled every 2 s and on focus. The app shell talks to the OS only through a `Host` interface, so the dev harness can run the whole UI in a browser with fake files and dialogs.

**Tech Stack:** TypeScript, CodeMirror 6, Vitest (node), Tauri 2 with `tauri-plugin-single-instance` and `tauri-plugin-dialog` (+ `@tauri-apps/plugin-dialog`).

**Spec:** `docs/superpowers/specs/2026-11-22-tabs-single-instance-design.md`

## Global Constraints

- Byte-exact saving is unchanged: saves go through `OpenDocument.save`; a reload replaces the document's base and saved text. `src/file/*` untouched.
- No session restore, no new files, no Save As, no tab reordering, no menu bar, no file association.
- New dependencies only: `tauri-plugin-single-instance`, `tauri-plugin-dialog`, `@tauri-apps/plugin-dialog`.
- Keys: `Mod-o` open, `Mod-w` close tab, `Ctrl+Tab` / `Ctrl+PageDown` next, `Ctrl+Shift+Tab` / `Ctrl+PageUp` previous (wrapping). They work with no tab open. `Mod-s` saves the active tab.
- Poll interval: 2000 ms; also on window focus.
- Copy (exact):
  - empty page: `Open a file with Ctrl+O, or drop one here.` (on macOS `⌘O` in place of `Ctrl+O`);
  - tab close prompt: `Save changes to {name}?` buttons `Save`, `Don't save`, `Cancel`;
  - window close prompt: `Save changes to these files?` + one name per line; buttons `Save all`, `Discard all`, `Cancel`;
  - disk bar, changed: `{name} changed on disk.` buttons `Reload (discard your changes)`, `Keep yours`;
  - disk bar, deleted: `{name} was deleted or moved.` buttons `Close tab`, `Keep`;
  - save conflict: `{name} changed on disk. Overwrite it?` buttons `Overwrite`, `Cancel`;
  - open dialog filter names: `Markdown` (`md`, `markdown`) and `All files` (`*`).
- Window title: `{•? }{label} — lookdown` for the active tab, `lookdown` with no tab.
- Tab label: file name; when two open files share a name, `{name} — {parent folder}`. Markers: `•` unsaved (incl. deleted file), `!` pending disk change on an inactive tab.
- File-drop over in-editor text drag on Windows (Tauri native drag-drop stays on).
- Frontend tests: `pnpm test`; Rust: `cargo test --manifest-path src-tauri/Cargo.toml`; typecheck + build: `pnpm build`.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Browser and real-app checks are done by the controller after tasks 5–7.

## Review Focus

1. **A file opened twice through different spellings** (`C:\n\a.md`, `c:/n/./a.md`, `C:\n\sub\..\a.md`) focuses the existing tab on Windows; on other platforms case matters. Test in Task 2.
2. **Saves racing a disk change:** the file changes between the last poll and `Mod-s`, so the save must ask before overwriting; lookdown's own save must not trigger the changed bar on the next poll. Tests in Task 4.
3. **Closing with several unsaved tabs where one save fails or is cancelled:** nothing closes, the failing tab becomes active. Test in Task 4 (pure close-flow function).
4. **A clean tab reloading while it is not active:** its stored state gets the new text and the user sees it on switching, with no flash of old text and no undo step bringing old text back. Test in Task 3.
5. **Files arriving before the frontend is ready** (second launch during startup): nothing is lost. Test in Task 1 (queue) and the controller's real-app check.

---

### Task 1: Rust side — path queue, single instance, stamps, dialog plugin

**Files:**
- Modify: `src-tauri/Cargo.toml`, `src-tauri/src/lib.rs`, `src-tauri/src/files.rs`, `src-tauri/capabilities/default.json`, `package.json` (add `@tauri-apps/plugin-dialog` with `pnpm add`), `src/native.ts`

**Interfaces:**
- Rust:
  - `pub struct PathQueue(Mutex<Vec<String>>)`; startup arguments (all non-flag args after the program name, resolved against the cwd) seed it. Replace `StartupPath`/`initial_path`/`path_from_args` with `paths_from_args(args: &[String], cwd: &Path) -> Vec<PathBuf>` (keep its existing tests, extended to several paths).
  - `#[tauri::command] fn take_paths(queue: State<PathQueue>) -> Vec<String>`: drains and returns the queue.
  - `tauri_plugin_single_instance::init(|app, args, cwd| …)` registered first: push `paths_from_args(&args, &cwd)` to the queue, emit the event `"paths-queued"` (no payload), and unminimize + show + focus the `main` window.
  - `#[tauri::command(async)] fn file_stamp(path: String) -> Result<Option<Stamp>, String>` with `#[derive(Serialize)] struct Stamp { modified_ms: u64, size: u64 }` (serde camelCase: `modifiedMs`, `size`). `Ok(None)` when the file doesn't exist; `Err` for other errors. Apply the same `check_local` guard as `file_size`.
  - Register `tauri_plugin_dialog::init()`.
  - macOS open-file event: build with `.build(...)` + `.run(|app, event| …)` and, under `#[cfg(target_os = "macos")]`, handle `RunEvent::Opened { urls }` by pushing each `file:` URL's path to the queue and emitting `"paths-queued"`. It compiles away on Windows; only `cargo check` covers it here.
- Capabilities: add exactly what the frontend uses: `dialog:allow-open`, `dialog:allow-message`, `core:window:allow-destroy` (for closing after the prompt), plus whatever `core:default` lacks for `onCloseRequested` / focus / drag-drop events (verify against the generated schema; keep it minimal and pin it in the existing capabilities test).
- `src/native.ts` gains: `takePaths(): Promise<string[]>`, `onPathsQueued(cb: () => void): Promise<() => void>`, `fileStamp(path): Promise<{ modifiedMs: number; size: number } | null>`. Remove `initialPath`.

- [ ] **Step 1: Write failing Rust tests:** `paths_from_args` returns every non-flag path in order, resolved against the cwd; `PathQueue` drain returns everything pushed and leaves it empty; `file_stamp` on a temp file returns its size and a non-zero time, on a missing path `Ok(None)`, on `//h/s` an `Err`; the capabilities test lists the new permissions.
- [ ] **Step 2: Run** `cargo test --manifest-path src-tauri/Cargo.toml`. Expected: FAIL.
- [ ] **Step 3: Implement** the above. Keep `main.ts` compiling by switching it to `takePaths()` and opening the first path (tabs come in Task 5).
- [ ] **Step 4: Run** cargo tests, `pnpm test`, `pnpm build`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: path queue, single instance, file stamps and dialog plugin`.

### Task 2: Workspace model (pure)

**Files:**
- Create: `src/tabs/paths.ts`, `src/tabs/workspace.ts`, `src/tabs/paths.test.ts`, `src/tabs/workspace.test.ts`

**Interfaces:**
```ts
// paths.ts
export function pathKey(path: string, caseInsensitive: boolean): string; // separators → "/", drop "." segments, resolve "..", trailing "/" removed; lower-cased when caseInsensitive
export function baseName(path: string): string;
export function parentName(path: string): string; // last folder name, "" at a root
// workspace.ts
export interface TabInfo { id: number; path: string }
export class Workspace<T extends TabInfo> {
  constructor(caseInsensitive: boolean);
  readonly tabs: readonly T[];
  readonly active: T | null;
  find(path: string): T | null;            // by pathKey
  add(tab: T): void;                        // inserted right after the active tab, becomes active
  activate(id: number): void;
  remove(id: number): void;                 // next active: the tab to the right, else the left, else null
  next(): void; previous(): void;           // wrap; no-op with < 2 tabs
  label(tab: T): string;                    // baseName, or "name — parent" when another open tab has the same baseName (case-insensitively when caseInsensitive)
}
```

- [ ] **Step 1: Write the failing tests:**
  - `pathKey`: `C:\n\a.md`, `c:/n/./a.md`, `C:\n\sub\..\a.md` give the same key with `caseInsensitive` true; `/n/A.md` and `/n/a.md` differ with false.
  - `add` inserts after the active tab: with tabs `[a, b, c]` and `b` active, adding `d` gives `[a, b, d, c]`, `d` active.
  - `remove` of the active middle tab activates its right neighbour; of the last tab, the left one; of the only tab, `null`.
  - `next`/`previous` wrap.
  - `label`: `a/notes.md` and `b/notes.md` give `notes.md — a` and `notes.md — b`; once one closes, the other is `notes.md`.
  - `find` uses `pathKey`.
- [ ] **Step 2: Run** `pnpm test src/tabs`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: workspace model for tabs`.

### Task 3: Document reload, missing files and per-tab editor state

**Files:**
- Modify: `src/document.ts`, `src/document.test.ts`, `src/editor.ts`
- Create: `src/editor.test.ts` (state-only tests)

**Interfaces:**
- `OpenDocument`:
  - `reload(bytes: Uint8Array): { text: string } | { error: string }` — decodes like `fromBytes`; on success replaces base, BOM flag, saved text, current text and pending changes; clears `missing`.
  - `markMissing(): void` and `readonly missing: boolean`; `isDirty()` is true while `missing`. A successful `save` clears `missing`.
  - `track(tr)` ignores transactions annotated with `reloadAnnotation` (exported `Annotation<true>`).
- `editor.ts` splits into:
  - `export function createTabState(text: string, opts: TabStateOptions): EditorState` (all current extensions, per-tab `docPath`; `TabStateOptions` = `EditorOptions` minus nothing new — `onUpdate`, `onSave`, `openUrl`, `docPath`, `imageIO`);
  - `export function createView(parent: HTMLElement, state: EditorState): EditorView`;
  - `export function reloadTransaction(state: EditorState, text: string): TransactionSpec` — replaces only the differing middle (common prefix and suffix kept, so the cursor maps sensibly), annotated with `reloadAnnotation.of(true)` and `Transaction.addToHistory.of(false)`.
  - `createEditor` stays as a thin wrapper (`createView(parent, createTabState(...))`) for the dev harness.
- Undo rule (spec left it to the builder): a silent reload of a clean tab is not an undo step; earlier history maps through it. A dirty tab's "Reload (discard your changes)" replaces the tab's state with a fresh `createTabState` (history cleared), because undo there would resurrect discarded edits onto new text.

- [ ] **Step 1: Write the failing tests:**
  - `reload` of a clean document: `initialText`-equivalent text is the new text, `isDirty()` false, and a later edit + save writes bytes rebuilt from the reloaded base (CRLF file reloaded as CRLF keeps CRLF).
  - `reload` with invalid UTF-8 returns `{ error }` and leaves the document unchanged.
  - `markMissing` makes `isDirty()` true with unchanged text; `save` clears it.
  - `track` ignores a reload-annotated transaction.
  - `reloadTransaction`: from `"a\nb\nc"` with the cursor at the end of `c`, reloading to `"a\nB\nc"` keeps the cursor at the end of `c`; `undo` afterwards does not bring back `b`.
  - Review Focus 4: a state not attached to any view gets `reloadTransaction` applied (`state.update(spec).state`) and holds the new text.
- [ ] **Step 2: Run** `pnpm test src/document.test.ts src/editor.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test` and `pnpm build`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: reload, missing files and per-tab editor state`.

### Task 4: Disk checks, save guard and close flow (pure)

**Files:**
- Create: `src/tabs/disk.ts`, `src/tabs/disk.test.ts`, `src/tabs/closing.ts`, `src/tabs/closing.test.ts`

**Interfaces:**
```ts
// disk.ts
export type Stamp = { modifiedMs: number; size: number };
export type DiskEvent = "unchanged" | "changed" | "deleted" | "returned";
export function compareStamp(known: Stamp | null, now: Stamp | null): DiskEvent;
//  known = stamp lookdown last read or wrote (null = file was missing); now = current (null = missing)
//  null→null unchanged; stamp→null deleted; null→stamp returned; equal unchanged; different changed
export type DiskAction = "none" | "reload" | "show-changed" | "show-deleted";
export function diskAction(event: DiskEvent, dirty: boolean, dismissedStamp: Stamp | null, now: Stamp | null): DiskAction;
//  changed/returned & clean → reload; changed/returned & dirty → show-changed unless now equals dismissedStamp ("Keep yours" already seen for this version)
//  deleted → show-deleted (and the caller marks the document missing)
export function needsOverwriteConfirm(known: Stamp | null, now: Stamp | null): boolean;
//  true when the disk differs from `known` (changed, deleted→returned) — save then asks; false when equal or the file is missing (writing it back is the save)
// closing.ts
export type Choice = "save" | "discard" | "cancel";
export interface ClosingTab { id: number; dirty: boolean }
export async function closeAll(
  tabs: ClosingTab[],
  ask: (dirtyIds: number[]) => Promise<Choice>,
  save: (id: number) => Promise<boolean>,   // false = failed or overwrite cancelled
): Promise<{ close: true } | { close: false; activate: number | null }>;
//  no dirty tabs → close; ask once; cancel → {close:false, activate:null}; discard → close;
//  save → save each dirty tab in order; first false → {close:false, activate:that id}; all ok → close
```

- [ ] **Step 1: Write the failing tests** covering every branch above, including Review Focus 2 (`needsOverwriteConfirm` true when the disk changed after the last read; false right after lookdown's own save recorded the new stamp) and Review Focus 3 (`closeAll` with three dirty tabs where the second save returns false: the third is not saved, result activates the second).
- [ ] **Step 2: Run** `pnpm test src/tabs`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: disk change and close-flow logic`.

### Task 5: App shell — tabs, opening, keys, empty page

**Files:**
- Create: `src/host.ts` (interface + Tauri implementation), `src/app.ts`, `src/ui/tabbar.ts`, `src/ui/empty.ts`
- Modify: `src/main.ts` (becomes: `startApp(document.body parts, tauriHost())`), `index.html` (tab bar container above `#app`), `src/styles.css`, `dev/preview.html` + `dev/preview.ts` → keep the editor-only harness, and add `dev/app.html` + `dev/app.ts` mounting `startApp` with a fake host.

**Interfaces:**
```ts
// host.ts
export interface Host {
  isMac: boolean; caseInsensitivePaths: boolean;
  takePaths(): Promise<string[]>; onPathsQueued(cb: () => void): void;
  onFilesDropped(cb: (paths: string[]) => void): void;
  pickFiles(): Promise<string[]>;                       // native open dialog, multiple, filters per Global Constraints
  readFile(path: string): Promise<Uint8Array>; writeFile(path: string, bytes: Uint8Array): Promise<void>;
  fileSize(path: string): Promise<number>; fileStamp(path: string): Promise<Stamp | null>;
  setTitle(title: string): void; openUrl(url: string): Promise<void>;
  ask(message: string, buttons: [string, string, string?]): Promise<0 | 1 | 2>; // index of the button; the last button is Cancel/escape
  onCloseRequested(cb: () => Promise<boolean>): void;   // resolve true to let the window close
  onFocus(cb: () => void): void;
}
export function tauriHost(): Host;
export function startApp(root: { tabs: HTMLElement; app: HTMLElement; status: HTMLElement }, host: Host): void; // in app.ts
```
- `app.ts` owns a `Workspace<Tab>` where `Tab = { id, path, doc: OpenDocument, state: EditorState, scroll?: StateEffect<unknown>, stamp: Stamp | null, dismissed: Stamp | null }` and one `EditorView` (created on the first tab, kept while tabs exist; destroyed with the last tab, recreated on the next open).
  - Switching: store `view.state` and `view.scrollSnapshot()` on the old tab, `view.setState(tab.state)`, dispatch the stored scroll snapshot, update title and tab bar.
  - Opening (all four routes call `openPaths(paths)`): already open → activate; else read + decode (error → status line, no tab), stamp it, create its state, `workspace.add`.
  - Keys on `window` keydown (capture) per Global Constraints, so they work in the empty window and before CodeMirror's keymap.
  - `Mod-s` stays a CodeMirror key and saves the active tab (overwrite check comes in Task 6).
  - Tab bar: plain DOM; buttons with label + marker + ×; middle-click closes; `title` attribute = full path; scrolls horizontally and keeps the active tab in view.
  - Empty page when no tab: the exact copy from Global Constraints; title `lookdown`.
  - Closing a tab in this task: closes immediately when clean; dirty tabs use Task 6's prompt (until then, do nothing for dirty tabs).
- `dev/app.ts` fake host: in-memory files seeded from `dev/sample.md` and two more small docs (one with the same file name in another "folder"); `pickFiles` uses `window.prompt` for a path; `ask` uses `window.confirm`-style buttons rendered in a tiny DOM dialog; `fileStamp` returns stored stamps; a dev-only `window.__devHost` lets the controller edit or delete a fake file and fire focus.

- [ ] **Step 1: Write failing tests** for the parts testable without DOM: `openPaths` against a fake host and a stub view factory (already open → activate; error → no tab and the status message; order of several paths; last one active). Keep DOM code thin.
- [ ] **Step 2: Run** `pnpm test`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test`, `cargo test --manifest-path src-tauri/Cargo.toml`, `pnpm build`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: tabs, opening files and the empty window`.

### Task 6: Prompts, disk polling and the disk bar

**Files:**
- Create: `src/ui/diskbar.ts`
- Modify: `src/app.ts`, `src/styles.css`, `dev/app.ts`

**Interfaces:** uses `compareStamp`, `diskAction`, `needsOverwriteConfirm`, `closeAll` (Task 4), `reloadTransaction` / `createTabState` / `markMissing` / `reload` (Task 3), `Host.ask`, `Host.onCloseRequested`, `Host.onFocus`.
- Closing a dirty tab: `ask("Save changes to {name}?", ["Save", "Don't save", "Cancel"])`.
- Window close: `closeAll` with `ask` showing the window prompt (names, one per line).
- Saving (`Mod-s` and inside prompts): `fileStamp` first; `needsOverwriteConfirm` → `ask("{name} changed on disk. Overwrite it?", ["Overwrite", "Cancel"])`; after a successful save record the new stamp and clear `dismissed`. A failed save shows the status error and returns false.
- Polling: `setInterval` 2000 ms plus `onFocus`; one check at a time (skip a tick while the previous one runs); for every tab `compareStamp` → `diskAction` → reload (active tab: dispatch `reloadTransaction` on the view; inactive: update its stored state), or show the bar (active) / mark `!` (inactive; the bar shows on switching).
- Disk bar (above the editor, active tab only) with the exact copy and buttons: Reload (discard your changes) → re-read, `doc.reload`, fresh `createTabState`; Keep yours → `dismissed = now`, hide; Close tab → close without prompt; Keep → hide, document stays missing (dirty).

- [ ] **Step 1: Write failing tests** with the fake host from Task 5: a clean inactive tab whose fake file changes is reloaded on the next poll and shows the new text when activated; a dirty tab gets the changed state and no reload; `Keep yours` suppresses the bar until the file changes again; a deleted file marks the tab dirty; `Mod-s` on a file changed after the last poll asks before writing and writes nothing on Cancel; lookdown's own save doesn't produce a changed event on the next poll.
- [ ] **Step 2: Run** `pnpm test`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test`, `pnpm build`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: close prompts, disk polling and the disk bar`.

### Task 7: Leftovers from step 2, README

**Files:**
- Modify: `src/preview/popup-menu.ts`, `src/preview/plugin.ts`, `src/preview/image-loader.ts`, `src/preview/images.ts`, `src/preview/web-image-menu.ts` (if needed), `src/app.ts`, tests next to each, `README.md`

**Interfaces:**
- `popup-menu.ts`: `export function closeMenu(): void` (closes any open menu). A small `ViewPlugin` in the preview closes it on `docChanged`; `app.ts` calls it on tab switch.
- `ImageCache.forgetFailures(): void` drops memoized failures (not successes). `images.ts`: `retryImages: StateEffectType<null>` bumps an epoch held in a field; `ImageBlockWidget` compares the epoch only for widgets whose source is local, so successful images re-render from the cache instantly. `app.ts` calls `forgetFailures()` and dispatches `retryImages` on window focus and after reloading a tab.
- Web image retry: `loadedWebImages` becomes `ReadonlyMap<string, number>` (attempt count); `loadWebImage` increments; the widget compares the attempt; the failure placeholder keeps `data-ld-web` so "Load image" shows again.
- README: Using it section — tabs, `Ctrl+O`, drop to open, keys, prompts, reload on change; Roadmap step 3 struck through as done.

- [ ] **Step 1: Write failing tests:** `closeMenu` is callable with no menu; `forgetFailures` makes the next `load` of a failed path read again but not a loaded one; after `retryImages` a local widget is not `eq` to its predecessor; loading the same web URL twice yields attempt 2 and a non-equal widget.
- [ ] **Step 2: Run** `pnpm test`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test`, `pnpm build`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: menus close on change, image and web image retry`.
