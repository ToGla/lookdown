# macOS build and menu bar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `pnpm tauri build` on an Apple Silicon Mac produces a working `lookdown.app` and `.dmg` with a minimal native menu bar, without changing the Windows build.

**Architecture:** A `tauri.macos.conf.json` adds the macOS bundle targets. A macOS-only Rust module builds the menu and turns each custom item into a `menu-command` event (or, for Quit, a request to close the main window), so all logic stays in the frontend's `App.run` and its existing window-close flow. A `RunEvent::ExitRequested` guard routes Dock/logout quits through the same close flow.

**Tech Stack:** Tauri 2.12 (menu API in `tauri::menu`), Rust, TypeScript, CodeMirror 6 (`@codemirror/commands` `undo`/`redo`), Vitest.

**Spec:** `docs/superpowers/specs/2026-11-22-macos-build-design.md`

## Global Constraints

- Windows behaviour and bundle unchanged: `tauri.conf.json` keeps `"targets": ["nsis"]`; no menu on Windows (menu code is `#[cfg(target_os = "macos")]`).
- No new runtime dependencies (Rust or npm).
- Thin Rust: menu handlers only emit events or close the window; no file or tab logic in Rust.
- Native architecture only (`aarch64-apple-darwin`), no universal binary, no signing beyond ad-hoc, no notarization, no CI.
- Menu labels and shortcuts exactly as in the spec's table (lookdown / File / Edit / Window).
- `Cmd+W` closes the tab, never the window. Every quit route goes through the window-close prompt.
- A menu shortcut must run its command exactly once.
- No version bump.

## Review Focus

1. Quitting with unsaved tabs via `Cmd+Q`, the lookdown menu's Quit, and the Dock icon's Quit: the "Save changes to these files?" prompt appears; Cancel keeps lookdown running with the tabs intact (Task 3 manual check; Task 3 unit test pins the event mapping).
2. Holding or pressing `Cmd+W`, `Cmd+S`, `Cmd+Z` once: exactly one tab closes / one save / one undo step (Task 1 probe decides the wiring; Task 3 manual check).
3. Opening a `.md` from Finder while lookdown is *not* running: it launches with that file in a tab, not an empty window (Task 4 manual check).
4. Menu commands with no tab open (Save, Close Tab, Undo): nothing happens, no error in the status line (Task 2 test `menu commands without a tab do nothing`).
5. An unknown `menu-command` payload (e.g. from a future menu item) is ignored, not passed to `App.run` (Task 2 test `ignores unknown menu commands`).

---

### Task 1: Probe how the macOS menu and webview share shortcuts (throwaway)

Settles the one runtime fact the design leaves open. Nothing from this task is committed except the recorded outcome.

**Files:**
- Modify temporarily: `src-tauri/src/lib.rs`, `src/app.ts`
- Record: append an `## Outcome of Task 1` section to this plan file

- [ ] **Step 1: Add a throwaway menu** in `run()` (macOS): one submenu with a custom item `probe` with accelerator `CmdOrCtrl+S`, plus `PredefinedMenuItem::copy`/`paste`; `on_menu_event` does `println!("menu {}", event.id().0)`. In `startApp`'s keydown listener add `console.log("key", e.key, e.metaKey)` before `keyCommand`.
- [ ] **Step 2: Run** `pnpm tauri dev -- -- /Users/tomas/Projekt/lookdown/README.md`, open the web inspector (right-click → Inspect), press `Cmd+S` once with the editor focused and once with focus outside it (empty area of the tab bar). Note whether the terminal prints `menu probe`, the console prints `key s true`, or both.
- [ ] **Step 3: Record the outcome** as one of:
  - **Menu only:** the webview never sees accelerator keys. → Task 3 keeps accelerators on all custom items; on macOS the menu is the only path for those keys.
  - **Webview only / webview first and menu skipped when the page calls `preventDefault`:** → Task 3 keeps accelerators; the menu fires only when clicked or when the page doesn't handle the key.
  - **Both:** → Task 3 keeps accelerators, and Task 2's Step 5 (macOS key filter) is required.
  Also note whether `Cmd+C`/`Cmd+V` copy and paste text in the editor with the predefined items.
- [ ] **Step 4: Revert** `git checkout src-tauri/src/lib.rs src/app.ts`; commit only the plan file:

```bash
git add docs/superpowers/plans/2026-11-22-macos-build.md
git commit -m "docs: record macOS menu shortcut routing"
```

---

### Task 2: Frontend menu commands (undo, redo, menu-command event)

**Files:**
- Modify: `src/app.ts` (`Command`, `ViewPort`, `App.start`, `App.run`, `editorPort`, maybe `keyCommand`)
- Modify: `src/host.ts` (`Host.onMenuCommand`, `tauriHost`)
- Modify: `src/native.ts` (`onMenuCommand`)
- Modify: `src/test-host.ts` (`FakeHost.onMenuCommand`, `FakeHost.menu`)
- Test: `src/app.test.ts` (and `StubView` there gains `undo`/`redo`)

**Interfaces:**
- Produces:
  - `export type Command = "open" | "close" | "next" | "previous" | "save" | "undo" | "redo";`
  - `export function isCommand(value: unknown): value is Command` in `src/app.ts`
  - `ViewPort.undo(): void; ViewPort.redo(): void;` (run CodeMirror's `undo`/`redo` on the view)
  - `Host.onMenuCommand(cb: (command: Command) => void): void`
  - `native.onMenuCommand(cb: (payload: unknown) => void): Promise<() => void>` listening to event **`menu-command`**, payload a string
  - `FakeHost.menu(payload: unknown): void` test control that calls the registered listeners

- [ ] **Step 1: Write the failing tests** in `src/app.test.ts`, `describe("menu commands")`:

```ts
it("runs a menu command like the keyboard does", async () => {
  await app.start();
  await app.openPaths(["/docs/a.md"]);
  host.menu("close");
  await app.idle();
  expect(app.tabs).toHaveLength(0);
});

it("ignores unknown menu commands", async () => {
  await app.start();
  await app.openPaths(["/docs/a.md"]);
  host.menu("explode");
  host.menu(42);
  await app.idle();
  expect(app.tabs).toHaveLength(1);
  expect(ui.statusLine).toBe("");
});

it("undo and redo act on the shown tab's editor", async () => {
  await app.start();
  await app.openPaths(["/docs/a.md"]);
  await app.run("undo");
  await app.run("redo");
  expect(ui.view.calls).toEqual(["undo", "redo"]);
});

it("menu commands without a tab do nothing", async () => {
  await app.start();
  for (const c of ["save", "close", "undo", "redo", "next", "previous"] as const) await app.run(c);
  expect(ui.statusLine).toBe("");
  expect(host.writes).toHaveLength(0);
});

it("isCommand accepts exactly the commands", () => {
  expect(["open", "close", "next", "previous", "save", "undo", "redo"].every(isCommand)).toBe(true);
  expect(isCommand("quit")).toBe(false);
  expect(isCommand(undefined)).toBe(false);
});
```

`StubView` records `undo`/`redo` in a `calls: string[]` array (add the field if `StubView` has none). Use whatever helper the file already uses to open a tab if it differs from `openPaths` + `idle`.

- [ ] **Step 2: Run** `pnpm test -- src/app.test.ts` — Expected: FAIL (`isCommand` not exported, `host.menu` not a function).

- [ ] **Step 3: Implement.**
  - `App.start` registers `this.host.onMenuCommand((c) => void this.run(c))` next to the other host listeners.
  - `App.run` handles `"undo"`/`"redo"` by calling `this.view?.undo()` / `redo()` when a tab is shown; the shown tab's state must stay in sync the same way it does after a keyboard edit (check how `editorPort`'s updates flow back into `tab.state`; undo via `view.dispatch` takes that same path).
  - `editorPort` implements them with `undo(view)` / `redo(view)` from `@codemirror/commands`.
  - `tauriHost().onMenuCommand` calls `native.onMenuCommand` and forwards only payloads passing `isCommand`. `FakeHost.menu` applies the same filter, by registering its listeners through the same guard (keep the guard in one place: a small `menuListener(cb)` helper in `app.ts` or the filter inside `App.start` — pick one, test above covers it).
- [ ] **Step 4: Run** `pnpm test` — Expected: all PASS.
- [ ] **Step 5 (only if Task 1 found "Both"):** give `keyCommand` the rule that on macOS it returns `null` for `Cmd+O`, `Cmd+S`, `Cmd+W` (the menu owns them) and drop `historyKeymap`'s `Mod-z`/`Mod-Shift-z`/`Mod-y` on macOS in `src/editor.ts` (the menu's Undo/Redo own them). Tests: `keyCommand` with `isMac = true` returns `null` for those three; the existing Windows (`isMac = false`) cases still pass. Ctrl+Tab stays in `keyCommand` only if Task 1 shows `Ctrl+Tab` is not double-handled; otherwise remove it on macOS too.
- [ ] **Step 6: Commit**

```bash
git add src/app.ts src/host.ts src/native.ts src/test-host.ts src/app.test.ts src/editor.ts
git commit -m "feat: menu commands, undo and redo in the frontend"
```

---

### Task 3: macOS menu bar and quit routing (Rust)

**Files:**
- Create: `src-tauri/src/menu.rs`
- Modify: `src-tauri/src/lib.rs` (`mod menu;`, `.menu(...)` / `.on_menu_event(...)` under `#[cfg(target_os = "macos")]`, `RunEvent::ExitRequested` handling)

**Interfaces:**
- Consumes: event name `menu-command` with a `Command` string payload (Task 2).
- Produces:
  - `pub enum MenuAction { Emit(&'static str), Quit }` and `pub fn action_for(id: &str) -> Option<MenuAction>` — compiled on all platforms so it is tested on Windows too.
  - `#[cfg(target_os = "macos")] pub fn build(app: &tauri::AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>>`
  - `#[cfg(target_os = "macos")] pub fn handle(app: &tauri::AppHandle, id: &str)`

Item ids are the command names: `open`, `save`, `close`, `undo`, `redo`, `next`, `previous`, plus `quit`.

| Menu | Item | Kind | Accelerator |
| --- | --- | --- | --- |
| lookdown | About lookdown | `PredefinedMenuItem::about` (name, version from `app.package_info()`, icon) | |
| | separator, Hide lookdown, Hide Others, Show All | predefined | `Cmd+H`, `Alt+Cmd+H` (predefined) |
| | separator, Quit lookdown | custom `quit` | `CmdOrCtrl+Q` |
| File | Open… / Save / Close Tab | custom `open` / `save` / `close` | `CmdOrCtrl+O` / `CmdOrCtrl+S` / `CmdOrCtrl+W` |
| Edit | Undo / Redo | custom `undo` / `redo` | `CmdOrCtrl+Z` / `CmdOrCtrl+Shift+Z` |
| | separator, Cut, Copy, Paste, Select All | predefined | (predefined) |
| Window | Minimize, Zoom | predefined | `Cmd+M` (predefined) |
| | separator, Next Tab / Previous Tab | custom `next` / `previous` | `Ctrl+Tab` / `Ctrl+Shift+Tab` |

- [ ] **Step 1: Write the failing test** in `menu.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn commands_map_to_events() {
        for id in ["open", "save", "close", "undo", "redo", "next", "previous"] {
            assert!(matches!(action_for(id), Some(MenuAction::Emit(c)) if c == id), "{id}");
        }
    }

    #[test]
    fn quit_closes_the_window() {
        assert!(matches!(action_for("quit"), Some(MenuAction::Quit)));
    }

    #[test]
    fn unknown_ids_do_nothing() {
        assert!(action_for("about").is_none());
        assert!(action_for("").is_none());
    }
}
```

- [ ] **Step 2: Run** `cargo test --manifest-path src-tauri/Cargo.toml menu` — Expected: FAIL (`action_for` not found).
- [ ] **Step 3: Implement** `action_for`, `build` (table above), `handle` (`Emit(c)` → `app.emit("menu-command", c)`; `Quit` → `close()` on the `main` webview window, which raises the same close request as the red button). Wire in `lib.rs`: `Builder::menu(menu::build)` and `on_menu_event(|app, e| menu::handle(app, e.id().as_ref()))`, both macOS only.
- [ ] **Step 4: Quit from outside the menu.** In `app.run`'s closure, on macOS: `RunEvent::ExitRequested { code: None, api, .. }` while the `main` window still exists → `api.prevent_exit()` and `close()` that window. When the window has closed (approved), `ExitRequested` comes again with no `main` window and exit proceeds. Leave `code: Some(_)` (explicit `app.exit`) alone.
- [ ] **Step 5: Run** `cargo test --manifest-path src-tauri/Cargo.toml` — Expected: all PASS (existing config tests included).
- [ ] **Step 6: Manual check** with `pnpm tauri dev -- -- /Users/tomas/Projekt/lookdown/README.md`, edit the file without saving, then for each: menu Quit, `Cmd+Q`, Dock icon → Quit: the save prompt appears; Cancel keeps the window and tab. Then: `Cmd+W` closes one tab (prompt), `Cmd+S` saves once, `Cmd+Z` undoes one step, `Cmd+C`/`Cmd+V` work, Next/Previous Tab switch tabs, About shows name/version/fish. If Dock Quit bypasses the prompt and Step 4 cannot catch it, write that down for the README's known issues.
- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/menu.rs src-tauri/src/lib.rs
git commit -m "feat: macOS menu bar; quitting goes through the close prompt"
```

---

### Task 4: macOS bundle config and release build

**Files:**
- Create: `src-tauri/tauri.macos.conf.json`
- Modify: `src-tauri/src/lib.rs` tests (`mod tests`)
- Maybe create: `src-tauri/icons/` macOS-padded icon source (only if Step 5 says so)

- [ ] **Step 1: Write the failing test** in `lib.rs` tests:

```rust
#[test]
fn macos_bundle_builds_app_and_dmg() {
    let mac: Value = serde_json::from_str(include_str!("../tauri.macos.conf.json")).unwrap();
    assert_eq!(mac["bundle"]["targets"], serde_json::json!(["app", "dmg"]));
}
```

Keep `bundle_builds_only_the_nsis_setup` as is (it pins the base config, which is what Windows uses).

- [ ] **Step 2: Run** `cargo test --manifest-path src-tauri/Cargo.toml macos_bundle` — Expected: FAIL (file not found at compile time).
- [ ] **Step 3: Create** `tauri.macos.conf.json` with `bundle.targets` `["app", "dmg"]` and `bundle.macOS.minimumSystemVersion` `"11.0"` (oldest macOS on Apple Silicon). Nothing else unless Step 4 shows it is needed.
- [ ] **Step 4: Build and inspect.** `pnpm tauri build`. Expected artifacts: `src-tauri/target/release/bundle/macos/lookdown.app` and `src-tauri/target/release/bundle/dmg/lookdown_0.1.0_aarch64.dmg`. Check:
  - `plutil -p src-tauri/target/release/bundle/macos/lookdown.app/Contents/Info.plist` lists `CFBundleDocumentTypes` with `md` and `markdown`, `CFBundleIdentifier` = `io.github.togla.lookdown`, version `0.1.0`.
  - `codesign -dv src-tauri/target/release/bundle/macos/lookdown.app` reports an ad-hoc signature.
  - Copy the app to `/Applications`, quit any running lookdown, double-click a `.md` in Finder via Open With → lookdown: it launches with the file in a tab. With lookdown running, open a second file: it adds a tab; open the first again: its tab is focused.
  - Finder → Get Info on a `.md` → Open with lists lookdown. If it doesn't, add `"contentTypes": ["net.daringfireball.markdown"]` (and, if Tauri needs it, an `exportedType`) to the association and rebuild; extend `markdown_extensions_are_associated` to pin the added field.
  - If the DMG step asks for Finder automation permission or fails headless, note the exact message for the README.
- [ ] **Step 5: Icon check.** Put lookdown in the Dock next to Finder/Safari. If the tile is visibly larger (no margin), make a macOS variant of `lookdown.svg` with the tile scaled to ~80% on a transparent 1024 canvas, generate only `icon.icns` from it (`pnpm tauri icon` into a temp dir, copy `icon.icns`), and note the source file in the README's icon paragraph. Otherwise leave icons untouched.
- [ ] **Step 6: Run** `cargo test --manifest-path src-tauri/Cargo.toml` and `pnpm test` — Expected: all PASS.
- [ ] **Step 7: Commit**

```bash
git add src-tauri/tauri.macos.conf.json src-tauri/src/lib.rs src-tauri/tauri.conf.json src-tauri/icons
git commit -m "feat: macOS app and dmg bundles"
```

---

### Task 5: WebKit pass

**Files:** whatever the fixes touch; tests next to them.

- [ ] **Step 1: Try every bullet** of README "Opening files" in the release `.app` against files covering each feature (use `tests/fixtures/` copies and a scratch `.md` with headings, emphasis, lists, quotes, code, links, a task list, a table, a local PNG and SVG, a web image). Include: open dialog, drag-and-drop of files onto the window, close prompts, disk change bar (edit the file in another editor), `Cmd`+click on a link, right-click table menu and Load image menu, CRLF and BOM fixtures saved after an edit (`git diff --stat` on a copy shows only the edited line).
- [ ] **Step 2: For each bug:** if fixable within the task's spirit (an hour, no new dependency), write a failing test where the logic is testable, fix, run `pnpm test`, commit `fix: <what> on WebKit`. Otherwise add it to a list for Task 6's known issues.
- [ ] **Step 3: Record** the pass/fail per README bullet in the final summary to the user (not committed).

---

### Task 6: README and CLAUDE.md

**Files:**
- Modify: `README.md`, `CLAUDE.md`

- [ ] **Step 1: README:**
  - Status line: Windows installer/portable exe and a macOS app.
  - Requirements: add "macOS 11 or later on Apple Silicon".
  - Install on macOS: open the `.dmg`, drag lookdown to Applications; first launch of the unsigned app: Gatekeeper blocks it → System Settings → Privacy & Security → "Open Anyway" (and, for a copy from another Mac, `xattr -dr com.apple.quarantine /Applications/lookdown.app`); default app: Finder → Get Info on a `.md` → Open with → lookdown → Change All; update: quit, replace the app; uninstall: delete the app, optionally `~/Library/WebKit/io.github.togla.lookdown` and `~/Library/Caches/io.github.togla.lookdown`.
  - Opening files: `open -a lookdown notes.md` on macOS; mention the menu bar; Quit asks about unsaved tabs.
  - Building from source prerequisites: macOS needs Xcode Command Line Tools (`xcode-select --install`); any DMG/Finder permission note from Task 4.
  - Artifacts: `.app` and `.dmg` paths with their sizes from Task 4's build.
  - Known issues from Tasks 3 and 5, if any.
  - Roadmap: step 5 struck through as done.
- [ ] **Step 2: CLAUDE.md "Platforms":** replace "macOS builds need a Mac (plan: GitHub Actions macOS runner); signing/notarization is deferred." with "macOS builds are made locally on an Apple Silicon Mac (`app` + `dmg` targets in `tauri.macos.conf.json`); signing/notarization is deferred." and "Windows is the v1 ship target; macOS comes later" with "Windows and macOS (Apple Silicon) are both built".
- [ ] **Step 3: Verify** `pnpm test` and `cargo test --manifest-path src-tauri/Cargo.toml` pass (index-html or README-pinning tests, if any, included).
- [ ] **Step 4: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "docs: macOS install, build and menu"
```

## Outcome of Task 1

Probed 2026-11-22 in `pnpm tauri dev` on macOS (arm64), menu item `probe` on `CmdOrCtrl+S`:

- Page handles `Cmd+S` and calls `preventDefault`: the page's keydown fires, the menu item does **not**.
- Page sees `Cmd+S` but does not call `preventDefault`: the page's keydown fires **and** the menu item fires.
- So: **webview first; the menu fires only for keys the page leaves unhandled.** Task 3 keeps accelerators on all custom items; Task 2 Step 5 is **not** needed. `keyCommand` already calls `preventDefault` (also on key repeat), and CodeMirror's history keymap calls it when it undoes, so each shortcut runs once. Rule for future keys: a key the page handles must call `preventDefault`, or the menu runs it a second time.
- With `PredefinedMenuItem::copy`/`paste` in the menu, `Cmd+C`/`Cmd+V` copy and paste in the editor; `Cmd+Z` undoes the paste.
