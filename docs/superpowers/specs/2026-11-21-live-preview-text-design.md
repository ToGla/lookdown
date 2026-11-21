# Live preview, part 1 (text and blocks): design

Status: approved 2026-11-21. Size: project. Roadmap step 2a (tables and images
are step 2b, a separate spec).

## Intent

Live preview is what makes lookdown a Markdown *viewer*, not a text editor: you
open a file and read it rendered, but the buffer is still the raw Markdown and
saving stays byte-exact. This step renders everything except tables and images,
Obsidian-style: syntax is hidden and styled in place, and shown raw on the
lines being edited.

## Goals

- Parse with `@codemirror/lang-markdown` (CommonMark + GFM: strikethrough, task
  lists, autolinks; tables parsed but left unrendered until 2b).
- Render in place:
  - **Headings** (ATX `#`…`######` and setext `===`/`---`): markers hidden,
    six distinct sizes.
  - **Emphasis, strong, strikethrough, inline code:** delimiters hidden, text
    styled.
  - **Blockquotes:** `>` hidden, left bar (nested quotes get nested bars).
  - **Bullet lists:** `-`/`*`/`+` shown as a bullet glyph. **Ordered lists**
    keep their numbers as typed (they are content).
  - **Task lists:** `[ ]`/`[x]` shown as a checkbox. Clicking it toggles the
    single character between ` ` and `x` as one undoable edit (an `X` reads as
    checked; toggling it writes ` `).
  - **Horizontal rules:** drawn as a rule.
  - **Fenced and indented code blocks:** monospace with a background; fence
    lines hidden. No per-language highlighting.
  - **Links** (`[text](url)`, `[text][ref]`, autolinks `<…>` and GFM bare
    URLs): only the text shows, styled as a link.
- **Reveal:** every line touched by any selection range (cursor included) shows
  its hidden syntax (markers, fences, link URLs, raw `[ ]`) but **keeps its
  styling**: a revealed heading stays large with its `#` visible, bold stays
  bold with `**` visible, a quote keeps its bar. So only replace decorations
  are dropped on revealed lines; mark and line decorations stay, and line
  heights don't jump when the cursor moves.
- **Multi-line constructs reveal as a unit** (builder's-check call): if a
  selection touches any line of a fenced or indented code block, a setext
  heading (text + underline), or an inline span that wraps across a line
  break (emphasis, link, code), all its lines are revealed. The reveal check
  therefore works on syntax-node ranges, not just the cursor's line.
- **Nothing is revealed until the user interacts:** on open the cursor sits at
  the start (editor focused, ready to type) but every line renders. The first
  pointer down or keypress in the editor turns reveal on for the rest of the
  session. Selection changes made programmatically before that don't reveal.
- **Links:** plain click places the cursor (which reveals the link).
  `Mod`+click on an `http:`, `https:` or `mailto:` URL opens it with the system
  default handler via `tauri-plugin-opener`. Other URLs (relative paths,
  `.md` files, anchors) do nothing for now; opening `.md` links in a tab comes
  with step 3.
- Cursor movement and clicks never get stuck in or land inside hidden syntax.
- Light and dark follow the system theme (existing `color-scheme: light dark`).

## Non-goals

Tables and images (2b). Formatting commands (`Mod-b` etc.), outline/TOC,
code highlighting per language, raw HTML rendering (shown as plain text),
footnotes, math, Mermaid, opening relative/`.md` links.

## Anti-goals

- Anything that changes the buffer other than an explicit edit or the
  checkbox click. Rendering is decorations only; byte-exact saving
  (`src/file/lines.ts`, `src/document.ts`) must not need changes.
- Noticeably slower startup or typing on large files: decorations are built
  only for the visible ranges and on changes to doc, selection or viewport.
- A rendering that hides content the user can't reach: everything hidden is
  revealed by putting the cursor on its line.

## Constraints

- From CLAUDE.md: CodeMirror 6 live preview, TypeScript, no UI framework, thin
  Rust, cross-platform (`Mod-` bindings; no Windows-only paths).
- Only new frontend deps: `@codemirror/lang-markdown` and what it pulls in
  (`@lezer/markdown`, `@codemirror/language`). New Rust dep:
  `tauri-plugin-opener` (plus its JS package) with a capability that allows
  opening URLs only (scope `http:`, `https:`, `mailto:`).
- CSP stays as is unless the opener needs a change (it uses IPC, so it
  shouldn't).

## Approaches

- **A. Own decoration plugin over the Lezer syntax tree (chosen).** A
  `ViewPlugin`/`StateField` walks the parsed tree for the visible ranges and
  emits `Decoration.replace` (hidden syntax, widgets), `Decoration.mark`
  (inline styles) and `Decoration.line` (headings, quotes, code blocks). Lines
  touched by the selection are skipped. A few hundred lines, no further deps,
  full control over cursor behavior and undo; tables and images in 2b reuse
  the same machinery. Picked because live preview is the core of the product.
- B. A third-party live-preview package. Less code up front, but small
  hobby-maintained projects with their own reveal rules, no table support, and
  forking needed for fixes. Rejected as too risky for the core feature.
- C. Styled but never hidden (dimmed syntax). Simplest and safe, but not the
  live preview the project decided on.

## Design decisions (taken in conversation)

- Line-level reveal, as CLAUDE.md states, widened to whole multi-line
  constructs; revealed lines stay styled (user's choice).
- File opens fully rendered; reveal starts at first click or keypress (user's
  choice).
- Ordered list numbers kept; bullet markers replaced by a glyph.
- No language highlighting in code blocks (weight).
- Raw HTML shown as text.
- Link click behavior as in Goals.

## Left to the builder

- Module layout (e.g. `src/preview/` with one file per concern) and how tests
  are split. Decoration logic should be testable in Vitest without a browser
  where practical (build an `EditorState`, compute decorations, assert ranges).
- Whether decorations come from a `ViewPlugin` (viewport-limited) or a
  `StateField`; block-level replacements that span line breaks must come from
  a `StateField` per CodeMirror's rules, so hidden fence lines are best done as
  line decorations that collapse the line (e.g. a class with zero height) or
  per-line replaces, not one multi-line replace.
- Exact styling (sizes, colors, bar and bullet glyphs), within the existing
  `src/styles.css` look.
- How `Mod`+click is detected and how the pointer cursor hints at it.
- Nested constructs (emphasis inside links, code inside headings, lists inside
  quotes) render by composition; edge cases may stay raw if rendering them
  would be ambiguous.
