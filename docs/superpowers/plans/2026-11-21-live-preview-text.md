# Live Preview (Text and Blocks) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render Markdown in place (headings, emphasis, strikethrough, inline code, quotes, lists, task checkboxes, rules, code blocks, links) while the buffer stays raw Markdown, revealing syntax on the lines being edited.

**Architecture:** `@codemirror/lang-markdown` parses the buffer. A pure function `buildDecorations(state, from, to)` walks the Lezer tree and returns tagged decorations; replace decorations and widgets are skipped inside the ranges `revealedRanges(state)` reports. A `ViewPlugin` calls it for the visible ranges and also provides `atomicRanges`. Link opening goes through `tauri-plugin-opener`.

**Tech Stack:** TypeScript, CodeMirror 6 (`@codemirror/lang-markdown`, `@codemirror/language`, `@lezer/markdown`), Vitest (node environment, no DOM), Tauri 2 + `tauri-plugin-opener`.

**Spec:** `docs/superpowers/specs/2026-11-21-live-preview-text-design.md`

## Global Constraints

- Rendering is decorations only. The buffer changes only on user edits and the checkbox click; `src/file/*` and `src/document.ts` stay untouched.
- Revealed lines keep mark and line decorations (styling); only replace decorations and widgets are dropped there.
- Nothing is revealed until the first `pointerdown` or `keydown` in the editor.
- Multi-line constructs reveal as a unit: `FencedCode`, `CodeBlock`, `SetextHeading1`, `SetextHeading2`, and any `Emphasis`, `StrongEmphasis`, `Strikethrough`, `InlineCode`, `Link`, `Autolink` node that crosses a line break.
- `Mod`+click opens only `http:`, `https:` and `mailto:` URLs. Others do nothing.
- No per-language code highlighting; raw HTML stays text; tables and images are not rendered (2b).
- `markdown({ base: markdownLanguage, addKeymap: false })`: no Enter/Backspace list keymap (not in spec; formatting commands are a non-goal).
- Decorations are built only for `view.visibleRanges`.
- Decoration specs carry an `ld` tag for tests: `"hide"`, `"mark"`, `"line"`, `"widget"`. Classes are prefixed `cm-ld-`.
- Frontend tests: `pnpm test`. Rust tests: `cargo test --manifest-path src-tauri/Cargo.toml`. Typecheck: `pnpm build` (runs `tsc`).

## Review Focus

1. Incomplete or stray syntax while typing (`#` alone, an unclosed `**`, `[ ]` outside a list, `---` under a paragraph = setext heading): nothing is hidden that the parser didn't recognize, and nothing throws. Tests in Task 2 and Task 3.
2. Several selection ranges, and one selection spanning several lines: every touched line is revealed. Test in Task 1.
3. Syntax inside inline code or code blocks (`` `**x**` ``, `# x` inside a fence): nothing inside is hidden or styled. Tests in Task 2 and Task 3.
4. Nesting: emphasis inside a link, a task list inside a quote, a nested bullet list. Everything renders and the markers of each level are hidden. Test in Task 3.
5. Undoing a checkbox toggle restores the exact character (`x`, `X` or ` `), and toggling `X` writes ` `. Test in Task 4.

---

### Task 1: Markdown parsing and reveal ranges

**Files:**
- Modify: `package.json` (add `@codemirror/lang-markdown`, `@codemirror/language`, `@lezer/markdown` via `pnpm add`)
- Create: `src/preview/markdown.ts`, `src/preview/reveal.ts`, `src/preview/reveal.test.ts`, `src/preview/test-helpers.ts`

**Interfaces:**
- Produces:
  - `markdownSupport(): Extension` (in `markdown.ts`)
  - `enableReveal: StateEffectType<null>`, `revealEnabled: StateField<boolean>` (false initially, true after the effect)
  - `revealedRanges(state: EditorState): { from: number; to: number }[]`: sorted, merged, each range from a line start to a line end; `[]` when `revealEnabled` is false
  - `isRevealed(ranges, from: number, to: number): boolean`: true if `[from, to]` overlaps or touches any range
  - test helpers: `mdState(doc: string, opts?: { selection?: EditorSelection | { anchor: number; head?: number }; reveal?: boolean }): EditorState` (adds `markdownSupport()` and `revealEnabled`, applies `enableReveal` if `reveal`, forces a full parse with `ensureSyntaxTree(state, state.doc.length, 5000)`); `at(state, text: string): number` (the offset of the first occurrence)

- [ ] **Step 1: Write the failing tests** in `reveal.test.ts`:
  - `nothing revealed before first input`: `mdState("# A\nb", { selection: { anchor: 0 } })` → `[]`.
  - `cursor reveals its line`: doc `"# A\nb\nc"`, cursor in `b`, reveal → `[{ from: 4, to: 5 }]`.
  - `multi-line selection and several ranges`: a selection from line 1 to line 2, plus a cursor on line 4 → two merged ranges covering lines 1–2 and line 4.
  - `fenced code reveals as a whole`: doc ``"x\n```\na\nb\n```\ny"``, cursor on `b` → one range from the opening fence's line start to the closing fence's line end.
  - `setext heading reveals text and underline`: `"Title\n===\nz"`, cursor on `===` → a range covering both lines.
  - `wrapped emphasis reveals both lines`: `"a **b\nc** d\n\ne"`, cursor on line 1 → lines 1–2 revealed, line 4 not.
  - `isRevealed` touching: range `{from: 4, to: 5}`, `isRevealed(r, 5, 6)` is true and `isRevealed(r, 6, 7)` is false.
- [ ] **Step 2: Run** `pnpm test src/preview/reveal.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `markdown.ts` (`markdown({ base: markdownLanguage, addKeymap: false })`) and `reveal.ts`. Start from each selection range's line span, then grow it until it stops changing: for each syntax node in the Global Constraints list that overlaps the span (inline types only when `from` and `to` are on different lines), extend to the node's first and last line. Finally merge the spans.
- [ ] **Step 4: Run** `pnpm test`. Expected: PASS, earlier tests still pass.
- [ ] **Step 5: Commit** `feat: parse Markdown and compute reveal ranges`.

### Task 2: Inline decorations

**Files:**
- Create: `src/preview/decorations.ts`, `src/preview/inline.ts`, `src/preview/inline.test.ts`
- Modify: `src/preview/test-helpers.ts` (add `describeDecorations`)

**Interfaces:**
- Consumes: `mdState`, `at`, `revealedRanges`, `isRevealed` (Task 1).
- Produces:
  - `buildDecorations(state: EditorState, from: number, to: number): DecorationSet`: walks `syntaxTree(state)` over `[from, to]`, dispatches each node to the handlers, computes `revealedRanges` once, skips `hide`/`widget` decorations for nodes where `isRevealed` holds, and sorts the result with `Decoration.set(ranges, true)`.
  - Handler contract in `decorations.ts`: `type Emit = { hide(from: number, to: number): void; mark(cls: string, from: number, to: number): void; line(cls: string, pos: number): void; widget(w: WidgetType, from: number, to: number): void }` (hide and widget are no-ops when revealed); `type Handler = (node: SyntaxNodeRef, state: EditorState, emit: Emit) => boolean | void` (return `false` to skip children).
  - `inlineHandlers: Record<string, Handler>` in `inline.ts`.
  - `describeDecorations(set: DecorationSet): string[]`: entries `"hide 0-2"`, `"mark cm-ld-strong 0-9"`, `"line cm-ld-h1 0"`, `"widget bullet 0-1"` (widget name from a `name` property on each widget class), in document order.

- [ ] **Step 1: Write the failing tests** in `inline.test.ts`, using `buildDecorations(s, 0, s.doc.length)`, with reveal off unless stated:
  - `**bold**` → `mark cm-ld-strong 0-8`, `hide 0-2`, `hide 6-8`. `*em*` and `_em_` → `cm-ld-em` with both delimiters hidden. `~~s~~` → `cm-ld-strike`. `` `c` `` → `cm-ld-code`.
  - `[text](https://x.y)` → `mark cm-ld-link` over `text`, hide `[`, and hide `](https://x.y)` as one range. `[t][r]` plus a `[r]: https://x.y` definition line → the link text is marked and `][r]` hidden (the definition line stays visible). `<https://x.y>` → marked, `<` and `>` hidden. A bare `https://x.y` → marked, nothing hidden.
  - `revealed line keeps styles`: `**bold**` with the cursor inside and reveal on → `mark cm-ld-strong 0-8` only, no `hide`.
  - `code protects contents`: `` `**x**` `` → only `cm-ld-code` and its backtick hides; no `cm-ld-strong`.
  - `stray syntax`: `"**open"` and `"a * b"` → `[]`.
  - `emphasis inside link`: `[**b**](u)` → both `cm-ld-link` and `cm-ld-strong`, with all markers hidden.
  - `range limit`: in a 3-line doc, `buildDecorations(s, line2.from, line2.to)` returns nothing from lines 1 or 3.
- [ ] **Step 2: Run** `pnpm test src/preview/inline.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `decorations.ts` and `inline.ts`. Node names come from `@lezer/markdown`: `EmphasisMark`, `CodeMark`, `StrikethroughMark`, `LinkMark`, `URL`, `LinkLabel`. Return `false` from `InlineCode` so nothing inside it is processed.
- [ ] **Step 4: Run** `pnpm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: render inline Markdown as decorations`.

### Task 3: Block decorations and widgets

**Files:**
- Create: `src/preview/blocks.ts`, `src/preview/widgets.ts`, `src/preview/blocks.test.ts`
- Modify: `src/preview/decorations.ts` (also dispatch to `blockHandlers`)

**Interfaces:**
- Consumes: `Emit`, `Handler`, `buildDecorations`, `describeDecorations` (Task 2).
- Produces:
  - `blockHandlers: Record<string, Handler>`.
  - Widgets in `widgets.ts`, each with a readonly `name`: `BulletWidget` (`"bullet"`), `RuleWidget` (`"rule"`), `CheckboxWidget(checked: boolean, pos: number)` (`"checkbox"`; `pos` is the offset of the character between the brackets; `eq` compares `checked` and `pos`). The DOM for `CheckboxWidget` is `<input type="checkbox" class="cm-ld-task">` with `data-pos`. `ignoreEvent()` returns false, so clicks reach the plugin in Task 4.
  - Line classes: `cm-ld-h1`…`cm-ld-h6`, `cm-ld-quote`, `cm-ld-codeblock`, `cm-ld-fence`. A fence line is a code-block line that also gets `cm-ld-fence`, and it is hidden from view by CSS only when its text is hidden (Task 4 adds a `cm-ld-fence-hidden` class through `line()` when the block is not revealed).

- [ ] **Step 1: Write the failing tests** in `blocks.test.ts`:
  - `## Two` → `line cm-ld-h2 0`, `hide 0-3` (the marker and its following space). `Title\n===` → `line cm-ld-h1 0`, and the underline line's text is hidden.
  - `> q` → `line cm-ld-quote 0`, `hide 0-2`. `> > q` → the `cm-ld-quote` line class once, plus a `cm-ld-quote-2` nesting class; both `>` markers are hidden.
  - `- a` → `widget bullet 0-1`. `1. a` → no widget and no hide.
  - `- [ ] t` → a bullet widget and `widget checkbox 2-5`. The checkbox for `- [X] t` is checked. When revealed, `- [ ] t` has no widgets.
  - `---` after a blank line → `widget rule 0-3`. `a\n---` is a setext heading, not a rule.
  - Fenced code ``"```js\n# x\n```"`` → `cm-ld-codeblock` on all 3 lines; `cm-ld-fence` and `cm-ld-fence-hidden` on lines 1 and 3; fence text hidden; no `cm-ld-h1` inside. When revealed, it has no `cm-ld-fence-hidden` and no hides. An indented code block gets `cm-ld-codeblock` and nothing hidden.
  - `nesting`: `"> - [x] done\n>   - sub"` → quote line classes, a checkbox, and bullets on both list levels.
  - `html stays text`: `<b>x</b>` → `[]`.
- [ ] **Step 2: Run** `pnpm test src/preview/blocks.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `blocks.ts` and `widgets.ts`. Node names: `ATXHeading1-6`, `SetextHeading1/2`, `HeaderMark`, `Blockquote`, `QuoteMark`, `BulletList`, `ListMark`, `Task`, `TaskMarker`, `HorizontalRule`, `FencedCode`, `CodeBlock`, `CodeMark`, `CodeInfo`. For a hidden fence line, hide only its text and let `cm-ld-fence-hidden` collapse the line. A replace never crosses a line break, because `ViewPlugin` decorations can't.
- [ ] **Step 4: Run** `pnpm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: render Markdown blocks, lists and task checkboxes`.

### Task 4: Live preview in the editor

**Files:**
- Create: `src/preview/plugin.ts`, `src/preview/tasks.ts`, `src/preview/tasks.test.ts`, `src/preview/index.ts`
- Modify: `src/editor.ts` (add `livePreview()` and `markdownSupport()`; remove the "plain text for now" comment), `src/styles.css` (all `cm-ld-*` styles, light and dark through `currentColor`/`color-mix` as the existing CSS does)

**Interfaces:**
- Consumes: `buildDecorations`, `revealEnabled`, `enableReveal`, `CheckboxWidget` (Tasks 1–3).
- Produces:
  - `toggleTask(state: EditorState, pos: number): TransactionSpec | null`: `pos` is the offset of the character between `[` and `]`. It returns `{ changes: { from: pos, to: pos + 1, insert } }`, where `insert` is `"x"` for ` ` and ` ` for `x` or `X`, and `null` if that character isn't a task marker's.
  - `livePreview(opts?: { openUrl?: (url: string) => void }): Extension` (in `index.ts`). It includes `revealEnabled`, the ViewPlugin (rebuilt on `docChanged`, `selectionSet`, `viewportChanged` or a syntax tree change), `EditorView.atomicRanges` from the plugin's decorations, and `domEventHandlers`:
    - `pointerdown`/`keydown` → dispatch `enableReveal` once.
    - a mousedown on `.cm-ld-task` → dispatch `toggleTask(state, Number(data-pos))`, `preventDefault`, return true.
    - `Mod`+click on a link → `opts.openUrl` (wired in Task 5).

- [ ] **Step 1: Write the failing tests** in `tasks.test.ts`:
  - `- [ ] a` → `x`. `- [x] a` → ` `. `- [X] a` → ` `.
  - a position not on a task marker → `null`.
  - with `history()`: toggle `X` and then `undo` → the doc is `- [X] a` again.
- [ ] **Step 2: Run** `pnpm test src/preview/tasks.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `tasks.ts`, `plugin.ts` and `index.ts`, wire `editor.ts` and add the styles. Headings h1–h6 descend from about 1.75em to 1em. Code uses a monospace font with a tinted background. `cm-ld-fence-hidden` collapses the line (for example `font-size: 0; line-height: 0`). Quote bars use `border-left`, and nested quotes use `cm-ld-quote-2`/`-3` padding.
- [ ] **Step 4: Run** `pnpm test` and `pnpm build`. Expected: both pass.
- [ ] **Step 5: Manual check.** Write a scratch `.md` file that covers every construct. Use this repo's README plus a task list, a quote and a fenced block, saved in the scratchpad. Run `pnpm tauri dev -- -- <abs path>` and confirm:
  - The file opens fully rendered, and the first line shows no raw syntax.
  - After a click, the clicked line shows raw syntax and keeps its styling.
  - Arrow keys walk through the file without sticking.
  - Clicking a checkbox toggles it and marks the file dirty, and `Ctrl+Z` reverts it.
  - `Ctrl+S` then `git diff --no-index` shows only the toggled character.
- [ ] **Step 6: Commit** `feat: live preview in the editor`.

### Task 5: Open links with Mod+click

**Files:**
- Create: `src/preview/links.ts`, `src/preview/links.test.ts`
- Modify:
  - `src-tauri/Cargo.toml` (`tauri-plugin-opener = "2"`)
  - `src-tauri/src/lib.rs` (`.plugin(tauri_plugin_opener::init())`, plus a test)
  - `src-tauri/capabilities/default.json`
  - `package.json` (`@tauri-apps/plugin-opener`)
  - `src/native.ts` (`openUrl`)
  - `src/preview/plugin.ts`
  - `src/main.ts` (pass `openUrl` into the editor)
  - `src/editor.ts`
  - `README.md` (status, the Using it section and the roadmap; describe live preview, `Ctrl`+click on links and clickable checkboxes)

**Interfaces:**
- Consumes: `livePreview(opts)` (Task 4).
- Produces:
  - `linkUrlAt(state: EditorState, pos: number): string | null`: the URL of the `Link` or `Autolink` node, or bare `URL`, at `pos`. For `[t][ref]` it looks up the matching `LinkReference` definition (labels compared case-insensitively, whitespace collapsed). A bare email autolink becomes `mailto:<addr>`.
  - `isOpenableUrl(url: string): boolean`: true only for `http:`, `https:` and `mailto:`, case-insensitive.
  - `openUrl(url: string): Promise<void>` in `native.ts`, from `@tauri-apps/plugin-opener`.
  - The `createEditor` signature gains a final `openUrl: (url: string) => void` parameter.

- [ ] **Step 1: Write the failing tests.**
  - In `links.test.ts`:
    - `[t](https://a.b)` with pos in `t` → `"https://a.b"`. `[t][R]` with `[r]: http://x.y` → `"http://x.y"`.
    - `<a@b.c>` → `"mailto:a@b.c"`. A bare `https://a.b` → itself.
    - plain text → `null`.
    - `isOpenableUrl`: `"HTTPS://x"` is true; `"file:///c"`, `"javascript:x"` and `"./a.md"` are false.
  - In `lib.rs` tests: `links_may_open_only_web_and_mail` parses `capabilities/default.json`. It finds the `opener:allow-open-url` entry and asserts that its `allow` URLs are exactly `http://*`, `https://*` and `mailto:*`.
- [ ] **Step 2: Run** `pnpm test` and the cargo tests. Expected: FAIL.
- [ ] **Step 3: Implement**
  - `links.ts`.
  - The opener plugin in Rust, its JS package and the capability entry: `{"identifier": "opener:allow-open-url", "allow": [{"url": "http://*"}, {"url": "https://*"}, {"url": "mailto:*"}]}`.
  - `native.openUrl`.
  - In `plugin.ts`, on mousedown with `event.metaKey` (macOS, detected from `navigator.platform`) or `event.ctrlKey` (elsewhere), take `posAtCoords`, then `linkUrlAt`, then `isOpenableUrl`. On a match, call `openUrl`, `preventDefault` and return true. Otherwise return false, so CodeMirror handles the click.
  - CSS: `cursor: pointer` on `.cm-ld-link` while `Mod` is held. Use a `cm-ld-mod` class on the editor, toggled from keydown and keyup.
- [ ] **Step 4: Run** `pnpm test`, `pnpm build` and the cargo tests. Expected: all pass.
- [ ] **Step 5: Manual check.**
  - In `pnpm tauri dev`, `Ctrl`+click on a web link opens the browser.
  - A plain click places the cursor and shows the raw link.
  - `Ctrl`+click on a relative `.md` link does nothing.
  - DevTools shows no CSP errors.
- [ ] **Step 6: Commit** `feat: open web and mail links with Mod+click`.
