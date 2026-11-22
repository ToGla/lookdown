# macOS build and menu bar: design

Status: approved 2026-11-22. Size: small project. Roadmap step 5 ("macOS build,
with a native menu bar"). Builds on steps 1–4.

## Intent

Make lookdown build, install and behave properly on a Mac: a `.app` and a
`.dmg` built locally on the developer's Apple Silicon Mac, `.md` files
opening in it from Finder, and the minimal native menu bar macOS users
expect. The Windows build stays exactly as it is.

## Goals

### Bundles (user's choice: local build)

- `pnpm tauri build` on a Mac produces `lookdown.app` and
  `lookdown_<version>_aarch64.dmg`. On Windows it still produces only the
  NSIS setup.
- The build targets the Mac it runs on (Apple Silicon). No universal binary.
- The app is unsigned beyond the ad-hoc signature the toolchain applies
  (Apple Silicon refuses to run code with no signature at all). No Developer
  ID signing, no notarization.
- `.md` and `.markdown` are declared as document types, so Finder lists
  lookdown under "Open With" and can make it the default ("Get Info → Open
  with → Change All"). The existing `fileAssociations` entry drives this.
- Opening files from Finder, the Dock icon or `open -a lookdown file.md`
  works both when lookdown is closed (launches with the file) and when it
  runs (adds a tab, or focuses the tab if already open). This path exists
  already (`RunEvent::Opened` → the path queue) and is verified here.
- The icon is the approved fish (draft A) from the existing `icon.icns`.

### Menu bar (user's choice A: minimal custom menu, macOS only)

Built in Rust, macOS only; Windows keeps a menu-less window.

| Menu | Items |
| --- | --- |
| lookdown | About lookdown, Hide lookdown (`Cmd+H`), Hide Others, Show All, Quit lookdown (`Cmd+Q`) |
| File | Open… (`Cmd+O`), Save (`Cmd+S`), Close Tab (`Cmd+W`) |
| Edit | Undo (`Cmd+Z`), Redo (`Cmd+Shift+Z`), Cut, Copy, Paste, Select All |
| Window | Minimize (`Cmd+M`), Zoom, Next Tab (`Ctrl+Tab`), Previous Tab (`Ctrl+Shift+Tab`) |

- File and Window tab items run the existing app commands (`open`, `save`,
  `close`, `next`, `previous` in `src/app.ts`): Rust emits one event naming
  the command, the frontend's `Host` passes it to `App.run`. No new logic
  in Rust.
- `Cmd+W` closes the tab, never the window, and goes through the tab's
  unsaved-changes prompt. Tauri's default menu (which binds `Cmd+W` to
  Close Window) is replaced.
- Quitting by any route — the menu, `Cmd+Q`, the Dock's Quit, logout —
  goes through the same "close the window" flow as the red close button:
  one prompt listing all unsaved tabs, Cancel keeps lookdown running.
- Closing the window (red button) quits lookdown, as today on Windows.
- Cut, Copy, Paste and Select All work in the editor (WKWebView needs the
  Edit menu for these keys). Undo and Redo act on CodeMirror's history,
  the same as pressing the keys does today.
- About shows the app name, version and icon (Tauri's standard about
  panel).

### WebKit check

The frontend has only ever run on WebView2. Before this step is done, every
feature listed in the README's "Opening files" section is tried on the Mac
build; bugs found are fixed in this step when small, otherwise listed in the
README as known issues.

### README and CLAUDE.md

- README: macOS requirements, building on a Mac (Xcode Command Line Tools),
  installing from the `.dmg` (drag to Applications), the Gatekeeper warning
  for an unsigned app and how to open it anyway, making lookdown the default
  for `.md`, updating (quit, replace the app), uninstalling (delete the app;
  webview data under `~/Library`), artifact paths and sizes, keyboard
  shortcuts written with `Cmd` where they differ. Roadmap step 5 struck
  through as done.
- CLAUDE.md "Platforms": macOS builds are made locally on a Mac (replaces
  the GitHub Actions plan); signing/notarization still deferred.

## Non-goals

CI or GitHub Actions, Developer ID signing, notarization, universal or Intel
builds, publishing releases, an auto-updater, the Mac App Store, a
customised DMG window (background image, layout), a Windows menu bar, a
macOS "edited" dot in the title bar, reopening a window from the Dock after
it was closed (lookdown quits instead), new menu commands beyond the table.

## Anti-goals

- Any change to Windows behaviour or its bundle.
- A quit path that skips the unsaved-changes prompt.
- Menu shortcuts that fire a command twice (once from the menu, once from
  the webview's key handler).
- Startup getting slower or logic moving into Rust.

## Constraints

- CLAUDE.md: Tauri 2, thin Rust, no Windows-only APIs, `Mod-` keybindings,
  native menu bar on macOS only, files from `RunEvent::Opened` feed the same
  open path as command-line arguments.
- No new runtime dependencies (Tauri's own menu API only).
- Config tests keep pinning the bundle: Windows targets stay `["nsis"]`, the
  macOS targets are pinned too.

## Approaches

- **Menu: minimal custom menu now (chosen, user's choice A).** Rejected:
  shipping with Tauri's default menu (`Cmd+W` closes the window, quit
  bypasses the per-tab flow, File commands missing from the menu).
- **Build: local on this Mac (chosen, user's choice).** Rejected: a GitHub
  Actions macOS runner (not needed for a first build, adds CI to maintain),
  signing/notarization (needs a paid Apple Developer account; deferred).
- **Architecture: native arm64 (Claude's call).** Rejected for now: a
  universal binary (twice the build, Intel Macs not a target yet).

## Decisions taken in conversation

- Local `.app` and `.dmg` builds, unsigned (user).
- Minimal custom macOS menu in this step (user's choice A).
- Native architecture only; per-platform bundle targets; README macOS
  section; tests on macOS plus a manual WebKit pass (Claude's calls,
  accepted by the user).

## Claude's calls (check while reading)

- **Platform config:** a `src-tauri/tauri.macos.conf.json` sets the macOS
  bundle targets (`app`, `dmg`) and macOS-only bundle settings; Tauri merges
  it over `tauri.conf.json` on Mac builds only, so the Windows config is
  untouched.
- **Window menu tab items** are included so tab switching is discoverable on
  macOS; they reuse existing commands.
- **Undo/Redo** are in the Edit menu because macOS users expect them there,
  but they must not replace CodeMirror's history with WebKit's native undo.
  If a native Undo item can't be routed to CodeMirror cleanly, they become
  custom items emitting an undo/redo command, or are left out of the menu.
- **No version bump** in this step; cutting `v0.2.0` with `pnpm release` is
  your call afterwards.

## Left to the builder

- How quit is intercepted (e.g. a custom Quit item plus
  `RunEvent::ExitRequested` with `prevent_exit`) so every route reaches the
  frontend's close flow, and how an approved close then really exits.
- The event name and payload for menu commands, and its test.
- Whether menu items are disabled when no tab is open (commands are already
  no-ops then).
- Whether the existing webview key handler needs a guard against double
  commands, or whether native accelerators already swallow the keys.
- `minimumSystemVersion` and other `bundle.macOS` settings; whether
  `fileAssociations` needs a content type / UTI (`net.daringfireball.markdown`)
  for Finder to offer lookdown.
- Whether the icon from `icon.icns` looks oversized in the Dock next to
  other apps (macOS icons carry a margin); if so, a padded variant of the
  same drawing for macOS only.
- Tauri's DMG script drives Finder via AppleScript and may ask for
  automation permission on first build; document it if it does.
