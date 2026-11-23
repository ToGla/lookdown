# Insert table: design

Status: approved 2026-11-23. Size: small change.

## Intent

Tables are the one structure the user can't start from the editor today.
Once a table exists, the table menu (right-click in a grid table) can add rows
and columns, but there is no way to create the first one without typing the
pipe syntax by hand. The user wants a command that inserts a starter table.

## Goals

- **Command "Insert Table":** `Mod-Shift-t` (Ctrl+Shift+T / ⌘⇧T) on both
  platforms, plus **Edit › Insert Table** in the macOS menu bar.
- **Inserts a 2-column table with one header row and one body row**, written
  in the style `appendRowText` already uses:

  ```
  |  |  |
  |--|--|
  |  |  |
  ```

- **Placement**, based on the line holding the main selection's head:
  - The line is blank (empty or whitespace only): the table replaces it.
  - Otherwise the table goes after that line.
  - A blank line always separates the table from non-blank text above and
    below (a table directly under a paragraph line is not parsed as a table).
    Lines that are already blank, and the start or end of the document, need
    no extra blank line.
  - Selected text is left as it is.
- **Cursor:** in the first header cell (`tableStart + 2`, like
  `blankRowCursor`).
- **Inside an existing grid table:** does nothing. The table menu covers that
  case.
- **Undo:** one transaction, so one `Mod-z` removes it.

## Non-goals

- A size picker, or column count, alignment and header options.
- Any change to right-click outside tables: the WebView's own menu (spelling,
  Look Up) stays.
- A Windows menu bar (Windows stays menu-less, so it only gets the shortcut).

## Anti-goals

- Touching any text other than the inserted table and its separating blank
  lines.
- A shortcut that collides with typing. `Mod-Alt-t` was rejected because
  Ctrl+Alt is AltGr on Windows, which types characters on many layouts.

## Approaches

1. **Native popup context menu** (Cut, Copy, Paste, Select All, Insert table).
   Rejected: it drops spelling and Look Up from right-click.
2. **Own HTML context menu.** Rejected: Paste from JavaScript prompts in
   WebKit and is unreliable in WebView2.
3. **Shortcut plus macOS menu item (chosen by the user).** Nothing is lost.
   It is less discoverable, so the README documents it.

## Design

- `insertTable(state: EditorState): TransactionSpec | null` in
  `src/preview/table-edit.ts`. It returns null inside a grid table
  (`tableAt(state, head)`).
- The app gets a `"table"` command: `keyCommand` maps `Mod-Shift-t` to it, and
  `run("table")` dispatches the spec on the shown view (with
  `scrollIntoView`, `userEvent: "input"`), then focuses the view. With no tab
  it does nothing.
- `menu.rs` gets a `"table"` command and an "Insert Table" item
  (`CmdOrCtrl+Shift+T`) in Edit, after Redo.
- The README gets a line next to the other shortcuts.
