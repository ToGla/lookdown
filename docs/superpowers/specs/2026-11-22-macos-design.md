# macOS build and native menu: design

Status: **draft, not approved** (2026-11-22). Written on Windows as a
handover for the session that continues on a Mac. Size: project. Roadmap
step 5 ("macOS build, with a native menu bar"). Builds on steps 1–4.

**For the session picking this up:** settle the open questions at the end
with the user first (brainstorming), update this document, get it
approved, then write the plan. Everything under "Decided" was already
decided in earlier steps or by the user; don't reopen it.

## Intent

lookdown runs on macOS the way a Mac user expects: a `.app` in a `.dmg`,
a native menu bar, Cmd shortcuts, opening `.md` files from Finder or the
Dock into the running window, with the same byte-exact saving and the same
unsaved-changes prompts as on Windows. Windows stays as it is.

## Where the code stands (verified on Windows, not yet built on a Mac)

- **Keys:** `src/app.ts` `keyCommand(e, isMac)` maps Mod-o / Mod-w / Mod-s
  and the tab-switch keys to commands (`open`, `close`, `save`, next /
  previous); `isMac` comes from the host. CodeMirror bindings use `Mod-`.
  `isReloadKey` swallows F5 / Mod-r / Mod-Shift-r in release builds.
- **Files arriving:** `src-tauri/src/lib.rs` handles `RunEvent::Opened`
  under `#[cfg(target_os = "macos")]` and feeds `queue_paths`, the same
  `PathQueue` + `paths-queued` event that command-line args and the
  single-instance plugin use. It has never been compiled for macOS.
  Unlike the single-instance callback, the `Opened` branch does not
  unminimize/show/focus the window.
- **Single instance:** `tauri-plugin-single-instance` is the first plugin.
  On macOS, Launch Services already keeps one instance per app and sends
  later files through `Opened`.
- **Closing:** the frontend handles the window close request (one prompt
  listing unsaved tabs, waits for running saves, re-entrancy guard), then
  destroys the window. Capabilities allow `core:window:allow-destroy`.
- **Bundle config:** `tauri.conf.json` has identifier
  `io.github.togla.lookdown`, version from `package.json`, publisher
  `ToGla`, `bundle.targets: ["nsis"]`, and `fileAssociations` for `md` and
  `markdown` with `name: "lookdown.markdown"`,
  `description: "Markdown document"`, role `Editor`, mime `text/markdown`.
  `src-tauri/icons/icon.icns` is generated from `lookdown.svg`. Rust tests
  in `lib.rs` pin all of this, including targets being exactly `["nsis"]`.
- **Images:** CSP `img-src 'self' blob: http: https:`; local images go
  through `file_size` (guarded by `check_local`, which refuses UNC/device
  paths and names containing `?` or `*`) and are read as blobs.

## Goals

### Building

- A universal macOS app (Apple Silicon and Intel) as a `.app` inside a
  `.dmg`, built on the Mac with `pnpm tauri build` (target
  `universal-apple-darwin`).
- Windows output unchanged: the Windows build still produces only the NSIS
  setup and the portable exe. Per-platform targets via a
  platform-specific config (`tauri.macos.conf.json`, which Tauri merges
  over `tauri.conf.json`) rather than widening `targets` for everyone. The
  config tests are updated to match.
- Minimum macOS version stated in the README (Tauri's default is fine
  unless something forces higher).

### Native menu bar (macOS only)

- Menus following Mac conventions, built in Rust (Tauri's menu API) and
  calling the existing app commands in the frontend, not duplicating them:
  - **lookdown:** About lookdown, Hide, Hide Others, Show All, Quit
    lookdown (Cmd+Q).
  - **File:** Open… (Cmd+O), Save (Cmd+S), Close Tab (Cmd+W).
  - **Edit:** Undo, Redo, Cut, Copy, Paste, Select All (native items, so
    text fields and the editor get them).
  - **Window:** Minimize, Zoom, Show Next Tab / Show Previous Tab (Mac
    convention: Ctrl+Tab / Ctrl+Shift+Tab, also Cmd+Shift+] / [),
    Enter Full Screen.
- **Quit and Close Tab must go through the unsaved-changes prompts.**
  Tauri's default macOS menu binds Cmd+Q and Cmd+W to native actions that
  may bypass the frontend's close handling; the custom menu replaces it.
  Quit from the Dock, from the app menu, or at logout must also prompt
  (intercept the exit request, ask the frontend, exit when it says so).
- Menu shortcuts and the frontend's `keyCommand` must not both fire for
  one key press.
- Windows gets no menu (decided in step 4).

### Opening files

- Double-click in Finder, "Open With", and dropping a file on the Dock icon
  open a tab (or focus the existing tab), whether lookdown is running or
  not. The window is brought to front (fix the missing focus in the
  `Opened` branch).
- The `.md` / `.markdown` association appears in Finder's "Open With".
  Finder shows the association's `name` as the document kind; it is
  `lookdown.markdown` because Windows uses it as a registry id. Give macOS
  a readable kind ("Markdown document"), without changing the Windows
  id (the id is frozen since the Windows release).

### WebKit parity

Check, and fix where it differs from WebView2:

- block widgets (images, tables): heights, clicks below them landing on
  the right line, caret placement (the 2b fix used padding on
  `.cm-ld-image` to keep CodeMirror's height map right);
- table editing (Tab / Enter / right-click menu);
- `http:` web images: WebKit may block them as mixed content from the
  `tauri://` origin;
- drag-drop of files onto the window;
- reload keys: `isReloadKey` matches `e.key`, which differs on non-Latin
  layouts;
- the `beforeunload` guard and the reload-key swallowing in a release
  build;
- file names with `?` or `*` are legal on macOS but refused by
  `check_local` for images; decide whether to allow them on macOS.

### Distribution

- See the open question on signing. Whatever is chosen, the README says
  exactly what a user sees on first launch and how to get past it.
- README: macOS install (drag to Applications), setting lookdown as the
  default (Finder → Get Info → Open with → Change All), updating (replace
  the app), uninstalling (move to Bin; the webview data folder location on
  macOS), the release steps on a Mac, and the `.dmg` / `.app` sizes.

## Non-goals

Mac App Store, auto-updater, iOS, Linux, a Windows menu bar, Touch Bar,
Services menu entries, Quick Look previews, iCloud document integration,
window state restore, reopening last files (the user declined that in
step 3).

## Anti-goals

- Any regression on Windows (behaviour, size, startup).
- Slower startup or a noticeably larger app for the menu's sake.
- A second code path for commands: the menu calls the same commands the
  keys call.
- Network access at runtime.

## Constraints

- From CLAUDE.md: Tauri 2, thin Rust, logic in the frontend unless it needs
  the OS; byte-exact saving; CRLF/LF and BOM preserved; no new runtime
  dependencies unless the OS integration needs them.
- `tests/fixtures/` stay byte-exact (`.gitattributes` `-text`); check
  that the Mac checkout doesn't convert them.
- Tests: `pnpm test` (Vitest), `cargo test --manifest-path
  src-tauri/Cargo.toml`. The Rust config tests must pass on both
  platforms.
- Tools come from `mise.toml` (node, pnpm, rust). The Mac also needs the
  Xcode command line tools.

## Decided (earlier steps and the user)

- Menu bar on macOS only; Windows keeps a menu-less window (step 4, the
  user's choice).
- Manual updates, no auto-updater (step 4).
- Versioning from `package.json`; `pnpm release <version>` commits and
  tags; never pushes (step 4).
- One window, tabs, single instance; empty window stays when the last tab
  closes; no reopening last files (step 3).
- Identifier `io.github.togla.lookdown`, publisher `ToGla`, association id
  `lookdown.markdown`: frozen once v0.1.0 ships.

## Open questions for the user (settle first)

1. **Signing.** Ad-hoc signing only (free; macOS blocks the first launch
   of a downloaded copy until the user clicks "Open Anyway" in System
   Settings → Privacy & Security), or a Developer ID certificate plus
   notarization (Apple Developer Program, $99/year; opens without
   warnings)? Claude's earlier suggestion: ad-hoc now, notarize only when
   lookdown goes to other people.
2. **Building: on the Mac by hand, or also a GitHub Actions macOS runner?**
   CLAUDE.md planned a runner because no Mac was available; now one is. A
   runner adds the project's first CI and could also build Windows.
3. **Closing the window:** quit the app (simple; what lookdown does on
   Windows), or keep it running with no window, Mac style (needs Dock
   reopen handling and a new-window path)?
4. **Is v0.1.0 tagged before this step,** after the user's Windows install
   check, with macOS arriving in a later version (e.g. 0.2.0)?

## Left to the builder

- Menu construction details (Tauri `Menu` / `Submenu` / `PredefinedMenuItem`)
  and how menu events reach the frontend (an event the `App` controller
  listens to, mapped onto the existing commands).
- How the exit request is intercepted and confirmed.
- The platform config split and how the Rust config tests read it.
- Which WebKit differences need code and which are acceptable.
- The macOS kind name mechanism (platform config or Info.plist).

## Carried over from earlier reviews (check on the Mac)

- Real-app checks the browser harness couldn't do, now on macOS: native
  dialog button results, close-request handling, focus and drag-drop
  events, file handover to the running instance, capabilities at runtime.
- Deferred minors that may matter more on a laptop: polling continues
  while minimized; polling is sequential (one hung network volume stalls
  all tabs); a hung save blocks window close silently; two prompts can be
  open at once.
