# Live Preview (Tables and Images) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** GFM tables render as an editable grid made of the raw table lines, and local images render as blocks under their line, with byte-exact saving intact.

**Architecture:** Table lines stay ordinary editor lines. Decorations hide pipes, padding and the delimiter row and wrap each cell's text in a `cm-ld-cell` mark. CSS lays the lines out as table rows (`display: table-row`) and the marks as table cells, so the browser aligns the columns and wraps long cells. Table keys and right-click commands are pure functions over a parsed `TableInfo`, which returns transaction specs. Images come from a `StateField` of block widgets (CodeMirror allows block widgets only from a field); their bytes come over IPC and are shown through object URLs.

**Tech Stack:** TypeScript, CodeMirror 6 (`@codemirror/view`, `state`, `language`, `lang-markdown`), Vitest (node, no DOM), Tauri 2 (one new thin command).

**Spec:** `docs/superpowers/specs/2026-11-22-live-preview-tables-images-design.md` (builds on `2026-11-21-live-preview-text-design.md`)

## Global Constraints

- Byte-exact: an edit changes only the cells or lines it must. No re-padding, no normalizing pipes or the delimiter row. `src/file/*` and `src/document.ts` stay untouched.
- Cells come from the parser:
  - Rows are `TableHeader` and `TableRow`. The delimiter row is a `TableDelimiter` child of `Table` that spans the line.
  - Cell boundaries are a row's `TableDelimiter` children. An empty cell has no `TableCell` node.
  - Never split a row on `|` by hand. Only the delimiter row, which has no escapes, may be split by hand.
  - Per GFM, `\|` doesn't split a cell but a `|` inside inline code does. Follow the parser.
- Grid tables are `Table` nodes whose parent is `Document`. Tables inside quotes or lists keep the part-1 rendering.
- The table always renders as a grid, even when revealed. Pipes, padding and the delimiter row are hidden with `emit.conceal`, which ignores reveal. Inline syntax inside a cell reveals per cell.
- Cell-level reveal and every other reveal wait for the first input (`revealEnabled`). Table keys work regardless of reveal.
- New cell text is `  ` between pipes (`|  |`), and a new delimiter cell is `---`. New rows copy the table's outer-pipe style. The buffer always uses `\n`; the save path restores CRLF.
- Images:
  - Local images only. No network access.
  - Formats: PNG, JPEG, GIF, WebP and SVG (shown in an `<img>`).
  - The cap is 20 MB, `20 * 1024 * 1024` bytes.
  - CSP gains exactly `img-src 'self' blob:`.
- Placeholder copy: `{alt} — image not found`, `{alt} — image too large`, and for web images `{alt} — {url}`. When alt is empty, drop `{alt} — `.
- No new npm or cargo dependencies. One new Tauri command, `file_size`.
- Decoration specs keep the `ld` tag (`"hide"`, `"mark"`, `"line"`, `"widget"`), and classes keep the `cm-ld-` prefix.
- Commands:
  - `pnpm test` runs the frontend tests.
  - `cargo test --manifest-path src-tauri/Cargo.toml` runs the Rust tests.
  - `pnpm build` runs `tsc` and the Vite build.
- GUI checks in the browser harness (`pnpm dev`, then `http://localhost:1420/dev/preview.html`) are done by the controller after a task, not by implementer subagents.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Emptying a cell and typing again.** Deleting all of a cell's text and typing again keeps the cell and puts the text between its pipes, with every other byte unchanged. Test in Task 3.
2. **A half-typed table** (`| a |` alone, `| a |\n|--`, or a header with no body) renders as part 1 until the parser sees a table, and nothing throws. Test in Task 1.
3. **Undo of a structural edit** restores the exact bytes, including ragged rows and tables without outer pipes. Test in Task 4.
4. **A table at the very start or end of the document:**
   - Tab and Enter on the last row append a row.
   - ArrowUp on the first row of a table at the start of the document stays put.
   - Escape at the end of the document adds a line. Test in Task 3.
5. **Windows image paths:**
   - backslashes, `C:\`, spaces as `%20`, `..`;
   - a doc path with backslashes resolves to a path Rust can read;
   - a bad `%` escape doesn't throw. Test in Task 6.

---

### Task 1: Table model and grid rendering, proven in a browser harness

**Files:**
- Create: `src/preview/table-model.ts`, `src/preview/table-model.test.ts`, `src/preview/tables.ts`, `src/preview/tables.test.ts`, `dev/preview.html`, `dev/preview.ts`, `dev/sample.md`
- Modify:
  - `src/preview/decorations.ts`: add `conceal`, `point` and the table handler.
  - `src/preview/widgets.ts`: add `EmptyCellWidget`.
  - `src/preview/plugin.ts` registers `rawTable`.
  - `src/preview/test-helpers.ts` adds `rawTable` to `mdState` and a `point` case to `describeDecorations`.
  - `src/styles.css`

**Interfaces:**
- Produces, in `table-model.ts`:
  ```ts
  export type Align = "left" | "center" | "right" | null;
  /** from/to: between the cell's delimiters (or line start/end). textFrom/textTo: trimmed text;
   *  for a blank cell both equal min(from + 1, to). */
  export interface Cell { from: number; to: number; textFrom: number; textTo: number }
  export interface Row { from: number; to: number; cells: Cell[] }   // a line
  export interface TableInfo {
    from: number; to: number;
    rows: Row[];                 // rows[0] is the header, then body rows; the delimiter row excluded
    delimiter: Row;              // cells split on `|` by hand
    aligns: Align[];             // one per delimiter cell
    columns: number;             // header cell count
    outerPipes: boolean;         // header line, trimmed, starts with `|`
  }
  export function isGridTable(node: SyntaxNode): boolean;                 // Table whose parent is Document
  export function tableFromNode(state: EditorState, table: SyntaxNode): TableInfo;
  export function tableAt(state: EditorState, pos: number): TableInfo | null; // grid tables only, not raw
  export function cellAt(table: TableInfo, pos: number): { row: number; col: number } | null; // pos within [cell.from, cell.to]
  export const editAsMarkdown: StateEffectType<number>;                  // the table's `from`
  export const rawTable: StateField<number | null>;                      // that table's `from`, mapped through changes
  ```
  - `rawTable` resets to null when a transaction leaves no selection head inside that table, or when the table is gone.
  - `tableAt` returns null for the table `rawTable` points at.
- Produces, in `decorations.ts`:
  - `Emit.conceal(from: number, to: number): void` hides like `hide`, but ignores reveal (`ld: "hide"`, split per line).
  - `Emit.point(w: WidgetType, pos: number): void` adds a zero-length `Decoration.widget({ widget: w, side: 1, ld: "widget" })`.
- Produces, in `widgets.ts`: `EmptyCellWidget` (`name = "empty-cell"`), a `span.cm-ld-cell` with no text.
- CSS classes:
  - lines: `cm-ld-tr`, `cm-ld-th` (header) and `cm-ld-tdelim` (delimiter row);
  - marks: `cm-ld-cell`, plus `cm-ld-align-center` or `cm-ld-align-right` from `aligns`.

- [ ] **Step 1: Write the failing tests.** `table-model.test.ts` uses `mdState`:
  - `cells from pipes`: on `"| a | b |\n|:--|--:|\n| c \\| d | e |\n|  | |"`, check:
    - `columns` is 2 and `outerPipes` is true;
    - `aligns` is `["left","right"]`;
    - row 1 cell 0 text is `c \| d`;
    - row 2 has 2 blank cells, the first with `textFrom === textTo === from + 1`.
  - `no outer pipes`: on `"a | b\n--|--\nc | d"`, `outerPipes` is false and cell 0 of row 1 runs from line start to before `|`.
  - `ragged row`: on `"| a | b |\n|---|---|\n| c |"`, row 1 has 1 cell and `columns` is 2.
  - `quoted table is not a grid`: on `"> | a |\n> |---|\n> | b |"`, `tableAt(state, at(state,"b"))` is null.
  - `cellAt`: a pos on `e` returns `{row:1,col:1}`, and a pos on the delimiter line returns null.
  - `rawTable`: after `editAsMarkdown.of(t.from)`, `tableAt` is null. A selection moved outside the table resets it to null.

  `tables.test.ts` uses `describeDecorations(buildDecorations(...))`:
  - `grid lines`: the header line is `line cm-ld-tr cm-ld-th`, the delimiter line `line cm-ld-tr cm-ld-tdelim` and the body `line cm-ld-tr`. Emit two separate line decorations if that's simpler; then assert both.
  - `pipes and padding hidden, text marked`: in `"| a | b |\n|---|---|\n| c | d |"`:
    - `mark cm-ld-cell` covers exactly each of `a`, `b`, `c`, `d`;
    - every other non-newline character of the three lines is inside a `hide`.
  - `concealed even when revealed`: with the cursor on `c` and `reveal: true`, the pipe hides are still there.
  - `alignment classes`: `:-:` gives `cm-ld-cell cm-ld-align-center` and `--:` gives `cm-ld-align-right`.
  - `blank and missing cells`:
    - for `|  |`, the cell mark covers the second space;
    - for a ragged row, one `widget empty-cell` sits at the row end per missing column;
    - for `||`, one `empty-cell` widget appears.
  - `inline styling inside cells still renders`: `| **x** |` gives `mark cm-ld-strong` and hides `**`.
  - `quoted table keeps part 1`: no `cm-ld-tr` and no `cm-ld-cell`.
  - `half-typed table` (Review Focus 2): for `"| a |"`, `"| a |\n|--"` and `"| a |\n|---|"`:
    - build without throwing;
    - `cm-ld-tr` appears only where the parser returns a `Table`.
  - `raw table`: with `rawTable` set to that table, no `cm-ld-tr`.
- [ ] **Step 2: Run** `pnpm test src/preview/table-model.test.ts src/preview/tables.test.ts`. Expected: FAIL (modules missing).
- [ ] **Step 3: Implement** `table-model.ts`, `Emit.conceal`, `Emit.point`, `EmptyCellWidget`, and a `Table` handler in `tables.ts` merged into `handlers` in `decorations.ts`.
  - The handler returns nothing (not `false`), so the inline handlers still run inside cells.
  - Clamp line output to `emit.range` like `eachLine` in `blocks.ts`.
  - Per cell, the marked span is `[textFrom, blank ? to : textTo]`. If that span is empty, emit `point(EmptyCellWidget)` at `textFrom`. Everything else on a row line is concealed.
  - The delimiter row's whole line is concealed.
- [ ] **Step 4: CSS, in `src/styles.css`:**
  - `#app .cm-line.cm-ld-tr { display: table-row }`. Consecutive rows form one anonymous table, so the columns align and the table fits the column.
  - `.cm-ld-cell`:
    - `display: table-cell`;
    - padding `0.2em 0.6em`;
    - a 1px border in `color-mix(in srgb, currentColor 25%, transparent)`;
    - `vertical-align: top`;
    - `min-width: 1.5em`.
  - `cm-ld-th .cm-ld-cell`: bold, with a 2px bottom border.
  - `cm-ld-tdelim`: `font-size: 0; line-height: 0`.
  - Alignment classes set `text-align`.
- [ ] **Step 5: Harness.**
  - `dev/preview.html` copies `index.html` but loads `/dev/preview.ts`.
  - `dev/preview.ts` mounts `createEditor` on `dev/sample.md`, imported with `?raw`, using the current `createEditor` signature with no-op callbacks.
  - `dev/sample.md` contains:
    - a 3×4 aligned table;
    - a table whose cells hold long text that must wrap;
    - a table without outer pipes;
    - a ragged table;
    - a table in a quote;
    - inline styling in cells;
    - `\|`.
  - Add `"dev"` to `tsconfig.json` `include` so `pnpm build` typechecks it. Vite still builds only `index.html`.
- [ ] **Step 6: Run** `pnpm test` and `pnpm build`. Expected: all tests PASS and the build succeeds.
- [ ] **Step 7: Commit** with the message `feat: render GFM tables as a grid`.
- [ ] **Step 8 (controller gate): open the harness** and check:
  - columns align;
  - long cells wrap inside their column and the table stays within the text column;
  - clicking a cell puts the cursor in it and typing edits that cell;
  - the cursor draws at the right place in a wrapped cell;
  - the delimiter row takes no height.

  **If `display: table-row` lines break CodeMirror** (wrong cursor or heights):
  - switch the cells to `display: inline-block` with widths from a measure pass (a `ViewPlugin` that reads each column's natural widths and sets `--ld-col-N` on the table's lines);
  - if wrapping still misbehaves, use the user's fallback: `white-space: nowrap` cells, with the editor scrolling sideways for wide tables.

  Record the outcome in the ledger before Task 2.

### Task 2: Cell-level reveal

**Files:**
- Modify: `src/preview/reveal.ts`, `src/preview/reveal.test.ts`

**Interfaces:**
- Consumes: `tableAt` and `cellAt` (Task 1).
- Produces: `revealedRanges` narrows a selection range to cells when both of its ends are in the same row of a grid table. The range then spans `[cell(from).from, cell(to).to]`. Otherwise the ranges are line-level, as before.

- [ ] **Step 1: Write the failing tests** with `"| **a** | *b* |\n|---|---|\n| c | d |"` and `reveal: true`:
  - `cursor in a cell reveals only that cell`: with the cursor in `a`, the hides of `**` are dropped, the `*` hides around `b` stay, and the pipe hides stay.
  - `selection across two cells of a row`: both cells reveal.
  - `selection across rows`: whole lines reveal, and pipes stay concealed.
  - `raw table reveals by line`: with `rawTable` set, the cursor in `a` reveals the whole line and the pipes show.
  - `before first input nothing reveals`.
- [ ] **Step 2: Run** `pnpm test src/preview/reveal.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the narrowing in `revealedRanges`, applied to each selection range before the multi-line-unit growth.
- [ ] **Step 4: Run** `pnpm test`. Expected: PASS.
- [ ] **Step 5: Commit** with the message `feat: reveal inline syntax per table cell`.

### Task 3: Table navigation keys and `|` escaping

**Files:**
- Create: `src/preview/table-keys.ts`, `src/preview/table-keys.test.ts`
- Modify: `src/preview/plugin.ts`, which adds `Prec.high(keymap.of(tableKeymap))` and the input handler to `livePreviewPlugin`.

**Interfaces:**
- Consumes: `tableAt`, `cellAt`, `TableInfo` (Task 1).
- Produces, all `(state: EditorState) => TransactionSpec | null` (null means not in a grid table, or not applicable). Each acts on `selection.main.head`.
  - `nextCell` (Tab) and `prevCell` (Shift-Tab).
    - Both go to the end of the target cell's text, in reading order, skipping the delimiter row.
    - Tab in the last cell appends a row and lands in its first cell.
    - Shift-Tab in the first cell returns `{}`, a no-op that keeps focus.
  - `nextRow` (Enter) goes to the same column in the next row, at the end of the text. On the last row it appends a row first.
  - `moveVertical(state, dir: -1 | 1)`:
    - goes to the same column, keeping the character offset into the text, clamped to the text's length;
    - from the first row going up, it goes to the end of the line above the table, or returns `{}` when there is none;
    - from the last row going down, it goes to the start of the line below, or returns `{}`.
  - `moveHorizontal(state, dir: -1 | 1)`:
    - returns null unless the head is at its cell's `textFrom` (dir -1) or `textTo` (dir 1);
    - otherwise it goes to the neighbouring cell's `textTo` (going left) or `textFrom` (going right), wrapping across rows;
    - past the first or last cell it leaves the table, like `moveVertical`.
  - `leaveTable` (Escape) goes to the start of the line after the table. At the end of the document it inserts `\n` after the table and goes there.
  - `appendRowText(t: TableInfo): string`:
    - with outer pipes: `"|" + "  |".repeat(columns)`;
    - without: `Array(columns).fill(" ").join("|")`;
    - with 1 column and no outer pipes: use the outer form.
  - `escapePipe(state, from: number, to: number): TransactionSpec | null` replaces the typed `|` with `\|` when `from` is inside a grid cell.
  - `tableKeymap: KeyBinding[]` binds Tab, Shift-Tab, Enter, ArrowUp, ArrowDown, ArrowLeft, ArrowRight and Escape. Each `run` dispatches the spec with `scrollIntoView: true` and returns false when the function returns null.
- Wiring: `EditorView.inputHandler.of((view, from, to, text) => text === "|" && …)`.

- [ ] **Step 1: Write the failing tests** on `T = "| a | bb |\n|---|---|\n| c | d |"`. Apply each spec and assert the head position and the doc:
  - Tab from `a` goes to after `bb`; Tab from `bb` goes to after `c`, skipping the delimiter.
  - Tab from `d` gives doc `T + "\n|  |  |"`, with the head at `from + 1` of its first blank cell.
  - Shift-Tab from `c` goes to after `bb`. Shift-Tab from `a` returns `{}`.
  - Enter from `a` goes to after `c`. Enter from `d` appends a row, and the head lands in column 1 of the new row.
  - `moveVertical`:
    - ArrowDown from offset 1 in `bb` goes to after `d`, clamped;
    - ArrowUp from `a` with `"x\n" + T` goes to the end of `x`;
    - ArrowUp from `a` in `T` alone returns `{}` (Review Focus 4);
    - ArrowDown from `d` in `T + "\ny"` goes to the start of `y`.
  - `moveHorizontal` returns null in the middle of `bb`. ArrowRight at the end of `a` goes to the start of `bb`. ArrowLeft at the start of `c` goes to the end of `bb`.
  - Escape on `T` alone gives doc `T + "\n"`, with the head at the doc end.
  - No outer pipes: Tab from the last cell of `"a | b\n--|--\nc | d"` appends `"\n  |  "`. Assert the new row parses as a `TableRow`, and pin the template if the parser needs a different one.
  - `escapePipe` inside a cell returns an insert of `\|`, and outside a table returns null.
  - **Emptying and retyping (Review Focus 1):** delete `c` from `| c | d |` to get `|  | d |`, then insert `z` at that cell's `textFrom`. The doc becomes `"| z | d |"` on that line, and every other line is unchanged.
  - Outside a table, every function returns null.
- [ ] **Step 2: Run** `pnpm test src/preview/table-keys.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `table-keys.ts` and wire it in `plugin.ts`.
- [ ] **Step 4: Run** `pnpm test` and `pnpm build`. Expected: PASS.
- [ ] **Step 5: Commit** with the message `feat: table navigation keys`.
- [ ] **Step 6 (controller gate):** in the harness, use the keys in each sample table. Check that Tab and Enter outside tables behave as before.

### Task 4: Row, column and alignment commands

**Files:**
- Create: `src/preview/table-edit.ts`, `src/preview/table-edit.test.ts`

**Interfaces:**
- Consumes: `tableAt`, `cellAt`, `appendRowText` (Task 3).
- Produces, `(state: EditorState, pos: number, …) => TransactionSpec | null`. Each is one transaction, and null when `pos` is not in a grid table or the action isn't allowed.
  - `insertRow(state, pos, where: "above" | "below")`:
    - returns null for `"above"` on the header;
    - inserts a blank row (the `appendRowText` text) and puts the cursor in its cell under the clicked column.
  - `deleteRow(state, pos)`:
    - returns null on the header;
    - removes the line and one adjacent `\n`;
    - the cursor goes to the same column in the row that now sits there, or in the row above.
  - `insertColumn(state, pos, side: "left" | "right")` changes every row, including the delimiter row:
    - each row gets a blank cell `"  |"` inserted at the clicked column's left or right boundary;
    - the delimiter row gets `"---|"`;
    - without outer pipes at the edges, the new cell goes at the line start (`"  |"`) or the line end (`"|  "`);
    - rows too short to have that boundary are left alone.
  - `deleteColumn(state, pos)`:
    - returns null when `columns === 1`;
    - removes the cell plus one adjacent delimiter in every row that has that column, including the delimiter row.
  - `setAlign(state, pos, align: "left" | "center" | "right")` rewrites only the delimiter cell's trimmed text: the dashes are kept, with colons as `:-- / :-: / --:`.

- [ ] **Step 1: Write the failing tests** on `T` from Task 3. Assert exact docs:
  - `insertRow` below `a` gives `"| a | bb |\n|---|---|\n|  |  |\n| c | d |"`.
  - `insertRow` above `a` returns null.
  - `deleteRow` on `c` gives `"| a | bb |\n|---|---|"`.
  - `deleteRow` on the header returns null.
  - `insertColumn` right of `a` gives `"| a |  | bb |\n|---|---|---|\n| c |  | d |"`.
  - `insertColumn` left of `a` puts the blank cell first in every line.
  - `deleteColumn` on `bb` gives `"| a |\n|---|\n| c |"`.
  - `deleteColumn` on a 1-column table returns null.
  - `setAlign` center on `bb` gives the delimiter `|---|:-:|`. Right on `a` then gives `|--:|:-:|`. Left on it again gives `|:--|:-:|`.
  - No outer pipes, on `"a | b\n--|--\nc | d"`: `insertColumn` right of `b` and `deleteColumn` on `a` give the docs you derive by hand. Assert them exactly.
  - Ragged: on `"| a | b |\n|---|---|\n| c |"`, `deleteColumn` on `b` leaves `| c |` untouched.
  - **Undo (Review Focus 3):** for each command, applying `tr.changes.invert(startDoc)` to the new doc restores the original string exactly. Run this over `T`, the no-outer-pipe table and the ragged table.
- [ ] **Step 2: Run** `pnpm test src/preview/table-edit.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `table-edit.ts`.
- [ ] **Step 4: Run** `pnpm test`. Expected: PASS.
- [ ] **Step 5: Commit** with the message `feat: table row, column and alignment commands`.

### Task 5: Right-click menu and Edit as Markdown

**Files:**
- Create: `src/preview/table-menu.ts`, `src/preview/table-menu.test.ts`
- Modify:
  - `src/preview/plugin.ts`: include `tableMenu()`;
  - `src/styles.css`.

**Interfaces:**
- Consumes: Task 4 commands, `editAsMarkdown`, `tableAt` and `cellAt`.
- Produces:
  ```ts
  export interface MenuItem { label: string; disabled: boolean; run: (view: EditorView) => void }
  export function menuItems(state: EditorState, pos: number): MenuItem[] | null; // null outside grid tables
  export function tableMenu(): Extension;   // contextmenu handler + DOM menu
  ```
  - Labels, in order: `Insert row above`, `Insert row below`, `Delete row`, `Insert column left`, `Insert column right`, `Delete column`, `Align left`, `Align center`, `Align right`, `Edit as Markdown`.
  - `disabled` is true exactly when that command returns null.
  - `Edit as Markdown` dispatches `editAsMarkdown.of(table.from)` and puts the cursor at the clicked position.

- [ ] **Step 1: Write the failing tests** for `menuItems`:
  - The labels come in that order.
  - On the header, `Insert row above` and `Delete row` are disabled.
  - On a 1-column table, `Delete column` is disabled.
  - Outside a table, the result is null.

  The `run` effect is covered by the Task 4 tests. Don't build a DOM test.
- [ ] **Step 2: Run** `pnpm test src/preview/table-menu.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `contextmenu` takes `posAtCoords`. If `menuItems` is non-null, call `preventDefault` and render a `div.cm-ld-menu` of `button`s on `document.body` at the pointer, clamped to the viewport.
  - The menu closes on choosing an item, Escape, a pointerdown outside it, scroll or blur.
  - Styling:
    - `Canvas` and `CanvasText` system colors, so light and dark both work;
    - a 1px border, a small shadow and `font: inherit`;
    - disabled buttons dimmed.
- [ ] **Step 4: Run** `pnpm test` and `pnpm build`. Expected: PASS.
- [ ] **Step 5: Commit** with the message `feat: table context menu`.
- [ ] **Step 6 (controller gate):** in the harness, use each menu item once. Check that Edit as Markdown shows raw lines and the grid comes back after clicking outside the table. Check light and dark.

### Task 6: Image paths, file size command, CSP

**Files:**
- Create: `src/preview/image-path.ts`, `src/preview/image-path.test.ts`
- Modify:
  - `src-tauri/src/files.rs`: add `file_size` and a test;
  - `src-tauri/src/lib.rs`: register it;
  - `src/native.ts`: add `fileSize`;
  - `src-tauri/tauri.conf.json`: CSP.

**Interfaces:**
- Produces:
  ```ts
  export type ImageSource = { kind: "local"; path: string } | { kind: "web"; url: string } | { kind: "none" };
  export function resolveImage(docPath: string | null, url: string): ImageSource;
  export function imageMime(path: string): string | null; // png, jpg/jpeg, gif, webp, svg (image/svg+xml); else null
  ```
  - Rust: `#[tauri::command] pub fn file_size(path: String) -> Result<u64, String>`, using `std::fs::metadata`, with errors formatted like `read_bytes`.
  - `native.ts`: `fileSize(path: string): Promise<number>`.
- `resolveImage` rules, in order:
  1. Strip `?…` and `#…`.
  2. `http:` or `https:` gives `web` with the URL unstripped.
  3. `file://` is stripped: `file:///C:/x` becomes `C:/x`, and `file:///home/x` becomes `/home/x`.
  4. Any other `scheme:` other than a drive letter gives `none`.
  5. Percent-decode with `decodeURIComponent`. On an error keep the raw text.
  6. Absolute paths (`/x`, `\x`, `C:\x`, `C:/x`, `\\server\share`) are kept as they are.
  7. Otherwise join to the doc's directory and resolve `.` and `..`. When `docPath` is null, give `none`.
  8. The output uses `\` if `docPath` contains `\`, else `/`.

- [ ] **Step 1: Write the failing tests** (Review Focus 5):
  - `("C:\\n\\a.md","img/x.png")` gives `C:\n\img\x.png`.
  - `("C:\\n\\a.md","../p%20q.png")` gives `C:\p q.png`.
  - `("/home/u/a.md","./i/x.png?v=1#f")` gives `/home/u/i/x.png`.
  - `("/h/a.md","C:/x.png")` gives `C:/x.png`.
  - `("/h/a.md","file:///C:/x.png")` gives `C:/x.png`.
  - `("C:\\n\\a.md","sub\\x.png")` gives `C:\n\sub\x.png`.
  - `("/h/a.md","https://e.com/i.png")` gives web with `https://e.com/i.png`.
  - `("/h/a.md","data:image/png;base64,AA")` gives none.
  - `("/h/a.md","bad%zz.png")` gives `/h/bad%zz.png`.
  - `(null,"x.png")` gives none.
  - `imageMime("A.PNG")` gives `image/png`, `imageMime("x.svg")` gives `image/svg+xml`, and `imageMime("x.bmp")` gives null.
  - Rust: `file_size` of a temp file with 3 bytes is 3, and a missing file is an `Err`.
- [ ] **Step 2: Run** `pnpm test src/preview/image-path.test.ts` and `cargo test --manifest-path src-tauri/Cargo.toml`. Expected: FAIL.
- [ ] **Step 3: Implement** both. Set the CSP to `"default-src 'self' ipc: http://ipc.localhost; style-src 'self' 'unsafe-inline'; img-src 'self' blob:"`.
- [ ] **Step 4: Run** both test commands and `pnpm build`. Expected: PASS.
- [ ] **Step 5: Commit** with the message `feat: image path resolution and file_size command`.

### Task 7: Image rendering

**Files:**
- Create: `src/preview/image-loader.ts`, `src/preview/image-loader.test.ts`, `src/preview/images.ts`, `src/preview/images.test.ts`, `dev/images/icon.png` (copy `src-tauri/icons/32x32.png`) and `dev/images/shape.svg`
- Modify:
  - `src/preview/inline.ts`: the `Image` handler;
  - `src/preview/widgets.ts`: `ImageChipWidget`;
  - `src/preview/plugin.ts`: the `data-ld-href` Mod+click;
  - `src/preview/index.ts` and `src/editor.ts`: options;
  - `src/main.ts`, `dev/preview.ts`, `dev/sample.md`;
  - `src/preview/test-helpers.ts`: a `docPath` option;
  - `src/styles.css`.

**Interfaces:**
- Consumes: `resolveImage`, `imageMime`, `fileSize` (Task 6), `linkTarget`, `isOpenableUrl` (part 1), `tableAt` and `cellAt`.
- Produces:
  ```ts
  // image-loader.ts
  export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
  export interface ImageIO { size(path: string): Promise<number>; read(path: string): Promise<Uint8Array> }
  export type Loaded = { url: string } | { error: "not-found" | "too-large" };
  export class ImageCache {
    constructor(io: ImageIO, createUrl?: (b: Blob) => string, revokeUrl?: (url: string) => void);
    load(path: string): Promise<Loaded>;   // memoized per path; unknown mime → not-found; size > MAX → too-large, no read
    retain(paths: Set<string>): void;      // revokes and forgets entries not in `paths`
  }
  // images.ts
  export const previewConfig: Facet<{ docPath: string | null; images: ImageCache | null }, …>; // combine: first value
  export const imageField: StateField<DecorationSet>;   // block widgets, whole document
  export function imageBlocks(state: EditorState): { pos: number; alt: string; source: ImageSource; href: string | null }[];
  // index.ts
  export function livePreview(opts?: { openUrl?: (url: string) => void; docPath?: string | null; imageIO?: ImageIO }): Extension;
  // editor.ts
  export interface EditorOptions { onUpdate(u: ViewUpdate): void; onSave(): void; openUrl(url: string): void; docPath: string | null; imageIO: ImageIO }
  export function createEditor(parent: HTMLElement, doc: string, opts: EditorOptions): EditorView;
  ```
- `imageBlocks` covers every `Image` node except those in a grid-table cell, in source order.
  - `pos` is the end of the image's line.
  - `alt` is the text between `![` and `]`.
  - `source` is `resolveImage(docPath, linkTarget(state, image) ?? "")`. `linkTarget` works on `Image` nodes, reference images included.
  - `href` is the enclosing `Link`'s `linkTarget` when that is openable, else null.
- `imageField` rebuilds when the doc or the syntax tree changes. Each block is `Decoration.widget({ widget: new ImageBlockWidget(…), block: true, side: 1, ld: "widget" })`, added in order.
- `ImageBlockWidget` (`name = "image"`):
  - DOM: `div.cm-ld-image`, holding either an `img` (`max-width: 100%`, alt set) or `span.cm-ld-image-missing` with the placeholder text from Global Constraints;
  - `data-ld-href` is set to `href`, or for a web image to its URL;
  - `eq` compares alt, source and href;
  - it loads through `previewConfig`'s cache in `toDOM(view)` and calls `view.requestMeasure()` after the image loads;
  - `ignoreEvent()` returns false.
- The `Image` inline handler:
  - in a grid-table cell: `emit.widget(new ImageChipWidget(alt), node.from, node.to)`, a `span.cm-ld-image-chip` showing `🖼 {alt}`;
  - otherwise `emit.hide(node.from, node.to)`. On revealed lines the raw text shows and the block stays.
- `plugin.ts` mousedown: when Mod is held, the button is 0 and `target.closest("[data-ld-href]")` matches with an openable href, call `openUrl` and `preventDefault`. `firstInput` skips that case like a link Mod+click.
- A small `ViewPlugin` calls `images.retain(new Set(local paths in imageBlocks))` after doc changes.

- [ ] **Step 1: Write the failing tests.**

  `image-loader.test.ts` uses a fake `ImageIO` and a fake `createUrl` that returns `blob:n`:
  - `load` of a png returns `{url}` and reads once on two calls.
  - The size `MAX_IMAGE_BYTES + 1` gives `too-large`, and `read` is never called.
  - `size` rejecting gives `not-found`.
  - `.bmp` gives `not-found` with no IO.
  - The blob type is `image/svg+xml` for `.svg`.
  - `retain(new Set())` revokes `blob:n`, and the next `load` reads again.

  `images.test.ts` uses `mdState` with `docPath: "/d/a.md"` provided through `previewConfig`:
  - In `"x ![a](i.png) ![b][r]\n\n[r]: j.png"`, there are two blocks at the end of line 1, in order, resolving to `/d/i.png` and `/d/j.png`.
  - For `"[![a](i.png)](https://e.com)"`, `href` is `https://e.com`.
  - For `"![w](https://e.com/p.png)"`, the source is web.
  - An image in a grid cell gives no block, and the decorations contain `widget image-chip`.
  - The `Image` handler gives a `hide` over `![a](i.png)` when not revealed and none when the cursor is on the line.
  - An image in a heading, a list item or a quote gives a block at that line's end.
- [ ] **Step 2: Run** `pnpm test src/preview/image-loader.test.ts src/preview/images.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the files above. Then wire them up:
  - `createEditor` takes `EditorOptions`.
  - `main.ts` passes the open file's `path` and `imageIO = { size: fileSize, read: readFile }`.
  - `dev/preview.ts` passes `docPath: "/dev/sample.md"` and a fetch-based `imageIO`:
    - `read` fetches the path and returns its bytes;
    - `size` returns the fetched byte length;
    - a non-OK fetch rejects.
  - `dev/sample.md` gains:
    - a PNG;
    - an SVG;
    - a missing image;
    - a web image;
    - an image inside a link;
    - an image in a table cell;
    - two images on one line.
  - Styles:
    - `.cm-ld-image img { max-width: 100%; display: block; margin: 0.4em 0 }`;
    - the placeholder and chip are styled like inline code, dimmed.
- [ ] **Step 4: Run** `pnpm test`, `cargo test --manifest-path src-tauri/Cargo.toml` and `pnpm build`. Expected: PASS.
- [ ] **Step 5: Update the README** feature list (tables and images). Commit with the message `feat: render local images`.
- [ ] **Step 6 (controller gate):** in the harness, check:
  - images show at natural size, capped to the column;
  - the cursor line shows the raw syntax with the image still under it;
  - editing the path reloads the image;
  - each placeholder shows;
  - Mod+click on the linked image goes to `openUrl` (a harness stub logs it).

  Then, in the real app, run `pnpm tauri dev -- -- <abs path to dev/sample.md>` and check that the images load through IPC under the new CSP.
