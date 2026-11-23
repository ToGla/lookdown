import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

test("the caret uses the text colour, so it shows in dark mode too", () => {
  // CodeMirror's base theme draws a black caret; the page follows light/dark.
  expect(css).toMatch(/#app \.cm-cursor,\s*#app \.cm-dropCursor \{\s*border-left-color: CanvasText;/);
});
