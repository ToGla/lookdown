# Open, edit and save one file, byte-exact: design

Status: approved 2026-11-21 (user picked approach A and said to go ahead). Size: project.

## Intent

The first real feature, and the base for everything after it: open one Markdown
file given on the command line, edit it in a plain CodeMirror 6 editor, save
with `Mod-s`. Saving must never re-serialize: untouched bytes stay identical,
so a save produces a git diff of exactly the edited lines.

## Goals

- `lookdown <path>` opens the file; relative paths resolve against the
  process working directory.
- Plain CodeMirror 6 editor (no Markdown rendering yet), line wrapping, undo.
- `Mod-s` saves. Window title `<name> — lookdown`, prefixed `• ` when dirty.
  Undoing back to the saved text makes the tab clean again.
- Byte-exact round-trip for every UTF-8 file: LF, CRLF, lone CR, mixed, with or
  without BOM, with or without a final newline, empty.
- Deferred review items: `withGlobalTauri` off, a real CSP.

## Non-goals

Live preview, tabs, single instance, close prompts, file watching, Open
dialog, menu bar, non-UTF-8 encodings. (Close prompts land with tabs in step 3.)

## Constraints

- From CLAUDE.md: never re-serialize; preserve BOM and line endings; byte-exact
  fixtures under `tests/fixtures/` (`-text` in `.gitattributes`).
- Rust stays thin: read bytes, write bytes, hand over the startup path.
- Cross-platform: no Windows-only path handling (basename splits on `/` and `\`).

## Approaches (for mixed line endings)

- **A. Exact for every file (chosen).** Keep the original decoded text. Track
  the CodeMirror changes since open/save. On save, copy unchanged stretches
  from the original text and write newly typed line breaks with the file's
  dominant ending. One code path for all files; also the base for safe reloads
  later.
- B. Normalize mixed files on first save. Simpler, but the first save rewrites
  every minority ending.
- C. Open mixed files read-only. Safe, but the files can't be edited.

## Design

- **Codec (frontend):** bytes → `{ text, bom }` via `TextDecoder("utf-8",
  { fatal: true, ignoreBOM: true })`, stripping a leading UTF-8 BOM by hand.
  UTF-16 BOMs and invalid UTF-8 give an error ("lookdown only opens UTF-8
  files"). Encode is `TextEncoder` plus the BOM if there was one. Valid UTF-8
  decode/encode is lossless.
- **Line map:** CodeMirror's default splits lines on CRLF, CR and LF. From the
  original text build per-line raw start offsets so any normalized offset maps
  to a raw offset. Dominant ending = most frequent of LF/CRLF/CR; ties and
  no-line-break files use LF.
- **Save:** compose every transaction's `ChangeSet` since the base. Walk it:
  gaps copy raw text between mapped offsets; inserted text has `\n` replaced
  by the dominant ending. After a successful write the written text becomes
  the new base and the change set resets.
- **Dirty:** `!doc.eq(savedDoc)`. `Mod-s` on a clean document writes nothing.
- **Rust:** `initial_path` (from args, resolved), `read_file` (raw bytes as
  `tauri::ipc::Response`), `write_file(path, contents: Vec<u8>)` with
  `std::fs::write`.
- **UI:** editor fills the window; a status line shows errors (unreadable file,
  not UTF-8, save failed) and, with no file given, how to open one.
- **Security:** `withGlobalTauri: false`; CSP
  `default-src 'self' ipc: http://ipc.localhost; style-src 'self' 'unsafe-inline'`
  (CodeMirror injects styles); grant `core:window:allow-set-title`.

## Left to the builder

Module boundaries, test fixture names, exact status wording, CSP tweaks needed
for Tauri's style nonce handling (verify CodeMirror renders with no CSP errors).
