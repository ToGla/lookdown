# Insert Table Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `Mod-Shift-t` (and Edit › Insert Table on macOS) inserts a 2×2 Markdown table (header + one body row) at the cursor, with the cursor in the first header cell.

**Architecture:** A pure edit function `insertTable` sits next to the other table edits. A new `"table"` app command runs it on the shown view and is routed by `keyCommand` and the macOS menu like every other command.

**Tech Stack:** TypeScript, CodeMirror 6, Vitest, Tauri 2 menu (Rust).

**Spec:** `docs/superpowers/specs/2026-11-23-insert-table-design.md`

## Global Constraints

- Table text, exactly: `"|  |  |\n|--|--|\n|  |  |"`.
- Cursor after insert: table start + 2.
- Shortcut `Mod-Shift-t`, menu label `Insert Table`, accelerator `CmdOrCtrl+Shift+T`, in Edit after Redo.
- One transaction. No text other than the table and its separating blank lines changes.
- Inside a grid table (`tableAt(state, head)` non-null): no change.

## Review Focus

1. **Cursor at the end of a document with no trailing newline, after text** → `"text\n\n" + TABLE`, with no extra trailing newline (Task 1 `after a line of text`).
2. **A whitespace-only line between two paragraphs** → that line is replaced, with a blank line on both sides (Task 1 `blank line between paragraphs`).
3. **A blank line already exists above or below** → no doubled blank lines (Task 1 `existing blank lines are reused`).
4. **The inserted text parses as a grid table with 2 columns and 2 rows** → otherwise the feature silently inserts plain text (Task 1 `result parses as a 2x2 table`).
5. **The command while no tab is open** → does nothing and doesn't throw (Task 2 `table without a tab does nothing`).

---

### Task 1: `insertTable` edit

**Files:**
- Modify: `src/preview/table-edit.ts`
- Test: `src/preview/table-edit.test.ts`

**Interfaces:**
- Produces: `export function insertTable(state: EditorState): Spec | null`, where `Spec` = `TransactionSpec`. It returns `changes` + `selection` (a cursor).

Placement (based on `L = state.doc.lineAt(state.selection.main.head)`). "Blank" means the line is empty after `trim()`. `prev`/`next` are the neighbouring lines, if any:
- **`L` is blank:** replace `L.from..L.to` with `(prev non-blank ? "\n" : "") + TABLE + (next non-blank ? "\n" : "")`.
- **Otherwise:** insert at `L.to` the text `"\n\n" + TABLE + (next non-blank ? "\n" : "")`.
- **Cursor:** the position where TABLE begins + 2.

- [ ] **Step 1: Write the failing tests** (`describe("insertTable")`). Use a helper like the existing `run` that also checks undo restores the original. Use `mdState(doc, { selection: { anchor } })` and `const TABLE = "|  |  |\n|--|--|\n|  |  |"`.

| test name | doc, cursor | expected doc | expected head |
|---|---|---|---|
| `empty document` | `""`, 0 | `TABLE` | 2 |
| `after a line of text` | `"text"`, 2 | `"text\n\n" + TABLE` | 8 |
| `blank line between paragraphs` | `"a\n  \nb"`, 3 | `"a\n\n" + TABLE + "\n\nb"` | 5 |
| `existing blank lines are reused` | `"a\n\n\n\nb"`, 3 (the middle blank line) | `"a\n\n" + TABLE + "\n\nb"` | 5 |
| `text line followed by text` | `"a\nb"`, 0 | `"a\n\n" + TABLE + "\n\nb"` | 5 |
| `text line followed by a blank line` | `"a\n\nb"`, 0 | `"a\n\n" + TABLE + "\n\nb"` | 5 |
| `selection is kept` | `"hello world"`, anchor 0 head 5 | `"hello world\n\n" + TABLE` | 15 |
| `inside a table does nothing` | `T`, `p(T, "c")` | `null` | |

Plus `result parses as a 2x2 table`: after the `empty document` and `after a line of text` cases, `tableAt(next, head)` has `columns === 2` and `rows.length === 2`.

In row 4 the cursor sits on the middle of three blank lines, so prev and next are both blank and no blank line is added.

- [ ] **Step 2: Run** `pnpm test src/preview/table-edit.test.ts`. Expected: FAIL, `insertTable` is not a function.
- [ ] **Step 3: Implement** `insertTable` per the placement rule.
- [ ] **Step 4: Run** `pnpm test`. Expected: all pass.
- [ ] **Step 5: Commit** `feat: insertTable edit`.

---

### Task 2: `"table"` command, shortcut, macOS menu, README

**Files:**
- Modify: `src/app.ts` (`COMMANDS` gains `"table"`, `keyCommand`, `run`)
- Modify: `src-tauri/src/menu.rs` (`COMMANDS` → `[&str; 9]` with `"table"`, an Edit item after Redo, test list)
- Modify: `README.md` (a shortcut line after the `Ctrl+S` line, and the macOS menu list `Edit: Undo, Redo, Insert Table and the clipboard`)
- Test: `src/app.test.ts`, `menu.rs` tests

**Interfaces:**
- Consumes: `insertTable` (Task 1).
- Produces: `run("table")`. When `this.shown && this.view`, it builds `spec = insertTable(this.view.state)`; if the spec is non-null it dispatches `{ ...spec, scrollIntoView: true, userEvent: "input" }`, then calls `this.view.focus()`. `keyCommand`: `Mod-Shift-t` (Shift held, `key.toLowerCase() === "t"`) → `"table"`.

- [ ] **Step 1: Write the failing tests:**
  - `isCommand` list gains `"table"`.
  - `keyCommand`:
    - `key("T", { ctrlKey: true, shiftKey: true })`, `false` → `"table"`
    - `key("t", { metaKey: true, shiftKey: true })`, `true` → `"table"`
    - `key("t", { ctrlKey: true })`, `false` → `null`
    - `key("t", { ctrlKey: true, shiftKey: true })`, `true` → `null`
  - `describe("insert table")`:
    - `inserts a table in the shown tab and marks it dirty`: open `/docs/a.md` (`"alpha\n"`), set the cursor to 0, `run("table")`. The doc is `"alpha\n\n" + TABLE + "\n"` (the next line is the empty last line, which is blank), the tab is dirty, and `ui.view.focused` increased.
    - `the macOS menu runs it`: `host.menu("table")`, then the same doc.
    - `table without a tab does nothing`: `run("table")` on a fresh app does not throw, and `ui.views` is empty.
  - `menu.rs` `commands_map_to_events` list gains `"table"`.
- [ ] **Step 2: Run** `pnpm test src/app.test.ts` and `cargo test --manifest-path src-tauri/Cargo.toml menu`. Expected: both FAIL on the new cases.
- [ ] **Step 3: Implement** per Interfaces. Update the `keyCommand` doc comment.
- [ ] **Step 4: Run** `pnpm test`, `cargo test --manifest-path src-tauri/Cargo.toml` and `pnpm run build`. Expected: all green.
- [ ] **Step 5: Commit** `feat: Insert Table command (Mod-Shift-t, macOS Edit menu)`.
