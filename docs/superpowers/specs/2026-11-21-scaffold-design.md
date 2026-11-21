# Project scaffold: design

Status: approved 2026-11-21. Size: small change.

## Intent

Get a minimal, runnable Tauri 2 + Vite + TypeScript skeleton in place so every
later feature (editor, tabs, file I/O) builds on a known-good base, and so
startup time and binary size can be watched from day one.

## Goals

- `pnpm tauri dev` opens a single window titled "lookdown".
- `pnpm tauri build` produces a size-optimized release binary.
- Frontend tests (Vitest) and Rust tests (`cargo test`) both run, each with one
  placeholder test.
- `CLAUDE.md` documents the build/test commands and the layout.

## Non-goals

CodeMirror, tabs, single-instance plugin, file association, installer/bundle
tuning, native menu bar. Each comes in its own later step.

## Constraints

- No UI framework (vanilla TypeScript).
- Cross-platform code only; no Windows-only paths or APIs.
- Tools are managed by `mise.toml` (node lts, pnpm, rust).

## Approaches

1. **Official `create-tauri-app` vanilla-ts template, then trim.** Chosen: the
   least effort, and it stays aligned with upstream conventions.
2. Hand-write every file. Rejected: gains nothing over a trimmed template.
3. A framework template (React/Svelte). Rejected: violates "no UI framework".

## Design

- Frontend at the repo root (`index.html`, `src/`, `package.json`,
  `vite.config.ts`); Rust in `src-tauri/`.
- Identifier `com.lookdown.app`, product name `lookdown`, one window titled
  "lookdown".
- Remove template demo content (greet command, sample assets/logos). Rust
  `main` only opens the window.
- Release profile: `opt-level = "s"`, `lto = true`, `codegen-units = 1`,
  `strip = true`, `panic = "abort"`.
- `.gitignore`: `node_modules/`, `dist/`, `src-tauri/target/`.

## Left to the builder

Exact template version pins, Vitest config details, placeholder test content,
default icons (keep the template's until a real icon exists).
