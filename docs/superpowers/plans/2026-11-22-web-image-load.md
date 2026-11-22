# Load Web Images and Chip Click Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clicking an image chip in a table cell places the cursor there, and a web image placeholder can be loaded on request through a right-click menu.

**Architecture:** The chip widget stops ignoring mouse events. A `StateField` holds the web URLs loaded this session; `imageField` rebuilds when it changes and gives `ImageBlockWidget` a `loaded` flag. The table menu's DOM moves to a shared `popup-menu.ts` that both menus use.

**Tech Stack:** TypeScript, CodeMirror 6, Vitest (node, no DOM), Tauri 2 config.

**Spec:** `docs/superpowers/specs/2026-11-22-web-image-load-design.md`

## Global Constraints

- No network request without the user's click. Loading never changes the document and is never added to undo history.
- Failure copy: `{alt} — image could not be loaded`; when alt is empty, drop `{alt} — `.
- The menu item label is exactly `Load image`.
- CSP becomes exactly `default-src 'self' ipc: http://ipc.localhost; style-src 'self' 'unsafe-inline'; img-src 'self' blob: http: https:`.
- No new dependencies. Decoration specs keep the `ld` tag and `cm-ld-` classes.
- Commands: `pnpm test`, `cargo test --manifest-path src-tauri/Cargo.toml`, `pnpm build`.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- The controller does the browser checks.

## Review Focus

1. A loaded URL that appears twice in the file: both load; a different URL stays a placeholder. Test in Task 2.
2. Editing the URL text of a loaded image: the new URL is not loaded (it is a different URL). Test in Task 2.
3. Undo after loading: the load stays (it is not a document change), and undo doesn't throw. Test in Task 2.
4. Right-clicking a local image or placeholder, or plain text: no "Load image" menu; the table menu still works in tables. Covered by `webImageUrlAt` tests in Task 2.
5. A web image inside a link: Ctrl+click still opens the link, not the image URL. Unchanged code path; checked in the browser.

---

### Task 1: Chip click places the cursor

**Files:**
- Modify: `src/preview/widgets.ts` (`ImageChipWidget`)
- Test: `src/preview/images.test.ts` (or a widgets test next to it)

- [ ] **Step 1: Write the failing test** `image chip does not swallow clicks`: `new ImageChipWidget("a").ignoreEvent(new Event("mousedown"))` is `false`. Node has a global `Event`; if not, pass a minimal object cast to `Event`.
- [ ] **Step 2: Run** `pnpm test src/preview/images.test.ts`. Expected: FAIL (the default returns true).
- [ ] **Step 3: Implement** `ignoreEvent(): boolean { return false; }` on `ImageChipWidget`, with a one-line comment: the chip fills its cell, so ignoring clicks would make the cell unreachable by mouse.
- [ ] **Step 4: Run** `pnpm test`. Expected: PASS.
- [ ] **Step 5: Commit** `fix: clicking an image chip places the cursor in its cell`.

### Task 2: Load web images on request

**Files:**
- Create: `src/preview/popup-menu.ts`, `src/preview/web-image-menu.ts`, `src/preview/web-image-menu.test.ts`
- Modify: `src/preview/table-menu.ts` (use `popup-menu.ts`), `src/preview/images.ts`, `src/preview/plugin.ts` (register `webImageMenu()` before `tableMenu()`), `src/styles.css` (only if needed), `src-tauri/tauri.conf.json` (CSP), `dev/sample.md`, `README.md` (one line)

**Interfaces:**
- `popup-menu.ts`:
  ```ts
  export interface MenuItem { label: string; disabled: boolean; run: (view: EditorView) => void }
  export function openMenu(view: EditorView, items: MenuItem[], x: number, y: number): void; // moved verbatim from table-menu.ts
  ```
  `table-menu.ts` imports both and re-exports `MenuItem` so existing imports keep working. Behaviour of the table menu is unchanged.
- `images.ts`:
  ```ts
  export const loadWebImage: StateEffectType<string>;                // the URL
  export const loadedWebImages: StateField<ReadonlySet<string>>;     // grows on loadWebImage; never shrinks; session only
  ```
  - `ImageBlockWidget` gets a fourth constructor field `loaded: boolean`, compared in `eq`.
  - `buildImages(state)` passes `loaded = source.kind === "web" && state.field(loadedWebImages, false)?.has(source.url) === true`.
  - `imageField.update` also rebuilds when `tr.startState.field(loadedWebImages, false) !== tr.state.field(loadedWebImages, false)`.
  - `imageExtensions(config)` includes `loadedWebImages`.
  - `toDOM` for a web source:
    - not loaded: the existing placeholder (`{alt} — {url}`), and the placeholder span gets `data-ld-web` set to the URL;
    - loaded: an `<img>` with `alt`, `referrerPolicy = "no-referrer"` and `src = url`; on load request a measure; on error replace it with the placeholder `{alt} — image could not be loaded` and request a measure. Clear `onload`/`onerror` as local images do. `data-ld-href` stays on the block as today, so Ctrl+click behaviour doesn't change.
- `web-image-menu.ts`:
  ```ts
  export function webImageUrlAt(target: EventTarget | null): string | null; // closest("[data-ld-web]")?.dataset.ldWeb ?? null
  export function webImageMenu(): Extension; // contextmenu: url = webImageUrlAt(e.target); if null return false; preventDefault; openMenu with one item "Load image" -> view.dispatch({ effects: loadWebImage.of(url) }); return true
  ```

- [ ] **Step 1: Write the failing tests.** In `web-image-menu.test.ts`, using `mdState` with `docPath` (it must include `imageExtensions`; extend the helper if it doesn't):
  - `loading marks every widget with that URL`: doc `"![a](https://e.com/x.png)\n\n![b](https://e.com/x.png)\n\n![c](https://e.com/y.png)"`. After applying `loadWebImage.of("https://e.com/x.png")`, the `imageField` widgets for `a` and `b` have `loaded === true` and the one for `c` has `false`. The document is unchanged.
  - `editing the URL drops the load`: after loading `x.png`, change `x.png` to `z.png` in `a`; that widget has `loaded === false`.
  - `loading is not undoable`: with `history()` in the state, load, then `undo`; `loaded` is still true and nothing throws.
  - `local images ignore the effect`: a local image widget keeps `loaded === false`.
  - `webImageUrlAt`: returns the URL for an object whose `closest` returns an element with `dataset.ldWeb`, null for `null` and for an object whose `closest` returns null. Use plain objects cast to `EventTarget`; there is no DOM.
- [ ] **Step 2: Run** `pnpm test src/preview/web-image-menu.test.ts`. Expected: FAIL (missing exports).
- [ ] **Step 3: Implement** the interfaces above. Set the CSP to the exact string in Global Constraints. Add a web image that exists to `dev/sample.md` next to the example.com one (e.g. `https://www.w3.org/Icons/w3c_home.png`), labelled "loads on Load image". Add one README line: web images load on request via right-click.
- [ ] **Step 4: Run** `pnpm test`, `cargo test --manifest-path src-tauri/Cargo.toml` and `pnpm build`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: load web images on request`.
