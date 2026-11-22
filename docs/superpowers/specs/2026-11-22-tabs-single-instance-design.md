# Tabs and single instance: design

Status: approved 2026-11-22. Size: project. Roadmap step 3.
Builds on steps 1–2: byte-exact saving (`src/document.ts`, `src/file/*`),
live preview (`src/preview/*`). Their rules still apply.

## Intent

lookdown becomes a one-window, many-files viewer. Opening another Markdown
file while lookdown runs adds a tab instead of starting a second app.
Unsaved work is never lost silently, and files that change on disk while
open stay current. The app stays light and quick to start: nothing is
remembered between runs, and only the visible tab is rendered.

## Goals

### Opening files

- Four ways in, all through one open path:
  - command-line arguments at startup (one or more paths);
  - a second lookdown launch: it hands its arguments to the running
    instance and exits (single instance);
  - drag and drop of one or more files onto the window;
  - `Ctrl+O` (`Mod-o`): a native open dialog, filtered to Markdown
    (`.md`, `.markdown`) with an "All files" option, multiple selection
    allowed;
  - (the macOS open-file event is wired to the same path; macOS itself is a
    later step).
- Opening a file that is already open focuses its tab. Paths are compared
  after resolving (`notes.md`, `./notes.md` and a different case on Windows
  match).
- A newly opened file gets a new tab right after the active tab and becomes
  active. Several files opened at once keep their order; the last one is
  active.
- A file that can't be opened (unreadable, not UTF-8) opens no tab; the
  error is shown in the status line.
- New/untitled files and Save As are out.

### Empty window

- With no tabs (started without a file, or after closing the last tab) the
  window stays open and shows an empty page: "Open a file with Ctrl+O, or
  drop one here." The window title is "lookdown".

### Tab bar

- A thin strip above the editor. Each tab shows the file name, with `•` in
  front while it has unsaved changes, and a close button (×). Hover shows
  the full path. When two open files share a name, both tabs also show
  their parent folder (`notes.md — work`).
- More tabs than fit: the strip scrolls sideways; the active tab is kept in
  view. No wrapping, no drag to reorder.
- Click selects; middle-click or × closes.
- Keys: `Mod-w` closes the active tab; `Ctrl+Tab` / `Ctrl+Shift+Tab` and
  `Ctrl+PageDown` / `Ctrl+PageUp` go to the next / previous tab (wrapping).
- The window title shows the active file as today (`• notes.md — lookdown`).
- Each tab keeps its own undo history, cursor, selection, reveal state and
  scroll position across switches.

### Closing

- Closing a tab with unsaved changes asks with a native dialog: "Save
  changes to notes.md?" — Save, Don't save, Cancel.
- Closing the window (title-bar ×, `Alt+F4`, and a system shutdown only as
  far as Tauri's close-requested event reports it) with unsaved tabs asks once, listing every unsaved file:
  Save all, Discard all, Cancel. With nothing unsaved it closes at once.
- If a save fails during either prompt, nothing closes; the error shows in
  the status line and the failing tab is made active.

### Changes on disk

- Each open file is checked (modified time and size) every 2 seconds and
  immediately when the window regains focus.
- A tab without unsaved changes reloads silently. Cursor and scroll stay
  where they were as far as the new text allows. How undo treats a reload
  is left to the builder.
- A tab with unsaved changes shows a bar above the editor: "notes.md
  changed on disk." with Reload (discard your changes) and Keep yours.
  Keep yours hides the bar; the next save overwrites the disk version.
  The bar shows again only after a further change on disk.
- A deleted or moved file shows the same bar: "notes.md was deleted or
  moved." with Close tab and Keep. The tab keeps the text; saving writes
  the file back at its old path. A file that comes back is treated as a
  change on disk.
- lookdown's own saves never trigger the bar (the stamp after a save is
  recorded).
- A reload re-reads the file through the same decode path as opening;
  a file that becomes undecodable shows the bar with the error instead of
  reloading.

### Leftovers from step 2 (kept in this step)

- The table right-click menu and the Load image menu close when the
  document changes or the tab switches, so no menu acts on stale text.
- Local images that failed to load are retried when their file's tab
  reloads from disk and when the window regains focus.
- A web image whose load failed can be retried: its placeholder offers
  "Load image" again.

## Details settled after the builder check

- **Drag and drop (user's choice):** file drop wins. Tauri's native
  drag-drop handling stays on, which on Windows disables HTML5 drag and drop
  in the webview: dragging selected text to move it and dropping text from
  other apps into the editor stop working. Cut, copy and paste are
  unaffected.
- **Saving over an unseen disk change (Claude's call):** every save first
  re-checks the file's modified time and size. If they differ from what the
  tab last read or saved (a change the user hasn't accepted with Keep yours,
  or one inside the 2-second gap), a native dialog asks "notes.md changed on
  disk. Overwrite / Cancel". "Save all" in the window-close prompt asks the
  same per affected file; Cancel there cancels closing the window. An
  inactive tab with a pending disk change or deletion shows a marker (`!`)
  in the tab strip.
- **Deleted file counts as unsaved (Claude's call):** once a tab's file is
  deleted or moved, the tab counts as having unsaved changes even if its
  text is unchanged: it shows `•`, closing it prompts, the window-close
  prompt lists it, and Save / Save all write the file back at its old path.
- **Shutdown (Claude's call):** best effort — only what Tauri's
  close-requested event reports. No Windows-only end-of-session code.
- **Menu bar (Claude's call):** not in this step (roadmap step 4). Open,
  Close tab, Next / Previous tab are named frontend commands bound to keys
  that also work in the empty window; step 4's menu will call the same
  commands.
- **`.md` file association (Claude's call):** not in this step (step 4).
  Single instance is verified by launching from the command line.

## Non-goals

Session restore (reopening last run's tabs), recent-files list, new/untitled
files, Save As, tab drag-reorder, split views, multiple windows, tabs for
non-Markdown files beyond opening them as text, watching folders, the native
menu bar and the `.md` file association (both step 4), Windows-only
shutdown handling, in-editor text drag and drop on Windows.

## Anti-goals

- Losing unsaved work without a prompt (close, reload, quit).
- A changed-on-disk reload that touches a dirty tab without the user's
  choice.
- Startup slowed by restoring anything, or memory that grows with every
  rendered tab.
- Any change to byte-exact saving: a reload replaces the document's base;
  edits still save as minimal diffs.

## Constraints

- From CLAUDE.md: Tauri 2, thin Rust, TypeScript without a UI framework,
  CodeMirror 6, cross-platform (`Mod-` keys, no Windows-only paths).
- New dependencies: `tauri-plugin-single-instance` and
  `tauri-plugin-dialog` (plus its JS package). No file-watcher crate.
- One new Rust command for the disk check (modified time and size of a
  path), following `file_size`'s style; it must not touch UNC/device paths
  any more than reading the document already does.
- Capabilities grow only by what close handling, the dialog plugin and
  drag-drop need.

## Approaches

### Tabs and editors

- **A. One `EditorView`, one `EditorState` per tab (chosen).** Switching
  swaps state (`setState`); scroll restored with the view's scroll
  snapshot. Only the active tab is rendered: light, and view-level things
  (menus, image loads) reset naturally on switch.
- B. One `EditorView` per tab, inactive ones hidden. Instant switches and
  scroll for free, but every tab keeps its rendered DOM and listeners.

### Noticing changes on disk

- **A. Poll modified time and size every 2 s and on window focus
  (chosen).** One tiny command, no dependency, handles rename-style saves
  and deletions; up to 2 s delay, none on returning to the window.
- B. A file watcher (`notify` crate). Instant, but a dependency, parent-
  folder watching for rename-style saves, and unreliable on network drives.

User picked A and A.

## Decisions taken in conversation

- Ways to open: command line, second instance, drag and drop, `Ctrl+O`
  native dialog (user chose B + C). No new files, no Save As.
- Closing the last tab leaves an empty window with a hint (user's choice).
- No session restore (user's choice).
- Tab bar, close prompts and changed-on-disk bar as proposed by Claude
  (no objection raised).
- Tabs: one view, state per tab. Disk changes: polling. (User's choices.)
- File drop over in-editor text drag on Windows (user's choice).

## Left to the builder

- How `OpenDocument` and a tab's `EditorState` are grouped, and how a
  reload replaces both the document base and the editor text (one
  transaction replacing the text, kept out of undo history or not — pick
  what keeps undo sane and say why).
- Path normalization for "already open" (Windows case-insensitivity,
  `..`, separators) without OS calls beyond what reading needs.
- Tab bar markup and styling (plain DOM, light/dark, follows the existing
  look).
- How the window-close request is intercepted and confirmed (Tauri window
  close-requested event) and which capability permissions that needs.
- How the second instance's arguments and drag-drop paths reach the
  frontend (plugin callback → event).
