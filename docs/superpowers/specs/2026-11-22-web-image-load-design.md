# Load web images on request, and the image-chip click fix: design

Status: approved 2026-11-22. Size: small change. Follows
`2026-11-22-live-preview-tables-images-design.md`, whose rules still apply
(images stack under their line, no network access when opening a file).

## Intent

After using 2b the user wants two things. First, a web image (`http:`/`https:`)
that lookdown deliberately doesn't load should be loadable when they ask for it.
Second, a table cell holding an image chip should take a click like any other
cell.

## Goals

- **Load image.** Right-clicking a web image placeholder opens a small menu
  with one item, "Load image".
  - Choosing it loads that URL directly in the `<img>` for the rest of the
    session. It isn't remembered across restarts and nothing is written to the
    file. Other images in the file with the same URL load too.
  - If loading fails, the placeholder reads `{alt} — image could not be loaded`.
    When alt is empty, drop `{alt} — `.
  - Opening a file still makes no network request. Only the click does.
  - Ctrl+click on the placeholder still opens the URL in the browser.
- **Chip click.** Clicking an image chip in a grid-table cell puts the cursor
  in that cell. The cell then reveals its raw `![alt](path)` like any cell.

## Non-goals

Placing several images on one line side by side: the user withdrew that, so
they keep stacking as the 2b spec says. Also out: remembering loaded URLs, a
"load all web images" command, and downloading through Rust.

## Anti-goals

Network access without an explicit click. A change to the file when an image
is loaded.

## Constraints

No new dependencies. The CSP's `img-src` widens to `'self' blob: http: https:`,
because the webview loads the image itself. Nothing else in the CSP changes.
The menu looks like the table menu.

## Approaches

- **A. Load in the webview with a widened `img-src` (chosen).** Smallest
  change, no Rust.
- B. Download in Rust and hand over bytes like local images. Keeps the CSP
  tight but needs an HTTP client crate in the "thin" Rust side. Rejected for
  weight.

User approved A.

## Decisions taken in conversation

- Behaviour of "Load image" as in Goals (Claude's proposal, accepted).
- Side by side withdrawn; keep the spec.

## Left to the builder

Where the loaded-URL state lives (a `StateField` is natural), and how the
menu DOM is shared with the table menu.
