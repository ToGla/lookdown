# lookdown

A lightweight Markdown viewer and editor for quickly opening and editing a
Markdown file, then getting out of your way.

> **Status: early development.** lookdown can open a file from the command line,
> edit it as plain text and save it. Live preview, tabs and an installer are next
> (see [Roadmap](#roadmap)).

## Why lookdown

Most Markdown editors are either full note-taking apps with vaults and sidebars,
or rich-text editors that rewrite your file when they save it. lookdown aims to
be neither:

- **Lightweight.** A single small executable (about 3 MB) using the system
  webview, not a bundled browser.
- **Quick to start.** Double-click a `.md` file, read it, edit it, close it.
- **Your bytes stay yours.** Saving never reformats the document. Lines you
  didn't touch are written back byte for byte, including line endings (LF,
  CRLF, even mixed) and a UTF-8 byte order mark. A save shows up in `git diff`
  as exactly the lines you changed.
- **Simple.** One window with tabs. No file tree, workspaces or project search.

## What it looks like

lookdown will edit in a *live preview* style, the way Obsidian does: the file
stays plain Markdown, but headings, emphasis, links, lists, tables and images
are rendered in place, and the Markdown syntax appears only on the line you are
editing. (Today the editor still shows plain text; live preview is the next
milestone.)

## Using it

There are no prebuilt downloads yet. Build it from source (below), then open a
file:

```powershell
lookdown notes.md
```

- `Ctrl+S` (`Cmd+S` on macOS) saves. A `•` in the window title means there are
  unsaved changes.
- lookdown opens UTF-8 files only. Other encodings show an error instead of
  being opened and possibly damaged.

## Roadmap

1. ~~Open, edit and save one file, byte-exact~~ (done)
2. Live preview: render CommonMark + GFM (tables, task lists, strikethrough,
   autolinks) in place, including local images
3. Tabs and single instance: opening another file adds a tab to the running
   window; prompts before closing unsaved tabs; reload files changed on disk
4. Native polish: menu bar, `.md` file association, portable exe and installer

Windows is the first target; macOS follows.

Not planned: math, Mermaid, file trees, vaults, project-wide search, or
anything else that makes lookdown slower to start or harder to install.

## Building from source

lookdown is a [Tauri 2](https://tauri.app) app: a small Rust shell around a
TypeScript frontend using [CodeMirror 6](https://codemirror.net).

### Prerequisites

- Node.js (LTS) and pnpm
- Rust (stable)
- Windows: Visual Studio Build Tools with the C++ workload, and the WebView2
  runtime (preinstalled on Windows 10 and 11)

If you use [mise](https://mise.jdx.dev), `mise install` sets up Node, pnpm and
Rust from `mise.toml`.

### Commands

```powershell
pnpm install          # install frontend dependencies
pnpm tauri dev        # run with hot reload
pnpm tauri build      # release build + installers
pnpm test             # frontend tests (Vitest)
cargo test --manifest-path src-tauri/Cargo.toml   # Rust tests
```

To open a file while developing, pass it after two `--`, using an absolute path:

```powershell
pnpm tauri dev -- -- C:\path\to\notes.md
```

The release build lands in `src-tauri/target/release/lookdown.exe`, with
installers under `src-tauri/target/release/bundle/`.

### Project layout

| Path | What's there |
| --- | --- |
| `src/` | Frontend: editor, file decoding, byte-exact saving |
| `src-tauri/` | Rust shell: window, reading and writing files |
| `tests/fixtures/` | Byte-exact sample files (CRLF, mixed endings, BOM, …) |
| `docs/superpowers/` | Design notes and implementation plans |

## How byte-exact saving works

The editor holds the text with every line ending normalized to `\n`. lookdown
keeps the file's original text alongside and records every edit. On save it
rebuilds the file from the original: stretches you didn't edit are copied
verbatim, and only the edited parts are new. Line breaks you type use the
file's most common ending. A randomized test runs hundreds of random edit
sequences against the sample files to check that the saved file always matches what the
editor shows.

## License

[MIT](LICENSE)
