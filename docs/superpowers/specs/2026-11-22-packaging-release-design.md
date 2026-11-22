# Packaging, file association, icon and releases: design

Status: approved 2026-11-22. Size: project. Roadmap step 4
("native polish"). Builds on steps 1–3.

## Intent

Make lookdown installable and recognisable on Windows: a small per-user
installer that registers `.md` files, a portable exe for people who don't
want to install, lookdown's own fish icon, and a repeatable way to cut a
release. Keep the window as minimal as it is today. The first release,
`v0.1.0`, is tagged when this step is done.

## Goals

### Installer (Windows)

- One installer type: NSIS, installed per user (`currentUser`), so no admin
  rights or UAC prompt. The MSI is no longer built.
- It registers `.md` and `.markdown` with lookdown ("Open with" lists
  lookdown; Explorer shows lookdown's icon for those files once it is the
  default). Windows 10/11 don't let an installer make itself the default
  handler; the user confirms it once via Windows' "Open with → Always".
- Double-clicking an associated file launches lookdown with the path, or
  adds a tab to the running window (step 3's single instance).
- Running a newer setup over an existing install upgrades it in place,
  keeping the association. Uninstalling removes the app and its
  association. lookdown itself stores no settings; the webview keeps a
  small data folder under `%LOCALAPPDATA%\io.github.togla.lookdown`, which
  the uninstaller offers (unchecked) to delete.
- WebView2: Windows 10 and 11 ship it; the installer keeps Tauri's default
  behaviour of fetching the bootstrapper only if it is missing.

### Portable

- The plain release `lookdown.exe` is the portable version: copy it anywhere
  and run it. It touches no registry and associates nothing.

### No Windows menu bar (user's choice)

- Windows keeps today's window: no menu bar. Commands stay on the keyboard
  (`Ctrl+O`, `Ctrl+W`, `Ctrl+S`, tab keys) and the empty page's hint.
- The native menu bar is built in the macOS step, calling the existing app
  commands. CLAUDE.md's "provide a native menu bar (macOS expects one)" is
  updated to say "macOS only".

### Icon (user's choice: draft A)

- lookdown's icon is the silver lookdown fish on a deep-sea blue tile,
  facing left with its eye looking down:
  `docs/superpowers/specs/assets/lookdown-icon-a.svg` is the approved
  drawing.
- It replaces Tauri's stock icons everywhere they appear: exe, installer,
  window/taskbar, and associated `.md` files.
- At 16 px the fish must still read as a fish (the drafts were checked at
  48/32/16 px on light and dark backgrounds).

### Versions and releases

- The version lives in `package.json`; `tauri.conf.json` reads it from
  there; `Cargo.toml` carries the same number and a test fails if they
  differ. Starting version: 0.1.0 (unchanged).
- Version scheme: SemVer, 0.x until Windows v1 is something to hand to
  others; minor for features, patch for fixes.
- `pnpm release <version>` updates `package.json`, `Cargo.toml` and
  `Cargo.lock`, commits `release: v<version>` and tags `v<version>`. It
  pushes nothing. Run on an unchanged version (`pnpm release 0.1.0` when
  the files already say 0.1.0) it only tags — that is how `v0.1.0` is cut
  at the end of this step.
- Updates are manual: download and run the new setup, or replace the
  portable exe. No auto-updater.

### README

- Requirements: Windows 10 or later (WebView2 is built in there).
- Install (setup), portable use, setting lookdown as the default for `.md`
  (Windows "Open with → Always"), updating (close lookdown first, then run
  the new setup / replace the exe), uninstalling (incl. the webview data
  folder note), and the SmartScreen warning on first run of an unsigned exe.
- Releasing: `pnpm release <version>`, then `pnpm tauri build`; where the
  setup and portable exe land.
- Roadmap: step 4 struck through as done.

## Details settled after the builder check

- **App identifier (user's choice):** `com.lookdown.app` becomes
  `io.github.togla.lookdown` before `v0.1.0` (Tauri warns about the `.app`
  ending, and the identifier is baked into the install's registry entry,
  the file association and the webview data folder, so it can't change
  after the first release). Update the config test that pins it.
- **Installer pages (Claude's call):** Tauri's standard NSIS installer is
  kept as is — install-directory page, "Run lookdown" checkbox, the opt-out
  desktop-shortcut checkbox, an Add/Remove Programs entry. Only cheap
  config changes (e.g. no language selector); no custom NSIS template or
  hooks.
- **Leftover data (Claude's call):** the webview data folder is accepted
  and documented; the portable exe also creates it on first run. "Touches
  no registry and associates nothing" stays true for the portable exe.
- **Updating while lookdown runs (Claude's call):** the setup offers to
  close a running lookdown, which would skip the unsaved-changes prompt.
  The README tells users to close lookdown before updating; no installer
  hook.

## Non-goals

A Windows menu bar, the macOS menu/build/signing, code signing on Windows
(SmartScreen will warn on first run; documented), an auto-updater, MSI,
publishing to GitHub Releases or CI, Microsoft Store, `.markdown` variants
beyond `.md` and `.markdown`, per-machine installs.

## Anti-goals

- An installer that needs admin rights or changes anything beyond the app,
  its Start-menu entry, an optional desktop shortcut, its uninstall entry
  and its file association.
- Startup getting slower or the exe noticeably bigger for packaging's sake.
- Network access at runtime (the installer may fetch WebView2 only when it
  is missing).

## Constraints

- From CLAUDE.md: Tauri 2, thin Rust, lightweight, single self-contained
  executable; the installer exists to register the file association.
- No new runtime dependencies. Build-time tooling only if Tauri's own
  (`tauri icon`) is not enough.
- Record the release exe and setup sizes in the README or release notes
  (step 3 added the dialog plugin; the reviewer asked for a size check).

## Approaches

- **Updates: manual (chosen).** New setup upgrades in place; portable exe is
  replaced. Rejected: Tauri updater (network at every start, signing key,
  release feed), a manual "check for updates" (needs UI we don't have on
  Windows).
- **Installer: NSIS per-user only (chosen).** Rejected: keeping MSI too
  (admin rights, twice the artifacts to test).
- **Version source: files, tags mark releases (chosen).** Rejected: deriving
  the version from `git describe` at build time (wrong or failing builds
  outside a clean checkout, extra build glue).
- **Menu: macOS only (chosen).** Rejected: a menu bar on every platform
  (adds chrome on Windows).

## Decisions taken in conversation

- Menu bar macOS only, built in the macOS step (user's choice B).
- NSIS per-user setup, minimal approach; portable exe (user's choice).
- README notes Windows 10 or later (user's request).
- Manual updates (user's choice A).
- Version in files, git tags mark releases; first tag `v0.1.0` when this
  step is complete, no bump (user's choice).
- Icon: draft A, the silver lookdown (user's choice).
- App identifier `io.github.togla.lookdown` (user's choice).

## Left to the builder

- Exact `bundle.windows.nsis` and `fileAssociations` settings, and the
  association's description/name shown in Windows.
- How the icon set is generated from the SVG (`pnpm tauri icon` accepts
  SVG) and whether any small sizes need hand-tuning to stay crisp.
- How `tauri.conf.json` reads the version from `package.json` (Tauri 2
  accepts a path to a `package.json` as `version`).
- The release script's language (a small Node script under `scripts/`)
  and its safety checks (clean tree, valid SemVer, tag doesn't exist).
