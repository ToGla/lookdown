# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

lookdown is a lightweight WYSIWYG Markdown viewer and editor for quickly opening and editing Markdown files. Guiding priorities, in order: lightweight, simple, quick to start, easy self-contained install.

## Commands

Tools (node, pnpm, rust) come from `mise.toml`.

- `pnpm install`: install frontend dependencies
- `pnpm tauri dev`: run the app with Vite hot reload (Vite on port 1420)
- `pnpm tauri build`: size-optimized release build and bundles
- `pnpm test`: frontend tests (Vitest, `src/**/*.test.ts`)
- `cargo test --manifest-path src-tauri/Cargo.toml`: Rust tests

Use `pnpm run <script>` when checking whether a script exists: a bare `pnpm test` with no `test` script exits 0 silently.

Open a file in dev with `pnpm tauri dev -- -- <absolute path>` (cargo runs in `src-tauri/`, so relative paths resolve there). A debug exe (`src-tauri/target/debug/lookdown.exe <path>`) loads its frontend from the Vite server on port 1420, so it works alongside a running `pnpm tauri dev`.

## Layout

- `index.html`, `src/`: frontend (TypeScript, no UI framework), built by Vite into `dist/`
  - `src/file/codec.ts`: bytes ↔ text (UTF-8 only, BOM remembered)
  - `src/file/lines.ts`: raw ↔ normalized line endings; `rebuild()` turns CodeMirror changes back into raw text, copying untouched stretches verbatim
  - `src/document.ts`: `OpenDocument`, one open file (dirty state, queued saves)
  - `src/editor.ts`, `src/native.ts`, `src/main.ts`: CodeMirror setup, typed `invoke` wrappers, wiring
- `src-tauri/`: Rust shell (`src/lib.rs` holds `run()`, `src/files.rs` the file commands, `src/menu.rs` and `src/quit.rs` macOS only, `tauri.conf.json` + `tauri.macos.conf.json`, `capabilities/`, `icons/`)
- `tests/fixtures/`: byte-exact test files (see Hard constraints)
- `docs/superpowers/`: specs and plans

## Workflow

The project uses the [superpowers](https://github.com/obra/superpowers) plugin, enabled in `.claude/settings.json` (marketplace `obra/superpowers-marketplace`). Follow its skills: brainstorming → writing-plans → executing-plans / subagent-driven-development, with test-driven-development and requesting-code-review along the way.

## Decided architecture

- **Shell: Tauri 2.** Ships as a single self-contained executable (frontend embedded) using the system webview (WebView2 on Windows, WebKit on macOS). Offer both a portable exe and a small installer; the installer exists only to register the `.md` file association.
- **Editor: CodeMirror 6 in live-preview mode** (Obsidian-style). The buffer is always the raw Markdown text: syntax is rendered/hidden via decorations and shown on the line being edited.
- **Frontend: TypeScript + Vite, no UI framework.** The UI is the editor plus a tab bar and minimal chrome.
- **Rust side stays thin:** file read/write, receiving file paths, file watching, window/tab-close prompts. Logic belongs in the frontend unless it needs the OS.

## Hard constraints

- **Never re-serialize the document.** No parse-to-model-and-write-back (ProseMirror/Milkdown/TipTap style). Saving writes the buffer text; untouched bytes must stay identical so saves produce minimal git diffs.
- **Preserve file encoding details:** line endings (CRLF/LF) and BOM are detected on open and written back unchanged. Put byte-exact test files (CRLF, LF, mixed, BOM) under `tests/fixtures/`: `.gitattributes` marks that path `-text` so git never converts them. Everything else is normalized to LF.
- **Out of scope:** file tree, sidebar, workspaces/vaults, project search, or other multi-document features beyond tabs. Push back on additions that compromise startup time, binary size or simplicity.

## Behavior

- **One window, tabs, single instance.** Opening a file while lookdown runs adds a tab to the existing window (`tauri-plugin-single-instance`). Opening a file that is already open focuses its tab.
- **Saving:** explicit save (`Mod-s`), per-tab dirty marker, no autosave. Closing a dirty tab prompts; closing the window prompts once listing all unsaved tabs.
- **External changes:** a watched file changed on disk reloads silently if its tab is clean; otherwise warn and let the user choose.
- **Markdown flavor:** CommonMark + GFM (tables, task lists, strikethrough, autolinks). No math or Mermaid in v1.
- **Images:** local relative image paths render inline, resolved against the file's directory.

## Platforms

Windows and macOS (Apple Silicon) are both built; write cross-platform code:

- No Windows-only APIs or path assumptions.
- Keybindings use CodeMirror `Mod-` (Ctrl on Windows, Cmd on macOS); a native menu bar on macOS only (`src-tauri/src/menu.rs`; Windows keeps a menu-less window). Menu items emit `menu-command` events that run the frontend's `Command`s.
- macOS shortcuts reach the webview first; the menu item with the same accelerator fires only if the page does not call `preventDefault`. A key the page handles must call `preventDefault`, or it runs twice.
- Every quit route on macOS (menu, `Cmd+Q`, Dock, logout) becomes a close request on the window, so unsaved tabs prompt (`src-tauri/src/quit.rs` adds `applicationShouldTerminate:` to tao's delegate class).
- Files arrive two ways and both must feed the same open-file path: command-line args (Windows, and second instances via the single-instance plugin) and the macOS open-file event (`RunEvent::Opened`).
- Test rendering on both WebView2 (Chromium) and WebKit.
- macOS builds are made locally on an Apple Silicon Mac (`app` + `dmg` targets and an ad-hoc signature in `tauri.macos.conf.json`); signing/notarization is deferred.
