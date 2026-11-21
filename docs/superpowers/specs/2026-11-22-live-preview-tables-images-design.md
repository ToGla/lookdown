# Live preview, part 2 (tables and images): design

Status: approved 2026-11-22. Size: project. Roadmap step 2b;
builds on part 1 (`2026-11-21-live-preview-text-design.md`), whose rules still
apply (decorations only, byte-exact saving, reveal on first input, revealed
lines keep styling).

## Intent

Finish live preview: GFM tables render as a grid you edit in place, and local
images render inline. Tables are edited often, so editing must feel like
working in a table (click a cell, type, Tab to the next), not like editing
pipes. The file stays raw Markdown and saves stay byte-exact: a cell edit
changes only that cell's text.

## Goals

### Tables

- A GFM table always renders as a grid, also while the cursor is inside it.
  Header row bold, a border/rule under the header, cell borders. Column
  alignment from the delimiter row (`:--`, `:-:`, `--:`) is applied.
- Columns line up: every cell of a column has the same width; long cells wrap
  inside their cell (the row grows taller), the table is never wider than the
  text column.
- Inline Markdown inside cells (bold, italic, code, strikethrough, links)
  renders as in part 1 and reveals its syntax while the cursor is in that
  cell (cell-level reveal, not line-level, for table rows).
- Click a cell to place the cursor in it and type. Only that cell's text
  changes; padding in other cells is untouched, so raw source may drift out of
  alignment (accepted, byte-exact rule).
- Keys inside a table:
  - `Tab` / `Shift-Tab`: next / previous cell (wrapping across rows). `Tab`
    in the last cell appends a new empty row.
  - `Enter`: move to the same column in the next row (append a row if on the
    last row). No line breaks inside cells.
  - `ArrowUp` / `ArrowDown`: same column, previous / next row; at the first /
    last row they leave the table to the line above / below.
  - `ArrowLeft` / `ArrowRight` at a cell edge move to the neighbouring cell;
    at the table's first / last cell they leave the table.
  - Typing `|` inside a cell inserts `\|`.
- Right-click on a cell opens a small menu: Insert row above, Insert row
  below, Delete row, Insert column left, Insert column right, Delete column,
  Align column left / center / right, Edit as Markdown.
  - Header row can't be deleted; deleting the last body row is allowed.
  - Column operations edit every row and the delimiter row.
  - Edit as Markdown shows the table's raw lines (part 1 styling, no grid)
    until the cursor leaves the table.
- All structural edits are single undoable transactions that touch only the
  lines/cells they must.

### Images

- `![alt](path)` with a local path renders the image, resolved against the
  open file's directory (relative, `../`, and absolute paths; URL-encoded
  spaces `%20` decoded).
- Shown at natural size, never wider than the text column, as a block below
  the line that contains it (inline images in the middle of a paragraph also
  show as a block under that line).
- On the cursor's line the raw `![alt](path)` shows and the image stays
  visible under it, so a path fix is visible immediately.
- Missing/unreadable/unsupported file: a small placeholder with the alt text
  and "image not found".
- Formats: PNG, JPEG, GIF, WebP, SVG (SVG via `<img>`, so scripts don't run).
- Web images (`http:`/`https:`) are **not loaded**: placeholder with alt text
  and the URL; `Mod`+click on it opens the URL like a link (part 1 rules).
- Images reload when their path text changes; no file watching (step 3).

## Details settled after the builder check

- **Grid fallback (user's choice):** if long cells can't wrap cleanly inside
  their column with sane cursor behaviour, fall back to a no-wrap grid: a
  long cell widens its column and the table scrolls horizontally when wider
  than the text column. Everything else stays as designed.
- **Browser harness (Claude's call):** commit a small dev-only page
  (`dev/preview.html` + script) that mounts `createEditor` on a sample
  document via `pnpm dev`, so the grid and images can be checked in a browser
  without Tauri. It is not part of the production build (Vite only builds
  `index.html`). In-app GUI checks are done by the controller, not by
  implementer subagents.
- **Table shapes (Claude's call):**
  - Tables with or without leading/trailing pipes render and edit; new rows
    and columns copy the table's outer-pipe style.
  - Ragged rows render with empty cells to fill the header's column count.
    Column operations touch only the cells that exist; a row that lacks the
    target column is left alone.
  - `\|` and pipes inside inline code don't split cells (follow the parser's
    `TableCell` / `TableDelimiter` nodes, never split on `|` by hand).
  - Tables inside blockquotes or list items are out of scope for the grid:
    they keep part-1 rendering (raw lines, inline styling).
- **Images in hard cases (Claude's call):**
  - An image inside a table cell shows as a small alt-text chip in the cell,
    not as a block (keeps the grid intact).
  - An image inside a link (`[![a](b)](c)`) renders the image; `Mod`+click on
    it opens the link per part-1 rules.
  - Reference-style images (`![a][ref]`) resolve through the definition, like
    reference links.
  - Images in headings, list items and quotes render as a block under that
    line; several images on one line stack vertically in source order.
- **Image paths (Claude's call):** relative to the open file's directory;
  absolute paths (`C:\x.png`, `C:/x.png`, `/x.png`) and backslashes accepted;
  a `file://` prefix is stripped; `?query` and `#fragment` are stripped;
  `%20` and other percent-escapes decoded. Any local path may be read (local
  viewer). Files over 20 MB show the placeholder with "image too large"
  instead of being read. The open file's path is passed into the preview
  when the editor is created (`livePreview` option); tabs and save-as come
  with step 3.
- **Reveal and keys (Claude's call):** cell-level reveal waits for the first
  input like everything else, so a file opens fully rendered. Table keys work
  whenever the cursor is in a table (before or after first input). The table
  keymap has priority over `defaultKeymap` only inside a table; outside a
  table Tab and Enter keep their current behaviour. Leaving a table by
  keyboard uses the arrow keys (or Escape, which moves the cursor to the line
  after the table).
- **New rows and columns (Claude's call):** a new cell is written as one
  space of content padding (`|  |`); a new column's delimiter cell is `---`
  (with colons if an alignment is set later). New rows use the file's line
  ending via the existing save path (the buffer is normalized).

## Non-goals

Sorting, merged cells, column resize by dragging, pasting spreadsheet data,
creating a new table from scratch via UI, keyboard shortcuts for row/column
operations, image zoom/lightbox, image resizing syntax, loading web images,
watching image files for changes, HTML `<img>` tags.

## Anti-goals

- Any re-serialization of a table (re-padding columns, normalizing pipes or
  the delimiter row) other than the lines/cells an edit must touch.
- Network access when opening a file.
- A table editing model that diverges from the buffer (the grid is a view of
  the raw lines, never a separate copy).

## Constraints

- From CLAUDE.md and part 1: CodeMirror 6, TypeScript, no UI framework, thin
  Rust, cross-platform (`Mod-`, no Windows-only paths), lightweight.
- No new dependencies expected. Images are read through the existing
  `read_file` command (bytes → `Blob` → object URL, revoked when no longer
  shown); the CSP gains only `img-src 'self' blob:`. No Tauri asset protocol.
- Decorations stay built for `view.visibleRanges` where CodeMirror allows;
  anything that must come from a `StateField` (block widgets) is limited to
  what it needs.

## Approaches (tables)

- **A. Real text dressed as a grid (chosen).** Table lines stay normal
  editor lines. Pipes, padding and the delimiter row are hidden with
  decorations; each cell's text is wrapped in a mark styled as a fixed-width
  box, widths measured per column, so rows line up as a grid. Cursor,
  selection, undo, IME, spellcheck and copy/paste are native; every edit is
  byte-exact by construction. Tab/Enter/arrows/menu are commands on raw
  lines. Risk: visual (alignment with a proportional font, wrapping long
  cells), not data. Lightest, reuses part 1.
- B. Real HTML table with contenteditable cells. Perfect layout, but each
  cell is a second editing surface synced back by hand (cursor, undo, IME,
  inline styling): most bug and byte-exact risk.
- C. HTML table with a nested CodeMirror editor per cell (Obsidian-like).
  Perfect layout and per-cell live preview, but heavy (one editor per cell)
  with complex focus/undo plumbing. Against "lightweight".

User picked A.

## Decisions taken in conversation

- In-grid cell editing (not reveal-as-source); tables are commonly edited.
- Row/column management through a right-click menu (no shortcuts).
- Behaviour list above (Tab, Enter, `\|`, Edit as Markdown) proposed by
  Claude and accepted.
- Web images not loaded; local images only.
- Image behaviour (natural size capped to column, raw line + image on the
  cursor line, placeholder) proposed by Claude and accepted.

## Left to the builder

- How column widths are measured and applied (e.g. measure rendered cell
  content per column and set widths via CSS variables), as long as columns
  align and long cells wrap. The first plan task must prove the grid layout
  and cursor behaviour in the browser harness before the rest builds on it.
- How the open file's path reaches the preview (e.g. a `livePreview` option).
- Image cache and object-URL lifetime details.
- Menu markup and styling (plain DOM, follows the existing look, light/dark).
- Where table commands live and how they find the cell under the cursor.
