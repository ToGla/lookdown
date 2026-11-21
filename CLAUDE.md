# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

lookdown is a lightweight WYSIWYG Markdown viewer and editor for quickly opening and editing Markdown files. Guiding priorities, in order: lightweight, simple, quick to start, easy self-contained install.

## Status

No code yet. The design below is decided; build commands and project layout get added here once the project is scaffolded.

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

Windows is the v1 ship target; macOS comes later, so write cross-platform code from the start:

- No Windows-only APIs or path assumptions.
- Keybindings use CodeMirror `Mod-` (Ctrl on Windows, Cmd on macOS); provide a native menu bar (macOS expects one).
- Files arrive two ways and both must feed the same open-file path: command-line args (Windows, and second instances via the single-instance plugin) and the macOS open-file event (`RunEvent::Opened`).
- Test rendering on both WebView2 (Chromium) and WebKit when macOS is added.
- macOS builds need a Mac (plan: GitHub Actions macOS runner); signing/notarization is deferred.
