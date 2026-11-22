# lookdown

A lightweight Markdown viewer and editor for quickly opening and editing a
Markdown file, then getting out of your way.

> **Status: early development.** lookdown opens files in tabs, edits them with a
> live preview of text, blocks, tables and images, and saves them. It ships as a
> Windows installer and a portable exe. A macOS build is next (see
> [Roadmap](#roadmap)).

## Why lookdown

Most Markdown editors are either full note-taking apps with vaults and sidebars,
or rich-text editors that rewrite your file when they save it. lookdown aims to
be neither:

- **Lightweight.** A single small executable (about 3.4 MB) using the system
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
editing.

## Using it

### Requirements

Windows 10 or later. The WebView2 runtime it needs is built into Windows.

### Install

There are no prebuilt downloads yet: build the setup from source (below), then
run `lookdown_<version>_x64-setup.exe`. It needs no admin rights, installs for
your user only and registers `.md` and `.markdown` files for "Open with".

lookdown does not take over `.md` files by itself. To make it the default,
right-click a `.md` file, choose Open with, Choose another app, pick lookdown
and select Always.

**Portable:** copy `lookdown.exe` anywhere and run it. Nothing is registered.

**Update:** close lookdown, then run the new setup (it upgrades in place) or
replace the portable exe.

**Uninstall:** Windows Settings, Apps. Afterwards you can delete the webview
data folder `%LOCALAPPDATA%\io.github.togla.lookdown` (the uninstaller offers
to).

**SmartScreen:** the exe is unsigned, so Windows may warn on first run. Choose
"More info", then "Run anyway".

### Opening files

Open a file from the command line:

```powershell
lookdown notes.md
```

- One window with tabs. Running `lookdown other.md` while it is open adds a tab
  to that window, and opening a file that is already open switches to its tab.
- `Ctrl+O` (`Cmd+O`) opens files. You can also drop files onto the window.
  On Windows this replaces dragging text inside the editor.
- `Ctrl+W` (`Cmd+W`) closes the tab. `Ctrl+Tab` / `Ctrl+Shift+Tab` (or `Ctrl+PageDown` /
  `Ctrl+PageUp`) switch tabs.
- `Ctrl+S` (`Cmd+S` on macOS) saves. A `•` on a tab and in the window title
  means unsaved changes. There is no autosave.
- Closing a tab with unsaved changes asks Save, Don't save or Cancel. Closing
  the window asks once, listing every unsaved tab.
- If a file changes on disk, a tab without unsaved changes reloads silently.
  With unsaved changes, a bar at the top warns you and lets you keep your
  version or reload the file. A `!` on a background tab means it needs a look.
- Live preview renders headings, emphasis, lists, quotes, code and links in
  place. The syntax reappears on the line you are editing.
- `Ctrl`+click (`Cmd`+click on macOS) on a web or mail link opens it. Other
  link types are ignored.
- Task list checkboxes are clickable.
- Tables render as a grid. `Tab`/`Shift+Tab` move between cells, `Enter`
  moves down (adding a row at the end), and a right-click menu inserts,
  deletes and aligns rows and columns.
- Local images (PNG, JPEG, GIF, WebP, SVG) render under their line, resolved
  against the file's folder, at natural size capped to the text column. Web
  images show their URL and load on request (right-click, Load image);
  `Ctrl`+click opens it.
  Files over 20 MB show a placeholder instead.
- lookdown opens UTF-8 files only. Other encodings show an error instead of
  being opened and possibly damaged.

## Roadmap

1. ~~Open, edit and save one file, byte-exact~~ (done)
2. ~~Live preview: render CommonMark + GFM (tables, task lists,
   strikethrough, autolinks) in place, including local images~~ (done)
3. ~~Tabs and single instance: opening another file adds a tab to the running
   window; prompts before closing unsaved tabs; reload files changed on disk~~
   (done)
4. ~~Native polish: `.md` file association, portable exe and installer~~
   (done; Windows keeps a menu-less window)
5. macOS build, with a native menu bar

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

The release build lands in `src-tauri/target/release/lookdown.exe`, with the
setup under `src-tauri/target/release/bundle/nsis/`.

The app icon is generated from `src-tauri/icons/lookdown.svg`: run
`pnpm tauri icon src-tauri/icons/lookdown.svg` to regenerate it, then delete the
android, ios and Store logo files it also creates.

### Releasing

```powershell
pnpm release 0.2.0    # bumps package.json, Cargo.toml and Cargo.lock, commits, tags v0.2.0
pnpm tauri build
```

`pnpm release` refuses a dirty working tree, an invalid SemVer version or an
existing tag, and never pushes. If the version is unchanged it only tags.

Artifacts:

- `src-tauri/target/release/lookdown.exe`: the portable exe (3.4 MB)
- `src-tauri/target/release/bundle/nsis/lookdown_<version>_x64-setup.exe`: the
  per-user setup (1.3 MB)

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
