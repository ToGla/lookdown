# Packaging, Icon and Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A per-user NSIS setup that registers `.md`/`.markdown`, a portable exe, the lookdown fish icon everywhere, one version source with a `pnpm release` command, and README coverage; ready to tag `v0.1.0`.

**Architecture:** Configuration-first. `tauri.conf.json` gains the identifier, a version read from `package.json`, NSIS-only bundling with per-user install mode and file associations, and icons generated from the approved SVG. A small Node script under `scripts/` does the release bookkeeping; its pure parts are tested with Vitest. Rust tests pin the config.

**Tech Stack:** Tauri 2 (NSIS bundler, `tauri icon`), Node (ESM script), Vitest, Rust tests.

**Spec:** `docs/superpowers/specs/2026-11-22-packaging-release-design.md`

## Global Constraints

- Identifier: exactly `io.github.togla.lookdown` (was `com.lookdown.app`).
- Version: `0.1.0`, single source `package.json`; `tauri.conf.json` `"version": "../package.json"`; `src-tauri/Cargo.toml` `version = "0.1.0"`; a test fails when Cargo.toml and package.json differ.
- Bundling: `bundle.targets` = `["nsis"]` only; `bundle.windows.nsis.installMode` = `"currentUser"`; no MSI.
- File associations: `.md` and `.markdown`, name `Markdown document`, role `Editor`, mime type `text/markdown`.
- Standard NSIS pages are kept (no custom template, no hooks). Only cheap config tweaks (e.g. `displayLanguageSelector: false`).
- No Windows menu bar. No new runtime dependencies. No network at runtime. No auto-updater, no signing, no CI.
- Icon source: `docs/superpowers/specs/assets/lookdown-icon-a.svg` (approved). The generated set replaces Tauri's stock icons; the source SVG is kept in the repo as `src-tauri/icons/lookdown.svg`.
- Release command: `pnpm release <version>`; never pushes; refuses on a dirty tree, an invalid SemVer, or an existing tag; on an unchanged version it only tags.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Commands: `pnpm test`, `cargo test --manifest-path src-tauri/Cargo.toml`, `pnpm build`, `pnpm tauri build` (release + setup).
- The controller checks the generated icons visually and runs the release build; installing the setup on the user's machine is the user's step.

## Review Focus

1. **An in-place upgrade still works after the identifier change**: the new identifier is used consistently (conf, test, README data-folder path), so future setups recognise the install. Test in Task 1 (config test) and the user's install check.
2. **`pnpm release` on a dirty tree or with an existing tag** does nothing and explains why; on `0.1.0` (unchanged) it creates only the tag, no empty commit. Tests in Task 1.
3. **The 16 px icon still reads as a fish.** Controller gate in Task 2 (view the generated 16/32 px images); hand-tune a small-size variant only if needed.
4. **The release build still produces a working portable exe** with the new icon and the setup in `bundle/nsis/` only (no `bundle/msi/`). Controller gate in Task 3.
5. **Associated files open in the running instance**: double-click a `.md` file with lookdown open adds a tab. User's install check (step 3's single instance carries it).

---

### Task 1: Identifier, version source and the release command

**Files:**
- Modify: `src-tauri/tauri.conf.json` (identifier, `"version": "../package.json"`), `src-tauri/src/lib.rs` (config tests), `package.json` (`"release": "node scripts/release.mjs"`)
- Create: `scripts/release.mjs`, `scripts/release-lib.mjs`, `scripts/release.test.ts` (Vitest picks up `scripts/**/*.test.ts` — add the glob to the Vitest config or `include` if needed)

**Interfaces:**
- `release-lib.mjs` (pure, no I/O):
  - `isSemver(v: string): boolean` — `MAJOR.MINOR.PATCH` with optional `-prerelease`, no leading `v`, no leading zeros.
  - `setPackageVersion(json: string, v: string): string` — replaces the top-level `"version"` value only, keeping formatting.
  - `setCargoVersion(toml: string, v: string): string` — replaces `version = "…"` in the `[package]` table only.
  - `cargoVersion(toml: string): string | null`, `packageVersion(json: string): string`.
- `release.mjs` (thin I/O): argument → checks (`isSemver`; `git status --porcelain` empty; `git tag -l v<v>` empty) → if version differs: write both files, run `cargo update -p lookdown --manifest-path src-tauri/Cargo.toml --offline` (fallback without `--offline` if needed) to refresh `Cargo.lock`, `git add` the three files, commit `release: v<v>` (+ Co-Authored-By trailer not needed — this is the user's own release commit; use no trailer) → `git tag -a v<v> -m "lookdown v<v>"` → print the next step (`pnpm tauri build`, and `git push --follow-tags` if they want to publish). Never pushes.
- Rust tests in `lib.rs`: identifier is `io.github.togla.lookdown`; `version` in tauri.conf is `"../package.json"`; Cargo.toml version equals `package.json` version (read both with `include_str!`).

- [ ] **Step 1: Write the failing tests** — Vitest: `isSemver` accepts `0.1.0`, `1.2.3-rc.1`, rejects `v0.1.0`, `0.1`, `01.2.3`; `setPackageVersion` changes only the top-level version (a nested `"version"` in another key is untouched); `setCargoVersion` changes only `[package]`'s version (a dependency line `tauri = { version = "2" }` is untouched). Rust: the three config tests above (update `app_identity_matches_spec`).
- [ ] **Step 2: Run** `pnpm test scripts` and `cargo test --manifest-path src-tauri/Cargo.toml`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** all tests and `pnpm build`. Also a dry check of the script's refusal paths without tagging: run `node scripts/release.mjs v0.1.0` (expect "not a version" and exit code 1) and, with an uncommitted change present, `node scripts/release.mjs 0.1.1` (expect "working tree not clean", exit 1). Do NOT run a real release.
- [ ] **Step 5: Commit** `feat: app identifier, single version source and release command`.

### Task 2: The lookdown icon

**Files:**
- Create: `src-tauri/icons/lookdown.svg` (copy of the approved SVG)
- Regenerate: `src-tauri/icons/*` via `pnpm tauri icon src-tauri/icons/lookdown.svg`
- Modify: `src-tauri/tauri.conf.json` `bundle.icon` list only if the generated names differ; remove generated files the project doesn't use (Android/iOS folders, Store logos) unless Tauri needs them for Windows/macOS bundles.

**Interfaces:** none (assets). `icon.ico` must contain 16, 24, 32, 48 and 256 px images.

- [ ] **Step 1: Generate** the icon set from the SVG.
- [ ] **Step 2: Verify** with a short Node or PowerShell check that `icon.ico` contains at least 16/32/48/256 sizes and that `32x32.png` and `128x128.png` exist. Add a Rust test that the `bundle.icon` list in tauri.conf.json names only files that exist in `src-tauri/icons/`.
- [ ] **Step 3: Run** `cargo test --manifest-path src-tauri/Cargo.toml` and `pnpm build`. Expected: PASS.
- [ ] **Step 4: Commit** `feat: lookdown fish icon`.
- [ ] **Step 5 (controller gate):** view the generated 16, 32 and 256 px images; if the 16 px one doesn't read as a fish, hand-tune a simplified small variant (thicker shapes, no filaments/sheen) and regenerate the small sizes from it.

### Task 3: NSIS setup, file association, docs

**Files:**
- Modify: `src-tauri/tauri.conf.json` (`bundle.targets`, `bundle.windows.nsis`, `bundle.fileAssociations`, short/long description, publisher/copyright if useful), `src-tauri/src/lib.rs` (config tests), `README.md`, `CLAUDE.md` (menu bar line)

**Interfaces:** config only.
- `bundle.targets: ["nsis"]`; `bundle.windows.nsis: { "installMode": "currentUser", "displayLanguageSelector": false }`; `bundle.fileAssociations: [{ "ext": ["md", "markdown"], "name": "Markdown document", "role": "Editor", "mimeType": "text/markdown" }]` (follow the Tauri 2 schema in `node_modules/@tauri-apps/cli/config.schema.json` for exact keys).
- CLAUDE.md: the Platforms bullet becomes "provide a native menu bar on macOS only (Windows keeps a menu-less window)".
- README:
  - Requirements: Windows 10 or later (WebView2 built in).
  - Install: run `lookdown_<version>_x64-setup.exe`; no admin rights; it registers `.md`/`.markdown` for "Open with".
  - Make lookdown the default: right-click a `.md` file → Open with → Choose another app → lookdown → Always.
  - Portable: copy `lookdown.exe` anywhere; nothing is registered.
  - Update: close lookdown, run the new setup (upgrades in place) or replace the portable exe.
  - Uninstall: Windows Settings → Apps; the webview data folder `%LOCALAPPDATA%\io.github.togla.lookdown` can be deleted then (the uninstaller offers it).
  - SmartScreen: the exe is unsigned, so Windows may warn on first run ("More info → Run anyway").
  - Releasing: `pnpm release <version>`, then `pnpm tauri build`; artifacts `src-tauri/target/release/lookdown.exe` (portable) and `src-tauri/target/release/bundle/nsis/lookdown_<version>_x64-setup.exe`; current sizes (filled in from the Task 3 build).
  - Roadmap step 4 struck through as done (step text adjusted: no Windows menu bar; macOS menu with the macOS step).

- [ ] **Step 1: Write the failing Rust tests:** targets are exactly `["nsis"]`; install mode `currentUser`; file associations cover `md` and `markdown` with role `Editor`.
- [ ] **Step 2: Run** `cargo test --manifest-path src-tauri/Cargo.toml`. Expected: FAIL.
- [ ] **Step 3: Implement** the config, CLAUDE.md and README changes.
- [ ] **Step 4: Run** all tests, `pnpm build`, then `pnpm tauri build`. Expected: PASS; `bundle/nsis/lookdown_0.1.0_x64-setup.exe` exists and no new `bundle/msi` output is produced. Record the exe and setup sizes in the README.
- [ ] **Step 5: Commit** `feat: per-user NSIS setup with .md association`.
- [ ] **Step 6 (controller gate):** run the built portable exe briefly to confirm it starts with the new icon in the title bar/taskbar; installing the setup is left to the user.
