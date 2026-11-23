# New file: design

Status: approved 2026-11-23. Size: small change.

## Intent

The user often starts a new project by writing down its main idea in a
Markdown file. Today lookdown only opens files that already exist, so they
have to make the file in a terminal first, which is a clumsy detour. lookdown
should be able to create the file itself.

## Goals

- **New file command.** `Mod-n`, "New…" in the macOS File menu (above Open…),
  and a hint on the empty page ("Create a file with ⌘N / Ctrl+N, open one
  with ⌘O / Ctrl+O, or drop one here.").
- The command opens the native **save dialog**:
  - Markdown filter (`md`, `markdown`), default name `untitled.md`.
  - Starts in the active tab's folder when a tab is open. Otherwise the OS
    default.
  - The dialog's own "New Folder" button (macOS and Windows) covers creating
    the project folder in the same step.
- On confirm, lookdown creates an **empty file** (0 bytes) at that path and
  opens it through the normal open path (`openPaths`). It is a regular tab
  from then on: clean, watched, saved with `Mod-s`, with relative images
  resolved against its folder.
- Cancel does nothing.

## Non-goals

- Untitled or pathless tabs, and "save later".
- Save As, templates, or default content in the new file.
- Picking line endings or BOM. An empty file has neither, so the first save
  writes LF without a BOM (what `makeBase` already defaults to).

## Anti-goals

- **Never destroy an existing file.** The native dialog warns when the chosen
  name exists and the user may confirm "Replace". lookdown still does not
  empty that file: creating fails if the file exists, and lookdown then just
  opens it (or focuses its tab if it is already open), with a status line
  saying "<name> already exists; opened it."
- Nothing that slows startup or adds a dependency.

## Approaches

1. **Ask first (chosen).** Save dialog → create an empty file → open it as a
   normal tab. Every path-keyed feature (dedup, watching, titles, images,
   close prompts) works unchanged.
2. **Untitled tab, save later.** No friction before typing, but every
   path-keyed part of the app needs a pathless case, and images can't
   resolve until the first save. Rejected: much larger, and it works against
   "lightweight, simple".
3. **In-app "name + folder" form.** Rejected: it would duplicate the native
   dialog, but worse.

The user picked 1: "completely sufficient".

## Design

- **Rust (`files.rs`):** a new `create_file(path)` command that opens with
  `OpenOptions::new().write(true).create_new(true)`. It returns `Ok(true)`
  when created, `Ok(false)` when the file already exists, and an error
  otherwise (e.g. no permission). Because `create_new` is atomic, two
  processes can't race to create the same file. Register it in `lib.rs` and
  add a wrapper in `native.ts`.
- **Capability:** add `dialog:allow-save` to `capabilities/default.json`.
- **Host:** `pickNewFile(defaultDir?: string): Promise<string | null>` (wraps
  the dialog plugin's `save`) and `createFile(path): Promise<boolean>`, plus
  fakes in `test-host.ts`.
- **App:** add `"new"` to `COMMANDS` / `Command`, `keyCommand` maps `Mod-n`,
  and `run("new")` does: pick → create → `openPaths([path])`. If the file
  existed, it also shows the status line above. On an error it shows "Could
  not create <path>: <error>". The key handler calls `preventDefault` (macOS
  menu accelerator rule).
- **Menu (`menu.rs`):** add `"new"` to `COMMANDS` and a `New…` item with
  `CmdOrCtrl+N` at the top of File.
- **Extension (user's call):** if the chosen file name has no extension,
  lookdown appends `.md` (`idea` → `idea.md`). "No extension" means the
  file name has no `.` after its first character, so `.notes` becomes
  `.notes.md`. A name with any other extension (`idea.txt`) is kept as
  typed. The dialog's overwrite warning only checked the name without
  `.md`, so the appended path can still exist. The `create_file` guard
  covers that: lookdown opens the existing file unchanged, as above. The
  logic is a pure helper in the frontend (e.g. `withMarkdownExtension` in
  `src/tabs/paths.ts`), because the dialog may return the name either way
  on either OS.

## Left to the builder

- Exact status wording, and where the empty-page hint wraps.
- Whether `create_file` gets a `check_local`-style guard. Probably not: like
  `file_stamp`, it only receives paths the user picked in a dialog.

## Testing

- Rust: `create_file` creates an empty file, returns `false` for an existing
  one and leaves its bytes untouched, and errors in a missing directory.
- Frontend (test host): `Mod-n` → the picked path opens as a clean tab; a
  cancel does nothing; an existing path opens unchanged with the status line;
  an existing *open* path focuses its tab; a create error shows a status.
  Also test the `keyCommand` mapping for `Mod-n` on mac and non-mac.
- Extension helper: `idea` → `idea.md`; `idea.md`, `idea.markdown` and
  `idea.txt` are unchanged; `.notes` → `.notes.md`; a dot only in a folder
  name (`my.project/idea`) → `my.project/idea.md`, on both `/` and `\`
  paths. `Mod-n` with `idea`, where `idea.md` already exists, opens the
  existing file unchanged.
- Manual, on both WebView2 and WebKit: the dialog's New Folder flow, the
  menu item firing once, and typing then `Mod-s` writing LF.
